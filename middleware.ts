import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { HEADER_NEGOCIO_SLUG } from "@/shared/lib/negocio-slug";
import {
  clasificarHost,
  esHostDeDesarrollo,
  COOKIE_TIENDA_DEV,
  HEADER_MODO_CATALOGO,
  HEADER_TIENDA_DEV,
  PARAM_TIENDA_DEV,
} from "@/shared/lib/host-comerz";
import { decidirRuteo, RUTA_TIENDA_NO_ENCONTRADA } from "@/shared/lib/ruteo-host";
import { resolverTienda } from "@/shared/lib/cache-tenants";
import { MENSAJE_SESION_VENCIDA } from "@/shared/lib/sesion-vencida";
import { RUTA_LOGIN, RUTA_SALIR, esSalidaDeSesion } from "@/shared/lib/salir-sesion";
import { RUTA_SESION_INTERRUMPIDA } from "@/shared/lib/sesion-interrumpida";
import {
  COOKIE_IMPERSONATE,
  COOKIE_NEGOCIO_ACTIVO,
  COOKIE_NEGOCIO_MAX_AGE,
  HEADER_IMPERSONATE,
  HEADER_NEGOCIO_ACTIVO,
} from "@/shared/lib/negocio-activo";
import { negocioHabilitado } from "@/shared/lib/estado-negocio";
import {
  leerClaimComerz,
  resolverContextoDesdeClaim,
} from "@/shared/lib/contexto-desde-claims";
import {
  COOKIE_ORIGEN_ALTA,
  COOKIE_ORIGEN_ALTA_MAX_AGE,
  origenDesdeQuery,
  serializarOrigen,
} from "@/shared/lib/origen-alta";

export async function middleware(request: NextRequest) {
  return conOrigenAlta(request, await rutear(request));
}

/**
 * Anota de dónde vino quien abre /empezar (`?ref=`, `utm_*`), para que llegue
 * hasta el negocio aunque el alta cruce un mail, Google u otro día. Envuelve
 * al ruteo en vez de ir adentro: el ruteo tiene una docena de salidas y esto
 * tiene que valer para todas. Solo sobre una respuesta que muestra la página:
 * en un redirect (el dominio desnudo mandando al panel) la cookie quedaría en
 * el host equivocado, y el salto siguiente la escribe en el bueno.
 * Ver `shared/lib/origen-alta.ts`.
 */
