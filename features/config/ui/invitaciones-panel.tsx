"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Loader2, Mail, Send, X } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  invitarEmpleadoAction,
  cancelarInvitacionAction,
  type InvitacionActionState,
} from "../actions/invitaciones-actions";
import type { Rol } from "@/entities/roles/types";
import { LimiteDelPlan } from "@/features/planes/ui/limite-del-plan";
import { CrearEmpleadoLocal } from "./crear-empleado-local";
import type { UsoDelPlan } from "@/features/planes/actions/uso-del-plan";

export interface InvitacionPendiente {
  id: string;
  email: string;
  expira_en: string;
  roles: { nombre: string } | null;
}

const initialState: InvitacionActionState = { error: null, success: false };

export function InvitacionesPanel({
  roles,
  invitaciones,
  uso,
  maxUsuarios,
}: Readonly<{
  roles: Rol[];
  invitaciones: InvitacionPendiente[];
  uso?: UsoDelPlan | null;
  maxUsuarios?: number | null;
}>) {
  const router = useRouter();

  // La MISMA cuenta que `validar_limite_usuarios`: miembros + invitaciones
  // pendientes. Se prefiere el largo de `invitaciones` (que el server acaba de
  // traer y `router.refresh()` mantiene fresco) sobre el conteo del uso, para
  // que el medidor se mueva apenas se manda una invitación.
  const usuariosOcupados =
    (uso?.usuariosActivos ?? 0) +
    Math.max(uso?.invitacionesPendientes ?? 0, invitaciones.length);
  const [state, formAction, isPending] = useActionState(
    invitarEmpleadoAction,
    initialState,
  );
  const [cancelando, startCancelar] = useTransition();
  const [rolId, setRolId] = useState<string>("");

  // Un ADMIN nuevo se invita desde acá igual, pero el default es el rol con el
  // que entra la mayoría.
  const rolPorDefecto = roles.find((r) => r.nombre === "VENDEDOR")?.id ?? "";

  useEffect(() => {
    if (state.success && !state.link) {
      toast.success("Invitación enviada por mail");
      router.refresh();
    }
    if (state.success && state.link) {
      router.refresh();
    }
  }, [state.success, state.link, router]);

  const cancelar = (id: string) => {
    startCancelar(async () => {
      const res = await cancelarInvitacionAction(id);
      if (res.success) {
        toast.success("Invitación cancelada");
        router.refresh();
      } else {
        toast.error(res.error ?? "No se pudo cancelar");
      }
    });
  };

  const copiar = async (link: string) => {
    await navigator.clipboard.writeText(link);
    toast.success("Enlace copiado");
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Mail className="w-4.5 h-4.5 text-muted-foreground" />
          Invitar a alguien
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Le llega un mail con un botón para crear su contraseña. Cuando la
          guarda, ya entra a este negocio con el rol que elijas.
        </p>
      </div>

      <form
        action={formAction}
        className="flex flex-col sm:flex-row gap-3 sm:items-end bg-card border border-border rounded-2xl p-4"
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            disabled={isPending}
            placeholder="vendedora@gmail.com"
            className="h-10 shadow-none bg-background"
          />
        </div>

        <div className="sm:w-48 space-y-2">
          <Label htmlFor="rol_id">Rol</Label>
          <Select
            name="rol_id"
            required
            disabled={isPending}
            value={rolId || rolPorDefecto}
            onValueChange={setRolId}
          >
            <SelectTrigger id="rol_id" className="h-10 bg-background">
              <SelectValue placeholder="Elegí un rol" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((rol) => (
                <SelectItem key={rol.id} value={rol.id}>
                  {rol.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* El tope de usuarios lo aplica `validar_limite_usuarios` en la base,
            que cuenta miembros MÁS invitaciones pendientes (una invitación ya
            reserva el lugar). Se replica exactamente esa cuenta: si la UI
            contara distinto, el dueño vería lugar libre y la invitación le
            rebotaría con 23514 después de escribir el mail.

            Ya NO hay PaywallGate acá: quien no tiene la feature `roles` ni
            llega a esta pantalla (ver empleados-panel). Lo que queda es el
            otro caso, el que antes pasaba de largo — tener la función y haber
            llenado el cupo, que es donde está Evens hoy con 5 de 5. */}
        <LimiteDelPlan
          usado={usuariosOcupados}
          limite={maxUsuarios}
          singular="usuario"
          plural="usuarios"
          claveLimite="max_usuarios"
        >
          <Button type="submit" disabled={isPending} className="h-10 gap-2">
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Invitar
          </Button>
        </LimiteDelPlan>
      </form>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.aviso && state.link ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
          <p className="text-sm text-foreground">{state.aviso}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-background/70 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
              {state.link}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              onClick={() => copiar(state.link!)}
            >
              <Copy className="size-3.5" />
              Copiar
            </Button>
          </div>
        </div>
      ) : null}

      <CrearEmpleadoLocal
        roles={roles}
        usuariosOcupados={usuariosOcupados}
        maxUsuarios={maxUsuarios}
      />

      {invitaciones.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Invitaciones pendientes
          </p>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {invitaciones.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.roles?.nombre ?? "VENDEDOR"} · vence el{" "}
                    {new Date(inv.expira_en).toLocaleDateString("es-AR")}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={cancelando}
                  onClick={() => cancelar(inv.id)}
                  className="gap-1.5 text-muted-foreground hover:text-destructive shrink-0"
                >
                  <X className="size-3.5" />
                  Cancelar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
