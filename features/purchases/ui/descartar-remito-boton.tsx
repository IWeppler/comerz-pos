"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageX } from "lucide-react";
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
} from "@/shared/ui/alert-dialog";
import { toast } from "@/shared/ui/toast";
import { descartarRemitoAction } from "../actions/pago-remito";

/**
 * Descartar un remito que no va a ingresar (la mercadería no vino, el archivo
 * se subió de más). No mueve stock ni plata; el remito queda en el historial
 * como descartado (trigger `validar_estado_remito`).
 */
export function DescartarRemitoBoton({ ordenId, nombre }: Readonly<{ ordenId: string; nombre: string }>) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);

  const descartar = async () => {
    setCargando(true);
    const { error } = await descartarRemitoAction(ordenId);
    setCargando(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Remito descartado. No se movió stock ni plata.");
    setAbierto(false);
    router.push("/stock");
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="h-11 md:h-9" onClick={() => setAbierto(true)}>
        <PackageX className="mr-1 h-4 w-4" /> Descartar remito
      </Button>
      <AlertDialog open={abierto} onOpenChange={setAbierto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar «{nombre}»?</AlertDialogTitle>
            <AlertDialogDescription>
              No se suma stock ni se registra ningún pago. El remito no se puede
              retomar: si la mercadería llega, subí el archivo de nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cargando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void descartar();
              }}
              disabled={cargando}
            >
              {cargando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
