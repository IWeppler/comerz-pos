"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Repeat2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { formatearMoneda } from "@/shared/utils/formatters";
import { etiquetaMovimiento } from "../lib/movimiento-financiero";
import { CabeceraMovimientos } from "./cabecera-movimientos";
import {
  getActividadDeCuentasAction,
  type FiltrosActividadCuentas,
  type MovimientoFinancieroFila,
  type PaginaMovimientos,
} from "../actions/movimientos-financieros";
import {
  getCuentasFinancierasAction,
  type CuentaFinanciera,
} from "../actions/cuentas-financieras";

const TAMANO_PAGINA = 10;
const TODAS_LAS_CUENTAS = "__todas__";
type FiltroTipo =
  | NonNullable<FiltrosActividadCuentas["origenTipo"]>
  | "TODOS";

const TIPOS: Array<{ valor: Exclude<FiltroTipo, "TODOS">; etiqueta: string }> = [
  { valor: "INGRESO", etiqueta: "Ingresos" },
  { valor: "EGRESO", etiqueta: "Egresos" },
  { valor: "TRANSFERENCIA", etiqueta: "Transferencias" },
];

const CELDA_APILADA =
  "max-md:block max-md:w-full max-md:px-4 max-md:py-1.5 " +
  "max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] " +
  "max-md:before:font-semibold max-md:before:uppercase " +
  "max-md:before:tracking-wide max-md:before:text-muted-foreground " +
  "max-md:before:content-[attr(data-label)]";

/**
 * Qué movió el saldo de las cuentas, sin repetir el detalle del turno.
 *
 * Los cobros se consolidan por cuenta y día en la base. La búsqueda, los
 * filtros y la paginación también se resuelven allí: paginar en memoria haría
 * que el total y las páginas dependieran de lo que alcanzó a cargar el
 * navegador.
 */
