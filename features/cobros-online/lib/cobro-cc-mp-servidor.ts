import "server-only";
import { createAdminClient } from "@/shared/config/supabase/admin";
import { urlDelPanel } from "@/shared/lib/ruteo-host";
import { urlDeResumen } from "@/shared/lib/dominios";
import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import {
  calcularSaldoConRecargo,
  type BasesMora,
} from "@/features/clients/lib/calcular-saldo-con-recargo";
import { corteResumenCc, montoHastaCorte } from "@/features/clients/lib/resumen-ciclo";
import {
  descripcionMora,
  opcionesPagoCc,
  type AlcancePagoCc,
  type OpcionPagoCc,
} from "@/features/clients/lib/pago-online-cc";
import type { CcVencimientoModo } from "@/features/clients/lib/calcular-fecha-vencimiento";
import type { RecargoMoraBase, RecargoMoraTipo } from "@/entities/config/types";
import { tokenDelComercio } from "./checkout-mp-servidor";
import { armarPreferenciaCobroCc, type PagoCheckout } from "./preferencia-mp";
import { pagoParaLaBase } from "./webhook-mp";

/**
 * Pagar la cuenta corriente con Mercado Pago desde el resumen público
 * (`/r/<token>`, docs/cuenta-corriente.md, decidido el 22/10/2026).
 *
 * La clienta no tiene sesión: todo se resuelve por el token del resumen, con
 * el cliente de servicio, y el negocio sale SIEMPRE del cliente (nunca del
 * navegador). El monto también: se recalcula acá con la misma regla de mora
 * que el cobro en el mostrador (`calcularSaldoConRecargo`) y queda congelado
 * en el intento (`cobros_cc_online`), que es lo que la base compara contra el
 * pago de Mercado Pago.
 */

const API_MP = "https://api.mercadopago.com";
/** Cuánto vive el link de pago. Corto: la mora puede cambiar al día siguiente. */
const VIDA_INTENTO_MS = 60 * 60 * 1000;
/** Tope de intentos por clienta y hora: cada uno crea una preference en MP. */
const MAX_INTENTOS_POR_HORA = 10;

type Admin = ReturnType<typeof createAdminClient>;

interface ClienteResumen {
  id: string;
  negocio_id: string;
  nombre: string;
  saldo_pendiente: number | string | null;
  fecha_vencimiento_deuda: string | null;
}

async function clienteDelToken(admin: Admin, token: string): Promise<ClienteResumen | null> {
  if (!token || token.length < 24) return null;
  const { data } = await admin
    .from("clientes")
    .select("id, negocio_id, nombre, saldo_pendiente, fecha_vencimiento_deuda")
    .eq("resumen_token", token)
    .maybeSingle();
  return (data as ClienteResumen | null) ?? null;
}

async function mpConectado(admin: Admin, negocioId: string): Promise<boolean> {
  const { data } = await admin
    .from("mercadopago_conexiones")
    .select("estado")
    .eq("negocio_id", negocioId)
    .maybeSingle();
  return data?.estado === "ACTIVA";
}

interface DatosPago {
  opciones: OpcionPagoCc[];
  moraDescripcion: string;
  moraDebitoOrigenId: string | null;
  nombreComercio: string | null;
}

