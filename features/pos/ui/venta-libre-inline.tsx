"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useCartStore } from "@/shared/store/cart-store";
import { useVentaLibreStore } from "@/shared/store/venta-libre-store";
import { parsearImporteEs } from "@/shared/lib/parsear-numero-es";
import {
  crearLineaVentaLibre,
  DESCRIPCION_LIBRE_MAX,
  validarVentaLibre,
} from "../lib/venta-libre";

/**
 * El renglón de VENTA LIBRE del ticket: cobrar algo que no está cargado.
 *
 * Dos estados y nada más:
 *
 *  - Cerrado: una sola fila finita, "＋ Venta libre · V", al pie de las
 *    líneas. Ocupa lo que una línea de texto; con el ticket vacío es lo único
 *    que hay debajo del dibujo del carrito.
 *  - Abierto: descripción y precio en la MISMA fila, Enter agrega. Sin modal,
 *    sin paso extra: la clienta ya dijo "12 globos sueltos" y "$1.500", y
 *    eso son dos campos y una tecla.
 *
 * Después de agregar se CIERRA, y es a propósito. Lo normal es un renglón
 * libre en un ticket de productos cargados; dejarlo abierto le roba altura a
 * las líneas que sí importan. Para cargar dos seguidos, V de nuevo (o el
 * botón) — el foco vuelve solo a la descripción.
 *
 * Quién lo abre no es solo el botón: la tecla V y la grilla ("Vender 'X' sin
 * cargarlo", cuando la búsqueda no encuentra nada) llegan por
 * `useVentaLibreStore`, con la descripción ya puesta. Ver el store.
 */
export function VentaLibreInline() {
  const abierto = useVentaLibreStore((s) => s.abierto);
  const apertura = useVentaLibreStore((s) => s.apertura);
  const abrir = useVentaLibreStore((s) => s.abrir);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => abrir()}
        className="flex w-full items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-left text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-foreground cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Venta libre
        </span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium sm:inline">
          V
        </kbd>
      </button>
    );
  }

  // `key={apertura}`: cada apertura es un formulario NUEVO, que arranca con
  // la descripción con la que se pidió abrir (la búsqueda de la grilla, o
  // nada). Es lo que evita un efecto que "resetee" el estado —y, de paso, que
  // una V con el formulario ya abierto lo reinicie con el texto nuevo.
  return <FormularioVentaLibre key={apertura} />;
}

function FormularioVentaLibre() {
  const descripcionInicial = useVentaLibreStore((s) => s.descripcionInicial);
  const cerrar = useVentaLibreStore((s) => s.cerrar);
  const addItem = useCartStore((s) => s.addItem);

  const [descripcion, setDescripcion] = useState(descripcionInicial);
  const [precioTexto, setPrecioTexto] = useState("");
  const [error, setError] = useState<string | null>(null);

  const descripcionRef = useRef<HTMLInputElement>(null);
  const precioRef = useRef<HTMLInputElement>(null);

  // El foco va al campo que falta llenar: con descripción ya puesta, directo
  // al precio.
  const enfocarPrecio = Boolean(descripcionInicial);

  const agregar = () => {
    const precio = parsearImporteEs(precioTexto);
    const validado = validarVentaLibre({
      descripcion,
      precio: precio ?? Number.NaN,
    });
    if (!validado.ok) {
      setError(validado.error);
      // El foco al campo que está mal, para corregir sin el mouse.
      (validado.error.includes("precio") ? precioRef : descripcionRef).current?.focus();
      return;
    }
    addItem(crearLineaVentaLibre(validado.valor));
    cerrar();
  };

  const alTeclear = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter en la descripción con el precio vacío salta al precio; con
      // los dos llenos, agrega. Es el flujo de tipear de corrido.
      if (e.currentTarget === descripcionRef.current && !precioTexto.trim()) {
        precioRef.current?.focus();
        return;
      }
      agregar();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cerrar();
    }
  };

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
      <div className="flex items-center gap-1.5">
        <input
          ref={descripcionRef}
          type="text"
          autoFocus={!enfocarPrecio}
          value={descripcion}
          maxLength={DESCRIPCION_LIBRE_MAX}
          placeholder="Qué cobrás (ej. 12 globos sueltos)"
          aria-label="Descripción de la venta libre"
          onChange={(e) => {
            setDescripcion(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={alTeclear}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
        />
        <div className="flex h-8 w-24 shrink-0 items-center overflow-hidden rounded-md border border-border bg-background pl-2 focus-within:border-primary">
          <span className="font-mono text-[10px] text-muted-foreground">$</span>
          <input
            ref={precioRef}
            type="text"
            autoFocus={enfocarPrecio}
            inputMode="decimal"
            value={precioTexto}
            placeholder="0"
            aria-label="Precio de la venta libre"
            onChange={(e) => {
              setPrecioTexto(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={alTeclear}
            className="h-full w-full bg-transparent px-1 text-right font-mono text-xs font-medium text-foreground outline-none"
          />
        </div>
        <button
          type="button"
          onClick={agregar}
          aria-label="Agregar al ticket"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={cerrar}
          aria-label="Cancelar venta libre"
          className="flex h-8 w-7 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {error ? (
        <p className="mt-1.5 text-[11px] font-medium text-destructive">{error}</p>
      ) : (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          No descuenta stock. Enter agrega, Esc cancela.
        </p>
      )}
    </div>
  );
}
