"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { corregirVarianteAction } from "../../actions/corregir-variante";

/**
 * Corregir las propiedades de UNA variante sin borrarla: un error de tipeo
 * ("12/257" en vez de "12/256") en un celular con IMEI. La grilla de abajo no
 * puede hacerlo —para ella es borrar una y crear otra— y una variante con IMEI
 * no se borra. Ver `corregir-variante.ts`.
 *
 * Si la corrección la deja igual a otra variante, NO se junta sola: se muestra
 * qué va a pasar con el stock y se pide confirmar.
 */
export function CorregirVarianteForm({
  variante,
  onCancelar,
  onCorregida,
}: Readonly<{
  variante: { id: string; nombre_display: string; atributos: Record<string, string> };
  onCancelar: () => void;
  onCorregida: () => void;
}>) {
  const [valores, setValores] = useState<Record<string, string>>(variante.atributos);
  const [guardando, setGuardando] = useState(false);
  const [fusion, setFusion] = useState<{
    destino: string;
    stockOrigen: number;
    stockDestino: number;
  } | null>(null);

  const propiedades = Object.keys(variante.atributos);

  const guardar = async (fusionar: boolean) => {
    setGuardando(true);
    const res = await corregirVarianteAction({
      varianteId: variante.id,
      valores,
      nombreAnterior: variante.nombre_display,
      fusionar,
    });
    setGuardando(false);

    if (res.ok) {
      toast.success(
        res.accion === "FUSIONADA"
          ? "Variantes juntadas: el stock y los IMEI quedaron en una sola."
          : res.accion === "SIN_CAMBIOS"
            ? "No había nada que cambiar."
            : "Variante corregida.",
      );
      onCorregida();
      return;
    }
    if (res.requiereFusion) {
      setFusion({
        destino: res.destino,
        stockOrigen: res.stockOrigen,
        stockDestino: res.stockDestino,
      });
      return;
    }
    toast.error(res.error);
  };

  if (propiedades.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Esta variante no tiene propiedades para corregir.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      {fusion ? (
        <div className="space-y-3">
          <p className="text-sm">
            Ya existe <span className="font-semibold">{fusion.destino}</span>. Si
            son el mismo aparato, se juntan en una sola variante: stock{" "}
            {fusion.stockDestino} + {fusion.stockOrigen} ={" "}
            <span className="font-semibold">
              {fusion.stockDestino + fusion.stockOrigen}
            </span>
            , y los IMEI y las ventas pasan a esa.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 shadow-none"
              onClick={() => setFusion(null)}
              disabled={guardando}
            >
              Volver
            </Button>
            <Button
              type="button"
              className="h-11"
              onClick={() => void guardar(true)}
              disabled={guardando}
            >
              {guardando && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Juntarlas
            </Button>
          </div>
        </div>
      ) : (
        <>
          {propiedades.map((propiedad) => (
            <div key={propiedad} className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground">
                {propiedad}
              </Label>
              <Input
                value={valores[propiedad] ?? ""}
                onChange={(e) =>
                  setValores((prev) => ({ ...prev, [propiedad]: e.target.value }))
                }
                onKeyDown={(e) => {
                  // Enter no tiene que mandar el formulario del producto.
                  if (e.key === "Enter") e.preventDefault();
                }}
                className="h-11 shadow-none"
                autoComplete="off"
              />
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Se guarda al instante y conserva los IMEI y las ventas de la
            variante. Después se cierra el producto para recargarlo.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 shadow-none"
              onClick={onCancelar}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-11"
              onClick={() => void guardar(false)}
              disabled={guardando}
            >
              {guardando && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Guardar corrección
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