/** Los botones de pago de una clienta, con la mora de hoy. */
async function datosPago(admin: Admin, cliente: ClienteResumen): Promise<DatosPago> {
  const [{ data: config }, { data: deudaVencida }, { data: deudas }] = await Promise.all([
    admin
      .from("configuracion_pos")
      .select(
        "posName, recargo_mora_tipo, recargo_mora_valor, recargo_mora_base, cc_vencimiento_modo, cc_plazo_mora, cc_dia_cierre, cc_dia_vencimiento",
      )
      .eq("negocio_id", cliente.negocio_id)
      .maybeSingle(),
    admin.rpc("deuda_cc_vencida", { p_cliente_id: cliente.id }).maybeSingle(),
    admin.rpc("cc_deudas_vivas", { p_cliente_id: cliente.id }),
  ]);

  const recargoConfig = {
    recargo_mora_tipo: (config?.recargo_mora_tipo ?? "NINGUNO") as RecargoMoraTipo,
    recargo_mora_valor: Number(config?.recargo_mora_valor ?? 0),
    recargo_mora_base: (config?.recargo_mora_base ?? "SALDO_COMPLETO") as RecargoMoraBase,
  };
  const dv = deudaVencida as
    | (BasesMora & { vencido: number | null; mora_viva: number | null; debito_capital_mas_antiguo_id: string | null })
    | null;

  // Los mismos datos que `registrarPagoDeudaAction` le pasa a la regla.
  const { montoRecargo } = calcularSaldoConRecargo(
    {
      monto_pendiente: cliente.saldo_pendiente,
      fecha_vencimiento: cliente.fecha_vencimiento_deuda,
      monto_vencido: dv?.vencido,
      mora_previa: dv?.mora_viva,
      capital_vencido: dv?.capital_vencido,
      recargado_saldo: dv?.recargado_saldo,
      recargado_vencido: dv?.recargado_vencido,
      ventas_vencidas_nuevas: dv?.ventas_vencidas_nuevas,
    },
    recargoConfig,
  );

  // Con cierre mensual el parcial es lo del ciclo: el mismo corte que el
  // resumen y el mensaje de WhatsApp.
  const vivas = ((deudas ?? []) as { vence_el: string; vivo: number | string }[]).map((d) => ({
    venceEl: String(d.vence_el).slice(0, 10),
    vivo: Number(d.vivo) || 0,
  }));
  const corte = corteResumenCc(
    {
      modo: (config?.cc_vencimiento_modo ?? null) as CcVencimientoModo | null,
      plazoDias: config?.cc_plazo_mora ?? null,
      diaCierre: config?.cc_dia_cierre ?? null,
      diaVencimiento: config?.cc_dia_vencimiento ?? null,
    },
    diaComercial(new Date()),
    vivas,
  );

  return {
    opciones: opcionesPagoCc({
      saldo: Number(cliente.saldo_pendiente) || 0,
      vencido: Number(dv?.vencido) || 0,
      mora: montoRecargo,
      montoCiclo: corte ? montoHastaCorte(vivas, corte) : null,
    }),
    moraDescripcion: descripcionMora(recargoConfig),
    moraDebitoOrigenId: dv?.debito_capital_mas_antiguo_id ?? null,
    nombreComercio: (config as { posName?: string | null } | null)?.posName ?? null,
  };
}

export type EstadoCobroCc = "PENDIENTE" | "EN_PROCESO" | "PAGADO" | "REVISAR";

export interface PagoOnlineResumen {
  opciones: OpcionPagoCc[];
  /** El intento con el que volvió de Mercado Pago (`?pago=`), si es de ella. */
  intento: { estado: EstadoCobroCc; total: number } | null;
}

/**
 * Lo que la página del resumen necesita: los botones (solo si el comercio
 * tiene Mercado Pago conectado y hay deuda) y, si la clienta vuelve de pagar,
 * en qué quedó su pago. Al volver se concilia primero, por si el aviso de
 * Mercado Pago todavía no llegó. NUNCA lanza: sin datos, no hay botón.
 */
export async function pagoOnlineDelResumen(
  token: string,
  intentoId: string | null,
): Promise<PagoOnlineResumen | null> {
  try {
    const admin = createAdminClient();
    const cliente = await clienteDelToken(admin, token);
    if (!cliente || !(await mpConectado(admin, cliente.negocio_id))) return null;

    let intento: PagoOnlineResumen["intento"] = null;
    if (intentoId && /^[0-9a-f-]{36}$/i.test(intentoId)) {
      const leer = () =>
        admin
          .from("cobros_cc_online")
          .select("estado, total")
          .eq("id", intentoId)
          .eq("cliente_id", cliente.id)
          .maybeSingle();
      let { data } = await leer();
      if (data && data.estado !== "PAGADO") {
        await conciliarCobrosCc(admin, cliente.negocio_id);
        ({ data } = await leer());
      }
      if (data) intento = { estado: data.estado as EstadoCobroCc, total: Number(data.total) };
    }

    // Recién pagado: el saldo de la clienta ya cambió, se releen los botones.
    const fresco = intento?.estado === "PAGADO" ? await clienteDelToken(admin, token) : cliente;
    const { opciones } = await datosPago(admin, fresco ?? cliente);
    return { opciones, intento };
  } catch (e) {
    console.error("[PAGO CC MP] resumen", (e as Error).message);
    return null;
  }
}

