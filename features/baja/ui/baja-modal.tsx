"use client";

import { useState, useActionState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { ProductoIndice } from "@/entities/productos/types";
import { createBajaAction } from "../actions/create-baja";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { MinusCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface BajaModalProps {
  producto: ProductoIndice;
  children?: React.ReactNode;
  /** Controlado desde afuera: lo abre un ítem de menú que vive afuera del
   * modal (si el modal viviera adentro del menú, cerrar el menú lo
   * desmontaría). Sin esto maneja su estado y muestra su trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type BajaActionState = {
  error: string | null;
  success: boolean;
  timestamp?: number;
};

export function BajaModal({
  producto,
  children,
  open,
  onOpenChange,
}: Readonly<BajaModalProps>) {
  const router = useRouter();
  const [abiertoInterno, setAbiertoInterno] = useState(false);
  const esControlado = open !== undefined;
  const isOpen = esControlado ? open : abiertoInterno;
  const setIsOpen = (v: boolean) => {
    if (!esControlado) setAbiertoInterno(v);
    onOpenChange?.(v);
  };
  const [variante, setVariante] = useState("");
  const [motivo, setMotivo] = useState("");

  const [, formAction, isPending] = useActionState(
    async (prevState: BajaActionState, formData: FormData) => {
      const result = await createBajaAction(prevState, formData);

      if (result.success) {
        toast.success("Baja registrada exitosamente", {
          description: "La baja quedo en estado PENDIENTE de revision.",
        });
        setIsOpen(false);
        setVariante("");
        setMotivo("");
        router.refresh();
      } else if (result.error) {
        toast.error(result.error);
      }

      return result;
    },
    { error: null, success: false },
  );

  const handleSubmit = (formData: FormData) => {
    formData.append("producto_id", producto.id);
    formData.append("variante", variante);
    formData.append("motivo", motivo);
    startTransition(() => {
      formAction(formData);
    });
  };

  const variantesDisponibles =
    producto.producto_variantes?.filter((v) => v.stock > 0) || [];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {!esControlado && (
        <DialogTrigger asChild>
          {children ? (
            children
          ) : (
            <Button variant="ghost" size="icon" title="Registrar Baja">
              <MinusCircle className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="sr-only">Registrar Baja</span>
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent aria-describedby="baja-description">
        <DialogHeader>
          <DialogTitle>Registrar Baja</DialogTitle>
          <DialogDescription id="baja-description">
            Reporta una baja de stock para{" "}
            <strong className="text-foreground">{producto.nombre}</strong>. Un
            administrador debera aprobarla.
          </DialogDescription>
        </DialogHeader>

        {variantesDisponibles.length === 0 ? (
          <div className="p-4 mt-4 text-center text-sm font-medium text-muted-foreground bg-muted rounded-md border border-border">
            No hay stock disponible para dar de baja en este producto.
          </div>
        ) : (
          <form action={handleSubmit} className="space-y-5 pt-4">
            <div className="space-y-2">
              <Label>Variante / Talle</Label>
              <Select value={variante} onValueChange={setVariante} required>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona la variante afectada" />
                </SelectTrigger>
                <SelectContent>
                  {variantesDisponibles.map((v) => (
                    <SelectItem key={v.id} value={v.nombre_display}>
                      {v.nombre_display} (Stock actual: {v.stock})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cantidad">Cantidad a descontar</Label>
              <Input
                id="cantidad"
                name="cantidad"
                type="number"
                min="1"
                max={
                  variantesDisponibles.find(
                    (v) => v.nombre_display === variante,
                  )?.stock || 1
                }
                placeholder="Ej: 1"
                required
              />
            </div>

            {/* planta */}

            <div className="space-y-2">
              <Label>Motivo principal</Label>
              <Select value={motivo} onValueChange={setMotivo} required>
                <SelectTrigger>
                  <SelectValue placeholder="Por que se da de baja?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Producto seco">Producto Dañado</SelectItem>
                  <SelectItem value="Plaga/Hongos">
                    Enfermo (Plaga/Hongos)
                  </SelectItem>
                  <SelectItem value="Rotura de maceta">
                    Rotura de maceta
                  </SelectItem>
                  <SelectItem value="Error de inventario">
                    Error de inventario (Sobra stock)
                  </SelectItem>
                  <SelectItem value="Otro">Otro motivo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isPending || !variante || !motivo}
                variant="default"
              >
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Reportar Baja
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
