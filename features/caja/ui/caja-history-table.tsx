"use client";

import { useState, useMemo } from "react";
import { TurnoCajaHistorial } from "@/entities/caja/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  History,
  FileText,
} from "lucide-react";
import { CajaDetailSheet } from "./caja-detail-sheet";
import type { PapelCierreZ } from "./cierre-z-printable";
import { formatearFechaHora, formatearMoneda } from "@/shared/utils/formatters";

interface CajaHistoryTableProps {
  historial: TurnoCajaHistorial[];
  /** Cabecera del cierre Z impreso (nombre del comercio y ancho del papel). */
  papel: PapelCierreZ;
  /** Facturado por turno (`turno_id` -> monto), de la RPC
   * `totales_ventas_por_turno`. Opcional: si no llega, la fila de día muestra
   * "S/D" en vez de un total inventado a partir de los campos de caja, que
   * solo conocen el efectivo. */
  totalesPorTurno?: Record<string, number>;
}

/** Un día del historial con sus turnos. */
interface DiaAgrupado {
  clave: string;
  etiqueta: string;
  turnos: TurnoCajaHistorial[];
  totalVendido: number | null;
  /** Suma del efectivo esperado de los turnos del día. null si algún turno no
   * lo tiene: sumar como si ese turno hubiera dado cero es inventar. */
  efectivoEsperado: number | null;
  hayAbiertos: boolean;
  /** Diferencia neta del día. null = no se puede calcular todavía (mismo
   * criterio que la Vista Gerencial: solo con TODOS los turnos cerrados). */
  diferencia: number | null;
  /** Cerrado entero pero con algún turno sin efectivo_esperado guardado: hay
   * que decir "S/D", no sumar como si ese turno hubiera dado cero. */
  diferenciaIncompleta: boolean;
}

/**
 * El efectivo que tendría que haber en ese cajón.
 *
 * Gana el RECALCULADO sobre el de la fila, y en un turno abierto es la única
 * opción que dice algo: `turnos_caja.efectivo_esperado` quedó congelado en el
 * monto inicial al abrir, así que mostrarlo diría que la caja tiene el fondo
 * y nada más. En un turno cerrado el recalculado puede diferir del que se
 * firmó (una venta anulada después, un medio corregido): eso es lo que el
 * badge AJUSTADO explica, con los dos números.
 */
function esperadoTurno(t: TurnoCajaHistorial): number | null {
  const esperado = t.efectivo_esperado_actual ?? t.efectivo_esperado;
  if (esperado == null || esperado === "") return null;
  return Number(esperado);
}

/** Diferencia de un turno cerrado: declarado − esperado. null si no se puede
 * calcular. Es la misma cuenta que hace la fila individual, extraída para que
 * el total del día y el detalle no puedan divergir. */
function diferenciaTurno(t: TurnoCajaHistorial): number | null {
  const esperado = t.efectivo_esperado_actual ?? t.efectivo_esperado;
  if (esperado == null || esperado === "") return null;
  // Un esperado negativo es un turno con los datos rotos (la fila individual lo
  // marca con ⚠). Su "diferencia" es basura, así que tampoco puede entrar en la
  // suma del día: contaminaría el neto sin que se note.
  if (Number(esperado) < 0) return null;
  return Number(t.monto_final || 0) - Number(esperado);
}

/** Clave de agrupación: día local. Se arma con getFullYear/Month/Date y no con
 * toISOString(), que pasa a UTC y manda las ventas de la tarde al día
 * siguiente. */
