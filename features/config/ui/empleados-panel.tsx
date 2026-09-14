"use client";

import { ShieldAlert } from "lucide-react";
import { EmpleadosLista } from "./empleados-lista";
import { PermisosMatriz } from "./permisos-matriz";
import {
  InvitacionesPanel,
  type InvitacionPendiente,
} from "./invitaciones-panel";
import type { Permiso, PerfilConRol, Rol, RolPermiso } from "@/entities/roles/types";
import type { UsoDelPlan } from "@/features/planes/actions/uso-del-plan";
import { PaywallModulo } from "@/features/planes/ui/paywall-modulo";
import {
  useContextoPlan,
  useTieneFeature,
} from "@/features/planes/ui/plan-provider";
import { EmpleadosMaqueta } from "./empleados-maqueta";
import { CobroCentralizado } from "@/features/pedidos/ui/cobro-centralizado";

interface EmpleadosPanelProps {
  isAdmin: boolean;
  empleados: PerfilConRol[];
  roles: Rol[];
  permisos: Permiso[];
  rolPermisos: RolPermiso[];
  invitaciones?: InvitacionPendiente[];
  /** Uso real de los límites, contado igual que el trigger de la base. */
  uso?: UsoDelPlan | null;
  /** `configuracion_pos.pedidos_a_caja`: varios puestos, una caja. */
  pedidosACaja?: boolean;
}

export function EmpleadosPanel({
  isAdmin,
  empleados,
  roles,
  permisos,
  rolPermisos,
  invitaciones = [],
  uso,
  pedidosACaja = false,
}: Readonly<EmpleadosPanelProps>) {
  const contexto = useContextoPlan();
  const tieneRoles = useTieneFeature("roles");
  const maxUsuarios = contexto?.reglasActuales?.max_usuarios;

  if (!isAdmin) {
    return (
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border flex flex-col items-center justify-center py-24 text-center">
        <ShieldAlert className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-xl font-bold">Acceso restringido</h2>
        <p className="text-muted-foreground mt-2 text-sm max-w-sm">
          Esta sección es solo para administradores.
        </p>
      </div>
    );
  }

  // Emprendedor es un plan de UN usuario: no hay equipo que administrar, ni
  // roles que repartir, ni permisos que ajustar. Antes el candado tapaba solo
  // el botón de invitar y dejaba la lista, los roles y la matriz de permisos
  // visibles y navegables — una sección entera que no lleva a ningún lado.
  if (!tieneRoles) {
    return (
      <PaywallModulo
        feature="roles"
        titulo="Equipo y permisos"
        descripcion="Sumá a tus vendedoras con su propio usuario: cada una entra con su clave, vendés sabiendo quién vendió y cada una cierra su caja."
      >
        <EmpleadosMaqueta />
      </PaywallModulo>
    );
  }

  return (
    <div className="space-y-10 animate-in fade-in-50 duration-300">
      <EmpleadosLista empleados={empleados} roles={roles} />
      <InvitacionesPanel
        roles={roles}
        invitaciones={invitaciones}
        uso={uso}
        maxUsuarios={maxUsuarios}
      />
      <CobroCentralizado activo={pedidosACaja} />
      <PermisosMatriz
        roles={roles}
        permisos={permisos}
        rolPermisos={rolPermisos}
      />
    </div>
  );
}
