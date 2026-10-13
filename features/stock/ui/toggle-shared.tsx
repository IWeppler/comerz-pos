"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { togglePublicadoAction } from "../actions/toggle-shared";
import { toast } from "@/shared/ui/toast";
import { queryKeys } from "@/shared/lib/query-keys";

export function TogglePublicado({
  id,
  publicadoInicial,
}: {
  id: string;
  publicadoInicial: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const nuevoEstado = !publicadoInicial;

    startTransition(async () => {
      const res = await togglePublicadoAction(id, nuevoEstado);
      if (res.success) {
        toast.success(
          nuevoEstado
            ? "Producto visible en la tienda"
            : "Producto oculto de la tienda",
        );
        queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });
        router.refresh();
      } else {
        toast.error(res.error || "No se pudo cambiar el estado");
      }
    });
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={publicadoInicial}
      disabled={isPending}
      onClick={handleToggle}
      title={publicadoInicial ? "Ocultar de la tienda" : "Mostrar en la tienda"}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
        publicadoInicial ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`pointer-events-none block h-4 w-4 rounded-full bg-background ring-0 transition-transform ${
          publicadoInicial ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
