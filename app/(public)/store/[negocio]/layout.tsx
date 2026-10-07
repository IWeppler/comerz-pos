import { Navbar } from "@/shared/components/navbar";
import { CatalogoPublicoProvider } from "@/features/store/components/catalogo-publico-provider";
import { CartPanelPublico } from "@/features/store/components/cart-panel-publico";
import { createPublicClient } from "@/shared/config/supabase/server";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveTenant } from "@/shared/lib/tenant";
import { ModoCatalogoProvider } from "@/shared/components/modo-catalogo-provider";
import { HEADER_MODO_CATALOGO } from "@/shared/lib/host-comerz";
import { urlDelPanel } from "@/shared/lib/ruteo-host";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { leerConfigPublica } from "@/entities/config/lib/leer-config-publica";
import { DescuentosPagoProvider } from "@/features/store/components/descuentos-pago-provider";
import { COLUMNAS_PROMOCION_PUBLICA } from "@/shared/lib/columnas-publicas";
import type { PromocionDB } from "@/shared/components/cart-sidebar/types";
import type { MetodoPublico } from "@/shared/lib/opciones-pago-publicas";
import type { Metadata } from "next";

// El título sale del negocio que se está mirando: no hay tienda por defecto
// ni nombre de comercio fijo.
export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ negocio: string }> }>): Promise<Metadata> {
  const { negocio } = await params;
  const headersList = await headers();
  const { negocio: datos } = await resolveTenant({
    hostname: headersList.get("host"),
    slug: negocio,
  });

  return {
    title: `${datos.nombre} | Tienda online`,
    description: `Comprá online en ${datos.nombre}.`,
  };
}

export default async function PublicLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ negocio: string }>;
}>) {
  const { negocio } = await params;
  const headersList = await headers();
  await resolveTenant({ hostname: headersList.get("host"), slug: negocio });

  // Cómo se está sirviendo el catálogo lo decidió el middleware; acá solo se
  // lee, para que los links del cliente coincidan con la URL que se ve.
  const modo =
    headersList.get(HEADER_MODO_CATALOGO) === "subdominio"
      ? "subdominio"
      : "path";

  const supabase = await createPublicClient();

  // Las categorías principales (sin padre) van al menú hamburguesa de mobile:
  // son las mismas que muestra la portada del catálogo.
  //
  // Promociones y métodos se leen ACÁ, una sola vez, y bajan por contexto: los
  // necesitan todas las tarjetas de la grilla, la ficha y el carrito. Ver
  // `DescuentosPagoProvider` para por qué no los pide cada uno por su cuenta.
  const [config, { data: categorias }, { data: promociones }, { data: metodos }] =
    await Promise.all([
      leerConfigPublica(),
      supabase
        .from("categorias")
        .select("id, nombre, slug")
        .eq("activa", true)
        .is("parent_id", null)
        .order("orden", { ascending: true }),
      supabase
        .from("promociones")
        .select(
          `${COLUMNAS_PROMOCION_PUBLICA}, promociones_metodos_pago ( metodo_pago ), promociones_categorias ( categoria_nombre )`,
        )
        .eq("activa", true),
      supabase
        .from("metodos_pago")
        .select("tipo, recargo_porcentaje, activo")
        .eq("activo", true),
    ]);

  return (
    <ModoCatalogoProvider modo={modo}>
      <DescuentosPagoProvider
        promociones={(promociones ?? []) as unknown as PromocionDB[]}
        metodos={(metodos ?? []) as MetodoPublico[]}
      >
      <CatalogoPublicoProvider key={negocio}>
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar branding={config} categorias={categorias ?? []} />
        <CartPanelPublico numeroWhatsApp={config?.whatsapp} />
        {children}

        <footer className="bg-neutral-900 mt-auto">
          {/* Franja de marca. Le habla al DUEÑO DE OTRO NEGOCIO que llegó acá
              mirando un catálogo — es el canal por el que Comerz se conoce:
              alguien ve la tienda de una conocida y pregunta con qué está
              hecha. Va arriba del copyright y con jerarquía visual propia,
              pero contenida: este footer es de la tienda, no de Comerz. */}
          <div className="border-b border-white/10">
            <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-5 text-center sm:text-left">
              <div>
                <p className="text-white font-semibold text-base">
                  ¿Tenés un negocio? Vendé online como {config?.posName}.
                </p>
                <p className="text-neutral-400 text-sm mt-1 max-w-md">
                  Catálogo web, control de stock y punto de venta en un solo
                  lugar.
                </p>
              </div>
              <Link
                href={urlDelPanel("/onboarding")}
                className="shrink-0 inline-flex items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-200"
              >
                Crear mi tienda
              </Link>
            </div>
          </div>

          <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-neutral-400">
            <p>
              © {new Date().getFullYear()} {config?.posName}. Todos los derechos
              reservados.
            </p>
            {/* Antes acá había un link "Ingresar" al panel. Se sacó: apuntaba a
                una pantalla de login que al visitante no le sirve, y era el
                camino por el que se terminaba instalando la PWA del POS desde
                el catálogo. Instalar la app es cosa de /auth. */}
            <p className="text-neutral-500">
              Hecho con{" "}
              <Link
                href={urlDelPanel("/auth")}
                className="font-medium text-neutral-300 underline-offset-4 hover:underline"
              >
                Comerz
              </Link>
            </p>
          </div>
        </footer>
      </div>
      </CatalogoPublicoProvider>

      {/* Telemetría SOLO del catálogo. En el POS no interesa medir y cada
          navegación de las vendedoras consumía cuota. El muestreo es porque
          Speed Insights cobra por data point: al 12/8/2026 iba 50% de la cuota
          al día 12, o sea ~129% proyectado. Sacando el POS el volumen cae
          aproximadamente a la mitad, y con 0.5 encima de eso el mes cierra
          holgado. Revisar el número con datos reales en unos días. */}
      <Analytics />
      <SpeedInsights sampleRate={0.5} />
      </DescuentosPagoProvider>
    </ModoCatalogoProvider>
  );
}
