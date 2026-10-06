"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Lock, Sparkles } from "lucide-react";
import { ConfiguracionPOS } from "@/entities/config/types";
import { useTieneFeature } from "@/features/planes/ui/plan-provider";
import type {
  Permiso,
  PerfilConRol,
  Rol,
  RolPermiso,
} from "@/entities/roles/types";
import {
  Store,
  Globe,
  Tag,
  Receipt,
  Users,
  CreditCard,
  Settings,
  FileSliders,
  Tags,
  UserCog,
  Calculator,
  FileText,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ConfigForm } from "./config-form";
import { PromotionsPanel } from "@/features/promotions/ui/promotions-panel";
import { ListasPreciosPanel } from "@/features/precios/ui/listas-precios-panel";
import type { ListaPrecio } from "@/entities/precios/types";
import { PreferencesPanel } from "@/features/preferences/ui/preferences-panel";
import { PaymentsPanel } from "@/features/payments/ui/payments-panel";
import { CatalogPanel } from "@/features/catalog/ui/catalog-panel";
import { CategoriesPanel } from "@/features/categories/ui/categories-panel";
import { ClientsPanel } from "@/features/clients/ui/clients-panel";
import { CajaConfigPanel } from "@/features/clients/ui/caja-panel";
import { EmpleadosPanel } from "./empleados-panel";
import type { InvitacionPendiente } from "./invitaciones-panel";
import type { UsoDelPlan } from "@/features/planes/actions/uso-del-plan";
import { TicketPanel } from "@/features/ticket/TicketPanel";
import { ConfigPresupuestosPanel } from "@/features/presupuestos/ui/config-presupuestos-panel";
import { useModuloPresupuestos } from "@/shared/components/negocio-activo-provider";

const SECTIONS = [
  {
    id: "comercio",
    label: "Comercio",
    icon: Store,
    description: "Datos básicos, logo y horarios",
  },
  {
    id: "catalogo",
    label: "Catálogo Online",
    icon: Globe,
    description: "Link público y preferencias",
  },
  {
    id: "caja",
    label: "Caja y Turnos",
    icon: Calculator,
    description: "Modo única o multicaja",
  },
  {
    id: "categoria",
    label: "Categorías",
    icon: FileSliders,
    description: "Categorías y organización del catálogo",
  },
  // Listas ANTES que Promociones, y son dos secciones distintas a propósito:
  // una lista es el PRECIO que le corresponde a un tipo de cliente
  // (permanente, por unidad, nunca sale al catálogo público) y una promoción
  // es un DESCUENTO bajo una condición (temporal, por ticket, se publica). Si
  // compartieran pantalla, en seis meses habría una lista llamada "20% OFF
  // verano".
  {
    id: "listasPrecios",
    label: "Listas de Precios",
    icon: Tags,
    description: "Precios mayoristas y por tipo de cliente",
  },
  {
    id: "promociones",
    label: "Promociones",
    icon: Tag,
    description: "Descuentos y reglas comerciales",
  },
  {
    id: "pagos",
    label: "Métodos de Pago",
    icon: CreditCard,
    description: "Efectivo, transferencias, recargos",
  },
  // Solo con el módulo prendido (ver `visibleSections`).
  {
    id: "presupuestos",
    label: "Presupuestos",
    icon: FileText,
    description: "Cuotas, recargos y vigencia",
  },
  {
    id: "ticketConfig",
    label: "Ticket de Venta",
    icon: Receipt,
    description: "Mensajes y formato del recibo",
  },
  {
    id: "empleados",
    label: "Empleados y Permisos",
    icon: Users,
    description: "Cajeros, administradores y roles",
  },
  {
    id: "clientes",
    label: "Clientes (CRM)",
    icon: UserCog,
    description: "Vencimientos, mora y recordatorios",
  },
  {
    id: "preferencias",
    label: "Preferencias",
    icon: Settings,
    description: "Moneda, zona horaria, colores",
  },
];

// Los grupos del menú lateral. Once secciones en una sola lista se leían
// como una pared; agrupadas por tema se encuentran de un vistazo. Una sección
// que no figura acá no se pierde: cae en "Otros".
const GRUPOS: { titulo: string; ids: string[] }[] = [
  { titulo: "Negocio", ids: ["comercio", "catalogo", "preferencias"] },
  { titulo: "Ventas", ids: ["caja", "pagos", "ticketConfig", "presupuestos"] },
  { titulo: "Productos", ids: ["categoria", "listasPrecios", "promociones"] },
  { titulo: "Personas", ids: ["clientes", "empleados"] },
];

