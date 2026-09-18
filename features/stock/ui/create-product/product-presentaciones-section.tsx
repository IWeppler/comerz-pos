"use client";

import { useMemo, useState } from "react";
import { Boxes, Plus, Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  ABREVIATURA_UNIDAD,
  normalizarUnidadMedida,
} from "@/shared/lib/fiscal-producto";
import { esFraccionable } from "@/shared/lib/unidad-venta";
import {
  MENSAJE_ERROR_PRESENTACION,
  precioDePresentacion,
  presentacionesDisponibles,
  validarPresentaciones,
  type ErrorPresentacion,
  type Presentacion,
  type PresentacionInput,
  type ReglaPrecioPresentacion,
} from "@/shared/lib/presentaciones";

/**
 * Presentaciones comerciales del producto: Balde 4,7 kg, Pack x10.
 *
 * UN stock, varias formas de venderlo. Cada fila dice cuántas unidades del
 * stock consume (`factor`) y a qué precio se vende; lo que "hay" de cada una
 * es `floor(stock / factor)` y se muestra, nunca se guarda. La unidad base
 * (el kilo, la unidad) no es una fila: siempre está.
 *
 * EL PRECIO NO SALE DEL FACTOR. Cada fila elige: precio fijo (lo normal —
 * el balde vale lo que la dueña decida) o "heredado" (base × factor, para el
 * pack sin descuento que tiene que seguir al precio base cuando cambie).
 *
 * COLAPSADA Y SIN MONTAR SUS INPUTS hasta que se abre, igual que precios por
 * lista y el bloque fiscal: la action mira el centinela
 * `presentaciones_editables`, así corregir un precio desde la edición rápida
 * no puede borrarle los packs a un producto. Una vez abierta, el centinela
 * queda montado aunque se vuelva a cerrar: lo editado no se pierde por
 * plegar la sección.
 *
 * Todo viaja en UN input oculto como JSON: son filas de forma fija y el
 * conjunto entero reemplaza al guardado (ver guardarPresentaciones en
 * edit-product.ts).
 */

type Fila = PresentacionInput & { clave: string };

type VarianteOpcion = { id: string; nombre_display: string; stock: number };

function nuevaFila(orden: number): Fila {
  return {
    clave: crypto.randomUUID(),
    variante_id: null,
    nombre: "",
    factor: Number.NaN,
    regla_precio: "FIJO",
    precio: null,
    costo: null,
    sku: null,
    es_default: false,
    visible_catalogo: true,
    activa: true,
    orden,
  };
}

function desdeGuardada(p: Presentacion, orden: number): Fila {
  return {
    clave: p.id,
    id: p.id,
    variante_id: p.variante_id,
    nombre: p.nombre,
    factor: Number(p.factor),
    regla_precio: p.regla_precio === "HEREDADO" ? "HEREDADO" : "FIJO",
    precio: p.precio == null ? null : Number(p.precio),
    costo: p.costo == null ? null : Number(p.costo),
    sku: p.sku,
    es_default: p.es_default,
    visible_catalogo: p.visible_catalogo !== false,
    activa: p.activa,
    orden: p.orden ?? orden,
  };
}

/** El número que ve el input: vacío cuando no hay valor, nunca "NaN". */
function textoNumero(valor: number | null): string {
  return valor === null || Number.isNaN(valor) ? "" : String(valor);
}

