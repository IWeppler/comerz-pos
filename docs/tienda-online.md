# Tienda online: orden, "venta realizada" y Mercado Pago

Estado: **Fase 0 (medición) en producción desde el 7/10/2026; el resto, plan no
empezado.** Leelo antes de tocar el carrito público (`features/store/`), los
pedidos del catálogo o cualquier cobro online.

## Qué se quiere

Que el catálogo funcione como Tiendanube: la clienta compra (y, si el comercio lo
activó, paga con Mercado Pago) y a la dueña le llega al celular **"¡Venta
realizada! Orden #00123 · $45.000"** con el logo de Comerz. La competencia ya tiene
una app nativa con esto.

## Cómo está hoy

- El carrito público (`cart-panel-publico.tsx`) calcula el total en un solo lugar
  (`shared/lib/totales-pedido-publico.ts`), pide nombre, entrega y medio de pago, y
  abre WhatsApp (`wa.me`) desde el teléfono de la clienta. **El pedido no queda en
  Comerz**: ni orden, ni cliente, ni número.
- Los 14 comercios tienen `catalogo_activo` y `pedidos_whatsapp` prendidos.
- `anon` solo puede escribir `solicitudes_comercio` y, desde la Fase 0, llamar a
  `registrar_pedido_catalogo` (ver [seguridad.md](seguridad.md)).

## Decisiones tomadas (7/10/2026)

- **Mercado Pago es la única pasarela.** Cada comercio conecta SU cuenta (OAuth): la
  plata entra directo a él, Comerz no la toca.
- **Comerz no cobra comisión por venta online.**
- **Disponible en todos los planes.**
- **Facturación manual**: una venta web pagada no emite factura sola.
- Número de orden: **serie propia por negocio, simple** ("Orden #00123"). NO el
  formato fiscal "00001-00000018": se confundiría con una factura.

## Fases

### Fase 0: medir (HECHA, `20261007150000`)

- Cada "Enviar pedido" del catálogo llama a `registrar_pedido_catalogo` (sin await,
  antes del `window.open`: abrir WhatsApp después de un await lo bloquea como popup).
  Guarda en `eventos_uso` (tipo `PEDIDO_CATALOGO`) total, renglones, unidades,
  modalidad y medio de pago. **Ningún dato de la clienta.**
- SECURITY DEFINER para `anon`; el negocio sale de `security.negocio_publico()`, nunca
  de un parámetro. Ignora valores fuera de rango y más de 20 por minuto por negocio.
  Nunca tira error.
- Se lee en **/admincomerz › Métricas › Pedidos del catálogo**
  (`metricas_pedidos_catalogo`, solo super admin; resumen en
  `features/admin/lib/pedidos-catalogo.ts`): total, 7 y 30 días, monto, ticket
  promedio, por comercio, pedidos cada 100 ventas del POS, entrega y medio de pago.
- Límites del número: un pedido es "tocó Enviar y abrió WhatsApp", puede no
  concretarse, y las pruebas de la dueña también cuentan.
- Marketing (cambio local pendiente de aplicar, `20261007190000`): amplía el evento
  con cupón, envío gratis y renglones sugeridos, sin datos de la clienta. Compara
  porcentajes y ticket promedio con/sin cada beneficio. La firma anterior se
  elimina explícitamente y los argumentos nuevos tienen defaults para celulares
  con código anterior. Estado en [catalogo-marketing.md](catalogo-marketing.md).
- **Criterio para seguir**: mirar 2–4 semanas. Si casi nadie pide por el catálogo, la
  tienda online es una apuesta comercial (atraer comercios), no un pedido de los
  actuales; decidirlo con el número.

### Fase 1: la orden existe en Comerz

- Tabla propia (`ordenes_tienda` o similar), NO `pedidos`: aquella exige
  `vendedor_id`, su ciclo es POR_COBRAR/COBRADO y no guarda datos de una clienta
  anónima. Reusar de `pedidos` el broadcast privado por negocio
  (`use-pedidos-realtime.ts`) y la carga del carrito en la caja.
- Alta por **server action + RPC**: límite por IP en la action, campo trampa,
  precios y descuentos RECALCULADOS en la base (nunca los del navegador), órdenes
  impagas que vencen. El catálogo es anónimo: cualquiera puede llamarla con un curl.
- El carrito pide **teléfono** (hoy no, porque WhatsApp lo trae).
- Confirmación: "Orden #00123 recibida" + botón "Avisar por WhatsApp" (segundo toque:
  el `window.open` no puede ir después del await del guardado).
- Panel: aviso en tiempo real, contador en el menú, sonido, lista de órdenes con
  estados (Nueva → Confirmada → Lista → Entregada / Cancelada), contestar por
  WhatsApp y "Cobrar" en el POS (venta vinculada a la orden).
- Stock: sin reservar al principio; la orden muestra si alcanza.

### Fase 2: la notificación "Venta realizada"

- **Web Push** desde la PWA: manejador `push` en el service worker (hoy `public/sw.js`
  solo cachea; next-pwa admite un worker propio), claves VAPID, tabla de
  suscripciones por usuario y dispositivo, envío desde el server al crear o pagar la
  orden. Ícono y logo de Comerz.
- Funciona en Android y en computadora; en iPhone solo con Comerz instalado en la
  pantalla de inicio (iOS 16.4+).
- Un módulo único de envío ("notificar venta") para que la Fase 4 sume tokens de la
  app sin tocar el resto.
- Quién recibe: permiso nuevo (fila en `permisos` + `rol_permisos`, ver
  [seguridad.md](seguridad.md)).

### Fase 3: Mercado Pago (toca plata: auditoría propia ANTES de escribir código)

- OAuth por comercio; tokens guardados cifrados y fuera del alcance de `anon` y de los
  roles sin permiso. Checkout Pro.
- **Webhook** (ruta de Next): verifica la firma de MP, idempotente por id de pago. La
  "venta realizada" se dispara cuando MP dice aprobado, nunca por el regreso de la
  clienta a la página.
- **Venta de origen web**: hoy `create-sale` exige usuario y, según la config, caja
  abierta. Una venta pagada a las 3 de la mañana no tiene ni vendedor ni turno. Hay
  que definir la venta sin turno (el pago digital no pasa por el cajón) y con vendedor
  de sistema o nulo, y revisar arqueo, reportes por vendedor y panel. Lee
  [ventas.md](ventas.md) y [caja-y-dinero.md](caja-y-dinero.md).
- Método de pago "Mercado Pago (online)" con cuenta destino y `acreditacion_dias`:
  entra al circuito existente de cuentas y del puente `POR_ACREDITAR`.
- **Stock**: reservar al entrar al pago, con vencimiento (~30 min), usando
  `reservas`; descontar al aprobar; liberar si vence o se rechaza. Sin eso se vende
  dos veces la última unidad.
- Sin pasarela (retiro o transferencia): la orden nace "pendiente de pago" y se
  convierte en venta al cobrarla en el POS.

### Fase 4: app en las tiendas

- Envoltorio Capacitor o Expo (WebView) sobre la app actual: push nativo confiable
  en iPhone, ícono y presencia en App Store / Google Play. US$99/año Apple + US$25
  Google, más la revisión de las tiendas.
- NO reescribir en React Native: sería un segundo producto para mantener.