function conOrigenAlta(request: NextRequest, respuesta: NextResponse) {
  if (request.nextUrl.pathname !== "/empezar") return respuesta;
  if (respuesta.status >= 300) return respuesta;
  // Gana el primer origen: no se pisa una cookie que ya estaba.
  if (request.cookies.has(COOKIE_ORIGEN_ALTA)) return respuesta;

  const origen = origenDesdeQuery(request.nextUrl.searchParams);
  if (!origen) return respuesta;

  respuesta.cookies.set(COOKIE_ORIGEN_ALTA, serializarOrigen(origen), {
    path: "/",
    maxAge: COOKIE_ORIGEN_ALTA_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return respuesta;
}

async function rutear(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host");

  // Override para probar subdominios sin DNS: ?tienda=evens una vez, y de ahí
  // en más lo sostiene la cookie —si no, el primer link interno vuelve al panel
  // y no se puede navegar el catálogo—. `?tienda=` vacío la borra. Solo se lee
  // en localhost y previews (`clasificarHost` lo vuelve a chequear).
  const paramTienda = request.nextUrl.searchParams.get(PARAM_TIENDA_DEV);
  const overrideTienda =
    paramTienda ??
    request.headers.get(HEADER_TIENDA_DEV) ??
    request.cookies.get(COOKIE_TIENDA_DEV)?.value ??
    null;

  const destino = clasificarHost(host, { overrideTienda });

  // Qué negocio sirve el catálogo. Dos formas, misma resolución dinámica:
  // el subdominio (evens.comerz.app) o el primer segmento del path
  // (/store/evens). Si llegan las dos, gana el subdominio.
  const slugDelHost = destino.tipo === "tienda" ? destino.slug : null;
  const slugDelPath = pathname.startsWith("/store/")
    ? (pathname.split("/")[2] || null)
    : null;
  const slugNegocio = slugDelHost ?? slugDelPath;

  // El header se reescribe siempre: nunca se confía en el que vino de afuera.
  // Sin slug se borra, y sin slug la RLS no devuelve catálogo alguno — ya no
  // existe el negocio por defecto.
  const conNegocio = () => {
    const headers = new Headers(request.headers);
    if (slugNegocio) {
      headers.set(HEADER_NEGOCIO_SLUG, slugNegocio);
    } else {
      headers.delete(HEADER_NEGOCIO_SLUG);
    }
    // Los links del catálogo dependen de cómo se está sirviendo: desde un
    // subdominio son relativos a la raíz. Se decide acá, donde ya se sabe.
    headers.set(HEADER_MODO_CATALOGO, slugDelHost ? "subdominio" : "path");
    return { headers };
  };

  /** Persiste (o borra) el override de desarrollo cuando vino por query. */
  const conCookieDev = <T extends NextResponse>(respuesta: T): T => {
    if (paramTienda === null || !esHostDeDesarrollo(host)) return respuesta;

    if (paramTienda) {
      respuesta.cookies.set(COOKIE_TIENDA_DEV, paramTienda, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    } else {
      respuesta.cookies.delete(COOKIE_TIENDA_DEV);
    }
    return respuesta;
  };

  // Ruteo por host, ANTES de cualquier consulta de sesión: el catálogo público
  // es anónimo y no tiene por qué pagar un getUser() por request.
  if (destino.tipo !== "app") {
    // El slug se valida contra el cache en memoria (TTL), no contra Supabase:
    // esto corre en cada request de cada tienda. `indeterminado` deja pasar
    // —lo resuelve la página— para que un parpadeo de la base no apague todos
    // los catálogos a la vez.
    let existe: boolean | null = null;
    if (destino.tipo === "tienda") {
      const resolucion = await resolverTienda(destino.slug);
      if (resolucion.estado !== "indeterminado") {
        existe = resolucion.estado === "existe";
      }
    }

    const accion = decidirRuteo({
      destino,
      pathname,
      search: request.nextUrl.search,
      tiendaExiste: existe,
    });

    if (accion.tipo === "redirect") {
      return conCookieDev(
        NextResponse.redirect(new URL(accion.destino, request.url)),
      );
    }

    if (accion.tipo === "no-encontrada") {
      const url = request.nextUrl.clone();
      url.pathname = RUTA_TIENDA_NO_ENCONTRADA;
      url.search = "";
      return conCookieDev(NextResponse.rewrite(url, { request: conNegocio() }));
    }

    if (accion.tipo === "rewrite") {
      const url = request.nextUrl.clone();
      url.pathname = accion.pathname;
      return conCookieDev(NextResponse.rewrite(url, { request: conNegocio() }));
    }
  }

  // ─── PREFETCH: se corta acá, sin tocar la base ───────────────────────────
  //
  // Cada `<Link>` visible dispara un prefetch, y el sidebar tiene 8 links
  // siempre a la vista: eran 8 ejecuciones completas del middleware por
  // pantalla del panel, cada una con `getUser()` + `contexto_sesion()`.
  // 16 viajes a Ohio por entrar a cualquier pantalla.
  //
  // Y no compraban nada. Medido contra producción, sobre una ruta
  // force-dynamic (no hay un solo `loading.tsx` en la app):
  //
  //   documento normal ....... 52.093 bytes
  //   RSC de navegación ...... 23.716 bytes
  //   RSC de PREFETCH ........      330 bytes
  //
  // Sin loading boundary, Next no puede precargar contenido dinámico: el
  // prefetch devuelve una cáscara de ruteo. La navegación real hace igual el
  // RSC completo, y esa SÍ pasa por todo lo de abajo. Por eso esto no cambia
  // la velocidad de navegar — saca trabajo, no beneficio.
  //
  // POR QUÉ ACÁ Y NO EN EL `matcher`: excluir el prefetch desde el matcher
  // también se salta el rewrite del catálogo de arriba, y entonces cada
  // tarjeta de producto de una tienda prefetchea un 404 (probado). Cortando en
  // este punto el rewrite ya ocurrió y las tiendas quedan intactas.
  //
  // SEGURIDAD: la navegación real —sin este header— sigue pasando por los
  // gates de abajo. Y desde el 22/8/2026 `/`, `/configuracion` y `/compras/*`
  // tienen además su propio `bloquearVendedor()` en la página, así que
  // ninguna ruta depende solo de esto para autorizar.
  //
  // SESIÓN: `getUser()` de abajo también refresca la cookie. Se sigue
  // refrescando en cada navegación real y en cada server action, y el cliente
  // de navegador (`createBrowserClient`) renueva el token por su cuenta. El
  // prefetch no era el único camino ni el principal.
  //
  // Van los dos headers porque conviven dos convenciones: Next manda
  // `Next-Router-Prefetch` y algunos agentes usan `purpose: prefetch`.
  const esPrefetch =
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch";

  if (esPrefetch) {
    return NextResponse.next({ request: conNegocio() });
  }

  // ─── SALIDA DE SESIÓN: se corta acá, sin montar el cliente de Supabase ────
  //
  // `/auth/salir` existe para BORRAR las cookies de auth. Si el middleware
  // montara el cliente igual, `getClaims()` podría refrescar la sesión y
  // escribir cookies `sb-*` nuevas en ESTA respuesta, que después se fusiona
  // con la del route handler — el mismo nombre de cookie con un `set` y un
  // `delete` compitiendo, y el orden no está garantizado. O sea: el borrado
  // podría no quedar, que es exactamente lo que la ruta viene a arreglar.
  //
  // Nada se pierde: la ruta no necesita saber quién es el usuario, y el gate 5
  // igual la deja pasar por `saliendoDeSesion`.
  if (pathname === RUTA_SALIR) {
    return NextResponse.next({ request: conNegocio() });
  }

  let supabaseResponse = NextResponse.next({
    request: conNegocio(),
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  const negocioActivo = request.cookies.get(COOKIE_NEGOCIO_ACTIVO)?.value;
  const impersonando = request.cookies.get(COOKIE_IMPERSONATE)?.value;

  const headersNegocio: Record<string, string> = {};
  if (negocioActivo) headersNegocio[HEADER_NEGOCIO_ACTIVO] = negocioActivo;
  if (impersonando) headersNegocio[HEADER_IMPERSONATE] = impersonando;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    global: Object.keys(headersNegocio).length
      ? { headers: headersNegocio }
      : undefined,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({
          request: conNegocio(),
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // `getClaims()` y no `getUser()`.
  //
  // `getUser()` SIEMPRE va al servidor de auth: 5.616 requests en 24 h, 140 ms
  // de media. `getClaims()` verifica el JWT LOCAL con WebCrypto contra el JWKS
  // cacheado — este proyecto está en claves asimétricas y se confirmó leyendo
  // un token real (ES256, con `kid`). No es un atajo que baje la garantía: es
  // lo que el propio `.d.ts` de supabase-js recomienda sobre `getSession()`,
  // que sí devuelve datos sin verificar.
  //
  // Con claves simétricas caería a red igual que `getUser()`, así que si algún
  // día se rota a un secreto legacy esto deja de ahorrar pero sigue siendo
  // correcto.
  const { data: verificado } = await supabase.auth.getClaims();
  const claims = verificado?.claims ?? null;
  const user = claims ? { id: claims.sub as string } : null;

  const isAuthRoute =
    pathname.startsWith("/auth") || pathname.startsWith(RUTA_LOGIN);
  // Salida de una sesión que el servidor ya no reconoce. Se calcula acá arriba
  // porque el gate 5 tiene que consultarlo antes de rebotar a nadie al panel:
  // devolver al panel a quien viene a soltar un token muerto es justamente el
  // loop que documenta `salir-sesion.ts`.
  const saliendoDeSesion = esSalidaDeSesion(pathname, request.nextUrl.search);
  // Las páginas legales se linkean desde el login: tienen que abrirse sin
  // sesión, o el link manda a /auth y no se lee nunca lo que se está por
  // aceptar.
  const isPublicRoute =
    pathname.startsWith("/store") ||
    // Resumen de cuenta corriente por token: lo abre la clienta desde un link
    // de WhatsApp y NO tiene sesión. Sin esto rebota al login, que es la forma
    // más rápida de que el link no sirva para nada.
    //
    // La barra final NO es decorativa: `startsWith("/r")` se comería
    // `/reportes` y `/recuperar` y las volvería públicas.
    pathname.startsWith("/r/") ||
    pathname.startsWith("/recuperar") ||
    pathname.startsWith("/terminos") ||
    pathname.startsWith("/privacidad") ||
    // /empezar es donde se CREA la cuenta: exigir sesión para entrar sería
    // pedirle la llave a quien viene a que se la demos. Va también en
    // `isRutaSinNegocio` de abajo, porque el que ya se registró y volvió
    // todavía no tiene negocio y no debe rebotar al selector.
    pathname.startsWith("/empezar")
  // Rutas donde todavía no hay negocio elegido: son justamente las que sirven
  // para elegirlo o crear el primero.
  const isRutaSinNegocio =
    pathname.startsWith("/seleccionar-negocio") ||
    pathname.startsWith("/empezar") ||
    pathname.startsWith("/invitacion");

  // 1. Rol del usuario EN EL NEGOCIO ACTIVO (ya no es un dato del perfil: el
  // mismo usuario puede ser ADMIN en un negocio y VENDEDOR en otro).
  //
  // UNA sola llamada para rol y super admin (`contexto_sesion`), no dos.
  // Este archivo corre en CADA request del panel, así que cada viaje que hace
  // se paga en cada navegación, cada prefetch y cada server action. Medido
  // sobre una venta real: `rol_actual` + `is_super_admin` eran 543 ms de los
  // 1.048 ms de la venta, antes de que create-sale empezara.
  //
  // Y es el costo que NO baja moviendo la región de las funciones: el
  // middleware es runtime edge, corre cerca del usuario y lejos de la base
  // siempre. Lo único que se puede hacer es ir menos veces.
  //
  // DE DÓNDE SALE AHORA. Del claim `comerz` que escribe el custom access token
  // hook (20260903110000): trae el mapa {negocio: rol}, el negocio único y si
  // es super admin. Todo eso lo calculó la base al emitir el token; acá solo
  // se elige cuál corresponde a la cookie de esta request, que es lo único que
  // el token no puede saber. Ver `contexto-desde-claims.ts`.
  let rolActual: string | null = null;
  let rol = null;
  let esSuperAdmin = false;
  /**
   * "No pude averiguarlo", que NO es lo mismo que "no tiene negocio".
   *
   * Sin esta distinción un fallo de la consulta se leía como un `null` y el
   * gate 4 mandaba al selector o al onboarding; esas páginas, viendo que la
   * persona sí tiene negocio, la devolvían a `/`, y el rebote no terminaba
   * nunca. Ver `shared/lib/sesion-interrumpida.ts`.
   */
  let contextoIndeterminado = false;

  if (user) {
    const claim = leerClaimComerz(claims);

    if (claim) {
      const contexto = resolverContextoDesdeClaim(claim, {
        negocioActivo,
        impersonando,
      });
      rolActual = contexto.rol;
      esSuperAdmin = contexto.esSuperAdmin;
    } else {
      // FALLBACK A LA BASE, y es PERMANENTE, no andamio de la migración.
      //
      // Un token puede no traer el claim por motivos que no se van a terminar
      // nunca: sesiones emitidas antes de registrar el hook (hasta 60 min), el
      // hook desregistrado, una rotación de clave, o el propio hook cayendo en
      // su rama de error —que devuelve el evento intacto justamente para no
      // dejar a Auth sin emitir tokens—.
      //
      // La salida NO puede ser un rol por defecto: uno permisivo abre rutas y
      // uno restrictivo deja gente afuera. La base ya sabe la respuesta.
      //
      // SE LOGUEA A PROPÓSITO. Sin esto, dentro de tres meses no habría forma
      // de saber si cae acá el 0,3% de las requests (lo esperado) o el 40%
      // (algo se rompió). El conteo sale gratis de los logs de Supabase
      // —`rpc/contexto_sesion` se cuenta solo— pero el MOTIVO solo se sabe
      // desde acá.
      const motivo = claims
        ? "claim-ausente-o-version-desconocida"
        : "sin-claims-verificados";
      console.warn(`[CLAIMS] fallback a contexto_sesion: ${motivo}`);

      const { data, error } = await supabase
        .rpc("contexto_sesion")
        .maybeSingle();
      const contexto = data as {
        rol: string | null;
        es_super_admin: boolean | null;
      } | null;

      // Un error acá NO es "no tiene negocio": es que no se pudo preguntar.
      // Tratarlos igual es lo que producía el loop contra el selector.
      if (error) {
        console.error("[CLAIMS] contexto_sesion falló:", error.message);
        contextoIndeterminado = true;
      }

      rolActual = contexto?.rol ?? null;
      esSuperAdmin = contexto?.es_super_admin ?? false;
    }

    // Si por algún motivo falla, asumimos el rol más restrictivo (VENDEDOR)
    rol = rolActual || "VENDEDOR";
  }

  /**
   * Corte cuando no se pudo resolver el contexto. NUNCA con redirect: la
   * pantalla se sirve con rewrite, la URL no cambia y por lo tanto no hay salto
   * que se pueda repetir en ciclo. Ver `shared/lib/sesion-interrumpida.ts`.
   *
   * Un server action no puede recibir HTML —el `fetch` de React lo lee como
   * "An unexpected response was received from the server"— así que ahí va el
   * mismo 401 en texto plano que ya usa la sesión vencida, que el boundary sabe
   * mostrar.
   */
  const cortarPorContextoIndeterminado = () => {
    if (request.headers.get("next-action")) {
      return new NextResponse(MENSAJE_SESION_VENCIDA, {
        status: 401,
        headers: { "content-type": "text/plain" },
      });
    }

    const url = request.nextUrl.clone();
    url.pathname = RUTA_SESION_INTERRUMPIDA;
    url.search = `?volver=${encodeURIComponent(pathname)}`;
    return NextResponse.rewrite(url, { request: conNegocio() });
  };

  // 2. Control de usuarios NO autenticados
  if (!user) {
    /**
     * Al login, con una excepción que importa: un SERVER ACTION no se puede
     * redirigir. El `fetch` de React sigue el 307 solo, recibe el HTML del
     * login y tira "An unexpected response was received from the server", que
     * el boundary muestra como "esta pantalla falló" —sin decir lo único que
     * importa— con un Reintentar que no puede funcionar porque la sesión sigue
     * vencida. Visto en producción en /stock, iPhone con la PWA instalada.
     *
     * 401 + texto plano es lo que Next sabe leer: usa el CUERPO como mensaje
     * cuando el status es >= 400 y el content-type es text/plain. Es el único
     * canal que sobrevive, porque del resto de la respuesta no queda nada.
     *
     * Las navegaciones y los RSC siguen redirigiendo: ahí el redirect SÍ
     * funciona —Next cae a una navegación del navegador y se aterriza en el
     * login—, y es lo que hace que volver a entrar sea un solo toque.
     *
     * VA ACÁ ADENTRO Y NO ARRIBA DEL BLOQUE: solo reemplaza redirecciones que
     * de verdad iban a ocurrir. Puesto antes, le contestaba 401 a los actions
     * de las rutas PÚBLICAS —el catálogo y el resumen de cuenta corriente por
     * token, que corren sin sesión a propósito— y los rompía.
     */
    const alLogin = () => {
      if (request.headers.get("next-action")) {
        // El content-type va EXACTO, sin charset: Next compara por igualdad
        // estricta (`contentType === 'text/plain'` en server-action-reducer),
        // así que "text/plain; charset=utf-8" cae en el else y el mensaje se
        // pierde. Probado contra producción: el 307 termina en un 404 de
        // /auth que ya viene con charset, y por eso salía el texto genérico.
        return new NextResponse(MENSAJE_SESION_VENCIDA, {
          status: 401,
          headers: { "content-type": "text/plain" },
        });
      }

      const url = request.nextUrl.clone();
      url.pathname = RUTA_LOGIN;
      return NextResponse.redirect(url);
    };

    // La raíz sin sesión y sin subdominio de tienda es la landing de comerz,
    // no el catálogo de un comercio: no hay tenant por defecto.
    if (pathname === "/") return alLogin();
    if (!isAuthRoute && !isPublicRoute) return alLogin();
    return supabaseResponse;
  }

  // 2 bis. No se pudo averiguar el contexto de la sesión.
  //
  // Va ANTES de los gates que redirigen, porque el problema no es a dónde
  // mandar a esta persona sino que no se sabe: cualquier redirect elegido con
  // información incompleta es el que después rebota. Las rutas públicas, el
  // login y la salida siguen su camino: son las que tienen que funcionar
  // JUSTAMENTE cuando lo demás no funciona.
  if (contextoIndeterminado && !isPublicRoute && !isAuthRoute) {
    return cortarPorContextoIndeterminado();
  }

  // 3. Super admin de comerz: no pertenece a ningún negocio, así que queda
  // fuera de todo el control por rol y negocio activo. Su lugar es /admincomerz.
  // `esSuperAdmin` ya vino con el rol, arriba: era un segundo viaje a la base
  // por request para leer un booleano de la misma sesión.
  if (esSuperAdmin) {
    if (isAuthRoute || pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/admincomerz";
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // 4. Logueado con negocios pero sin uno elegido: al selector.
  //
  // Sin NINGÚN negocio ahora se lo manda a crear uno. Antes iba a /auth con
  // ?error=sin-negocio, porque el alta de comercios era manual y "sin negocio"
  // solo podía significar "empleado al que no invitaron". Con el alta
  // self-service abierta significa además "se registró para abrir su comercio
  // y todavía no lo creó", que es el camino normal del onboarding — devolverlo
  // al login lo dejaría sin forma de entrar nunca.
  //
  // Al empleado con invitación pendiente lo separa `destinoSinNegocio` en el
  // login, que es donde está el email para buscarla.
  if (user && !rolActual && !isRutaSinNegocio && !isPublicRoute && !isAuthRoute) {
    // SE PIDE EL ESTADO, no un conteo pelado, y esa es la corrección.
    //
    // Antes acá se contaban TODAS las membresías mientras
    // `listarMisNegociosAction` —la que usa la página del selector— filtra por
    // `negocioHabilitado`. Dos definiciones distintas de "tenés un negocio", y
    // la contradicción es un callejón: con la única membresía en `cancelado`
    // (hoy `ignacionweppler+4`), el middleware decía "tenés uno, andá a
    // elegir" y el selector contestaba "no tenés ninguno, andá al login".
    //
    // Es la MISMA familia que el claim viejo de abajo: dos lugares que
    // responden la misma pregunta con distinta información.
    const { data: membresias, error } = await supabase
      .from("usuarios_negocios")
      .select("negocio_id, negocios(estado)")
      .eq("usuario_id", user.id);

    // Si la consulta falló, `membresias` viene null y "no pude contar" se
    // leería como "no tiene ninguno" — o sea /empezar, que al ver que sí
    // tiene negocios devuelve a `/` y arranca el rebote.
    if (error) {
      console.error("[NEGOCIOS] conteo de membresías falló:", error.message);
      return cortarPorContextoIndeterminado();
    }

    const habilitados = (membresias ?? []).filter((m) => {
      // El embed de PostgREST puede venir como objeto o como array de uno.
      const negocio = Array.isArray(m.negocios) ? m.negocios[0] : m.negocios;
      return negocioHabilitado(
        (negocio as { estado?: string } | null)?.estado,
      );
    });
    const count = habilitados.length;

    // Tiene membresías pero NINGUNA sirve: todos cancelados o suspendidos.
    // No es "todavía no creó el suyo" —mandarlo a /empezar le haría abrir
    // un comercio nuevo cuando lo que quiere es el que tenía— ni es algo que
    // pueda resolver eligiendo. Va al login con el motivo, que es lo mismo que
    // ya contestaba la página del selector.
    if (count === 0 && (membresias ?? []).length > 0) {
      const url = request.nextUrl.clone();
      url.pathname = RUTA_LOGIN;
      url.search = "?error=sin-negocio";
      return NextResponse.redirect(url);
    }

    // ────────────────────────────────────────────────────────────────────
    // EL CLAIM PUEDE ESTAR VIEJO, Y ACÁ SE NOTA.
    //
    // `rolActual` sale del claim `comerz`, que la base calculó AL EMITIR EL
    // TOKEN. Si las membresías cambiaron después, el token sigue diciendo lo
    // de antes hasta que se refresque — hasta una hora.
    //
    // Pasa siempre en el alta: el token se emite en el `signUp`, cuando la
    // persona todavía no tiene ningún negocio, y treinta segundos después crea
    // el suyo. Medido el 9/9/2026 con `ignacionweppler+5`: registro 13:40:23,
    // negocio creado 13:41:10, y a partir de ahí cuatro pasadas por este gate
    // en dos segundos —el claim decía "ninguno" y la base decía "uno"—:
    //
    //   /                     → claim sin negocios → /seleccionar-negocio
    //   /seleccionar-negocio  → la base dice 1     → redirect /
    //   ...                   → ERR_TOO_MANY_REDIRECTS
    //
    // Es la MISMA forma del incidente de `sesion-interrumpida.ts` con otro
    // disparador: dos lugares que responden la misma pregunta con distinta
    // información y se la pasan para siempre. Y no alcanza con que el alta
    // refresque el token (lo hace, ver `crearNegocioAction`): eso arregla el
    // caso conocido, no el próximo — una invitación aceptada o un cambio de
    // rol dejan el claim igual de viejo.
    //
    // Si el conteo desmiente al claim, la fuente que manda es la BASE.
    if ((count ?? 0) > 0) {
      const { data, error: errorContexto } = await supabase
        .rpc("contexto_sesion")
        .maybeSingle();

      if (errorContexto) {
        console.error(
          "[CLAIMS] claim viejo y contexto_sesion falló:",
          errorContexto.message,
        );
        return cortarPorContextoIndeterminado();
      }

      const contexto = data as { rol: string | null } | null;

      if (contexto?.rol) {
        // El token está atrasado pero la persona SÍ tiene dónde entrar. Se
        // sigue con el rol real; el token se pone al día solo en el próximo
        // refresh.
        console.warn("[CLAIMS] claim desactualizado: la base sí resuelve rol");
        rolActual = contexto.rol;
        rol = contexto.rol;
      } else if (count === 1 && negocioActivo !== habilitados[0].negocio_id) {
        // UN solo negocio habilitado, y la base no lo resolvió sola.
        //
        // Pasa cuando hay OTRA membresía muerta al lado: `current_negocio_id()`
        // cuenta membresías sin mirar el estado, ve dos y devuelve null. El
        // selector, que sí filtra, ve una sola y hace `redirect("/")` sin
        // dejar nada elegido — y vuelve a empezar.
        //
        // Se elige acá y se repite la MISMA url: la próxima pasada ya trae la
        // cookie y resuelve por el camino normal. El `negocioActivo !== ...` es
        // el freno: si la cookie ya apuntaba ahí y aun así no resolvió, el
        // problema es otro y este redirect sería el loop.
        const elegido = habilitados[0].negocio_id as string;
        const url = request.nextUrl.clone();
        const respuesta = NextResponse.redirect(url);
        respuesta.cookies.set(COOKIE_NEGOCIO_ACTIVO, elegido, {
          path: "/",
          maxAge: COOKIE_NEGOCIO_MAX_AGE,
          sameSite: "lax",
          httpOnly: false,
        });
        return respuesta;
      } else {
        // La base coincide con el claim: tiene negocios pero ninguno resuelto
        // —o sea más de uno habilitado y sin elegir—. Ahí el selector es lo
        // correcto.
        const url = request.nextUrl.clone();
        url.pathname = "/seleccionar-negocio";
        return NextResponse.redirect(url);
      }
    } else {
      const url = request.nextUrl.clone();
      url.pathname = "/empezar";
      return NextResponse.redirect(url);
    }
  }

  // 5. Control de usuarios SI autenticados yendo al Login. Solo si ya tienen
  // negocio resuelto: si no, quedarían rebotando entre /auth y el gate de
  // arriba.
  //
  // `saliendoDeSesion` es el segundo freno del loop del 7/9/2026: quien viene a
  // `/auth/salir` —o al login con `?sesion=vencida`— trae un token que este
  // middleware puede verificar pero que el servidor de Auth ya no reconoce.
  // Rebotarlo al panel es devolverlo al mismo 403 del que viene, en ciclo.
  // Ver `shared/lib/salir-sesion.ts`.
  if (user && isAuthRoute && rolActual && !saliendoDeSesion) {
    const url = request.nextUrl.clone();
    // Admin va al dashboard, vendedor va al stock
    url.pathname = rol === "ADMIN" ? "/" : "/pos";
    return NextResponse.redirect(url);
  }

  // 6. Bloqueos específicos para el VENDEDOR
  if (rol === "VENDEDOR") {
    const isDashboard = pathname === "/";
    const isConfig = pathname.startsWith("/configuracion");
    const isCompras = pathname.startsWith("/compras");

    // Si intenta entrar a una ruta prohibida, lo devolvemos al pos
    if (isDashboard || isConfig || isCompras) {
      const url = request.nextUrl.clone();
      url.pathname = "/pos";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

/**
 * El middleware corre en CADA request que pase por acá, y ahora además resuelve
 * el host. Todo lo que no es una página se saca del camino:
 *
 * - `/api`: no hay ruta de API que dependa del ruteo por host ni de la sesión
 *   del middleware; hacerlas pasar es latencia por nada.
 * - `/_next`, assets, íconos y el service worker: son archivos, no rutas.
 *   Además, en un subdominio de tienda entrarían al rewrite del catálogo.
 */
export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon\\.ico|apple-icon\\.png|icon\\.png|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|sw\\.js|workbox-.*\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|json|woff2?|ttf)$).*)",
  ],
};
