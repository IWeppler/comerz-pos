"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { toast } from "@/shared/ui/toast";
import { MetodoPago } from "@/entities/payments/types";
import { deletePaymentAction } from "../actions/manage-payment";
import { Loader2 } from "lucide-react";

export function DeletePaymentModal({
  pago,
  open,
  onOpenChange,
}: {
  pago: MetodoPago;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    const res = await deletePaymentAction(pago.id);
    setIsDeleting(false);
    if (res.success) {
      toast.success("Método de pago eliminado correctamente.");
      onOpenChange(false);
    } else {
      toast.error(res.error || "Ocurrió un error al eliminar.");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿Eliminar método &quot;{pago.nombre}&quot;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Este método dejará de estar
            disponible como opción en el módulo de Caja.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={isDeleting}
            className="bg-danger hover:bg-danger/90 text-white"
          >
            {isDeleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Sí, eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
