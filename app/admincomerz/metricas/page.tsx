import { getMetricasGlobalesAction } from "@/features/admin/actions/metricas-globales";
import { resumirMetricasGlobales } from "@/features/admin/lib/metricas-globales";
import { MetricasGlobalesPanel } from "@/features/admin/ui/metricas-globales-panel";
import { formatearFechaHora } from "@/shared/utils/formatters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Métricas | Comerz" };

/**
 * El tablero de VOLUMEN del SaaS: cuántos locales, en qué plan, qué venden,
 * cuánto se vende a través de Comerz, cuánta gente lo usa.
 *
 * Es una página aparte del Dashboard a propósito: aquel responde "¿cómo viene
 * el negocio de Comerz?" (cobrado, MRR, churn, gastos, embudo); esta responde
 * "¿cuánto se usa Comerz?". Son dos preguntas y mezclarlas en una pantalla
 * hace que las dos se lean peor.
 */
export default async function AdminMetricasPage() {
  const crudas = await getMetricasGlobalesAction();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Métricas</h1>
        <p className="text-sm text-white/40">
          Cuánto se usa Comerz, en todos los locales juntos.
          {crudas && (
            <span className="ml-2 text-white/25">
              Calculado {formatearFechaHora(crudas.generado_en)}.
            </span>
          )}
        </p>
      </div>

      {crudas ? (
        <MetricasGlobalesPanel resumen={resumirMetricasGlobales(crudas)} />
      ) : (
        <div className="rounded-lg border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200">
          No se pudieron cargar las métricas. Solo el super admin puede verlas;
          si sos vos, revisá el log del server.
        </div>
      )}
    </div>
  );
}
