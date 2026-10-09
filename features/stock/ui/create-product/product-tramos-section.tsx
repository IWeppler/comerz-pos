"use client";

import { useId, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { MAX_TRAMOS_CANTIDAD, precioPorCantidad, validarTramosCantidad, type TramoCantidad } from "@/shared/lib/precio-por-cantidad";

export function ProductTramosSection({ iniciales = [], precioHabitual }: {
  iniciales?: TramoCantidad[];
  precioHabitual: string;
}) {
  const id = useId();
  const [abierto, setAbierto] = useState(iniciales.length > 0);
  const [filas, setFilas] = useState(() => iniciales.map(t => ({ desde: String(t.desde), precio: String(t.precio) })));
  const [cantidad, setCantidad] = useState("12");
  const tramos = filas.map(f => ({ desde: Number(f.desde), precio: Number(f.precio) }));
  const validos = validarTramosCantidad(tramos);
  const base = Number(precioHabitual);
  const prueba = precioPorCantidad(base, Number(cantidad), tramos);
  const editar = (indice: number, campo: "desde" | "precio", valor: string) =>
    setFilas(actuales => actuales.map((fila, i) => i === indice ? { ...fila, [campo]: valor } : fila));

  return <div className="rounded-xl border border-border overflow-hidden">
    {/* Siempre montado: colapsar la sección conserva lo que se guardará. */}
    <input type="hidden" name="precios_por_cantidad" value={JSON.stringify(tramos)} />
    <Button type="button" variant="ghost" className="w-full min-h-11 justify-between rounded-none px-4"
      aria-expanded={abierto} aria-controls={`${id}-contenido`} onClick={() => setAbierto(!abierto)}>
      <span>Precios por cantidad{filas.length > 0 ? ` · ${filas.length} tramos` : ""}</span>
      <ChevronDown className={`size-4 ${abierto ? "rotate-180" : ""}`} />
    </Button>
    <div id={`${id}-contenido`} hidden={!abierto} className="space-y-4 border-t p-4">
      <p className="text-xs text-muted-foreground">
        El precio del tramo se cobra por cada unidad del mismo producto o variante.
        Debajo del primer tramo se usa el precio habitual. Todas las variantes usan estos importes,
        pero no suman cantidades entre sí.
      </p>
      {filas.map((fila, i) => <div key={i} className="grid grid-cols-[1fr_1fr_44px] items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-desde-${i}`} className="text-xs">Desde cantidad</Label>
          <Input id={`${id}-desde-${i}`} type="number" inputMode="numeric" min="1" max="1000000000" step="1"
            required value={fila.desde} onChange={e => editar(i, "desde", e.target.value)} className="h-11" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-precio-${i}`} className="text-xs">Precio por unidad ($)</Label>
          <Input id={`${id}-precio-${i}`} type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01"
            required value={fila.precio} onChange={e => editar(i, "precio", e.target.value)} className="h-11" />
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={`Quitar tramo ${i + 1}`}
          onClick={() => setFilas(actuales => actuales.filter((_, indice) => indice !== i))}><Trash2 className="size-4" /></Button>
      </div>)}
      {!validos && <p role="alert" className="text-xs text-destructive">
        Ordená las cantidades de menor a mayor, sin repetir, y completá precios mayores a cero.
      </p>}
      <Button type="button" variant="outline" className="min-h-11" disabled={filas.length >= MAX_TRAMOS_CANTIDAD}
        onClick={() => setFilas(actuales => [...actuales, { desde: String(actuales.length ? Number(actuales.at(-1)!.desde) + 1 : 10), precio: "" }])}>
        <Plus className="size-4 mr-2" /> Agregar tramo
      </Button>
      {filas.length > 0 && <>
        <p className="text-xs text-muted-foreground">
          Los importes reemplazan el precio de lista; las promociones permitidas se calculan después.
          Se aplican a la unidad base. Los packs y otras presentaciones conservan su precio.
        </p>
        <div className="rounded-lg bg-muted/40 p-3 space-y-2">
          <Label htmlFor={`${id}-prueba`} className="text-xs">Probar cantidad</Label>
          <Input id={`${id}-prueba`} type="number" inputMode="numeric" min="1" step="1" value={cantidad}
            onChange={e => setCantidad(e.target.value)} className="h-11 max-w-28" />
          {validos && base > 0 && Number(cantidad) > 0 && <p className="text-sm tabular-nums" aria-live="polite">
            {cantidad} × ${prueba.precio.toLocaleString("es-AR")} = <strong>${(Number(cantidad) * prueba.precio).toLocaleString("es-AR")}</strong>
          </p>}
        </div>
      </>}
    </div>
  </div>;
}
