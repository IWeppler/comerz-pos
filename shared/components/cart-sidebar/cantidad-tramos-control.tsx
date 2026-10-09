"use client";

import { useId, useState } from "react";
import { Minus, Pencil, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { normalizarCantidadVendible, pasoCantidad, formatearCantidad, esFraccionable } from "@/shared/lib/unidad-venta";
import { precioPorCantidad, type TramoCantidad } from "@/shared/lib/precio-por-cantidad";

interface Props {
  cantidad: number;
  stockMaximo: number;
  unidadMedida?: string | null;
  productoNombre?: string;
  precioHabitual: number;
  tramos: TramoCantidad[];
  onChange: (cantidad: number) => void;
}

/** Cantidades grandes: tipear en un diálogo evita el teclado dentro de Vaul. */
export function CantidadTramosControl(props: Props) {
  const [abierto, setAbierto] = useState(false);
  const paso = pasoCantidad(props.unidadMedida);
  return <>
    <div className="flex h-11 items-center overflow-hidden rounded-md border border-border">
      <button type="button" aria-label="Quitar una unidad" disabled={props.cantidad <= paso}
        onClick={() => props.onChange(props.cantidad - paso)} className="h-11 w-11 flex items-center justify-center disabled:text-muted-foreground/35 hover:bg-muted">
        <Minus className="size-4" />
      </button>
      <button type="button" aria-label={`Cambiar cantidad de ${props.productoNombre ?? "la línea"}`}
        onClick={() => setAbierto(true)} className="h-11 min-w-11 px-1 flex items-center justify-center gap-1 font-mono text-sm hover:bg-muted">
        {formatearCantidad(props.cantidad, props.unidadMedida)}<Pencil className="size-3 text-muted-foreground" />
      </button>
      <button type="button" aria-label="Agregar una unidad" disabled={props.cantidad >= props.stockMaximo}
        onClick={() => props.onChange(props.cantidad + paso)} className="h-11 w-11 flex items-center justify-center disabled:text-muted-foreground/35 hover:bg-muted">
        <Plus className="size-4" />
      </button>
    </div>
    <Dialog open={abierto} onOpenChange={setAbierto}>
      {abierto && <EditorCantidad {...props} cerrar={() => setAbierto(false)} />}
    </Dialog>
  </>;
}

function EditorCantidad({ cerrar, ...props }: Props & { cerrar: () => void }) {
  const id = useId();
  const [texto, setTexto] = useState(String(props.cantidad));
  const cantidad = normalizarCantidadVendible(texto, props.unidadMedida);
  const valida = cantidad !== null && cantidad <= props.stockMaximo;
  const precio = precioPorCantidad(props.precioHabitual, cantidad ?? 0, props.tramos);
  const aplicar = () => { if (valida) { props.onChange(cantidad!); cerrar(); } };
  return <DialogContent className="top-4 w-[calc(100%-2rem)] translate-y-0 grid-cols-1 gap-4 *:min-w-0 sm:top-1/2 sm:max-w-sm sm:-translate-y-1/2">
    <DialogHeader>
      <DialogTitle>Cambiar cantidad</DialogTitle>
      <DialogDescription>{props.productoNombre ?? "Producto"}. El precio se ajusta al tramo de la cantidad elegida.</DialogDescription>
    </DialogHeader>
    <div className="space-y-2">
      <Label htmlFor={id}>Cantidad</Label>
      <Input id={id} type="number" inputMode={esFraccionable(props.unidadMedida) ? "decimal" : "numeric"}
        min={pasoCantidad(props.unidadMedida)} max={props.stockMaximo} step={pasoCantidad(props.unidadMedida)}
        value={texto} onChange={e => setTexto(e.target.value)} onFocus={e => e.currentTarget.select()}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); aplicar(); } }} className="h-14 text-lg md:text-lg" />
      {valida ? <p className="text-sm tabular-nums" aria-live="polite">
        {formatearCantidad(cantidad, props.unidadMedida)} × ${precio.precio.toLocaleString("es-AR")} = <strong>${(cantidad * precio.precio).toLocaleString("es-AR")}</strong>
      </p> : <p role="alert" className="text-xs text-destructive">Ingresá una cantidad válida, hasta {props.stockMaximo.toLocaleString("es-AR")}.</p>}
    </div>
    <Button type="button" disabled={!valida} onClick={aplicar} className="min-h-11">Aplicar cantidad</Button>
  </DialogContent>;
}