function leerNumero(texto: string): number | null {
  if (texto.trim() === "") return null;
  const n = Number(texto.replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

export function ProductPresentacionesSection({
  presentacionesIniciales,
  unidadMedida,
  variantes,
  precioVenta,
}: Readonly<{
  presentacionesIniciales: Presentacion[] | undefined;
  /** La unidad de STOCK del producto, contra la que se valida el factor. */
  unidadMedida: string | null | undefined;
  /** Para el alcance ("todas" o una) y para "disponibles". */
  variantes: VarianteOpcion[];
  /** Lo que se está por guardar como precio base, para el ejemplo de
   * "heredado". */
  precioVenta: string;
}>) {
  const [abierta, setAbierta] = useState(false);
  const [tocada, setTocada] = useState(false);
  const [filas, setFilas] = useState<Fila[]>(() =>
    [...(presentacionesIniciales ?? [])]
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      .map(desdeGuardada),
  );

  const unidad = normalizarUnidadMedida(unidadMedida);
  const abreviatura = ABREVIATURA_UNIDAD[unidad];
  const fraccionable = esFraccionable(unidad);
  const precioBase = Number(precioVenta) || 0;
  const stockTotal = variantes.reduce((t, v) => t + (Number(v.stock) || 0), 0);

  const errores = useMemo(() => {
    const porFila = new Map<number, ErrorPresentacion[]>();
    for (const e of validarPresentaciones(filas, unidad)) {
      porFila.set(e.indice, [...(porFila.get(e.indice) ?? []), e.error]);
    }
    return porFila;
  }, [filas, unidad]);

  function actualizar(clave: string, cambios: Partial<Fila>) {
    setFilas((prev) =>
      prev.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)),
    );
  }

  function marcarDefault(clave: string, valor: boolean) {
    setFilas((prev) =>
      prev.map((f) => {
        if (f.clave === clave) return { ...f, es_default: valor };
        // Una sola default por alcance: marcar una desmarca a la otra del
        // mismo alcance en vez de dejar que la validación lo rechace.
        const objetivo = prev.find((x) => x.clave === clave);
        if (valor && objetivo && f.variante_id === objetivo.variante_id) {
          return { ...f, es_default: false };
        }
        return f;
      }),
    );
  }

  function agregar() {
    setFilas((prev) => [...prev, nuevaFila(prev.length)]);
  }

  function quitar(clave: string) {
    setFilas((prev) =>
      prev
        .filter((f) => f.clave !== clave)
        .map((f, i) => ({ ...f, orden: i })),
    );
  }

  const activas = filas.filter((f) => f.activa).length;

  // Lo que viaja. Sin la clave local, y el precio solo cuando es FIJO.
  const payload = JSON.stringify(
    filas.map((f) => {
      const { clave, ...sinClave } = f;
      void clave;
      return {
        ...sinClave,
        precio: f.regla_precio === "FIJO" ? f.precio : null,
      };
    }),
  );

  return (
    <div className="rounded-xl border border-border">
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setAbierta((v) => !v);
          setTocada(true);
        }}
        className="flex h-auto w-full items-center justify-between px-4 py-3 hover:bg-muted/40"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Boxes className="h-4 w-4 text-muted-foreground" />
          Presentaciones
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          {activas > 0
            ? `${activas} además de ${abreviatura === "u." ? "la unidad" : `el ${abreviatura}`}`
            : `Se vende por ${abreviatura}`}
        </span>
      </Button>

      {tocada && (
        <>
          <input type="hidden" name="presentaciones_editables" value="1" />
          <input type="hidden" name="presentaciones" value={payload} />
        </>
      )}

      {abierta && (
        <div className="space-y-4 border-t border-border px-4 py-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Una presentación es una forma de vender el MISMO stock: el balde
            descuenta 4,7 kg, el pack descuenta 10 unidades. El precio lo ponés
            vos — el factor dice cuánto stock se va, no cuánto vale.
            {fraccionable
              ? " Lo suelto (0,750 kg) se sigue vendiendo en la unidad base."
              : ""}
          </p>

          {filas.map((fila, indice) => {
            const erroresFila = errores.get(indice) ?? [];
            const tiene = (e: ErrorPresentacion) => erroresFila.includes(e);
            const heredado = fila.regla_precio === "HEREDADO";
            const precioVista = precioDePresentacion(
              {
                regla_precio: fila.regla_precio,
                precio: fila.precio,
                factor: Number.isFinite(fila.factor) ? fila.factor : 0,
              },
              precioBase,
            );
            const stockAlcance = fila.variante_id
              ? (variantes.find((v) => v.id === fila.variante_id)?.stock ?? 0)
              : stockTotal;
            const disponibles = Number.isFinite(fila.factor)
              ? presentacionesDisponibles(stockAlcance, fila.factor)
              : null;

            return (
              <div
                key={fila.clave}
                className={`space-y-3 rounded-lg border p-3 ${
                  erroresFila.length > 0 ? "border-destructive/60" : "border-border"
                }`}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nombre</Label>
                    <Input
                      value={fila.nombre}
                      placeholder={fraccionable ? "Balde 4,7 kg" : "Pack x10"}
                      onChange={(e) =>
                        actualizar(fila.clave, { nombre: e.target.value })
                      }
                      className={`rounded-lg shadow-none ${
                        tiene("NOMBRE_VACIO") || tiene("NOMBRE_DUPLICADO")
                          ? "border-destructive"
                          : ""
                      }`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Consume ({abreviatura})
                    </Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={fraccionable ? "any" : 1}
                      value={textoNumero(fila.factor)}
                      placeholder={fraccionable ? "4,7" : "10"}
                      onChange={(e) =>
                        actualizar(fila.clave, {
                          factor: leerNumero(e.target.value) ?? Number.NaN,
                        })
                      }
                      className={`rounded-lg shadow-none ${
                        tiene("FACTOR_INVALIDO") || tiene("FACTOR_ENTERO")
                          ? "border-destructive"
                          : ""
                      }`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr_1fr]">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Precio</Label>
                    <select
                      value={fila.regla_precio}
                      onChange={(e) =>
                        actualizar(fila.clave, {
                          regla_precio: e.target
                            .value as ReglaPrecioPresentacion,
                        })
                      }
                      className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm"
                    >
                      <option value="FIJO">Fijo</option>
                      <option value="HEREDADO">Base × factor</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">$ Venta</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      disabled={heredado}
                      value={heredado ? "" : textoNumero(fila.precio)}
                      placeholder={
                        heredado
                          ? precioVista !== null
                            ? `${precioVista} (base × factor)`
                            : "Falta precio base o factor"
                          : "45000"
                      }
                      onChange={(e) =>
                        actualizar(fila.clave, {
                          precio: leerNumero(e.target.value),
                        })
                      }
                      className={`rounded-lg shadow-none ${
                        tiene("PRECIO_FIJO_INVALIDO") ? "border-destructive" : ""
                      }`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">$ Costo (opcional)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={textoNumero(fila.costo)}
                      placeholder="Costo de la presentación"
                      onChange={(e) =>
                        actualizar(fila.clave, {
                          costo: leerNumero(e.target.value),
                        })
                      }
                      className={`rounded-lg shadow-none ${
                        tiene("COSTO_NEGATIVO") ? "border-destructive" : ""
                      }`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr]">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Código / EAN (opcional)</Label>
                    <Input
                      value={fila.sku ?? ""}
                      placeholder="Escanealo si el pack tiene el suyo"
                      onChange={(e) =>
                        actualizar(fila.clave, {
                          sku: e.target.value.trim() || null,
                        })
                      }
                      className={`rounded-lg shadow-none ${
                        tiene("SKU_DUPLICADO") ? "border-destructive" : ""
                      }`}
                    />
                  </div>
                  {variantes.length > 1 ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Aplica a</Label>
                      <select
                        value={fila.variante_id ?? ""}
                        onChange={(e) =>
                          actualizar(fila.clave, {
                            variante_id: e.target.value || null,
                            es_default: false,
                          })
                        }
                        className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm"
                      >
                        <option value="">Todas las variantes</option>
                        {variantes.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.nombre_display}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={fila.es_default}
                      onChange={(e) => marcarDefault(fila.clave, e.target.checked)}
                    />
                    Predeterminada en el POS
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {disponibles === null
                      ? ""
                      : `${disponibles} disponibles con el stock actual`}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-destructive"
                    onClick={() => quitar(fila.clave)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Quitar
                  </Button>
                </div>

                {erroresFila.length > 0 ? (
                  <p className="text-[11px] leading-tight text-destructive">
                    {erroresFila
                      .map((e) => MENSAJE_ERROR_PRESENTACION[e])
                      .join(" ")}
                  </p>
                ) : null}
              </div>
            );
          })}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={agregar}
            className="rounded-lg"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Agregar presentación
          </Button>
        </div>
      )}
    </div>
  );
}
