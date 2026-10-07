"use client";

import { useRef } from "react";
import { Barcode } from "lucide-react";
import { Input } from "@/shared/ui/input";
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
import { normalizarImei } from "@/entities/ventas/imei";
import { totalFaltantes, type FaltanteImei } from "../lib/imeis-remito";

/** Un renglón del remito que lleva IMEI. */
export type RenglonImei = {
  /** `ordenes_items.id`. */
  itemId: string;
  nombre: string;
  variante: string;
  /** Lo que entra (cantidad efectiva). Un IMEI por unidad entera. */
  cantidad: number;
  /** El que vino en el Excel, si vino. No se edita. */
  rawImei: string | null;
  /** Los completados en pantalla. */
  imeis: string[];
};

/**
 * IMEI de los aparatos del remito que vinieron sin número. Un input por
 * aparato; el lector de códigos termina con Enter y eso salta al siguiente
 * (no aprueba nada). Lo tipeado viaja en el borrador como cualquier otro
 * cambio de la conciliación.
 */
export function ImeisRemitoPanel({
  renglones,
  onChange,
}: Readonly<{
  renglones: RenglonImei[];
  onChange: (itemId: string, imeis: string[]) => void;
}>) {
  const contenedor = useRef<HTMLDivElement>(null);
  if (renglones.length === 0) return null;

  const casillasDe = (r: RenglonImei) =>
    Math.max(0, Math.floor(r.cantidad) - (normalizarImei(r.rawImei) ? 1 : 0));
  const total = renglones.reduce((n, r) => n + Math.floor(r.cantidad), 0);
  const cargados = renglones.reduce(
    (n, r) =>
      n +
      (normalizarImei(r.rawImei) ? 1 : 0) +
      r.imeis.slice(0, casillasDe(r)).filter((i) => normalizarImei(i)).length,
    0,
  );

  /** Enter (fin de lectura del escáner) pasa al próximo input del panel. */
  const siguiente = (actual: HTMLInputElement) => {
    const inputs = Array.from(
      contenedor.current?.querySelectorAll<HTMLInputElement>("input[data-imei]") ?? [],
    );
    const i = inputs.indexOf(actual);
    inputs[i + 1]?.focus();
  };

  return (
    <div ref={contenedor} className="rounded-xl border border-border bg-card p-3 md:p-4">
      <div className="flex items-start gap-2">
        <Barcode className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            IMEI de los aparatos ({cargados} de {total})
          </p>
          <p className="text-xs text-muted-foreground">
            Estos productos llevan IMEI. Escanealos ahora y el POS los ofrece al
            vender; los que falten se piden en la venta.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {renglones.map((r) => {
          const casillas = casillasDe(r);
          return (
            <div key={r.itemId} className="space-y-1.5">
              <p className="text-xs font-medium text-foreground">
                {r.nombre}
                <span className="ml-1 font-normal text-muted-foreground">
                  {r.variante} · {Math.floor(r.cantidad)} u.
                </span>
              </p>
              {normalizarImei(r.rawImei) && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  Del Excel: {normalizarImei(r.rawImei)}
                </p>
              )}
              {casillas > 0 && (
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: casillas }, (_, posicion) => (
                    <Input
                      key={posicion}
                      data-imei
                      value={r.imeis[posicion] ?? ""}
                      onChange={(e) => {
                        const lista = [...r.imeis];
                        lista[posicion] = e.target.value;
                        onChange(r.itemId, lista.slice(0, casillas));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          siguiente(e.currentTarget);
                        }
                      }}
                      placeholder={`IMEI ${posicion + 1 + (normalizarImei(r.rawImei) ? 1 : 0)}`}
                      aria-label={`IMEI ${posicion + 1} de ${r.nombre}`}
                      className="h-11 font-mono text-sm"
                      autoComplete="off"
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Al aprobar con IMEI sin completar: avisa cuáles y deja volver o seguir. No
 * frena: el POS los pide igual al vender.
 */
export function AlertaImeisFaltantes({
  faltantes,
  onCompletar,
  onAprobarIgual,
}: Readonly<{
  faltantes: FaltanteImei[] | null;
  onCompletar: () => void;
  onAprobarIgual: () => void;
}>) {
  const total = faltantes ? totalFaltantes(faltantes) : 0;
  return (
    <AlertDialog
      open={faltantes !== null}
      onOpenChange={(abierto) => !abierto && onCompletar()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Faltan {total} IMEI
          </AlertDialogTitle>
          <AlertDialogDescription>
            Estos aparatos entran sin número. Si aprobás igual, el POS lo va a
            pedir cuando se vendan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
          {(faltantes ?? []).map((f) => (
            <li key={f.itemId ?? `${f.nombre}-${f.variante}`} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {f.nombre}
                <span className="ml-1 text-muted-foreground">{f.variante}</span>
              </span>
              <span className="shrink-0 font-medium">×{f.faltan}</span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCompletar}>
            Completarlos ahora
          </AlertDialogCancel>
          <AlertDialogAction onClick={onAprobarIgual}>
            Aprobar igual
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
