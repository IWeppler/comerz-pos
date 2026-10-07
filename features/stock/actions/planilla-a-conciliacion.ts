"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { tienePermiso, PERMISOS } from "@/shared/lib/permisos";
import { procesarPedidoAction } from "@/features/purchases/actions/create-purchase";
import { parseProductosSheet } from "@/features/stock/lib/parse-productos-csv";
import { hashPlanillaProductos } from "@/features/stock/lib/hash-import-productos";
import { normalizarRubro } from "@/entities/config/types";
import {
  planillaALineasDeRemito,
  resumirPlanilla,
} from "@/features/stock/lib/planilla-a-remito";

/**
 * Una planilla propia entra por el MISMO camino que un remito de proveedor.
 *
 * Antes la planilla escribía derecho en el stock y el remito pasaba por
 * conciliación: dos motores de escritura y dos formas distintas de
 * equivocarse. Ahora las dos crean una orden de compra y terminan en
 * /compras/merge, que es donde se verifica antes de tocar nada.
 *
 * Por qué siempre conciliar, incluso con la planilla propia: con 300 productos
 * cargados nadie se acuerda si "Remera blanca talle M Levis" ya existe o si la
 * cargó escrita distinto. La conciliación contesta eso —ya lo tenés / es nuevo
 * / puede ser este otro— y es lo único que evita el catálogo duplicado. Quién
 * escribió el archivo no cambia esa pregunta.
 *
 * La escritura de stock sigue siendo `aprobar_orden_compra`, en su
 * transacción, con su guard de idempotencia. Este paso solo prepara el
 * borrador — y tiene su PROPIO guard, por el hash del archivo.
 */

export interface ResultadoPlanillaAConciliacion {
  error: string | null;
  /** Adónde ir a conciliar. */
  ordenId?: string;
  /** El archivo ya se había subido antes: `ordenId` es el de esa vez. */
  yaSubida?: boolean;
  /** Si esa orden previa ya se aprobó, volver a subir el archivo duplicaría el
   * stock. La UI lo dice con todas las letras. */
  yaAprobada?: boolean;
  resumen?: {
    filas: number;
    productos: number;
    unidades: number;
    conImei: number;
    sinPrecioVenta: number;
    invalidas: number;
    columnasIgnoradas: string[];
  };
}

export async function planillaAConciliacionAction(
  /** La planilla ya leída como matriz de celdas. El parseo de XLSX vive en el
   * cliente (SheetJS), igual que en el importador anterior. */
  matriz: string[][],
  nombreArchivo: string,
  /** Subir de nuevo el mismo archivo A PROPÓSITO. Existe porque a veces se
   * quiere reingresar la misma mercadería (un segundo envío idéntico), y sin
   * esta puerta el guard sería una pared. */
  forzar = false,
): Promise<ResultadoPlanillaAConciliacion> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // El botón escondido no es control de acceso: un server action es un
  // endpoint. Mismo permiso que el importador anterior.
  if (!(await tienePermiso(supabase, PERMISOS.STOCK_IMPORTAR_PLANILLA))) {
    return { error: "No tenés permiso para importar mercadería." };
  }

  const { data: config, error: configError } = await supabase.from("configuracion_pos").select("rubro").single();
  if (configError) return { error: "No se pudo leer el rubro del comercio." };
  const parseo = parseProductosSheet(matriz, normalizarRubro(config?.rubro));
  if (parseo.error) return { error: parseo.error };
  if (parseo.filas.length === 0) {
    return { error: "La planilla no tiene filas para importar." };
  }

  const hash = hashPlanillaProductos(parseo.filas);

  // GUARD: ¿este archivo ya se subió? La conciliación protege contra aprobar
  // dos veces la MISMA orden, pero no contra crear dos órdenes desde el mismo
  // archivo — y aprobar las dos duplica el stock.
  if (!forzar) {
    const { data: previa } = await supabase
      .from("ordenes_compra")
      .select("id, estado")
      .eq("hash_planilla", hash)
      .maybeSingle();

    if (previa) {
      return {
        error: null,
        ordenId: previa.id as string,
        yaSubida: true,
        yaAprobada: previa.estado === "APROBADA",
      };
    }
  }

  const lineas = planillaALineasDeRemito(parseo.filas);
  const resumen = resumirPlanilla(parseo.filas);

  // El "proveedor" de una planilla propia es el archivo: es lo que va a
  // aparecer en Movimientos de Stock y en el historial de remitos, y "Carga
  // propia" a secas no distingue una importación de otra.
  const proveedor = nombreArchivo.replace(/\.(csv|xlsx|xls)$/i, "").slice(0, 80);

  const resultado = await procesarPedidoAction(proveedor || "Carga propia", lineas);

  if (!resultado.success || !resultado.ordenId) {
    return {
      error: resultado.error ?? "No se pudo preparar la planilla para conciliar.",
    };
  }

  // El hash se marca DESPUÉS de crear la orden, y solo si no se forzó: una
  // reimportación a propósito no puede quedarse con la huella, porque entonces
  // la original dejaría de estar protegida.
  if (!forzar) {
    const { error: errorHash } = await supabase
      .from("ordenes_compra")
      .update({ hash_planilla: hash })
      .eq("id", resultado.ordenId);

    // Si el hash no se pudo guardar, la orden igual existe y es usable: no se
    // rompe el ingreso por perder el guard, pero queda en el log porque
    // significa que este archivo se puede volver a subir sin aviso.
    if (errorHash) {
      console.error("[PLANILLA] hash no registrado:", errorHash);
    }
  }

  return {
    error: null,
    ordenId: resultado.ordenId,
    resumen: {
      ...resumen,
      invalidas: parseo.invalidas.length,
      columnasIgnoradas: parseo.columnasIgnoradas,
    },
  };
}
