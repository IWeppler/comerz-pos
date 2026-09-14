"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import { normalizarTratamientoIva } from "@/shared/lib/fiscal-producto";
import { normalizarRiAMonotributo } from "@/shared/lib/determinar-comprobante";
import {
  comprobanteDefectoEsValido,
  ETIQUETA_COMPROBANTE,
  normalizarModoFacturacion,
  normalizarTipoComprobante,
  parsePuntoVenta,
  emiteComprobanteFiscal,
} from "@/shared/lib/facturacion";

export interface EstadoFacturacion {
  error: string | null;
  success: boolean;
}

/**
 * Guarda la configuración de facturación del comercio.
 *
 * Reemplaza el `setTimeout` + toast de éxito que tenía el panel: hasta hoy el
 * usuario elegía "Automática (ARCA)", leía "Configuración fiscal actualizada"
 * y no se guardaba absolutamente nada.
 */
export async function updateFacturacionAction(
  _prevState: EstadoFacturacion,
  formData: FormData,
): Promise<EstadoFacturacion> {
  const id = formData.get("id") as string | null;
  if (!id) {
    return {
      error: "No se pudo identificar la configuración. Recargá la página.",
      success: false,
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // Un server action es un endpoint: que el tab no se le muestre a una
  // vendedora no impide que llame a esta función. Y acá el daño no es cosmético
  // — cambiar el punto de venta o el modo rompe la numeración fiscal.
  if (!(await tienePermiso(supabase, PERMISOS.CONFIGURACION_FACTURACION))) {
    return {
      error: "No tenés permiso para cambiar la configuración de facturación.",
      success: false,
    };
  }

  const modo_facturacion = normalizarModoFacturacion(
    formData.get("modo_facturacion"),
  );
  const comprobante_defecto = normalizarTipoComprobante(
    formData.get("comprobante_defecto"),
  );

  const puntoVentaCrudo = ((formData.get("punto_venta") as string) ?? "").trim();
  // El hidden solo se monta con modo ARCA; en los otros modos no hay switch
  // y el valor guardado no importa, así que se deja como está.
  const facturarCrudo = formData.get("facturar_por_defecto");
  const facturar_por_defecto =
    facturarCrudo === null ? undefined : facturarCrudo === "true";

  // Criterios del contador. Solo se montan con modo ARCA; fail-closed a los
  // defaults ante cualquier valor raro. El tope vacío es NULL (= sistema).
  const recargosCrudo = formData.get("arca_recargos_iva");
  const arca_recargos_iva =
    recargosCrudo === null
      ? undefined
      : normalizarTratamientoIva(recargosCrudo);
  const riCrudo = formData.get("arca_ri_a_monotributo");
  const arca_ri_a_monotributo =
    riCrudo === null ? undefined : normalizarRiAMonotributo(riCrudo);
  const topeCrudo = formData.get("arca_tope_consumidor_final");
  let arca_tope_consumidor_final: number | null | undefined = undefined;
  if (topeCrudo !== null) {
    const limpio = String(topeCrudo).replaceAll(/[.\s$]/g, "").replace(",", ".").trim();
    if (limpio === "") {
      arca_tope_consumidor_final = null;
    } else {
      const n = Number(limpio);
      if (!Number.isFinite(n) || n <= 0) {
        return {
          error: "El tope a consumidor final tiene que ser un importe mayor a 0, o vacío.",
          success: false,
        };
      }
      arca_tope_consumidor_final = n;
    }
  }
  const punto_venta = parsePuntoVenta(puntoVentaCrudo);

  // parsePuntoVenta devuelve null tanto para "vacío" (legítimo) como para
  // "inválido". Distinguirlos importa: guardar null en silencio ante un "0" o
  // un "abc" le dejaría al usuario la pantalla diciendo que no configuró nada
  // sin explicarle por qué.
  if (puntoVentaCrudo !== "" && punto_venta === null) {
    return {
      error: "El punto de venta debe ser un número entre 1 y 99999.",
      success: false,
    };
  }

  // ARCA sin punto de venta no puede emitir: es mejor frenarlo al guardar que
  // descubrirlo con la clienta esperando en el mostrador.
  if (emiteComprobanteFiscal(modo_facturacion) && punto_venta === null) {
    return {
      error:
        "Para facturar con ARCA necesitás cargar el punto de venta que diste de alta.",
      success: false,
    };
  }

  // La condición de IVA sale de la BASE, no del formulario: es la que decide
  // qué letras puede emitir el comercio y se edita en otra pantalla. Confiar
  // en un campo del cliente acá sería dejar elegir Factura A a un
  // monotributista mandando el form a mano.
  const { data: configActual, error: errorLectura } = await supabase
    .from("configuracion_pos")
    .select("condicion_iva")
    .eq("id", id)
    .single();

  if (errorLectura || !configActual) {
    console.error("Error leyendo la configuración fiscal:", errorLectura);
    return { error: "No se pudo leer la configuración del comercio.", success: false };
  }

  if (
    !comprobanteDefectoEsValido(
      modo_facturacion,
      comprobante_defecto,
      configActual.condicion_iva,
    )
  ) {
    return {
      error: `Tu comercio no puede emitir ${ETIQUETA_COMPROBANTE[comprobante_defecto]} con la configuración actual. Revisá la condición de IVA en la pestaña Comercio.`,
      success: false,
    };
  }

  // Las tres columnas viajan SIEMPRE juntas en el mismo UPDATE. El CHECK de la
  // base cruza modo y comprobante, así que mandar una sola falla: pasar de ARCA
  // a INTERNO con 'FACTURA_B' todavía guardado es una violación de CHECK aunque
  // el usuario solo haya tocado el modo. El formulario ya manda TICKET en ese
  // caso; esto deja escrito por qué no se puede "optimizar" a un update parcial.
  const { error } = await supabase
    .from("configuracion_pos")
    .update({
      modo_facturacion,
      comprobante_defecto,
      punto_venta,
      ...(facturar_por_defecto === undefined ? {} : { facturar_por_defecto }),
      ...(arca_recargos_iva === undefined ? {} : { arca_recargos_iva }),
      ...(arca_ri_a_monotributo === undefined ? {} : { arca_ri_a_monotributo }),
      ...(arca_tope_consumidor_final === undefined ? {} : { arca_tope_consumidor_final }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("Error al guardar la configuración de facturación:", error);
    return { error: "No se pudo guardar la configuración fiscal.", success: false };
  }

  revalidatePath("/", "layout");

  return { error: null, success: true };
}
