"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, CreditCard, Package, ShoppingBag, Wallet, type LucideIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { toast } from "@/shared/ui/toast";
import {
  getRolesNotificacionesAction,
  guardarRolesNotificacionesAction,
  type MatrizRoles,
  type RolAviso,
} from "@/features/notificaciones/actions/notificaciones";
import type { CategoriaNotificacion } from "@/features/notificaciones/lib/notificaciones";

const CATEGORIAS: { id: CategoriaNotificacion; titulo: string; ejemplos: string; icono: LucideIcon }[] = [
  { id: "STOCK", titulo: "Stock", ejemplos: "Productos agotados, remitos sin conciliar", icono: Package },
  {
    id: "TIENDA",
    titulo: "Tienda online",
    ejemplos: "Ventas pagadas, transferencias por confirmar, órdenes para revisar",
    icono: ShoppingBag,
  },
  { id: "PLATA", titulo: "Caja", ejemplos: "Caja abierta desde otro día", icono: Wallet },
  { id: "PLAN", titulo: "Plan de Comerz", ejemplos: "Vencimiento, prueba, débito cobrado", icono: CreditCard },
];

const ROLES: { id: RolAviso; nombre: string }[] = [
  { id: "ADMIN", nombre: "Administrador" },
  { id: "ENCARGADO", nombre: "Encargado" },
];

/**
 * Configuración › Notificaciones (N6, docs/notificaciones.md): qué avisos de "Tu
 * negocio" le llegan a cada rol. Solo ADMIN (la base lo exige en las dos RPC).
 *
 * Lo que se muestra es lo que SE APLICA hoy, defaults incluidos: lo calcula la
 * misma función de la base que decide quién recibe, así esta pantalla no puede
 * decir una cosa y la campana hacer otra.
 */
export function NotificacionesConfigPanel() {
  const [guardada, setGuardada] = useState<MatrizRoles | null>(null);
  const [matriz, setMatriz] = useState<MatrizRoles | null>(null);
  const [error, setError] = useState(false);
  const [pendiente, startTransition] = useTransition();

  useEffect(() => {
    let vivo = true;
    getRolesNotificacionesAction()
      .then((m) => {
        if (!vivo) return;
        if (!m) setError(true);
        setGuardada(m);
        setMatriz(m);
      })
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, []);

  const cambios = JSON.stringify(matriz) !== JSON.stringify(guardada);

  function alternar(c: CategoriaNotificacion, r: RolAviso, valor: boolean) {
    setMatriz((m) => (m ? { ...m, [c]: { ...m[c], [r]: valor } } : m));
  }

  function guardar() {
    if (!matriz) return;
    startTransition(async () => {
      const { ok } = await guardarRolesNotificacionesAction(matriz);
      if (!ok) {
        toast.error("No se pudo guardar la configuración de avisos.");
        return;
      }
      setGuardada(matriz);
      toast.success("Avisos actualizados");
    });
  }

  return (
    <div className="space-y-6 rounded-2xl border border-border bg-card p-5 text-card-foreground sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Bell className="size-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Notificaciones</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Qué avisos de tu negocio le llegan a cada uno en la campana. Las vendedoras no reciben avisos del
            negocio, y las novedades de Comerz llegan a todos.
          </p>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-muted-foreground">No pudimos cargar la configuración. Probá de nuevo en un rato.</p>
      ) : !matriz ? (
        <div className="h-48 animate-pulse rounded-xl bg-muted" aria-label="Cargando configuración" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {/* Encabezado de columnas: solo en compu; en celular cada fila dice el rol. */}
          <div className="hidden grid-cols-[1fr_120px_120px] border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>Aviso</span>
            {ROLES.map((r) => (
              <span key={r.id} className="text-center">
                {r.nombre}
              </span>
            ))}
          </div>
          <ul className="divide-y divide-border">
            {CATEGORIAS.map((c) => {
              const Icono = c.icono;
              const nadie = !matriz[c.id].ADMIN && !matriz[c.id].ENCARGADO;
              return (
                <li key={c.id} className="grid gap-3 px-4 py-3.5 sm:grid-cols-[1fr_120px_120px] sm:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <Icono className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.titulo}</p>
                      <p className="text-xs text-muted-foreground">{c.ejemplos}</p>
                      {nadie && <p className="mt-1 text-xs font-medium text-warning">Nadie recibe estos avisos.</p>}
                    </div>
                  </div>
                  {ROLES.map((r) => (
                    <label
                      key={r.id}
                      className="flex min-h-11 items-center justify-between gap-2 sm:justify-center"
                    >
                      <span className="text-sm text-muted-foreground sm:sr-only">{r.nombre}</span>
                      <Switch
                        checked={matriz[c.id][r.id]}
                        onCheckedChange={(v) => alternar(c.id, r.id, v)}
                        aria-label={`${c.titulo}: ${r.nombre}`}
                      />
                    </label>
                  ))}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={guardar} disabled={!matriz || !cambios || pendiente}>
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}
