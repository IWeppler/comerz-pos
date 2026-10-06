"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { eliminarProductoAction } from "../actions/delete-product";
import { toast } from "sonner";
import { queryKeys } from "@/shared/lib/query-keys";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Trash2 } from "lucide-react";

interface EliminarProductoModalProps {
  id: string;
  nombre: string;
  tipo: string;
  children?: React.ReactNode;
  /** Controlado desde afuera: lo abre un ítem de menú que vive afuera del
   * modal (si el modal viviera adentro del menú, cerrar el menú lo
   * desmontaría). Sin esto maneja su estado y muestra su trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function EliminarProductoModal({
  id,
  nombre,
  tipo,
  children,
  open,
  onOpenChange,
}: Readonly<EliminarProductoModalProps>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [abiertoInterno, setAbiertoInterno] = useState(false);
  const esControlado = open !== undefined;
  const isOpen = esControlado ? open : abiertoInterno;
  const setIsOpen = (v: boolean) => {
    if (!esControlado) setAbiertoInterno(v);
    onOpenChange?.(v);
  };

  const [isPending, startTransition] = useTransition();

  const handleEliminar = () => {
    startTransition(async () => {
      const result = await eliminarProductoAction(id);

      if (result.success) {
        setIsOpen(false);
        toast.success(`El producto ${nombre} ha sido eliminado`);
        queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });
        router.refresh();
      } else if (result.error) {
        toast.error(result.error);
      }
    });
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      {!esControlado && (
      <AlertDialogTrigger asChild>
        {children ? (
          children
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 cursor-pointer text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title="Eliminar producto"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Eliminar</span>
          </Button>
        )}
      </AlertDialogTrigger>
      )}

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Estás completamente seguro?</AlertDialogTitle>
          <AlertDialogDescription>
            Estás a punto de eliminar el producto{" "}
            <span className="font-bold">{nombre}</span>. Esta acción borrará
            también todo su stock actual de forma permanente. El historial de
            ventas de este producto se conservará, pero aparecerá como
            &quot;Producto eliminado&quot;.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          {/* Usamos un Button normal en lugar de AlertDialogAction para poder controlar el estado disabled/loading */}
          <Button
            variant="destructive"
            onClick={handleEliminar}
            disabled={isPending}
          >
            {isPending ? "Eliminando..." : "Sí, eliminar producto"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
