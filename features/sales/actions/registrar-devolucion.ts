"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { resolverTurnoActivo } from "@/entities/caja/lib/resolve-turno-activo";
import { normalizarMotivoAnulacion } from "@/features/sales/lib/motivo-anulacion";

/**
 * Devolver renglones sueltos de una venta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL CORTE ENTRE LO QUE VA ADENTRO DE LA TRANSACCIÓN Y LO QUE NO
 *
 * Es el mismo de `registrar_venta` y `anular_venta`, y conviene entenderlo
 * antes de tocar esto. Adentro de la RPC va toda la PLATA y el registro:
 * `cantidad_devuelta`, la devolución, el recargo prorrateado, el
 * `monto_devuelto` de la venta y el egreso de caja. Afuera queda el STOCK.
 *
 * No es una omisión: el ajuste de stock ya es atómico por su cuenta y falla
 * por un motivo distinto (una variante que no existe). Si pudiera voltear la
 * devolución, un renglón sin variante resoluble —quedan 116 en los seis
 * comercios— dejaría a la vendedora reintentando una devolución cuya plata ya
 * salió del cajón. Lo que no se pudo devolver al inventario vuelve como aviso,
 * igual que en la anulación.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface LineaDevolucion {
  ventaItemId: string;
  cantidad: number;
  destino: "STOCK" | "BAJA";
}

export interface ResultadoDevolucion {
  /** Base + recargo de CC perdonado. El recargo por método nunca entra. */
  montoDevuelto: number;
  baseDevuelta: number;
  /** Recargo de cuenta corriente que se le perdonó al cliente. */
  recargoCcPerdonado: number;
  /** Recargo por método que NO se devuelve, para poder decirlo. */
  recargoNoDevuelto: number;
  esCuentaCorriente: boolean;
  /** Cuánto bajó efectivamente la deuda. */
  creditoCc: number;
  metodoNombre: string | null;
  saleDeCaja: boolean;
  ventaTotalmenteDevuelta: boolean;
  /** Lo que hay que resolver a mano. Ninguno es un error de la devolución. */
  avisos: string[];
}

/** Los códigos de la RPC, traducidos a algo que se pueda leer en el mostrador.
 * Los tres primeros no son fallas: son casos fuera de alcance que todavía se
 * resuelven anulando, y el mensaje lo dice. */
const MENSAJES: Record<string, string> = {
  SIN_PERMISO: "No tenés permiso para registrar devoluciones.",
  SIN_RENGLONES: "Elegí al menos un renglón para devolver.",
  VENTA_INEXISTENTE: "No se encontró la venta.",
  VENTA_AJENA:
    "Esta venta la cargó otra persona: solo puede devolverla ella o una administradora.",
  VENTA_NO_DEVOLVIBLE: "La venta está anulada.",
  VENTA_CC_SIN_CLIENTE:
    "Esta venta quedó con deuda pero no tiene cliente asignado, así que no hay cuenta a la que acreditarle la devolución.",
  VENTA_CON_PAGO_MIXTO:
    "Esta venta se cobró con más de un método y no se puede saber de cuál sale la devolución. Por ahora hay que anularla entera.",
  METODO_NO_DEVOLVIBLE:
    "Por ahora solo se devuelven ventas cobradas en efectivo o por transferencia. Para las demás hay que anular la venta entera.",
  DEVOLUCION_EXCEDE_LO_VENDIDO:
    "Estás devolviendo más unidades de las que quedan por devolver en esta venta. Actualizá la pantalla y volvé a intentar.",
  CANTIDAD_INVALIDA: "Alguna cantidad no es válida.",
  DESTINO_INVALIDO: "El destino de la mercadería no es válido.",
  SIN_NEGOCIO_ACTIVO: "No hay un comercio activo en esta sesión.",
};

