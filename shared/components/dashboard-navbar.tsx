"use client";

import { SidebarIcon } from "lucide-react";
import { useSidebarStore } from "@/shared/store/sidebar-store";
import { usePathname } from "next/navigation";
import { CajaStatusButton } from "@/features/caja/ui/caja-status-button";

interface DashboardNavbarProps {
  modoCaja: string;
  userId: string;
  /** Permiso `caja.operar`. Sin él no se muestra el estado de caja. */
  puedeOperarCaja?: boolean;
  /** Permiso `caja.registrar_ingreso`: "Anotar ingreso" en el modal de caja. */
  puedeRegistrarIngreso?: boolean;
  /** Nombre del perfil, para saludar en el panel. Ausente = saludo sin nombre. */
  userName?: string;
}

export function DashboardNavbar({
  modoCaja,
  userId,
  puedeOperarCaja = true,
  puedeRegistrarIngreso = false,
  userName,
}: Readonly<DashboardNavbarProps>) {
  const { toggleSidebar } = useSidebarStore();
  const pathname = usePathname();
  const getPageInfo = () => {
    // El panel saluda en vez de titularse: es la pantalla a la que la dueña
    // entra a la mañana, no una sección. Solo el primer nombre — "Hola,
    // Romina" y no "Hola, Carneiro Romina".
    if (pathname === "/") {
      const primerNombre = userName?.trim().split(/s+/)[0];
      return {
        title: primerNombre ? `Hola, ${primerNombre} 👋` : "Hola 👋",
        description: "",
      };
    }
    if (pathname.startsWith("/pos"))
      return {
        title: "Realizar Venta",
        description: "Una venta. Todo conectado.",
      };
    if (pathname.startsWith("/stock"))
      return {
        title: "Inventario",
        description: "Gestiona el stock, precios y catálogo de tus productos.",
      };
    if (pathname.startsWith("/clientes"))
      return {
        title: "Directorio de Clientes",
        description:
          "Gestiona el historial de compras y las cuentas corrientes de tus clientes.",
      };
    if (pathname.startsWith("/ventas"))
      return {
        title: "Ventas",
        description:
          "Consultá el historial de ventas, comprobantes y operaciones realizadas.",
      };
    if (pathname.startsWith("/reportes"))
      return {
        title: "Reportes",
        description: "Análisis comercial, financiero e inventario del negocio.",
      };
    if (pathname.startsWith("/caja"))
      return {
        title: "Caja y Movimientos",
        description: "Apertura, arqueos y control de flujo de efectivo.",
      };
    if (pathname.startsWith("/configuracion"))
      return {
        title: "Configuración",
        description:
          "Administra las preferencias, catálogo y reglas de negocio de tu local.",
      };
    return { title: "", description: "" };
  };

  const { title, description } = getPageInfo();

  return (
    <header className="hidden md:flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-6">
      <div className="flex items-center gap-4 flex-1">
        <button
          onClick={toggleSidebar}
          className="p-1.5 -ml-1.5 text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors cursor-pointer"
          aria-label="Alternar barra lateral"
        >
          <SidebarIcon className="w-5 h-5" />
        </button>

        {/* Separador vertical */}
        <div className="h-4 w-px bg-border"></div>

        {/* Título de la página y descripción */}
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-foreground">{title}</h1>
          {description && (
            <>
              <span className="text-muted-foreground/40 hidden lg:block">
                |
              </span>
              <span className="text-sm font-medium text-muted-foreground hidden lg:block">
                {description}
              </span>
            </>
          )}
        </div>
      </div>

      {/* El buscador (Ctrl+K) vive en el sidebar, al lado del logo. */}
      {puedeOperarCaja && (
        <CajaStatusButton
          modoCaja={modoCaja}
          userId={userId}
          puedeRegistrarIngreso={puedeRegistrarIngreso}
        />
      )}
    </header>
  );
}