function claveDia(fechaISO: string): string {
  const f = new Date(fechaISO);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(
    f.getDate(),
  ).padStart(2, "0")}`;
}

function etiquetaDia(fechaISO: string): string {
  return new Date(fechaISO).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function CajaHistoryTable({
  historial,
  totalesPorTurno,
  papel,
}: Readonly<CajaHistoryTableProps>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [paginaActual, setPaginaActual] = useState(1);
  const DIAS_POR_PAGINA = 10;
  const [turnoAbierto, setTurnoAbierto] = useState<TurnoCajaHistorial | null>(
    null,
  );
  const [diasExpandidos, setDiasExpandidos] = useState<Set<string>>(new Set());

  const hayBusqueda = searchQuery.trim() !== "";

  const filteredData = useMemo(() => {
    return historial.filter((h) => {
      const idCorto = h.id.split("-")[0].toLowerCase();
      const vendedor = h.perfiles?.nombre?.toLowerCase() || "";
      const searchLower = searchQuery.toLowerCase().replace("#", "");

      return idCorto.includes(searchLower) || vendedor.includes(searchLower);
    });
  }, [historial, searchQuery]);

  const dias = useMemo<DiaAgrupado[]>(() => {
    const mapa = new Map<string, TurnoCajaHistorial[]>();

    for (const turno of filteredData) {
      const clave = claveDia(turno.fecha_apertura);
      const actual = mapa.get(clave);
      if (actual) actual.push(turno);
      else mapa.set(clave, [turno]);
    }

    return Array.from(mapa.entries())
      .map(([clave, turnos]) => {
        const hayAbiertos = turnos.some((t) => t.estado === "ABIERTO");

        const diferencias = hayAbiertos
          ? []
          : turnos.map((t) => diferenciaTurno(t));
        const diferenciaIncompleta =
          !hayAbiertos && diferencias.some((d) => d === null);

        // Sin totales de ventas cargados no inventamos: null se pinta S/D.
        const totalVendido = totalesPorTurno
          ? turnos.reduce((acc, t) => acc + (totalesPorTurno[t.id] ?? 0), 0)
          : null;

        // Mismo criterio que la diferencia: si un solo turno del día no tiene
        // esperado, el total del día es S/D. Un turno sin dato no es un turno
        // con cero, y sumarlo como cero deja un número que cierra mal sin que
        // nadie pueda ver dónde.
        const esperados = turnos.map((t) => esperadoTurno(t));
        const efectivoEsperado = esperados.some((e) => e === null)
          ? null
          : esperados.reduce((acc: number, e) => acc + (e ?? 0), 0);

        return {
          clave,
          etiqueta: etiquetaDia(turnos[0].fecha_apertura),
          turnos,
          totalVendido,
          efectivoEsperado,
          hayAbiertos,
          diferencia:
            hayAbiertos || diferenciaIncompleta
              ? null
              : diferencias.reduce((acc: number, d) => acc + (d ?? 0), 0),
          diferenciaIncompleta,
        };
      })
      .sort((a, b) => b.clave.localeCompare(a.clave));
  }, [filteredData, totalesPorTurno]);

  const totalPaginas = Math.ceil(dias.length / DIAS_POR_PAGINA);
  const diasPaginados = dias.slice(
    (paginaActual - 1) * DIAS_POR_PAGINA,
    paginaActual * DIAS_POR_PAGINA,
  );

  // Con búsqueda activa todos los días que quedan tienen al menos un turno que
  // matcheó, así que se abren solos: si no, el resultado queda escondido
  // adentro de un día colapsado y la búsqueda parece no encontrar nada.
  const estaExpandido = (clave: string) =>
    hayBusqueda || diasExpandidos.has(clave);

  const toggleDia = (clave: string) => {
    setDiasExpandidos((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(clave)) siguiente.delete(clave);
      else siguiente.add(clave);
      return siguiente;
    });
  };

  const totalTurnosFiltrados = filteredData.length;

  return (
    <div>
      <CajaDetailSheet
        key={turnoAbierto?.id ?? "sin-turno"}
        turno={turnoAbierto}
        onClose={() => setTurnoAbierto(null)}
        papel={papel}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <History className="w-5 h-5 text-muted-foreground" />
          Historial de Cajas
        </h2>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por ID o Vendedor..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPaginaActual(1);
            }}
            className="pl-9 h-10 rounded-xl border-border bg-background shadow-none hover:border-foreground/40 transition-colors focus-visible:ring-0"
          />
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-none overflow-hidden">
        <div className="divide-y divide-border/60 md:hidden">
          {diasPaginados.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No se encontraron turnos que coincidan con la búsqueda.
            </p>
          ) : (
            diasPaginados.map((dia) => (
              <DiaMovil
                key={dia.clave}
                dia={dia}
                abierto={estaExpandido(dia.clave)}
                totalesPorTurno={totalesPorTurno}
                onToggle={() => toggleDia(dia.clave)}
                onVerDetalle={setTurnoAbierto}
              />
            ))
          )}
        </div>
        <div className="hidden md:block md:overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/30 text-muted-foreground text-[10px] uppercase font-bold tracking-widest">
              <tr>
                <th className="px-5 py-3 border-b border-border">Día</th>
                <th className="px-5 py-3 border-b border-border hidden sm:table-cell">
                  Turnos
                </th>
                <th className="px-5 py-3 border-b border-border text-right">
                  Vendido
                </th>
                {/* Vendido y efectivo esperado son dos preguntas distintas y
                    por eso van en columnas separadas: lo primero es cuánto se
                    facturó, lo segundo cuánta plata tendría que haber en el
                    cajón. No coinciden nunca —hay cobros digitales, hay fiado,
                    hay gastos— y mostrarlas juntas invitaba a leer una como la
                    otra. En celular la columna se esconde y el número baja
                    debajo del vendido, con su rótulo. */}
                <th className="px-5 py-3 border-b border-border text-right hidden md:table-cell">
                  Efectivo esperado
                </th>
                <th className="px-5 py-3 text-right border-b border-border">
                  Diferencia
                </th>
                <th className="px-5 py-3 border-b border-border w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {diasPaginados.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-muted-foreground font-medium"
                  >
                    No se encontraron turnos que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                diasPaginados.map((dia) => {
                  const abierto = estaExpandido(dia.clave);
                  const cerrados = dia.turnos.filter(
                    (t) => t.estado !== "ABIERTO",
                  ).length;

                  return (
                    <DiaFila
                      key={dia.clave}
                      dia={dia}
                      abierto={abierto}
                      cerrados={cerrados}
                      totalesPorTurno={totalesPorTurno}
                      onToggle={() => toggleDia(dia.clave)}
                      onVerDetalle={setTurnoAbierto}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación — ahora cuenta DÍAS, pero el texto sigue informando
            turnos, que es lo que la persona está buscando. */}
        {totalPaginas > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-5 py-4 border-t border-border bg-muted/10">
            <span className="text-xs text-muted-foreground font-medium">
              {dias.length === 1 ? "1 día" : `${dias.length} días`} ·{" "}
              {totalTurnosFiltrados === 1
                ? "1 turno"
                : `${totalTurnosFiltrados} turnos`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 shadow-none cursor-pointer"
                onClick={() => setPaginaActual((p) => Math.max(1, p - 1))}
                disabled={paginaActual === 1}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
              </Button>
              <div className="text-xs font-bold px-2 text-foreground">
                {paginaActual} / {totalPaginas}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shadow-none cursor-pointer"
                onClick={() =>
                  setPaginaActual((p) => Math.min(totalPaginas, p + 1))
                }
                disabled={paginaActual === totalPaginas}
              >
                Siguiente <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DiaFila({
  dia,
  abierto,
  cerrados,
  totalesPorTurno,
  onToggle,
  onVerDetalle,
}: Readonly<{
  dia: DiaAgrupado;
  abierto: boolean;
  cerrados: number;
  totalesPorTurno?: Record<string, number>;
  onToggle: () => void;
  onVerDetalle: (turno: TurnoCajaHistorial) => void;
}>) {
  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={abierto}
        className="hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <td className="px-5 py-3.5 font-semibold text-foreground whitespace-nowrap capitalize">
          {dia.etiqueta}
        </td>
        <td className="px-5 py-3.5 text-muted-foreground whitespace-nowrap hidden sm:table-cell text-xs font-medium">
          {dia.turnos.length === 1 ? "1 turno" : `${dia.turnos.length} turnos`}
          {dia.hayAbiertos &&
            ` · ${cerrados} cerrado${cerrados === 1 ? "" : "s"}`}
        </td>
        <td className="px-5 py-3.5 text-right font-mono font-medium text-foreground whitespace-nowrap">
          <Cifra monto={dia.totalVendido} />
          {/* En celular no hay columna propia para el esperado, así que baja
              acá con su rótulo: esconderlo del todo sería sacar justo el
              número con el que se arquea. */}
          <span className="block text-[10px] font-sans font-medium text-muted-foreground md:hidden">
            Esperado <Cifra monto={dia.efectivoEsperado} />
          </span>
        </td>
        <td className="px-5 py-3.5 text-right font-mono font-medium text-foreground whitespace-nowrap hidden md:table-cell">
          <Cifra monto={dia.efectivoEsperado} />
        </td>
        <td className="px-5 py-3.5 text-right">
          <DiferenciaDia dia={dia} />
        </td>
        <td className="px-5 py-3.5 text-right">
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform inline-block ${
              abierto ? "rotate-180" : ""
            }`}
          />
        </td>
      </tr>

      {abierto &&
        dia.turnos.map((h) => (
          <TurnoFila
            key={h.id}
            turno={h}
            vendido={totalesPorTurno ? (totalesPorTurno[h.id] ?? 0) : null}
            onVerDetalle={onVerDetalle}
          />
        ))}
    </>
  );
}

