"use server";

import { headers } from "next/headers";
import { HEADER_NEGOCIO_SLUG } from "@/shared/lib/negocio-slug";
import { tenantOpcional } from "@/shared/lib/tenant";
import { getProductosPublicosCacheados } from "@/shared/lib/cache-catalogo";
import type { Producto } from "@/entities/productos/types";

/**
 * El índice del catálogo público, para filtrar y buscar en el navegador.
 *
 * Existe para sacar el catálogo del HTML: antes la página se lo pasaba como
 * prop a `StoreCatalog`, que es un componente de CLIENTE, y eso serializaba el
 * array entero adentro del documento (1,99 MB en Evens para 34 kB de markup).
 * Pedido por acá, el documento arranca chico y esto llega en paralelo.
 *
 * LEE DEL MISMO CACHE QUE EL RENDER DEL SERVER (`cache-catalogo.ts`, 60 s por
 * negocio, invalidado por tag cuando el comercio toca el catálogo). La versión
 * anterior de esta action no pasaba por ahí: ejecutaba la consulta entera
 * contra Supabase por cada visitante —1,8 MB crudos, 301 kB en el cable, en
 * Evens— mientras el server, en el mismo request, acababa de servir esos
 * mismos productos desde el cache. Medido el 16/9/2026: ~45 bajadas completas
 * por día con el tráfico de hoy; con 1.000 visitas diarias serían 300 MB/día
 * de egress de Supabase por esto solo.
 *
 * SIN parámetros a propósito, y con más razón que antes. Todo lo exportado de
 * un archivo "use server" es un endpoint que el navegador puede llamar con los
 * argumentos que quiera, y la clave del cache es el `negocio_id`: si viniera
 * del cliente, alguien podría pedir con el slug de un negocio (el header) y el
 * id de otro, y dejar en el cache del segundo los productos del primero
 * durante un minuto. Por eso el negocio se resuelve ACÁ, desde el header que
 * escribe el middleware a partir del host o del path, igual que lo hace la
 * página con `resolveTenant`. Un slug que no existe devuelve error, no 404:
 * esto no es una página.
 */
export async function getIndiceCatalogoPublicoAction(): Promise<{
  data: Producto[] | null;
  error: string | null;
}> {
  const headerStore = await headers();
  const slug = headerStore.get(HEADER_NEGOCIO_SLUG);

  const tenant = await tenantOpcional({ slug });
  if (!tenant) {
    return { data: null, error: "No se pudo resolver la tienda." };
  }

  const { data, error } = await getProductosPublicosCacheados(
    tenant.negocio.slug,
    tenant.negocio_id,
  );
  return { data, error };
}
