"use client";

import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  ABREVIATURA_UNIDAD,
  UNIDADES_MEDIDA,
  normalizarUnidadMedida,
  type UnidadMedida,
} from "@/shared/lib/fiscal-producto";
import {
  esFraccionable,
  formatearCantidad,
  parsearCantidadDeEntrada,
} from "@/shared/lib/unidad-venta";
import { useActiveCategories } from "@/features/stock/hooks/use-active-categories";
import { esNombreVarianteUnica } from "@/features/stock/utils/parse-legacy-variant";
import type { Rubro } from "@/entities/config/types";
import type { CampoDeFoco } from "../hooks/use-carga-rapida";
import { atributosInlineDeRubro } from "../lib/atributos-inline-por-rubro";
import type { Presentacion } from "@/shared/lib/presentaciones";
import type { LineaCarga, LineaCargaNueva } from "../types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

const FORMA_BASE = "__unidad_base__";

/** Identifica una celda concreta en el DOM. Es como el hook nombra a dónde
 * mandar el foco sin tener una ref por input: pide "esta línea, este campo" y
 * la tabla lo resuelve. */
function celdaId(linea: LineaCarga, campo: CampoDeFoco): string {
  return `${linea.clienteLineaId}:${campo}`;
}

/**
 * Una fila = un producto, una columna = un dato. Todo se carga en la misma
 * grilla y nada abre un modal: el alta de un producto nuevo son tres números
 * y dos textos, y una pantalla de por medio para eso cuesta más que la
 * carga entera.
 *
 * El modal sigue existiendo SOLO para la grilla de combinaciones (5 talles x
 * 3 colores en un producto), que es lo único que no entra en una fila.
 *
 * Las columnas de atributo las pone el RUBRO (`atributosInlineDeRubro`): talle
 * y color en una tienda de ropa, peso en un kiosco, medida y material en una
 * ferretería. Un rubro sin atributos de variante ("otros") conserva una
 * columna, porque la variante fija del maestro y el botón de la grilla
 * necesitan dónde vivir. La plantilla va como estilo inline y no como clase
 * de Tailwind porque cambia con el rubro y Tailwind solo compila lo que
 * encuentra escrito.
 */
const ANCHO_ATRIBUTO = 112;
const ANCHOS_FIJOS = [120, 104, 104, 172, 40];
const ANCHO_PRODUCTO_MIN = 180;
const GAP = 8;

function plantillaColumnas(columnasAtributo: number): string {
  const atributos = Array.from(
    { length: columnasAtributo },
    () => `${ANCHO_ATRIBUTO}px`,
  );
  const [codigo, ...resto] = ANCHOS_FIJOS;
  return [
    `minmax(${ANCHO_PRODUCTO_MIN}px,1fr)`,
    `${codigo}px`,
    ...atributos,
    ...resto.map((ancho) => `${ancho}px`),
  ].join(" ");
}

/** Ancho mínimo de la tabla. Abajo de eso el contenedor scrollea en
 * horizontal en vez de apretar las columnas hasta que no se pueda tipear. */
function anchoMinimo(columnasAtributo: number): number {
  const columnas = ANCHOS_FIJOS.length + 1 + columnasAtributo;
  return (
    ANCHO_PRODUCTO_MIN +
    ANCHOS_FIJOS.reduce((a, b) => a + b, 0) +
    columnasAtributo * ANCHO_ATRIBUTO +
    (columnas - 1) * GAP +
    // padding horizontal de la fila (px-4)
    32
  );
}

function formatearPrecio(valor: number): string {
  return `$${valor.toLocaleString("es-AR")}`;
}

function totalUnidades(
  linea: Extract<LineaCargaNueva, { tieneVariantes: true }>,
) {
  return linea.variantes.reduce(
    (total, v) => total + parsearCantidadDeEntrada(v.stock),
    0,
  );
}

/** Unidades de una línea con la variante ya resuelta por el maestro: hay una
 * sola combinación, así que su stock ES la cantidad de la línea. */
function stockVarianteFija(
  linea: Extract<LineaCargaNueva, { tieneVariantes: true }>,
): number {
  return parsearCantidadDeEntrada(linea.variantes[0]?.stock ?? "0");
}

