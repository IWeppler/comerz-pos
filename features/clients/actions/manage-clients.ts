"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { calcularFechaVencimiento } from "@/features/clients/lib/calcular-fecha-vencimiento";
import { revalidatePath } from "next/cache";
import { calcularRecargoMonto } from "@/shared/lib/recargo-metodo";
import { parseClientesCSV } from "@/features/clients/lib/parse-clientes-csv";
import {
  calcularSaldoConRecargo,
  RecargoMoraConfig,
} from "@/features/clients/lib/calcular-saldo-con-recargo";
import { validarPerdonDeuda } from "@/features/clients/lib/validar-perdon-deuda";
import { mensajeCobroSuperaDeuda } from "@/features/clients/lib/tope-cobro-cc";
import { deudaDe } from "@/features/clients/lib/saldo-a-favor";
import { urlDeResumen } from "@/shared/lib/dominios";
import { esCuitValido, normalizarCuit } from "@/shared/lib/cuit";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import {
  reciboDesdeFila,
  type FilaReciboCC,
  type ReciboCobroCC,
} from "@/features/clients/lib/recibo-cc";
import {
  deudaVivaDesdeFila,
  type DeudaViva,
  type FilaDeudaViva,
} from "@/features/clients/lib/deuda-por-mes";

interface ClientActionState {
  error: string | null;
  success: boolean;
}

/**
 * Datos fiscales listos para guardar, o el error que hay que mostrar.
 *
 * Vive acá y lo comparten alta y edición porque tenían la validación
 * duplicada y ya habían empezado a divergir. Dos reglas:
 *
 *  - Si el cliente NO es fiscal, todo lo fiscal va a null. Es lo que ya hacían
 *    las dos actions; queda explícito para que se vea que es a propósito
 *    (apagar el toggle borra los datos fiscales) y no un olvido.
 *  - El CUIT se valida por dígito verificador. Es la validación que se puede
 *    hacer sin ARCA y atrapa el error real: un número mal tipeado. Se guarda
 *    normalizado (solo dígitos) para que "30-712..." y "30712..." no entren
 *    como dos clientes distintos y el índice único sirva de algo.
 */
function resolverDatosFiscales(
  formData: FormData,
):
  | { error: string; datos?: undefined }
  | { error?: undefined; datos: Record<string, string | null> } {
  const esFiscal = formData.get("es_fiscal") === "true";
  const texto = (clave: string) =>
    ((formData.get(clave) as string | null) ?? "").trim() || null;

  if (!esFiscal) {
    return {
      datos: {
        cuit: null,
        razon_social: null,
        condicion_iva: null,
        direccion: null,
        localidad: null,
        provincia: null,
        codigo_postal: null,
      },
    };
  }

  const cuit = normalizarCuit(formData.get("cuit"));
  const razonSocial = texto("razon_social");
  const condicionIva = texto("condicion_iva");

  if (!cuit || !razonSocial || !condicionIva) {
    return {
      error:
        "El CUIT, la Razón Social y la Condición de IVA son obligatorios para clientes fiscales.",
    };
  }

  if (!esCuitValido(cuit)) {
    return {
      error:
        "El CUIT no es válido: revisá los números. Tiene que tener 11 dígitos y el dígito verificador correcto.",
    };
  }

  return {
    datos: {
      cuit,
      razon_social: razonSocial,
      condicion_iva: condicionIva,
      direccion: texto("direccion"),
      localidad: texto("localidad"),
      provincia: texto("provincia"),
      codigo_postal: texto("codigo_postal"),
    },
  };
}

/** Lo mínimo que necesita el selector del POS para dejar el cliente elegido. */
export interface ClienteCreado {
  id: string;
  nombre: string;
  telefono: string | null;
  exceptuado_entrega_minima: boolean;
  lista_precio_id?: string | null;
}

export interface CrearClienteState extends ClientActionState {
  cliente?: ClienteCreado;
}

// 1. OBTENER TODOS LOS CLIENTES (Para la tabla principal)
export async function getClientesAction() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // Se traen fecha y costo de cada venta, y los movimientos de cuenta
  // corriente, porque son la materia prima del scoring: sin las fechas no hay
  // recencia ni episodios de deuda, y sin el costo el "valor" se calcularía
  // sobre facturación en vez de margen (ver scoring-cliente.ts).
  const { data, error } = await supabase
    .from("clientes")
    .select(
      `
      *,
      ventas ( id, total, precio_costo, cantidad, fecha_venta ),
      cuenta_corriente_movimientos ( tipo, monto, creado_en, fecha_origen, anulado, descripcion )
    `,
    )
    .order("nombre", { ascending: true });

  if (error) {
    console.error("Error fetching clientes:", error);
    return { data: null, error: "No se pudieron cargar los clientes." };
  }

  return { data, error: null };
}

// Combina clientes + métodos de pago + config de CC/mora para el listado
// en un solo fetch client-side (React Query cachea esto con staleTime de 3 min).
export async function getClientesPageDataAction() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [clientesRes, metodosRes, configRes, vencidoRes] = await Promise.all([
    getClientesAction(),
    supabase.from("metodos_pago").select("*").eq("activo", true),
    supabase
      .from("configuracion_pos")
      .select(
        "cc_anticipo_default, recargo_mora_tipo, recargo_mora_valor, posName, mensaje_recordatorio_cc",
      )
      .single(),
    // Sin `p_cliente_id` devuelve todos los del negocio en UN viaje: la tabla
    // muestra el recargo de 156 clientes y pedirlo de a uno serían 156.
    supabase.rpc("deuda_cc_vencida"),
  ]);

  if (clientesRes.error) {
    return { data: null, error: clientesRes.error };
  }

  const recargoMoraConfig: RecargoMoraConfig = {
    recargo_mora_tipo: configRes.data?.recargo_mora_tipo ?? "NINGUNO",
    recargo_mora_valor: configRes.data?.recargo_mora_valor ?? 0,
  };

  // Mapa cliente → porción vencida, para que la tabla y el detalle calculen el
  // MISMO recargo que va a cobrar el server. Un cliente que no aparece no
  // tiene deuda viva, y ahí el vencido es 0.
  const vencidoPorCliente: Record<string, number> = {};
  // Y cuánto de ese saldo son recargos anteriores impagos, que NO son base del
  // próximo recargo. Sale de la misma fila que el vencido, y va junto a
  // propósito: separarlos invita a que una pantalla pase uno y olvide el otro.
  const moraPreviaPorCliente: Record<string, number> = {};
  for (const fila of (vencidoRes.data ?? []) as {
    cliente_id: string;
    vencido: number | string | null;
    mora_viva: number | string | null;
  }[]) {
    vencidoPorCliente[fila.cliente_id] = Number(fila.vencido ?? 0);
    moraPreviaPorCliente[fila.cliente_id] = Number(fila.mora_viva ?? 0);
  }

  return {
    data: {
      clientes: clientesRes.data ?? [],
      metodosPago: metodosRes.data ?? [],
      entregaMinimaActiva: (configRes.data?.cc_anticipo_default ?? 0) > 0,
      recargoMoraConfig,
      vencidoPorCliente,
      moraPreviaPorCliente,
      nombreComercio: (configRes.data?.posName as string | null) ?? null,
      plantillaRecordatorio:
        (configRes.data?.mensaje_recordatorio_cc as string | null) ?? null,
    },
    error: null,
  };
}

