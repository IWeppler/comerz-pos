"use client";

import { Banknote, Landmark } from "lucide-react";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import type { OpcionesReintegro } from "../actions/opciones-reintegro";

const pesos = (monto: number) => `$${Math.round(monto).toLocaleString("es-AR")}`;

/**
 * Por dónde se le devuelve la plata al cliente.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ARRANCA SIN NADA ELEGIDO, Y ESO ES LO IMPORTANTE
 *
 * Un default acá no es una comodidad: es la decisión que se guarda cuando
 * nadie mira. Elegir efectivo saca plata del cajón y elegir otro medio la
 * deja adentro, así que confirmar sin leer tiene que ser imposible. Mismo
 * criterio que el "por qué" de la anulación, que también nace vacío.
 *
 * Solo aparece con el permiso `ventas.elegir_medio_devolucion` (hoy, ADMIN) y
 * cuando hubo plata cobrada. Sin permiso no hay selector y la devolución sale
 * por el medio del cobro, que es lo que pasó siempre: para una vendedora que
 * puede devolver —lo es en 7 de los 11 negocios— esta pantalla no cambia.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function SelectorMedioReintegro({
  opciones,
  valor,
  onChange,
  monto,
}: Readonly<{
  opciones: OpcionesReintegro | null;
  valor: string | null;
  onChange: (metodoId: string) => void;
  /** Lo que se va a devolver. Puede ser menos que lo cobrado en una
   * devolución parcial, así que lo pasa quien lo sabe. */
  monto: number;
}>) {
  if (!opciones?.puedeElegir) return null;
  if (opciones.montoCobrado <= 0 || opciones.metodos.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <Label className="text-sm font-semibold">
        ¿Por dónde le devolvés {monto > 0 ? pesos(monto) : "la plata"}?
      </Label>
      <p className="text-xs text-muted-foreground">
        {opciones.medioDelCobro
          ? `Se cobró con ${opciones.medioDelCobro}. Podés devolver por otro medio.`
          : "Elegí el medio por el que sale la plata."}
      </p>

      <RadioGroup
        value={valor ?? ""}
        onValueChange={onChange}
        className="gap-1 pt-1"
      >
        {opciones.metodos.map((metodo) => (
          <Label
            key={metodo.id}
            htmlFor={`reintegro-${metodo.id}`}
            className="flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-2 py-2 hover:bg-muted"
          >
            <RadioGroupItem value={metodo.id} id={`reintegro-${metodo.id}`} />
            {metodo.tipo === "EFECTIVO" ? (
              <Banknote className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">{metodo.nombre}</span>
            {metodo.esElDelCobro && (
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Con esto se cobró
              </span>
            )}
          </Label>
        ))}
      </RadioGroup>

      {/* El efectivo es el único que mueve el arqueo, así que es el único que
          necesita decirlo antes de confirmar. */}
      {valor !== null &&
        opciones.metodos.find((metodo) => metodo.id === valor)?.tipo ===
          "EFECTIVO" && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            Sale de la caja: el turno va a cerrar con {pesos(monto)} menos.
          </p>
        )}
    </div>
  );
}

/** ¿Se puede confirmar? Con el selector visible hay que haber elegido. Vive
 * acá para que las dos pantallas no contesten distinto. */
export function faltaElegirMedio(
  opciones: OpcionesReintegro | null,
  valor: string | null,
): boolean {
  if (!opciones?.puedeElegir) return false;
  if (opciones.montoCobrado <= 0 || opciones.metodos.length === 0) return false;
  return valor === null;
}