/**
 * Enter y Escape en cualquier celda vuelven al campo de escaneo.
 *
 * Es el atajo que cierra el ciclo de la carga: terminada la fila, lo que
 * sigue SIEMPRE es el producto que sigue. La tecla "f" del POS no alcanza acá
 * porque con el foco dentro de un campo una letra suelta se escribe, no se
 * dispara (ver seguroEnCampoDeTexto en use-atajos-teclado) — y así tiene que
 * ser, o el lector de códigos dispararía atajos a mitad de un escaneo.
 *
 * Enter y no Tab: Tab ya recorre la fila celda por celda y eso también hace
 * falta. Son los dos movimientos, no uno.
 */
function alSalirDeLaCelda(
  volver: (() => void) | undefined,
): React.KeyboardEventHandler<HTMLInputElement> | undefined {
  if (!volver) return undefined;
  return (e) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    e.currentTarget.blur();
    volver();
  };
}

/** Celda numérica. `value` 0 se muestra vacío: un "0" precargado invita a
 * tipear al lado y terminar cargando 0500.
 *
 * Lo que se muestra es el TEXTO tipeado, no el número de vuelta: con el
 * número como `value`, tipear "0,5" de crema se cae en el primer "0" (vale 0,
 * se muestra vacío) y el "0." nunca llega a existir. El texto se resincroniza
 * solo cuando el valor cambia desde afuera (deshacer, reescaneo). */
function CeldaNumero({
  value,
  onChange,
  invalido,
  entero,
  titulo,
  onVolver,
  celda,
  className = "",
}: Readonly<{
  value: number;
  onChange: (valor: number) => void;
  invalido?: boolean;
  entero?: boolean;
  titulo: string;
  onVolver?: () => void;
  celda?: string;
  className?: string;
}>) {
  const [texto, setTexto] = useState(value > 0 ? String(value) : "");
  // Valor con el que se armó `texto`. Si el de afuera cambió y no es el que
  // dice el texto, el texto está viejo: se pisa durante el render (patrón de
  // "guardar el valor del render anterior"), sin efecto de por medio.
  const [valorVisto, setValorVisto] = useState(value);
  if (value !== valorVisto) {
    setValorVisto(value);
    const tipeado = Number.parseFloat(texto);
    if ((Number.isNaN(tipeado) ? 0 : tipeado) !== value) {
      setTexto(value > 0 ? String(value) : "");
    }
  }

  return (
    <Input
      type="number"
      data-celda={celda}
      aria-label={titulo}
      min={entero ? 1 : 0}
      step={entero ? 1 : "any"}
      value={texto}
      placeholder="0"
      onKeyDown={alSalirDeLaCelda(onVolver)}
      onChange={(e) => {
        const crudo = e.target.value;
        setTexto(crudo);
        const parseado = entero
          ? Number.parseInt(crudo, 10)
          : Number.parseFloat(crudo);
        onChange(Number.isNaN(parseado) ? 0 : parseado);
      }}
      className={`h-9 w-full text-center px-1 ${
        invalido ? "border-destructive focus-visible:ring-destructive" : ""
      } ${className}`}
    />
  );
}

/**
 * Por qué se vende el producto nuevo, al lado de la cantidad. Va inline y no
 * en el modal porque el modal es solo para la grilla de combinaciones, y la
 * crema del nono no tiene talles: tiene kilos.
 *
 * Es un `<select>` nativo y no el Select de Radix a propósito: en una grilla
 * que se recorre con Tab, un popover que captura el foco corta el ciclo
 * "precio, cantidad, Enter, siguiente producto".
 */
function SelectorUnidad({
  value,
  onChange,
}: Readonly<{
  value: UnidadMedida;
  onChange: (unidad: UnidadMedida) => void;
}>) {
  return (
    <select
      aria-label="Se vende por"
      title="Se vende por"
      value={value}
      onChange={(e) => onChange(normalizarUnidadMedida(e.target.value))}
      className="h-9 w-[52px] shrink-0 rounded-md border border-input bg-background px-1 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {UNIDADES_MEDIDA.map((u) => (
        <option key={u} value={u}>
          {ABREVIATURA_UNIDAD[u]}
        </option>
      ))}
    </select>
  );
}

