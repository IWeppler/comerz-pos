import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

// El service worker queda acotado a CACHEAR ASSETS ESTÁTICOS INMUTABLES y
// nada más. La config default de next-pwa hacía tres cosas que en esta app son
// peligrosas — ver los comentarios de cada opción. next-pwa 5.6.0 está sin
// mantenimiento desde 2022 y sus defaults fueron pensados para el Pages Router
// de Next 12: no entienden ni RSC ni Server Actions.
const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",

  // Default: true. Hacía `location.reload()` en el evento `online`. En el
  // celular ese evento se dispara con cualquier parpadeo de señal (cambio de
  // antena, handoff wifi/4G, entrar a un probador): la página se recargaba
  // sola y se perdía el formulario de carga a medio llenar. Es la explicación
  // más simple de "cada tanto se rompe mientras cargo un producto".
  reloadOnOnline: false,

  // Default: true. Un service worker nuevo tomaba el control a mitad de
  // sesión, con la página ya cargada apuntando a los chunks del build
  // anterior. Con false, el SW nuevo espera a que se cierren las pestañas.
  skipWaiting: false,

  // Default: true las dos. Cacheaban el HTML de "/" con NetworkFirst; después
  // de un deploy podía servir un documento viejo que referencia chunks de otro
  // build. Van juntas: `dynamicStartUrl` inyecta la regla `start-url` por su
  // cuenta, sin mirar `cacheStartUrl`, así que apagar solo una no alcanza.
  cacheStartUrl: false,
  dynamicStartUrl: false,

  // Solo assets estáticos e inmutables. NO hay regla que matchee navegaciones,
  // peticiones RSC ni llamadas a Supabase: esas van derecho a la red, sin que
  // el SW las toque. Los defaults de next-pwa tenían tres reglas catch-all
  // (`others`, `apis`, `cross-origin`) con NetworkFirst y
  // networkTimeoutSeconds: 10, y de ahí salían dos problemas:
  //
  // 1. `others` agarraba las navegaciones. Con red mala, a los 10 segundos
  //    Workbox caía al caché; si esa ruta no estaba cacheada (maxEntries era
  //    32), el handler rechazaba, y una navegación rechazada la resuelve el
  //    navegador con SU pantalla de error — que en una PWA instalada en
  //    Android es literalmente "This page couldn't load. Reload to try again,
  //    or go back.". Sin log en Vercel porque el request nunca llegó.
  //
  // 2. `cross-origin` cacheaba los GET a Supabase por 1 HORA. En un POS eso
  //    significa que con red lenta una consulta de stock o de precios podía
  //    responder con datos de hasta una hora atrás. Es exactamente el tipo de
  //    cosa que no puede pasar acá.
  runtimeCaching: [
    {
      // Chunks de Next: llevan hash en el nombre, son inmutables. CacheFirst
      // con vencimiento largo, y entradas de sobra para que un deploy no
      // desaloje los del build anterior mientras alguien tiene la app abierta
      // (el default era maxEntries: 32, que se llenaba enseguida).
      urlPattern: /\/_next\/static\/.+/i,
      handler: "CacheFirst",
      options: {
        cacheName: "next-static",
        expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    {
      // Imágenes de producto en Supabase Storage: nombre con UUID, se suben
      // con cacheControl de un año. Nunca cambian bajo la misma URL.
      urlPattern:
        /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "supabase-storage",
        expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      // Assets propios de /public (logos, splash, iconos).
      urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-image-assets",
        expiration: { maxEntries: 64, maxAgeSeconds: 7 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "google-fonts-webfonts",
        expiration: { maxEntries: 8, maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "google-fonts-stylesheets",
        expiration: { maxEntries: 8, maxAgeSeconds: 7 * 24 * 60 * 60 },
      },
    },
  ],
});

const nextConfig: NextConfig = {
  // El default de Next para Server Actions es 1MB. El alta/edición de
  // productos manda main + thumbnail + grid por imagen (~0.33MB cada juego
  // en el mejor caso), así que con 3 imágenes ya se rozaba el límite y la
  // acción moría sin dejar log en Vercel. El tope real de lo que puede
  // llegar acá lo pone el cliente: MAX_IMAGENES_PRODUCTO archivos, cada uno
  // comprimido antes de subir (ver shared/utils/image-optimizer.ts).
  experimental: {
    serverActions: {
      // OJO: este número NO es el límite efectivo. La plataforma corta el
      // request antes (~4,5 MB) y lo que devuelve no es un payload RSC, así
      // que el cliente ni siquiera lo puede leer como error de la action:
      // termina en el error boundary con "el servidor devolvió una respuesta
      // incompleta". Subir este valor no cambia nada — lo único que sirve es
      // mandar menos. Ver shared/lib/tamano-payload.ts, que lo mide y avisa.
      bodySizeLimit: "10mb",
    },

    /**
     * Cuánto vale una ruta ya visitada en el router cache del NAVEGADOR.
     *
     * El default de `dynamic` es 0, o sea que no se cachea nada: volver a una
     * ruta que se visitó hace cinco segundos vuelve a pedir el RSC entero.
     * Medido en producción, yendo a /stock por SEGUNDA vez con el catálogo ya
     * en memoria de React Query: 432 ms de viaje al servidor para traer 3 kB
     * de cáscara que el navegador ya tenía.
     *
     * Y hay un segundo efecto, menos obvio: los `<Link>` que no declaran
     * `prefetch` usan ESTE valor para decidir cuánto vale lo prefetcheado. Con
     * 0, el prefetch nace vencido. O sea que los `loading.tsx` que se
     * agregaron para que la navegación se sienta inmediata no servirían de
     * nada sin esto: Next precargaría el estado de carga y lo tiraría antes de
     * poder usarlo. Los dos cambios se necesitan mutuamente.
     *
     * ─────────────────────────────────────────────────────────────────────
     * POR QUÉ 30 SEGUNDOS Y NO MÁS, que es donde está el riesgo real.
     *
     * Lo que se cachea es el RSC, y CADA RUTA arriesga algo distinto:
     *
     *   /pos y /stock ..... su RSC son 3 kB de shell: los datos los trae
     *                       React Query aparte, con su propio staleTime de 3
     *                       minutos. Cachear el shell NO agrega ni un segundo
     *                       de desactualización. Es ganancia pura.
     *   /ventas ........... su RSC son 1.113 kB CON los datos adentro (es
     *                       server component y hace await de getVentasAction).
     *                       Acá sí: una venta hecha en OTRA caja podría no
     *                       aparecer hasta 30 s.
     *
     * Ese último caso es el que fija el número, y es acotado por dos motivos.
     * Primero, `create-sale.ts` termina con `revalidatePath("/", "layout")`:
     * el navegador que vendió se limpia el cache entero, así que la vendedora
     * SIEMPRE ve su propia venta al instante. Solo las otras cajas ven la
     * demora. Segundo, la app ya tolera 3 minutos de desactualización en el
     * stock del catálogo, que es un dato bastante más caliente que el
     * historial de ventas. Treinta segundos es un orden de magnitud menos.
     *
     * Si algún día /ventas deja de traer sus datos en el RSC —tiene los
     * parámetros `desde`/`hasta` esperando un consumidor— este número puede
     * subir sin pensarlo, porque el único riesgo venía de ahí.
     *
     * `static` se deja en su default (300): rige solo para Links con
     * `prefetch={true}` explícito, y no hay ninguno.
     * ─────────────────────────────────────────────────────────────────────
     */
    staleTimes: {
      dynamic: 30,
    },
  },
  images: {
    // Sigue apagado, y a propósito: las fotos de producto y los logos ya
    // salen del pipeline de subida en webp y del tamaño de su lugar en
    // pantalla (13,6 kB un logo, 10,9 kB un grid), así que el optimizador no
    // tendría nada que mejorarles y sí un costo — `next/image` emite un
    // `srcset` de 8 URLs por imagen, ~1,2 kB de markup cada una, que en la
    // portada serían ~18 kB sobre un documento de 21.
    //
    // La única imagen que se sube CRUDA es el banner del catálogo, y encima es
    // el LCP. Ese caso se resuelve en su propio componente con
    // `shared/lib/banner-optimizado.ts`, sin tocar las otras 27 pantallas que
    // usan `next/image`.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  // El alta se llamaba /onboarding hasta el 23/10/2026. La dirección vieja
  // sigue viva porque está en mails ya enviados (campañas, confirmaciones con
  // `next=/onboarding` todavía sin abrir) y en links compartidos. Next copia
  // la query sola, así que `?ref=` y `utm_*` llegan intactos.
  async redirects() {
    return [
      { source: "/onboarding", destination: "/empezar", permanent: true },
      // El login se llamaba /auth hasta el 23/10/2026. Solo la ruta exacta:
      // /auth/callback, /confirm, /salir y /actualizar-password siguen donde
      // están (templates de mail de Supabase, retorno de Google).
      { source: "/auth", destination: "/ingresar", permanent: false },
    ];
  },
};

export default withPWA(nextConfig);
