"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { devolverReservaAction } from "../actions/manage-reservations";

interface DevolverReservaButtonProps {
  reservaId: string;
  nombreProducto: string;
  varianteNombre?: string | null;
  clienteNombre?: string | null;
}

/**
 * Libera la unidad reservada: la reserva pasa a DEVUELTA y el stock
 * disponible vuelve a contarla (el stock físico nunca se movió — una
 * reserva solo resta de `calcularStockDisponible`).
 */
export function DevolverReservaButton({
  reservaId,
  nombreProducto,
  varianteNombre,
  clienteNombre,
}: Readonly<DevolverReservaButtonProps>) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const handleConfirmar = (event: React.MouseEvent) => {
    // El diálogo lo cerramos nosotros al terminar, para que el botón pueda
    // mostrar el estado "Devolviendo…" mientras corre la action.
    event.preventDefault();
    startTransition(async () => {
      const { error } = await devolverReservaAction(reservaId);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(`${nombreProducto} volvió al stock disponible.`);
      setAbierto(false);
      router.refresh();
    });
  };

  return (
    <AlertDialog open={abierto} onOpenChange={setAbierto}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          title="Devolver al stock"
        >
          <Undo2 className="w-3.5 h-3.5" />
          Devolver
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Devolver al stock?</AlertDialogTitle>
          <AlertDialogDescription>
            {nombreProducto}
            {varianteNombre ? ` · ${varianteNombre}` : ""} deja de estar
            reservado
            {clienteNombre ? ` para ${clienteNombre}` : ""} y vuelve a quedar
            disponible para vender.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" disabled={pendiente}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            onClick={handleConfirmar}
            disabled={pendiente}
          >
            {pendiente ? "Devolviendo…" : "Devolver al stock"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
