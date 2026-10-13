"use client";

import { useActionState, useState } from "react";
import { Loader2, Plus, Tags } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import {
  ListaPrecioForm,
  valoresDesdeLista,
  type ValoresLista,
} from "./lista-precio-form";
import {
  crearListaPrecioAction,
  editarListaPrecioAction,
} from "../actions/manage-listas-precios";
import type { ListaPrecio } from "@/entities/precios/types";

/**
 * El alta y la edición de una lista, en un solo componente.
 *
 * Son el mismo formulario y las mismas reglas: separarlos en dos archivos
 * como en Métodos de Pago duplicaría los campos, y ahí ya pasó que una
 * validación quedara solo en uno de los dos.
 *
 * `lista` presente = edición. Ausente = alta, y entonces el componente trae
 * su propio botón de disparo.
 */
export function ListaPrecioModal({
  lista,
  abierto,
  onAbiertoChange,
}: Readonly<{
  lista?: ListaPrecio | null;
  /** Solo en edición: el panel controla la apertura desde su menú. */
  abierto?: boolean;
  onAbiertoChange?: (abierto: boolean) => void;
}>) {
  const esEdicion = Boolean(lista);
  const [abiertoLocal, setAbiertoLocal] = useState(false);
  const estaAbierto = esEdicion ? Boolean(abierto) : abiertoLocal;

  const cambiarApertura = (valor: boolean) => {
    if (esEdicion) onAbiertoChange?.(valor);
    else setAbiertoLocal(valor);
  };

  const [valores, setValores] = useState<ValoresLista>(() =>
    valoresDesdeLista(lista),
  );

  // Al abrir se re-siembra desde la lista: sin esto, editar una lista, cerrar
  // sin guardar y abrir otra mostraría los valores de la primera.
  //
  // Se hace DURANTE EL RENDER y no en un `useEffect`, que es el mismo patrón
  // (y el mismo porqué) del switch fiscal del modal de clientes: un efecto
  // corre DESPUÉS de pintar, así que habría un frame con los valores viejos y
  // un guardado disparado en ese instante escribiría lo que la persona no vio.
  const claveApertura = estaAbierto ? (lista?.id ?? "nueva") : null;
  const [sembrado, setSembrado] = useState<string | null>(null);
  if (sembrado !== claveApertura) {
    setSembrado(claveApertura);
    if (claveApertura) setValores(valoresDesdeLista(lista));
  }

  const [, formAction, isPending] = useActionState(
    async (prev: { error: string | null; success: boolean }, formData: FormData) => {
      const resultado = esEdicion
        ? await editarListaPrecioAction(prev, formData)
        : await crearListaPrecioAction(prev, formData);

      if (resultado.success) {
        toast.success(esEdicion ? "Lista actualizada." : "Lista creada.");
        cambiarApertura(false);
      } else if (resultado.error) {
        toast.error(resultado.error);
      }
      return resultado;
    },
    { error: null, success: false },
  );

  return (
    <Dialog open={estaAbierto} onOpenChange={cambiarApertura}>
      {!esEdicion && (
        <DialogTrigger asChild>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-none">
            <Plus className="mr-2 h-4 w-4" />
            Nueva lista
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[460px] rounded-xl border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5 text-primary" />
            {esEdicion ? "Editar lista de precios" : "Nueva lista de precios"}
          </DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-5 pt-2">
          {esEdicion && <input type="hidden" name="id" value={lista!.id} />}

          <ListaPrecioForm valores={valores} onChange={setValores} />

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => cambiarApertura(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" className="cursor-pointer" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {esEdicion ? "Guardar cambios" : "Crear lista"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
