"use client";

import { useMemo, useState } from "react";
import {
  Ban,
  BookUser,
  Repeat2,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { formatearMoneda } from "@/shared/utils/formatters";
import { CabeceraMovimientos } from "./cabecera-movimientos";
import {
  TODOS_LOS_METODOS,
  TODOS_LOS_USUARIOS,
  etiquetaMetodoTipo,
  metodosPresentes,
  pasaFiltroTurno,
  totalizarVisibles,
  usuariosPresentes,
} from "../lib/filtrar-movimientos-turno";

export type MovimientoExtendido = {
  id: string;
  /** A qué turno abierto pertenece. Con varias cajas a la vista es lo único
   * que separa el arqueo propio del de la caja de al lado. */
  turnoId: string | null;
  tipo: "INGRESO" | "EGRESO";
  origen: "VENTA" | "COBRO_DEUDA" | "EGRESO" | "TRANSFERENCIA" | "INGRESO";
  concepto: string;
  metodo: string;
  metodo_tipo: string;
  monto: number;
  comision: number;
  neto: number;
  fecha: string;
  usuario: string;
  /** La venta se anuló. Sigue siendo un movimiento real del turno —la plata
   * entró— pero no es facturación. Ver `calcularTotalesTurno`. */
  anulada?: boolean;
  afecta_facturacion?: boolean;
  /** Solo en origen EGRESO: OPERATIVO | RETIRO_SOCIO | COMPRA_MERCADERIA |
   * DEVOLUCION. Decide si se ofrece "Anular" — un DEVOLUCION lo generó una
   * venta y se corrige desde ahí, no desde acá. */
  egresoTipo?: string | null;
};

/**
 * Todo lo que pasó en el cajón desde que se abrió el turno: cada venta, cada
 * cobro de deuda, cada gasto, cada pase.
 *
 * Es la tabla del TURNO, no la de las cuentas: acá la unidad es el ticket
 * porque es lo que alguien reconstruye cuando la plata no cuadra. La otra
 * —Dinero— muestra los cobros del día sumados. Ver `movimiento-de-cuentas.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EN CELULAR SE APILA, NO SE DESLIZA
 *
 * La tabla tenía `overflow-x-auto` con cinco columnas: en un teléfono de 390
 * px se leían dos y media, y para ver el importe había que arrastrar de
 * costado. Es el mismo arreglo que ya se hizo en las tablas de conciliación
 * (`max-md:block`): en mobile cada movimiento es una tarjeta con lo que se
 * necesita de un vistazo. El importe va SIEMPRE visible, en las dos formas:
 * es el dato por el que se entra.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function MovimientosTurno({
  movimientos,
  puedeAnular,
  onAnular,
  variasCajas,
}: Readonly<{
  movimientos: MovimientoExtendido[];
  puedeAnular: boolean;
  onAnular: (movimiento: MovimientoExtendido) => void;
  /** true cuando la lista abarca más de una caja abierta (es lo que ve el
   * dueño). Cambia el título y enciende el filtro por empleado: decir "tu
   * turno" sobre los movimientos de tres cajeras sería mentir sobre el
   * alcance, que es el error que esta pantalla ya cometió una vez. */
  variasCajas: boolean;
}>) {
  const [busqueda, setBusqueda] = useState("");
  const [metodo, setMetodo] = useState(TODOS_LOS_METODOS);
  const [usuario, setUsuario] = useState(TODOS_LOS_USUARIOS);

  const metodos = useMemo(() => metodosPresentes(movimientos), [movimientos]);
  const usuarios = useMemo(() => usuariosPresentes(movimientos), [movimientos]);
  const visibles = useMemo(
    () =>
      movimientos.filter((m) => pasaFiltroTurno(m, busqueda, metodo, usuario)),
    [movimientos, busqueda, metodo, usuario],
  );

  // El total sigue a los filtros a propósito: filtrar por Mara contesta
  // "cuánto movió Mara", y filtrar por Efectivo, "cuánto entró en efectivo" —
  // preguntas que antes no se podían hacer en ninguna pantalla. Y es el total
  // de lo que se VE, así que se puede verificar sumando las filas.
  const total = useMemo(() => totalizarVisibles(visibles), [visibles]);

  const hayFiltro =
    busqueda.trim() !== "" ||
    metodo !== TODOS_LOS_METODOS ||
    usuario !== TODOS_LOS_USUARIOS;

  return (
    <section className="space-y-3">
      <CabeceraMovimientos
        titulo="Movimientos del local"
        cantidad={total.cantidad}
        totalNeto={formatearMoneda(total.neto)}
        descripcion={
          variasCajas
            ? "Ventas, cobros, gastos e ingresos de todas las cajas abiertas."
            : "Ventas, cobros, gastos e ingresos desde que abriste la caja."
        }
        busqueda={busqueda}
        onBusquedaChange={setBusqueda}
        filtros={[
          {
            valor: usuario,
            onChange: setUsuario,
            valorTodos: TODOS_LOS_USUARIOS,
            etiquetaTodos: "Todo el equipo",
            opciones: usuarios.map((nombre) => ({
              valor: nombre,
              etiqueta: nombre,
            })),
            ariaLabel: "Filtrar por empleado",
            visible: usuarios.length > 1,
          },
          {
            valor: metodo,
            onChange: setMetodo,
            valorTodos: TODOS_LOS_METODOS,
            etiquetaTodos: "Todos los métodos",
            opciones: metodos.map((tipo) => ({
              valor: tipo,
              etiqueta: etiquetaMetodoTipo(tipo),
            })),
            ariaLabel: "Filtrar por método",
            visible: metodos.length > 1,
          },
        ]}
      />

      {visibles.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {/* Un filtro que no encuentra nada tiene que decir que FUE el
              filtro. Si no, se lee como "no vendiste nada en todo el turno". */}
          {hayFiltro
            ? "Ningún movimiento coincide con lo que buscás."
            : "Todavía no hay movimientos en este turno."}
        </p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-3">Hora</th>
                  <th className="px-4 py-3">Concepto</th>
                  <th className="px-4 py-3">Método</th>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3 text-right">Importe</th>
                  {puedeAnular && <th className="w-10 px-4 py-3" aria-hidden />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visibles.map((mov) => (
                  <tr
                    key={`${mov.tipo}-${mov.id}`}
                    className="hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {hora(mov.fecha)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <IconoOrigen origen={mov.origen} />
                        <span className="truncate text-sm">{mov.concepto}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="secondary"
                        className="bg-muted text-[10px] uppercase shadow-none"
                      >
                        {mov.metodo}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {mov.usuario}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Importe movimiento={mov} />
                    </td>
                    {puedeAnular && (
                      <td className="px-4 py-3">
                        <BotonAnular movimiento={mov} onAnular={onAnular} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {visibles.map((mov) => (
              <li
                key={`m-${mov.tipo}-${mov.id}`}
                className="rounded-2xl border border-border bg-card p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <IconoOrigen origen={mov.origen} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {mov.concepto}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {hora(mov.fecha)} · {mov.metodo} · {mov.usuario}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Importe movimiento={mov} />
                    {puedeAnular && (
                      <BotonAnular movimiento={mov} onAnular={onAnular} />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {hayFiltro && (
        <p className="text-[11px] text-muted-foreground">
          Mostrando {visibles.length} de {movimientos.length} movimientos.
        </p>
      )}
    </section>
  );
}

function Importe({
  movimiento,
}: Readonly<{ movimiento: MovimientoExtendido }>) {
  return (
    <span
      className={`font-mono text-sm font-semibold tabular-nums ${
        movimiento.tipo === "INGRESO" ? "text-success" : "text-danger"
      }`}
    >
      {movimiento.tipo === "INGRESO" ? "+" : "−"}
      {formatearMoneda(movimiento.monto)}
    </span>
  );
}

function BotonAnular({
  movimiento,
  onAnular,
}: Readonly<{
  movimiento: MovimientoExtendido;
  onAnular: (movimiento: MovimientoExtendido) => void;
}>) {
  // Solo un gasto propio (no venta, no cobro, no transferencia) y que no sea
  // un reintegro de venta: ese se corrige desde la venta.
  if (
    movimiento.origen !== "EGRESO" ||
    movimiento.egresoTipo === "DEVOLUCION"
  ) {
    return null;
  }
  return (
    <button
      type="button"
      aria-label="Anular gasto"
      title="Anular gasto"
      onClick={() => onAnular(movimiento)}
      className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger"
    >
      <Ban className="h-3.5 w-3.5" />
    </button>
  );
}

const ORIGENES = {
  VENTA: { Icono: ShoppingBag, tono: "bg-success/10 text-success" },
  COBRO_DEUDA: { Icono: BookUser, tono: "bg-info/10 text-info" },
  EGRESO: { Icono: TrendingDown, tono: "bg-danger/10 text-danger" },
  TRANSFERENCIA: { Icono: Repeat2, tono: "bg-info/10 text-info" },
  INGRESO: { Icono: TrendingUp, tono: "bg-success/10 text-success" },
} as const;

function IconoOrigen({
  origen,
}: Readonly<{ origen: MovimientoExtendido["origen"] }>) {
  const { Icono, tono } = ORIGENES[origen] ?? ORIGENES.VENTA;
  return (
    <span
      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tono}`}
    >
      <Icono className="h-3.5 w-3.5" />
    </span>
  );
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
