"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ChevronRight,
  CircleAlert,
  Lightbulb,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Insight } from "@/features/reports/actions/get-advisor-insights";

interface AdvisorMiniListProps {
  insights: Insight[];
}

/**
 * Presentación del Advisor para el dashboard — mismo dato que
 * advisor-banner.tsx (getAdvisorInsights, sin tocar su motor de reglas)
 * pero SIN carrusel, sin botón de cierre, sin persistencia en localStorage:
 * lista estática de hasta 3 líneas, siempre visible. advisor-banner.tsx
 * sigue intacto para /reportes — son dos superficies distintas del mismo
 * array de insights.
 *
 * Muestra TODOS los que le pasen: el corte lo decide el llamador (el panel
 * pide 5, ver INSIGHTS_EN_PANEL). Antes cortaba en 3 acá adentro además del
 * corte del motor, así que subir el límite en un solo lado no hacía nada.
 *
 * Es cliente por UNA cosa: la marca de "nuevo". Sin ella la tarjeta muestra
 * las mismas cinco líneas todos los días —stock crítico y deuda vencida están
 * siempre— y a la semana se vuelve papel tapiz: se deja de leer justo cuando
 * aparece algo que sí importa. Qué se vio antes es una preferencia de quien
 * mira, no un dato del negocio, así que vive en localStorage y no en la base.
 */
const CLAVE_VISTOS = "comerz.insights.vistos";

/** Los ids guardados, o null si no hay registro previo. Son dos cosas
 * distintas y el llamador las distingue. */
function parsearVistos(crudo: string | null): string[] | null {
  if (!crudo) return null;
  try {
    const parsed = JSON.parse(crudo);
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === "string")
      : null;
  } catch {
    return null;
  }
}

/** localStorage no notifica cambios propios, así que la suscripción es un
 * no-op: alcanza con leerlo en cada render (devuelve el mismo string, que es
 * lo que useSyncExternalStore necesita para no rerenderizar en loop). */
const sinSuscripcion = () => () => {};

export function AdvisorMiniList({ insights }: Readonly<AdvisorMiniListProps>) {
  // useSyncExternalStore y no useState+useEffect: leer un store externo es
  // justo para lo que existe, y resuelve solo la hidratación — el server
  // renderiza con el snapshot de server (null, sin marcas) y el cliente
  // rerenderiza con el suyo.
  const vistosCrudo = useSyncExternalStore(
    sinSuscripcion,
    () => {
      try {
        return window.localStorage.getItem(CLAVE_VISTOS);
      } catch {
        // Modo privado o storage bloqueado: la tarjeta anda igual, sin marcas.
        return null;
      }
    },
    () => null,
  );

  const vistos = parsearVistos(vistosCrudo);
  const ids = insights.map((i) => i.id);
  // Sin historia previa NO se marca nada: si "no hay registro" se tratara como
  // "no vi ninguno", el primer render marcaría las cinco como nuevas, que es
  // exactamente el ruido que esta marca existe para evitar.
  const nuevos = new Set(
    vistos ? ids.filter((id) => !vistos.includes(id)) : [],
  );

  const idsActuales = ids.join("|");
  useEffect(() => {
    try {
      // Se guardan solo los que están AHORA: si un insight se resuelve y
      // vuelve dentro de un mes, vuelve a ser noticia.
      window.localStorage.setItem(
        CLAVE_VISTOS,
        JSON.stringify(idsActuales ? idsActuales.split("|") : []),
      );
    } catch {
      // Sin storage no se marca nada y ya.
    }
  }, [idsActuales]);

  // Ya vienen ordenados por urgencia (y plata en juego) desde el motor: el
  // orden ES la prioridad. "Pendientes" cuenta lo que pide algo (no las
  // buenas noticias).
  const pendientes = insights.filter(
    (i) => i.type === "danger" || i.type === "warning",
  ).length;

  return (
    <section
      aria-label="Requiere tu atención"
      className="flex h-full min-w-0 flex-col rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">
            Requiere tu atención
          </h2>
        </div>
        {pendientes > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-foreground">
            {pendientes} pendiente{pendientes === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {insights.length > 0 ? (
        <ol className="-mx-2 mt-3 flex-1 space-y-1">
          {insights.map((insight) => (
            <Senal
              key={insight.id}
              insight={insight}
              nueva={nuevos.has(insight.id)}
            />
          ))}
        </ol>
      ) : (
        <p className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
          Todo en orden: no hay nada urgente hoy.
        </p>
      )}
    </section>
  );
}

const ICONO_POR_TIPO: Record<
  Insight["type"],
  { Icono: LucideIcon; color: string }
> = {
  danger: { Icono: CircleAlert, color: "text-danger" },
  warning: { Icono: TriangleAlert, color: "text-warning" },
  success: { Icono: TrendingUp, color: "text-success" },
  info: { Icono: Lightbulb, color: "text-primary" },
};

/** Una fila: ícono de la gravedad, título, el porqué en una o dos líneas y
 * una flecha. Toda la fila lleva a donde se resuelve. */
function Senal({
  insight,
  nueva,
}: Readonly<{ insight: Insight; nueva: boolean }>) {
  const { Icono, color } = ICONO_POR_TIPO[insight.type];
  const contenido = (
    <>
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted ${color}`}
      >
        <Icono className="size-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {insight.title}
          {nueva && (
            <span className="ml-2 text-xs font-medium text-primary">Nuevo</span>
          )}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {insight.message}
        </p>
      </div>
    </>
  );

  if (!insight.href) {
    return (
      <li className="flex items-start gap-3 rounded-xl px-2 py-2.5">
        {contenido}
      </li>
    );
  }
  return (
    <li>
      <Link
        href={insight.href}
        prefetch={false}
        aria-label={`${insight.title}: ${insight.actionLabel ?? "ver"}`}
        className="group flex items-start gap-3 rounded-xl px-2 py-2.5 transition-[background-color,transform] duration-150 ease-out hover:bg-muted/60 active:scale-[0.99]"
      >
        {contenido}
        <ChevronRight className="mt-2.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}
