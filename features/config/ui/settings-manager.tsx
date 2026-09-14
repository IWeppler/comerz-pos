"use client";

import { useMemo, useState } from "react";
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
    description: "Cajeros, administradores y roles",
  },
  {
    id: "preferencias",
    label: "Preferencias",
    icon: Settings,
    description: "Moneda, zona horaria, colores",
  },
];

interface SettingsManagerProps {
  config: ConfiguracionPOS;
  promociones: any[];
  /** Vacío para quien no es admin: la página no las consulta siquiera. */
  listasPrecios?: ListaPrecio[];
  pagos: any[];
  categorias?: any[];
  isAdmin: boolean;
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
  const soloAdmin = new Set(["empleados", "listasPrecios"]);
  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => !soloAdmin.has(s.id) || isAdmin),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin],
  );

  // Qué secciones necesitan un plan que este comercio no tiene. El candado va
  // en el MENÚ y no solo adentro del panel: sin esto, Estilo Bonito entraba a
  // "Empleados y Permisos" sin ninguna señal previa y se encontraba con el
  // paywall recién después de hacer click.
  const tieneRoles = useTieneFeature("roles");
  const seccionBloqueada = (id: string) => id === "empleados" && !tieneRoles;

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
      case "ticketConfig":
        // El ticket se configura sobre la misma configuracion_pos del
        // comercio: no hay una fuente de datos aparte que pasarle.
        return <TicketPanel config={config} puedeEditar={isAdmin} />;
      case "empleados":
        return (
          <EmpleadosPanel
            isAdmin={isAdmin}
            empleados={empleados}
            roles={roles}
            permisos={permisos}
            rolPermisos={rolPermisos}
            uso={uso}
            invitaciones={invitaciones}
            pedidosACaja={Boolean(config?.pedidos_a_caja)}
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
    <div className="flex flex-col md:flex-row gap-6 lg:gap-8">
      {/* SIDEBAR DE NAVEGACIÓN */}
      <aside className="w-full md:w-64 shrink-0">
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
        <nav className="hidden md:flex flex-col gap-1.5 sticky top-24">
          {visibleSections.map((section) => {
            const isActive = activeSection === section.id;
            const Icon = section.icon;

            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`flex items-start gap-3 p-3 rounded-xl transition-all text-left w-full cursor-pointer ${
                  isActive
                    ? "bg-card text-foreground border border-border font-semibold"
                    : "hover:bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent font-medium"
                }`}
              >
                <Icon
                  className={`w-5 h-5 shrink-0 mt-0.5 ${isActive ? "text-primary" : "opacity-70"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm">
                    {section.label}
                    {seccionBloqueada(section.id) && (
                      <>
                        <Lock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                        <Sparkles className="h-3 w-3 shrink-0 text-amber-500" />
                      </>
                    )}
                  </p>
                  {isActive && (
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 animate-in fade-in slide-in-from-top-1">
                      {section.description}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ÁREA PRINCIPAL */}
      <main className="flex-1 min-w-0 animate-in fade-in-50 duration-300">
        {renderPanel()}
      </main>
    </div>
  );
}
