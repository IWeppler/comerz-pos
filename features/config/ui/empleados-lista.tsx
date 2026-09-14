"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Users } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { EditarEmpleadoModal } from "./editar-empleado-modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { actualizarRolEmpleadoAction } from "../actions/empleados-actions";
import type { PerfilConRol, Rol } from "@/entities/roles/types";

interface EmpleadosListaProps {
  empleados: PerfilConRol[];
  roles: Rol[];
  usuarioActualId?: string | null;
}

export function EmpleadosLista({
  empleados,
  roles,
  usuarioActualId = null,
}: Readonly<EmpleadosListaProps>) {
  // UN modal para toda la tabla, montado abajo con el empleado elegido.
  const [editando, setEditando] = useState<PerfilConRol | null>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [empleadosLocal, setEmpleadosLocal] = useState(empleados);

  const rolAdmin = roles.find((r) => r.nombre === "ADMIN");
  const cantidadAdmins = empleadosLocal.filter(
    (e) => e.rol_id === rolAdmin?.id,
  ).length;

  const handleChangeRol = (perfilId: string, nuevoRolId: string) => {
    const anterior = empleadosLocal;
    setEmpleadosLocal((prev) =>
      prev.map((e) =>
        e.id === perfilId
          ? {
              ...e,
              rol_id: nuevoRolId,
              roles: roles.find((r) => r.id === nuevoRolId) ?? e.roles,
            }
          : e,
      ),
    );

    startTransition(async () => {
      const res = await actualizarRolEmpleadoAction(perfilId, nuevoRolId);
      if (res.success) {
        toast.success("Rol actualizado");
        router.refresh();
      } else {
        setEmpleadosLocal(anterior);
        toast.error(res.error || "No se pudo actualizar el rol");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Empleados</h3>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {empleadosLocal.map((empleado) => {
              const esUnicoAdmin =
                empleado.rol_id === rolAdmin?.id && cantidadAdmins <= 1;

              return (
                <TableRow key={empleado.id}>
                  <TableCell className="font-medium text-foreground">
                    {empleado.nombre}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {empleado.email}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={empleado.rol_id}
                      onValueChange={(nuevoRolId) =>
                        handleChangeRol(empleado.id, nuevoRolId)
                      }
                      disabled={isPending || esUnicoAdmin}
                    >
                      <SelectTrigger
                        className="w-40 h-9"
                        title={
                          esUnicoAdmin
                            ? "No podés cambiar el rol del único administrador que queda."
                            : undefined
                        }
                      >
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
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground"
                      onClick={() => setEditando(empleado)}
                      aria-label={`Editar a ${empleado.nombre}`}
                      title="Editar nombre, correo, contraseña o quitar"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {editando && (
        <EditarEmpleadoModal
          key={editando.id}
          empleado={editando}
          roles={roles}
          esUnicoAdmin={editando.rol_id === rolAdmin?.id && cantidadAdmins <= 1}
          esUnoMismo={editando.id === usuarioActualId}
          open
          onOpenChange={(abierto) => !abierto && setEditando(null)}
        />
      )}
    </div>
  );
}
