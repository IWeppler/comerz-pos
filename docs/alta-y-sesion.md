# Alta de comercios, sesión y panel de Comerz

Leé esto antes de tocar `/auth`, `/auth/callback`, `/onboarding`, el middleware,
`crearNegocioAction`, `aceptarInvitacionAction`, el custom access token hook,
`embudo_de_alta` / `funnel_comerz`, o /admincomerz.

## El claim del token es una FOTO

El middleware lee las membresías del claim `comerz`, que el custom access token hook
(`20260903110000`) calcula al EMITIR el token. En el alta el token se emite antes de
que exista el negocio, y el claim queda viejo: `/` → "ningún negocio" →
`/seleccionar-negocio` → la base dice "uno" → `/` → **ERR_TOO_MANY_REDIRECTS**.
- Arreglado en las dos puntas: `crearNegocioAction` y `aceptarInvitacionAction`
  refrescan el token (los dos únicos momentos en que cambian las membresías), y el
  gate 4 del middleware, cuando el conteo desmiente al claim, le pregunta a la base.
- El gate cuenta solo membresías HABILITADAS (igual que `listarMisNegociosAction`).
  Cero habilitadas → `/auth?error=sin-negocio`; una sola la elige el middleware
  seteando la cookie.
- **Cada rebote infinito: buscar las dos fuentes que se contradicen antes que el
  redirect** (misma forma que `sesion-interrumpida.ts` y `salir-sesion.ts`).

## `/auth/callback` corre DOS veces con el mismo code

El primer canje crea la sesión y el segundo falla siempre (404). Medido en prod; la
causa (prefetch del navegador o del cliente de mail) no está identificada y no hace
falta: **el callback termina siempre en `destino` y nunca en una pantalla de error**.
`/onboarding` detecta la sesión (con sesión arranca en el paso 2). Esto explicaba a
personas que confirmaban el mail y veían "El enlace venció".

## Pantallas

- **`Suspense` con `fallback={null}` alrededor de una pantalla entera es una
  pantalla en blanco.** La boundary va alrededor de lo que suspende y el fallback es
  un esqueleto.

## Google + "Confirm email" apagado

Juntos abren un agujero: con la confirmación apagada cualquiera registra un mail
ajeno, y si después el dueño real entra con Google, Supabase vincula las identidades
y cae en ESA cuenta. Está escrito en `shared/lib/auth-google.ts`. **Hay que elegir
una salida antes de prender `GOOGLE_AUTH_HABILITADO`** (env var, solo el literal
`"on"`).

## Embudo de alta (/admincomerz)

- `funnel_comerz` arranca en `negocios.created_at`; `embudo_de_alta`
  (`20260909120000`) cubre el tramo anterior (cuenta → mail → sesión → negocio).
- **"Sesión creada" NO es "entró"**: `last_sign_in_at` lo escribe el canje del link.
  `sesionSoloDelLink` detecta la sesión que emitió el mail sin que la persona volviera.
- "Vio el formulario" lo escribe el onboarding (`registrar_paso_onboarding`,
  DEFINER que no recibe el usuario: sale de `auth.uid()`, pasos de lista cerrada).
- Lee `auth.users`: es DEFINER y **el `where security.is_super_admin()` es lo único
  que la protege** (guard).
- Las cuentas de prueba salen del denominador: subaddress de una casilla ya
  registrada, o marcadas en `usuarios_prueba`. **Nunca adivinar por el nombre del
  mail.** Una "cuenta sin negocio" puede ser super admin, empleado invitado o
  invitación pendiente: se separan como en `destinoSinNegocio`.
- La lógica de etapas vive en `features/admin/lib/embudo-alta.ts` con tests.

## Negocios y planes

- `crear_negocio_con_owner` siembra CAJA_DIARIA, POR_ACREDITAR, CAJA_GENERAL,
  métodos de pago (el trigger les crea cuenta), categorías de gasto y todos los
  permisos al ADMIN. Un negocio nace en `prueba`.
- **Estado y MRR son dos ejes** (8/10/2026, `20261008120000`): `estado` dice si
  opera y si ya dejó la prueba; `negocios.cuenta_en_mrr` (default true, solo
  super admin) dice si suma. MRR = `sumaAlMrr` (activo Y en la cuenta), el mismo
  criterio en el panel y en /admincomerz/metricas (la RPC
  `metricas_globales_comerz` devuelve la columna). Un comercio de cortesía va
  `activo` + fuera del MRR (Ninja Camisetas). Registrar el primer pago pasa
  `prueba` → `activo`; también hay "Pasar a activo (ya paga)" en el menú.
- Barra de prueba (8/10/2026, `features/planes/lib/barra-prueba.ts` con tests):
  franja entre el navbar y el contenido, solo ADMIN y solo `estado = 'prueba'`
  con vencimiento. Antes de vender pide el próximo paso OBLIGATORIO de la guía;
  vendiendo muestra las ventas; a ≤3 días o vencida pide plan; con una
  solicitud pendiente deja de apurar. Días por día comercial argentino
  (`plan_vencimiento` es timestamptz y el server corre en UTC). Los datos del
  negocio viajan en `getContextoPlanAction` (sin viaje nuevo); activación,
  conteo de ventas y solicitud solo para negocios en prueba, en un Suspense.
- `tieneFeature` falla ABIERTO (un negocio sin plan tiene todo); un módulo que mueve
  plata usa además un interruptor propio fail-closed (ver
  [presupuestos.md](presupuestos.md)).
