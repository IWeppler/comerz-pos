# Pagos en el checkout: auditoría T0 (12/10/2026)

Estado: **aprobada por Nacho el 12/10/2026, con estos cambios a la propuesta:**
- Se sigue ya, sin esperar el corte de la Fase 0.
- El stock se descuenta al crear la orden y la orden pagada se cobra desde el POS.
- **Sin `pg_cron` por ahora**: el vencimiento es manual/perezoso (al leer la orden y
  la lista). Queda anotado en [pagos-stopgaps.md](pagos-stopgaps.md) como `pg_cron`
  cada **10 min**. Donde abajo dice "pg_cron cada 5 min", vale esto.
- **Transferencia vence en 2 h por defecto** (configurable de 30 min a 24 h), no 48 h.
  Mercado Pago, 60 min. Con plazos así, Rapipago/Pago Fácil (`ticket`, `atm`) quedan
  excluidos de la preference.

T1 (modelo de datos), **aplicada en producción el 12/10/2026** (versión `20261012133049`): `supabase/migrations/20261012133049_tienda_ordenes_y_pagos.sql`,
reversión en `supabase/reversals/`, test de RLS en `supabase/tests/pagos_rls.sql`.

Complementa [tienda-online.md](tienda-online.md) (Fases 1 y 3), que ya tenía
decisiones tomadas el 7/10; donde esta épica y ese plan chocan, está marcado.

---

## 1. Resumen: la recomendación en diez líneas

1. **La épica es en realidad Fase 1 + Fase 3 de tienda-online.md juntas.** Hoy el
   pedido del catálogo NO existe en Comerz (solo WhatsApp + un evento de métrica).
   Antes de cobrar hay que tener la orden: T1/T4 la crean.
2. **El descuento por transferencia ya existe**: es una promoción `METODO_PAGO` con
   `TRANSFERENCIA`, que el carrito público y `create-sale.ts` ya calculan con el mismo
   módulo. No crear un "% de descuento" paralelo (sería un segundo criterio de plata).
3. **Los datos de transferencia ya existen a medias**: `configuracion_pos.alias_transferencia`
   (alias o CBU/CVU, con CHECK y validador). Sumar titular y banco ahí, no en otra tabla.
4. **Tokens de MP: cifrado en la app (AES-256-GCM), mismo patrón que ARCA**
   (`features/arca/lib/cifrado.ts` + tabla sin policies, solo service_role). Vault
   está instalado pero sin uso (0 secretos); no conviene estrenarlo acá.
5. **Stock: descontar al crear la orden** con `ajustar_stock_variante` (UPDATE
   condicional = no hay sobreventa) y devolverlo al vencer. Origen nuevo en
   `movimientos_stock`. La tabla `reservas` NO sirve (ver §3.6).
