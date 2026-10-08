# Activación autónoma de comercios nuevos — plan de la V1

Leé esto antes de tocar la guía de inicio (`features/onboarding/`), la barra de
prueba (`features/planes/lib/barra-prueba.ts`), el festejo de la primera venta,
el wizard de primeros pasos o los hitos de activación.

Es un plan de implementación para ejecutar por tareas. Cada tarea dice qué
archivos tocar, qué tiene que pasar y cómo se verifica. **Antes de cada tarea
leé `AGENTS.md` y los documentos que nombra** (sobre todo `docs/ventas.md` y
`docs/caja-y-dinero.md` si tocás el POS, y `docs/seguridad.md` si creás una
tabla). Las reglas de `AGENTS.md` mandan sobre este documento.

---

## 1. Objetivo y por qué

Que un comerciante que nunca vio Comerz pueda **registrarse y hacer su primera
venta sin hablar con nadie**, idealmente en la primera sesión.

Métrica principal: **Time to First Sale** (alta del negocio → primera venta).

### Lo que dicen los datos (medido el 8/10/2026 en producción)

Altas self-service desde el 30/8/2026:

| Comercio | Productos | Caja | 1ª venta | Última actividad del dueño |
| --- | --- | --- | --- | --- |
| Librería Colores | 12 min | 11,6 h | 14 h | activa — **tuvo ayuda presencial** |
| El Nono Cacho | 10,5 días | 9,9 días | 9,9 días | activa |
| stefys | — | día 5 | — | día 13 |
| PequeñasGigantes | — | — | — | 9,5 h |
| LyM Makeup | — | al alta | — | 1,3 h |
| Darling Indumentaria | — | — | — | minutos |
| Mimo | — | — | — | minutos |

Conclusiones que guían el diseño:

1. **Línea base: 0 de 5 activaciones sin acompañamiento.**
2. **Se pierden en la PRIMERA sesión.** 4 de 5 se fueron en la primera hora sin
   cargar un solo producto y no volvieron. La guía ya retoma donde quedó, pero
   casi nadie vuelve: lo que importa es la primera sesión.
3. **La venta libre es el camino real**, no un atajo: El Nono Cacho tiene 1.778
   renglones de venta libre contra 92 productos; Colores, 974.
4. **La primera venta fallaba**: todos los comercios tienen
   `requiere_caja_abierta = true`, y confirmar con la caja cerrada mandaba a
   `/caja`, que no es donde se abre el turno. **Ya arreglado** (ver §2).
5. El rubro operativo de las altas quedaba en `indumentaria` salvo electro
   (bug de `crear_negocio_con_owner`, corregido en
   `20261007170000_rubro_pintureria.sql`). **No hay que volver a preguntar el
   rubro**: el alta ya lo pide y ahora se traduce bien.
6. Muestra chica (~1–2 altas por semana): medir por cohorte, no reaccionar a un
   caso.

---

## 2. Lo que YA está hecho (no rehacer)

- **Caja desde el POS** (8/10/2026): ante `CAJA_CERRADA` el POS abre el modal de
  apertura ahí mismo (`abrirCajaParaCobrar` en
  `features/pos/ui/cart-panel-admin.tsx`), en el celular cierra el drawer y lo
  devuelve en el mismo paso, y la venta NO se reintenta sola. Sin permiso de
  caja, avisa que se lo pida a otra persona (`useCajaModalStore().disponible`).
  El modal de caja se monta una sola vez (`montarModal` en
  `features/caja/ui/caja-status-button.tsx`). Detalle en `docs/caja-y-dinero.md`.
- **Barra de prueba** (`features/planes/lib/barra-prueba.ts` + `ui/barra-prueba.tsx`):
  usa `calcularProgresoActivacion` para nombrar el próximo paso obligatorio. Si
  cambiás los pasos (Tarea 1), la barra los sigue sola; correr sus tests.
- **Guía de inicio** (`features/onboarding/lib/pasos-activacion.ts` +
  `ui/checklist-activacion.tsx`): estado derivado de la RPC `estado_activacion`
  (solo ADMIN), sin flags guardados; desaparece al activar. **Se ajusta, no se
  rehace.**