export async function registrarDevolucionAction(
  ventaId: string,
  lineas: LineaDevolucion[],
  motivoCodigo?: string | null,
  motivoDetalle?: string | null,
  /** Por qué medio se le devuelve la plata. null = por el del cobro, que es
   * lo único que puede quien no tiene `ventas.elegir_medio_devolucion`. */
  reintegroMetodoId?: string | null,
): Promise<{ data: ResultadoDevolucion | null; error: string | null }> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { data: null, error: "No autorizado.", };

    // El turno se resuelve ANTES de mutar nada, igual que en la anulación: si
    // la política del comercio exige caja abierta y no la hay, la devolución no
    // puede quedar a medias. La plata en efectivo sale de la caja de HOY, no de
    // la del día de la venta, que puede estar cerrada hace semanas.
    const { turnoId, requiereCajaAbierta } = await resolverTurnoActivo(
      supabase,
      user.id,
    );
    if (requiereCajaAbierta && !turnoId) {
      return {
        data: null,
        error: "Necesitás abrir la caja antes de registrar una devolución.",
      };
    }

    const { data, error } = await supabase.rpc("registrar_devolucion", {
      p_venta_id: ventaId,
      p_lineas: lineas.map((linea) => ({
        venta_item_id: linea.ventaItemId,
        cantidad: linea.cantidad,
        destino: linea.destino,
      })),
      p_motivo_codigo: normalizarMotivoAnulacion(motivoCodigo),
      p_motivo_detalle: motivoDetalle?.trim() || null,
      p_turno_id: turnoId,
      p_reintegro_metodo_id: reintegroMetodoId || null,
    });

    if (error || !data) {
      const codigo = Object.keys(MENSAJES).find((clave) =>
        error?.message?.includes(clave),
      );
      console.error("[DEVOLUCION] No se pudo registrar:", { ventaId, error });
      return {
        data: null,
        error: codigo
          ? MENSAJES[codigo]
          : "No se pudo registrar la devolución.",
      };
    }

    const resultado = data as {
      devolucion_id: string;
      es_cuenta_corriente: boolean;
      base_devuelta: number;
      recargo_cc_perdonado: number;
      recargo_no_devuelto: number;
      monto_devuelto: number;
      credito_cc: number;
      excedente_a_devolver: number;
      metodo_tipo: string;
      metodo_nombre: string | null;
      /** El medio ELEGIDO. Distinto de `metodo_tipo`, que dice con qué se
       * había cobrado. null cuando nadie eligió. */
      reintegro_metodo_tipo: string | null;
      reintegro_metodo_nombre: string | null;
      sale_de_caja: boolean;
      venta_totalmente_devuelta: boolean;
    };

    const avisos = await moverStock(
      supabase,
      resultado.devolucion_id,
      ventaId,
      user.id,
    );

    const pesos = (monto: number) =>
      `$${Math.round(monto).toLocaleString("es-AR")}`;

    // Lo que el sistema NO resuelve solo. Son tres cosas distintas y ninguna
    // es un error: la devolución se registró bien.
    if (resultado.es_cuenta_corriente) {
      if (resultado.excedente_a_devolver > 0) {
        // Pasa cuando el cliente ya pagó más de lo que quedaba de esta venta.
        // No se mueve solo porque los pagos de cuenta corriente no están
        // imputados a un ticket: la base no sabe con qué medio se cobró.
        avisos.push(
          `La deuda no alcanzó a absorber ${pesos(resultado.excedente_a_devolver)}: el cliente ya había pagado esa parte y hay que devolvérsela aparte.`,
        );
      }
    } else if (!resultado.sale_de_caja && resultado.monto_devuelto > 0) {
      // Con medio elegido es una constancia de lo decidido; sin elegir, es lo
      // que el sistema dedujo del cobro. Dos frases, y la primera no tiene que
      // sonar a problema pendiente.
      avisos.push(
        resultado.reintegro_metodo_nombre
          ? `Devolvé ${pesos(resultado.monto_devuelto)} por ${resultado.reintegro_metodo_nombre}. No salen de la caja.`
          : `Se cobró por ${resultado.metodo_nombre ?? "transferencia"}: devolvé ${pesos(
              resultado.monto_devuelto,
            )} por ese medio, no salen de la caja.`,
      );
    }

    if (resultado.recargo_no_devuelto > 0) {
      avisos.push(
        `No se devolvieron ${pesos(resultado.recargo_no_devuelto)} de recargo por medio de pago: esa comisión se la quedó el banco y no la reintegra.`,
      );
    }

    revalidatePath("/");
    revalidatePath("/ventas");
    revalidatePath("/caja");
    revalidatePath("/stock");
    revalidatePath("/reportes");

    return {
      data: {
        montoDevuelto: Number(resultado.monto_devuelto),
        baseDevuelta: Number(resultado.base_devuelta),
        recargoCcPerdonado: Number(resultado.recargo_cc_perdonado),
        recargoNoDevuelto: Number(resultado.recargo_no_devuelto),
        esCuentaCorriente: resultado.es_cuenta_corriente,
        creditoCc: Number(resultado.credito_cc),
        metodoNombre: resultado.metodo_nombre,
        saleDeCaja: resultado.sale_de_caja,
        ventaTotalmenteDevuelta: resultado.venta_totalmente_devuelta,
        avisos,
      },
      error: null,
    };
  } catch (err) {
    console.error("[DEVOLUCION] Error inesperado:", err);
    return {
      data: null,
      error: "Ocurrió un error inesperado al registrar la devolución.",
    };
  }
}