6. **Pagada ≠ venta.** Una orden pagada se convierte en venta desde el POS ("Cobrar
   orden"), con el stock ya descontado y el cobro forzado al medio y monto de la orden.
   La venta automática por webhook (sin vendedor ni turno) queda como STOPGAP para
   después: toca ventas, caja, arqueo y facturación a la vez.
7. **MP: Checkout Pro por preferences + OAuth con PKCE**. "Cuotas sin tarjeta" =
   la misma preference con `purpose: "onboarding_credits"` (preselecciona el crédito,
   no lo fuerza). El medio real lo dice el pago, no el botón.
8. **Webhook**: firma HMAC de `x-signature`, después `GET /v1/payments/{id}` con el
   token del comercio, chequeo de monto/moneda/`collector`, y RPC idempotente.
9. **Jobs: no hay ninguno hoy** (ni pg_cron ni crons de Vercel). Propuesta:
   vencimiento perezoso (al leer) + `pg_cron` cada 5 min para devolver stock;
   refresh de token perezoso (vence a los 180 días, no hace falta job).
10. **Feature flag: NO usar `tieneFeature`** (devuelve `true` sin plan cargado, o sea
    prendería pagos en comercios sin plan). Flag explícito, opt-in.

**Antes de empezar, una alarma de producto**: la Fase 0 mide 2 pedidos del catálogo en
5 días entre los 14 comercios (ticket ~$52.000). El criterio acordado el 7/10 era
mirar 2–4 semanas antes de decidir. Esta épica son ~4 semanas de trabajo; si se sigue
igual, que sea como apuesta comercial (atraer comercios) y sabiéndolo.

---

## 2. Flujo recomendado, de punta a punta

```
CATÁLOGO (anon, *.comerz.app)
 1. Carrito → paso 2: nombre, TELÉFONO (nuevo), entrega, medio:
      Transferencia · Mercado Pago (tarjeta o saldo) · Cuotas sin tarjeta
    (MP solo si el comercio tiene conexión ACTIVA y el flag prendido)
 2. Server action crearOrdenTienda (rate limit por IP + campo trampa)
    → RPC crear_orden_tienda (DEFINER, negocio desde security.negocio_publico()):
      - recalcula precios (variante ?? producto), promos, recargo y envío desde la base
      - descuenta stock por variante (ajustar_stock_variante, origen ORDEN_TIENDA)
        → si una variante no alcanza: falla con los nombres, nada escrito
      - numero = serie propia por negocio ("Orden #00123")
      - estado PENDIENTE_PAGO, vence_en = ahora + plazo del medio
      - devuelve id + token_publico (no adivinable)

TRANSFERENCIA                              MERCADO PAGO
 3a. /orden/[token]: número, total,         3b. Server action crearPreferencia(orden)
     alias/CBU/titular/banco, botón             - lee conexión, refresh perezoso si vence en <30 días
     "Mandar comprobante por WhatsApp"           - una sola preference viva por orden (reusa si existe)
 4a. Panel: Órdenes › Pendientes                 - external_reference = orden.id
     "Cobrar" → POS con la orden cargada          - notification_url = app.comerz.app/api/mercadopago/webhook?n=<negocio>
     → venta normal (método TRANSFERENCIA,       - back_urls → <slug>.comerz.app/orden/[token]
       stock ya descontado)                        - expiration_date_to = vence_en
     → orden PAGADA + payment_event MANUAL       - purpose = onboarding_credits si eligió cuotas
                                                → redirect a init_point
                                              4b. Webhook: firma → GET pago con token del comercio
                                                  → valida collector_id, monto, moneda
                                                  → RPC aplicar_pago_mp (idempotente por payment.id)
                                                  → orden PAGADA / RECHAZADA / EN_PROCESO / REEMBOLSADA
                                              5b. /orden/[token]: lee el estado de la base
                                                  ("Estamos confirmando tu pago" si no llegó)
                                              6b. Panel: "Cobrar" → POS con método
                                                  "Mercado Pago online" (monto forzado, sin cajón)

VENCIMIENTO (pg_cron cada 5 min + perezoso al leer la orden)
 - PENDIENTE_PAGO con vence_en < now() → VENCIDA, stock devuelto (origen ORDEN_TIENDA_VENCIDA)
 - un pago aprobado que llega DESPUÉS de vencer → PAGADA_SIN_STOCK (alerta al comercio, no se
   re-descuenta sola: el comercio decide si entrega o devuelve desde MP)
```

---

## 3. Lo que hay hoy en el repo

### 3.1 Catálogo y WhatsApp: no hay orden
- `features/store/components/cart-panel-publico.tsx`: carrito en dos pasos (productos
  → datos). Total calculado en UN lugar, `shared/lib/totales-pedido-publico.ts`
  (puro, con tests): `subtotal − descuento → recargo sobre la base → + envío`.
- "Enviar pedido" abre `wa.me` y llama `registrar_pedido_catalogo` (solo métrica en
  `eventos_uso`, sin datos de la clienta). **No hay número, ni orden, ni cliente.**
- `pedidos` existe pero es otra cosa: comanda interna vendedora → caja
  (`vendedor_id` obligatorio, ciclo POR_COBRAR/COBRADO). tienda-online.md ya decidió
  no reusarla; se reusan su broadcast realtime (`use-pedidos-realtime.ts`) y la carga
  del carrito en el POS (`create-sale.ts` ya acepta un pedido y hereda el vendedor).
- Medios en el catálogo: uno por TIPO (`opciones-pago-publicas.ts`), con el recargo
  más alto del tipo. Hoy: 14 negocios con EFECTIVO, 11 TRANSFERENCIA, 12 TARJETA, 13
  BILLETERA_VIRTUAL. 3 promos `METODO_PAGO` activas.

### 3.2 Ventas, montos y estados
- Montos en **`numeric` en pesos, redondeo al peso** (no centavos enteros). Estados
  en **texto MAYÚSCULA** (`POR_COBRAR`, `ACTIVA`, `CONFIRMADA`). La épica dice
  `pendiente_de_pago`: usar `PENDIENTE_PAGO` por convención.
- La venta es una transacción: `registrar_venta` (INVOKER, con la RLS de quien vende);
  el stock se descuenta afuera con `ajustar_stock_variante` y se compensa si falla.
- `venta_pagos` = plata que entró; el ledger (`movimientos_financieros`) se arma por
  trigger y un método digital va a su cuenta destino o al puente `POR_ACREDITAR`
  según `acreditacion_dias`.
- `create-sale.ts` tiene ~1.900 líneas atadas a una sesión (usuario, turno,
  `requiere_caja_abierta`, IMEI, facturación). **Llamarla desde un webhook no es
  posible** sin reescribir media venta: por eso la conversión va por el POS (§1.6).

### 3.3 Tenant, middleware y RLS
- Catálogo: slug por subdominio (`*.comerz.app`) o `/store/[slug]`; el middleware
  reescribe `x-negocio-slug` siempre y la base resuelve `security.negocio_publico()`.
- Panel: `app.comerz.app`, cookie `negocio_activo_id` → header `x-negocio-activo`,
  validado contra `usuarios_negocios`.
- **`/api/*` está excluido del matcher del middleware**: el webhook y el callback de
  OAuth no pasan por sesión ni por el ruteo de tienda. Bien.
- **Ojo**: en un subdominio de tienda todo path de primer nivel es un producto.
  `/orden/[token]` necesita su lugar en `decidirRuteo` (`shared/lib/ruteo-host.ts`),
  o la página de retorno de MP da 404 de catálogo.
- `anon` nace cerrado (default privileges); todo lo que escriba el catálogo va por
  RPC DEFINER con el negocio sacado del header, nunca de un parámetro.

### 3.4 Secretos por comercio
- **Precedente: ARCA.** Clave privada por negocio en `arca_credenciales`, cifrada en
  la app con AES-256-GCM (`ARCA_CLAVE_CIFRADO`, formato `v1:iv:tag:cifrado`), tabla
  sin policies y acceso solo por service_role (`features/arca/lib/credenciales.ts`).
- Vault (`supabase_vault` 0.3.1) instalado, **0 secretos**. pgsodium no está.
- **Recomendación: el mismo patrón que ARCA** con su propia clave (`MP_CLAVE_CIFRADO`),
  generalizando `cifrado.ts` a `shared/lib/cifrado.ts` con la clave por parámetro.
  Ventajas: un dump de la base no descifra nada (la clave no está en la base, cosa
  que con Vault sí pasa), ya tiene tests y es un patrón que el equipo conoce.

### 3.5 Jobs programados
- **No existe ninguno.** `vercel.json` solo fija `cle1`; no hay `crons`, no hay
  `pg_cron` ni `pg_net`. El precedente es perezoso: `acreditar_cobros_vencidos()` "la
  dispara la lectura de la pestaña Dinero: no hay cron".
- El vencimiento de órdenes NO puede ser solo perezoso: el stock retenido de una orden
  que nadie vuelve a mirar queda descontado para siempre. Recomendación:
  **habilitar `pg_cron`** (corre dentro de la base, sin HTTP ni secretos, no depende
  del plan de Vercel) con `vencer_ordenes_tienda()` cada 5 min, + vencimiento
  perezoso al leer la orden para que la clienta nunca vea un estado viejo.
- Refresh de tokens: con 180 días de vida, **perezoso al usar** (si vence en < 30 días,
  renovar antes de crear la preference). Sin job. Si no se usa en 180 días, queda
  `REQUIERE_RECONEXION` y se avisa en Cobros.

### 3.6 Stock: por qué no `reservas`
- `reservas` es el "apartado" de indumentaria del POS: una fila por unidad, sin
  cantidad, sin vencimiento, valida con un SELECT previo (no transaccional: dos
  compradores leen lo mismo) y solo para el rubro indumentaria. Hoy: 4 activas.
- `ajustar_stock_variante` ya es el UPDATE atómico condicional por `variante_id`, y
  `movimientos_stock` registra por trigger con el origen declarado
  (`comerz.origen_movimiento`). Descontar al crear la orden da, gratis:
  imposibilidad de sobreventa, trazabilidad, y que POS y catálogo vean el mismo
  número sin tocar sus lecturas.
- Costo: la conversión a venta tiene que saber que el stock ya salió (no
  descontarlo dos veces) y el espejo `productos_stock` se mueve en el mismo paso que
  la variante (`ajustar_stock_legacy`). Es un punto de `create-sale.ts` +
  `registrar_venta`: leer [ventas.md](ventas.md) y [stock-y-catalogo.md](stock-y-catalogo.md).
- `permitir_venta_sin_stock`: la orden online respeta el stock SIEMPRE, aunque el POS
  del comercio lo permita (no hay vendedora para decir "no hay").

---

## 4. Mercado Pago (verificado en la documentación oficial, 12/10/2026)

### 4.1 OAuth
- Autorización: `https://auth.mercadopago.com/authorization?client_id=…&response_type=code&platform_id=mp&state=…&redirect_uri=…`
  (redirect_uri estática, registrada en la app).
- **PKCE soportado y recomendado**: `code_challenge` + `code_challenge_method=S256`,
  `code_verifier` de 43–128 caracteres. Hay que activarlo en la configuración de la app.
- Token: `POST /oauth/token` con `grant_type=authorization_code` (+ `code_verifier`).
  Respuesta: `access_token`, `token_type: bearer`, `expires_in: 15552000` (**180
  días**), `scope: offline_access read write`, `user_id`, `refresh_token`.
- Refresh: `grant_type=refresh_token`; **cada refresh devuelve un refresh_token
  nuevo** que hay que guardar en la misma escritura (si se pierde, hay que reconectar).
  → El refresh se hace con un lock por conexión (`select … for update`) para que dos
  checkouts simultáneos no lo quemen dos veces.
- `user_id` identifica la cuenta del comercio: es la clave de "reconectar no duplica"
  (unique por `negocio_id`; si cambia el `user_id`, se reemplaza y queda en el log).

### 4.2 Preference (Checkout Pro)
- Se crea con el **access_token del comercio** → el cobro es suyo, Comerz no toca la
  plata (decisión del 7/10).
- `external_reference` = `orden.id`; `notification_url` por preference **tiene
  prioridad** sobre la configurada en el panel de la app; `back_urls` +
  `auto_return: approved`; `expires: true` + `expiration_date_to` = vencimiento de la
  orden; `statement_descriptor` con el nombre del comercio.
- Hay una API nueva (Checkout Pro vía *Orders*), pero preferences sigue documentada y
  vigente. Usar preferences: es lo que tiene ejemplos, webhooks `payment` y
  `purpose`.
- `marketplace_fee`: solo existe en el modelo marketplace OAuth. Hoy no se cobra
  (decisión del 7/10); la puerta queda abierta porque la preference ya se crea con el
  token del vendedor. Si un día se cobra: el fee lo descuenta MP del cobro y lo
  acredita a la cuenta de Comerz; implica factura de Comerz al comercio.

### 4.3 "Cuotas sin tarjeta" (Mercado Crédito)
- Solo existe dentro de Checkout Pro, con la clienta logueada en MP; ella elige hasta
  12 cuotas fijas y **el comercio recibe el total**.
- Se ofrece con `purpose: "onboarding_credits"`: al loguearse la clienta ve el crédito
  **preseleccionado**. NO es exclusivo: puede cambiar a tarjeta o saldo.
- **No se puede forzar solo crédito ni saber de antemano si la clienta califica** (el
  cupo es de ella). Por eso la recomendación: dos botones en la UI que crean la
  MISMA preference, con y sin `purpose`; el medio real se lee del pago
  (`payment_method_id` / `payment_type_id`). Según la referencia de medios de MP el
  crédito llega como `consumer_credits` — **confirmarlo con un pago de sandbox en T6**,
  no codificar reglas sobre ese valor antes.
- "Tarjetas guardadas o saldo": es el Checkout Pro normal; no excluir nada.
  Excluir tipos (`excluded_payment_types`) solo si el comercio lo pide (p. ej. sacar
  `ticket` = Rapipago/Pago Fácil, que deja la orden pendiente días y retiene stock:
  **recomiendo excluir `ticket` y `atm` por defecto** con vencimientos cortos).

### 4.4 Webhook
- Payload: `{ action: "payment.updated", type: "payment", data: { id }, live_mode,
  user_id }`. **No trae el estado**: siempre `GET /v1/payments/{id}` con el token del
  comercio.
- Firma: header `x-signature: ts=…,v1=…` + `x-request-id`. Manifest:
  `id:[data.id del query, en minúscula];request-id:[x-request-id];ts:[ts];`, HMAC-SHA256
  con la clave secreta de la app. Si falta `data.id` o `x-request-id`, se omiten del
  manifest. Comparar en tiempo constante y rechazar `ts` viejos (tolerancia propia,
  propongo 10 min).
- Respuesta: **200/201 dentro de 22 s**; si no, MP reintenta cada 15 min y después
  con intervalos más largos. → Hacer el trabajo dentro del request (un GET + una RPC
  entra holgado en 22 s desde `cle1`) y devolver 5xx ante error transitorio para que
  MP reintente. No hace falta cola.
- Resolver el comercio: `external_reference` → orden → negocio; **cruzar con
  `user_id` del payload y `collector_id` del pago** contra la conexión guardada. Si no
  coinciden, no se aplica y queda alertado.
- Riesgo a verificar en sandbox (T7): que las notificaciones de pagos creados con el
  token del vendedor lleguen firmadas con la clave de la app de Comerz. Es lo que dice
  la documentación para OAuth, pero hay que verlo con un pago real de prueba.

### 4.5 Estados de pago → estado de orden

| `payment.status` | Orden | Stock |
|---|---|---|
| `approved` (monto y moneda = orden) | `PAGADA` | queda descontado |
| `approved` con monto ≠ orden o `currency_id` ≠ ARS | `REVISAR` + alerta | queda retenido |
| `pending`, `in_process`, `authorized` | `EN_PROCESO` (no vence mientras) | retenido |
| `rejected`, `cancelled` | sigue `PENDIENTE_PAGO` (puede reintentar hasta `vence_en`) | retenido hasta vencer |
| `refunded` | `REEMBOLSADA` | NO vuelve solo (la mercadería puede haberse entregado: lo decide el comercio) |
| `charged_back` | `CONTRACARGO` + alerta | idem |
| `in_mediation` | `EN_DISPUTA` + alerta | idem |

Un pago `approved` sobre una orden ya `PAGADA` por otro pago (dos pestañas) →
`PAGO_DUPLICADO` en el log + alerta; no se toca la orden.

---

## 5. Modelo de datos propuesto (T1)

Nombres en castellano como el resto del schema. Todas con `negocio_id` DEFAULT
`security.current_negocio_id()`, policy RESTRICTIVE con subselect, índices por FK
empezando por `negocio_id` (ver [seguridad.md](seguridad.md)).

- **`ordenes_tienda`**: `id`, `negocio_id`, `numero` (serie por negocio, unique
  `(negocio_id, numero)`), `token_publico` (unique, 32 bytes), `estado`
  (`PENDIENTE_PAGO | EN_PROCESO | PAGADA | REVISAR | VENCIDA | CANCELADA | REEMBOLSADA |
  CONTRACARGO | EN_DISPUTA | PAGADA_SIN_STOCK | ENTREGADA`, CHECK), `medio`
  (`TRANSFERENCIA | MP_CHECKOUT | MP_CREDITO`), `cliente_nombre`, `cliente_telefono`,
  `cliente_email` (null hasta que MP lo traiga), `modalidad_entrega`, `direccion`,
  `localidad`, `nota`, `subtotal`, `descuento`, `recargo`, `envio`, `total`
  (numeric, CHECK `total = subtotal - descuento + recargo + envio`),
  `promociones_aplicadas` (jsonb congelado), `mp_preference_id`, `mp_payment_id`,
  `vence_en`, `pagada_en`, `venta_id` (null hasta cobrarla en el POS), `creado_en`.
  `anon` sin acceso directo: lee su orden con una RPC por `token_publico` (mismo
  patrón que el resumen público de CC `/r/[token]`).
- **`ordenes_tienda_items`**: `orden_id`, `producto_id`, `variante_id`, nombre y
  variante congelados, `precio_unitario`, `cantidad`, `subtotal`. INSERT atado a que
  la orden sea visible (forma de las hijas de `ventas`).
- **`eventos_pago`** (la `payment_events` de la épica): `negocio_id`, `orden_id` (sin
  FK dura, sobrevive), `origen` (`MP_WEBHOOK | MANUAL | VENCIMIENTO | SISTEMA`),
  `clave_idempotencia` **unique** (`mp:<payment_id>:<status>` / `manual:<orden_id>`),
  `mp_payment_id`, `estado_mp`, `monto`, `moneda`, `payload` (jsonb **sin datos de
  tarjeta**: solo los campos que se usan), `resultado` (`APLICADO | DUPLICADO |
  RECHAZADO_MONTO | RECHAZADO_COLLECTOR | IGNORADO`), `usuario_id`, `creado_en`.
  Append-only por RLS.
- **`mercadopago_conexiones`**: `negocio_id` **unique**, `mp_user_id`,
  `access_token_cifrado`, `refresh_token_cifrado`, `expira_en`, `estado`
  (`ACTIVA | REQUIERE_RECONEXION | DESCONECTADA`), `ultimo_error`, `conectado_en`,
  `conectado_por`. **Sin policies y sin GRANT a `anon`/`authenticated`**: solo
  service_role (igual que `arca_credenciales`). El panel lee una vista/RPC con
  `estado`, `mp_user_id` y `conectado_en`, nunca los tokens.
- **`oauth_estados_mp`**: `state` (hash), `negocio_id`, `usuario_id`, `code_verifier`
  cifrado, `expira_en` (10 min), `usado_en`. Consumo con UPDATE condicional
  (`usado_en is null and expira_en > now()`) → un state reutilizado o vencido falla.
- **Configuración**: columnas en `configuracion_pos` (ya tiene `alias_transferencia`,
  `whatsapp`, `pedidos_whatsapp`): `transferencia_titular`, `transferencia_banco`,
  `cobro_online_transferencia`, `cobro_online_mp`, `minutos_vence_transferencia`
  (default 120), `minutos_vence_mp` (default 60). **Sin columna de descuento**: es una
  promo `METODO_PAGO` (ya hay pantalla y cálculo en servidor).
- **Flag**: `negocios.pagos_online_habilitado boolean default false`, escribible solo
  por super admin (/admincomerz). No `tieneFeature` (§1.10).
- **Medio "Mercado Pago online"** en `metodos_pago`: el comercio lo crea al conectar
  (tipo `BILLETERA_VIRTUAL`, cuenta destino Mercado Pago, `acreditacion_dias` según su
  plan de MP). Necesita una marca (`solo_online boolean`) para que el carrito público
  no lo cuente como un botón más de "Billetera virtual" ni le aplique su recargo
  máximo por tipo.
- **Origen de stock**: `ORDEN_TIENDA` (descuento) y `ORDEN_TIENDA_LIBERADA` (vuelta),
  con `referencia_id = orden.id`.

Reversiones en `supabase/reversals/`; todo aditivo, ninguna columna existente cambia
de significado.

---

## 6. Riesgos y bloqueos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **Demanda no probada**: 2 pedidos de catálogo en 5 días | Decidir con Nacho si se sigue ya o se espera el corte de 2–4 semanas |
| 2 | Orden anónima que descuenta stock = un bot puede vaciar el catálogo | Rate limit por IP en la action + campo trampa + tope de órdenes pendientes por teléfono y por negocio + vencimientos cortos en MP |
| 3 | La venta online sin vendedor ni turno rompe supuestos de ventas/caja/arqueo | v1: se cobra desde el POS (STOPGAP). Venta automática = tarea propia con auditoría |
| 4 | Doble descuento de stock al cobrar la orden en el POS | `create-sale` con `orden_id`: saltea `ajustar_stock_variante` y el espejo para esos renglones; test específico |
| 5 | Productos con IMEI (`lleva_serie`) | La unidad se asigna al cobrar en el POS, como hoy. Sin cambio |
| 6 | Venta por peso / fraccionables en el carrito público | Revisar en T4 si el catálogo ya los vende; si no, quedan fuera del checkout |
| 7 | Pago aprobado después de vencer (stock ya devuelto) | Estado `PAGADA_SIN_STOCK` + alerta; nunca re-descontar sola |
| 8 | Refresh token quemado por dos refrescos simultáneos | Lock por fila al refrescar; si falla, `REQUIERE_RECONEXION` |
| 9 | Firma del webhook en modo OAuth sin probar | Verificar en sandbox antes de escribir el handler final |
| 10 | `/orden/[token]` choca con el ruteo de tienda (paths = productos) | Agregarlo en `decidirRuteo` con test |
| 11 | El recargo por tipo del carrito usa el MÁXIMO del tipo: con un medio MP nuevo de tipo BILLETERA_VIRTUAL cambiaría el recargo de "Billetera virtual" | Marca `solo_online` y excluirlo de `opcionesDePagoPublicas` |
| 12 | Plan de Vercel desconocido (Hobby = cron diario) | Se evita: pg_cron en la base |
| 13 | Cuentas MP que no pueden cobrar (sin validar identidad) | Mostrar el error de MP en voseo en el callback y no habilitar el medio |

---

## 7. Ajustes sugeridos a la épica

- **T1 suma la orden de la Fase 1** (tabla, número, token público) y el teléfono en
  el carrito. Sin eso no hay nada que pagar.
- **T2 se achica**: el % por transferencia es una promo existente; la pantalla Cobros
  enlaza a Promociones en vez de duplicar el campo. Validación de CBU/CVU: ya está
  (`alias-transferencia.ts`); sumar los dígitos verificadores del CBU (hoy solo mira
  22 números). El flag lo prende el super admin, no el comercio.
- **T5 cambia "Marcar como pagada" por "Cobrar en el POS"**: misma intención, pero
  la plata entra al ledger, al arqueo y a reportes por el camino de siempre, con
  permiso de venta. "Marcar pagada" sin venta dejaría plata que no aparece en caja
  ni en ventas. El registro en `eventos_pago` sigue.
- **T6 + T7 se hacen juntos**: no hay forma de probar uno sin el otro en sandbox.
- **T8 va con T4**, no después: la orden descuenta stock desde que nace.
- **Falta una tarea**: "Órdenes" en el panel (lista, estados, realtime, contador en
  el menú) — está repartida entre T5 y T9 y es la mitad del valor para la dueña.
- **T9**: el aviso al comercio "en el momento" es Web Push (Fase 2 de
  tienda-online.md), no mail. Para v1 alcanza con realtime + contador en el panel y
  mail (Resend, `shared/lib/enviar-mail.ts`); push queda para su fase.
- **Falta**: página pública de la orden (`/orden/[token]`), que sirve a las dos ramas.
- **STOPGAPs propuestos** (van a `docs/pagos-stopgaps.md`): conciliación manual de
  transferencias; conversión a venta desde el POS en vez de automática; reembolsos
  sin efecto automático en stock ni en ventas.

---

## 8. Orden y estimación (días de trabajo, con tests y smoke en prod)

| Tarea | Contenido | Días |
|---|---|---|
| T1 | Migraciones: órdenes + ítems + eventos + conexiones + estados OAuth + config + flag + origen de stock; tests de RLS entre dos negocios | 2,5 |
| T2 | Cobros: medios, datos de transferencia, link a promos, flag en /admincomerz | 1,5 |
| T3 | OAuth con PKCE, callback, cifrado generalizado, desconectar, refresh perezoso con lock, estados en UI | 3 |
| T4+T8 | Carrito con teléfono y medios nuevos, `crear_orden_tienda` (recalculo + stock atómico), `/orden/[token]`, ruteo, rate limit, pg_cron de vencimiento | 4 |
| Órdenes | Lista en el panel, realtime, contador, "Cobrar" en el POS sin doble stock | 3 |
| T5 | Pantalla de transferencia, WhatsApp con número de orden, registro manual | 1 |
| T6+T7 | Preference, retorno, webhook con firma, GET del pago, mapeo de estados, idempotencia, alertas; tests con payloads de sandbox | 4 |
| T9 | Mails a la clienta y al comercio, aviso de reconexión | 1,5 |
| T10 | E2E sandbox, prueba en celular, runbook, activación en un comercio con compra real + reembolso | 2 |
| | **Total** | **~22,5** |

Orden: **T1 → T2 ∥ T3 → T4+T8 → Órdenes → T5 (ya vende por transferencia) → T6+T7 →
T9 → T10.**

---

## 9. Qué necesito de Nacho para arrancar T1

1. OK a la recomendación, en especial: **cobro desde el POS** (§1.6) y **descuento
   de stock al crear la orden** (§3.6).
2. Seguir ya o esperar el corte de la Fase 0 (§6.1).
3. OK a habilitar `pg_cron` en el proyecto.
4. Plazos por defecto: 48 h transferencia, 60 min Mercado Pago. ¿Excluir
   Rapipago/Pago Fácil por defecto?
5. Prerrequisitos de la épica (app de MP con PKCE activado, redirect URI, secreto del
   webhook, cuentas de prueba) + una env var nueva: `MP_CLAVE_CIFRADO`.

Fuentes MP: [OAuth](https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation),
[Webhooks](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks),
[Notificaciones Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/payment-notifications),
[Checkout Pro](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-preferences/overview),
[Mercado Crédito](https://www.mercadopago.com.ar/developers/es/docs/woocommerce/payments-configuration/mercado-credito),
[OAuth token](https://www.mercadopago.com/developers/en/reference/oauth/_oauth_token/post).

---

## 10. Revisión del 12/10/2026: la venta se registra sola

Nacho: cobrar cada orden desde el POS no cierra; la mayoría de las ventas tienen que
ser automáticas, y la transferencia, al confirmarla, tiene que llegar a caja. Esto
**reemplaza §1.6 y el T5 propuesto en §7** (y el STOPGAP #3 deja de ser atajo).

### Qué se verificó en la base (antes de proponer)
- `ventas.turno_caja_id` y `ventas.vendedor_id` aceptan null; `venta_pagos.turno_caja_id`
  también. Hoy hay 2 ventas sin turno sobre 6.392 y ninguna sin vendedor.
- El ledger NO depende del turno para un cobro digital: `registrar_bitacora_venta_pago`
  manda el importe a la cuenta destino del método (o al puente `POR_ACREDITAR` según
  `acreditacion_dias`) y guarda el turno solo como dato. Una venta online cobrada por
  MP o transferencia cae en la cuenta correcta sin cajón y sin tocar el arqueo.
- `requiere_caja_abierta` está prendido en los 14 comercios, pero es una regla de
  `create-sale.ts` para el mostrador, no de la base. La venta online no pasa por ahí.
- `registrar_venta` es INVOKER y exige sesión (`SIN_NEGOCIO_ACTIVO`): el webhook no
  puede llamarla. Hace falta una RPC propia.

### Diseño
- **`registrar_venta_orden_tienda(orden_id, metodo_pago_id)`**: RPC DEFINER, una
  transacción, idempotente (`UPDATE ordenes_tienda … where venta_id is null` con
  chequeo de filas antes de escribir). Crea `ventas` + `ventas_items` + `venta_pagos`
  desde los renglones y montos CONGELADOS de la orden, **sin tocar stock** (ya salió
  al crear la orden), `turno_caja_id` null, `vendedor_id` null, y suma el uso de las
  promos aplicadas. Filtra `negocio_id` a mano en cada consulta.
- **Mercado Pago**: el webhook, al validar un `approved` con monto y moneda correctos,
  llama a la RPC con el método "Mercado Pago online" del comercio. Cero toques.
- **Transferencia**: botón **"Confirmar transferencia"** en la orden (un toque, con
  permiso), que llama a la misma RPC con el método TRANSFERENCIA que el comercio eligió
  en Cobros (define a qué cuenta entra: banco o MP). Queda en `eventos_pago` quién y
  cuándo. Nunca pasa por el POS.
- **"Llega a caja"** = entra al ledger: se ve en /caja › Dinero y Movimientos, en la
  cuenta destino. **No entra al arqueo del cajón**, porque no es efectivo (igual que
  hoy una transferencia cobrada en el mostrador va a su cuenta, no al cajón).
- **Vendedor null, siempre**: si fuera quien confirmó la transferencia, las comisiones
  y el rendimiento por vendedora se lo acreditarían. Reportes y panel muestran
  "Tienda online" para `vendedor_id` null con orden vinculada.
- **IMEI**: un producto con `lleva_serie` vendido online queda con
  `motivo_sin_imei = 'VENTA_ONLINE'`; la unidad se asigna al entregar.
- **Facturación**: sigue manual (decisión del 7/10).

### Conciliación automática de transferencias
- Solo es posible si el alias/CVU que se muestra es el de la cuenta de Mercado Pago
  CONECTADA. Una transferencia a un banco no la ve nadie: ahí queda el botón.
- Lo que se sabe (fuentes de la comunidad, **no de la documentación oficial**): una
  transferencia recibida en el CVU de MP aparece como un pago
  (`operation_type: money_transfer`, `payment_type_id: account_money`) y se puede
  buscar con `GET /v1/payments/search` usando el token del comercio. No está
  confirmado que dispare el webhook de una app conectada por OAuth.
- Plan: **spike con una transferencia real de monto bajo** a una cuenta conectada
  (el sandbox no simula transferencias a CVU). Si aparece en el webhook o en la
  búsqueda, se concilia por **monto exacto + ventana de la orden + una sola orden
  pendiente con ese monto**; si hay dos candidatas, no se adivina y queda para el
  botón. Si no aparece, la conciliación queda como STOPGAP con el botón.

### Impacto a revisar en la implementación (leer ventas.md + caja-y-dinero.md)
- Pantallas y reportes que agrupan por vendedor (`vendedor_id` null).
- `resumen_gerencial_caja`, `resumen_financiero_periodo` y el panel: una venta sin
  turno con cobro digital tiene que sumar en ventas y en la cuenta, y en ningún turno.
- Anular una venta online: `anular_venta` devuelve stock y saca la plata; hay que
  verificar el camino sin turno (el reintegro por MP se hace en MP).

---

## 11. Decisiones del 12/10/2026 (tarde) y spike de T5

**La transferencia del catálogo va SOLO al alias/CVU de Mercado Pago** de la cuenta
conectada (Nacho). Mercado Pago es la pasarela también para la transferencia: es lo
único que se puede conciliar solo, y la plata entra a una cuenta que Comerz ya conoce.
- `configuracion_pos.alias_mercadopago_tienda` (+ `transferencia_titular`). NO se reusa
  `alias_transferencia`: la usa el resumen de CC y puede ser un banco.
- Sin MP conectado no hay transferencia online (el catálogo sigue con WhatsApp).
- `metodos_pago.uso_tienda` (`MP_CHECKOUT` | `TRANSFERENCIA_MP`, uno por negocio):
  los crea el sistema al conectar MP, con la cuenta destino de MP. La venta automática
  cobra con ellos; el POS y los botones del catálogo los filtran (GRANT a `anon` en la
  misma migración para que el filtro no tire 403).
- Riesgo: Comerz no puede verificar que el alias cargado sea de la cuenta conectada (la
  API no expone el CVU). Si no lo es, la conciliación nunca matchea y queda el botón.
  La pantalla de Cobros lo explica.

### Spike (antes de T5): cómo correrlo
`scripts/spike-mp-transferencias.ts` — solo lectura, no imprime el token ni datos
completos de quien paga.
1. En MP Developers, en la app de Comerz (o una de prueba de la cuenta de Nacho),
   copiar el **Access Token de producción** de la cuenta que va a RECIBIR.
2. Desde otra cuenta (banco o MP), transferir **$10** al alias de esa cuenta. Anotar
   hora y monto.
3. `MP_SPIKE_ACCESS_TOKEN=APP_USR-… npm run spike:mp-transferencias -- --horas 2`
4. Si aparece, `… -- --id <id>` para ver la forma completa del pago.
5. Webhook (opcional en esta etapa): en la app, Webhooks › evento "Pagos" a una URL de
   prueba; repetir el paso 2 y ver si llega una notificación con ese `data.id`.

### Qué decide el resultado
| Resultado | Consecuencia |
|---|---|
| Aparece en la búsqueda **y** dispara el webhook | Conciliación automática por webhook, como un pago de checkout |
| Aparece en la búsqueda, sin webhook | Conciliación por consulta: al abrir la orden / la lista, y con `pg_cron` cuando se habilite |
| No aparece | Queda el botón "Confirmar transferencia" (STOPGAP #2) |

Queda para después de T3: confirmar que con una cuenta conectada por **OAuth** (no la
dueña de la app) pasa lo mismo.

### Resultado (12/10/2026)
Corrido con el token de la app (`client_credentials`, cuenta dueña de la app, producción)
sobre 30 días de pagos REALES ya recibidos; no hizo falta transferir. Sin montos ni datos
de quien pagó en este documento.

| Cómo entró la plata | `operation_type / payment_type_id / payment_method_id` | Aparece |
|---|---|---|
| Transferencia desde otra cuenta de MP | `money_transfer / account_money / account_money` | Sí |
| Transferencia desde un banco al CVU | `account_fund / bank_transfer / cvu` | Sí |

En los dos casos: `status: approved` / `accredited` al instante, `transaction_amount`
exacto, `currency_id: ARS`, fecha al segundo, `collector_id` = la cuenta que recibe,
comisión 0, `point_of_interaction.type: PSP_TRANSFER`. **No trae `external_reference`**
(no hay forma de que la clienta la mande) y `description` es el concepto que elige quien
transfiere ("Varios", "Bank Transfer"). De quien paga vienen email y documento, no el
nombre.

**Conclusión**: la conciliación automática es posible por CONSULTA
(`/v1/payments/search` con el token del comercio): monto exacto + ventana de la orden.
Falta confirmar si además dispara el webhook (se ve en T7 con la app ya escuchando) y
que con una cuenta conectada por OAuth se lea igual (debería: el token del comercio da
los mismos permisos de lectura).

**Riesgo que define el diseño de T5**: sin referencia, el único dato para matchear es el
MONTO. Montos redondos (80.000, 30.000) se repiten, y la cuenta del comercio recibe
transferencias que no son del catálogo. Reglas: solo transferencias ENTRANTES creadas
entre la orden y su vencimiento, monto exacto, y una sola orden pendiente con ese monto;
si hay dos candidatas o dos transferencias, no se adivina: queda para el botón. A
evaluar en T5: hacer cada total pendiente único (ajuste de centavos o de pocos pesos)
para que dos órdenes nunca compitan por la misma transferencia.

---

## 12. T2 y T3: Cobros online y conexión con Mercado Pago (12/10/2026, sin deploy)

**Qué hay** (`features/cobros-online/`):
- **Flag**: /admincomerz › menú del comercio › "Prender cobros online"
  (`cambiarPagosOnlineAction`, mismo patrón que presupuestos). Viaja en la membresía
  (`listarMisNegociosAction`) → `usePagosOnline()`.
- **Configuración › Cobros online** (solo ADMIN y con el flag): conexión con MP, los
  dos medios (checkout y transferencia al alias de MP), alias + titular, plazos de
  vencimiento (transferencia 1–4 h, default 2 h; MP 30 min–2 h, default 60) y un link
  a Promociones para el descuento. Ningún medio se prende sin MP conectado; la
  transferencia exige alias (`validar-cobros.ts`, espejo de los CHECK).
- **OAuth**: `/api/mercadopago/oauth/iniciar` (ADMIN + flag, contra la base) →
  MP con PKCE S256 → `/api/mercadopago/oauth/callback`. El state se guarda hasheado,
  se consume con UPDATE condicional (un solo uso, 10 min), y tiene que volver el
  mismo usuario que empezó. Tokens y verifier cifrados con `MP_CLAVE_CIFRADO`
  (`shared/lib/cifrado.ts`, ahora compartido con ARCA, mismo formato `v1:`).
- **Renovación perezosa** (`tokenVigente`): con menos de 30 días de vida renueva antes
  de usar; carrera entre dos renovaciones resuelta comparando el refresh usado; un
  rechazo de MP marca `REQUIERE_RECONEXION` y Cobros muestra "Reconectar"; un corte
  de red NO. La va a usar T6 al crear la preference.
- **Desconectar** borra la fila (tokens incluidos) y apaga los dos medios.

**Probado**: 32 tests nuevos (PKCE contra el vector del RFC 7636, state reusado /
vencido / inventado / de otro usuario, cancelación, reconexión sin duplicar,
renovación, carreras, corte de red, validación de Cobros, voseo). Suite completa
2136/2136, `tsc` y `next build` OK.

**Falta para la prueba real**:
1. Env vars en Vercel (producción y preview) y local: `MP_CLIENT_ID`,
   `MP_CLIENT_SECRET`, `MP_CLAVE_CIFRADO` (generar con
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) y,
   fuera de producción, `MP_REDIRECT_URI`. Sin ellas Cobros dice "todavía no está
   habilitada" y el botón no aparece.
2. En la app de MP: redirect URI `https://app.comerz.app/api/mercadopago/oauth/callback`
   y PKCE activado.
3. Deploy, prender el flag en UN comercio y conectar desde el celular.

**Decisiones chicas tomadas acá**:
- El panel muestra "Cuenta de Mercado Pago n.º <user_id>": no se guarda el nombre de
  la cuenta (haría falta otra columna y otra llamada a MP). Si molesta, se suma.
- Los dos métodos de pago `uso_tienda` NO se crean al conectar: se crean en T5/T6,
  junto con el filtro que los esconde del POS y del catálogo. Crearlos ahora los
  haría aparecer en el mostrador.

---

## 13. T4: el catálogo crea la orden (12/10/2026, aplicada en producción)

**Base** (`supabase/migrations/20261012162746_tienda_crear_orden.sql`, test en
`supabase/tests/tienda_crear_orden.sql`, ensayado en seco contra producción):
- `crear_orden_tienda(negocio, orden, items)`: SOLO service_role. Una transacción:
  idempotencia por id del navegador → módulo y medio prendidos + MP conectado → topes
  (5 órdenes/h por IP, 3 pendientes por celular) → renglones del negocio, activos y
  publicados → montos que cuadran → libera vencidas → número → orden + renglones →
  stock por variante con UPDATE condicional (origen `ORDEN_TIENDA`) + espejo. Sin
  stock: `SIN_STOCK` con el nombre y no queda nada.
- `liberar_ordenes_tienda_vencidas(negocio)`: vence y devuelve stock una sola vez
  (origen `ORDEN_TIENDA_LIBERADA`, evento `VENCIMIENTO`). STOPGAP #1 (sin pg_cron).
- `opciones_cobro_online()`: anon, solo dos booleanos.

**Server action** `features/store/actions/crear-orden-tienda.ts`: lee precios,
categoría, promos, cupón y envío con el cliente anónimo del catálogo, recalcula con
`calcularTotalesPedido` (`features/store/lib/orden-tienda.ts`, 20 tests) y si el total
no coincide con el que vio la clienta NO crea y devuelve el nuevo. Campo trampa,
celular normalizado (549…), IP hasheada con el negocio.

**Carrito**: con la transferencia online prendida, el botón "Transferencia" pasa a
ser online (pide celular, "Confirmar pedido" en vez de WhatsApp) y al confirmar
muestra la orden: número, total y alias para copiar, plazo, y "Ya transferí: avisar por
WhatsApp" (segundo toque). Efectivo y el resto siguen por WhatsApp como siempre.
Mercado Pago no se ofrece hasta T6 (`CHECKOUT_MP_DISPONIBLE = false`).

**Decisiones tomadas acá (revisables)**:
- Promos por método en el checkout de MP: ninguna aplica (solo generales y cupones).
  Un "10% con billetera" del QR del mostrador no se regala solo online.
- Recargo 0 en los dos medios online.
- No se pagan online (siguen por WhatsApp, con aviso): presentaciones, importe fijado
  y envío a otra localidad. STOPGAP #4.

---

## 14. T5: la transferencia se cobra sola (12/10/2026, aplicada en producción)

**Base** (`20261012162839_tienda_cobrar_orden.sql`, test `supabase/tests/tienda_cobrar_orden.sql`,
ensayado en seco junto con T4 contra producción):
- `_registrar_venta_orden_tienda` (solo service_role): con la orden BLOQUEADA escribe
  venta + `venta_pagos` + renglones + `ventas_descuentos` + uso de promos, y la orden
  pasa a PAGADA. Sin turno, sin vendedor, SIN tocar stock. El envío va como renglón
  libre (así `ventas.total` cierra contra los renglones) y el descuento se prorratea
  por peso, por unidad, como `create-sale.ts`. Idempotente: la segunda llamada
  devuelve la misma venta y deja el evento como DUPLICADO (o PAGO_DUPLICADO si es otro
  pago de MP). Una orden VENCIDA o CANCELADA no se cobra (`ORDEN_NO_COBRABLE`).
- Cobra con el método `uso_tienda` (TRANSFERENCIA_MP / MP_CHECKOUT), que se crea solo
  la primera vez, INACTIVO (CHECK `metodos_pago_uso_tienda_inactivo`: ningún selector
  lo ofrece), y con una cuenta "Mercado Pago (tienda online)" compartida. El ledger
  lo mueve el trigger de siempre: verificado que el importe cae en esa cuenta.
- `confirmar_transferencia_orden` / `cancelar_orden_tienda`: sesión + `ventas.cobrar`.
- `orden_tienda_publica(token)`: anon, vence antes de leer, alias solo mientras espera.

**Conciliación automática** (`features/cobros-online/lib/conciliar-*.ts`, 14 tests):
transferencias ENTRANTES (`money_transfer` / `account_fund`), aprobadas, en ARS, del
`collector` conectado y sin `external_reference`; monto exacto, fecha entre 2 min antes
de crear la orden y su vencimiento, UNA candidata de cada lado (si no, no adivina).
Corre al abrir /ordenes y la página pública de la orden, a lo sumo cada 30 s por
negocio. Registra con origen SISTEMA y clave `mp:<payment_id>:approved` (la misma que
usará el webhook de T7: si después llega, es DUPLICADO).

**Pantallas**: `<tienda>/orden/<token>` (estado, datos para transferir, se refresca
cada 20 s mientras espera) y /ordenes en el panel (pendientes / pagadas / todas,
"Confirmar transferencia", "Cancelar", WhatsApp a la clienta). El carrito ofrece
"Ver mi orden" al confirmar.

**Decisiones tomadas acá (revisables)**:
- Descuento de varias promos: un renglón de `ventas_descuentos` por promo; en
  `ventas_items.promocion_id` solo si hubo UNA.
- Producto con IMEI vendido online: `motivo_sin_imei = 'Venta online: el IMEI se carga
  al entregar'`.
- La cuenta "Mercado Pago (tienda online)" es nueva aunque el comercio ya tenga otra
  de MP para el QR del mostrador; se puede reasignar desde Métodos de pago.

---

## 15. T6: Checkout Pro (12/10/2026, gracia aplicada en producción: `20261012165722`)

**Flujo**: la clienta elige "Mercado Pago" o "Cuotas sin tarjeta" → antes de apartar
stock se verifica que el token del comercio sirva (si no: "elegí otro medio", y la
conexión queda para reconectar) → se crea la orden → se crea la preference con el
token del COMERCIO (`checkout-mp-servidor.ts`) → navegación a `init_point` en la misma
pestaña → la clienta vuelve a `<tienda>/orden/<token>` ("Estamos confirmando tu
pago") → la conciliación lee el pago por `external_reference` con el token del
comercio y registra la venta (con la comisión REAL de `fee_details`). El `?status=`
del regreso nunca se usa para nada más que el mensaje.

- Una preference por orden: si la orden ya tiene `mp_preference_id`, se reusa (GET).
  Orden pagada, vencida o cancelada: no se crea ninguna.
- Preference (`preferencia-mp.ts`, 11 tests): un ítem con el total exacto,
  `external_reference` = orden, `notification_url` al webhook (T7), `back_urls` a la
  página de la orden, `auto_return` solo con https, vence con la orden (hora AR), sin
  `ticket` ni `atm`, `purpose: onboarding_credits` en cuotas sin tarjeta.
- Si la preference falla después de crear la orden, la orden queda y su página tiene
  "Pagar con Mercado Pago" (`pagar-orden-mp.ts`).
- **Gracia de 30 min para órdenes de MP** (`20261012165722_tienda_gracia_mp.sql`): un
  pago del último minuto se registra después de `vence_en`; sin gracia, otra lectura
  devolvía el stock de una orden cobrada. La conciliación ahora corre ANTES del
  vencimiento en las dos páginas.

**Validado contra la API de MP (sandbox, credenciales de prueba)**: las dos preferences
(checkout y cuotas) se crean con 201; MP devuelve `external_reference`, `expires`,
`expiration_date_to` en -03:00, las exclusiones, `auto_return` y `notification_url`
tal como se mandaron.

**Riesgo abierto**: MP acepta `purpose` pero NO lo devuelve (ni en el POST ni en el
GET, ni con `onboarding_credits` ni con `wallet_purchase`). No hay forma de confirmar
por API que preseleccione el crédito: verificarlo a ojo en T10, logueado con la
compradora de prueba. Si no lo hace, "Cuotas sin tarjeta" igual lleva al checkout
completo, donde el crédito está como opción.

**Pendiente para T7**: el webhook (instantáneo; hoy el pago se registra cuando alguien
mira la orden o /ordenes), `EN_PROCESO` para pagos pendientes, `REVISAR` para monto
distinto (hoy solo queda en el log) y `PAGADA_SIN_STOCK`.

---

## 16. T7: webhook y estados de pago (12/10/2026, RPC aplicada: `20261012171038`; código sin deploy)

**Una sola puerta**: `aplicar_pago_mp_orden(negocio, orden, origen, pago)` (DEFINER, solo
service_role) es lo único que cambia una orden a partir de un pago de MP. La llaman el
webhook y la conciliación por lectura; el mismo pago por los dos caminos produce un solo
efecto (clave `mp:<payment_id>:<status>` en `eventos_pago`). Vuelve a comparar monto y
moneda aunque el server ya lo haya hecho.

| Pago (leído de la API) | Orden |
|---|---|
| `approved`, monto y moneda exactos, orden viva | venta (`_registrar_venta_orden_tienda`, comisión real de `fee_details`) |
| `approved` sobre una orden VENCIDA/CANCELADA (stock ya devuelto) | `PAGADA_SIN_STOCK`, sin venta y sin re-descontar |
| `approved` con otro monto o moneda | `REVISAR` (`RECHAZADO_MONTO`), stock retenido |
| `pending` / `in_process` / `authorized` | `EN_PROCESO` (no vence) |
| `rejected` / `cancelled` del pago que la tenía EN_PROCESO | vuelve a `PENDIENTE_PAGO` |
| `refunded` / `charged_back` / `in_mediation` del pago que la pagó | `REEMBOLSADA` / `CONTRACARGO` / `EN_DISPUTA` (STOPGAP #3: la venta y el stock no se tocan) |
| un segundo `approved` sobre una orden ya pagada | `PAGO_DUPLICADO` en el log, nada más |

**Webhook** (`app/api/mercadopago/webhook/route.ts`, lógica pura en
`features/cobros-online/lib/webhook-mp.ts`, 21 tests):
- La notification_url de cada preference lleva `?n=<negocio>`; sin `n`, el negocio sale del
  `user_id` del aviso. Se cruza con la conexión ACTIVA; un pago cobrado por otra cuenta
  queda como `RECHAZADO_COLLECTOR`.
- **Firmado** (`x-signature` válida con `MP_WEBHOOK_SECRET`): `GET /v1/payments/{id}` con
  el token del comercio y se aplica. Con `external_reference` de una orden, a la orden;
  sin referencia y entrante (`money_transfer` / `account_fund`), a la conciliación de
  transferencias.
- **Sin firma** (el aviso viejo `?topic=payment&id=`, que la documentación no garantiza
  firmado para notification_url): solo dispara `conciliarPagosNegocio` (límite de 30 s
  por negocio). Un aviso inventado no logra nada más. **Firma inválida: 401.**
- No se rechazan `ts` viejos: un aviso auténtico repetido solo hace releer el pago.
- 500 ante error transitorio (token, red, base) para que MP reintente; la conciliación por
  lectura es la red de seguridad.

**Conciliación**: ahora aplica el pago que decide la orden (`pagoQueDecideLaOrden`:
aprobado exacto > aprobado con otro monto > en proceso > el rechazo del que la tenía en
proceso) por la misma RPC. Reemplaza a `pagoAprobadoDeOrden`.

**Pantallas**: la página pública muestra "pago en proceso" (sin botón de pagar otra vez),
"recibimos tu pago, la tienda lo revisa" (REVISAR / PAGADA_SIN_STOCK) y "pago devuelto /
en reclamo". /ordenes › Pendientes incluye PAGADA_SIN_STOCK, CONTRACARGO y EN_DISPUTA.

**Para activarlo** (pendiente):
1. En la app "Comerz POS" (MP Developers) › Webhooks: URL de producción
   `https://app.comerz.app/api/mercadopago/webhook`, tópico "Pagos". Guardar genera la
   clave secreta → env var `MP_WEBHOOK_SECRET` en Vercel.
2. Deploy y prueba en sandbox: un pago de prueba con la compradora de test y mirar que
   llegue firmado (riesgo #9: que los pagos creados con el token del VENDEDOR lleguen con la
   firma de la app de Comerz). Si llegan sin firma, igual se registran por la conciliación.
3. Ver con una transferencia real si el CVU dispara el aviso (STOPGAP #2).

---

## 17. Checkout en página propia (12/10/2026, sin commit)

El checkout dejó de ser el paso 2 del panel lateral: ahora es `<tienda>/checkout`
(`features/store/components/checkout/`), con el formato de Tiendanube y Shopify.
- Contacto → Entrega → Pago → UN botón ("Pagar $X" con Mercado Pago, "Confirmar
  pedido" con transferencia, "Enviar pedido por WhatsApp" sin cobro online).
- Resumen del pedido (productos, cupón, desglose, total) a la derecha en compu y
  desplegable arriba en el celular; se monta una sola vez.
- Entrega y medios de pago como lista con radio; cada medio dice qué es y, si cambia
  el precio, lo dice con el número ("Pagás $X", "+10%").
- **Con cobro online, solo se ofrecen los medios online** (decisión de Nacho): efectivo,
  tarjeta y billetera por WhatsApp quedan solo si el comercio no cobra online o si el
  pedido no se puede pagar online (`opcionesConPagoOnline`).
- Al confirmar una transferencia se va a la página de la orden (alias y estado); la
  pantalla "orden creada" del panel se borró.
- El panel lateral quedó como carrito: productos, cupón y "Finalizar compra".
- **La página de la orden es el comprobante** ("¡Pedido realizado!", número, fecha, cliente,
  entrega, medio, productos y total, con "Guardar o imprimir"). En una transferencia que
  espera pago muestra arriba los **datos para transferir**: monto, alias y CVU para copiar,
  titular, CUIT, banco y comercio. CVU y CUIT del titular son columnas nuevas
  (`transferencia_cvu`, `transferencia_cuit`, migración `20261012184748`, aplicada) que el
  comercio carga en Cobros; no se copian del CUIT fiscal porque el titular de la cuenta de MP
  puede ser otra persona. `orden_tienda_publica` los devuelve con la misma regla que el alias.
- Arreglado: al confirmar una transferencia se vaciaba el carrito antes de navegar y quedaba
  "Tu carrito está vacío" mientras cargaba la orden. Ahora se muestra "Preparando tu
  comprobante…" y el carrito se vacía después de navegar.

## 18. /ordenes rediseñada y "Marcar entregada" (12/10/2026, sin commit)

- Lista compacta + detalle (compu: lado a lado; celular: drawer). Pestañas con contador:
  Todas, Para entregar (PAGADA), Esperando pago, Revisar (solo si hay; arranca ahí).
- **Marcar entregada** (`marcar_orden_entregada`, migración `20261012190806`, aplicada; test
  `supabase/tests/tienda_marcar_entregada.sql`): PAGADA ↔ ENTREGADA, sesión + `ventas.cobrar`,
  guarda `entregada_en`/`entregada_por`. No toca venta, plata ni stock: por eso no pide
  confirmación y se deshace desde el aviso.
- **La venta ya está en /ventas desde que se paga** (no al entregar): la registra
  `_registrar_venta_orden_tienda`. En el historial ahora se ve "<nombre> · Tienda online
  #00012" en vez de "Consumidor final", y el ticket dice vendedor "Tienda online" en vez de
  "Administrador" (`get-sales.ts` embebe `ordenes_tienda`). Una vendedora sin
  `tienda.ver_ordenes` no ve la orden embebida (sigue viendo "Consumidor final").
- **IMEI al entregar** (migración `20261012194147`, aplicada; test
  `supabase/tests/tienda_imei_al_entregar.sql`): la venta online graba un renglón por aparato
  en lo que lleva IMEI (`variantes_llevan_serie`), y "Marcar entregada" pide el IMEI de cada
  uno (escáner o un toque sobre los que están en stock). `marcar_orden_entregada(orden, true,
  unidades)` ata todo y entrega en UNA transacción: una unidad DISPONIBLE de ese modelo pasa a
  vendida (como el POS); un IMEI que no estaba cargado nace vendido (como "Agregar IMEI").
  Frena con `IMEI_FALTANTES`, `IMEI_NO_DISPONIBLE` (vendido u otro modelo), `IMEI_REPETIDO` o
  `IMEI_DE_MAS`. "Deshacer" la entrega no desata los IMEI (el aparato ya salió).
