# Catálogo: vender más (épicas para hacer)

Estado: **implementación local en revisión (7/10/2026)**. M1, M2, M3 y M5 tienen
código, migraciones y reversiones. M4 tiene RPC candidata, carrusel y agregado al
carrito: **falta la medición SQL real en Librería Colores antes de elegir el cache
o precálculo**. Sin commits, migraciones aplicadas ni deploy. Cada épica se puede delegar
sola. Leelo antes de tocar el carrito público (`features/store/components/cart-*`),
`shared/lib/totales-pedido-publico.ts`, las promociones o la config del catálogo.

## Reglas para quien lo haga (ChatGPT u otro agente)

- Leé `AGENTS.md` y, según la épica, `docs/stock-y-catalogo.md` (Catálogo),
  `docs/seguridad.md` (qué lee `anon`), `docs/ventas.md` (promociones) y
  `docs/tienda-online.md` (medición de pedidos).
- **No commitees** y **no apliques migraciones**: escribilas en `supabase/migrations/`
  con guards que aborten, más la reversión en `supabase/reversals/`. Las aplica
  Ignacio.
- La lógica pura va en `lib/` con tests de vitest. Al terminar: `npx tsc --noEmit -p .`
  y `npx vitest run` sin errores.
- Mobile primero: el catálogo se mira en el celular. Blancos de 44 px.
- Textos en español rioplatense, con tildes ("Tu carrito está vacío").

## Auditoría: qué tiene hoy el dueño para vender

| Herramienta | Estado |
|---|---|
| Banner de portada (imagen, título, botón, encuadre) y marquee de texto | Hay (`banner-manager.tsx`, `catalog-panel.tsx`) |
| Promociones con `mostrar_en_catalogo`: general o por método de pago, % | Hay. En uso: 5 promos (Evens 2, Estilo Bonito 3), todas porcentaje, ninguna con `monto_minimo` |
| Precio tachado / "con X% OFF" en tarjetas y ficha | Hay (`precio-con-descuento.tsx`) |
| "También te puede gustar" en la ficha | Hay, pero por `productos.tipo` (texto viejo de categoría), los 4 más nuevos; no por ventas |
| Compartir producto, dominio propio, filtros, categorías | Hay |
| Envío: costo fijo local y mensaje "a convenir" para lejos | Hay (`envio_costo_local`, `envio_mensaje_lejos`) |
| Carrito vacío | Una ilustración y "Tu carrito esta vacio" (sin tildes), **sin ninguna acción** |
| Ancho del carrito | `sm:w-100` (400 px): angosto para mostrar sugerencias |
| Productos sugeridos dentro del carrito | **No hay** |
| Envío gratis desde un monto o unidades | **No hay** |
| Barra de progreso hacia un beneficio | **No hay** |
| Código de descuento (cupón) | **No hay**: `promociones` no tiene código, y el catálogo aplica sola toda promo activa |
| Saber si algo de esto funciona | Desde el 7/10 se cuentan los pedidos (`registrar_pedido_catalogo`), sin detalle de cupón, envío ni sugeridos |

## Dos trampas que rompen la tienda o regalan plata

1. **Columna nueva en `configuracion_pos` que lee el catálogo = GRANT a `anon` en la
   MISMA migración**, y sumarla a `COLUMNAS_CONFIG_PUBLICA`
   (`shared/lib/columnas-publicas.ts`). Si no, PostgREST devuelve 403 y **la tienda se
   cae entera** (ver `docs/seguridad.md`). Guard en la migración con
   `has_column_privilege`.
2. **`anon` lee TODAS las promociones activas** (policy `promociones_select_anon`:
   `activa = true`) y el carrito las aplica solas. Un cupón cargado como promo común
   se aplicaría sin que nadie escriba el código, y cualquiera lo leería con un curl.
   Ver épica M3.

## Orden sugerido

M1 → M2 → M5 → M4 → M3. M1 y M2 son chicas y se ven enseguida; M5 mide si sirven;
M4 y M3 son las grandes.

## Implementación y revisión local (7/10/2026)

- Migraciones nuevas: `20261007180000_catalogo_envio_gratis`,
  `20261007190000_catalogo_marketing_medicion`, `20261007200000_catalogo_cupones` y
  candidata `20261007210000_catalogo_sugerencias`, con reversiones homónimas.
  **Aplicar antes del código**: `COLUMNAS_CONFIG_PUBLICA` pide las columnas nuevas
  y un backend anterior todavía no puede servir ese select. M5 requiere la Fase 0
  (`20261007150000`) aplicada. M4 sigue pendiente de aprobar su costo real.
