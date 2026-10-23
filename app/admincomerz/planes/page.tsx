import { Check, Users, Building2 } from "lucide-react";
import { getPlanesCompletosAction } from "@/features/admin/actions/planes-actions";
import { getPanelComerzAction } from "@/features/admin/actions/metricas-comerz";
import {
  DESCUENTO_SEMESTRAL,
  NOMBRE_FEATURE,
  precioMensualEfectivo,
  precioPorCiclo,
} from "@/shared/lib/planes";
import { formatearMoneda } from "@/shared/utils/formatters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Planes | Comerz" };

export default async function AdminPlanesPage() {
  const [planes, { negocios }] = await Promise.all([
    getPlanesCompletosAction(),
    getPanelComerzAction(),
  ]);

  const usoPorPlan = new Map<string, number>();
  for (const n of negocios) {
    if (!n.plan_id) continue;
    usoPorPlan.set(n.plan_id, (usoPorPlan.get(n.plan_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Planes</h1>
        <p className="text-sm text-muted-foreground">
          Precio de lista mensual. En semestral se cobra{" "}
          {Math.round(DESCUENTO_SEMESTRAL * 100)}% menos por mes, de una vez
          cada 6 meses.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 items-start">
        {planes.map((plan) => {
          const enUso = usoPorPlan.get(plan.id) ?? 0;
          const semestralMes = precioMensualEfectivo(
            plan.precio_mensual,
            "semestral",
          );

          return (
            <div
              key={plan.id}
              className="border border-border rounded-xl bg-card overflow-hidden flex flex-col"
            >
              <div className="p-5 border-b border-border space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-bold text-lg">{plan.nombre}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {plan.descripcion}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    {enUso} comercio{enUso === 1 ? "" : "s"}
                  </span>
                </div>

                <div>
                  <p className="text-2xl font-black tracking-tight">
                    {formatearMoneda(plan.precio_mensual)}
                    <span className="text-sm font-medium text-muted-foreground">
                      /mes
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Semestral: {formatearMoneda(semestralMes)}/mes ·{" "}
                    {formatearMoneda(
                      precioPorCiclo(plan.precio_mensual, "semestral"),
                    )}{" "}
                    cada 6 meses
                  </p>
                </div>

                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    {plan.reglas.max_usuarios ?? "∞"} usuario
                    {plan.reglas.max_usuarios === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" />
                    {plan.reglas.max_sucursales ?? "∞"} sucursal
                    {plan.reglas.max_sucursales === 1 ? "" : "es"}
                  </span>
                  <span>
                    {plan.reglas.max_ventas_mensuales
                      ? `${plan.reglas.max_ventas_mensuales} ventas/mes (aviso)`
                      : "ventas sin tope"}
                  </span>
                  <span>
                    {plan.reglas.max_productos
                      ? `${plan.reglas.max_productos} productos`
                      : "productos sin tope"}
                  </span>
                  <span>
                    CC:{" "}
                    {plan.reglas.max_clientes_cuenta_corriente
                      ? `${plan.reglas.max_clientes_cuenta_corriente} clientes`
                      : "ilimitada"}
                  </span>
                </div>
              </div>

              <ul className="p-5 space-y-2 flex-1">
                {(plan.reglas.features ?? []).map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                    <span>{NOMBRE_FEATURE[f] ?? f}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Los límites y las features salen de <code>planes.reglas</code> en la
        base. Cambiar un tope o mover una feature de plan es editar esa fila: no
        hace falta tocar el código ni desplegar.
      </p>
    </div>
  );
}