// 2. OBTENER DETALLE PROFUNDO (Para el Sheet lateral)
export async function getClienteDetalleAction(clienteId: string) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [movimientosRes, ventasRes, reservasRes, deudasRes, recibosRes] =
    await Promise.all([
      supabase
        .from("cuenta_corriente_movimientos")
        .select(
          "*, pago:venta_pagos!cuenta_corriente_movimientos_pago_id_fkey(id, metodo_pago_id, metodo_nombre, metodo_tipo, monto_base, recargo_porcentaje, recargo_monto, monto_bruto, comision_monto, monto_neto, estado_pago_operacion, turno:turnos_caja!venta_pagos_turno_caja_id_fkey(estado))",
        )
        .eq("cliente_id", clienteId)
        .order("creado_en", { ascending: false }),
      supabase
        .from("ventas")
        .select(
          "id, total, cliente_id, clientes(nombre), monto_cobrado, monto_pendiente, estado_pago, fecha_venta, fecha_vencimiento, ventas_items(cantidad, variante, es_venta_libre, producto:productos(nombre, tipo)), venta_pagos(metodo_nombre, metodo_tipo, monto_bruto, comision_monto, monto_neto, acreditacion_dias, tipo_movimiento)",
        )
        .eq("cliente_id", clienteId)
        .order("fecha_venta", { ascending: false }),
      supabase
        .from("reservas")
        .select(
          "id, nota, estado, creado_en, producto:productos(nombre), variante:producto_variantes(nombre_display, precio)",
        )
        .eq("cliente_id", clienteId)
        .order("creado_en", { ascending: false }),
      // Lo que debe por ticket, con su vencimiento: de acá sale "debe por mes".
      // Misma función que el vencimiento y el recibo (cc_deudas_vivas).
      supabase.rpc("cc_deudas_vivas_detalle", { p_cliente_id: clienteId }),
      // Qué cobros tienen recibo guardado, para ofrecer reimprimirlo solo ahí.
      supabase.from("cc_recibos").select("pago_id").eq("cliente_id", clienteId),
    ]);

  if (deudasRes.error) {
    console.error("[DETALLE CC] No se pudo leer la deuda por ticket:", deudasRes.error);
  }

  return {
    movimientos: movimientosRes.data || [],
    ventas: ventasRes.data || [],
    reservas: reservasRes.data || [],
    // null = no se pudo leer (distinto de "no debe nada"): la pantalla no
    // muestra un desglose vacío como si estuviera al día.
    deudas: deudasRes.error
      ? null
      : ((deudasRes.data ?? []) as FilaDeudaViva[]).map(deudaVivaDesdeFila),
    pagosConRecibo: ((recibosRes.data ?? []) as { pago_id: string }[]).map(
      (r) => r.pago_id,
    ),
  };
}

/**
 * La deuda viva de un cliente por ticket, para el modal de cobro: le dice a la
 * cajera qué mes está cobrando. Un viaje, al elegir la clienta.
 */
export async function getDeudaPorTicketAction(
  clienteId: string,
): Promise<{ deudas: DeudaViva[] | null; error: string | null }> {
  if (!clienteId) return { deudas: null, error: "Cliente inválido." };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.rpc("cc_deudas_vivas_detalle", {
    p_cliente_id: clienteId,
  });

  if (error) {
    console.error("[COBRO CC] No se pudo leer la deuda por ticket:", error);
    return { deudas: null, error: "No se pudo leer el detalle de la deuda." };
  }

  return {
    deudas: ((data ?? []) as FilaDeudaViva[]).map(deudaVivaDesdeFila),
    error: null,
  };
}

/**
 * El recibo GUARDADO de un cobro, para reimprimirlo. Dice lo que dijo el día
 * del cobro, no lo que daría hoy la cuenta. Un cobro anterior al 1/10/2026 no
 * tiene recibo guardado.
 */
