"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Eye, Info, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { formatearMoneda } from "@/shared/utils/formatters";
import { useAlertasCajaStore } from "@/shared/store/alertas-caja-store";
import {
  desmarcarAlertaRevisadaAction,
  getAlertasCajaAction,
  marcarAlertaRevisadaAction,
} from "../actions/auditoria-caja";
import {
  contarPendientes,
  ETIQUETA_SEVERIDAD,
  filtrarAlertas,
  QUE_HACER,
  type AlertaCaja,
  type FiltroEstadoAlerta,
  type SeveridadAlerta,
} from "../lib/alerta-caja";

const PERIODOS = [
  { dias: 7, label: "7 días" },
  { dias: 30, label: "30 días" },
  { dias: 90, label: "90 días" },
] as const;

const ESTADOS: { valor: FiltroEstadoAlerta; label: string }[] = [
  { valor: "pendientes", label: "Sin revisar" },
  { valor: "revisadas", label: "Revisadas" },
  { valor: "todas", label: "Todas" },
];

const ESTILO_SEVERIDAD: Record<SeveridadAlerta, { franja: string; pill: string; Icono: typeof Info }> = {
  ALTA: { franja: "bg-destructive", pill: "bg-destructive/10 text-destructive", Icono: ShieldAlert },
  MEDIA: { franja: "bg-warning", pill: "bg-warning/10 text-warning", Icono: AlertTriangle },
  BAJA: { franja: "bg-muted-foreground/30", pill: "bg-muted text-muted-foreground", Icono: Info },
};

const formatoFecha = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * /caja → Auditoría: lo que pasó con la plata que alguien tendría que mirar.
 *
 * Nace de la auditoría de El Nono Cacho (17–28/9/2026): cada cosa que hubo que
 * encontrar a mano —turnos abiertos de noche, sobrantes que eran gastos mal
 * cargados, un fondo copiado de otro día, cambios cargados como gasto— ya
 * estaba en la base. Faltaba que alguien la viera a tiempo. Las alertas las
 * arma la base (`alertas_caja`); esta pantalla las lista, dice qué hacer con
 * cada una y deja marcarlas como revisadas (con nota) para el negocio entero.
 */
