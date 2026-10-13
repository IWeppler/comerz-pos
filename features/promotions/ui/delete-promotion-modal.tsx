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
import { Promotion } from "./promotions-panel";
import { deletePromotionAction } from "../actions/manage-promotions";
import { Loader2 } from "lucide-react";

export function DeletePromotionModal({
  promo,
  open,
  onOpenChange,
}: {
  promo: Promotion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    const res = await deletePromotionAction(promo.id);
    setIsDeleting(false);
    if (res.success) {
      toast.success("Promoción eliminada correctamente.");
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
            ¿Eliminar regla &quot;{promo.nombre}&quot;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Los descuentos activos en carritos
            y cajas asociadas dejarán de aplicar esta promoción de inmediato.
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
            className="bg-bg-danger hover:bg-danger/90 text-white"
          >
            {isDeleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Sí, eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