- Envío: umbrales sobre mercadería después de promociones; basta un criterio;
  una línea fraccionada cuenta un producto. Retiro no recibe envío gratis.
  LOCAL no promete gratuidad en una localidad lejana. UI y WhatsApp reciben la
  misma cuenta. La configuración vacía guarda null.
- Cupones: normalización compartida con el CHECK/trigger SQL, validación anónima
  por tenant, 30 fallos consecutivos bloquean 5 minutos (contador privado con
  bloqueo transaccional). No enumera códigos ni sus relaciones. Al reabrir el
  carrito revalida el cupón persistido; cambiar de comercio no lo reutiliza.
  Respeta el cálculo y la selección existentes de promociones, sin sumar un
  segundo descuento independiente. Una reversión desactiva cupones antes de quitar
  el código para que no se conviertan en promociones automáticas.
- El POS etiqueta códigos y sigue recalculando el descuento con
  `shared/lib/descuento-promocion.ts` desde `create-sale`. `registrar_venta` sigue
  incrementando usos al cobrar; aplicar un cupón en el catálogo no consume usos.
- M4 candidata: solo IDs, publicados y stock canónico; excluye carrito, otro
  negocio, anuladas y renglones totalmente devueltos. Fallback por más vendido y
  `categoria_id`. Reusa el índice público; sin precio/costo/ventas adicionales al
  navegador. Producto simple se agrega; variante o fraccionado abre ficha, con
  origen de sugerencia conservado al agregar para M5. No implementa accesorios.
- M5 guarda flags/código y cantidad de renglones sugeridos, sin datos personales.
  El cambio de firma se arma desde `pg_get_functiondef` **vivo al aplicar**, con
  guards de reemplazo único y DROP explícito de la anterior; la reversión también
  preserva el resto del cuerpo vivo. Métricas por cliente en 30 días, excluyendo
  demo/bajas, con porcentaje y ticket con/sin cada beneficio; no mide conversión.
- Verificación SQL reproducible: `scripts/verificar-catalogo-marketing.mjs` con
  PostgreSQL temporal (PGlite): aislamiento como `anon` y header real,
  ocultamiento de códigos, vigencia, rate limit, sugerencias sin ventas expuestas,
  compatibilidad con firma anterior, métricas y reversión exacta de funciones.
- Medición M4 pendiente: `node scripts/medir-sugerencias-carrito.mjs` genera
  SELECT/EXPLAIN del **mismo cuerpo candidato**, sin instalar la RPC, para carrito
  vacío y tres productos frecuentes (dos ejecuciones). Transacción READ ONLY,
  timeout 15 s. Registrar Execution Time y buffers en la conexión de producción.
  En esta sesión solo se encontró el conector `evens-project` en `.mcp.json`, sin
  herramientas SQL disponibles; **no se inventó un tiempo ni se eligió cache**.
- Revisión visual usa componentes reales con datos ficticios porque la base real
  todavía no tiene estos cambios aplicados. Mobile real (teclado/safe areas)
  requiere prueba en teléfono. M6 y accesorios manuales siguen fuera del alcance.
  A 390/768/1440 px se verificaron 0 desborde horizontal, panel de 390/440/480 px,
  CTA del carrito vacío visible, botones de al menos 44 px y cuenta con cupón +
  envío gratis. El modal usa Radix para foco, Escape y bloqueo del fondo.
  Validación final: TypeScript sin errores, suite completa de 185 archivos /
  2.009 tests y harness PostgreSQL temporal aprobados. No hay smoke en producción:
  las migraciones siguen sin aplicarse.

---

## M1. Carrito más ancho y carrito vacío con salida

**Archivos**: `features/store/components/cart-panel-publico.tsx`,
`cart-paso-productos.tsx`.

**M1-T1. Ancho**
- Pasar de `sm:w-100` a `sm:w-[440px] lg:w-[480px]`; en el celular sigue a pantalla
  completa. Revisar que `CartItemRow` (compartido con el POS,
  `shared/components/cart-sidebar/cart-item-row.tsx`) no se rompa: si hay que tocarlo,
  que el POS quede igual.
- Aceptación: a 390 px, 768 px y 1440 px no hay scroll horizontal y los botones
  miden 44 px.

