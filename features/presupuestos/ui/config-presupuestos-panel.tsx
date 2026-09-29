"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import type { ConfiguracionPOS } from "@/entities/config/types";
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
import { guardarConfigPresupuestosAction } from "../actions/configuracion";
import { calcularOpcion, leerTasas } from "../lib/cuotas";

const EJEMPLO = 100_000;
const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

type Fila = { cuotas: string; pct: string };

/**
 * Tasas de financiación, frecuencia de las cuotas y vigencia de las
 * cotizaciones. Solo con el módulo prendido y solo ADMIN (lo decide
 * `settings-manager`; la RLS de `configuracion_pos` lo exige).
 *
 * Cambiar esto no toca las cotizaciones ya emitidas: cada una guarda su
 * copia. Se dice en pantalla porque es la pregunta obvia.
 */
export function ConfigPresupuestosPanel({ config }: Readonly<{ config: ConfiguracionPOS }>) {
  const router = useRouter();
  const [filas, setFilas] = useState<Fila[]>(() =>
    leerTasas(config.plan_tasas_financiacion).map((t) => ({
      cuotas: String(t.cuotas),
      pct: String(t.pct).replace(".", ","),
    })),
  );
  const [frecuencia, setFrecuencia] = useState<string>(config.plan_frecuencia_default ?? "MENSUAL");
  const [vigencia, setVigencia] = useState(String(config.presupuesto_vigencia_dias ?? 7));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const actualizar = (i: number, campo: keyof Fila, valor: string) =>
    setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));

  const guardar = () => {
    setError(null);
    startTransition(async () => {
      const r = await guardarConfigPresupuestosAction({
        configId: config.id,
        tasas: filas.map((f) => ({
          cuotas: Number(f.cuotas),
          pct: Number(f.pct.replace(",", ".")),
        })),
        frecuencia,
        vigenciaDias: Number(vigencia),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success("Configuración de presupuestos guardada.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <FileText className="h-5 w-5 text-primary" /> Presupuestos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Opciones de cuotas que se ofrecen en cada cotización. Las que ya
            se mandaron conservan las condiciones con las que salieron.
          </p>
        </div>
        <Button onClick={guardar} disabled={isPending} className="h-11 w-full sm:w-auto">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar cambios
        </Button>
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="font-medium">Cuotas</h3>
          <p className="text-xs text-muted-foreground">
            El recargo va sobre lo que se financia (total menos el anticipo).
            Sin filas, la cotización sale sin opciones de cuotas.
          </p>
        </div>

        {filas.map((f, i) => {
          const cuotas = Number(f.cuotas);
          const pct = Number(f.pct.replace(",", "."));
          const valida = Number.isInteger(cuotas) && cuotas >= 1 && Number.isFinite(pct) && pct >= 0;
          const ejemplo = valida ? calcularOpcion(EJEMPLO, { cuotas, pct }) : null;
          return (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
              <div className="w-24 space-y-1">
                <Label htmlFor={`cuotas-${i}`}>Cuotas</Label>
                <Input
                  id={`cuotas-${i}`}
                  inputMode="numeric"
                  value={f.cuotas}
                  onChange={(e) => actualizar(i, "cuotas", e.target.value.replace(/\D/g, ""))}
                  className="h-11"
                />
              </div>
              <div className="w-28 space-y-1">
                <Label htmlFor={`pct-${i}`}>Recargo %</Label>
                <Input
                  id={`pct-${i}`}
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
                onClick={() => setFilas((prev) => prev.filter((_, j) => j !== i))}
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
          onClick={() => setFilas((prev) => [...prev, { cuotas: "", pct: "0" }])}
        >
          <Plus className="h-4 w-4" />
          Agregar opción
        </Button>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Frecuencia de las cuotas</Label>
          <Select value={frecuencia} onValueChange={setFrecuencia}>
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SEMANAL">Semanal</SelectItem>
              <SelectItem value="QUINCENAL">Quincenal</SelectItem>
              <SelectItem value="MENSUAL">Mensual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vigencia-presupuesto">Vigencia de una cotización (días)</Label>
          <Input
            id="vigencia-presupuesto"
            inputMode="numeric"
            value={vigencia}
            onChange={(e) => setVigencia(e.target.value.replace(/\D/g, ""))}
            className="h-11"
          />
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
