import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/shared/ui/sonner";
import { leerConfigPos } from "@/entities/config/lib/leer-config-pos";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { cn } from "@/lib/utils";
import { InstalacionPwaListener } from "@/shared/components/instalacion-pwa-listener";
import { ClientErrorReporter } from "@/shared/components/client-error-reporter";


/**
 * Geist y Geist Mono vienen del paquete `geist` (los woff2 variables están en
 * node_modules y los sirve `next/font/local`), NO de `next/font/google`.
 *
 * Con `next/font/google` la fuente se descarga en tiempo de BUILD, y en cada
 * capa del build por separado (server y cliente). El 16/9/2026 el build de
 * Vercel descargó bien en una capa y cayó al fallback en la otra: el nombre
 * de la clase `__variable_<hash>` sale de un hash del CSS generado, así que
 * el <html> salió con una clase (`__variable_5b3a4d`) y el CSS con otra
 * (`__variable_246ccd`), `--font-sans` quedó vacía y toda la app se veía en
 * Times New Roman. Sin error en el build: Next solo avisa "Failed to
 * download ... Using fallback font instead". Con el archivo en el repo no hay
 * descarga ni dos capas que puedan discrepar.
 *
 * Las variables las fija el paquete (`--font-geist-sans` / `--font-geist-mono`)
 * y globals.css las mapea a `--font-sans` / `--font-mono` de Tailwind.
 */

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export async function generateMetadata(): Promise<Metadata> {
  // Pasa por `leerConfigPos`, que deduplica con el layout del dashboard dentro
  // del mismo render y no consulta nada cuando no hay negocio elegido. Antes
  // esta función hacía su propia consulta en CADA request —2.384 por día,
  // medidas— para poner el título de la pestaña.
  const config = await leerConfigPos();

  // Fuera de un negocio (login, recuperar contraseña, landing) no hay
  // configuración que leer: ahí la marca es la de la plataforma, no la de un
  // comercio. Sin este fallback el título salía "undefined | Gestión POS".
  const posName = config?.posName || "Comerz";

  return {
    title: `${posName} | Gestión POS`,
    description: "Sistema de gestión y punto de venta web",
    appleWebApp: {
      capable: true,
      title: posName,
      statusBarStyle: "black-translucent",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={cn(
        "h-full",
        "antialiased",
        "font-sans",
        GeistSans.variable,
        GeistMono.variable,
      )}
      suppressHydrationWarning
    >
      {/* Sin `preconnect` a fonts.googleapis.com / fonts.gstatic.com: las
          fuentes se sirven desde este mismo dominio, el navegador nunca pide
          nada a Google. */}
      <body className="min-h-full flex flex-col font-sans text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
        <ClientErrorReporter />
        <InstalacionPwaListener />
        {/*
          Analytics y Speed Insights NO van acá: viven en el layout del catálogo
          público (app/(public)/store/[negocio]/layout.tsx). Del POS no
          interesan las métricas —son 4 personas conocidas, si algo va lento
          avisan— y en cambio cada navegación suya consumía cuota. Lo que sí
          importa medir es el catálogo: clientas reales, en celular, con red de
          local.

          Si algún día hace falta medir el panel, que sea con su propio
          componente en el layout del dashboard, nunca acá: este layout lo
          comparten las dos mitades de la app.
        */}
        {/* Etiquetas `<script>` NATIVAS y no `next/script`.

            next/script es un componente de CLIENTE que renderiza un `<script>`
            adentro, y React 19 avisa por eso en cada carga: "los scripts dentro
            de componentes nunca se ejecutan al renderizar en el cliente". El
            aviso es correcto — en una navegación del lado del cliente ese
            contenido no corre. Este layout es un Server Component, así que el
            script sale en el HTML de la respuesta y el navegador lo ejecuta
            como cualquier script de una página: sin componente de por medio, no
            hay nada de qué avisar.

            El orden importa y es el del snippet oficial: gtag.js va `async`, y
            el inline de abajo define `dataLayer` y `gtag` antes de que termine
            de cargar, así ninguna llamada temprana se pierde.

            El linter de Next sugiere el componente de
            `@next/third-parties/google`. Es la forma oficial y es una buena
            sugerencia, pero significa sumar una dependencia: queda anotado para
            decidirlo aparte, no para resolverlo de paso mientras se arregla un
            warning de render. El script nativo funciona igual y no arrastra
            nada. */}
        {/* eslint-disable-next-line @next/next/next-script-for-ga */}
        <script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-PGP6P5VS3Y"
        />
        <script
          id="google-analytics"
          dangerouslySetInnerHTML={{
            __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-PGP6P5VS3Y');
          `,
          }}
        />
      </body>
    </html>
  );
}
