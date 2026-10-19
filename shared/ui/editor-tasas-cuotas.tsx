"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { calcularOpcion, leerTasas } from "@/shared/lib/cuotas";

/**
 * Las filas "N cuotas → recargo %" de `configuracion_pos.plan_tasas_financiacion`.
 * Una sola lista por comercio: la usan las cotizaciones (Presupuestos) y la
 * venta en cuotas de la cuenta corriente (Clientes). Las dos pantallas editan
 * la misma columna con este mismo editor.
 *
 * Las filas se guardan como texto mientras se tipean ("10,5"); quien guarda
 * las pasa por `filasATasas` y `validarTasas`, que nombra la fila mala.
 */

export type FilaTasa = { cuotas: string; pct: string };

const EJEMPLO = 100_000;
const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

export function filasDesdeTasas(raw: unknown): FilaTasa[] {
  return leerTasas(raw).map((t) => ({
    cuotas: String(t.cuotas),
    pct: String(t.pct).replace(".", ","),
  }));
}

export function filasATasas(filas: FilaTasa[]) {
  return filas.map((f) => ({
    cuotas: Number(f.cuotas),
    pct: Number(f.pct.replace(",", ".")),
  }));
}

export function EditorTasasCuotas({
  filas,
  onChange,
  idPrefijo,
}: Readonly<{
  filas: FilaTasa[];
  onChange: (filas: FilaTasa[]) => void;
  /** Dos editores en la misma página no pueden repetir ids de input. */
  idPrefijo: string;
}>) {
  const actualizar = (i: number, campo: keyof FilaTasa, valor: string) =>
    onChange(filas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));

  return (
    <div className="space-y-3">
      {filas.map((f, i) => {
        const cuotas = Number(f.cuotas);
        const pct = Number(f.pct.replace(",", "."));
        const valida =
          Number.isInteger(cuotas) && cuotas >= 1 && Number.isFinite(pct) && pct >= 0;
        const ejemplo = valida ? calcularOpcion(EJEMPLO, { cuotas, pct }) : null;
        return (
          <div
            key={i}
            className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
          >
            <div className="w-24 space-y-1">
              <Label htmlFor={`${idPrefijo}-cuotas-${i}`}>Cuotas</Label>
              <Input
                id={`${idPrefijo}-cuotas-${i}`}
                inputMode="numeric"
                value={f.cuotas}
                onChange={(e) => actualizar(i, "cuotas", e.target.value.replace(/\D/g, ""))}
                className="h-11"
              />
            </div>
            <div className="w-28 space-y-1">
              <Label htmlFor={`${idPrefijo}-pct-${i}`}>Recargo %</Label>
              <Input
                id={`${idPrefijo}-pct-${i}`}
                inputMode="decimal"
                value={f.pct}
                onChange={(e) => actualizar(i, "pct", e.target.value.replace(/[^\d,.]/g, ""))}
                className="h-11"
              />
            </div>
            <p className="min-w-0 flex-1 pb-3 text-xs text-muted-foreground">
              {ejemplo
                ? `${pesos(EJEMPLO)} → ${ejemplo.cuotas} × ${pesos(ejemplo.montoCuota)} (total ${pesos(ejemplo.totalFinal)})`
                : "Completá cuotas y recargo."}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 text-muted-foreground"
              onClick={() => onChange(filas.filter((_, j) => j !== i))}
              aria-label="Quitar opción"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      <Button
        variant="outline"
        className="h-11 gap-2"
        onClick={() => onChange([...filas, { cuotas: "", pct: "0" }])}
      >
        <Plus className="h-4 w-4" />
        Agregar opción
      </Button>
    </div>
  );
}
