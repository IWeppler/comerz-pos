"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { LimiteDelPlan } from "@/features/planes/ui/limite-del-plan";
import type { Rol } from "@/entities/roles/types";
import {
  crearEmpleadoLocalAction,
  type CrearEmpleadoLocalState,
} from "../actions/crear-empleado-local";

const initialState: CrearEmpleadoLocalState = { error: null, success: false };

/**
 * Alta con contraseña, al lado de "Invitar". Para el local donde la dueña
 * da de alta a la vendedora en persona y le dice la clave: sin mail, sin
 * link, entra ya.
 */
export function CrearEmpleadoLocal({
  roles,
  usuariosOcupados,
  maxUsuarios,
}: Readonly<{
  roles: Rol[];
  usuariosOcupados: number;
  maxUsuarios?: number | null;
}>) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    crearEmpleadoLocalAction,
    initialState,
  );
  const [rolId, setRolId] = useState("");
  const [verClave, setVerClave] = useState(false);
  const rolPorDefecto = roles.find((r) => r.nombre === "VENDEDOR")?.id ?? "";

  useEffect(() => {
    if (state.success) {
      toast.success("Empleado creado. Ya puede entrar con su correo y contraseña.");
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <UserPlus className="w-4.5 h-4.5 text-muted-foreground" />
          Crear con contraseña
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Sin mail: le cargás la clave vos y entra ya con su correo. Después la
          puede cambiar desde su perfil.
        </p>
      </div>

      <form
        // Cada alta exitosa trae un nonce nuevo: el form se remonta vacío sin
        // escribir estado desde un efecto.
        key={state.nonce ?? "form"}
        action={formAction}
        autoComplete="off"
        className="grid gap-3 sm:grid-cols-[1fr_1fr] bg-card border border-border rounded-2xl p-4"
      >
        <div className="space-y-2">
          <Label htmlFor="nuevo_nombre">Nombre</Label>
          <Input
            id="nuevo_nombre"
            name="nombre"
            required
            disabled={isPending}
            placeholder="Mara"
            className="h-10 shadow-none bg-background"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nuevo_email">Correo (usuario para entrar)</Label>
          <Input
            id="nuevo_email"
            name="email"
            type="email"
            required
            disabled={isPending}
            autoComplete="off"
            placeholder="mara@gmail.com"
            className="h-10 shadow-none bg-background"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nuevo_password">Contraseña (mínimo 8)</Label>
          <div className="relative">
            <Input
              id="nuevo_password"
              name="password"
              type={verClave ? "text" : "password"}
              required
              minLength={8}
              disabled={isPending}
              autoComplete="new-password"
              className="h-10 shadow-none bg-background pr-10"
            />
            <button
              type="button"
              onClick={() => setVerClave((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={verClave ? "Ocultar contraseña" : "Ver contraseña"}
            >
              {verClave ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="nuevo_rol">Rol</Label>
          <Select
            name="rol_id"
            required
            disabled={isPending}
            value={rolId || rolPorDefecto}
            onValueChange={setRolId}
          >
            <SelectTrigger id="nuevo_rol" className="h-10 bg-background">
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

        <div className="sm:col-span-2 flex justify-end">
          {/* Mismo tope que Invitar: el trigger de la base cuenta miembros e
              invitaciones pendientes, y un alta local es un miembro más. */}
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
                <UserPlus className="size-4" />
              )}
              Crear empleado
            </Button>
          </LimiteDelPlan>
        </div>
      </form>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