export async function obtenerReciboCobroCCAction(
  pagoId: string,
): Promise<{ recibo: ReciboCobroCC | null; error: string | null }> {
  if (!pagoId || !UUID_RE.test(pagoId)) {
    return { recibo: null, error: "Cobro inválido." };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.rpc("recibo_cobro_cc", {
    p_pago_id: pagoId,
  });

  if (error) {
    console.error("[RECIBO CC] No se pudo leer el recibo:", error);
    return { recibo: null, error: "No se pudo leer el recibo." };
  }
  if (!data) {
    return {
      recibo: null,
      error: "Este cobro es anterior al recibo detallado: no tiene recibo guardado.",
    };
  }

  return { recibo: reciboDesdeFila(data as FilaReciboCC), error: null };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResultadoCobroCC = {
  error: string | null;
  success: boolean;
  recibo?: ReciboCobroCC;
  /** El cobro con ese id ya estaba registrado: este intento no escribió nada. */
  yaRegistrado?: boolean;
  /** Monto base del cobro que ya estaba, para decírselo a la cajera. */
  montoYaRegistrado?: number;
};

// 3. REGISTRAR PAGO DE DEUDA
//
// Devuelve, además del éxito, el RECIBO del cobro con los números que quedaron
// escritos: es lo que se imprime. Sale de acá y no del modal porque la mora y
// el saldo anterior los conoce esta función, no el cliente.
export async function registrarPagoDeudaAction(
  prevState: ClientActionState | null,
  formData: FormData,
): Promise<ResultadoCobroCC> {
  const clienteId = formData.get("cliente_id") as string;
  const metodoPagoId = formData.get("metodo_pago_id") as string;
  const montoRaw = formData.get("monto") as string;
  const monto = Number(montoRaw);

  if (!clienteId || !metodoPagoId || isNaN(monto) || monto <= 0) {
    return { error: "Datos inválidos para registrar el pago.", success: false };
  }

  // Clave de idempotencia: el id del cobro lo genera el modal al abrirse y lo
  // repite en cada reintento, así que tocar Confirmar dos veces (o reintentar
  // tras un timeout) no registra dos cobros. Si no viene —un navegador con el
  // JS de antes del deploy— se genera acá: ese cobro no es idempotente, pero
  // el tope de la base igual frena el duplicado que salda de más.
  const pagoIdRaw = ((formData.get("pago_id") as string | null) ?? "").trim();
  const pagoId = UUID_RE.test(pagoIdRaw) ? pagoIdRaw : crypto.randomUUID();

  // Cobrar de más, o una seña sin deuda, deja saldo a favor
  // (20260928250000). Solo si quien cobra lo confirmó en la pantalla: sin
  // esto la base rechaza el excedente, que es el freno contra el cobro
  // duplicado y el monto mal tipeado.
  const permitirSaldoAFavor =
    formData.get("permitir_saldo_a_favor") === "true";

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autorizado.", success: false };

  // Permiso explícito, no ubicación del botón. Este cobro se dispara ahora
  // también desde el POS y desde el modal de caja: la protección que daba
  // "esto solo se ve entrando a /clientes" ya no existe, y un server action es
  // un endpoint. Fail-closed: ver `tienePermiso`.
  if (!(await tienePermiso(supabase, PERMISOS.CLIENTES_COBRAR_CC))) {
    return {
      error: "No tenés permiso para cobrar cuenta corriente.",
      success: false,
    };
  }

  // 🚀 A. Buscar si el usuario tiene una caja abierta donde meter la plata
  const { data: config } = await supabase
    .from("configuracion_pos")
    .select("modo_caja")
    .single();
  const modoCaja = config?.modo_caja || "UNICA";

  let query = supabase.from("turnos_caja").select("id").eq("estado", "ABIERTO");
  if (modoCaja === "UNICA") query = query.eq("modo", "UNICA");
  else query = query.eq("modo", "POR_USUARIO").eq("usuario_id", user.id);

  const { data: turno } = await query.maybeSingle();

  if (!turno) {
    return {
      error: "Caja cerrada. Debes abrir un turno para ingresar este dinero.",
      success: false,
    };
  }

  // B. Buscar el método de pago
  const { data: metodo } = await supabase
    .from("metodos_pago")
    .select("*")
    .eq("id", metodoPagoId)
    .single();

  if (!metodo)
    return { error: "Método de pago no encontrado.", success: false };

  // C. Recargo por método + comisión.
  //
  // `monto` es la BASE: lo que el cliente amortiza de su deuda. El recargo se
  // le suma encima (paga más, debe lo mismo de menos), así pagar fiado con
  // tarjeta no le sale más barato que haber pagado con tarjeta en el momento.
  // Se recalcula server-side desde metodos_pago, nunca desde el formulario —
  // mismo criterio que el recargo por mora de acá abajo y que los precios de
  // create-sale.ts.
  const recargoPorcentaje = Number(metodo.recargo_porcentaje || 0);
  const recargoMetodoMonto = calcularRecargoMonto(monto, recargoPorcentaje);
  const montoBruto = monto + recargoMetodoMonto;

  // La comisión del procesador se calcula sobre el bruto: es lo que pasa por
  // el posnet, recargo incluido.
  const comisionPorcentaje = Number(metodo.comision || 0);
  const comisionMonto = (montoBruto * comisionPorcentaje) / 100;
  const montoNeto = montoBruto - comisionMonto;

  // C-bis. Recargo por mora — recalculado server-side, nunca confiar en
  // lo que mande el cliente (mismo criterio que create-sale.ts con precios).
  //
  // La fuente es el SALDO DEL CLIENTE (`saldo_pendiente` +
  // `fecha_vencimiento_deuda`), no las ventas con saldo. Hasta acá esto
  // recorría `ventas`, y eso dejaba afuera toda la deuda que no nace de una
  // venta del POS: la importada por CSV y los ajustes manuales. En Evens eso
  // era 17 de los 18 clientes vencidos — la mora del 15% configurada
  // sencillamente no se cobraba. El caché del cliente ya lo mantiene esta
  // misma action en cada movimiento, y es la fuente que usa el resto de la
  // feature (getDeudaVencidaAction, la tabla y el detalle del cliente), así
  // que además desaparece la doble fuente de verdad.
  // La BASE del recargo es la porción VENCIDA, no el saldo entero: eso lo
  // resuelve `deuda_cc_vencida` en la base, imputando los pagos FIFO igual que
  // `recalcular_vencimiento_cc`. Ver el comentario de `monto_vencido`.
  const [{ data: configPos }, { data: clienteDeuda }, { data: deudaVencida }] =
    await Promise.all([
      supabase
        .from("configuracion_pos")
        // Los cuatro últimos son la cabecera del recibo que se imprime: van
        // en la misma consulta para no pagar otro viaje.
        .select(
          "recargo_mora_tipo, recargo_mora_valor, cc_plazo_mora, posName, direccion, whatsapp, ancho_ticket_mm",
        )
        .single(),
      supabase
        .from("clientes")
        .select("nombre, saldo_pendiente, fecha_vencimiento_deuda")
        .eq("id", clienteId)
        .single(),
      supabase.rpc("deuda_cc_vencida", { p_cliente_id: clienteId }).single(),
    ]);
  const recargoConfig: RecargoMoraConfig = {
    recargo_mora_tipo: configPos?.recargo_mora_tipo ?? "NINGUNO",
    recargo_mora_valor: configPos?.recargo_mora_valor ?? 0,
  };
  const { montoRecargo } = calcularSaldoConRecargo(
    {
      monto_pendiente: clienteDeuda?.saldo_pendiente,
      fecha_vencimiento: clienteDeuda?.fecha_vencimiento_deuda,
      // El cast es porque la función es nueva y todavía no está en los tipos
      // generados de Supabase, igual que `contexto_sesion` en su momento.
      monto_vencido: (deudaVencida as { vencido: number | null } | null)
        ?.vencido,
      // Los recargos anteriores impagos NO son base del próximo: sin esto el
      // segundo recargo se calcula sobre un saldo que ya contiene el primero,
      // que es interés compuesto y contradice lo que promete la pantalla de
      // Configuración. Ver `mora_previa`.
      mora_previa: (deudaVencida as { mora_viva: number | null } | null)
        ?.mora_viva,
    },
    recargoConfig,
  );

  // D. La escritura entera va en UNA transacción: `registrar_cobro_cc`
  // (20260928210000). Antes eran cuatro escrituras sueltas desde acá
  // (venta_pagos → mora → crédito → saldo), sin tope, sin idempotencia y con
  // el saldo calculado en Node a partir de una lectura previa. Así quedaron
  // los dos cobros duplicados de Evens del 21/7/2026.
  //
  // Lo que se sigue calculando acá (recargo por método, comisión, mora) viaja
  // ya resuelto: vive en TypeScript con sus tests y no se duplica en SQL. La
  // base pone el tope, contra el saldo releído bajo lock.
  //
  // El recargo por mora se MATERIALIZA como un DEBITO propio antes del
  // crédito: entra al capital y el pago se aplica sobre el total ya recargado
  // — el "recargo primero" de verdad. Va atado al cobro (`pago_id`), que lo
  // deja fuera del circuito de movimientos manuales (los que se editan/anulan
  // son los que NO tienen ni venta_id ni pago_id), y al ticket del que es
  // (`debito_origen_id`): capital y mora del mismo ticket se imputan como una
  // unidad. Se DECLARA acá —no se deduce después— porque este es el único
  // momento en que se sabe con certeza cuál era la deuda más vieja viva.
  const detalleMora =
    recargoConfig.recargo_mora_tipo === "PORCENTAJE"
      ? `${recargoConfig.recargo_mora_valor}% sobre la deuda vencida`
      : "monto fijo por deuda vencida";

  // El crédito va por la BASE, no por el bruto: el recargo por método es
  // plata del cobro, no capital amortizado.
  // Qué es este cobro para el libro: sin deuda es una seña; con deuda y de
  // más, un pago que deja saldo a favor. El número lo pone la base; esto es
  // solo la leyenda que ve la dueña (y la clienta en su resumen).
  const deudaAlCobrar = deudaDe(clienteDeuda?.saldo_pendiente) + montoRecargo;
  const concepto =
    deudaAlCobrar <= 0
      ? "Seña (saldo a favor)"
      : monto > deudaAlCobrar + 0.005
        ? `Pago a cuenta (deja $${(monto - deudaAlCobrar).toLocaleString("es-AR", { maximumFractionDigits: 2 })} a favor)`
        : "Pago a cuenta";
  const descripcionPago =
    recargoMetodoMonto > 0
      ? `${concepto} - ${metodo.nombre} (incluye $${recargoMetodoMonto.toLocaleString("es-AR")} de recargo por ${metodo.nombre})`
      : `${concepto} - ${metodo.nombre}`;

  const { data: resultadoCobro, error: errorCobro } = await supabase.rpc(
    "registrar_cobro_cc",
    {
      p_pago: {
        id: pagoId,
        cliente_id: clienteId,
        turno_caja_id: turno.id,
        metodo_pago_id: metodo.id,
        metodo_nombre: metodo.nombre,
        metodo_tipo: metodo.tipo,
        monto_base: monto,
        recargo_porcentaje: recargoPorcentaje,
        recargo_monto: recargoMetodoMonto,
        monto_bruto: montoBruto,
        comision_porcentaje: comisionPorcentaje,
        comision_monto: comisionMonto,
        monto_neto: montoNeto,
        acreditacion_dias: metodo.acreditacion_dias,
        descripcion_cc: descripcionPago,
        permitir_saldo_a_favor: permitirSaldoAFavor,
      },
      p_mora:
        montoRecargo > 0
          ? {
              monto: montoRecargo,
              descripcion: `Recargo por mora (${detalleMora})`,
              debito_origen_id:
                (
                  deudaVencida as {
                    debito_capital_mas_antiguo_id: string | null;
                  } | null
                )?.debito_capital_mas_antiguo_id ?? null,
            }
          : null,
    },
  );

  if (errorCobro || !resultadoCobro) {
    const superaDeuda = mensajeCobroSuperaDeuda(errorCobro);
    if (superaDeuda) return { error: superaDeuda, success: false };

    // Nada quedó escrito: la transacción entera se deshizo.
    console.error("[PAGO DEUDA] No se pudo registrar el cobro:", errorCobro);
    return { error: "No se pudo registrar el cobro.", success: false };
  }

  const cobro = resultadoCobro as
    | {
        ya_registrado: true;
        pago_id: string;
        monto_base: number;
        saldo_actual: number;
      }
    | {
        ya_registrado: false;
        pago_id: string;
        monto_base: number;
        saldo_anterior: number;
        saldo_nuevo: number;
        fecha_vencimiento: string | null;
        /** Desde 20261001120000: el recibo guardado, con qué canceló. */
        recibo?: FilaReciboCC | null;
      };

  revalidatePath("/clientes");
  revalidatePath("/caja");

  // Reintento de un cobro que YA entró (se perdió la respuesta, o se volvió a
  // tocar Confirmar): no se escribió nada. Se devuelve el recibo GUARDADO del
  // primer intento —los números de ese papel son los de entonces—, así la
  // cajera igual tiene qué imprimir.
  if (cobro.ya_registrado) {
    const { data: guardado } = await supabase.rpc("recibo_cobro_cc", {
      p_pago_id: cobro.pago_id,
    });
    return {
      error: null,
      success: true,
      yaRegistrado: true,
      montoYaRegistrado: Number(cobro.monto_base),
      recibo: guardado ? reciboDesdeFila(guardado as FilaReciboCC) : undefined,
    };
  }

  // El recibo sale de lo que la base GUARDÓ en la misma transacción del cobro
  // (`registrar_recibo_cobro_cc`): qué tickets canceló y qué quedó por mes.
  if (cobro.recibo) {
    return { error: null, success: true, recibo: reciboDesdeFila(cobro.recibo) };
  }

  // Sin recibo guardado solo puede ser una base sin la migración
  // 20261001120000: se arma el papel de antes, sin el detalle por ticket.
  const recibo: ReciboCobroCC = {
    pagoId: cobro.pago_id,
    fecha: new Date().toISOString(),
    clienteNombre: clienteDeuda?.nombre ?? "",
    metodoNombre: metodo.nombre,
    montoBase: monto,
    recargoMetodoPorcentaje: recargoPorcentaje,
    recargoMetodoMonto: recargoMetodoMonto,
    montoBruto,
    moraMonto: montoRecargo,
    // Los dos saldos los devuelve la base: el anterior es el que leyó bajo
    // lock, ANTES de sumarle la mora de este cobro, o sea lo que la clienta
    // debía al entrar.
    saldoAnterior: Number(cobro.saldo_anterior),
    saldoNuevo: Number(cobro.saldo_nuevo),
    fechaVencimiento: cobro.fecha_vencimiento,
    imputaciones: [],
    pendientes: [],
    comercio: {
      nombre: configPos?.posName ?? null,
      direccion: configPos?.direccion ?? null,
      whatsapp: configPos?.whatsapp ?? null,
      anchoTicketMm: configPos?.ancho_ticket_mm ?? null,
    },
  };

  return { error: null, success: true, recibo };
}

// 4. CREAR CLIENTE NUEVO
export async function crearClienteAction(
  prevState: ClientActionState | null,
  formData: FormData,
): Promise<CrearClienteState> {
  // Datos comerciales básicos
  const nombre = formData.get("nombre") as string;
  const telefono = formData.get("whatsapp") as string;
  const email = formData.get("email") as string;
  const dni = formData.get("dni") as string;
  const notas = formData.get("notas") as string;
  // Dirección de contacto/entrega: existe para cualquier cliente, tenga o no
  // datos fiscales. Es distinta del domicilio fiscal, que va en la factura.
  const direccionComercial =
    ((formData.get("direccion_comercial") as string | null) ?? "").trim() ||
    null;

  // Datos operativos
  const fechaVencimientoDeuda =
    (formData.get("fecha_vencimiento_deuda") as string) || null;
  const exceptuadoEntregaMinima =
    formData.get("exceptuado_entrega_minima") === "on";

  if (!nombre || !telefono) {
    return {
      error: "El nombre y el teléfono son obligatorios.",
      success: false,
    };
  }

  const fiscal = resolverDatosFiscales(formData);
  if (fiscal.error) {
    return { error: fiscal.error, success: false };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: cliente, error } = await supabase
    .from("clientes")
    .insert({
      nombre,
      telefono,
      email: email || null,
      dni: dni || null,
      notas: notas || null,
      direccion_comercial: direccionComercial,
      activo: true,
      exceptuado_entrega_minima: exceptuadoEntregaMinima,
      fecha_vencimiento_deuda: fechaVencimientoDeuda,
      ...fiscal.datos,
    })
    // El POS necesita el cliente recién creado para dejarlo seleccionado en el
    // ticket sin volver a consultar la lista entera.
    .select(
      "id, nombre, telefono, exceptuado_entrega_minima, lista_precio_id, condicion_iva",
    )
    .single();

  if (error || !cliente) {
    console.error("Error creando cliente:", error);
    // 23505 = DNI/CUIT repetido. El resto se resume: el detalle queda en el log.
    if (error?.code === "23505") {
      return {
        error: "Ya existe un cliente con ese DNI o CUIT.",
        success: false,
      };
    }
    return { error: "No se pudo crear el cliente.", success: false };
  }

  revalidatePath("/clientes");
  return { error: null, success: true, cliente: cliente as ClienteCreado };
}

// 5. EDITAR CLIENTE
export async function editClienteAction(clienteId: string, formData: FormData) {
  // Datos comerciales básicos
  const nombre = formData.get("nombre") as string;
  const telefono =
    (formData.get("telefono") as string | null) ||
    (formData.get("whatsapp") as string | null) ||
    "";
  const dni = formData.get("dni") as string;
  const email = formData.get("email") as string;
  const notas = formData.get("notas") as string;
  const direccionComercial =
    ((formData.get("direccion_comercial") as string | null) ?? "").trim() ||
    null;

  // Datos operativos
  const fechaVencimientoDeuda =
    (formData.get("fecha_vencimiento_deuda") as string) || null;
  const exceptuadoEditable =
    formData.get("exceptuado_entrega_minima_editable") === "1";
  // Mismo patrón centinela que `exceptuado_entrega_minima` y que el bloque
  // fiscal: el campo solo viaja desde la pantalla que lo dibuja. Sin esto,
  // guardar el cliente desde un formulario que no tiene el selector le
  // borraría la lista asignada sin avisar.
  const listaEditable = formData.get("lista_precio_editable") === "1";

  if (!nombre || !clienteId) {
    return { error: "El nombre es obligatorio.", success: false };
  }

  const fiscal = resolverDatosFiscales(formData);
  if (fiscal.error) {
    return { error: fiscal.error, success: false };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const updatePayload: Record<string, unknown> = {
    nombre,
    telefono,
    dni: dni || null,
    email: email || null,
    notas: notas || null,
    direccion_comercial: direccionComercial,
    fecha_vencimiento_deuda: fechaVencimientoDeuda,
    ...fiscal.datos,
  };

  if (exceptuadoEditable) {
    updatePayload.exceptuado_entrega_minima =
      formData.get("exceptuado_entrega_minima") === "on";
  }

  if (listaEditable) {
    // "" es la opción "Precio base", que en la base es NULL. No existe una
    // fila "Minorista" a la que apuntar.
    const listaPrecioId =
      ((formData.get("lista_precio_id") as string | null) ?? "").trim() || null;
    updatePayload.lista_precio_id = listaPrecioId;
  }

  const { data: actualizados, error } = await supabase
    .from("clientes")
    .update(updatePayload)
    .eq("id", clienteId)
    // Sin `.select()` no se distingue "guardado" de "la RLS lo filtró":
    // PostgREST devuelve 0 filas y `error: null`, y la pantalla diría
    // "Cliente actualizado" sin haber escrito nada. Es lo que costó las 35
    // fotos del 5/9/2026.
    .select("id");

  if (error) {
    console.error("Error actualizando cliente:", error);
    // 23505 = choque con clientes_negocio_cuit_unico_idx / _dni_unico_idx.
    // El alta ya lo traducía; la edición no, y desde que los índices existen
    // también puede chocar (editar un cliente para ponerle el CUIT de otro).
    if (error.code === "23505") {
      return {
        error: "Ya existe otro cliente con ese DNI o CUIT.",
        success: false,
      };
    }
    return { error: "Error al actualizar el cliente.", success: false };
  }

  if (!actualizados || actualizados.length === 0) {
    return {
      error: "No se guardó: ese cliente no existe o no lo podés editar.",
      success: false,
    };
  }

  revalidatePath("/clientes");
  return { error: null, success: true };
}

// 6. AJUSTE MANUAL DE SALDO / DEUDA INICIAL (múltiples entradas históricas)
export interface EntradaSaldoInicial {
  fecha: string; // "YYYY-MM-DD"
  monto: number;
  nota?: string;
}

function formatearFechaCorta(fechaIso: string): string {
  const [anio, mes, dia] = fechaIso.split("-");
  return `${dia}/${mes}/${anio}`;
}

/** "YYYY-MM-DD" de hoy en hora local — mismo criterio que el resto de la
 * validación de fechas de deuda (columnas `date`, sin componente horario). */
function fechaHoyIso(): string {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

export async function ajustarSaldoAction(
  clienteId: string,
  entradas: EntradaSaldoInicial[],
) {
  if (!clienteId || !Array.isArray(entradas) || entradas.length === 0) {
    return { error: "Cargá al menos una fecha con su monto.", success: false };
  }

  // Validación server-side de cada entrada — nunca confiar en los montos ni
  // las fechas que manda el cliente, mismo criterio que create-sale.ts.
  const hoyIso = fechaHoyIso();
  const entradasValidas: { fecha: string; monto: number; nota: string }[] = [];

  for (const entrada of entradas) {
    const monto = Number(entrada.monto);
    const fecha = String(entrada.fecha || "");

    if (isNaN(monto) || monto <= 0) {
      return {
        error: "Hay un monto inválido en la lista de fechas.",
        success: false,
      };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return {
        error: "Hay una fecha inválida en la lista.",
        success: false,
      };
    }
    if (fecha > hoyIso) {
      return {
        error: "No se pueden cargar fechas futuras.",
        success: false,
      };
    }

    entradasValidas.push({ fecha, monto, nota: (entrada.nota || "").trim() });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const montoTotal = entradasValidas.reduce((acc, e) => acc + e.monto, 0);

  // 1. Un movimiento en el Ledger POR ENTRADA — no uno fusionado — para que
  // el historial refleje el desglose por fecha que cargó la dueña, cada
  // uno con su propia nota y su fecha_origen real (creado_en sigue siendo
  // "cuándo se registró en el sistema", no se falsifica).
  const movimientos = entradasValidas.map((entrada) => ({
    cliente_id: clienteId,
    tipo: "DEBITO" as const,
    monto: entrada.monto,
    fecha_origen: entrada.fecha,
    descripcion: entrada.nota
      ? `Saldo inicial (deuda del ${formatearFechaCorta(entrada.fecha)}): ${entrada.nota}`
      : `Saldo inicial (deuda del ${formatearFechaCorta(entrada.fecha)})`,
    creado_por: user?.id,
  }));

  const { error: ccError } = await supabase
    .from("cuenta_corriente_movimientos")
    .insert(movimientos);

  if (ccError) {
    // 23514 = tope de clientes con cuenta corriente del plan. Lo tira
    // `trg_limite_cc_manual` al insertar el DÉBITO (no al tocar el cliente, que
    // es donde se lo buscaba antes). El mensaje ya viene redactado para el
    // comerciante: se pasa tal cual.
    if (ccError.code === "23514") {
      return { error: ccError.message, success: false };
    }
    return { error: "Error al registrar los movimientos.", success: false };
  }

  // 2. Saldo y vencimiento del cliente, con delta: los movimientos ya están
  // escritos, así que el vencimiento los ve.
  const { error: errorSaldo } = await ajustarSaldoCliente(
    supabase,
    clienteId,
    montoTotal,
  );

  if (errorSaldo) {
    return {
      error:
        "Los movimientos quedaron registrados pero no se pudo actualizar el saldo. Revisá la cuenta del cliente.",
      success: false,
    };
  }

  revalidatePath("/clientes");
  return { error: null, success: true };
}

// 7. IMPORTACIÓN MASIVA DESDE CSV
export async function importarClientesCSVAction(formData: FormData) {
  try {
    const csvText = formData.get("csv_text") as string;
    let text = "";

    // Obtenemos el texto seguro desde la UI
    if (csvText) {
      text = csvText;
    } else {
      const file = formData.get("file") as File;
      if (!file || file.size === 0)
        return { error: "No se subió ningún archivo.", success: false };
      text = await file.text();
    }

    const parsed = parseClientesCSV(text);
    if (parsed.error) {
      return { error: parsed.error, success: false };
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let importados = 0;
    // Los que entraron pero sin su deuda inicial, por el tope del plan.
    let importadosSinDeuda = 0;

    // La planilla trae la fecha de VENCIMIENTO y el libro guarda la fecha en
    // que la deuda NACIÓ, así que hay que restarle el plazo. Sin esto el
    // movimiento quedaba con fecha_origen null y para el libro la deuda nacía
    // el día del import: una clienta atrasada desde marzo aparecía venciendo
    // recién 35 días después de la importación (ver 20260828140000).
    const { data: configPlazo } = await supabase
      .from("configuracion_pos")
      .select("cc_plazo_mora")
      .single();
    const plazoMoraImport = configPlazo?.cc_plazo_mora ?? 30;

    for (const candidato of parsed.clientes) {
      const { nombre, telefono, dni, deudaInicial, fechaVencimientoDeuda } =
        candidato;

      // Insertamos el cliente
      let { data: nuevoCliente, error: errCli } = await supabase
        .from("clientes")
        .insert({
          nombre,
          telefono,
          dni: dni || null,
          saldo_pendiente: deudaInicial > 0 ? deudaInicial : 0,
          activo: true,
          fecha_vencimiento_deuda: fechaVencimientoDeuda,
        })
        .select("id")
        .single();

      // 23514 = se llegó al tope de cuenta corriente del plan. El cliente
      // igual entra, pero sin la deuda inicial: perder el contacto entero por
      // un límite de facturación sería peor que importarlo en cero.
      if (errCli?.code === "23514" && deudaInicial > 0) {
        console.warn(
          `[IMPORTAR CLIENTES] "${nombre}" se importa sin su deuda inicial: ${errCli.message}`,
        );
        ({ data: nuevoCliente, error: errCli } = await supabase
          .from("clientes")
          .insert({
            nombre,
            telefono,
            dni: dni || null,
            saldo_pendiente: 0,
            activo: true,
          })
          .select("id")
          .single());

        if (!errCli) {
          importadosSinDeuda++;
          continue;
        }
      }

      if (errCli) {
        console.error(`Error insertando cliente ${nombre}:`, errCli.message);
        continue;
      }

      // Si el cliente se creó bien y traía deuda, le anotamos el registro en su cuenta corriente
      if (nuevoCliente && deudaInicial > 0) {
        const { error: errCc } = await supabase
          .from("cuenta_corriente_movimientos")
          .insert({
            cliente_id: nuevoCliente.id,
            tipo: "DEBITO",
            monto: deudaInicial,
            fecha_origen: fechaVencimientoDeuda
              ? calcularFechaVencimiento(
                  fechaVencimientoDeuda,
                  -plazoMoraImport,
                )
              : null,
            descripcion: "Saldo inicial importado (CSV)",
            creado_por: user?.id,
          });
        if (errCc) {
          console.error(`Error creando Ledger para ${nombre}:`, errCc.message);
        }
      }

      importados++;
    }

    revalidatePath("/clientes");

    if (importados === 0 && parsed.totalFilas > 0) {
      const debug = parsed.debug;
      console.error(
        `[importarClientesCSVAction] 0 importados. separator=${JSON.stringify(debug?.separator)} idxNombre=${debug?.idxNombre} headers=${JSON.stringify(debug?.headers)} primeras líneas crudas: ${debug?.headerPreview}`,
      );
      return {
        error: `No se importó ningún cliente. Revisa el registro de errores en la consola (ej. DNI duplicados o campos faltantes). Separador detectado: ${JSON.stringify(debug?.separator)}. Primeras líneas: ${debug?.headerPreview}`,
        success: false,
        count: 0,
      };
    }

    return {
      error: null,
      success: true,
      count: importados + importadosSinDeuda,
      sinDeuda: importadosSinDeuda,
    };
  } catch (error) {
    console.error("Error importando CSV:", error);
    return { error: "Error procesando el archivo CSV.", success: false };
  }
}

// 8. EDITAR / ANULAR MOVIMIENTO MANUAL DE CUENTA CORRIENTE (saldo inicial /
// ajuste manual, sea cargado a mano o por CSV — ambos insertan sin
// venta_id ni pago_id). Movimientos generados por una venta o un cobro NO
// pasan por acá — ese es el discriminador, y ambas actions lo verifican
// server-side además de la UI, por si algún día alguien llama esto directo.

async function esUsuarioAdmin(
  supabase: ReturnType<typeof createClient>,
): Promise<{ esAdmin: boolean; userId: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { esAdmin: false, userId: null };

  // is_admin() ya resuelve el rol dentro del negocio activo.
  const { data: esAdmin } = await supabase.rpc("is_admin");

  return { esAdmin: esAdmin === true, userId: user.id };
}

/**
 * Mueve el saldo del cliente por DELTA y recalcula su vencimiento, en un solo
 * statement (`ajustar_saldo_cliente`, 20260928230000). Se llama DESPUÉS de
 * escribir el movimiento del libro: el vencimiento lo tiene que ver.
 *
 * Reemplaza a "leer el saldo, sumarle en Node y escribirlo", que perdía un
 * cobro concurrente, y al `Math.max(0, ...)` que venía con eso: con saldo a
 * favor (saldo negativo) recortar a cero le borra la plata a la clienta.
 *
 * El vencimiento sale de la ÚNICA regla que hay, `recalcular_vencimiento_cc`
 * (el porqué, en 20260828130000): la imputación FIFO y el piso por mora ya
 * cobrada viven adentro de esa función, no acá.
 */
async function ajustarSaldoCliente(
  supabase: ReturnType<typeof createClient>,
  clienteId: string,
  delta: number,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("ajustar_saldo_cliente", {
    p_cliente_id: clienteId,
    p_delta: delta,
  });

  if (error) {
    console.error("[SALDO CC] No se pudo ajustar el saldo:", error);
    return { error: error.message };
  }

  return { error: null };
}

export async function editarMovimientoManualAction(
  movimientoId: string,
  datos: { fecha: string; monto: number; nota?: string },
) {
  if (!movimientoId) {
    return { error: "Movimiento inválido.", success: false };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { esAdmin } = await esUsuarioAdmin(supabase);
  if (!esAdmin) {
    return {
      error: "Solo un administrador puede editar movimientos.",
      success: false,
    };
  }

  // Validación server-side — misma regla que la carga original, nunca
  // confiar en lo que manda el cliente.
  const monto = Number(datos.monto);
  const fecha = String(datos.fecha || "");
  if (isNaN(monto) || monto <= 0) {
    return { error: "El monto tiene que ser mayor a $0.", success: false };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { error: "Fecha inválida.", success: false };
  }
  if (fecha > fechaHoyIso()) {
    return { error: "No se pueden cargar fechas futuras.", success: false };
  }

  const { data: movimiento } = await supabase
    .from("cuenta_corriente_movimientos")
    .select("id, cliente_id, venta_id, pago_id, tipo, monto, anulado")
    .eq("id", movimientoId)
    .single();

  if (!movimiento) {
    return { error: "Movimiento no encontrado.", success: false };
  }
  if (movimiento.venta_id || movimiento.pago_id) {
    return {
      error:
        "Este movimiento viene de una venta o un cobro y no se puede editar acá.",
      success: false,
    };
  }
  if (movimiento.anulado) {
    return { error: "Este movimiento está anulado.", success: false };
  }

  const nota = (datos.nota || "").trim();
  const descripcion = nota
    ? `Saldo inicial (deuda del ${formatearFechaCorta(fecha)}): ${nota}`
    : `Saldo inicial (deuda del ${formatearFechaCorta(fecha)})`;

  const { error: updateError } = await supabase
    .from("cuenta_corriente_movimientos")
    .update({ monto, fecha_origen: fecha, descripcion })
    .eq("id", movimientoId);

  if (updateError) {
    return { error: "No se pudo actualizar el movimiento.", success: false };
  }

  // Delta sobre el saldo — nunca se reescribe el total a mano, para no
  // perder de vista otros movimientos concurrentes.
  const montoAnterior = Number(movimiento.monto);
  const signo = movimiento.tipo === "DEBITO" ? 1 : -1;
  const delta = signo * (monto - montoAnterior);

  const { error: errorSaldo } = await ajustarSaldoCliente(
    supabase,
    movimiento.cliente_id,
    delta,
  );
  if (errorSaldo) {
    return {
      error:
        "El movimiento se corrigió pero no se pudo actualizar el saldo. Revisá la cuenta del cliente.",
      success: false,
    };
  }

  revalidatePath("/clientes");
  return { error: null, success: true };
}

export async function anularMovimientoManualAction(movimientoId: string) {
  if (!movimientoId) {
    return { error: "Movimiento inválido.", success: false };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { esAdmin, userId } = await esUsuarioAdmin(supabase);
  if (!esAdmin) {
    return {
      error: "Solo un administrador puede anular movimientos.",
      success: false,
    };
  }

  const { data: movimiento } = await supabase
    .from("cuenta_corriente_movimientos")
    .select("id, cliente_id, venta_id, pago_id, tipo, monto, anulado")
    .eq("id", movimientoId)
    .single();

  if (!movimiento) {
    return { error: "Movimiento no encontrado.", success: false };
  }
  if (movimiento.venta_id || movimiento.pago_id) {
    return {
      error:
        "Este movimiento viene de una venta o un cobro y no se puede anular acá.",
      success: false,
    };
  }
  if (movimiento.anulado) {
    return { error: "Este movimiento ya está anulado.", success: false };
  }

  const { error: updateError } = await supabase
    .from("cuenta_corriente_movimientos")
    .update({
      anulado: true,
      anulado_en: new Date().toISOString(),
      anulado_por: userId,
    })
    .eq("id", movimientoId);

  if (updateError) {
    return { error: "No se pudo anular el movimiento.", success: false };
  }

  // Reversa del saldo — un DEBITO anulado resta, un CREDITO anulado suma
  // (hoy solo existen DEBITO en este flujo, pero se mantiene genérico).
  const signo = movimiento.tipo === "DEBITO" ? -1 : 1;
  const delta = signo * Number(movimiento.monto);

  const { error: errorSaldo } = await ajustarSaldoCliente(
    supabase,
    movimiento.cliente_id,
    delta,
  );
  if (errorSaldo) {
    return {
      error:
        "El movimiento quedó anulado pero no se pudo actualizar el saldo. Revisá la cuenta del cliente.",
      success: false,
    };
  }

  revalidatePath("/clientes");
  return { error: null, success: true };
}

/**
 * Perdona (total o parcialmente) la deuda de un cliente.
 *
 * Existe porque no había forma de bajar un saldo sin mentir. Las tres
 * herramientas que había:
 *   - "Cargar saldo inicial" solo escribe DÉBITOS: suma deuda, nunca la baja.
 *   - Anular movimiento rechaza todo lo que tenga `venta_id` o `pago_id`, y el
 *     recargo por mora tiene `pago_id` porque nace junto al cobro.
 *   - Registrar un pago sí bajaría el saldo, pero mete en la caja plata que
 *     nunca entró: rompe el arqueo del turno y ensucia las señales de dinero.
 *
 * El caso real que lo motivó: una clienta de Evens había pagado $1.450 MÁS que
 * la mercadería, y lo único que le quedaba vivo era el 15% de recargo por mora
 * que el sistema le había cobrado sola al registrar un pago atrasado. Perdonar
 * esa multa es una decisión del comercio que se toma seguido.
 *
 * Escribe un CRÉDITO en el libro y RECIÉN DESPUÉS baja el saldo. El orden
 * importa: poner la columna en cero sin el movimiento deja un libro que sigue
 * sumando la deuda vieja, y el cliente aparece en la señal de "cuenta corriente
 * sin cuadrar" de Comerz Insights, que cuenta exactamente esa diferencia.
 *
 * NO toca caja, a propósito: no entró plata. Es una deuda que se deja de
 * reclamar, no un cobro.
 */
export async function perdonarDeudaAction(
  clienteId: string,
  datos: { monto: number; motivo: string },
) {
  if (!clienteId) {
    return { error: "Cliente inválido.", success: false };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // Mismo criterio que anular y editar movimientos: mover plata que no entró
  // es decisión de quien responde por la caja.
  const { esAdmin, userId } = await esUsuarioAdmin(supabase);
  if (!esAdmin) {
    return {
      error: "Solo un administrador puede perdonar una deuda.",
      success: false,
    };
  }

  // El saldo se lee del server, nunca del cliente: el monto que llega del
  // navegador se valida contra la deuda REAL, mismo criterio que create-sale.
  const { data: cliente } = await supabase
    .from("clientes")
    .select("saldo_pendiente")
    .eq("id", clienteId)
    .single();

  if (!cliente) {
    return { error: "Cliente no encontrado.", success: false };
  }

  const validacion = validarPerdonDeuda(
    datos,
    Number(cliente.saldo_pendiente || 0),
  );
  if (!validacion.ok) {
    return { error: validacion.error, success: false };
  }

  const { monto, motivo } = validacion;

  const { error: errorMovimiento } = await supabase
    .from("cuenta_corriente_movimientos")
    .insert({
      cliente_id: clienteId,
      tipo: "CREDITO" as const,
      monto,
      fecha_origen: fechaHoyIso(),
      descripcion: `Deuda perdonada: ${motivo}`,
      creado_por: userId,
    });

  if (errorMovimiento) {
    console.error(
      "[PERDONAR DEUDA] Error al escribir el movimiento",
      errorMovimiento,
    );
    return {
      error: "No se pudo registrar el perdón de deuda.",
      success: false,
    };
  }

  // Con delta, no con el `saldoFinal` que calculó la validación: ese sale de
  // una lectura previa y pisaría un cobro que entre en el medio. Perdonar puede
  // dejar sin deuda viva a la más antigua; el vencimiento lo recalcula la
  // misma función (null si no quedó nada que pueda vencer).
  const { error: errorSaldo } = await ajustarSaldoCliente(
    supabase,
    clienteId,
    -monto,
  );

  if (errorSaldo) {
    // El movimiento ya está escrito: si el saldo no baja, el libro y la columna
    // quedan distintos. Se avisa fuerte en vez de devolver un éxito falso.
    console.error(
      "[PERDONAR DEUDA] Movimiento escrito pero saldo NO actualizado",
      errorSaldo,
    );
    return {
      error:
        "Se registró el movimiento pero no se pudo actualizar el saldo. Revisá la cuenta del cliente.",
      success: false,
    };
  }

  revalidatePath("/clientes");
  return { error: null, success: true };
}

/**
 * El link público del resumen de cuenta de un cliente, generando el token la
 * primera vez.
 *
 * El token es la credencial de una página sin login, así que es de 32
 * caracteres hexadecimales (un UUID v4 sin guiones, 122 bits): no se adivina a
 * fuerza bruta y no es secuencial, o sea que tener un link no permite pasar al
 * cliente de al lado.
 *
 * Se genera perezosamente —recién cuando la dueña comparte— para no dejar 168
 * links vivos por un comercio que nunca los usó. Y no caduca: la página lee el
 * saldo ACTUAL, así que si la clienta paga y vuelve a abrir el link viejo ve
 * que está al día, en vez de una foto congelada que la contradice. Para cortar
 * el acceso se reemplaza el token.
 */
export async function obtenerLinkResumenAction(clienteId: string) {
  if (!clienteId) {
    return { url: null, error: "Cliente inválido." };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: cliente, error } = await supabase
    .from("clientes")
    .select("resumen_token")
    .eq("id", clienteId)
    .single();

  if (error || !cliente) {
    return { url: null, error: "No se encontró el cliente." };
  }

  let token = cliente.resumen_token as string | null;

  if (!token) {
    token = crypto.randomUUID().replace(/-/g, "");
    const { error: errorToken } = await supabase
      .from("clientes")
      .update({ resumen_token: token })
      .eq("id", clienteId);

    if (errorToken) {
      console.error("[LINK RESUMEN] No se pudo generar el token", errorToken);
      return { url: null, error: "No se pudo generar el link." };
    }
  }

  return { url: urlDeResumen(token), error: null };
}