interface SettingsManagerProps {
  config: ConfiguracionPOS;
  promociones: any[];
  /** Vacío para quien no es admin: la página no las consulta siquiera. */
  listasPrecios?: ListaPrecio[];
  pagos: any[];
  categorias?: any[];
  isAdmin: boolean;
  /** Para que la lista de empleados no ofrezca quitarse a uno mismo. */
  usuarioActualId?: string | null;
  empleados: PerfilConRol[];
  roles: Rol[];
  permisos: Permiso[];
  rolPermisos: RolPermiso[];
  /** Uso de los límites del plan, para el medidor de la sección de equipo. */
  uso?: UsoDelPlan | null;
  invitaciones?: InvitacionPendiente[];
}

export function SettingsManager({
  config,
  promociones,
  listasPrecios = [],
  pagos,
  categorias,
  isAdmin,
  usuarioActualId = null,
  empleados,
  roles,
  permisos,
  rolPermisos,
  uso,
  invitaciones = [],
}: Readonly<SettingsManagerProps>) {
  /**
   * La sección que se abre, con `?seccion=` como puerta de entrada.
   *
   * Configuración es UNA ruta con once paneles adentro, así que sin esto no
   * había forma de linkear a ninguno: ni desde la paleta (Ctrl+K), ni desde
   * un aviso, ni pasándole el link a alguien. La única forma de llegar a
   * "Listas de precios" era acordarse de que vivía acá adentro.
   *
   * Solo se lee al montar: a partir de ahí manda el menú lateral. Seguir la
   * URL en cada render obligaría a reescribirla en cada click, y el botón
   * "atrás" del navegador pasaría a recorrer secciones en vez de volver a
   * la pantalla anterior.
   *
   * Una sección desconocida cae en "comercio" en vez de dejar la pantalla en
   * blanco: un link viejo tiene que seguir abriendo algo.
   */
  const seccionPedida = useSearchParams().get("seccion");
  const [activeSection, setActiveSection] = useState(() =>
    SECTIONS.some((s) => s.id === seccionPedida) ? seccionPedida! : "comercio",
  );

  // Ocultamos el tab de Empleados y Permisos para no-admins en vez de
  // solo bloquear su contenido — evita el "click y me topo con acceso
  // restringido" cuando ni siquiera debería aparecer en el menú.
  // Mismo criterio para Listas de Precios que para Empleados: la RLS exige
  // ADMIN para escribirlas, así que mostrarle la sección a un ENCARGADO sería
  // ofrecerle botones que no funcionan. Además la página ni las consulta.
  const soloAdmin = new Set(["empleados", "listasPrecios", "presupuestos"]);
  const moduloPresupuestos = useModuloPresupuestos();
  const visibleSections = useMemo(
    () =>
      SECTIONS.filter(
        (s) =>
          (!soloAdmin.has(s.id) || isAdmin) &&
          (s.id !== "presupuestos" || moduloPresupuestos),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin, moduloPresupuestos],
  );

  // Qué secciones necesitan un plan que este comercio no tiene. El candado va
  // en el MENÚ y no solo adentro del panel: sin esto, Estilo Bonito entraba a
  // "Empleados y Permisos" sin ninguna señal previa y se encontraba con el
  // paywall recién después de hacer click.
  const tieneRoles = useTieneFeature("roles");
  const seccionBloqueada = (id: string) => id === "empleados" && !tieneRoles;

  const gruposVisibles = useMemo(() => {
    const agrupados = new Set(GRUPOS.flatMap((g) => g.ids));
    const grupos = GRUPOS.map((g) => ({
      titulo: g.titulo,
      secciones: g.ids
        .map((id) => visibleSections.find((s) => s.id === id))
        .filter((s): s is (typeof SECTIONS)[number] => Boolean(s)),
    }));
    const sueltas = visibleSections.filter((s) => !agrupados.has(s.id));
    if (sueltas.length > 0) grupos.push({ titulo: "Otros", secciones: sueltas });
    return grupos.filter((g) => g.secciones.length > 0);
  }, [visibleSections]);

  // El contenido scrollea en su propio contenedor (en desktop): al cambiar de
  // sección vuelve arriba, si no la sección nueva abría a mitad de página.
  const contenidoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contenidoRef.current?.scrollTo({ top: 0 });
  }, [activeSection]);

  const renderPanel = () => {
    switch (activeSection) {
      case "comercio":
        return <ConfigForm config={config} />;
      case "catalogo":
        return <CatalogPanel config={config} />;
      case "caja":
        return <CajaConfigPanel config={config} />;
      case "categoria":
        return <CategoriesPanel categorias={categorias || []} />;
      case "listasPrecios":
        return <ListasPreciosPanel listas={listasPrecios} />;
      case "promociones":
        return <PromotionsPanel promociones={promociones} />;
      case "pagos":
        return <PaymentsPanel pagos={pagos} />;
      case "presupuestos":
        return isAdmin && moduloPresupuestos ? (
          <ConfigPresupuestosPanel config={config} />
        ) : null;
      case "ticketConfig":
        // El ticket se configura sobre la misma configuracion_pos del
        // comercio: no hay una fuente de datos aparte que pasarle.
        return <TicketPanel config={config} puedeEditar={isAdmin} />;
      case "empleados":
        return (
          <EmpleadosPanel
            isAdmin={isAdmin}
            usuarioActualId={usuarioActualId}
            empleados={empleados}
            roles={roles}
            permisos={permisos}
            rolPermisos={rolPermisos}
            uso={uso}
            invitaciones={invitaciones}
          />
        );
      case "clientes":
        return <ClientsPanel config={config} />;
      case "preferencias":
        return <PreferencesPanel />;
      default:
        return (
          <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border flex flex-col items-center justify-center py-24 text-center">
            <Settings className="w-16 h-16 text-muted-foreground/20 mb-4 animate-spin-slow" />
            <h2 className="text-xl font-bold">En construcción</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Esta sección estará disponible próximamente.
            </p>
          </div>
        );
    }
  };

  return (
    // Desktop: segundo sidebar a la Supabase. El menú y el contenido ocupan el
    // alto de la pantalla y scrollean CADA UNO en su contenedor. Antes el menú
    // era `sticky` dentro del mismo scroll que el contenido: la rueda sobre el
    // menú no bajaba el panel y, con la ventana baja, el menú quedaba cortado.
    // Mobile: el select arriba y la página scrollea entera, como siempre.
    <div className="flex flex-col md:h-full md:flex-row">
      {/* SIDEBAR DE NAVEGACIÓN */}
      <aside className="w-full shrink-0 md:w-60 md:h-full md:overflow-y-auto md:border-r md:border-border">
        {/* Selector Mobile (Se oculta en Desktop) */}
        <div className="md:hidden mb-4">
          <Select value={activeSection} onValueChange={setActiveSection}>
            <SelectTrigger className="w-full h-12 bg-background border-border rounded-xl font-medium">
              <SelectValue placeholder="Seleccionar sección" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {visibleSections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  <div className="flex items-center gap-2">
                    <section.icon className="w-4 h-4 text-muted-foreground" />
                    {section.label}
                    {seccionBloqueada(section.id) && (
                      <Sparkles className="h-3 w-3 shrink-0 text-amber-500" />
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Menú Lateral Desktop */}
        <nav
          aria-label="Secciones de configuración"
          className="hidden md:flex flex-col gap-5 px-3 py-4"
        >
          <p className="px-2 text-base font-semibold text-foreground">
            Configuración
          </p>
          {gruposVisibles.map((grupo) => (
            <div key={grupo.titulo} className="flex flex-col gap-0.5">
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                {grupo.titulo}
              </p>
              {grupo.secciones.map((section) => {
                const isActive = activeSection === section.id;
                const Icon = section.icon;

                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    title={section.description}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "opacity-70"}`}
                    />
                    <span className="truncate">{section.label}</span>
                    {seccionBloqueada(section.id) && (
                      <span className="ml-auto flex items-center gap-1">
                        <Lock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                        <Sparkles className="h-3 w-3 shrink-0 text-amber-500" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* ÁREA PRINCIPAL — en desktop scrollea sola, con la barra a la vista
          (la del layout está oculta). */}
      <div
        ref={contenidoRef}
        className="flex-1 min-w-0 md:h-full md:overflow-y-auto"
      >
        <div key={activeSection} className="md:p-6 animate-in fade-in-50 duration-200">
          {renderPanel()}
        </div>
      </div>
    </div>
  );
}