type ClienteServidor = ReturnType<typeof createClient>;

/**
 * El stock, después de que la plata ya se movió.
 *
 * Los renglones se releen de `devoluciones_items` y NO se toman de lo que mandó
 * el navegador: el cliente propone qué devolver, la base decide qué se
 * devolvió, y el stock tiene que seguir a la base. Es el mismo criterio que
 * revalidar precios en `create-sale.ts`.
 */
async function moverStock(
  supabase: ClienteServidor,
  devolucionId: string,
  ventaId: string,
  usuarioId: string,
): Promise<string[]> {
  const avisos: string[] = [];

  const { data: renglones } = await supabase
    .from("devoluciones_items")
    .select("venta_item_id, variante_id, cantidad, destino")
    .eq("devolucion_id", devolucionId);

  if (!renglones?.length) return avisos;

  const { data: items } = await supabase
    .from("ventas_items")
    .select("id, producto_id, variante")
    .eq("venta_id", ventaId);

  const porItem = new Map(
    (items ?? []).map((item) => [item.id as string, item]),
  );

  const sinRestaurar: string[] = [];

  for (const renglon of renglones) {
    const item = porItem.get(renglon.venta_item_id as string);
    const nombre = (item?.variante as string) ?? "un renglón";

    if (renglon.destino === "BAJA") {
      if (!item?.producto_id) continue;
      await supabase.from("bajas").insert({
        producto_id: item.producto_id,
        variante: item.variante,
        cantidad: renglon.cantidad,
        motivo: "Devolución parcial de cliente",
        estado: "APROBADA",
        creado_por: usuarioId,
        origen: "DEVOLUCION_VENTA",
      });
      continue;
    }

    if (!renglon.variante_id) {
      // Sin variante no hay a qué devolverle el stock. Quedan 116 renglones
      // así, todos anteriores al 16/8 (ver 20260903150000). El modal ya lo
      // avisa antes; esto es la red por si algo cambió en el medio.
      sinRestaurar.push(nombre);
      continue;
    }

    const { error } = await supabase.rpc("ajustar_stock_variante", {
      p_variante_id: renglon.variante_id,
      p_delta: renglon.cantidad,
      p_origen: "DEVOLUCION_PARCIAL",
      p_referencia_id: devolucionId,
    });

    if (error) {
      console.error("[DEVOLUCION] No se pudo devolver stock:", {
        devolucionId,
        variante: nombre,
        error,
      });
      sinRestaurar.push(nombre);
      continue;
    }

    if (item?.producto_id) {
      await supabase.rpc("ajustar_stock_legacy", {
        p_producto_id: item.producto_id,
        p_variante: item.variante,
        p_delta: renglon.cantidad,
      });
    }
  }

  if (sinRestaurar.length > 0) {
    avisos.push(
      `No se pudo devolver al stock: ${sinRestaurar.join(", ")}. Cargalo a mano.`,
    );
  }

  return avisos;
}