- **Panel de Comerz**: `features/admin/actions/comercios-con-uso.ts` usa la
  MISMA `calcularProgresoActivacion` para mostrar el onboarding de cada comercio.

---

## 3. Decisiones tomadas (no re-discutir)

- La guía queda en **3 pasos obligatorios**: productos (o venta libre) → caja →
  primera venta. Se muestra además "Creaste tu negocio" tildado (fue un esfuerzo
  real del usuario, no algo automático).
- **Elegir "Quiero empezar a vender ahora" (venta libre) cumple el paso de
  productos.** El objetivo es la primera venta, no un catálogo completo.
- Logo/WhatsApp ("Ponele tu cara") y "Precio y stock" dejan de ser obligatorios.
- **Wizard con overlay propio** (sin librería de tours): Radix Popover + `motion`
  (ya instalados). Guía haciendo, no leyendo.
- **Festejo con `canvas-confetti`** (hay que instalarlo, ~6 kB) + tarjeta animada
  con `motion`.
- Fuera de V1: chatbot, centro educativo, videos, descubrimiento por rubro,
  tours de módulos, botón "? Ayuda" nuevo (ya existe `/soporte` y Ctrl+K).

---

## 4. Reglas que aplican a todas las tareas

- **No commitear.** Los cambios quedan en el working tree para revisión.
- Un cambio con migración no está terminado hasta: migración aplicada en prod +
  deploy + smoke test (ver `AGENTS.md`).
- Migraciones: aditivas, con guards que abortan; reescribir funciones desde el
  cuerpo VIVO (`pg_get_functiondef`), nunca desde el baseline; tabla nueva con
  `negocio_id` default `security.current_negocio_id()` y policy RESTRICTIVE
  (`docs/seguridad.md`). Probar en seco dentro de `begin … rollback`.
- **Nada del wizard ni de la guía puede mover plata ni stock por su cuenta.** El
  wizard ilumina y guía; la venta la confirma siempre la persona.
- Lógica pura en `lib/` con tests (vitest), como `pasos-activacion.ts`.
- Mobile primero: el mostrador es un celular. Blancos táctiles de 44px. El
  ticket del POS en celular es un drawer de vaul (`data-slot="drawer-content"`)
  que le saca los eventos al resto del body: todo popover/overlay que tenga que
  funcionar con el ticket abierto se portalea ADENTRO del drawer (patrón de
  `shared/components/cart-sidebar/client-selector.tsx`, `contenedorDrawer`).
- Animaciones (criterio Emil Kowalski, ver `.claude/skills/emil-design-eng`):
  solo `transform`/`opacity`, `ease-out` con curva fuerte
  (`cubic-bezier(0.23, 1, 0.32, 1)`), menos de 300 ms en UI, nada desde
  `scale(0)` (arrancar en `0.95` + `opacity: 0`), respetar
  `prefers-reduced-motion`. Lo que se ve muchas veces por día no anima; lo que
  pasa una vez en la vida (el festejo) sí puede.
- Correr `npx tsc --noEmit -p .`, `npx eslint <archivos>` y `npx vitest run`
  antes de dar una tarea por terminada.

---

## 5. Tareas (en este orden)

### Tarea 1 — Hitos de activación por negocio (base para las demás)

**Por qué.** "Elegí venta libre", "abrí el POS" y "con qué camino empecé" no se
pueden deducir de las tablas existentes. `onboarding_pasos_vistos` es por
USUARIO (no por negocio) y su RPC `registrar_paso_onboarding` tiene lista
cerrada `('PASO_2_NEGOCIO')`: no sirve para esto.

**Qué hacer.**

