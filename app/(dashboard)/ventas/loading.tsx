import { Skeleton } from "@/shared/ui/skeleton";

/**
 * Lo que se ve APENAS se clickea Ventas en el sidebar.
 *
 * ES EL CASO MÁS GRAVE DE LOS TRES, y por un motivo estructural, no de red.
 * `/ventas` es un server component que hace `await getVentasAction()` ANTES de
 * devolver nada, así que sus datos viajan DENTRO del RSC de la navegación:
 * 1.113 kB. Medido en `/stock → /ventas`:
 *
 *   primer cambio visible ... 1.785 ms
 *   pantalla usable ......... 1.785 ms   ← el mismo número
 *
 * Que sean idénticos es el síntoma: no hay estado intermedio. La pantalla
 * anterior se queda quieta 1,8 s y después aparece todo de golpe. Desglosado,
 * son 302 ms esperando al servidor y 746 ms bajando el payload.
 *
 * A diferencia de /pos y /stock —que traen sus datos por React Query y por lo
 * menos PODRÍAN mostrar el shell antes— acá no hay nada que mostrar hasta que
 * baja el último byte. Este archivo es lo único que puede romper esa espera.
 *
 * No baja el tiempo hasta los datos; lo saca de "la app se colgó" y lo pone en
 * "está cargando". Desde el 4/10/2026 la página pide solo un rango (default 7
 * días, ver `features/sales/lib/rango-historial.ts`), que es lo que achica el
 * payload; con "Todo el historial" vuelve a ser el caso de arriba.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Barra de búsqueda + orden, como en SaleTableHeader */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-10 w-full max-w-sm rounded-lg" />
        <Skeleton className="h-10 w-10 sm:w-44 rounded-lg" />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Encabezado de la tabla */}
        <div className="h-12 border-b border-border/60 bg-muted/30 px-4 sm:px-6 flex items-center gap-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-32 hidden sm:block" />
          <Skeleton className="h-3 w-20 ml-auto" />
        </div>

        {/* Diez filas: es lo que entra en pantalla y lo que pagina la tabla
            (ITEMS_POR_PAGINA = 10), así no cambia el alto al llegar los datos. */}
        {[...Array(10)].map((_, i) => (
          <div
            key={i}
            className="px-4 sm:px-6 py-4 border-b border-border/60 flex items-center gap-4"
          >
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-32 hidden sm:block" />
            <div className="ml-auto flex items-center gap-3">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