export function AuditoriaCaja() {
  const [dias, setDias] = useState<number>(30);
  const [estado, setEstado] = useState<FiltroEstadoAlerta>("pendientes");
  const [severidades, setSeveridades] = useState<SeveridadAlerta[]>([]);
  const [alertas, setAlertas] = useState<AlertaCaja[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);
  const refrescarAviso = useAlertasCajaStore((s) => s.refrescar);

  useEffect(() => {
    let cancelado = false;
    getAlertasCajaAction(dias).then((res) => {
      if (cancelado) return;
      setAlertas(res.data);
      setError(res.error);
      setCargando(false);
    });
    return () => {
      cancelado = true;
    };
  }, [dias, version]);

  const cambiarPeriodo = (nuevo: number) => {
    if (nuevo === dias) return;
    setCargando(true);
    setDias(nuevo);
  };

  const alternarSeveridad = (s: SeveridadAlerta) =>
    setSeveridades((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const onCambio = useCallback(async () => {
    setCargando(true);
    setVersion((v) => v + 1);
    await refrescarAviso();
  }, [refrescarAviso]);

  const visibles = alertas ? filtrarAlertas(alertas, estado, severidades) : [];
  const pendientes = alertas ? contarPendientes(alertas) : 0;
  const porSeveridad = (s: SeveridadAlerta) =>
    alertas?.filter((a) => !a.revisada && a.severidad === s).length ?? 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-bold text-foreground">Auditoría de caja</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Lo que pasó con la plata y conviene mirar: cajas que quedaron abiertas,
          diferencias de arqueo, gastos grandes, fondos que no cierran. Cuando
          revisás una alerta, queda marcada para todo el negocio.
        </p>
      </header>

      {/* Resumen: cuántas hay de cada una, sin revisar. */}
      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        {(["ALTA", "MEDIA", "BAJA"] as const).map((s) => {
          const { pill, Icono } = ESTILO_SEVERIDAD[s];
          const activa = severidades.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={activa}
              onClick={() => alternarSeveridad(s)}
              className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                activa ? "border-primary" : "border-border hover:bg-muted/50"
              }`}
            >
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${pill}`}>
                <Icono className="h-3 w-3" /> {ETIQUETA_SEVERIDAD[s]}
              </span>
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                {alertas ? porSeveridad(s) : "–"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Estado" className="flex gap-1 rounded-lg bg-muted p-1">
          {ESTADOS.map((e) => (
            <button
              key={e.valor}
              type="button"
              role="tab"
              aria-selected={estado === e.valor}
              onClick={() => setEstado(e.valor)}
              className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
                estado === e.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {e.label}
              {e.valor === "pendientes" && pendientes > 0 && (
                <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] text-white">{pendientes}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              aria-pressed={dias === p.dias}
              onClick={() => cambiarPeriodo(p.dias)}
              className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
                dias === p.dias ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {cargando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : alertas === null ? null : visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <p className="text-sm font-medium text-foreground">
            {estado === "pendientes" ? "No hay nada sin revisar." : "No hay alertas con este filtro."}
          </p>
          <p className="text-xs text-muted-foreground">
            Se revisa cada vez que entrás; el menú avisa cuando aparece algo nuevo.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visibles.map((a) => (
            <FilaAlerta key={a.clave} alerta={a} onCambio={onCambio} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilaAlerta({ alerta, onCambio }: Readonly<{ alerta: AlertaCaja; onCambio: () => Promise<void> }>) {
  const [abierta, setAbierta] = useState(false);
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const { franja, pill, Icono } = ESTILO_SEVERIDAD[alerta.severidad];
  const queHacer = QUE_HACER[alerta.tipo];

  const marcar = async () => {
    setGuardando(true);
    const res = await marcarAlertaRevisadaAction(alerta.clave, nota);
    setGuardando(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Alerta revisada");
    setAbierta(false);
    setNota("");
    await onCambio();
  };

  const desmarcar = async () => {
    setGuardando(true);
    const res = await desmarcarAlertaRevisadaAction(alerta.clave);
    setGuardando(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    await onCambio();
  };

  return (
    <li className={`relative overflow-hidden rounded-lg border border-border bg-card ${alerta.revisada ? "opacity-70" : ""}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${franja}`} />
      <div className="space-y-2 py-3 pl-4 pr-3">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${pill}`}>
                <Icono className="h-3 w-3" /> {ETIQUETA_SEVERIDAD[alerta.severidad]}
              </span>
              <h3 className="text-sm font-semibold text-foreground">{alerta.titulo}</h3>
            </div>
            <p className="text-xs text-muted-foreground">{formatoFecha.format(new Date(alerta.fecha))}</p>
          </div>
          {alerta.monto !== null && (
            <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {formatearMoneda(alerta.monto)}
            </span>
          )}
        </div>

        <p className="text-sm text-foreground/90">{alerta.detalle}</p>
        {queHacer && !alerta.revisada && (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Qué hacer: </span>
            {queHacer}
          </p>
        )}

        {alerta.revisada ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
            <span>
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-success" />
              Revisada{alerta.revisada_por ? ` por ${alerta.revisada_por}` : ""}
              {alerta.revisada_en ? ` el ${formatoFecha.format(new Date(alerta.revisada_en))}` : ""}
              {alerta.nota ? ` · “${alerta.nota}”` : ""}
            </span>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={desmarcar} disabled={guardando}>
              <RotateCcw className="mr-1 h-3 w-3" /> Volver a sin revisar
            </Button>
          </div>
        ) : abierta ? (
          <div className="space-y-2 border-t border-border pt-2">
            <label htmlFor={`nota-${alerta.clave}`} className="text-xs font-medium text-foreground">
              Nota (opcional): qué encontraste
            </label>
            <Textarea
              id={`nota-${alerta.clave}`}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej: el sueldo se pagó con la Caja Grande, ya se corrigió"
              rows={2}
              className="text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAbierta(false)} disabled={guardando}>
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={marcar} disabled={guardando}>
                {guardando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Marcar como revisada
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAbierta(true)}>
              <Eye className="mr-1 h-3.5 w-3.5" /> Revisar
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
