import { Check } from "lucide-react";
import type { PlanCompleto, PlanDelNegocio } from "@/features/admin/actions/planes-actions";
import type { UsoDelPlan } from "@/features/planes/actions/uso-del-plan";
import {
  NOMBRE_FEATURE,
  precioMensualEfectivo,
  precioPorCiclo,
} from "@/shared/lib/planes";
import {
  agruparFeatures,
  derivarEstadoSuscripcion,
  diasHastaVencimiento,
  type UsoLimite,
} from "@/shared/lib/suscripcion";
import { EMAIL_COMERZ } from "@/shared/lib/contacto";
import { CambiarPlanModal } from "./cambiar-plan-modal";
import { MailCopiable } from "./mail-copiable";
import type { SolicitudPlan } from "@/features/planes/actions/solicitud-plan";
import { formatearMoneda } from "@/shared/utils/formatters";
import { precioEfectivo } from "@/features/admin/lib/precio-efectivo";
import { EstadoBadge } from "./estado-badge";
import { AlertaSuscripcion } from "./alerta-suscripcion";
import { UsoDelPlanSeccion } from "./uso-del-plan-seccion";
import { OtrosPlanesSeccion } from "./otros-planes-seccion";

/**
 * Centro de suscripción del comercio.
 *
 * Es un componente de servidor: todo lo que muestra son datos ya resueltos, no
 * hay estado ni interacción que justifique bajarlo al cliente.
 *
 * ALCANCE, a propósito: Comerz todavía no tiene facturación. No hay pasarela
 * de pagos, ni método de pago guardado, ni historial de cobros, ni forma de
 * que el comercio cambie de plan o cancele por su cuenta — plan y estado los
 * mueve un admin desde /admincomerz. Por eso esta pantalla NO tiene secciones
 * de método de pago ni de historial: mostrarlas vacías o con datos de ejemplo
 * sería peor que no mostrarlas. Cuando exista el backend, se agregan acá.
 */
