"use client";

import { useRef, useState } from "react";
import { Barcode, Loader2, PackageCheck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { normalizarImei } from "@/entities/ventas/imei";
import type { AparatoAEntregar } from "../actions/ordenes";

/**
 * Entregar una orden con celulares: un IMEI por aparato antes de marcarla.
 *
 * Se escanea o se elige de los que hay en stock (un toque). El lector termina
 * con Enter: salta al aparato siguiente y, en el último, entrega. La base
 * vuelve a validar todo (IMEI en stock de ESE modelo, o nuevo) y ata los
 * aparatos y la entrega en una sola transacción.
 */
export function EntregarImeiDialog({
  numero,
  aparatos,
  abierto,
  enviando,
  error,
  onCerrar,
  onEntregar,
}: Readonly<{
  numero: string;
  aparatos: AparatoAEntregar[];
  abierto: boolean;
  enviando: boolean;
  error: string | null;
  onCerrar: () => void;
  onEntregar: (unidades: { itemId: string; imei: string }[]) => void;
}>) {
  const [imeis, setImeis] = useState<Record<string, string>>({});
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const valores = aparatos.map((a) => normalizarImei(imeis[a.itemId]));
  const repetidos = new Set(valores.filter((v, i) => v && valores.indexOf(v) !== i));
  const completos = valores.every(Boolean) && repetidos.size === 0;
  const usados = new Set(valores.filter(Boolean));

  const entregar = () => {
    if (!completos || enviando) return;
    onEntregar(aparatos.map((a, i) => ({ itemId: a.itemId, imei: valores[i] })));
  };

  const poner = (itemId: string, imei: string) => setImeis((prev) => ({ ...prev, [itemId]: imei }));

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !enviando && onCerrar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Entregar la orden {numero}</DialogTitle>
          <DialogDescription>
            {aparatos.length === 1
              ? "Escaneá o elegí el IMEI del aparato que entregás."
              : `Escaneá o elegí el IMEI de cada uno de los ${aparatos.length} aparatos que entregás.`}
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-4">
          {aparatos.map((aparato, i) => {
            const valor = imeis[aparato.itemId] ?? "";
            const repetido = repetidos.has(normalizarImei(valor));
            const sugeridos = aparato.disponibles.filter((d) => !usados.has(d) || d === normalizarImei(valor));
            return (
              <li key={aparato.itemId} className="space-y-2">
                <label htmlFor={`imei-${aparato.itemId}`} className="block text-sm font-medium">
                  {aparatos.length > 1 && <span className="text-muted-foreground">{i + 1}. </span>}
                  {aparato.nombre}
                  {aparato.variante && <span className="font-normal text-muted-foreground"> · {aparato.variante}</span>}
                </label>
                <div className="relative">
                  <Barcode className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id={`imei-${aparato.itemId}`}
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    value={valor}
                    onChange={(e) => poner(aparato.itemId, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const siguiente = refs.current[i + 1];
                      if (siguiente) siguiente.focus();
                      else entregar();
                    }}
                    placeholder="Escaneá o escribí el IMEI"
                    autoComplete="off"
                    autoFocus={i === 0}
                    aria-invalid={repetido}
                    className="h-12 pl-9 font-mono text-sm"
                  />
                </div>
                {repetido && <p className="text-xs font-medium text-destructive">Ese IMEI ya está en otro aparato.</p>}
                {sugeridos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="w-full text-xs text-muted-foreground">En stock:</span>
                    {sugeridos.slice(0, 6).map((imei) => {
                      const elegido = normalizarImei(valor) === imei;
                      return (
                        <button
                          key={imei}
                          type="button"
                          onClick={() => {
                            poner(aparato.itemId, imei);
                            refs.current[i + 1]?.focus();
                          }}
                          className={`min-h-9 rounded-full border px-3 font-mono text-xs transition-colors ${
                            elegido
                              ? "border-foreground bg-foreground text-background"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          {imei}
                        </button>
                      );
                    })}
                    {sugeridos.length > 6 && (
                      <span className="self-center text-xs text-muted-foreground">y {sugeridos.length - 6} más</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" onClick={onCerrar} disabled={enviando}>
            Volver
          </Button>
          <Button
            className="h-11 transition-transform duration-150 ease-out active:scale-[0.97]"
            onClick={entregar}
            disabled={!completos || enviando}
          >
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
            Entregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
