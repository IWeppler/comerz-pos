"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { Lightbulb, AlertTriangle, TrendingUp } from "lucide-react";
import type { Insight } from "@/features/reports/actions/get-advisor-insights";

interface AdvisorMiniListProps {
  insights: Insight[];
}

const ICONO_POR_TIPO: Record<Insight["type"], typeof Lightbulb> = {
  danger: AlertTriangle,
  warning: AlertTriangle,
  success: TrendingUp,
  info: Lightbulb,
};

const COLOR_POR_TIPO: Record<Insight["type"], string> = {
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
  info: "text-info",
};

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
  const nuevos = new Set(vistos ? ids.filter((id) => !vistos.includes(id)) : []);

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

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col overflow-hidden h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Lightbulb className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Comerz Intelligence
        </span>
      </div>

      {insights.length > 0 ? (
        // Las filas se reparten el alto de la card por si el contenedor le da
        // más del que necesita, pero la card ya NO se estira sola: en el panel
        // va en un wrapper `shrink-0` y mide lo que miden sus 5 filas. Acá no
        // se inventan filas para llenar espacio.
        <div className="flex-1 flex flex-col divide-y divide-border overflow-y-auto">
          {insights.map((insight) => {
            const Icon = ICONO_POR_TIPO[insight.type];
            const color = COLOR_POR_TIPO[insight.type];
            const contenido = (
              <div className="flex items-start gap-2.5 px-3 py-2 w-full">
                <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${color}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">
                      {insight.title}
                    </p>
                    {nuevos.has(insight.id) && (
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-info bg-info/10 rounded px-1 py-0.5">
                        nuevo
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground line-clamp-2 mt-0.5">
                    {insight.message}
                  </p>
                </div>
              </div>
            );

            // min-h es el piso legible de una fila, no su alto: la card mide lo
            // que miden sus filas, así que con 5 quedan pegadas y sin aire —
            // el sobrante de la columna se lo llevan las KPIs.
            const claseFila = "flex-1 flex items-center min-h-[46px]";

            return insight.href ? (
              <Link
                key={insight.id}
                href={insight.href}
                className={`${claseFila} hover:bg-muted/30 transition-colors`}
              >
                {contenido}
              </Link>
            ) : (
              <div key={insight.id} className={claseFila}>
                {contenido}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-xs text-muted-foreground italic text-center">
            Sin recomendaciones por ahora.
          </p>
        </div>
      )}
    </div>
  );
}
