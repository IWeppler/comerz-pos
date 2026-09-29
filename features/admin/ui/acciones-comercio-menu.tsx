"use client";

import { useState, useTransition } from "react";
import {
  MoreHorizontal,
  Ban,
  FileText,
  Link2,
  LogIn,
  Play,
  Presentation,
  Receipt,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  cambiarEstadoNegocioAction,
  cambiarModuloPresupuestosAction,
  cambiarPlanAction,
  cambiarSlugAction,
} from "@/features/admin/actions/acciones-comercio";
import { RegistrarPagoModal } from "./registrar-pago-modal";
import { HistorialPagosModal } from "./historial-pagos-modal";
import { iniciarImpersonationAction } from "@/features/admin/actions/impersonate";
import { CLASE_PORTAL_OSCURO } from "@/features/admin/lib/tema-portal";
import {
  ESTADO_BAJA,
  esNegocioDemo,
  negocioHabilitado,
} from "@/shared/lib/estado-negocio";

export interface PlanOpcion {
  id: string;
  nombre: string;
  precio_mensual: number;
}

/**
 * Las acciones sobre un comercio, en un solo lugar.
 *
 * Suspender y dar de baja NO borran nada: el comercio deja de entrar y sus
 * datos quedan intactos, así que al pagar vuelve exactamente a donde estaba.
 * Perder el catálogo y las ventas de alguien por una cuota impaga sería un
 * daño irreversible por un problema temporal.
 */
export function AccionesComercioMenu({
  negocioId,
  nombre,
  slug,
  estado,
  planId,
  planVencimiento,
  planes,
  moduloPresupuestos,
}: Readonly<{
  negocioId: string;
  nombre: string;
  slug: string;
  estado: string;
  planId: string | null;
  /** Para que el modal de pago pueda mostrar desde cuándo cuenta el período. */
  planVencimiento: string | null;
  planes: PlanOpcion[];
  moduloPresupuestos: boolean;
}>) {
  const [pendiente, startTransition] = useTransition();
  const [pagoAbierto, setPagoAbierto] = useState(false);
  const [historialAbierto, setHistorialAbierto] = useState(false);

  const correr = (fn: () => Promise<{ error: string | null; success: boolean }>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.success) toast.success("Listo");
      else toast.error(res.error ?? "No se pudo.");
    });

  const pedirSlug = () => {
    // `prompt` y no un modal propio: es una acción de tres por año, hecha por
    // una sola persona que además es quien escribió el sistema.
    const nuevo = window.prompt(
      `Link de la tienda de ${nombre}.\n\nEl link viejo va a seguir funcionando y redirige al nuevo.`,
      slug,
    );
    if (!nuevo || nuevo === slug) return;
    correr(() => cambiarSlugAction(negocioId, nuevo));
  };

  const alternarPresupuestos = () => {
    // Prender pide confirmación y apagar no: prender le habilita a un comercio
    // otorgar crédito y cobrar cuotas. Apagar solo esconde, no borra nada.
    if (
      !moduloPresupuestos &&
      !window.confirm(
        `¿Prender presupuestos y planes en cuotas para ${nombre}?\n\nVan a poder cotizar, financiar en cuotas propias y cobrar anticipos.`,
      )
    ) {
      return;
    }
    correr(() => cambiarModuloPresupuestosAction(negocioId, !moduloPresupuestos));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Acciones de ${nombre}`}
            disabled={pendiente}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className={`w-56 ${CLASE_PORTAL_OSCURO}`}>
          <DropdownMenuItem onClick={() => setPagoAbierto(true)}>
            <Wallet className="mr-2 size-4 text-success" />
            Registrar pago
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setHistorialAbierto(true)}>
            <Receipt className="mr-2 size-4 text-muted-foreground" />
            Historial de pagos
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Modo dios: abre el POS de este comercio con TU sesión, sin
              pedirle la contraseña a nadie. Vivía en la tabla vieja de
              /admincomerz/negocios; cuando esa página se borró, esto se mudó
              acá — es la acción más usada del panel cuando alguien escribe
              que algo no le anda.

              No pasa por `correr` porque la acción no devuelve un resultado:
              termina en `redirect("/stock")`. Se llama directo dentro de la
              transición y la navegación la resuelve Next. */}
          <DropdownMenuItem
            onClick={() =>
              startTransition(() => iniciarImpersonationAction(negocioId))
            }
          >
            <LogIn className="mr-2 size-4 text-primary" />
            Entrar al POS
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cambiar plan
          </div>
          {planes.map((plan) => (
            <DropdownMenuItem
              key={plan.id}
              disabled={plan.id === planId}
              onClick={() => correr(() => cambiarPlanAction(negocioId, plan.id))}
            >
              <span className={plan.id === planId ? "opacity-50" : ""}>
                {plan.nombre}
                {plan.id === planId ? " (actual)" : ""}
              </span>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Módulos
          </div>
          <DropdownMenuItem onClick={alternarPresupuestos}>
            <FileText
              className={`mr-2 size-4 ${moduloPresupuestos ? "text-success" : "text-muted-foreground"}`}
            />
            {moduloPresupuestos
              ? "Presupuestos y cuotas: prendido (apagar)"
              : "Prender presupuestos y cuotas"}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={pedirSlug}>
            <Link2 className="mr-2 size-4 text-muted-foreground" />
            Cambiar link de la tienda
          </DropdownMenuItem>

          {/* El comercio de muestra sigue funcionando igual: lo que cambia es
              que deja de contarse como cliente y de generar avisos de
              cobranza. Volver atrás es marcarlo activo. */}
          {esNegocioDemo(estado) ? (
            <DropdownMenuItem
              onClick={() =>
                correr(() => cambiarEstadoNegocioAction(negocioId, "activo"))
              }
            >
              <Play className="mr-2 size-4 text-success" />
              Dejar de ser demo (pasa a activo)
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() =>
                correr(() => cambiarEstadoNegocioAction(negocioId, "demo"))
              }
            >
              <Presentation className="mr-2 size-4 text-violet-400" />
              Marcar como demo
            </DropdownMenuItem>
          )}

          {/* Un negocio en prueba también se puede suspender o dar de baja:
              está trabajando igual que uno activo. Lo que los separa es si
              pagó, no si tiene acceso. */}
          {negocioHabilitado(estado) ? (
            <>
              <DropdownMenuItem
                onClick={() =>
                  correr(() =>
                    cambiarEstadoNegocioAction(negocioId, "suspendido"),
                  )
                }
              >
                <Ban className="mr-2 size-4 text-warning" />
                Suspender (no paga)
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() =>
                  correr(() =>
                    cambiarEstadoNegocioAction(negocioId, ESTADO_BAJA),
                  )
                }
              >
                <Ban className="mr-2 size-4" />
                Dar de baja
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              onClick={() =>
                correr(() => cambiarEstadoNegocioAction(negocioId, "activo"))
              }
            >
              <Play className="mr-2 size-4 text-success" />
              Reactivar
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <RegistrarPagoModal
        open={pagoAbierto}
        onOpenChange={setPagoAbierto}
        negocioId={negocioId}
        nombre={nombre}
        precioSugerido={planes.find((p) => p.id === planId)?.precio_mensual ?? 0}
        vencimientoActual={planVencimiento}
      />

      <HistorialPagosModal
        open={historialAbierto}
        onOpenChange={setHistorialAbierto}
        negocioId={negocioId}
        nombre={nombre}
      />
    </>
  );
}
