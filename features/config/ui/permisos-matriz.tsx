"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/shared/ui/toast";
import { ShieldCheck } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { actualizarRolPermisoAction } from "../actions/empleados-actions";
import type { Permiso, Rol, RolPermiso } from "@/entities/roles/types";

interface PermisosMatrizProps {
  roles: Rol[];
  permisos: Permiso[];
  rolPermisos: RolPermiso[];
}

const ORDEN_ROLES = ["ADMIN", "ENCARGADO", "VENDEDOR"];

function claveCelda(rolId: string, permisoId: string) {
  return `${rolId}:${permisoId}`;
}

export function PermisosMatriz({
  roles,
  permisos,
  rolPermisos,
}: Readonly<PermisosMatrizProps>) {
  const router = useRouter();
  const rolesOrdenados = [...roles].sort(
    (a, b) => ORDEN_ROLES.indexOf(a.nombre) - ORDEN_ROLES.indexOf(b.nombre),
  );

  const [asignados, setAsignados] = useState(
    () => new Set(rolPermisos.map((rp) => claveCelda(rp.rol_id, rp.permiso_id))),
  );
  const [pendientes, setPendientes] = useState<Set<string>>(new Set());

  const handleToggle = (rol: Rol, permiso: Permiso) => {
    const clave = claveCelda(rol.id, permiso.id);
    const otorgadoActual = asignados.has(clave);
    const nuevoOtorgado = !otorgadoActual;

    setPendientes((prev) => new Set(prev).add(clave));
    setAsignados((prev) => {
      const next = new Set(prev);
      if (nuevoOtorgado) next.add(clave);
      else next.delete(clave);
      return next;
    });

    actualizarRolPermisoAction(rol.id, permiso.id, nuevoOtorgado).then((res) => {
      setPendientes((prev) => {
        const next = new Set(prev);
        next.delete(clave);
        return next;
      });

      if (res.success) {
        router.refresh();
      } else {
        // Revertimos el optimista si el server rechazó el cambio.
        setAsignados((prev) => {
          const next = new Set(prev);
          if (otorgadoActual) next.add(clave);
          else next.delete(clave);
          return next;
        });
        toast.error(res.error || "No se pudo actualizar el permiso");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">
          Permisos por rol
        </h3>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Permiso</TableHead>
              {rolesOrdenados.map((rol) => (
                <TableHead key={rol.id} className="text-center">
                  {rol.nombre}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {permisos.map((permiso) => (
              <TableRow key={permiso.id}>
                <TableCell>
                  <p className="font-medium text-foreground">
                    {permiso.clave}
                  </p>
                  {permiso.descripcion && (
                    <p className="text-xs text-muted-foreground whitespace-normal">
                      {permiso.descripcion}
                    </p>
                  )}
                </TableCell>
                {rolesOrdenados.map((rol) => {
                  const esAdmin = rol.nombre === "ADMIN";
                  const clave = claveCelda(rol.id, permiso.id);
                  const checked = esAdmin || asignados.has(clave);
                  const disabled = esAdmin || pendientes.has(clave);

                  return (
                    <TableCell key={rol.id} className="text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => handleToggle(rol, permiso)}
                        title={
                          esAdmin
                            ? "ADMIN siempre tiene acceso total"
                            : undefined
                        }
                        className="h-4 w-4 rounded border-border accent-primary disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
