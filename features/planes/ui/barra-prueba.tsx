import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { getEstadoActivacionAction } from "@/features/onboarding/actions/get-estado-activacion";
import { calcularProgresoActivacion } from "@/features/onboarding/lib/pasos-activacion";
import { getSolicitudPendienteAction } from "@/features/planes/actions/solicitud-plan";
import {
  construirBarraPrueba,
  type TonoBarraPrueba,
} from "@/features/planes/lib/barra-prueba";

/**
 * La franja de la prueba gratis, entre el navbar y el contenido.
 *
 * Se ve en TODAS las pantallas a propósito: la urgencia sirve si está a la
 * vista mientras el comercio trabaja, no escondida en /perfil. Por eso mismo
 * es una sola línea y no anima nada: aparece en cada navegación, y algo que se
 * ve cientos de veces no se mueve.
 *
 * Solo para el ADMIN (lo decide el layout): la vendedora no elige el plan, y
 * contarle los días de prueba del negocio es ruido. `estado_activacion`
 * además devuelve null para cualquier otro rol.
 *
 * Las tres lecturas corren en paralelo y SOLO para los negocios en prueba;
 * el layout la monta en un Suspense para que no frene al resto de la pantalla.
 * Si alguna falla, la barra sigue con los días (ver `construirBarraPrueba`).
 */
export async function BarraPrueba({
  inicio,
  vencimiento,
}: Readonly<{ inicio: string; vencimiento: string }>) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [estado, { count, error: errorVentas }, solicitud] = await Promise.all([
    getEstadoActivacionAction(),
    // `head: true`: solo el número, ninguna fila viaja. Las anuladas no son
    // ventas que el comercio "hizo con Comerz". Por `estado_operacion`, como
    // `metricas_globales_comerz`: hay anuladas viejas sin `anulada_en`.
    supabase
      .from("ventas")
      .select("id", { count: "exact", head: true })
      .eq("estado_operacion", "CONFIRMADA"),
    getSolicitudPendienteAction(),
  ]);

  if (errorVentas) {
    console.error("[BARRA PRUEBA] No se pudieron contar las ventas:", errorVentas);
  }

  const barra = construirBarraPrueba({
    inicio,
    vencimiento,
    activacion: estado ? calcularProgresoActivacion(estado) : null,
    ventas: errorVentas ? null : (count ?? 0),
    planSolicitado: solicitud?.plan_solicitado_nombre ?? null,
  });

  const estilo = ESTILOS[barra.tono];

  return (
    <div role="status" className={`relative shrink-0 border-b ${estilo.caja}`}>
      <div className="flex min-h-10 items-center gap-3 px-4 py-1.5 text-xs sm:text-sm">
        <p className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{barra.titulo}</span>
          <span className="text-muted-foreground"> · {barra.detalle}</span>
        </p>
        {barra.cta ? (
          <Link
            href={barra.cta.href}
            className={`inline-flex h-8 shrink-0 items-center rounded-md px-3 text-xs font-semibold transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] ${estilo.cta}`}
          >
            {barra.cta.etiqueta}
          </Link>
        ) : null}
      </div>

      {/* Lo que QUEDA de la prueba: se vacía con los días. Sin transición: el
          número cambia una vez por día y se lee al cargar, no se mira moverse. */}
      {barra.porcentajeRestante !== null ? (
        <div
          role="progressbar"
          aria-label="Días de prueba restantes"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={barra.porcentajeRestante}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-border/60"
        >
          <div
            className={`h-full ${estilo.relleno}`}
            style={{ width: `${barra.porcentajeRestante}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Mismo alto que la barra: si no, al llegar los datos el contenido salta. */
export function BarraPruebaEsqueleto() {
  return <div aria-hidden className="h-10 shrink-0 border-b border-border bg-muted/30" />;
}

const ESTILOS: Record<
  TonoBarraPrueba,
  { caja: string; cta: string; relleno: string }
> = {
  neutral: {
    caja: "border-border bg-muted/30 text-foreground",
    cta: "bg-primary text-primary-foreground hover:bg-primary/90",
    relleno: "bg-[var(--marca-naranja)]",
  },
  aviso: {
    caja: "border-warning/20 bg-warning/10 text-foreground",
    cta: "bg-warning text-white hover:bg-warning/90",
    relleno: "bg-warning",
  },
  error: {
    caja: "border-danger/20 bg-danger/10 text-foreground",
    cta: "bg-danger text-white hover:bg-danger/90",
    relleno: "bg-danger",
  },
  exito: {
    caja: "border-success/20 bg-success/10 text-foreground",
    cta: "border border-success/30 text-success hover:bg-success/10",
    relleno: "bg-success",
  },
};