1. Migración nueva `supabase/migrations/<timestamp>_hitos_activacion.sql`:
   - Tabla `public.hitos_activacion`:
     - `negocio_id uuid not null default security.current_negocio_id()` (FK a
       `negocios` con `on delete cascade`),
     - `hito text not null` con CHECK de lista cerrada:
       `'POS_ABIERTO'`, `'CAMINO_VENTA_LIBRE'`, `'CAMINO_IMPORTACION'`,
       `'CAMINO_CARGA_RAPIDA'`, `'CAMINO_CARGA_MANUAL'`,
       `'PRIMERA_VENTA_FESTEJADA'`,
     - `usuario_id uuid default auth.uid()`,
     - `creado_en timestamptz not null default now()`,
     - `primary key (negocio_id, hito)` (idempotente: el primero gana, es "cuándo
       pasó por primera vez").
   - RLS habilitada. SELECT: policy RESTRICTIVE
     `negocio_id = (select security.current_negocio_id())` + una PERMISSIVE para
     `authenticated` con la misma condición. Super admin también lee
     (`security.is_super_admin()`), para el embudo de /admincomerz.
   - Sin INSERT directo para `authenticated`: se escribe solo por RPC.
   - `anon`: nada (nace cerrada por default privileges; verificarlo en un guard).
   - RPC `public.registrar_hito_activacion(p_hito text) returns void`,
     SECURITY DEFINER, `set search_path = public`:
     - si `auth.uid()` es null → `return`,
     - `v_negocio := security.current_negocio_id()`; si es null → `return`,
     - validar `p_hito` contra la misma lista (si no, `raise exception
       'HITO_DESCONOCIDO'`),
     - `insert … on conflict (negocio_id, hito) do nothing`.
     - `revoke execute … from public, anon; grant execute … to authenticated`.
   - Guards: la tabla existe con RLS, la policy RESTRICTIVE existe, `anon` no
     tiene privilegios sobre la tabla, la función es DEFINER y hay una sola.
   - Reversión en `supabase/reversals/<mismo nombre>.sql`.
2. `estado_activacion` (RPC viva, reescribir desde `pg_get_functiondef` con
   `replace()` + guard de que el ancla aparece exactamente una vez) suma una
   clave nueva:
   `'venta_libre_elegida', exists (select 1 from public.hitos_activacion h
   where h.negocio_id = security.current_negocio_id() and h.hito =
   'CAMINO_VENTA_LIBRE')`. Guard: sigue devolviendo null para no-ADMIN
   (`is_admin()`), y el resto de las claves siguen ahí.
3. Server action `features/onboarding/actions/registrar-hito.ts`
   (`registrarHitoActivacionAction(hito)`): igual que
   `features/auth/actions/paso-onboarding.ts` — **nunca lanza**, loguea y sigue.
   Es telemetría y no puede frenar una venta.
4. Disparadores (todos fire-and-forget):
   - `POS_ABIERTO`: al montar el POS (`features/pos/ui/pos-page-client.tsx` o
     equivalente), una vez por montaje.
   - `CAMINO_*`: al elegir una opción en "¿Cómo querés empezar?" (Tarea 3).
   - `PRIMERA_VENTA_FESTEJADA`: al mostrar el festejo (Tarea 5).

**Verificación.** Migración probada en seco y aplicada; llamar la RPC dos veces
deja una fila; un usuario de otro negocio no ve las filas; `estado_activacion`
devuelve `venta_libre_elegida`.

---

### Tarea 2 — Guía de 3 pasos (`pasos-activacion.ts`)

**Archivos:** `features/onboarding/lib/pasos-activacion.ts` (+ test),
`features/onboarding/ui/checklist-activacion.tsx`.

**Qué cambia.**

1. `EstadoActivacion` suma `venta_libre_elegida: boolean` (Tarea 1).
2. Pasos obligatorios, en este orden:
   1. **"Prepará tus productos"** (`clave: "productos"`): `hecho` =
      `estado.productos && estado.stock_y_precios` **o**
      `estado.venta_libre_elegida`. CTA: "Elegir cómo empezar" — abre el modal de
      la Tarea 3 (no navega). Usar un `accion: "elegir-camino"` como hoy se hace
      con `accion: "abrir-caja"` (la lib describe la intención, la UI la
      ejecuta).
   2. **"Abrí la caja"** (`clave: "caja"`): igual que hoy (`accion: "abrir-caja"`).
      Detalle nuevo: "Con cuánta plata arrancás en el cajón. $0 está bien."
   3. **"Hacé tu primera venta"** (`clave: "primera_venta"`): CTA "Ir al POS",
      `href: "/pos"`. Si el camino fue venta libre, el detalle dice "Tocá
      'Venta libre', escribí qué vendiste y el precio."
3. `marca` ("Ponele tu cara al negocio") y `empleados` y `catalogo_publicado`
   pasan a **opcionales** (`opcional: true`). `stock_y_precios` deja de ser un
   paso propio (queda adentro de "productos").
4. En la UI, arriba de los pasos, una fila fija **"✓ Creaste tu negocio"**
   tildada. Cuenta en el progreso: "1 de 4" recién creado. Implementarlo en la
   lib (un paso `clave: "negocio"` siempre `hecho: true`, no opcional) para que
   la barra de prueba y /admincomerz cuenten igual. Ajustar el tipo de `clave`.
5. Título de la card: **"Poné Comerz en marcha"**. Un solo CTA destacado
   (botón primario) en el paso siguiente; los demás pasos sin botón primario.
6. `activado` sigue siendo `primera_venta || todos los obligatorios hechos`.
7. Actualizar tests de `pasos-activacion.test.ts` y correr los de
   `features/planes/lib/barra-prueba.test.ts` y `features/admin` (usan la misma
   función). Casos mínimos: recién creado = 1 de 4; venta libre elegida tilda
   productos sin tener productos; con venta hecha, `activado` aunque falten
   pasos; opcionales no cuentan.

**Verificación.** En un negocio recién creado la card dice "1 de 4" y el único
botón primario es "Elegir cómo empezar".

---

### Tarea 3 — "¿Cómo querés empezar?"

**Archivos nuevos:** `features/onboarding/ui/elegir-camino-dialog.tsx` (+ lib
pura `features/onboarding/lib/caminos-inicio.ts` con tests si hay lógica por
rubro).

**Qué hace.** Un `Dialog` (en celular, que entre bien en 360px de ancho; sin
overlay de wizard: es un modal normal) con la pregunta **"¿Cómo querés
empezar?"** y 4 opciones grandes (tarjetas de toda la fila, 44px+ de alto,
título + una línea de detalle), en ESTE orden:

| # | Título | Detalle | Al elegir | Hito |
| --- | --- | --- | --- | --- |
| 1 | **Quiero empezar a vender ahora** | "Vendé escribiendo qué es y el precio. Los productos los cargás después." | Navega a `/pos` y abre la venta libre (`useVentaLibreStore.getState().abrir()` una vez montado el POS; pasar la intención por query `?inicio=venta-libre` y consumirla en el POS). Arranca el wizard (Tarea 4) en el paso de caja si está cerrada. | `CAMINO_VENTA_LIBRE` |
| 2 | **Ya tengo mis productos en Excel** | "Subís tu planilla y revisás antes de que toque el stock." | `/stock` y abre el modal de ingreso de mercadería por planilla (`IngresarMercaderiaModal`, montado en `features/stock/ui/stock-filters-toolbar.tsx`; abrirlo por query `?accion=importar`). | `CAMINO_IMPORTACION` |
| 3 | **Quiero cargarlos rápido** | "Escaneás el código de barras y la ficha se completa sola." | `/stock/carga-rapida`. **No mostrar esta opción si el rubro operativo es `indumentaria`** (mismo criterio que `porCodigoDeBarras` en `pasos-activacion.ts`). | `CAMINO_CARGA_RAPIDA` |
| 4 | **Un producto con todos sus datos** | "De a uno, con precio, stock y fotos." | `/stock` y abre "Nuevo Producto" (botón en `stock-filters-toolbar.tsx`; por query `?accion=nuevo`). | `CAMINO_CARGA_MANUAL` |

- Registrar el hito ANTES de navegar (fire-and-forget, sin esperar).
- Las queries (`?inicio=…`, `?accion=…`) se consumen una vez y se limpian de la
  URL (`router.replace` sin el param) para que recargar no reabra el modal.
- Se abre desde el CTA del paso "productos" de la guía y desde la barra de
  prueba cuando su CTA es ese paso (hoy la barra arma `cta` con
  `siguiente.href`; para `accion: "elegir-camino"` mandar a `/?empezar=1` y que
  el panel abra el modal al leer el param).
- Verificar en `estado_activacion` que después de elegir venta libre el paso
  queda tildado (refrescar con `router.refresh()` al volver al panel).

---

### Tarea 4 — Wizard de primeros pasos con overlay propio

**Qué es.** Un "coach mark": oscurece la pantalla, deja en claro SOLO el
control que importa y muestra al lado un globo con qué hacer. **Guía haciendo:
avanza cuando pasa la acción real, nunca con un botón "Siguiente".**

