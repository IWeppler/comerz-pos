"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  actualizarGastoAction,
  eliminarGastoAction,
  type EstadoGasto,
  type GastoComerz,
} from "@/features/admin/actions/gastos-comerz";
import { ETIQUETA_CATEGORIA } from "@/features/admin/lib/categorias-gasto";
import { formatearUsd, pesosAUsd } from "@/features/admin/lib/cotizacion-mep";
import { montoEnPesos } from "@/features/admin/lib/finanzas-comerz";
import { CLASE_PORTAL_OSCURO } from "@/features/admin/lib/tema-portal";
import { formatearMoneda } from "@/shared/utils/formatters";
import { FormularioGasto, type OrigenesGasto } from "./formulario-gasto";

const INICIAL: EstadoGasto = { error: null, success: false };

/**
 * Los gastos que cuentan en el mes en curso, con su total.
 *
 * Editar y borrar están ACÁ, en la fila de cada gasto, y no escondidos en el
 * modal de carga: el gasto se corrige donde se lo ve, no donde se lo anotó.
 *
 * Un FIJO aparece todos los meses aunque se haya anotado hace seis: no es una
 * fila por mes, es una que aplica a un rango (ver `gastos-por-mes.ts`).
 */
export function GastosDelMes({
  gastos,
  total,
  porComercio,
  mep,
  mesActual,
  origenes,
}: Readonly<{
  gastos: GastoComerz[];
  total: number;
  porComercio: number | null;
  /** MEP de hoy. Null = no se pudo leer: solo pesos. */
  mep: number | null;
  /** "YYYY-MM" del mes en curso (el mismo con que se calculó `total`). */
  mesActual: string;
  origenes: OrigenesGasto;
}>) {
  const nombreComercio = new Map(origenes.comercios.map((c) => [c.id, c.nombre]));
  const ctx = { mepActual: mep, mesActual };
  const [editando, setEditando] = useState<GastoComerz | null>(null);
  const [borrando, iniciarBorrado] = useTransition();

  const [estado, accion, guardando] = useActionState(
    actualizarGastoAction,
    INICIAL,
  );

  // Cerrar es estado derivado del resultado, así que se ajusta DURANTE el
  // render: un `setState` en un efecto encadena un segundo render y el linter
  // lo marca. El toast sí es un efecto de verdad.
  const [ultimoOk, setUltimoOk] = useState(false);
  if (estado.success !== ultimoOk) {
    setUltimoOk(estado.success);
    if (estado.success) setEditando(null);
  }

  useEffect(() => {
    if (estado.success) toast.success("Gasto actualizado");
  }, [estado.success]);

  const borrar = (gasto: GastoComerz) =>
    iniciarBorrado(async () => {
      const res = await eliminarGastoAction(gasto.id);
      if (res.success) toast.success("Gasto borrado");
      else toast.error(res.error ?? "No se pudo borrar.");
    });

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div>
        <p className="text-sm font-semibold text-white/90">
          Gastos del mes: {formatearMoneda(total)}
          {mep !== null && (
            <span className="ml-2 text-xs font-normal text-white/40">
              ≈ {formatearUsd(pesosAUsd(total, mep))}
            </span>
          )}
        </p>
        <p className="text-xs text-white/40">
          {porComercio !== null
            ? `${formatearMoneda(porComercio)} por comercio activo`
            : "Sin comercios activos para repartirlo"}
        </p>
      </div>

      {gastos.length === 0 ? (
        <p className="mt-3 text-xs text-white/30">
          Todavía no anotaste gastos de este mes: el margen de arriba los está
          contando en cero.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/[0.06]">
          {gastos.map((g) => (
            <li key={g.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white/80">
                  {g.concepto}
                  <span className="ml-1.5 text-[11px] uppercase tracking-wider text-white/30">
                    {ETIQUETA_CATEGORIA[g.categoria] ?? g.categoria}
                  </span>
                </p>
                <p className="text-[11px] text-white/35">
                  {g.tipo === "FIJO"
                    ? g.hasta
                      ? `Fijo · baja ${g.hasta.slice(0, 7)}`
                      : "Fijo · vigente"
                    : `Único · ${g.mes.slice(0, 7)}`}
                  {g.negocioOrigenId &&
                    nombreComercio.get(g.negocioOrigenId) &&
                    ` · por ${nombreComercio.get(g.negocioOrigenId)}`}
                  {g.nota && ` · ${g.nota}`}
                </p>
              </div>

              <MontoGasto gasto={g} pesos={montoEnPesos(g, mesActual, ctx)} mep={mep} />

              <div className="flex shrink-0 items-center">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-white/40 hover:text-white"
                  aria-label={`Editar ${g.concepto}`}
                  onClick={() => setEditando(g)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-white/40 hover:text-rose-400"
                  aria-label={`Borrar ${g.concepto}`}
                  disabled={borrando}
                  onClick={() => borrar(g)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editando !== null}
        onOpenChange={(v) => !v && setEditando(null)}
      >
        <DialogContent className={`sm:max-w-md ${CLASE_PORTAL_OSCURO}`}>
          <DialogTitle>Editar gasto</DialogTitle>
          <DialogDescription>
            Poner una baja lo deja de contar a partir de ese mes, sin cambiar
            los anteriores. Borrarlo lo saca de todos.
          </DialogDescription>

          {editando && (
            <FormularioGasto
              key={editando.id}
              gasto={editando}
              origenes={origenes}
              accion={accion}
              error={estado.error}
              guardando={guardando}
              onCancelar={() => setEditando(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * El monto de un gasto en su moneda, con el equivalente al lado.
 *
 * Un gasto en dólares muestra primero los dólares (es lo que se paga) y los
 * pesos de este mes debajo; uno en pesos, los pesos y los dólares al MEP de
 * hoy si hay cotización.
 */
function MontoGasto({
  gasto,
  pesos,
  mep,
}: Readonly<{ gasto: GastoComerz; pesos: number; mep: number | null }>) {
  const enDolares = gasto.moneda === "USD" && gasto.montoUsd !== null;
  const principal = enDolares ? formatearUsd(gasto.montoUsd!) : formatearMoneda(pesos);
  const secundario = enDolares
    ? formatearMoneda(pesos)
    : mep !== null
      ? formatearUsd(pesosAUsd(pesos, mep))
      : null;

  return (
    <div className="shrink-0 text-right">
      <p className="font-mono text-sm tabular-nums text-white/80">{principal}</p>
      {secundario && (
        <p className="font-mono text-[11px] tabular-nums text-white/35">≈ {secundario}</p>
      )}
    </div>
  );
}
