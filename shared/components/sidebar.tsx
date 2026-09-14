"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/features/auth/actions/logout";
import { borrarCacheOffline } from "@/shared/lib/cache-offline";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  LogOut,
  Menu,
  X,
  Wallet,
  ChartArea,
  Settings,
  Store,
  Users,
  UserIcon,
  Lock,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { ConfiguracionPOS } from "@/entities/config/types";
import { CartButton } from "@/shared/ui/cart-button";
import { CajaStatusButton } from "@/features/caja/ui/caja-status-button";
import { useSidebarStore } from "@/shared/store/sidebar-store";
import { NegocioSwitcher } from "@/features/auth/ui/negocio-switcher";
import type { MembresiaNegocio } from "@/features/auth/actions/negocios";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { InstallAppWidget } from "./install-widget";
import { useContextoPlan } from "@/features/planes/ui/plan-provider";

// 1. Grupos con estructura compacta
const NAV_GROUPS = [
  {
    label: "Operativa",
    items: [
      { name: "Panel", href: "/", icon: LayoutDashboard, adminOnly: true },
      { name: "Vender", href: "/pos", icon: Store, adminOnly: false },
      { name: "Caja", href: "/caja", icon: Wallet, adminOnly: false },
    ],
  },
  {
    label: "Gestión",
    items: [
      { name: "Inventario", href: "/stock", icon: Package, adminOnly: false },
      { name: "Ventas", href: "/ventas", icon: ShoppingCart, adminOnly: false },
      { name: "Clientes", href: "/clientes", icon: Users, adminOnly: false },
    ],
  },
  {
    label: "Herramientas",
    items: [
      {
        name: "Reportes",
        href: "/reportes",
        icon: ChartArea,
        adminOnly: true,
        // El link NO se esconde cuando el plan no lo incluye: se muestra con
        // candado. Un módulo que desaparece no se puede querer; uno que se ve
        // bloqueado dice qué se está perdiendo. El corte de verdad está en el
        // server (ver app/(dashboard)/reportes/page.tsx) — esto es el aviso.
        feature: "reportes",
      },
      {
        name: "Configuración",
        href: "/configuracion",
        icon: Settings,
        adminOnly: true,
      },
    ],
  },
];

interface SidebarProps {
  branding: ConfiguracionPOS;
  userRole: string;
  userId: string;
  userName?: string;
  /**
   * Plan del negocio ACTIVO, ya formateado (ver etiquetaPlan). Antes tenía un
   * default hardcodeado "Pro Trial" y el layout nunca lo mandaba: los tres
   * comercios mostraban el mismo plan inventado.
   */
  planName?: string;
  /** Negocios a los que pertenece el usuario. Con uno solo no hay switcher. */
  negocios?: MembresiaNegocio[];
  negocioActivoId?: string;
  /** Permiso `clientes.cobrar_cc`. Solo viaja hasta el modal de caja, que es
   * donde vive uno de los dos accesos al cobro. */
  puedeCobrarCuentaCorriente?: boolean;
  /** Permiso `caja.operar`. Sin él no se muestra el estado de caja. */
  puedeOperarCaja?: boolean;
}