**Archivos nuevos:**

- `features/onboarding/lib/wizard-inicio.ts` — lógica pura + tests: dado el
  estado (`cajaAbierta`, `ventaLibreAbierta`, `ticketConLineas`,
  `primeraVenta`, `ruta`) devuelve el paso actual o `null`.
- `shared/store/wizard-inicio-store.ts` — zustand: `activo`, `iniciar()`,
  `salir()`. Persistir `activo` por negocio en `localStorage` con try/catch
  (clave `comerz:wizard-inicio:<negocioId>`), para retomar si recarga.
- `shared/components/spotlight.tsx` — el overlay genérico.
- `features/onboarding/ui/wizard-inicio.tsx` — monta el spotlight según el paso.
  Montarlo una vez en `app/(dashboard)/layout.tsx`, solo para ADMIN con negocio
  no activado (mismo criterio que la guía).

**Pasos del wizard** (el flujo de "Quiero empezar a vender ahora"; los otros
caminos no usan wizard en V1, solo la guía):

| Paso | Cuándo aplica | Elemento iluminado | Globo | Avanza cuando |
| --- | --- | --- | --- | --- |
| 1. Caja | caja cerrada | el chip "Caja cerrada" (`CajaStatusButton`) | "Primero abrí la caja: contá la plata que hay en el cajón. $0 está bien." | `useCajaStatusStore().isCajaAbierta === true` |
| 2. Venta libre | en `/pos`, caja abierta, ticket vacío | botón de venta libre del ticket | "Escribí qué vendiste y el precio." | el ticket tiene una línea |
| 3. Cobrar | ticket con líneas | botón "Continuar al Pago" y después "Confirmar Venta" | "Elegí cómo te pagaron y confirmá." | venta exitosa (`ventaExitosa !== null`) → termina y dispara el festejo (Tarea 5) |

**Cómo marcar los elementos:** atributo `data-wizard="caja"`,
`data-wizard="venta-libre"`, `data-wizard="cobrar"` en los botones reales. El
spotlight busca por selector. **Ojo:** `CajaStatusButton` se monta dos veces
(navbar y header del celular); iluminar el que esté visible (el primero con
`offsetParent !== null` / `getBoundingClientRect().width > 0`).

**`spotlight.tsx` — requisitos:**

- Recibe `selector`, `texto`, `onSalir`. Encuentra el elemento, mide con
  `getBoundingClientRect()` y lo sigue con `ResizeObserver` + `scroll`/`resize`
  (con `requestAnimationFrame`). Si el elemento no existe, no dibuja nada
  (nunca un overlay sin hueco).
- Hueco: un div `fixed` con el rect del elemento + 6px de margen,
  `rounded-lg`, `box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.55)` y
  `pointer-events: none`. **El elemento iluminado tiene que poder tocarse**: el
  overlay no captura clics en el hueco. Para que tampoco se toque el resto,
  cuatro divs transparentes alrededor del hueco con `pointer-events: auto`
  (o aceptar que el resto se pueda tocar: decidir por lo más simple que no
  rompa — lo importante es que el hueco SÍ funcione).
- Globo: `Popover` de Radix anclado al rect (`PopoverAnchor` con un div
  posicionado en el rect), `side` automático, ancho máx. `min(320px,
  100vw - 32px)`. Contenido: texto + link "Lo hago después" (llama `onSalir`,
  apaga el wizard; la guía del panel lo retoma).
- **Dentro del drawer del celular:** si el elemento está adentro de
  `[data-slot='drawer-content']`, portalear overlay y globo a ESE contenedor
  (como `client-selector.tsx`); si no, al body. Probar en 360px.
- Animación: entrada `opacity 0 → 1` + `scale 0.97 → 1` en 200 ms con
  `cubic-bezier(0.23, 1, 0.32, 1)`; el hueco se MUEVE entre pasos con
  `transition: transform/width/height 250ms` de esa curva (es la única
  transición de tamaño permitida, porque es la que explica "ahora es acá").
  Con `prefers-reduced-motion: reduce`, solo opacidad.
