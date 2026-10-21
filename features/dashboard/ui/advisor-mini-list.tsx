"use client";

import { useEffect, useState, useTransition, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Lightbulb,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Insight } from "@/features/reports/actions/get-advisor-insights";
import { configurarComplementoAction } from "@/features/reports/actions/complementos-catalogo";
import { Button } from "@/shared/ui/button";

interface AdvisorMiniListProps {
  insights: Insight[];
}

/**
 * Presentación de Comerz Intelligence en el panel y en /reportes: la lista
 * "Requiere tu atención". Usa getAdvisorInsights sin tocar su motor de reglas,
 * como lista estática (sin carrusel ni botón de cierre).
 *
 * Muestra TODOS los que le pasen: el corte lo decide el llamador
 * (LIMITE_RECOMENDACIONES).
 *
 * Es cliente por DOS cosas: la marca de "nuevo" (qué se vio antes es una
 * preferencia de quien mira, así que vive en localStorage y no en la base) y
 * el botón de activar una asociación del catálogo.
 */
const CLAVE_VISTOS = "comerz.insights.vistos";
/** Si la lista está desplegada. Preferencia de quien mira: vive en localStorage. */
const CLAVE_ABIERTO = "comerz.insights.abierto";
const ID_LISTA = "requiere-tu-atencion-lista";

function leerAbierto(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_ABIERTO) !== "false";
  } catch {
    return true;
  }
}

/** localStorage no avisa de sus propios cambios: los suscriptores se avisan a mano. */
const suscriptoresAbierto = new Set<() => void>();
function suscribirAbierto(avisar: () => void) {
  suscriptoresAbierto.add(avisar);
  return () => {
    suscriptoresAbierto.delete(avisar);
  };
}
function avisarAbierto() {
  suscriptoresAbierto.forEach((avisar) => avisar());
}

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
  // Arranca desplegada (así se ve la primera vez) y después recuerda lo que
  // eligió quien mira. Se lee al montar para no romper la hidratación.
  const abierto = useSyncExternalStore(suscribirAbierto, leerAbierto, () => true);
  const alternarAbierto = () => {
    try {
      window.localStorage.setItem(CLAVE_ABIERTO, String(!abierto));
    } catch {
      // Sin storage la preferencia dura hasta recargar.
    }
    avisarAbierto();
  };

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
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0">
          <button
            type="button"
            onClick={alternarAbierto}
            aria-expanded={abierto}
            aria-controls={ID_LISTA}
            className="-mx-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-base font-semibold text-foreground transition-colors hover:bg-muted/60 cursor-pointer"
          >
            Requiere tu atención
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform duration-200 ease-out ${abierto ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
        </h2>
        {pendientes > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-foreground">
            {pendientes} pendiente{pendientes === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {abierto &&
        (insights.length > 0 ? (
          <ol id={ID_LISTA} className="-mx-2 mt-3 flex-1 space-y-1">
            {insights.map((insight) => (
              <Senal
                key={insight.id}
                insight={insight}
                nueva={nuevos.has(insight.id)}
              />
            ))}
          </ol>
        ) : (
          <p
            id={ID_LISTA}
            className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground"
          >
            Todo en orden: no hay nada urgente hoy.
          </p>
        ))}
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

/** Ícono de la gravedad, título, el porqué y la marca de "nuevo". Lo comparten
 * la fila con link y la fila con botón, para que se vean iguales. */
function Contenido({ insight, nueva }: Readonly<{ insight: Insight; nueva: boolean }>) {
  const { Icono, color } = ICONO_POR_TIPO[insight.type];
  return (
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
}

/** Una fila: ícono de la gravedad, título, el porqué en una o dos líneas y
 * una flecha. Toda la fila lleva a donde se resuelve. Si la acción es
 * activar algo ahí mismo (asociación), la fila tiene un botón. */
function Senal({
  insight,
  nueva,
}: Readonly<{ insight: Insight; nueva: boolean }>) {
  if (insight.accionAsociacion) {
    return <FilaConBoton insight={insight} nueva={nueva} />;
  }
  if (!insight.href) {
    return (
      <li className="flex items-start gap-3 rounded-xl px-2 py-2.5">
        <Contenido insight={insight} nueva={nueva} />
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
        <Contenido insight={insight} nueva={nueva} />
        <ChevronRight className="mt-2.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

/** Fila de una asociación sugerida: el botón activa el par en el catálogo.
 * Al activarla la asociación deja de ser sugerida, así que la fila desaparece
 * en el refresh. */
function FilaConBoton({
  insight,
  nueva,
}: Readonly<{ insight: Insight; nueva: boolean }>) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const par = insight.accionAsociacion;

  const activar = () => {
    if (!par) return;
    setError(null);
    iniciar(async () => {
      try {
        const resultado = await configurarComplementoAction(
          par.producto_a_id,
          par.producto_b_id,
          true,
        );
        if (resultado.error) setError(resultado.error);
        else router.refresh();
      } catch {
        setError("No pudimos activar la asociación. Intentá de nuevo.");
      }
    });
  };

  return (
    <li className="rounded-xl px-2 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Contenido insight={insight} nueva={nueva} />
        </div>
        <Button
          size="sm"
          className="min-h-11 shrink-0"
          disabled={pendiente}
          onClick={activar}
        >
          {pendiente ? "Activando…" : insight.actionLabel}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 pl-12 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
