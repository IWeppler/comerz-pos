"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";

/**
 * Qué renglones de una venta NO van a poder devolver stock si se anula.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE PREGUNTA ANTES Y NO SE AVISA DESPUÉS
 *
 * `anularVentaAction` ya detecta esto, pero al final: para cuando lo sabe, la
 * venta está anulada y la plata salió de la caja. El aviso llega cuando ya no
 * hay decisión que tomar, solo trabajo manual que alguien tiene que acordarse
 * de hacer. Preguntando al abrir el modal, la vendedora ve qué va a quedar sin
 * contar mientras todavía puede elegir otra cosa.
 *
 * QUEDAN 116 RENGLONES ASÍ en los seis comercios, después del backfill de
 * 20260903150000. No son un bug activo —el último es del 16/8 y desde
 * entonces todos los renglones guardan su `variante_id`— sino una cola
 * histórica: 35 sin `producto_id`, 3 con una variante muerta sin equivalente y
 * 78 cuyo producto se rehizo con otros atributos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USA LA MISMA REGLA QUE LA ANULACIÓN, y eso no es opcional: si la vista
 * previa aplicara un criterio más generoso que el código que después devuelve
 * el stock, prometería en pantalla algo que no va a pasar. La regla es la de
 * `cancel-sale.ts`: sirve el `variante_id` si apunta a una variante viva, y si
 * no, el nombre exacto dentro del mismo producto.
 *
 * (Ese respaldo por nombre hoy no acierta nunca —fallaba 79 de 79 antes del
 * backfill, y lo que quedó no matchea ni por nombre ni por atributos— pero se
 * consulta igual: el día que alguien lo mejore, esta vista previa tiene que
 * mejorar con él, no quedarse atrás.)
 */
export interface RestaurabilidadVenta {
  /** Nombres de variante de los renglones que NO van a volver al inventario. */
  sinRestaurar: string[];
  /** Cuántos renglones sí van a volver. Cero significa que "Devolver al
   * inventario" no va a mover ni una unidad. */
  restaurables: number;
}

export async function getRestaurabilidadVentaAction(
  ventaId: string,
): Promise<RestaurabilidadVenta> {
  // Ante cualquier problema se devuelve "todo restaurable": este dato es una
  // ayuda para decidir, no un permiso. Bloquear una anulación porque falló una
  // consulta informativa sería peor que el problema que resuelve.
  const vacio: RestaurabilidadVenta = { sinRestaurar: [], restaurables: 0 };

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data: items, error } = await supabase
      .from("ventas_items")
      .select("producto_id, variante, variante_id, es_venta_libre")
      .eq("venta_id", ventaId);

    if (error || !items?.length) return vacio;

    // La venta libre no tiene stock que devolver ni que perder: no es un
    // renglón "sin restaurar" (eso avisa que hay que cargar unidades a mano,
    // y acá no hay ninguna) ni uno restaurable. Se saca antes de contar.
    const conStock = items.filter((item) => !item.es_venta_libre);
    if (conStock.length === 0) return vacio;

    const productoIds = [
      ...new Set(conStock.map((item) => item.producto_id).filter(Boolean)),
    ] as string[];

    if (productoIds.length === 0) {
      return {
        sinRestaurar: conStock.map((item) => item.variante),
        restaurables: 0,
      };
    }

    const { data: variantes } = await supabase
      .from("producto_variantes")
      .select("id, producto_id, nombre_display")
      .in("producto_id", productoIds);

    const porId = new Set((variantes ?? []).map((v) => v.id));
    const porNombre = new Set(
      (variantes ?? []).map((v) => `${v.producto_id}::${v.nombre_display}`),
    );

    const sinRestaurar: string[] = [];
    let restaurables = 0;

    for (const item of conStock) {
      const resuelve =
        !!item.producto_id &&
        ((item.variante_id && porId.has(item.variante_id)) ||
          porNombre.has(`${item.producto_id}::${item.variante}`));

      if (resuelve) restaurables += 1;
      else sinRestaurar.push(item.variante);
    }

    return { sinRestaurar, restaurables };
  } catch (err) {
    console.error("[ANULACION] No se pudo evaluar la restaurabilidad:", err);
    return vacio;
  }
}