/**
 * En qué forma entra el stock de un producto que YA existe y tiene
 * presentaciones: la unidad base ("kg") o "Balde 4,7 kg". La cantidad de la
 * fila se lee en esa forma y el server la convierte a stock por el factor.
 * Usa el mismo Select visual que el resto de la aplicación.
 */
function SelectorForma({
  unidad,
  presentaciones,
  value,
  onChange,
}: Readonly<{
  unidad: UnidadMedida;
  presentaciones: Presentacion[];
  value: string | null;
  onChange: (presentacionId: string | null) => void;
}>) {
  return (
    <Select
      value={value ?? FORMA_BASE}
      onValueChange={(next) => onChange(next === FORMA_BASE ? null : next)}
    >
      <SelectTrigger
        aria-label="Forma en que entra"
        title="Forma en que entra el stock"
        size="sm"
        className="h-9 w-[92px] shrink-0 text-xs text-muted-foreground"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value={FORMA_BASE}>
          {ABREVIATURA_UNIDAD[unidad]}
        </SelectItem>
        {presentaciones.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.nombre} · ×{p.factor} {ABREVIATURA_UNIDAD[unidad]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Celda de texto. Talle, color y código son texto libre; el nombre es lo
 * único obligatorio y por eso es el que se marca cuando falta. */
function CeldaTexto({
  value,
  onChange,
  placeholder,
  invalido,
  alineacion = "text-center",
  titulo,
  onVolver,
  celda,
}: Readonly<{
  value: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  invalido?: boolean;
  alineacion?: string;
  titulo: string;
  onVolver?: () => void;
  celda?: string;
}>) {
  return (
    <Input
      type="text"
      data-celda={celda}
      aria-label={titulo}
      value={value}
      placeholder={placeholder}
      onKeyDown={alSalirDeLaCelda(onVolver)}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 w-full px-2 ${alineacion} ${
        invalido ? "border-destructive focus-visible:ring-destructive" : ""
      }`}
    />
  );
}

/** Valor que no se edita en esta fila (precio de un producto que ya existe,
 * columna que no aplica). Se muestra igual para que la columna no quede
 * hueca y se lea de arriba abajo. */
function CeldaTextoFijo({
  children,
  titulo,
}: Readonly<{ children: React.ReactNode; titulo?: string }>) {
  return (
    <span
      title={titulo}
      className="h-9 flex items-center justify-center text-xs text-muted-foreground truncate px-1"
    >
      {children}
    </span>
  );
}

interface CargaRapidaListaProps {
  rubro: Rubro;
  lineas: LineaCarga[];
  onUpdateCantidad: (clienteLineaId: string, cantidad: number) => void;
  onUpdateUnidad: (clienteLineaId: string, unidad: UnidadMedida) => void;
  /** Forma en que entra el stock de un producto existente: null = unidad
   * base, id = una de sus presentaciones. */
  onUpdateForma: (clienteLineaId: string, presentacionId: string | null) => void;
  onUpdatePrecio: (
    clienteLineaId: string,
    campo: "precioCompra" | "precioVenta",
    valor: number,
  ) => void;
  onUpdateTexto: (
    clienteLineaId: string,
    campo: "nombre" | "codigo" | `atributo:${string}`,
    valor: string,
  ) => void;
  /** Devuelve el foco al campo de escaneo: Enter o Escape en cualquier celda. */
  onVolverAlBuscador?: () => void;
  /** Celda que tiene que recibir el foco (la fila recién agregada). */
  focoPendiente?: { clienteLineaId: string; campo: CampoDeFoco } | null;
  onFocoAplicado?: () => void;
  onRemove: (clienteLineaId: string) => void;
  onEditarNueva: (linea: LineaCargaNueva) => void;
  onConfirmar: () => void;
  isConfirming: boolean;
}

export function CargaRapidaLista({
  rubro,
  lineas,
  onUpdateCantidad,
  onUpdateUnidad,
  onUpdateForma,
  onUpdatePrecio,
  onUpdateTexto,
  onVolverAlBuscador,
  focoPendiente,
  onFocoAplicado,
  onRemove,
  onEditarNueva,
  onConfirmar,
  isConfirming,
}: Readonly<CargaRapidaListaProps>) {
  const categorias = useActiveCategories();

  // Aplica el foco que pidió el hook al crear una fila. Va por el DOM y no por
  // refs: son ocho inputs por fila y un mapa de refs que se arma y desarma con
  // cada línea es más código para el mismo efecto.
  useEffect(() => {
    if (!focoPendiente) return;
    const celda = document.querySelector<HTMLInputElement>(
      `[data-celda="${focoPendiente.clienteLineaId}:${focoPendiente.campo}"]`,
    );
    celda?.focus();
    celda?.select();
    onFocoAplicado?.();
  }, [focoPendiente, onFocoAplicado]);

  if (lineas.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground italic">
          Escaneá o escribí un producto para empezar la carga.
        </p>
      </div>
    );
  }

  // El total del pie suma solo lo que se cuenta de a uno: 3 remeras y 0,5 kg
  // de crema no son "3,5 u.". Con algo por peso o medida en la lista, el
  // botón dice solo cuántas líneas hay.
  const atributos = atributosInlineDeRubro(rubro);
  const columnasAtributo = Math.max(atributos.length, 1);
  const estiloGrilla = { gridTemplateColumns: plantillaColumnas(columnasAtributo) };
  const spanAtributos = { gridColumn: `span ${columnasAtributo}` };

  const hayFraccionables = lineas.some(
    (l) =>
      esFraccionable(l.unidadMedida) ||
      (l.kind === "EXISTENTE" && l.presentacionId !== null),
  );
  const unidades = lineas.reduce((total, linea) => {
    if (linea.kind === "EXISTENTE") return total + linea.cantidad;
    if (!linea.tieneVariantes) return total + linea.cantidad;
    return total + totalUnidades(linea);
  }, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-border rounded-xl overflow-x-auto bg-card">
        <div style={{ minWidth: anchoMinimo(columnasAtributo) }}>
          <div
            style={estiloGrilla}
            className="grid gap-2 px-4 py-2 border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"
          >
            <span>Producto</span>
            <span className="text-center">Código</span>
            {atributos.length > 0 ? (
              atributos.map((a) => (
                <span key={a.clave} className="text-center">
                  {a.etiqueta}
                </span>
              ))
            ) : (
              <span className="text-center">Variante</span>
            )}
            <span className="text-center">Costo</span>
            <span className="text-center">Venta</span>
            <span className="text-center">Cant.</span>
            <span />
          </div>

          <div className="divide-y divide-border">
            {lineas.map((linea) => {
              // Variante ya resuelta por el maestro: no hay matriz que editar,
              // se carga precio y cantidad acá mismo.
              const varianteFija =
                linea.kind === "NUEVA" &&
                linea.tieneVariantes &&
                linea.varianteFijaLabel
                  ? linea
                  : null;

              // Producto nuevo simple: todo se carga en la fila.
              const nuevaSimple =
                linea.kind === "NUEVA" && !linea.tieneVariantes ? linea : null;

              // Grilla de combinaciones armada a mano: es lo único que no
              // entra en una fila y sigue mandando al modal.
              const conGrilla =
                linea.kind === "NUEVA" && linea.tieneVariantes && !varianteFija
                  ? linea
                  : null;

              const editableInline = varianteFija ?? nuevaSimple;
              const cantidad = varianteFija
                ? stockVarianteFija(varianteFija)
                : linea.kind === "EXISTENTE" || !linea.tieneVariantes
                  ? linea.cantidad
                  : totalUnidades(linea);

              return (
                <div
                  key={linea.clienteLineaId}
                  style={estiloGrilla}
                  className="grid gap-2 px-4 py-2 items-center"
                >
                  {/* Producto */}
                  <div className="min-w-0">
                    {linea.kind === "EXISTENTE" ? (
                      <>
                        <p className="text-sm font-medium text-foreground truncate">
                          {linea.nombreProducto}
                          {/* Mismo criterio que el formulario de edición: el
                              placeholder se escribe "Único" o "Unico" según
                              por dónde entró el producto, y en los dos casos
                              no es una variante que valga la pena mostrar. */}
                          {!esNombreVarianteUnica(linea.nombreDisplay)
                            ? ` · ${linea.nombreDisplay}`
                            : ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          Ya existe
                        </p>
                      </>
                    ) : (
                      <>
                        <CeldaTexto
                          onVolver={onVolverAlBuscador}
                          titulo="Nombre del producto"
                          celda={celdaId(linea, "nombre")}
                          value={linea.nombre}
                          placeholder="Nombre del producto"
                          alineacion="text-left"
                          invalido={!linea.nombre.trim()}
                          onChange={(v) =>
                            onUpdateTexto(linea.clienteLineaId, "nombre", v)
                          }
                        />
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {linea.marca ? ` · ${linea.marca}` : ""}
                          {linea.categoriaId
                            ? ` · ${
                                categorias.find(
                                  (c) => c.id === linea.categoriaId,
                                )?.nombre ?? "categoría"
                              }`
                            : ""}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Código */}
                  {nuevaSimple ? (
                    <CeldaTexto
                      onVolver={onVolverAlBuscador}
                      titulo="Código"
                      celda={celdaId(linea, "codigo")}
                      value={nuevaSimple.codigo ?? ""}
                      placeholder="—"
                      onChange={(v) =>
                        onUpdateTexto(linea.clienteLineaId, "codigo", v)
                      }
                    />
                  ) : (
                    <CeldaTextoFijo>
                      {(linea.kind === "EXISTENTE"
                        ? linea.sku
                        : linea.codigo) || "—"}
                    </CeldaTextoFijo>
                  )}

                  {/* Atributos del rubro (talle/color, peso, medida…). Con
                      variantes ya resueltas las columnas son una sola celda:
                      los atributos viven en la grilla, no acá. */}
                  {nuevaSimple ? (
                    atributos.length > 0 ? (
                      atributos.map((a) => (
                        <CeldaTexto
                          key={a.clave}
                          onVolver={onVolverAlBuscador}
                          titulo={a.etiqueta}
                          celda={celdaId(linea, `atributo:${a.clave}`)}
                          value={nuevaSimple.atributos[a.clave] ?? ""}
                          placeholder="—"
                          onChange={(v) =>
                            onUpdateTexto(
                              linea.clienteLineaId,
                              `atributo:${a.clave}`,
                              v,
                            )
                          }
                        />
                      ))
                    ) : (
                      <CeldaTextoFijo>—</CeldaTextoFijo>
                    )
                  ) : varianteFija ? (
                    <div
                      style={spanAtributos}
                      className="flex items-center justify-center gap-1.5 min-w-0"
                    >
                      <span
                        title="Variante definida por el Catálogo Maestro"
                        className="text-[10px] uppercase font-medium tracking-wider bg-muted px-1.5 py-0.5 rounded text-muted-foreground border border-border/50 truncate"
                      >
                        {varianteFija.varianteFijaLabel}
                      </span>
                      {/* Escape para el caso raro: el maestro trae el dato
                          incompleto y hay que corregir la grilla. */}
                      <button
                        type="button"
                        onClick={() => onEditarNueva(varianteFija)}
                        className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors cursor-pointer shrink-0"
                      >
                        editar
                      </button>
                    </div>
                  ) : conGrilla ? (
                    <div style={spanAtributos} className="flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 px-2 text-xs font-medium w-full"
                        onClick={() => onEditarNueva(conGrilla)}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        {conGrilla.variantes.length} var.
                      </Button>
                    </div>
                  ) : (
                    <div style={spanAtributos}>
                      <CeldaTextoFijo>—</CeldaTextoFijo>
                    </div>
                  )}

                  {/* Costo. NO se marca inválido: es opcional a propósito
                      (ver validarLinea en confirmar-carga). */}
                  {editableInline ? (
                    <CeldaNumero
                      onVolver={onVolverAlBuscador}
                      titulo="Costo"
                      celda={celdaId(linea, "precioCompra")}
                      value={editableInline.precioCompra}
                      onChange={(v) =>
                        onUpdatePrecio(linea.clienteLineaId, "precioCompra", v)
                      }
                    />
                  ) : linea.kind === "EXISTENTE" ? (
                    <CeldaTextoFijo>
                      {formatearPrecio(linea.precioCosto)}
                    </CeldaTextoFijo>
                  ) : (
                    <CeldaNumero
                      onVolver={onVolverAlBuscador}
                      titulo="Costo"
                      celda={celdaId(linea, "precioCompra")}
                      value={linea.precioCompra}
                      onChange={(v) =>
                        onUpdatePrecio(linea.clienteLineaId, "precioCompra", v)
                      }
                    />
                  )}

                  {/* Venta. Sin esto no hay qué cobrar: queda en rojo hasta
                      cargarse. */}
                  {linea.kind === "EXISTENTE" ? (
                    <CeldaTextoFijo>
                      {formatearPrecio(linea.precioVenta)}
                    </CeldaTextoFijo>
                  ) : (
                    <CeldaNumero
                      onVolver={onVolverAlBuscador}
                      titulo="Precio de venta"
                      celda={celdaId(linea, "precioVenta")}
                      value={linea.precioVenta}
                      invalido={linea.precioVenta <= 0}
                      onChange={(v) =>
                        onUpdatePrecio(linea.clienteLineaId, "precioVenta", v)
                      }
                    />
                  )}

                  {/* Cantidad. Con grilla armada a mano no hay una cantidad
                      única: se muestran las unidades totales y se editan en
                      la grilla. */}
                  {conGrilla ? (
                    <CeldaTextoFijo titulo="Unidades de todas las combinaciones">
                      {formatearCantidad(cantidad, linea.unidadMedida)}
                    </CeldaTextoFijo>
                  ) : (
                    <div className="flex items-center gap-1">
                      {/* Entera salvo que el producto se venda por peso o
                          medida: 0,5 remeras no existe, 0,5 kg de crema sí. */}
                      <CeldaNumero
                        onVolver={onVolverAlBuscador}
                        titulo="Cantidad"
                        celda={celdaId(linea, "cantidad")}
                        value={cantidad}
                        entero={
                          linea.kind === "EXISTENTE" && linea.presentacionId
                            ? true
                            : !esFraccionable(linea.unidadMedida)
                        }
                        invalido={cantidad <= 0}
                        onChange={(v) =>
                          onUpdateCantidad(linea.clienteLineaId, v)
                        }
                        className="min-w-0"
                      />
                      {/* La unidad de un producto NUEVO se elige acá; la de
                          uno que ya existe la dice su ficha y solo se lee. */}
                      {linea.kind === "NUEVA" ? (
                        <SelectorUnidad
                          value={linea.unidadMedida}
                          onChange={(u) =>
                            onUpdateUnidad(linea.clienteLineaId, u)
                          }
                        />
                      ) : linea.presentaciones.length > 0 ? (
                        <SelectorForma
                          unidad={linea.unidadMedida}
                          presentaciones={linea.presentaciones}
                          value={linea.presentacionId}
                          onChange={(id) =>
                            onUpdateForma(linea.clienteLineaId, id)
                          }
                        />
                      ) : (
                        <span
                          title="Se vende por"
                          className="w-[52px] shrink-0 text-center text-xs text-muted-foreground"
                        >
                          {ABREVIATURA_UNIDAD[linea.unidadMedida]}
                        </span>
                      )}
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(linea.clienteLineaId)}
                    aria-label="Quitar línea"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Button
        type="button"
        className="w-full h-12 text-sm font-semibold"
        disabled={isConfirming}
        onClick={onConfirmar}
      >
        {isConfirming
          ? "Confirmando..."
          : `Confirmar carga (${lineas.length} línea${
              lineas.length === 1 ? "" : "s"
            }${hayFraccionables ? "" : ` · ${unidades} u.`})`}
        {/* El atajo se anuncia en el botón: un atajo que no está escrito en
            ningún lado lo usa quien lo programó y nadie más. */}
        {isConfirming ? null : (
          <span className="ml-2 text-[10px] font-normal opacity-70 hidden sm:inline">
            Ctrl+Espacio
          </span>
        )}
      </Button>
    </div>
  );
}
