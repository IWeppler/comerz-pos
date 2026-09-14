"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, UserMinus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
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
import type { PerfilConRol, Rol } from "@/entities/roles/types";
import {
  editarEmpleadoAction,
  quitarEmpleadoAction,
  type EditarEmpleadoState,
} from "../actions/editar-empleado";

const initialState: EditarEmpleadoState = { error: null, success: false };

/**
 * Editar a un empleado: nombre, mail, rol y una contraseña nueva si hace
 * falta (olvido, o celular robado — cambiarla cierra sus sesiones). Abajo,
 * quitarlo del negocio: no borra la cuenta, sus ventas quedan a su nombre.
 */
export function EditarEmpleadoModal({
  empleado,
  roles,
  esUnicoAdmin,
  esUnoMismo,
  open,
  onOpenChange,
}: Readonly<{
  empleado: PerfilConRol;
  roles: Rol[];
  esUnicoAdmin: boolean;
  esUnoMismo: boolean;
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
}>) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    editarEmpleadoAction,
    initialState,
  );
  const [rolId, setRolId] = useState(empleado.rol_id);
  const [verClave, setVerClave] = useState(false);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);
  const [quitando, startQuitar] = useTransition();

  useEffect(() => {
    if (state.success) {
      toast.success(state.aviso ?? "Empleado actualizado.", {
        duration: state.aviso ? 9000 : 4000,
      });
      onOpenChange(false);
      router.refresh();
    }
  }, [state, router, onOpenChange]);

  const quitar = () => {
    setConfirmarQuitar(false);
    startQuitar(async () => {
      const r = await quitarEmpleadoAction(empleado.id);
      if (r.success) {
        toast.success(`${empleado.nombre} ya no es parte del negocio.`);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "No se pudo quitar.");
      }
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !isPending && !quitando && onOpenChange(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar empleado</DialogTitle>
            <DialogDescription>
              Cambiá el nombre, el correo con el que entra, el rol, o ponele una
              contraseña nueva. Si le robaron el teléfono, con la contraseña
              nueva se le cierran las sesiones abiertas.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4" autoComplete="off">
            <input type="hidden" name="usuario_id" value={empleado.id} />

            <div className="space-y-2">
              <Label htmlFor="ed_nombre">Nombre</Label>
              <Input
                id="ed_nombre"
                name="nombre"
                required
                defaultValue={empleado.nombre}
                disabled={isPending}
                className="h-10 shadow-none bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed_email">Correo (usuario para entrar)</Label>
              <Input
                id="ed_email"
                name="email"
                type="email"
                required
                defaultValue={empleado.email}
                disabled={isPending}
                autoComplete="off"
                className="h-10 shadow-none bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed_password">Contraseña nueva (opcional, mínimo 8)</Label>
              <div className="relative">
                <Input
                  id="ed_password"
                  name="password"
                  type={verClave ? "text" : "password"}
                  minLength={8}
                  disabled={isPending}
                  autoComplete="new-password"
                  placeholder="Dejalo vacío para no cambiarla"
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
              <Label htmlFor="ed_rol">Rol</Label>
              <Select
                name="rol_id"
                value={rolId}
                onValueChange={setRolId}
                disabled={isPending || esUnicoAdmin}
              >
                <SelectTrigger id="ed_rol" className="h-10 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((rol) => (
                    <SelectItem key={rol.id} value={rol.id}>
                      {rol.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {esUnicoAdmin && (
                <p className="text-xs text-muted-foreground">
                  Es el único administrador: para cambiarle el rol, nombrá otro
                  ADMIN antes.
                </p>
              )}
            </div>

            {state.error ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                disabled={isPending || quitando || esUnicoAdmin || esUnoMismo}
                onClick={() => setConfirmarQuitar(true)}
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                title={
                  esUnoMismo
                    ? "No podés quitarte a vos mismo."
                    : esUnicoAdmin
                      ? "Es el único administrador."
                      : undefined
                }
              >
                {quitando ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <UserMinus className="size-4" />
                )}
                Quitar del negocio
              </Button>
              <Button type="submit" disabled={isPending || quitando} className="h-10">
                {isPending ? <Loader2 className="size-4 animate-spin" /> : "Guardar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmarQuitar} onOpenChange={setConfirmarQuitar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar a {empleado.nombre} del negocio?</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de poder entrar y se le cierran las sesiones abiertas. Sus
              ventas quedan registradas a su nombre. Si más adelante vuelve, se
              lo invita de nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={quitar}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
