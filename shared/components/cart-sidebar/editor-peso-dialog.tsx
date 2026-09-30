"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { redondearCantidad } from "@/shared/lib/unidad-venta";
import {
  parsearCantidadEs,
  parsearImporteEs,
} from "@/shared/lib/parsear-numero-es";

type Modo = "peso" | "importe";

interface EditorPesoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productoNombre?: string;
  cantidad: number;
  /** Precio por unidad de medida (por kilo si es KG). */
  precio: number;
  /** "kg", "g", "l", "m": como lo dice el ticket. */
  abreviatura: string;
  onCantidad: (cantidad: number) => void;
  onImporte?: (importe: number) => void;
}

/** Atajos por unidad. El mostrador pide "un cuarto", "medio kilo", "$2000". */
const ATAJOS_PESO: Record<string, { etiqueta: string; valor: number }[]> = {
  kg: [
    { etiqueta: "100 g", valor: 0.1 },
    { etiqueta: "250 g", valor: 0.25 },
    { etiqueta: "½ kg", valor: 0.5 },
    { etiqueta: "1 kg", valor: 1 },
  ],
};
const ATAJOS_PESO_GENERICOS = [0.5, 1, 2, 5];
const ATAJOS_IMPORTE = [1000, 2000, 5000, 10000];

/**
 * Peso o importe de una línea por peso, EN CELULAR.
 *
 * Existe porque los inputs vivían adentro del drawer del ticket (vaul), y en
 * el celular eso se rompía: al abrir el teclado vaul reescribe el alto y la
 * posición del drawer (`repositionInputs`), y con Enter/blur esa cuenta se
 * desincronizaba y el drawer quedaba trabado — la vendedora tenía que cerrar
 * la app. Además los campos medían 32px con letra de 12px: chicos para un
 * dedo y para leer de lejos.
 *
 * Acá el campo es uno solo, grande, arriba de la pantalla (el teclado no lo
 * tapa), con la cuenta al revés en vivo y atajos para lo que más se pide.
 * Nada se guarda hasta "Listo": cancelar deja la línea como estaba.
 */
export function EditorPesoDialog({
  open,
  onOpenChange,
  productoNombre,
  cantidad,
  precio,
  abreviatura,
  onCantidad,
  onImporte,
}: Readonly<EditorPesoDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Montado solo abierto: cada apertura arranca del valor actual de la
          línea, sin efectos que resincronicen. */}
      {open && (
        <ContenidoEditor
          productoNombre={productoNombre}
          cantidad={cantidad}
          precio={precio}
          abreviatura={abreviatura}
          onCerrar={() => onOpenChange(false)}
          onCantidad={onCantidad}
          onImporte={onImporte}
        />
      )}
    </Dialog>
  );
}

