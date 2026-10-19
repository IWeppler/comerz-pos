"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/shared/ui/toast";
import { FileText, Loader2 } from "lucide-react";
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
import {
  EditorTasasCuotas,
  filasATasas,
  filasDesdeTasas,
  type FilaTasa,
} from "@/shared/ui/editor-tasas-cuotas";
import { guardarConfigPresupuestosAction } from "../actions/configuracion";

/**
 * Tasas de financiación, frecuencia de las cuotas y vigencia de las
 * cotizaciones. Solo con el módulo prendido y solo ADMIN (lo decide
 * `settings-manager`; la RLS de `configuracion_pos` lo exige).
 *
 * Cambiar esto no toca las cotizaciones ya emitidas: cada una guarda su
 * copia. Se dice en pantalla porque es la pregunta obvia. Las tasas son las
 * mismas que ofrece la venta en cuotas de Clientes (una lista por comercio).
 */
export function ConfigPresupuestosPanel({ config }: Readonly<{ config: ConfiguracionPOS }>) {
  const router = useRouter();
  const [filas, setFilas] = useState<FilaTasa[]>(() =>
    filasDesdeTasas(config.plan_tasas_financiacion),
  );
  const [frecuencia, setFrecuencia] = useState<string>(config.plan_frecuencia_default ?? "MENSUAL");
  const [vigencia, setVigencia] = useState(String(config.presupuesto_vigencia_dias ?? 7));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const guardar = () => {
    setError(null);
    startTransition(async () => {
      const r = await guardarConfigPresupuestosAction({
        configId: config.id,
        tasas: filasATasas(filas),
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
            Sin filas, la cotización sale sin opciones de cuotas. Son las
            mismas cuotas que se ofrecen al fiar en el POS.
          </p>
        </div>

        <EditorTasasCuotas filas={filas} onChange={setFilas} idPrefijo="presupuestos" />
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