export function ActividadCuentas({
  paginaInicial,
  error: errorInicial,
}: Readonly<{
  paginaInicial: PaginaMovimientos | null;
  error?: string | null;
}>) {
  const [filas, setFilas] = useState<MovimientoFinancieroFila[]>(
    paginaInicial?.filas ?? [],
  );
  const [total, setTotal] = useState(paginaInicial?.total ?? 0);
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [tipo, setTipo] = useState<FiltroTipo>("TODOS");
  const [cuentaId, setCuentaId] = useState(TODAS_LAS_CUENTAS);
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([]);
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(errorInicial ?? null);
  const primeraCarga = useRef(true);

  useEffect(() => {
    getCuentasFinancierasAction().then(setCuentas);
  }, []);

  useEffect(() => {
    const temporizador = setTimeout(() => {
      setPagina(0);
      setBusquedaAplicada(busqueda.trim());
    }, 350);
    return () => clearTimeout(temporizador);
  }, [busqueda]);

  useEffect(() => {
    if (primeraCarga.current) {
      primeraCarga.current = false;
      return;
    }

    let vigente = true;
    setCargando(true);
    setError(null);
    getActividadDeCuentasAction({
      busqueda: busquedaAplicada || null,
      origenTipo: tipo === "TODOS" ? null : tipo,
      cuentaId: cuentaId === TODAS_LAS_CUENTAS ? null : cuentaId,
      limite: TAMANO_PAGINA,
      offset: pagina * TAMANO_PAGINA,
    }).then((respuesta) => {
      if (!vigente) return;
      if (respuesta.error || !respuesta.data) {
        setError(
          respuesta.error ?? "No se pudieron cargar los movimientos.",
        );
        setFilas([]);
        setTotal(0);
      } else {
        setFilas(respuesta.data.filas);
        setTotal(respuesta.data.total);
      }
      setCargando(false);
    });

    return () => {
      vigente = false;
    };
  }, [busquedaAplicada, cuentaId, pagina, tipo]);

  const paginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA));
  const desde = total === 0 ? 0 : pagina * TAMANO_PAGINA + 1;
  const hasta = Math.min((pagina + 1) * TAMANO_PAGINA, total);

  return (
    <section className="space-y-3">
      <CabeceraMovimientos
        titulo="Actividad de cuentas"
        cantidad={total}
        descripcion="Cierres de caja, acreditaciones, gastos y transferencias."
        busqueda={busqueda}
        onBusquedaChange={setBusqueda}
        filtros={[
          {
            valor: tipo,
            onChange: (valor) => {
              setPagina(0);
              setTipo(valor as FiltroTipo);
            },
            valorTodos: "TODOS",
            etiquetaTodos: "Todos los tipos",
            opciones: TIPOS.map((opcion) => ({
              valor: opcion.valor,
              etiqueta: opcion.etiqueta,
            })),
            ariaLabel: "Filtrar por tipo",
          },
          {
            valor: cuentaId,
            onChange: (valor) => {
                setPagina(0);
              setCuentaId(valor);
            },
            valorTodos: TODAS_LAS_CUENTAS,
            etiquetaTodos: "Todas las cuentas",
            opciones: cuentas
              .filter((cuenta) => cuenta.codigo !== "POR_ACREDITAR")
              .map((cuenta) => ({
                valor: cuenta.id,
                etiqueta: cuenta.nombre,
              })),
            ariaLabel: "Filtrar por cuenta",
          },
        ]}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm max-md:block md:min-w-full">
          <thead className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wide text-foreground/80 max-md:hidden">
            <tr>
              <th className="px-4 py-2.5">Fecha</th>
              <th className="px-4 py-2.5">Concepto</th>
              <th className="px-4 py-2.5">Tipo</th>
              <th className="px-4 py-2.5">Cuenta</th>
              <th className="px-4 py-2.5 text-right">Importe</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border max-md:block">
            {cargando ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-xs text-danger"
                >
                  {error}
                </td>
              </tr>
            ) : filas.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-xs text-muted-foreground"
                >
                  No hay movimientos con estos filtros.
                </td>
              </tr>
            ) : (
              filas.map((movimiento) => (
                <FilaActividad key={movimiento.id} movimiento={movimiento} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {!cargando && !error && total > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            Mostrando {desde}–{hasta} de {total}
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setPagina((actual) => Math.max(0, actual - 1))}
              disabled={pagina === 0}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-16 text-center text-xs text-muted-foreground">
              {pagina + 1} de {paginas}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() =>
                setPagina((actual) => Math.min(paginas - 1, actual + 1))
              }
              disabled={pagina + 1 >= paginas}
              aria-label="Página siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function FilaActividad({
  movimiento,
}: Readonly<{ movimiento: MovimientoFinancieroFila }>) {
  const importe = Number(movimiento.importe);
  const transferencia = movimiento.origen_tipo === "TRANSFERENCIA";
  const { Icono, tono } = presentacion(movimiento.origen_tipo, importe);
  const etiqueta = etiquetaMovimiento(
    movimiento.origen_tipo,
    movimiento.evento,
    importe,
  );

  return (
    <tr className="max-md:block max-md:border-b max-md:border-border max-md:py-2 max-md:last:border-b-0">
      <td data-label="Fecha" className={CELDA_APILADA + " px-4 py-3"}>
        {fechaHora(movimiento.fecha)}
      </td>
      <td data-label="Concepto" className={CELDA_APILADA + " px-4 py-3"}>
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tono}`}
          >
            <Icono className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">
              {movimiento.descripcion || etiqueta}
            </p>
            {movimiento.usuario_nombre && (
              <p className="truncate text-[11px] text-muted-foreground">
                {movimiento.usuario_nombre}
              </p>
            )}
          </div>
        </div>
      </td>
      <td data-label="Tipo" className={CELDA_APILADA + " px-4 py-3"}>
        <p>{tipoMovimiento(movimiento.origen_tipo)}</p>
        <p className="text-[11px] text-muted-foreground">
          {tipoCuenta(movimiento.cuenta_tipo)}
        </p>
      </td>
      <td data-label="Cuenta" className={CELDA_APILADA + " px-4 py-3"}>
        {movimiento.cuenta_nombre}
        {movimiento.cuenta_contraparte_nombre && (
          <span className="text-muted-foreground">
            {" "}
            {importe < 0 ? "→" : "←"} {movimiento.cuenta_contraparte_nombre}
          </span>
        )}
      </td>
      <td
        data-label="Importe"
        className={
          CELDA_APILADA +
          ` px-4 py-3 text-right font-mono font-semibold tabular-nums max-md:text-right ${
            transferencia
              ? "text-muted-foreground"
              : importe < 0
                ? "text-danger"
                : importe > 0
                  ? "text-success"
                  : "text-muted-foreground"
          }`
        }
      >
        {!transferencia && importe > 0 && "+"}
        {formatearMoneda(importe)}
      </td>
    </tr>
  );
}

function tipoMovimiento(origenTipo: string): string {
  return (
    (
      {
        VENTA_PAGO: "Cobro",
        EGRESO: "Egreso",
        INGRESO: "Ingreso",
        TRANSFERENCIA: "Transferencia",
        ACREDITACION: "Acreditación",
        TURNO_CAJA: "Movimiento de caja",
        AJUSTE: "Ajuste de cuenta",
      } as Record<string, string>
    )[origenTipo] ?? "Movimiento"
  );
}

function tipoCuenta(cuentaTipo: string): string {
  return (
    (
      {
        CAJA_DIARIA: "Caja diaria",
        CAJA_GENERAL: "Caja general",
        BANCO: "Cuenta bancaria",
        BILLETERA: "Billetera virtual",
        POR_ACREDITAR: "Por acreditar",
        OTRA: "Otra cuenta",
      } as Record<string, string>
    )[cuentaTipo] ?? cuentaTipo
  );
}

function presentacion(
  origenTipo: string,
  importe: number,
): { Icono: LucideIcon; tono: string } {
  if (origenTipo === "TRANSFERENCIA") {
    return { Icono: Repeat2, tono: "bg-muted text-muted-foreground" };
  }
  return importe < 0
    ? { Icono: ArrowUpRight, tono: "bg-danger/10 text-danger" }
    : { Icono: ArrowDownLeft, tono: "bg-success/10 text-success" };
}

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