function ContenidoEditor({
  productoNombre,
  cantidad,
  precio,
  abreviatura,
  onCerrar,
  onCantidad,
  onImporte,
}: Readonly<
  Omit<EditorPesoDialogProps, "open" | "onOpenChange"> & { onCerrar: () => void }
>) {
  // Se arranca por importe: en el mostrador se pide "$2000 de jamón", no
  // "0,750 kg". Sin precio no hay cuenta posible y queda solo el peso.
  const [modo, setModo] = useState<Modo>(precio > 0 ? "importe" : "peso");
  const [texto, setTexto] = useState("");

  const valor =
    modo === "peso" ? parsearCantidadEs(texto) : parsearImporteEs(texto);
  const valido = valor !== null && valor > 0;

  // La cuenta al revés, en vivo: lo que se va a cobrar o lo que va a pesar.
  const resultado = !valido
    ? null
    : modo === "peso"
      ? `$${Math.round(redondearCantidad(valor) * precio).toLocaleString("es-AR")}`
      : precio > 0
        ? `${formatear(redondearCantidad(valor / precio))} ${abreviatura}`
        : null;

  const confirmar = () => {
    if (!valido) return;
    if (modo === "peso") {
      onCantidad(redondearCantidad(valor));
    } else if (onImporte) {
      // Cobrar EXACTO lo pedido (importe-por-peso.ts).
      onImporte(valor);
    } else if (precio > 0) {
      onCantidad(redondearCantidad(valor / precio));
    }
    onCerrar();
  };

  const atajosPeso =
    ATAJOS_PESO[abreviatura] ??
    ATAJOS_PESO_GENERICOS.map((v) => ({
      etiqueta: `${formatear(v)} ${abreviatura}`,
      valor: v,
    }));

  return (
    <DialogContent
      // Arriba y no centrado: con el teclado abierto, el centro de la
      // pantalla queda debajo del teclado.
      //
      // `grid-cols-1` + `min-w-0` en los hijos: el DialogContent es un grid
      // sin columnas, y una columna implícita crece al ancho NATURAL del
      // contenido. El input de 30px mide ~20 caracteres (su `size` por
      // defecto), así que el modal se salía por la derecha en el celular.
      className="top-4 w-[calc(100%-2rem)] translate-y-0 grid-cols-1 gap-5 *:min-w-0 sm:top-1/2 sm:max-w-sm sm:-translate-y-1/2"
    >
      <DialogHeader>
        <DialogTitle className="pr-8 text-base">
          {productoNombre ?? "Cantidad"}
        </DialogTitle>
        <DialogDescription>
          Ahora: {formatear(cantidad)} {abreviatura} · $
          {Math.round(cantidad * precio).toLocaleString("es-AR")}
          {precio > 0 && ` · $${precio.toLocaleString("es-AR")}/${abreviatura}`}
        </DialogDescription>
      </DialogHeader>

      {precio > 0 && (
        <div
          role="tablist"
          aria-label="Cargar por"
          className="grid grid-cols-2 rounded-lg bg-muted p-1"
        >
          {(["importe", "peso"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={modo === m}
              onClick={() => {
                setModo(m);
                setTexto("");
              }}
              className={`h-11 min-w-0 truncate rounded-md px-2 text-sm font-semibold transition-colors ${
                modo === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {m === "importe" ? "Por importe ($)" : `Por peso (${abreviatura})`}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          confirmar();
        }}
        className="space-y-3"
      >
        <label className="flex h-16 items-center gap-2 rounded-xl border-2 border-border px-4 focus-within:border-primary">
          {modo === "importe" && (
            <span className="font-mono text-2xl text-muted-foreground">$</span>
          )}
          <input
            // Una key por modo: al cambiar de modo el campo arranca vacío y
            // con el teclado correcto.
            key={modo}
            autoFocus
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={modo === "importe" ? "2000" : "0,750"}
            aria-label={modo === "importe" ? "Importe" : "Peso"}
            // Sin ancho intrínseco: que lo decida el flex, no el `size`.
            size={1}
            className="w-full min-w-0 flex-1 bg-transparent text-right font-mono text-3xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/40"
          />
          {modo === "peso" && (
            <span className="font-mono text-lg text-muted-foreground">
              {abreviatura}
            </span>
          )}
        </label>

        <p className="h-5 text-right font-mono text-sm text-muted-foreground">
          {resultado && <>= {resultado}</>}
        </p>

        <div className="grid grid-cols-4 gap-2">
          {modo === "importe"
            ? ATAJOS_IMPORTE.map((v) => (
                <Atajo
                  key={v}
                  etiqueta={`$${v.toLocaleString("es-AR")}`}
                  onClick={() => setTexto(String(v))}
                />
              ))
            : atajosPeso.map((a) => (
                <Atajo
                  key={a.etiqueta}
                  etiqueta={a.etiqueta}
                  onClick={() => setTexto(formatear(a.valor))}
                />
              ))}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className="h-12 text-base"
            onClick={onCerrar}
          >
            Cancelar
          </Button>
          <Button type="submit" className="h-12 text-base" disabled={!valido}>
            Listo
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

function Atajo({
  etiqueta,
  onClick,
}: Readonly<{ etiqueta: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-11 min-w-0 truncate rounded-lg border border-border px-1 font-mono text-xs font-medium text-foreground active:bg-muted"
    >
      {etiqueta}
    </button>
  );
}

/** Con coma y sin ceros de relleno: 0,75 y no 0.750. */
function formatear(valor: number): string {
  return String(redondearCantidad(valor)).replace(".", ",");
}