export type ResultadoPagoCc =
  | { ok: true; initPoint: string }
  | { ok: false; motivo: "NO_DISPONIBLE" | "SIN_DEUDA" | "DEMASIADOS" | "ERROR" };

async function mp(token: string, ruta: string, init?: RequestInit) {
  const respuesta = await fetch(`${API_MP}${ruta}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  const json = (await respuesta.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: respuesta.ok, status: respuesta.status, json };
}

const linkDe = (json: Record<string, unknown> | null): string | null =>
  (json?.init_point as string | undefined) ?? (json?.sandbox_init_point as string | undefined) ?? null;

/**
 * El botón "Pagar": recalcula el monto, guarda el intento y crea la preference
 * con el token del comercio. Si ya hay un intento vivo con el mismo monto, se
 * reusa su link (dos toques no son dos preferences).
 */
export async function iniciarPagoCuentaCc(
  token: string,
  alcance: AlcancePagoCc,
): Promise<ResultadoPagoCc> {
  try {
    const admin = createAdminClient();
    const cliente = await clienteDelToken(admin, token);
    if (!cliente) return { ok: false, motivo: "NO_DISPONIBLE" };

    const datos = await datosPago(admin, cliente);
    const opcion = datos.opciones.find((o) => o.alcance === alcance);
    if (!opcion) return { ok: false, motivo: "SIN_DEUDA" };

    const tokenMp = await tokenDelComercio(cliente.negocio_id);
    if (!tokenMp) return { ok: false, motivo: "NO_DISPONIBLE" };

    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recientes } = await admin
      .from("cobros_cc_online")
      .select("id, alcance, estado, total, mora_monto, vence_en, mp_preference_id")
      .eq("negocio_id", cliente.negocio_id)
      .eq("cliente_id", cliente.id)
      .gte("creado_en", haceUnaHora)
      .order("creado_en", { ascending: false });

    // Uno vivo con el mismo monto: el mismo link.
    const margen = Date.now() + 5 * 60 * 1000;
    const vivo = (recientes ?? []).find(
      (r) =>
        r.estado === "PENDIENTE" &&
        r.alcance === alcance &&
        Math.abs(Number(r.total) - opcion.total) < 0.005 &&
        Math.abs(Number(r.mora_monto) - opcion.mora) < 0.005 &&
        new Date(r.vence_en as string).getTime() > margen &&
        r.mp_preference_id,
    );
    if (vivo) {
      const r = await mp(tokenMp.accessToken, `/checkout/preferences/${encodeURIComponent(vivo.mp_preference_id as string)}`);
      const link = r.ok ? linkDe(r.json) : null;
      if (link) return { ok: true, initPoint: link };
    }
    if ((recientes ?? []).length >= MAX_INTENTOS_POR_HORA) return { ok: false, motivo: "DEMASIADOS" };

    const cobroId = crypto.randomUUID();
    const venceEn = new Date(Date.now() + VIDA_INTENTO_MS);
    const { error: errorAlta } = await admin.from("cobros_cc_online").insert({
      id: cobroId,
      negocio_id: cliente.negocio_id,
      cliente_id: cliente.id,
      alcance,
      monto_capital: opcion.capital,
      mora_monto: opcion.mora,
      mora_descripcion: opcion.mora > 0 ? datos.moraDescripcion : null,
      mora_debito_origen_id: opcion.mora > 0 ? datos.moraDebitoOrigenId : null,
      vence_en: venceEn.toISOString(),
    });
    if (errorAlta) {
      console.error("[PAGO CC MP] alta", errorAlta.message);
      return { ok: false, motivo: "ERROR" };
    }

    const webhook = urlDelPanel("/api/mercadopago/webhook", `?n=${cliente.negocio_id}`);
    const creada = await mp(tokenMp.accessToken, "/checkout/preferences", {
      method: "POST",
      body: JSON.stringify(
        armarPreferenciaCobroCc({
          cobroId,
          negocioId: cliente.negocio_id,
          total: opcion.total,
          nombreComercio: datos.nombreComercio,
          clienteNombre: cliente.nombre,
          venceEn,
          urlRetorno: `${urlDeResumen(token)}?pago=${cobroId}`,
          urlNotificacion: webhook.startsWith("https://") ? webhook : null,
        }),
      ),
      headers: { "X-Idempotency-Key": `cobro-cc-${cobroId}` },
    });
    const link = creada.ok ? linkDe(creada.json) : null;
    if (!link || !creada.json?.id) {
      console.error("[PAGO CC MP] preference", creada.status, (creada.json as { message?: string } | null)?.message);
      return { ok: false, motivo: creada.status === 401 || creada.status === 403 ? "NO_DISPONIBLE" : "ERROR" };
    }

    await admin
      .from("cobros_cc_online")
      .update({ mp_preference_id: String(creada.json.id) })
      .eq("id", cobroId)
      .is("mp_preference_id", null);

    return { ok: true, initPoint: link };
  } catch (e) {
    console.error("[PAGO CC MP]", (e as Error).message);
    return { ok: false, motivo: "ERROR" };
  }
}

/** Un pago leído de la API, aplicado a su intento. Lo comparten webhook y conciliación. */
export async function aplicarPagoMpCobroCc(
  admin: Admin,
  negocioId: string,
  cobroId: string,
  pago: PagoCheckout,
  origen: "MP_WEBHOOK" | "SISTEMA",
): Promise<{ ok: true; resultado: string } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("aplicar_pago_mp_cobro_cc", {
    p_negocio: negocioId,
    p_cobro: cobroId,
    p_origen: origen,
    p_pago: pagoParaLaBase(pago),
  });
  if (error) {
    console.error("[PAGO CC MP] aplicar", { cobroId, pago: String(pago.id), error: error.message });
    return { ok: false, error: error.message };
  }
  if (data !== "APLICADO" && data !== "DUPLICADO" && data !== "IGNORADO") {
    console.warn("[PAGO CC MP]", data, { cobroId, pago: String(pago.id), status: pago.status });
  }
  return { ok: true, resultado: data as string };
}

/** De todos los pagos de un intento, el que decide: aprobado > en proceso. */
function pagoQueDecideElCobro(pagos: PagoCheckout[], referencia: string, mpUserId: string): PagoCheckout | null {
  const propios = pagos.filter(
    (p) => p.external_reference === referencia && String(p.collector_id ?? "") === mpUserId,
  );
  return (
    propios.find((p) => p.status === "approved") ??
    propios.find((p) => ["pending", "in_process", "authorized"].includes(p.status ?? "")) ??
    null
  );
}

/**
 * La red de seguridad del webhook para los cobros de cuenta corriente: busca en
 * Mercado Pago los pagos de cada intento sin cerrar de los últimos dos días y
 * aplica el que decide. La llaman `conciliarPagosNegocio` y la página del
 * resumen cuando la clienta vuelve de pagar. NUNCA lanza.
 */
export async function conciliarCobrosCc(admin: Admin, negocioId: string): Promise<number> {
  try {
    const desde = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: abiertos } = await admin
      .from("cobros_cc_online")
      .select("id")
      .eq("negocio_id", negocioId)
      .in("estado", ["PENDIENTE", "EN_PROCESO"])
      .not("mp_preference_id", "is", null)
      .gte("creado_en", desde);
    if (!abiertos?.length) return 0;

    const token = await tokenDelComercio(negocioId);
    if (!token) return 0;

    let aplicados = 0;
    for (const { id } of abiertos) {
      const referencia = `cc:${id}`;
      const query = new URLSearchParams({ sort: "date_created", criteria: "desc", limit: "20", external_reference: referencia });
      const respuesta = await fetch(`${API_MP}/v1/payments/search?${query}`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      if (!respuesta.ok) continue;
      const pagos = (((await respuesta.json()) as { results?: PagoCheckout[] }).results ?? []);
      const decide = pagoQueDecideElCobro(pagos, referencia, token.mpUserId);
      if (!decide) continue;
      const r = await aplicarPagoMpCobroCc(admin, negocioId, id as string, decide, "SISTEMA");
      if (r.ok && r.resultado === "APLICADO") aplicados++;
    }
    return aplicados;
  } catch (e) {
    console.error("[CONCILIACION CC MP]", (e as Error).message);
    return 0;
  }
}
