"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import {
  ABREVIATURA_UNIDAD,
  normalizarUnidadMedida,
} from "@/shared/lib/fiscal-producto";
import { esFraccionable, redondearCantidad } from "@/shared/lib/unidad-venta";
import { topeCantidadEnForma } from "@/shared/lib/presentaciones";
import {
  parsearCantidadEs,
  parsearImporteEs,
} from "@/shared/lib/parsear-numero-es";

interface CantidadControlProps {
  cantidad: number;
  /** Precio por unidad de medida (por kilo si la unidad es KG). */
  precio: number;
  unidadMedida?: string | null;
  /** En unidad BASE (como `CartItemStore.stockMaximo`). */
  stockMaximo: number;
  onChange: (cantidad: number) => void;
  /**
   * La línea se vende por presentación (Balde 4,7 kg): la cantidad es entera
   * siempre —aunque el producto sea por kilo— y el tope es cuántas entran en
   * el stock. Va el stepper de unidad, no el teclado de peso.
   */
  presentacion?: { factor: number } | null;
}

/**
 * El control de cantidad de una línea del carrito. Son DOS controles distintos
 * según lo que se venda, y esa es toda la idea:
 *
 *  - Por unidad: el stepper -/+ de siempre. No cambia nada.
 *  - Por peso: se tipea. Un stepper con paso de un gramo necesita 750 clicks
 *    para vender 750 g, así que no hay stepper: hay teclado.
 *
 * El campo de IMPORTE es el que hace que esto sirva de verdad en un mostrador.
 * Nadie pide "0,750 kg de jamón": piden "$2000 de jamón". Con el precio por
 * kilo, el peso se despeja solo. Es la misma cuenta al revés y evita que la
 * vendedora la haga con la calculadora del celular.
 */
/**
 * Un paso del stepper: −1 o +1.
 *
 * EXISTE PARA QUE SE VEA CUÁL DE LOS DOS SE PUEDE APRETAR. Los dos botones se
 * dibujaban igual —el mismo gris tenue— y el deshabilitado solo se distinguía
 * por un `opacity-40` que sobre gris claro no se ve. O sea que la línea no
 * decía nada sobre lo más importante que puede decir: si queda otra unidad
 * para agregar. Con una sola en stock, el "+" invitaba a apretarlo y no pasaba
 * nada, que se lee como que la app se colgó.
 *
 * Habilitado: color de texto pleno y fondo al hover, como cualquier control
 * vivo. Deshabilitado: gris apagado, sin hover y sin cursor de mano — tres
 * señales en vez de una, porque en un celular no hay hover que ayude.
 */
