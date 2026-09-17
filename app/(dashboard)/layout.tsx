import { RUTA_SALIR } from "@/shared/lib/salir-sesion";
import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/shared/components/sidebar";
import { DashboardNavbar } from "@/shared/components/dashboard-navbar";
import { ConfiguracionPOS } from "@/entities/config/types";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { QueryProvider } from "@/shared/components/query-provider";
import { listarMisNegociosAction } from "@/features/auth/actions/negocios";
import {
  COOKIE_IMPERSONATE,
  COOKIE_NEGOCIO_ACTIVO,
} from "@/shared/lib/negocio-activo";
import { BannerImpersonation } from "@/features/admin/ui/banner-impersonation";
import { VigilanteSesion } from "@/shared/components/vigilante-sesion";
import { NegocioActivoProvider } from "@/shared/components/negocio-activo-provider";
import { BannerVerificacionEmail } from "@/features/auth/ui/banner-verificacion";
import { BannerCertificadoArca } from "@/features/arca/ui/banner-certificado";
import { puedeOperarCaja } from "@/features/caja/lib/puede-operar-caja";
import { PlanProvider } from "@/features/planes/ui/plan-provider";
import { getContextoPlanAction } from "@/features/planes/actions/contexto-plan";
import { leerConfigPos } from "@/entities/config/lib/leer-config-pos";
import { etiquetaPlan } from "@/shared/lib/planes";
import { getUsuarioActual } from "@/shared/config/supabase/usuario-actual";
import { getRolActual } from "@/shared/config/supabase/contexto-actual";
import { puedeCobrarCuentaCorriente } from "@/features/clients/lib/puede-cobrar-cc";
import { CobrarCuentaCorrienteModal } from "@/features/clients/ui/cobrar-cuenta-corriente-modal";
import { ReciboCcSheet } from "@/features/clients/ui/recibo-cc-sheet";
import { PaletaComandos } from "@/shared/components/paleta-comandos";
import { SincronizadorVentas } from "@/features/sales/ui/sincronizador-ventas";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { user, error } = await getUsuarioActual();

  // A `/auth/salir` y no a `/auth`: si se llegó acá es porque el servidor de
  // Auth ya no reconoce la sesión, pero las cookies siguen puestas y el
  // middleware las verifica LOCAL —o sea que las sigue dando por buenas y
  // rebota de vuelta al panel—. Hay que borrarlas, y eso solo se puede hacer
  // desde un route handler. Ver `shared/lib/salir-sesion.ts`.
  if (error || !user) {
    redirect(RUTA_SALIR);
  }

  // El rol es por negocio (usuarios_negocios), el nombre es del perfil global.
  //
  // La configuración entra en esta misma tanda. Antes se leía DESPUÉS del
  // Promise.all, o sea un viaje de red entero en fila detrás de los otros
  // cuatro, en cada navegación del panel. Y `leerConfigPos` además la comparte
  // con el `generateMetadata` del layout raíz: si aquel ya la resolvió en este
  // mismo render, acá no cuesta nada.
  const [
    { data: perfil },
    rolActual,
    negocios,
    contextoPlan,
    config,
    puedeCobrarCc,
    puedeOperarCajaEsta,
  ] = await Promise.all([
      supabase.from("perfiles").select("nombre").eq("id", user.id).single(),
      // Cacheado por request: la página de abajo lo vuelve a pedir en el mismo
      // render y ahí ya no cuesta un viaje. Ver `getRolActual`.
      getRolActual(),
      listarMisNegociosAction(),
      getContextoPlanAction(),
      leerConfigPos(),
      // Cacheado por request, igual que el rol: la página del POS lo vuelve a
      // pedir en el mismo render para su propio botón y ahí ya no cuesta un
      // viaje. Ver `puede-cobrar-cc.ts`.
      puedeCobrarCuentaCorriente(),
      // Si no opera caja, el botón "Caja abierta/cerrada" de la barra no se
      // muestra: es la vendedora de "varios puestos, una caja".
      puedeOperarCaja(),
    ]);

  const userRole = rolActual || "VENDEDOR";
  const negocioActivoId = cookieStore.get(COOKIE_NEGOCIO_ACTIVO)?.value;
  // Modo dios: el super admin mirando el negocio de un cliente.
  const impersonadoId = cookieStore.get(COOKIE_IMPERSONATE)?.value ?? null;
  const impersonando = Boolean(impersonadoId);

  const settings = config;

  const systemBranding: ConfiguracionPOS = {
    id: settings?.id || "1",
    posName: settings?.posName || "Sistema POS",
    razon_social: settings?.posName || "Sistema POS",
    cuit: "",
    condicion_iva: "",
    inicio_actividades: "",
    localidad: "",
    provincia: "",
    posLogo: settings?.posLogo || "",
    whatsapp: "",
    direccion: "",
    mensaje_ticket: "",
    modo_caja: settings?.modo_caja || "UNICA",
  };

  // Con una sola membresía no hace falta cookie: ese es el negocio activo.
  const membresiaActiva =
    negocios.find((n) => n.negocio_id === negocioActivoId) ??
    (negocios.length === 1 ? negocios[0] : null);

  // En modo dios el negocio activo NO está entre las membresías del super
  // admin, así que salía null — y todo lo que se cuelga de
  // `useNegocioActivo()` (la cola de pedidos por cobrar, el carrito por
  // negocio, los links al catálogo) quedaba apagado justo cuando se está
  // revisando el negocio de un cliente. Se resuelve desde `negocios` por el
  // id de la cookie; `current_negocio_id()` ya lo honra por su cuenta.
  let negocioImpersonado: { id: string; slug: string; nombre: string } | null = null;
  if (impersonadoId && !membresiaActiva) {
    const { data } = await supabase
      .from("negocios")
      .select("id, slug, nombre")
      .eq("id", impersonadoId)
      .maybeSingle();
    negocioImpersonado = data ?? null;
  }

  const negocioActivo = membresiaActiva
    ? {
        id: membresiaActiva.negocio_id,
        slug: membresiaActiva.slug,
        nombre: membresiaActiva.nombre,
      }
    : negocioImpersonado;

  return (
    <NegocioActivoProvider negocio={negocioActivo}>
      <PlanProvider contexto={contextoPlan}>
    {/* Sesión zombie: si auth-js dice SIGNED_OUT o la PWA vuelve del fondo
        sin sesión, se sale por /auth/salir. Ver vigilante-sesion.tsx. */}
    <VigilanteSesion />
    <div className="min-h-screen bg-sidebar flex flex-col md:flex-row">
      <Sidebar
        branding={systemBranding}
        userRole={userRole}
        userId={user.id}
        userName={perfil?.nombre || undefined}
        // El plan es del NEGOCIO ACTIVO, no del usuario: el mismo usuario ve
        // "Plan Gestión" en un negocio y otro plan en el que tiene al lado.
        planName={etiquetaPlan(contextoPlan.planActual)}
        negocios={negocios}
        negocioActivoId={negocioActivoId}
        puedeCobrarCuentaCorriente={puedeCobrarCc}
        puedeOperarCaja={puedeOperarCajaEsta}
      />

      {/* Contenedor principal de la derecha */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden md:p-2 md:pl-0 h-screen">
        {/* El "Cajón" blanco redondeado que contiene la app */}
        <div className="flex-1 flex flex-col bg-background md:border md:border-border md:rounded-xl md:shadow-sm overflow-hidden relative">
          {impersonando && (
            <BannerImpersonation nombreNegocio={systemBranding.posName} />
          )}

          {/* La verificación del correo dejó de frenar el alta: se entra
              derecho y la deuda queda a la vista acá, con el plazo corriendo y
              el botón para resolverla. Ver
              features/auth/lib/verificacion-email.ts. */}
          <BannerVerificacionEmail
            email={user.email ?? ""}
            emailConfirmado={Boolean(user.email_confirmed_at)}
            creadoEn={user.created_at ?? null}
          />

          {/* Certificado de ARCA por vencer o vencido. Solo lo puede resolver
              un ADMIN, así que solo a ese rol se le muestra. */}
          {userRole === "ADMIN" && <BannerCertificadoArca />}

          <DashboardNavbar
            modoCaja={systemBranding.modo_caja || "UNICA"}
            userId={user.id}
            puedeCobrarCuentaCorriente={puedeCobrarCc}
            puedeOperarCaja={puedeOperarCajaEsta}
            userName={perfil?.nombre || undefined}
          />

          {/* Montado UNA vez para toda la app: lo abren el botón del POS y el
              modal de caja, y dos instancias serían dos formularios de cobro
              en paralelo. Mismo criterio que el modal de caja. */}
          {puedeCobrarCc && <CobrarCuentaCorrienteModal />}

          {/* El recibo del cobro, también una sola instancia: lo abren ese
              modal y el de la ficha del cliente. */}
          {puedeCobrarCc && <ReciboCcSheet />}

          {/* Ctrl+K. Va acá por lo mismo: una sola instancia para toda la app,
              y el atajo escuchado en `window` una sola vez. */}
          <PaletaComandos
            puedeCobrarCuentaCorriente={puedeCobrarCc}
            esAdmin={userRole === "ADMIN"}
            puedeOperarCaja={puedeOperarCajaEsta}
          />

          {/* Sube las ventas cobradas sin señal. Montado UNA vez, como la
              paleta: dos instancias serían dos sincronizaciones compitiendo
              por la misma cola. */}
          <SincronizadorVentas />

          <main className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <TooltipProvider>
              <QueryProvider>{children}</QueryProvider>
            </TooltipProvider>
          </main>
        </div>
      </div>
    </div>
      </PlanProvider>
    </NegocioActivoProvider>
  );
}
