"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  registrarGastoAction,
  type EstadoGasto,
} from "@/features/admin/actions/gastos-comerz";
import { CLASE_PORTAL_OSCURO } from "@/features/admin/lib/tema-portal";
import { FormularioGasto } from "./formulario-gasto";

const INICIAL: EstadoGasto = { error: null, success: false };

/**
 * El botón de anotar, en el encabezado.
 *
 * Solo da de alta. Corregir y borrar viven en la lista de gastos del mes, que
 * es donde se los ve: un gasto se arregla donde aparece mal, no volviendo al
 * formulario con el que se cargó.
 */
export function AnotarGastoBoton() {
  const [abierto, setAbierto] = useState(false);
  const [estado, accion, guardando] = useActionState(
    registrarGastoAction,
    INICIAL,
  );

  // Cerrar es estado derivado del resultado, así que se ajusta DURANTE el
  // render: un `setState` en un efecto encadena un segundo render y el linter
  // lo marca. El toast sí es un efecto de verdad.
  const [ultimoOk, setUltimoOk] = useState(false);
  if (estado.success !== ultimoOk) {
    setUltimoOk(estado.success);
    if (estado.success) setAbierto(false);
  }

  useEffect(() => {
    if (estado.success) toast.success("Gasto anotado");
  }, [estado.success]);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-10 gap-1.5 border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
        onClick={() => setAbierto(true)}
      >
        <Plus className="size-3.5" />
        Anotar gasto
      </Button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className={`sm:max-w-md ${CLASE_PORTAL_OSCURO}`}>
          <DialogTitle>Anotar gasto</DialogTitle>
          <DialogDescription>
            Un gasto fijo se cuenta todos los meses hasta que le pongas fecha de
            baja; uno único, solo en su mes.
          </DialogDescription>

          <FormularioGasto
            accion={accion}
            error={estado.error}
            guardando={guardando}
            onCancelar={() => setAbierto(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