function BotonPaso({
  onClick,
  deshabilitado,
  etiqueta,
  children,
}: Readonly<{
  onClick: () => void;
  deshabilitado: boolean;
  etiqueta: string;
  children: React.ReactNode;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      aria-label={etiqueta}
      className={`flex h-full w-8 items-center justify-center transition-colors ${
        deshabilitado
          ? "cursor-not-allowed bg-muted/40 text-muted-foreground/35"
          : "cursor-pointer text-foreground hover:bg-muted active:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function CantidadControl({
  cantidad,
  precio,
  unidadMedida,
  stockMaximo,
  onChange,
  presentacion,
}: Readonly<CantidadControlProps>) {
  const unidad = normalizarUnidadMedida(unidadMedida);
  const fraccionable = esFraccionable(unidad) && !presentacion;
  const tope = topeCantidadEnForma(stockMaximo, presentacion ?? null);

  if (!fraccionable) {
    return (
      <div className="flex h-8 items-center overflow-hidden rounded-md border border-border">
        <BotonPaso
          onClick={() => onChange(cantidad - 1)}
          deshabilitado={cantidad <= 1}
          etiqueta="Quitar una unidad"
        >
          <Minus className="h-3.5 w-3.5" />
        </BotonPaso>
        <span className="w-8 text-center font-mono text-xs font-medium text-foreground">
          {cantidad}
        </span>
        <BotonPaso
          onClick={() => onChange(cantidad + 1)}
          deshabilitado={cantidad >= tope}
          etiqueta="Agregar una unidad"
        >
          <Plus className="h-3.5 w-3.5" />
        </BotonPaso>
      </div>
    );
  }

  return (
    <ControlPorPeso
      cantidad={cantidad}
      precio={precio}
      abreviatura={ABREVIATURA_UNIDAD[unidad]}
      onChange={onChange}
    />
  );
}

function ControlPorPeso({
  cantidad,
  precio,
  abreviatura,
  onChange,
}: Readonly<{
  cantidad: number;
  precio: number;
  abreviatura: string;
  onChange: (cantidad: number) => void;
}>) {
  // Solo se guarda el BORRADOR del campo que se está tipeando; los dos valores
  // mostrados se derivan de `cantidad` en cada render. Es lo que evita tener
  // que resincronizar con un efecto cuando la cantidad cambia desde afuera
  // (otra suma del mismo producto, o el clamp por stock del store): lo que no
  // se está editando ya sale del prop, siempre.
  //
  // Hace falta un borrador porque tipear "0," es un estado intermedio inválido:
  // si cada tecla fuera al store, la coma se borraría sola mientras la
  // vendedora escribe. Se confirma al salir del campo o con Enter.
  const [borrador, setBorrador] = useState<{
    campo: "peso" | "importe";
    texto: string;
  } | null>(null);

  const pesoTexto =
    borrador?.campo === "peso" ? borrador.texto : formatearParaInput(cantidad);
  const importeTexto =
    borrador?.campo === "importe"
      ? borrador.texto
      : formatearParaInput(redondearAlPeso(cantidad * precio));

  const confirmarPeso = () => {
    const parseado = parsearCantidadEs(pesoTexto);
    setBorrador(null);
    // Texto inválido o vacío: se descarta y el input vuelve a lo que había —
    // descartar el borrador ya lo hace. Nunca se interpreta como cero: borrar
    // el campo no es pedir cero kilos.
    if (parseado === null || parseado <= 0) return;
    onChange(redondearCantidad(parseado));
  };

  const confirmarImporte = () => {
    const parseado = parsearImporteEs(importeTexto);
    setBorrador(null);
    if (parseado === null || parseado <= 0 || precio <= 0) return;
    // La cuenta al revés: cuánto pesa lo que entra en ese importe.
    onChange(redondearCantidad(parseado / precio));
  };

  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          Peso
        </span>
        <div className="flex h-8 items-center overflow-hidden rounded-md border border-border pr-2">
          <input
            type="text"
            inputMode="decimal"
            value={pesoTexto}
            onChange={(e) =>
              setBorrador({ campo: "peso", texto: e.target.value })
            }
            onFocus={(e) => {
              setBorrador({ campo: "peso", texto: pesoTexto });
              e.target.select();
            }}
            onBlur={confirmarPeso}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-full w-16 bg-transparent px-2 text-right font-mono text-xs font-medium text-foreground outline-none"
          />
          <span className="font-mono text-[10px] text-muted-foreground">
            {abreviatura}
          </span>
        </div>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          O por importe
        </span>
        <div className="flex h-8 items-center overflow-hidden rounded-md border border-border pl-2">
          <span className="font-mono text-[10px] text-muted-foreground">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={importeTexto}
            onChange={(e) =>
              setBorrador({ campo: "importe", texto: e.target.value })
            }
            onFocus={(e) => {
              setBorrador({ campo: "importe", texto: importeTexto });
              e.target.select();
            }}
            onBlur={confirmarImporte}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-full w-20 bg-transparent px-1 text-right font-mono text-xs font-medium text-foreground outline-none"
          />
        </div>
      </label>
    </div>
  );
}

/** Los importes del ticket van al peso entero, igual que el recargo por
 * método: no existe la moneda de medio peso. */
function redondearAlPeso(valor: number): number {
  return Math.round(valor);
}

/** Sin ceros de relleno y con coma, que es como se lee acá: 0,75 y no 0.750. */
function formatearParaInput(valor: number): string {
  return String(redondearCantidad(valor)).replace(".", ",");
}
