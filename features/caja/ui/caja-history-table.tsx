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
  hayAbiertos: boolean;
  /** Diferencia neta del día. null = no se puede calcular todavía (mismo
   * criterio que la Vista Gerencial: solo con TODOS los turnos cerrados). */
  diferencia: number | null;
  /** Cerrado entero pero con algún turno sin efectivo_esperado guardado: hay
   * que decir "S/D", no sumar como si ese turno hubiera dado cero. */
  diferenciaIncompleta: boolean;
}

/** Diferencia de un turno cerrado. null si no se puede calcular. Es la misma
 * cuenta que ya hacía la fila individual, extraída para que el total del día y
 * el detalle no puedan divergir. */
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

        return {
          clave,
          etiqueta: etiquetaDia(turnos[0].fecha_apertura),
          turnos,
          totalVendido,
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
        <div className="overflow-x-auto">
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
                    colSpan={5}
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
  onToggle,
  onVerDetalle,
}: Readonly<{
  dia: DiaAgrupado;
  abierto: boolean;
  cerrados: number;
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
          {dia.totalVendido === null ? (
            <span className="text-muted-foreground text-[10px] uppercase tracking-widest font-bold">
              S/D
            </span>
          ) : (
            formatearMoneda(dia.totalVendido)
          )}
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
          <TurnoFila key={h.id} turno={h} onVerDetalle={onVerDetalle} />
        ))}
    </>
  );
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

/** Fila individual de cajera. Es la misma que había antes de agrupar: mismas
 * columnas, mismos badges, mismo botón de detalle — solo que ahora vive
 * adentro de su día y va indentada. */
function TurnoFila({
  turno: h,
  onVerDetalle,
}: Readonly<{
  turno: TurnoCajaHistorial;
  onVerDetalle: (turno: TurnoCajaHistorial) => void;
}>) {
  const isAbierto = h.estado === "ABIERTO";
  const idCorto = h.id.split("-")[0].toUpperCase();
  const diferencia = diferenciaTurno(h);
  const fueAjustado =
    h.efectivo_esperado_actual != null &&
    h.efectivo_esperado != null &&
    Math.abs(
      Number(h.efectivo_esperado_actual) - Number(h.efectivo_esperado),
    ) >= 0.01;
  const esperadoNegativo =
    (h.efectivo_esperado_actual ?? h.efectivo_esperado) != null &&
    (h.efectivo_esperado_actual ?? h.efectivo_esperado) !== "" &&
    Number(h.efectivo_esperado_actual ?? h.efectivo_esperado) < 0;

  return (
    <tr className="bg-muted/20 hover:bg-muted/40 transition-colors text-xs">
      {/* Las 7 columnas originales no entran en las 5 del día sin desalinear
          todo, así que la fila de turno se arma como un bloque propio que
          ocupa el ancho completo. */}
      <td colSpan={5} className="px-5 py-2.5">
        <div className="flex items-center gap-3 pl-4 border-l-2 border-border">
          <span className="font-bold text-muted-foreground whitespace-nowrap w-16 shrink-0">
            #{idCorto}
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground truncate">
              {h.perfiles?.nombre || "Vendedor"}
            </p>
            <p className="text-muted-foreground whitespace-nowrap">
              {formatearFechaHora(h.fecha_apertura)}
              {" → "}
              {isAbierto ? "en curso" : formatearFechaHora(h.fecha_cierre)}
            </p>
          </div>

          <div className="shrink-0 hidden sm:block">
            {isAbierto ? (
              <Badge
                variant="success"
              >
                ABIERTO
              </Badge>
            ) : (
              <div className="flex items-center gap-1">
                <Badge variant="outline">CERRADO</Badge>
                {fueAjustado && <Badge variant="info">AJUSTADO</Badge>}
              </div>
            )}
          </div>

          <div className="shrink-0 text-right min-w-[90px]">
            {isAbierto ? (
              <span className="text-muted-foreground">-</span>
            ) : esperadoNegativo ? (
              /* Va antes del chequeo de null: diferenciaTurno() devuelve null
                 para estos turnos, y sin este orden el ⚠ se perdería. */
              <Badge
                variant="danger"
                title="El efectivo esperado calculado dio negativo"
              >
                ⚠ Esperado negativo
              </Badge>
            ) : diferencia === null ? (
              <span className="text-muted-foreground text-[10px] uppercase tracking-widest font-bold">
                S/D
              </span>
            ) : diferencia === 0 ? (
              <Badge
                variant="success"
              >
                Perfecto
              </Badge>
            ) : diferencia < 0 ? (
              <Badge
                variant="danger"
              >
                {formatearMoneda(diferencia)}
              </Badge>
            ) : (
              <Badge
                variant="info"
              >
                +{formatearMoneda(diferencia)}
              </Badge>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-8 px-3 cursor-pointer hover:bg-muted shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onVerDetalle(h);
            }}
          >
            <FileText className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Ver Detalle</span>
          </Button>
        </div>
      </td>
    </tr>
  );
}
