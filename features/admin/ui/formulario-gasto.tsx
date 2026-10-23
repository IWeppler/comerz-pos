"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { SelectSimple } from "./select-simple";
import type { GastoComerz } from "@/features/admin/actions/gastos-comerz";
import { CATEGORIAS_GASTO } from "@/features/admin/lib/categorias-gasto";
import { formatearMoneda } from "@/shared/utils/formatters";

/** Los comercios y cobros a los que se puede atar una comisión. */
export interface OrigenesGasto {
  comercios: { id: string; nombre: string }[];
  pagos: { id: string; negocioId: string; monto: number; fecha: string }[];
}

/** "2026-10-23" → "23/10". */
const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * El mismo formulario para anotar y para corregir.
 *
 * Con `gasto` se precarga y manda el `id` (edición); sin él, es un alta. Que
 * sean el mismo componente es lo que evita que los dos se desincronicen —
 * agregar un campo en uno y olvidarlo en el otro. Vive en su propio archivo
 * porque lo usan dos pantallas distintas: el botón del encabezado y la lista
 * de gastos del mes.
 *
 * Dos cosas nuevas (ver docs/finanzas-comerz.md):
 *  - Moneda: un gasto puede estar en dólares. El monto que se tipea es el de
 *    esa moneda; el equivalente en pesos lo calcula el SERVIDOR con el MEP, no
 *    este formulario.
 *  - Comisión: ata el gasto al comercio cuyo primer cobro lo origina (el
 *    sueldo de Romina es lo que paga la primera suscripción de cada cliente
 *    que consigue).
 */