export function SuscripcionPanel({
  plan,
  planes,
  uso,
  solicitudPendiente = null,
  debito = null,
}: {
  plan: PlanDelNegocio | null;
  planes: PlanCompleto[];
  uso: UsoDelPlan | null;
  /** Pedido de cambio de plan ya enviado y sin resolver. */
  solicitudPendiente?: SolicitudPlan | null;
  /** La sección de débito automático (la arma la página, que sabe el rol). */
  debito?: React.ReactNode;
}) {
  const estado = derivarEstadoSuscripcion({
    estado: plan?.estado,
    plan: plan?.plan,
    vencimiento: plan?.vencimiento,
  });
  const dias = diasHastaVencimiento(plan?.vencimiento);

  const fechaLegible = plan?.vencimiento
    ? new Date(plan.vencimiento).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const modalidad = plan?.modalidad ?? "mensual";
  const tienePlan = Boolean(plan?.plan);
  const planActualCompleto = planes.find((p) => p.nombre === plan?.plan) ?? null;
  const grupos = agruparFeatures(plan?.reglas.features);
  const limites = construirLimites(plan, uso);

  return (
    <div className="space-y-8">
      {/* ============ CARD PRINCIPAL ============
          Contenedor propio en vez de <Card>: el padding vertical por defecto
          de shadcn era lo que impedía que la cabecera de color llegara hasta
          el borde superior. Acá la superficie es completa. */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border/60 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
                Plan actual
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                {plan?.plan ?? "Sin plan asignado"}
              </h2>
              {tienePlan && plan && (
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {formatearMoneda(
                    precioMensualEfectivo(precioEfectivo(plan.precioAcordado, plan.precioLista), modalidad),
                  )}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    / mes
                  </span>
                </p>
              )}
              {plan?.descripcion && (
                <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {plan.descripcion}
                </p>
              )}
            </div>

            <EstadoBadge estado={estado} />
          </div>

          {/* Datos duros del ciclo. Sólo si hay plan: sin plan no hay ciclo. */}
          {tienePlan && plan && (
            <dl className="mt-6 grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Modalidad
                </dt>
                <dd className="mt-1 text-sm font-semibold capitalize text-foreground">
                  {modalidad}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  {modalidad === "semestral"
                    ? "Importe cada 6 meses"
                    : "Importe mensual"}
                </dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {formatearMoneda(
                    precioPorCiclo(precioEfectivo(plan.precioAcordado, plan.precioLista), modalidad),
                  )}
                </dd>
              </div>
              <div>
                {/* "Vence" y no "próximo cobro": no hay renovación automática. */}
                <dt className="text-xs font-medium text-muted-foreground">
                  Vence
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">
                  {fechaLegible ?? "Sin fecha cargada"}
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div className="space-y-6 p-6 sm:p-8">
          <AlertaSuscripcion
            estado={estado}
            dias={dias}
            fechaLegible={fechaLegible}
          />

          {limites.length > 0 && <UsoDelPlanSeccion limites={limites} />}

          {grupos.length > 0 && (
            <section aria-labelledby="incluye-titulo" className="space-y-4">
              <h3
                id="incluye-titulo"
                className="text-sm font-semibold text-foreground"
              >
                Todo lo que incluye tu plan
              </h3>
              <div className="grid gap-6 sm:grid-cols-2">
                {grupos.map((grupo) => (
                  <div key={grupo.titulo}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {grupo.titulo}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {grupo.claves.map((clave) => (
                        <li
                          key={clave}
                          className="flex items-start gap-2 text-sm text-foreground"
                        >
                          <Check
                            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500"
                            aria-hidden="true"
                          />
                          <span>{NOMBRE_FEATURE[clave] ?? clave}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {debito}

      {/* ============ OTROS PLANES ============ */}
      <OtrosPlanesSeccion
        planes={planes}
        planActualNombre={plan?.plan ?? null}
        ordenActual={planActualCompleto?.orden ?? null}
        reglasActuales={plan?.reglas ?? null}
        modalidad={modalidad}
      />

      {/* ============ GESTIÓN ============
          Separada visualmente de todo lo anterior. Hoy cambiar de plan, renovar
          y dar de baja son gestiones que hace Comerz a mano: no hay endpoint
          de autogestión, y poner botones que no hacen nada sería peor. */}
      <section
        aria-labelledby="gestion-titulo"
        className="rounded-2xl border border-border bg-muted/20 p-6"
      >
        <h3
          id="gestion-titulo"
          className="text-sm font-semibold text-foreground"
        >
          Gestionar tu suscripción
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Para cambiar de plan, renovar o dar de baja tu suscripción,
          escribinos.  Si das de baja,
          seguís teniendo acceso hasta el final del período que ya pagaste y tus
          datos no se borran.
        </p>

        {/* Ninguno de los dos es `mailto:` ya: ese abría el cliente de correo
            del sistema, y en una PC de comercio con Outlook sin cuenta
            configurada eso es un asistente de configuración, no un mail. El
            pedido no llegaba nunca. */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <CambiarPlanModal
            planActual={plan?.plan ?? null}
            planes={planes.map((p) => ({
              id: p.id,
              nombre: p.nombre,
              precio_mensual: p.precio_mensual,
            }))}
            modalidad={modalidad}
            solicitudPendiente={solicitudPendiente}
          />
          <MailCopiable email={EMAIL_COMERZ} />
        </div>
      </section>
    </div>
  );
}

/**
 * Arma la lista de límites a mostrar.
 *
 * Sólo entra un límite si está declarado en `planes.reglas` Y su uso se puede
 * contar de verdad. `max_sucursales` queda afuera del conteo porque todavía no
 * existe tabla de sucursales: se muestra el tope del plan sin barra (usado en
 * null) en vez de inventar un número.
 */
function construirLimites(
  plan: PlanDelNegocio | null,
  uso: UsoDelPlan | null,
): UsoLimite[] {
  if (!plan?.plan) return [];

  const limites: UsoLimite[] = [];
  const reglas = plan.reglas;

  if (reglas.max_usuarios !== undefined) {
    // Se cuenta igual que el trigger `validar_limite_usuarios`: miembros +
    // invitaciones pendientes. Contar distinto haría que alguien viera
    // "3 de 5" y recibiera un error de límite alcanzado al invitar.
    const pendientes = uso?.invitacionesPendientes ?? 0;
    const usados =
      uso === null ? null : uso.usuariosActivos + pendientes;

    limites.push({
      clave: "usuarios",
      nombre: "Usuarios",
      usado: usados,
      limite: reglas.max_usuarios ?? null,
      detalle:
        pendientes > 0
          ? `Incluye ${pendientes} invitación${pendientes === 1 ? "" : "es"} pendiente${pendientes === 1 ? "" : "s"}, que ya reserva${pendientes === 1 ? "" : "n"} el lugar.`
          : undefined,
    });
  }

  if (reglas.max_clientes_cuenta_corriente !== undefined) {
    limites.push({
      clave: "cuenta_corriente",
      nombre: "Clientes con cuenta corriente",
      usado: uso?.clientesConCuentaCorriente ?? null,
      limite: reglas.max_clientes_cuenta_corriente ?? null,
      detalle: "Se cuentan sólo los clientes que hoy tienen deuda.",
    });
  }

  if (reglas.max_ventas_mensuales !== undefined) {
    limites.push({
      clave: "ventas_mensuales",
      nombre: "Ventas del mes",
      usado: uso?.ventasDelMes ?? null,
      limite: reglas.max_ventas_mensuales ?? null,
      blando: true,
      detalle:
        "Es un aviso: si lo superás seguís vendiendo igual, sin cortes. Cuenta las ventas del mes, sin las anuladas.",
    });
  }

  if (reglas.max_sucursales !== undefined && reglas.max_sucursales !== null) {
    limites.push({
      clave: "sucursales",
      nombre: "Sucursales",
      // Sin fuente de datos todavía: no se inventa el uso.
      usado: null,
      limite: reglas.max_sucursales,
    });
  }

  return limites;
}