**M1-T2. Carrito vacío con CTA**
- Texto: "Tu carrito está vacío" + una línea ("Mirá lo que hay y agregá lo que te
  guste").
- Botón principal "Ver productos": cierra el panel y, si no se está en la portada,
  navega al catálogo (`useLinkCatalogo`).
- Si hay promociones con `mostrar_en_catalogo` (ya llegan por
  `useDescuentosPago()`), un segundo botón o un aviso con la promo ("10% OFF pagando
  en efectivo").
- Cuando exista M4: debajo, "Lo más vendido" con 4 productos.
- Aceptación: con el carrito vacío siempre hay una acción visible sin scrollear.

---

## M2. Envío gratis desde un monto o unidades, con barra de progreso

**Leer antes**: `shared/lib/totales-pedido-publico.ts` (el ÚNICO lugar donde se
calcula el total del catálogo), `cart-panel-publico.tsx` (`envioInfo`),
`features/catalog/ui/catalog-panel.tsx`.

**M2-T1. Config (migración)**
- `configuracion_pos.envio_gratis_desde_monto numeric null` y
  `envio_gratis_desde_unidades numeric null`. **`null` = no hay envío gratis** por
  ese criterio (no 0). CHECK `> 0` cuando no es null.
- `envio_gratis_alcance text not null default 'LOCAL'` con CHECK in
  (`'LOCAL'`, `'TODOS'`): LOCAL = solo donde hoy hay costo conocido (misma localidad
  del negocio); TODOS = también lo "a convenir".
- **GRANT SELECT de las tres a `anon` en la misma migración**, guard con
  `has_column_privilege`, y sumarlas a `COLUMNAS_CONFIG_PUBLICA`. Reversión.

**M2-T2. Cálculo (lógica pura + tests)**
- En `totales-pedido-publico.ts`: `progresoEnvioGratis({ items, base, config })` →
  `{ aplica, alcanzado, faltaMonto, faltaUnidades, porcentaje }`.
- Monto: sobre la BASE (subtotal − descuento), sin recargo ni envío: es lo que paga
  por la mercadería.
- Unidades: suma de cantidades de productos por UNIDAD; un producto por peso cuenta 1
  por renglón (0,750 kg no son "0,75 unidades").
- Con los dos criterios cargados, alcanza con cumplir uno; la barra muestra el más
  cercano.
- `calcularTotalesPedido` pone el envío en 0 cuando se alcanza (según el alcance) y
  agrega el renglón "Envío gratis".
- Tests: sin config, solo monto, solo unidades, los dos, con descuento, producto por
  peso, LOCAL contra TODOS.

**M2-T3. Barra en el carrito**
- En el paso de productos y en el de datos: "Te faltan $3.500 para el envío gratis"
  o "Te faltan 2 productos…" con una barra que se llena; al llegar, "¡Tenés envío
  gratis!".
- `role="progressbar"` con `aria-valuenow`. Sin animaciones si
  `prefers-reduced-motion`.
- El mensaje de WhatsApp dice "Envío: gratis".

**M2-T4. Configuración para el dueño**
- En la sección de envío de `catalog-panel.tsx`: "Envío gratis desde $___" y/o
  "desde ___ productos", y el alcance.
- Aceptación: el dueño lo configura, la clienta ve la barra, y el total y el mensaje
  coinciden.

---

## M3. Código de descuento (cupones)

Es la épica más delicada: toca promociones, que también usa el POS.

**Leer antes**: `docs/ventas.md` (promociones y descuento recalculado en el server),
`features/promotions/`, `shared/components/cart-sidebar/cart-sidebar-utils.ts`
(`getPromocionesElegibles`, `calcularDescuentoCarritoPublico`),
`features/sales/lib/descuento-promocion.ts` (lo que recalcula create-sale).

**M3-T1. Modelo y aislamiento (migración)**
- `promociones.codigo text null`. `null` = promo automática (lo de hoy). Normalizado:
  mayúsculas, sin espacios, 4 a 20 caracteres `[A-Z0-9]`. Índice único
  `(negocio_id, codigo)` donde `codigo is not null`. Espejo TS de la normalización con
  tests.
- **Cerrar el cupón para `anon`**: cambiar `promociones_select_anon` a
  `activa = true and codigo is null`, y NO darle `codigo` a `anon`. Guard de que un
  promo con código no es visible para `anon` (probarlo con `set local role anon` y el
  header `x-negocio-slug`).
- RPC `validar_cupon_catalogo(p_codigo text)`: SECURITY DEFINER para `anon`,
  negocio desde `security.negocio_publico()`. Devuelve la promo (mismas columnas
  públicas que `PromocionDB`) solo si está activa, dentro de fechas y con
  `usos_actuales < limite_usos` (o sin límite). No distingue "no existe" de "venció"
  (no sirve para adivinar códigos). Tope de intentos: si hay muchos fallidos seguidos
  para el negocio, devuelve vacío un rato.

**M3-T2. El carrito**
- "¿Tenés un código de descuento?" en el paso de productos: input + "Aplicar". Al
  validar, la promo entra a la MISMA cuenta que las automáticas (respetando
  `acumulable`, `prioridad` y `monto_minimo`), con un chip "VERANO10 · −$1.500" para
  quitarlo.
- Errores: "Ese código no es válido o ya venció". Si existe pero no aplica por monto
  mínimo: "Te faltan $X para usar VERANO10".
- Guardado en el store del carrito (sobrevive a recargar la página).
- El mensaje de WhatsApp dice el código y el descuento: la caja lo tiene que poder
  aplicar.

**M3-T3. El POS y la administración**
- Alta y edición de promoción: campo "Código (opcional)", con el error de
  repetido en palabras ("Ya tenés una promoción con ese código").
- En el POS, una promo con código se elige como cualquier otra pero se muestra con su
  código, para que la caja aplique el del mensaje. create-sale ya recalcula el
  descuento en el server y `registrar_venta` suma `usos_actuales`: verificar que
  siga así.
- Límite conocido: sin órdenes guardadas (ver `docs/tienda-online.md`) el uso se
  cuenta cuando la caja cobra, no cuando la clienta aplica el código.

---

## M4. "Completá tu compra": productos sugeridos en el carrito

**M4-T1. De dónde salen (medir antes de decidir)**
- Fuente automática: **lo que se compra junto en el POS**. Productos que aparecen en
  las mismas ventas que los del carrito, últimos 180 días, sin anuladas.
- RPC `sugerencias_carrito(p_producto_ids uuid[], p_limite int default 6)`: SECURITY
  DEFINER para `anon`, negocio desde `negocio_publico()`. Devuelve SOLO ids de
  productos publicados (con stock salvo `mostrar_sin_stock`), sin los del carrito,
  ordenados por cuántas veces se compraron juntos. **Nunca devuelve conteos ni
  datos de ventas** (`anon` no puede ver ventas).
- Si no alcanza (catálogo nuevo, poco POS): completar con lo más vendido del
  negocio y después con la misma categoría (`categoria_id`, no `tipo`).
- **Medir el costo de la consulta** en Librería Colores (~2.600 ventas en 30 días)
  antes de elegir entre consulta en vivo con `unstable_cache` (por negocio + ids
  ordenados, 1 h) o una tabla precalculada. Dejar el número en este documento.

**M4-T2. El carrito**
- En el paso de productos, debajo de los renglones: "Completá tu compra", carrusel
  horizontal (reusar `carrusel-horizontal.tsx`) con foto, nombre, precio (con su
  promo) y "Agregar".
- Producto sin variantes: se agrega directo. Con variantes: lleva a la ficha.
- Se lee con las columnas públicas que ya usa la grilla (`COLUMNAS_PRODUCTO_LISTA`):
  ninguna columna nueva para `anon`.
- Con el carrito vacío (M1-T2), "Lo más vendido".

**M4-T3. Opcional, después**: que el dueño elija accesorios a mano por producto
(tabla `productos_accesorios`, sin FK dura si guarda historia), que ganen sobre los
automáticos.

---

## M5. Medir si todo esto vende más

- Extender `registrar_pedido_catalogo` (`20261007150000`) con `p_cupon text default
  null`, `p_envio_gratis boolean default false` y `p_items_sugeridos int default 0`
  (cuántos renglones se agregaron desde M4; marcarlos en el store del carrito).
- **Cambiar los parámetros con `create or replace` crea una SOBRECARGA** y PostgREST
  elige a veces la vieja (`AGENTS.md`): DROP explícito de la firma vieja y guard de
  que queda una sola. Con defaults, un celular con la versión vieja cacheada sigue
  andando.
- Seguir sin guardar datos de la clienta.
- En /admincomerz › Métricas › Pedidos del catálogo (`features/admin/lib/pedidos-catalogo.ts`):
  % de pedidos con cupón, con envío gratis y con sugeridos, y su ticket promedio
  contra el resto.

---

## M6. Ideas para después (no empezar sin decidir)

- **Barra hacia una promo por monto mínimo**: `promociones.monto_minimo` ya existe;
  la misma barra de M2 puede decir "Te faltan $X para 10% OFF".
- **Píxel de Meta y Google Analytics por comercio**: que el dueño pegue su id y el
  catálogo mande vista de producto, agregado al carrito y pedido. Es lo que le pide
  quien hace publicidad.
- **Etiquetas en la tarjeta**: "Nuevo" (creado hace menos de N días), "Últimas
  unidades" (stock bajo), "Más vendido".
- **"Lo más vendido" y "Ofertas" en la portada**, con la misma fuente que M4.
- **Carrito abandonado**: necesita órdenes guardadas (Fase 1 de
  `docs/tienda-online.md`).