export function FormularioGasto({
  gasto,
  origenes,
  accion,
  error,
  guardando,
  onCancelar,
}: Readonly<{
  gasto?: GastoComerz;
  origenes?: OrigenesGasto;
  accion: (formData: FormData) => void;
  error: string | null;
  guardando: boolean;
  onCancelar: () => void;
}>) {
  // El campo `hasta` solo tiene sentido en un FIJO, y la base lo frena con un
  // CHECK. Se sigue en estado para poder mostrarlo/esconderlo al vuelo.
  const [tipo, setTipo] = useState<string>(gasto?.tipo ?? "UNICO");
  const [categoria, setCategoria] = useState<string>(gasto?.categoria ?? "infra");
  const [moneda, setMoneda] = useState<string>(gasto?.moneda ?? "ARS");
  const [comercio, setComercio] = useState<string>(gasto?.negocioOrigenId ?? "");
  const [cobro, setCobro] = useState<string>(gasto?.pagoOrigenId ?? "");

  const esComision = categoria === "comision";
  const cobrosDelComercio = (origenes?.pagos ?? []).filter(
    (p) => p.negocioId === comercio,
  );

  // En edición de un gasto en dólares se muestra el monto en dólares: los
  // pesos son el equivalente, no lo que se tipeó.
  const montoInicial =
    gasto && gasto.moneda === "USD" && gasto.montoUsd !== null
      ? gasto.montoUsd
      : gasto?.monto;

  return (
    <form action={accion} className="space-y-4">
      {gasto && <input type="hidden" name="id" value={gasto.id} />}

      {/* El Select de Radix NO es un <select>: no aporta nada al FormData.
          Por eso el valor va en estado y se manda con estos hidden. */}
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="categoria" value={categoria} />
      <input type="hidden" name="moneda" value={moneda} />
      {esComision && (
        <>
          <input type="hidden" name="negocio_origen_id" value={comercio} />
          <input type="hidden" name="pago_origen_id" value={cobro} />
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <SelectSimple
          id="tipo"
          etiqueta="Tipo"
          valor={tipo}
          onChange={setTipo}
          opciones={[
            { valor: "UNICO", etiqueta: "Único" },
            { valor: "FIJO", etiqueta: "Fijo (todos los meses)" },
          ]}
        />
        <SelectSimple
          id="categoria"
          etiqueta="Categoría"
          valor={categoria}
          onChange={setCategoria}
          opciones={CATEGORIAS_GASTO.map((c) => ({
            valor: c.valor,
            etiqueta: c.etiqueta,
          }))}
        />
      </div>

      {esComision && origenes && (
        <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs text-white/50">
            La comisión es lo que se paga por el primer cobro de un cliente
            conseguido. Atarla al cobro deja claro de dónde sale.
          </p>
          <SelectSimple
            id="comercio-origen"
            etiqueta="Cliente conseguido"
            valor={comercio}
            onChange={(v) => {
              setComercio(v);
              setCobro("");
            }}
            opciones={[
              { valor: "", etiqueta: "Sin atar a un comercio" },
              ...origenes.comercios.map((c) => ({ valor: c.id, etiqueta: c.nombre })),
            ]}
          />
          {comercio && (
            <SelectSimple
              id="cobro-origen"
              etiqueta="Cobro que la origina"
              valor={cobro}
              onChange={setCobro}
              opciones={[
                {
                  valor: "",
                  etiqueta:
                    cobrosDelComercio.length === 0
                      ? "Este comercio todavía no pagó"
                      : "Elegir cobro",
                },
                ...cobrosDelComercio.map((p) => ({
                  valor: p.id,
                  etiqueta: `${fechaCorta(p.fecha)} · ${formatearMoneda(p.monto)}`,
                })),
              ]}
            />
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="concepto">Concepto</Label>
        <Input
          id="concepto"
          name="concepto"
          required
          maxLength={80}
          defaultValue={gasto?.concepto}
          placeholder="Vercel, sueldo de Juan, campaña de agosto…"
          className="h-10"
        />
      </div>

      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <SelectSimple
          id="moneda"
          etiqueta="Moneda"
          valor={moneda}
          onChange={setMoneda}
          opciones={[
            { valor: "ARS", etiqueta: "Pesos ($)" },
            { valor: "USD", etiqueta: "Dólares (US$)" },
          ]}
        />
        <div className="space-y-2">
          <Label htmlFor="monto">
            {tipo === "FIJO" ? "Monto mensual" : "Monto"}
            {moneda === "USD" ? " (US$)" : ""}
          </Label>
          <Input
            id="monto"
            name="monto"
            type="number"
            min="0"
            step="any"
            required
            defaultValue={montoInicial}
            className="h-10 font-mono"
          />
        </div>
      </div>

      {moneda === "USD" && (
        <div className="space-y-2">
          <Label htmlFor="cotizacion">Cotización (opcional)</Label>
          <Input
            id="cotizacion"
            name="cotizacion"
            type="number"
            min="0"
            step="any"
            defaultValue=""
            className="h-10 font-mono"
            placeholder={
              gasto?.cotizacion
                ? `Cargado a $${gasto.cotizacion.toLocaleString("es-AR")}`
                : "Vacío: usa el dólar MEP de hoy"
            }
          />
          <p className="text-[11px] text-white/35">
            Pesos por dólar. Vacío usa el MEP de hoy (o, si el gasto ya estaba en
            dólares, la cotización con que se cargó).
          </p>
        </div>
      )}

      {tipo === "FIJO" && (
        <div className="space-y-2">
          <Label htmlFor="hasta">Baja (opcional)</Label>
          <Input
            id="hasta"
            name="hasta"
            type="date"
            defaultValue={gasto?.hasta ?? ""}
            className="h-10"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="nota">Nota (opcional)</Label>
        <Input
          id="nota"
          name="nota"
          maxLength={200}
          defaultValue={gasto?.nota ?? ""}
          className="h-10"
          placeholder="Para acordarte por qué"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onCancelar}
          disabled={guardando}
        >
          Cancelar
        </Button>
        <Button type="submit" className="flex-1" disabled={guardando}>
          {guardando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : gasto ? (
            "Guardar"
          ) : (
            "Anotar"
          )}
        </Button>
      </div>
    </form>
  );
}
