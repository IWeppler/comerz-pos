import { ItemResuelto, SugerenciaSimilitud } from "@/entities/compras/types";
import { Producto } from "@/entities/productos/types";
import { leerConfigPos } from "@/entities/config/lib/leer-config-pos";
import { normalizarRubro } from "@/entities/config/types";
import { getOrdenParaMergeAction } from "@/features/purchases/actions/merge-purchase";
import {
  ConciliacionClient,
  type BorradorGuardado,
} from "@/features/purchases/ui/conciliacion-client";
import type { CategoriaReal } from "@/features/purchases/lib/resolve-import-categoria";
import { bloquearVendedor } from "@/shared/config/supabase/guard-rol";
import { DescartarRemitoBoton } from "@/features/purchases/ui/descartar-remito-boton";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MergePage({ params }: Readonly<PageProps>) {
  // Esta página no tenía NINGÚN control propio: ni de sesión ni de rol. La
  // sesión la cubre el layout del dashboard; el rol, hasta ahora, solo el
  // middleware. Ver `bloquearVendedor`.
  await bloquearVendedor();

  const { id } = await params;

  // El rubro decide el diccionario de términos con el que se infiere la
  // categoría de cada fila. Sale de `leerConfigPos`, que los layouts de este
  // mismo request ya llamaron: `cache()` lo devuelve sin viajar de nuevo.
  const [
    {
      orden,
      items,
      productos,
      sugerenciasSimilitud,
      categorias,
      borrador,
      serie,
      error,
    },
    config,
  ] = await Promise.all([getOrdenParaMergeAction(id), leerConfigPos()]);

  if (error || !orden) {
    return (
      <div className="p-8 text-center bg-red-50 text-red-600 rounded-xl font-bold">
        {error || "Orden no encontrada."}
      </div>
    );
  }

  if (orden.estado === "DESCARTADA") {
    return (
      <div className="m-2 rounded-xl bg-muted p-8 text-center font-semibold text-muted-foreground md:m-4">
        Este remito se descartó: su mercadería no ingresó al stock y no se puede
        retomar. Si la mercadería llegó, subí el archivo de nuevo.
      </div>
    );
  }

  if (orden.estado === "APROBADA") {
    return (
      <div className="p-8 text-center bg-success/10 text-success rounded-xl font-bold m-2 md:m-4">
        Esta orden de compra ya fue procesada e impactada en el stock.
      </div>
    );
  }

  return (
    <div className="w-full mx-auto pb-12">
      <div className="flex justify-end px-2 pt-2 md:px-4">
        <DescartarRemitoBoton ordenId={orden.id} nombre={orden.proveedor} />
      </div>
      <ConciliacionClient
        orden={orden}
        items={items as ItemResuelto[]}
        productos={productos as Producto[]}
        sugerenciasSimilitud={sugerenciasSimilitud as SugerenciaSimilitud[]}
        categorias={(categorias ?? []) as CategoriaReal[]}
        rubro={normalizarRubro(config?.rubro)}
        borrador={borrador as BorradorGuardado}
        serie={serie}
      />
    </div>
  );
}
