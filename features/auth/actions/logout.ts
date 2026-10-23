'use server';

import { createClient } from '@/shared/config/supabase/server';
import {
  COOKIE_IMPERSONATE,
  COOKIE_NEGOCIO_ACTIVO,
} from '@/shared/lib/negocio-activo';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function logoutAction() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // `scope: 'local'` — salir de ESTE dispositivo, no de todos.
  //
  // El default de supabase-js es `'global'`: cierra TODAS las sesiones del
  // usuario en todos sus dispositivos. Y acá multi-sesión es la norma, no la
  // excepción: medido el 7/9/2026, Mara tenía 6 sesiones vivas, Evelyn 4 y
  // Zunilda 3 (celular del local, celular propio, la PWA instalada, que en iOS
  // tiene su PROPIO frasco de cookies separado del Safari normal).
  //
  // Con el default, tocar "Salir" en un dispositivo dejaba a los otros con las
  // cookies puestas y un access token que sigue verificando bien —hasta 1 h—
  // contra una sesión que en el servidor ya no existe. Ese desfase es lo que
  // produjo el loop de redirects del 7/9/2026 en Estilo Bonito: logout a las
  // 22:57, dos tandas de `403 Session not found` a las 23:25 y 23:29 en la PWA.
  // Ver `shared/lib/salir-sesion.ts`.
  //
  // Los frenos de ese incidente siguen siendo necesarios —una sesión puede
  // morir por otros motivos— pero esto saca de la mesa la causa más común, que
  // además es la peor: echaba de la app a un dispositivo que estaba vendiendo.
  //
  // Si algún día hace falta "cerrar sesión en todos lados" (un celular
  // perdido), es un botón APARTE con `scope: 'global'`, no el default de salir.
  await supabase.auth.signOut({ scope: "local" });

  // El negocio activo (y el modo dios) son de la sesión que se acaba de
  // cerrar, pero su cookie dura 30 días: sin este borrado sobrevive al
  // logout y el server sigue mandando `x-negocio-activo` de alguien que ya
  // no está logueado. No abre nada —la base valida la membresía— pero deja
  // a `leerConfigPos` consultando `configuracion_pos` como `anon`, que no
  // tiene GRANT sobre `modo_caja`: eso es el `[CONFIG] ... 42501` que
  // aparecía en los logs en cada visita a /auth después de salir.
  cookieStore.delete(COOKIE_NEGOCIO_ACTIVO);
  cookieStore.delete(COOKIE_IMPERSONATE);

  redirect('/ingresar');
}