- `z-index` por encima del contenido pero por DEBAJO de los modales de Radix
  (el modal de caja se abre encima del wizard cuando se toca el chip: el wizard
  se esconde mientras haya un `[role=dialog]` abierto que no sea suyo).
- `Esc` = "Lo hago después".

**Arranque.** El wizard se inicia SOLO desde la opción "Quiero empezar a vender
ahora" (Tarea 3). Nunca aparece por su cuenta en otras pantallas.

**Verificación.** Negocio nuevo, caja cerrada, celular 360px y escritorio:
elegir venta libre → se ilumina el chip → abrir caja → se ilumina venta libre
en el POS → cargar una línea → se ilumina cobrar → confirmar → festejo. "Lo hago
después" en cualquier paso apaga todo y la guía del panel sigue mostrando el
paso que falta.

---

### Tarea 5 — Festejo de la primera venta

**Instalar:** `npm i canvas-confetti` y `npm i -D @types/canvas-confetti`.
Importarlo con `import()` dinámico al momento del festejo (no al cargar el POS).

**Cuándo.** Después de una venta exitosa en el POS, **solo si es la primera
venta confirmada del negocio**. Cómo saberlo sin sumar un viaje a cada venta:

1. Clave `comerz:primera-venta-festejada:<negocioId>` en `localStorage`
   (try/catch). Si existe → no hacer nada (cero consultas).
2. Si no existe, después del éxito: una consulta
   `ventas.select("id", { count: "exact", head: true })
   .eq("estado_operacion", "CONFIRMADA")` (mismo criterio que la barra de
   prueba). Si `count === 1` → festejar. En cualquier caso, guardar la clave
   (para no volver a contar en cada venta).
3. Al festejar, registrar el hito `PRIMERA_VENTA_FESTEJADA` (Tarea 1). Si el hito
   ya existía (otro dispositivo festejó), no pasa nada.

**Qué se ve.** En la pantalla de venta exitosa (`VentaExitosa`, en
`features/pos/ui/venta-exitosa.tsx`) arriba del ticket, una tarjeta:
**"🎉 Primera venta registrada — Ya estás usando Comerz."** + un botón
"Seguir vendiendo". Confetti una sola ráfaga desde abajo al centro
(`particleCount ~120, spread 70, origin { y: 0.9 }`,
`disableForReducedMotion: true`). Tarjeta con `motion`: `opacity 0 → 1`,
`y 8 → 0`, `scale 0.96 → 1`, spring `{ duration: 0.5, bounce: 0.2 }`. En el
celular el `VentaExitosa` vive dentro del drawer: el canvas de confetti va con
`confetti.create(canvas)` sobre un canvas propio dentro de ese contenedor, o
con `zIndex` alto si se usa el global; verificar que se vea por encima del
drawer.

**Nunca** demorar ni tapar el ticket impreso / el botón de imprimir: el festejo
se suma, no reemplaza.

---

### Tarea 6 — Después de activar: "Seguí preparando tu negocio"

Cuando `activado` es true, la guía hoy desaparece. En vez de eso, mostrar una
card más chica **"Seguí preparando tu negocio"** con los opcionales que falten:
"Ponele tu cara al negocio" (logo/WhatsApp), "Sumá a tu equipo", "Publicá tu
tienda online". Sin progreso obligatorio, con un "Ocultar" que se recuerda en
`localStorage` por negocio. Desaparece sola cuando no queda ninguno. No agregar
pasos por rubro en V1.

---

### Tarea 7 — Embudo de activación en /admincomerz

**Archivos:** `features/admin/lib/` (lib pura + tests) y la página que hoy
muestra el funnel (`features/admin/lib/funnel.ts`, `features/admin/actions/funnel-comerz.ts`).

Por comercio no-demo, no migrado (ver `migrado` en `funnel.ts`), las horas desde
el alta hasta cada hito:

| Hito | Fuente |
| --- | --- |
| Negocio creado | `negocios.created_at` |
| Camino elegido (y cuál) | `hitos_activacion` `CAMINO_*` |
| Productos | `min(producto_variantes.created_at)` (**`productos` no tiene `created_at`**) |
| Caja | `min(turnos_caja.fecha_apertura)` |
| POS abierto | `hitos_activacion` `POS_ABIERTO` |
| Primera venta | `min(ventas.fecha_venta)` con `estado_operacion = 'CONFIRMADA'` |