function DiaMovil({
  dia,
  abierto,
  totalesPorTurno,
  onToggle,
  onVerDetalle,
}: Readonly<{
  dia: DiaAgrupado;
  abierto: boolean;
  totalesPorTurno?: Record<string, number>;
  onToggle: () => void;
  onVerDetalle: (turno: TurnoCajaHistorial) => void;
}>) {
  const cerrados = dia.turnos.filter((turno) => turno.estado !== "ABIERTO").length;

  return (
    <section className="min-w-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierto}
        className="w-full cursor-pointer p-4 text-left hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block font-semibold capitalize text-foreground">
              {dia.etiqueta}
            </span>
            <span className="block text-xs text-muted-foreground">
              {dia.turnos.length === 1 ? "1 turno" : `${dia.turnos.length} turnos`}
              {dia.hayAbiertos && ` · ${cerrados} cerrado${cerrados === 1 ? "" : "s"}`}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${abierto ? "rotate-180" : ""}`}
          />
        </span>
        <span className="mt-3 block space-y-1.5 border-t border-border/60 pt-3">
          <DatoMovil etiqueta="Vendido" monto={dia.totalVendido} />
          <DatoMovil etiqueta="Efectivo esperado" monto={dia.efectivoEsperado} />
          <span className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Diferencia</span>
            <DiferenciaDia dia={dia} />
          </span>
        </span>
      </button>
      {abierto && (
        <div className="divide-y divide-border/60 border-t border-border/60 bg-muted/10">
          {dia.turnos.map((turno) => (
            <TurnoMovil
              key={turno.id}
              turno={turno}
              vendido={totalesPorTurno ? (totalesPorTurno[turno.id] ?? 0) : null}
              onVerDetalle={onVerDetalle}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DatoMovil({
  etiqueta,
  monto,
}: Readonly<{ etiqueta: string; monto: number | null }>) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className="min-w-0 break-all text-right font-mono font-medium tabular-nums text-foreground">
        <Cifra monto={monto} />
      </span>
    </span>
  );
}

function TurnoMovil({
  turno,
  vendido,
  onVerDetalle,
}: Readonly<{
  turno: TurnoCajaHistorial;
  vendido: number | null;
  onVerDetalle: (turno: TurnoCajaHistorial) => void;
}>) {
  const isAbierto = turno.estado === "ABIERTO";

  return (
    <div className="min-w-0 space-y-3 p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {turno.perfiles?.nombre || "Vendedor"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            #{turno.id.split("-")[0].toUpperCase()} · {formatearFechaHora(turno.fecha_apertura)}
            {" → "}
            {isAbierto ? "en curso" : formatearFechaHora(turno.fecha_cierre)}
          </p>
        </div>
        <EstadoTurno turno={turno} />
      </div>
      <div className="space-y-1.5 border-t border-border/60 pt-3">
        <DatoMovil etiqueta="Vendido" monto={vendido} />
        <DatoMovil etiqueta="Efectivo esperado" monto={esperadoTurno(turno)} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Diferencia</span>
          <DiferenciaTurno turno={turno} />
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full cursor-pointer"
        onClick={() => onVerDetalle(turno)}
      >
        <FileText className="mr-1.5 h-4 w-4" /> Ver auditoría
      </Button>
    </div>
  );
}

/** Un importe, o S/D cuando no hay dato. Se comparte entre el día y el turno
 * para que los dos digan "no se sabe" de la misma forma: un cero y un dato
 * faltante se leen igual de lejos y significan cosas opuestas. */
function Cifra({ monto }: Readonly<{ monto: number | null }>) {
  if (monto === null) {
    return (
      <span className="text-muted-foreground text-[10px] uppercase tracking-widest font-bold">
        S/D
      </span>
    );
  }
  return <>{formatearMoneda(monto)}</>;
}

function DiferenciaDia({ dia }: Readonly<{ dia: DiaAgrupado }>) {
  // Con algún turno abierto no hay diferencia posible: el monto declarado de
  // ese turno todavía no existe. Mismo criterio que la Vista Gerencial.
  if (dia.hayAbiertos) {
    return <Badge variant="warning">En curso</Badge>;
  }
  if (dia.diferenciaIncompleta || dia.diferencia === null) {
    return (
      <span
        className="text-muted-foreground text-[10px] uppercase tracking-widest font-bold"
        title="Algún turno del día se cerró sin efectivo esperado guardado"
      >
        S/D
      </span>
    );
  }
  if (dia.diferencia === 0) {
    return <Badge variant="success">Perfecto</Badge>;
  }
  if (dia.diferencia < 0) {
    return <Badge variant="danger">{formatearMoneda(dia.diferencia)}</Badge>;
  }
  return (
    <Badge
      variant="info"
    >
      +{formatearMoneda(dia.diferencia)}
    </Badge>
  );
}

function EstadoTurno({ turno }: Readonly<{ turno: TurnoCajaHistorial }>) {
  if (turno.estado === "ABIERTO") {
    return <Badge variant="success">ABIERTO</Badge>;
  }

  const fueAjustado =
    turno.efectivo_esperado_actual != null &&
    turno.efectivo_esperado != null &&
    Math.abs(
      Number(turno.efectivo_esperado_actual) - Number(turno.efectivo_esperado),
    ) >= 0.01;

  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge variant="outline">CERRADO</Badge>
      {fueAjustado && (
        <Badge
          variant="info"
          title={`Al cerrar se firmó ${formatearMoneda(Number(turno.efectivo_esperado))}. Recalculado con los movimientos actuales del turno (una venta anulada, un egreso cargado después o un medio de pago corregido) da ${formatearMoneda(Number(turno.efectivo_esperado_actual))}. La diferencia se calcula con el número recalculado.`}
        >
          AJUSTADO
        </Badge>
      )}
    </span>
  );
}

function DiferenciaTurno({ turno }: Readonly<{ turno: TurnoCajaHistorial }>) {
  if (turno.estado === "ABIERTO") {
    return <Badge variant="warning">En curso</Badge>;
  }

  const esperado = esperadoTurno(turno);
  if (esperado !== null && esperado < 0) {
    return (
      <Badge variant="danger" title="El efectivo esperado calculado dio negativo">
        ⚠ Esperado negativo
      </Badge>
    );
  }

  const diferencia = diferenciaTurno(turno);
  if (diferencia === null) {
    return (
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        S/D
      </span>
    );
  }
  if (diferencia === 0) {
    return <Badge variant="success">Perfecto</Badge>;
  }
  if (diferencia < 0) {
    return <Badge variant="danger">{formatearMoneda(diferencia)}</Badge>;
  }
  return <Badge variant="info">+{formatearMoneda(diferencia)}</Badge>;
}

/**
 * Fila individual de cajera, ALINEADA con las columnas del día.
 *
 * Antes era un bloque a ancho completo (`colSpan={5}`) con todo adentro en
 * una fila flex. Funcionaba, pero el vendido y el esperado de cada persona no
 * caían debajo de los del día, así que no se podía leer de arriba abajo quién
 * aportó qué — que es exactamente lo que alguien busca cuando el día no
 * cuadra. Ahora cada número está en su columna.
 */
function TurnoFila({
  turno: h,
  vendido,
  onVerDetalle,
}: Readonly<{
  turno: TurnoCajaHistorial;
  /** Facturado de ESTE turno. null = no llegaron los totales (S/D). */
  vendido: number | null;
  onVerDetalle: (turno: TurnoCajaHistorial) => void;
}>) {
  const isAbierto = h.estado === "ABIERTO";
  const idCorto = h.id.split("-")[0].toUpperCase();
  const esperado = esperadoTurno(h);

  return (
    <tr className="bg-muted/20 hover:bg-muted/40 transition-colors text-xs">
      <td className="px-5 py-2.5">
        <div className="flex items-center gap-2.5 pl-3 border-l-2 border-border">
          <span className="font-bold text-muted-foreground whitespace-nowrap hidden lg:inline">
            #{idCorto}
          </span>
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">
              {h.perfiles?.nombre || "Vendedor"}
            </p>
            <p className="text-muted-foreground whitespace-nowrap">
              {formatearFechaHora(h.fecha_apertura)}
              {" → "}
              {isAbierto ? "en curso" : formatearFechaHora(h.fecha_cierre)}
            </p>
          </div>
        </div>
      </td>

      <td className="px-5 py-2.5 hidden sm:table-cell">
        <EstadoTurno turno={h} />
      </td>

      <td className="px-5 py-2.5 text-right font-mono font-medium text-foreground whitespace-nowrap">
        <Cifra monto={vendido} />
        <span className="block text-[10px] font-sans font-medium text-muted-foreground md:hidden">
          Esperado <Cifra monto={esperado} />
        </span>
      </td>

      <td className="px-5 py-2.5 text-right font-mono font-medium text-foreground whitespace-nowrap hidden md:table-cell">
        <Cifra monto={esperado} />
      </td>

      <td className="px-5 py-2.5 text-right">
        <DiferenciaTurno turno={h} />
      </td>

      <td className="px-5 py-2.5 text-right">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-8 px-2 cursor-pointer hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            onVerDetalle(h);
          }}
          aria-label={`Ver detalle del turno de ${h.perfiles?.nombre || "vendedor"}`}
          /* Es la puerta al cierre Z imprimible, así que el nombre tiene que
             estar aunque el ícono esté solo: la columna ya no da para el
             rótulo al lado. */
          title="Ver detalle e imprimir cierre Z"
        >
          <FileText className="w-4 h-4" />
        </Button>
      </td>
    </tr>
  );
}