export function Sidebar({
  branding,
  userRole,
  userId,
  userName = "Usuario",
  planName = "Sin plan",
  negocios = [],
  negocioActivoId,
  puedeCobrarCuentaCorriente = false,
  puedeOperarCaja = true,
}: Readonly<SidebarProps>) {
  const pathname = usePathname();
  const contextoPlan = useContextoPlan();
  const { isCollapsed, isOpenMobile, setIsOpenMobile } = useSidebarStore();
  const isCajaAbierta = useCajaStatusStore((state) => state.isCajaAbierta);
  const fetchCajaStatusStore = useCajaStatusStore(
    (state) => state.fetchCajaStatus,
  );

  const visibleNavGroups = useMemo(() => {
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.adminOnly && userRole !== "ADMIN") return false;
        return true;
      }),
    })).filter((group) => group.items.length > 0);
  }, [userRole]);

  // En móvil el menú tapa la pantalla: al entrar a un módulo tiene que cerrarse
  // solo. Se hace por cambio de ruta y no con un onClick por link para que
  // valga también para el logo, el perfil y cualquier link que se agregue.
  useEffect(() => {
    setIsOpenMobile(false);
  }, [pathname, setIsOpenMobile]);

  useEffect(() => {
    let isMounted = true;
    const modo = branding.modo_caja || "UNICA";

    const fetchCajaStatus = async () => {
      if (!isMounted) return;
      await fetchCajaStatusStore(modo, userId);
    };

    fetchCajaStatus();

    let interval: ReturnType<typeof setInterval> | null = null;
    const startInterval = () => {
      if (!interval) interval = setInterval(fetchCajaStatus, 60_000);
    };
    const stopInterval = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchCajaStatus();
        startInterval();
      } else {
        stopInterval();
      }
    };

    if (document.visibilityState === "visible") startInterval();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [branding.modo_caja, userId, fetchCajaStatusStore]);

  const initial = branding.posName?.substring(0, 1).toUpperCase() || "C";

  return (
    <TooltipProvider>
      {/* MOBILE TOP NAVBAR (Solo visible en celular) */}
      <div className="md:hidden flex w-full shrink-0 items-center justify-between px-4 h-16 bg-background border-b border-border sticky top-0 z-50">
        {/* UNA sola representación del comercio activo: el logo + nombre ES el
            switcher cuando hay más de un negocio (antes se dibujaba el logo a
            la izquierda y otra vez adentro del switcher, a la derecha). Con un
            solo negocio sigue siendo un link, como siempre. */}
        <div className="flex items-center min-w-0 flex-1 mr-2">
          <NegocioSwitcher
            negocios={negocios}
            negocioActivoId={negocioActivoId}
            nombreActivo={branding.posName}
            logoActivo={branding.posLogo}
            inicial={initial}
            isCollapsed={false}
            modo="identidad"
            hrefSinSwitcher={userRole === "ADMIN" ? "/" : "/stock"}
          />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {puedeOperarCaja && (
            <CajaStatusButton
              modoCaja={branding.modo_caja || "UNICA"}
              userId={userId}
              className="mr-1"
              puedeCobrarCuentaCorriente={puedeCobrarCuentaCorriente}
            />
          )}
          <span className="hidden sm:block">
            <CartButton />
          </span>
          <button
            onClick={() => setIsOpenMobile(!isOpenMobile)}
            className="p-2 text-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors cursor-pointer shrink-0"
            aria-label="Alternar menú"
          >
            {isOpenMobile ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>
      </div>

      {/* OVERLAY OSCURO MÓVIL */}
      {isOpenMobile && (
        <div
          className="md:hidden fixed inset-0 top-16 bg-black/40 z-50 backdrop-blur-sm"
          onClick={() => setIsOpenMobile(false)}
        />
      )}

      {/* SIDEBAR DESKTOP */}
      <aside
        className={`
        fixed md:sticky top-14 md:top-0 left-0 h-[calc(100vh-56px)] md:h-screen 
        bg-sidebar border-border md:border-border/50 
        flex flex-col shrink-0 z-50 transition-all duration-300 ease-in-out
        ${isOpenMobile ? "translate-x-0" : "-translate-x-full"} md:translate-x-0
        ${isCollapsed ? "md:w-18" : "w-full md:w-64"} w-64
      `}
      >
        {/* 1. Comerz LOGO (Alineado a la izquierda, con rounded-md) */}
        <div
          className={`hidden md:flex items-center h-16 shrink-0 border-b border-border/50 transition-all duration-300 ${isCollapsed ? "justify-center px-0" : "px-4 justify-start"}`}
        >
          <Image
            src="/logow.png"
            alt="Comerz Logo"
            width={30}
            height={30}
            className="object-contain rounded-sm bg-white"
          />
          {!isCollapsed && (
            <span className="ml-2.5 font-bold text-lg tracking-tight">
              Comerz
            </span>
          )}
        </div>

        {/* 2. STORE SWITCHER — solo desktop. En móvil vive en el header, para
            no repetirlo dentro del menú desplegable. */}
        <div
          className={`hidden md:flex p-3 ${isCollapsed ? "justify-center" : ""}`}
        >
          <NegocioSwitcher
            negocios={negocios}
            negocioActivoId={negocioActivoId}
            nombreActivo={branding.posName}
            logoActivo={branding.posLogo}
            inicial={initial}
            isCollapsed={isCollapsed}
          />
        </div>

        {/* 3. NAVEGACIÓN COMPACTA */}
        {/* El cierre por cambio de ruta no cubre tocar el módulo en el que ya
            estás (la ruta no cambia); este onClick sí. */}
        <nav
          onClick={() => setIsOpenMobile(false)}
          className="flex-1 px-3 overflow-y-auto overflow-x-hidden flex flex-col"
        >
          <div className="space-y-4 pb-4 flex-1">
            {visibleNavGroups.map((group, groupIndex) => (
              <div
                key={group.label}
                className="space-y-0.5 border-t border-border"
              >
                {!isCollapsed ? (
                  <div className="px-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5 mt-2">
                    {group.label}
                  </div>
                ) : (
                  groupIndex > 0 && (
                    <div className="mx-2 border-t border-border/50 my-2" />
                  )
                )}

                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;
                  const showCajaAlert =
                    item.name === "Caja" && isCajaAbierta === false;
                  // Sin plan cargado no se bloquea nada, igual que
                  // useTieneFeature y que la base: el paywall no puede apagar
                  // medio sistema porque el contexto todavía no llegó.
                  const bloqueadoPorPlan = Boolean(
                    item.feature &&
                    contextoPlan &&
                    !contextoPlan.sinPlan &&
                    !contextoPlan.features.includes(item.feature),
                  );

                  return (
                    <Tooltip
                      key={item.href}
                      disableHoverableContent={!isCollapsed}
                    >
                      <TooltipTrigger asChild>
                        <Link
                          href={item.href}
                          className={`group flex items-center rounded-sm transition-all duration-200 font-medium active:scale-[0.98] ${
                            isCollapsed
                              ? "justify-center h-9 w-9 mx-auto"
                              : "gap-3 px-2.5 py-3 md:py-2"
                          } ${
                            isActive
                              ? "bg-primary text-white"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <div className="relative flex items-center justify-center">
                            <Icon
                              className={`w-4.5 h-4.5 shrink-0 transition-colors stroke-2 ${
                                isActive
                                  ? "text-white"
                                  : "text-muted-foreground/70 group-hover:text-foreground"
                              }`}
                            />
                            {showCajaAlert && (
                              <span className="absolute -top-1 -right-1 flex h-2 w-2 ring-2 ring-sidebar rounded-full bg-rose-500" />
                            )}
                            {/* Colapsado no hay lugar para el candado al lado
                                del nombre: va sobre el ícono. */}
                            {bloqueadoPorPlan && isCollapsed && (
                              <Sparkles className="absolute -top-1.5 -right-1.5 h-2.5 w-2.5 text-amber-500" />
                            )}
                          </div>
                          {!isCollapsed && (
                            <span className="text-sm">{item.name}</span>
                          )}
                          {bloqueadoPorPlan && !isCollapsed && (
                            <span className="ml-auto flex items-center gap-0.5">
                              <Lock className="h-3 w-3 text-muted-foreground/70" />
                              <Sparkles className="h-3 w-3 text-amber-500" />
                            </span>
                          )}
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right" hidden={!isCollapsed}>
                        {bloqueadoPorPlan
                          ? `${item.name} — mejorá tu plan`
                          : item.name}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            ))}
          </div>

          {/* WIDGET INSTALAR APP (Nuevo diseño premium) */}
          <div className="pb-4 mt-auto">
            <InstallAppWidget isCollapsed={isCollapsed} />
          </div>
        </nav>

        {/* 4. FOOTER (Soporte, Logout, Perfil con Plan) */}
        <div className="border-t border-border/50 p-3 flex flex-col gap-1 bg-muted/5">
          {/* <Link
            href="/soporte"
            className={`flex items-center gap-3 rounded-md px-2 py-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer ${isCollapsed ? "justify-center mx-auto w-9 h-9" : ""}`}
          >
            <LifeBuoy className="w-4.5 h-4.5 stroke-2" />
            {!isCollapsed && (
              <span className="text-sm font-medium">Soporte técnico</span>
            )}
          </Link> */}

          {/* El catálogo guardado para trabajar sin señal se borra ACÁ, antes
              de que la sesión se vaya: en un celular compartido no puede
              quedar accesible después de que la vendedora se fue. Ver
              shared/lib/cache-offline.ts. */}
          <form
            action={logoutAction}
            className="w-full"
            onSubmit={() => {
              void borrarCacheOffline();
            }}
          >
            <button
              type="submit"
              className={`flex items-center gap-3 rounded-md px-2 py-2 w-full text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger cursor-pointer ${isCollapsed ? "justify-center mx-auto w-9 h-9" : ""}`}
            >
              <LogOut className="w-4.5 h-4.5 stroke-2" />
              {!isCollapsed && (
                <span className="text-sm font-medium">Cerrar sesión</span>
              )}
            </button>
          </form>

          <div
            className={`${isCollapsed ? "my-1" : "my-2"} border-t border-border/50 mx-1`}
          />

          {/* User Profile (Nombre + Plan) */}
          {userRole === "ADMIN" ? (
            <Link
              href="/perfil"
              className={`flex items-center gap-3 px-2 py-1.5 mt-1 rounded-md hover:bg-muted/80 transition-colors cursor-pointer group ${isCollapsed ? "justify-center" : ""}`}
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                <UserIcon className="w-4 h-4 text-primary" />
              </div>
              {!isCollapsed && (
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-medium truncate text-foreground leading-tight group-hover:text-primary transition-colors">
                    {userName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
                    {planName}
                  </p>
                </div>
              )}
            </Link>
          ) : (
            <div
              className={`flex items-center gap-3 px-2 py-1.5 mt-1 ${isCollapsed ? "justify-center" : ""}`}
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <UserIcon className="w-4 h-4 text-primary" />
              </div>
              {!isCollapsed && (
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-medium truncate text-foreground leading-tight">
                    {userName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
                    {planName}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
