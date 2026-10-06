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
  FileText,
  Search,
  ChevronsUpDown,
  LifeBuoy,
  Rocket,
} from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { usePaletaStore } from "@/shared/store/paleta-store";
import { AvatarUsuario } from "./avatar-usuario";
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
import { useModuloPresupuestos } from "./negocio-activo-provider";

type NavItem = {
  name: string;
  href: string;
  icon: typeof Store;
  adminOnly: boolean;
  feature?: string;
  /** Solo con `negocios.modulo_presupuestos` prendido. */
  moduloPresupuestos?: boolean;
};

// 1. Grupos con estructura compacta
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
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
      // Solo con `negocios.modulo_presupuestos` prendido: al revés que
      // Reportes, esto NO se muestra con candado. No es un módulo de plan que
      // se vende en la pantalla: es crédito propio del comercio, y en un
      // negocio que no lo usa no tiene que aparecer (docs/presupuestos.md).
      {
        name: "Presupuestos",
        href: "/presupuestos",
        icon: FileText,
        adminOnly: false,
        moduloPresupuestos: true,
      },
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
  /** Permiso `caja.operar`. Sin él no se muestra el estado de caja. */
  puedeOperarCaja?: boolean;
  /** Permiso `caja.registrar_ingreso`: "Anotar ingreso" en el modal de caja. */
  puedeRegistrarIngreso?: boolean;
}

export function Sidebar({
  branding,
  userRole,
  userId,
  userName = "Usuario",
  planName = "Sin plan",
  negocios = [],
  negocioActivoId,
  puedeOperarCaja = true,
  puedeRegistrarIngreso = false,
}: Readonly<SidebarProps>) {
  const pathname = usePathname();
  const contextoPlan = useContextoPlan();
  const moduloPresupuestos = useModuloPresupuestos();
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
        // Caja solo para quien la opera. El corte real está en la página.
        if (item.href === "/caja" && !puedeOperarCaja && userRole !== "ADMIN")
          return false;
        if (item.moduloPresupuestos && !moduloPresupuestos) return false;
        return true;
      }),
    })).filter((group) => group.items.length > 0);
  }, [userRole, puedeOperarCaja, moduloPresupuestos]);

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
  const esAdmin = userRole === "ADMIN";
  const abrirPaleta = usePaletaStore((estado) => estado.abrir);
  // El cierre de sesión es un <form> con server action, y el item del menú
  // se desmonta al cerrarse el dropdown: el form vive afuera y el item lo
  // dispara.
  const formLogoutRef = useRef<HTMLFormElement>(null);

  // El símbolo del atajo lo sabe el navegador y no el server, así que el
  // snapshot del server es "Ctrl" —lo mayoritario acá— y el cliente corrige
  // en la hidratación. El teclado no cambia durante la sesión: no hay a qué
  // suscribirse.
  const esMac = useSyncExternalStore(
    () => () => {},
    () =>
      /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
  const atajoBuscar = `${esMac ? "⌘" : "Ctrl"}+K`;

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
              puedeRegistrarIngreso={puedeRegistrarIngreso}
              className="mr-1"
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
          {/* Buscador global: el mismo store que el atajo Ctrl+K, no una
              segunda paleta (ver paleta-store). Antes vivía en el navbar. */}
          {!isCollapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={abrirPaleta}
                  aria-label={`Buscar (${atajoBuscar})`}
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                >
                  <Search className="h-4 w-4 stroke-2" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Buscar · {atajoBuscar}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Colapsado no hay lugar al lado del logo: el buscador va arriba de
            la navegación, como un ítem más. */}
        {isCollapsed && (
          <div className="hidden md:flex justify-center pt-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={abrirPaleta}
                  aria-label={`Buscar (${atajoBuscar})`}
                  className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                >
                  <Search className="h-4.5 w-4.5 stroke-2" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Buscar · {atajoBuscar}
              </TooltipContent>
            </Tooltip>
          </div>
        )}

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
                          // Sin prefetch, y es la regla para todo link del
                          // panel. No hay ningún `loading.tsx` y todas las
                          // rutas son force-dynamic, así que el prefetch
                          // devuelve una cáscara de 328 bytes que no acelera
                          // nada — pero para armarla ejecuta el root layout y
                          // su `generateMetadata`, con consulta a
                          // `configuracion_pos` incluida. Medido el 15/9/2026:
                          // 8.150 ejecuciones del root layout por 1.190
                          // navegaciones reales, o sea ~7.000 invocaciones de
                          // Vercel por día que no producían nada. Ver el
                          // bloque PREFETCH de middleware.ts.
                          prefetch={false}
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

        {/* 4. FOOTER: el usuario. Todo lo que es "de la cuenta" (perfil,
            plan, configuración, soporte, cerrar sesión) vive en su menú, no
            suelto en el sidebar. */}
        <div className="border-t border-border/50 p-3 bg-muted/5">
          {/* El catálogo guardado para trabajar sin señal se borra ACÁ, antes
              de que la sesión se vaya: en un celular compartido no puede
              quedar accesible después de que la vendedora se fue. Ver
              shared/lib/cache-offline.ts. El form está afuera del menú porque
              el menú se desmonta al cerrarse; el item lo dispara. */}
          <form
            ref={formLogoutRef}
            action={logoutAction}
            className="hidden"
            onSubmit={() => {
              void borrarCacheOffline();
            }}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/80 data-[state=open]:bg-muted cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring ${isCollapsed ? "justify-center" : ""}`}
                aria-label="Menú de la cuenta"
              >
                <AvatarUsuario
                  userId={userId}
                  nombre={userName}
                  size={32}
                  animado
                />
                {!isCollapsed && (
                  <>
                    <div className="flex-1 overflow-hidden">
                      <p className="text-sm font-medium truncate text-foreground leading-tight">
                        {userName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
                        {planName}
                      </p>
                    </div>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              side={isCollapsed ? "right" : "top"}
              align={isCollapsed ? "end" : "start"}
              sideOffset={8}
              className="w-60"
            >
              <DropdownMenuLabel className="flex items-center gap-3 font-normal">
                <AvatarUsuario userId={userId} nombre={userName} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {userName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {planName}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              {/* Perfil, plan y configuración son del dueño: el sidebar ya
                  solo le mostraba el perfil al ADMIN, y cambiar de plan o de
                  configuración es decisión suya. El corte real está en cada
                  página. */}
              {esAdmin && (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/perfil" prefetch={false}>
                      <UserIcon />
                      Perfil
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/configuracion" prefetch={false}>
                      <Settings />
                      Configuración
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/perfil?tab=plan" prefetch={false}>
                      <Rocket />
                      Mejorar plan
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem asChild>
                <Link href="/soporte" prefetch={false}>
                  <LifeBuoy />
                  Soporte
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => formLogoutRef.current?.requestSubmit()}
              >
                <LogOut />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  );
}
