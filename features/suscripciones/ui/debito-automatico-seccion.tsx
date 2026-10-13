"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, CreditCard, Loader2, PauseCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { formatearMoneda } from "@/shared/utils/formatters";
import { activarDebitoAutomaticoAction, type SuscripcionVista } from "../actions/debito-automatico";

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });

/**
 * El débito automático en el panel del comercio (Perfil › Plan).
 *
 * - Sin suscripción: explica cuándo es el primer cobro y la activa. En prueba,
 *   primero elige el plan: no se cobra nada hasta que termina la prueba.
 * - Pendiente: falta autorizar la tarjeta en Mercado Pago (el link).
 * - Activa / pausada: lo dice, con el monto y el próximo débito.
 */
export function DebitoAutomaticoSeccion({
  negocioId,
  suscripcion,
  puedeGestionar,
  planes,
  planActualId,
  precioActual,
  vencimiento,
  vencido,
  enPrueba,
}: Readonly<{
  negocioId: string;
  suscripcion: SuscripcionVista | null;
  /** Solo el ADMIN del comercio activa o cambia la suscripción. */
  puedeGestionar: boolean;
  /** Planes con precio, para el que todavía no tiene uno (prueba). */
  planes: { id: string; nombre: string; precio: number }[];
  planActualId: string | null;
  /** Lo que paga hoy con su plan (acordado o de lista). */
  precioActual: number;
  vencimiento: string | null;
  /** Ya venció (o no tiene fecha): el primer débito es al activarlo. Lo calcula el server. */
  vencido: boolean;
  enPrueba: boolean;
}>) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const necesitaPlan = enPrueba || !planes.some((p) => p.id === planActualId);
  const [planId, setPlanId] = useState<string | null>(necesitaPlan ? (planes[1]?.id ?? planes[0]?.id ?? null) : planActualId);
  const planElegido = planes.find((p) => p.id === planId) ?? null;
  const monto = necesitaPlan ? (planElegido?.precio ?? 0) : precioActual;

  const activar = () =>
    startTransition(async () => {
      setError(null);
      const r = await activarDebitoAutomaticoAction(negocioId, planId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.initPoint) window.location.assign(r.initPoint);
    });

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <CreditCard className="h-5 w-5 text-primary" /> Débito automático
      </h3>

      {suscripcion?.estado === "authorized" ? (
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-success/10 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <p className="text-sm">
            Activo: se cobran <span className="font-semibold">{formatearMoneda(suscripcion.monto)}</span> por mes
            {suscripcion.planNombre ? ` (plan ${suscripcion.planNombre})` : ""} con tu tarjeta en Mercado Pago.
            {vencimiento && <> El próximo débito es el {fecha(vencimiento)}.</>} No tenés que hacer nada más.
          </p>
        </div>
      ) : suscripcion?.estado === "paused" ? (
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-warning/10 p-4">
          <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <p className="text-sm">
            Está pausado: Mercado Pago no va a cobrar hasta que lo reactives desde tu cuenta de Mercado Pago, o
            escribinos.
          </p>
        </div>
      ) : suscripcion?.estado === "pending" ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Falta autorizar tu tarjeta en Mercado Pago para que el débito de{" "}
            <span className="font-semibold text-foreground">{formatearMoneda(suscripcion.monto)}</span> por mes
            quede activo.
          </p>
          {suscripcion.initPoint && (
            <Button asChild className="h-12 w-full text-sm font-semibold sm:w-auto">
              <a href={suscripcion.initPoint}>Terminar en Mercado Pago</a>
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <p className="text-sm text-muted-foreground">
            Cargás tu tarjeta una vez en Mercado Pago y el plan se paga solo todos los meses. Podés cancelarlo cuando
            quieras.{" "}
            {vencido
              ? "El primer débito es al activarlo."
              : `El primer débito es el ${fecha(vencimiento!)}${enPrueba ? ", cuando termina tu prueba" : ""}: hasta entonces no se cobra nada.`}
          </p>

          {necesitaPlan && planes.length > 0 && (
            <div role="radiogroup" aria-label="Plan" className="grid gap-2 sm:grid-cols-3">
              {planes.map((p) => {
                const activo = p.id === planId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={activo}
                    onClick={() => setPlanId(p.id)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      activo ? "border-foreground bg-muted" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{p.nombre}</span>
                    <span className="block text-sm tabular-nums text-muted-foreground">
                      {formatearMoneda(p.precio)} / mes
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {puedeGestionar ? (
            <Button
              className="h-12 w-full text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.97] sm:w-auto"
              onClick={activar}
              disabled={pendiente || !(monto > 0)}
            >
              {pendiente ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
              Activar débito automático de {formatearMoneda(monto)} / mes
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Lo activa el administrador del comercio.</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