Más, por cohorte semanal de alta: % con primera venta en < 24 h y % en la
primera sesión (primera venta antes de que el dueño quede 2 h sin actividad;
si es difícil, dejarlo en < 24 h). Contar del lado de la base (RPC solo super
admin, como `metricas_globales_comerz`), no bajando filas a Node. Excluir
`demo` con `esNegocioDemo`.

---

### Fuera de la épica, pero recomendado (manual, sin código grande)

Los que se van en la primera hora no vuelven solos. El alta ya pide WhatsApp y
/admincomerz ya muestra onboarding + WhatsApp por comercio. Una lista "se fue
sin cargar nada" (alta hace más de 24 h, 0 productos, sin hito de camino) con su
link de WhatsApp, para escribirles a mano. Automatizar cuando haya volumen.

---

## 6. Smoke test final de la V1 (producción, con un comercio de prueba nuevo)

1. Registrarse desde cero (mail nuevo con subaddress, para que salga del
   denominador del embudo — ver `docs/alta-y-sesion.md`).
2. Panel: card "Poné Comerz en marcha", "1 de 4", único CTA "Elegir cómo
   empezar".
3. "Quiero empezar a vender ahora" → POS → wizard ilumina el chip de caja →
   abrir con $0 → ilumina venta libre → cargar "Prueba $100" → cobrar en
   efectivo → festejo con confetti, una sola vez.
4. Segunda venta: sin festejo y sin consultas extra (revisar Network).
5. Volver al panel: la card de activación ya no está; aparece "Seguí preparando
   tu negocio".
6. /admincomerz: el comercio aparece en el embudo con todos los hitos.
7. Repetir 3 en un celular real (360px), con el ticket en el drawer.
8. Dar de baja el comercio de prueba al terminar.

## 7. Estado de implementación — 8/10/2026

Las siete tareas tienen implementación local para revisión, sin commit ni deploy.
Las migraciones `20261008134656_hitos_activacion` y
`20261008134700_embudo_activacion_autonoma` están pendientes de aplicar en producción.
El conector Supabase se agregó y autenticó, pero sus herramientas SQL no están
disponibles en la sesión que preparó estos cambios. No se leyó ni se modificó una
RPC de producción: la migración usa `pg_get_functiondef` **al aplicar**, reemplaza
una única ancla y conserva el cuerpo vivo, también en `estado_activacion_de` para
que /admincomerz use el mismo criterio.

- T1: hitos con RLS, RPC idempotente, telemetría que no bloquea y reversiones.
- T2–T3: 1 de 4 al alta, tres pasos pendientes, elección de camino y queries
  consumidas conservando los demás parámetros. La barra de prueba usa la misma guía.
- T4: wizard persistido por negocio, spotlight portaleado al drawer, Escape y
  “Lo hago después”. Con caja cerrada se difiere la apertura del formulario de
  venta libre hasta abrir la caja, para que el drawer no tape el chip.
- T5: festejo diferido, canvas propio, movimiento reducido y una sola consulta
  por negocio/dispositivo; un error de lectura no marca la clave y permite reintentar.
- T6: opcionales con ocultamiento por negocio.
- T7: nueva RPC agregada para fechas y cohortes, sin reescribir `funnel_comerz`.
  En V1 se mide <24 h; la primera sesión queda fuera. Las cohortes usan semana
  argentina y el porcentaje excluye altas con menos de 24 h para no medir una
  ventana incompleta. La UI declara el denominador y muestra las altas totales.

Validación: TypeScript, lint sin errores (tres warnings preexistentes en los
archivos tocados) y suite completa (193 archivos, 2.043 tests, con dos workers
para evitar que el escaneo de selects del repo agote su timeout).
`scripts/verificar-activacion-autonoma.mjs`
prueba en PostgreSQL temporal: transacción revertida, idempotencia, aislamiento,
acceso ADMIN/super admin/anon, conservación de claves, cohortes y reversiones.
Preview a 360px con componentes reales, acciones ficticias y sin mover dinero:
guía, elección de camino, caja → venta libre → cobrar dentro del drawer → festejo.
Esto no reemplaza el smoke de §6 ni la prueba en un celular físico.
