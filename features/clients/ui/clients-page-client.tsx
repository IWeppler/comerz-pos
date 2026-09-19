"use client";

import { useQuery } from "@tanstack/react-query";
import { getClientesPageDataAction } from "@/features/clients/actions/manage-clients";
import { conNegocio, queryKeys } from "@/shared/lib/query-keys";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { ClientsView } from "@/features/clients/ui/clients-view";
import { Skeleton } from "@/shared/ui/skeleton";

const CATALOG_STALE_TIME_MS = 3 * 60 * 1000;

export function ClientsPageClient({
  isAdmin,
  puedeCorregirCobro,
}: {
  isAdmin: boolean;
  puedeCorregirCobro: boolean;
}) {
  const negocioActivo = useNegocioActivo();
  const { data, isLoading, error } = useQuery({
    queryKey: conNegocio(queryKeys.clientes.listado, negocioActivo?.id),
    queryFn: getClientesPageDataAction,
    staleTime: CATALOG_STALE_TIME_MS,
  });

  if (isLoading) {
    return (
      <div className="mx-auto pb-12 space-y-6">
        <ClientsSkeleton />
      </div>
    );
  }

  if (error || data?.error) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20 p-6 text-center">
        <p className="font-medium">
          {data?.error || "No se pudieron cargar los clientes."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto pb-12 space-y-6">
      <ClientsView
        clientes={data?.data?.clientes ?? []}
        metodosPago={data?.data?.metodosPago ?? []}
        entregaMinimaActiva={data?.data?.entregaMinimaActiva}
        recargoMoraConfig={
          data?.data?.recargoMoraConfig ?? {
            recargo_mora_tipo: "NINGUNO",
            recargo_mora_valor: 0,
          }
        }
        vencidoPorCliente={data?.data?.vencidoPorCliente ?? {}}
        moraPreviaPorCliente={data?.data?.moraPreviaPorCliente ?? {}}
        isAdmin={isAdmin}
        puedeCorregirCobro={puedeCorregirCobro}
      />
    </div>
  );
}

function ClientsSkeleton() {
  return (
    <div className="space-y-4 mt-8 m-4">
      <div className="flex justify-between items-center">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
      <div className="rounded-xl border border-border bg-card ">
        <div className="h-12 border-b border-border bg-muted/50 px-4 flex items-center">
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="p-4 border-b border-border flex items-center gap-4"
          >
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
