# Suscripciones de Comerz: cobro automático a los comercios

Plan aprobado por Nacho el 12/10/2026. Es el cobro de COMERZ a sus comercios (el SaaS),
no el cobro de un comercio a sus clientas (eso es [tienda-online.md](tienda-online.md) y
[pagos-auditoria.md](pagos-auditoria.md)).

## Cómo estaba (auditoría 12/10/2026)

- Planes: Emprendedor $30.000, Gestión $50.000, Empresa $70.000 (`planes.precio_mensual`).
  Emprendedor y Gestión tienen un `link_suscripcion` fijo (`mpago.la`), igual para todos.
- Los pagos los carga el super admin a mano (`registrarPagoAction` → `pagos_suscripcion`,
  mueve `negocios.plan_vencimiento`). Nada se renueva solo.
- **El precio que paga cada comercio no existía**: el MRR sumaba el de lista. ClickTostado
  y Estilo Bonito pagan $30.000 en Gestión ($50.000): MRR inflado en ~$40.000.
- El Nono Cacho y Librería Colores: activos, vencidos desde septiembre, sin pagos. Decisión:
  **están en deuda**, entran al cobro automático.
- Ninja Camisetas: cortesía ($1, `cuenta_en_mrr = false`).

## Decisiones

1. **Precio acordado por comercio, sin vencimiento**: `negocios.precio_acordado` (null =
   precio de lista). El motivo va a un historial que solo ve el super admin
   (`precios_acordados`), no a `negocios` (el comercio lee su fila). El MRR suma el precio
   efectivo (`coalesce(precio_acordado, precio de lista)`).
2. **Cobro: suscripción de Mercado Pago por comercio + transferencia manual.** Una
   suscripción sin plan asociado (`/preapproval`, `status: pending`) con el monto de cada uno;
   el comercio la autoriza con su tarjeta desde un link. La transferencia sigue con
   "Registrar pago".
3. **Vencido = aviso, sin bloquear.** Alerta en /admincomerz y barra al comercio. Suspender
   lo decide el super admin.

## Tareas

| # | Qué | Estado |
|---|---|---|
| S1 | Precio acordado: columna, historial, edición en /admincomerz, MRR con precio efectivo (las 3 RPC + el espejo TS) | hecho (migración `20261012200111` aplicada; test `supabase/tests/precio_acordado.sql`; código sin commit) |
| S2 | Suscripción MP por comercio: tabla `suscripciones_mp`, crear (`/preapproval` pending, `external_reference` = negocio), link para el comercio | hecho (código sin commit; falta `MP_COMERZ_ACCESS_TOKEN`) |
| S3 | Webhook: `subscription_preapproval` (estado) y pagos de la suscripción → `pagos_suscripcion` idempotente por pago de MP + vencimiento | hecho (migración `20261012201739` aplicada; tópicos agregados al webhook de la app) |
| S4 | Cambio de precio (acordado o de lista) → actualizar el monto de la suscripción (`PUT /preapproval/{id}`) | |
| S5 | Avisos de vencido: /admincomerz y barra del comercio | |

Notas de MP (documentación oficial, 12/10/2026): un cobro rechazado se reintenta hasta 4
veces en 10 días; después de 3 cuotas rechazadas MP da de baja la suscripción. Las
suscripciones se crean con el token de la cuenta de Comerz (no con OAuth).

## Topes de uso y semestral (23/10/2026)

**Fuente de verdad: `planes.reglas` en la base.** Lo que ve el comerciante (Perfil ›
Suscripción), el aviso de la campana y la tabla de /admincomerz leen el MISMO valor
(`reglas_negocio()`: plan + `reglas_override` del comercio) y el MISMO criterio
(`nivelDeUso` en `shared/lib/suscripcion.ts`). Si se cambia un número, se cambia solo
en la tabla `planes`.

| | Emprendedor | Gestión | Empresa / Prueba |
|---|---|---|---|
| Precio de lista | $30.000 | $50.000 | $70.000 / $0 |
| Semestral (20% off, de una vez cada 6 meses) | $24.000/mes | $40.000/mes | $56.000/mes |
| Usuarios | 1 | 5 | 99 |
| Productos (frena solo el alta) | 1.000 | **5.000** | sin tope |
| Clientes con cuenta corriente | 50 | 250 | sin tope |
| Ventas por mes (tope **blando**) | **500** | **5.000** | sin tope |
| ARCA (`facturacion_electronica`) | **sí** | sí | sí |

- **`max_ventas_mensuales`** cuenta las ventas NO anuladas del mes calendario comercial
  argentino (`shared/lib/mes-comercial.ts`). **Blando a propósito**: sin trigger ni
  chequeo en `registrar_venta` (una venta es plata real en el mostrador). Avisa AL
  LLEGAR al tope, no antes (sin el "cerca" del 80%).
- **Dónde se ve**, las tres cosas son lo mismo:
  1. **Comerciante**: Perfil › Suscripción › "Ventas del mes" (barra, "Llegaste al tope
     del plan", aclaración de que no corta nada). `getUsoDelPlanAction`.
  2. **Campana** (Tu negocio): estado derivado `PLAN_TOPE_VENTAS`, clave
     `tope_ventas:YYYY-MM` (leído vale para ese mes; el mes siguiente vuelve a avisar),
     fecha = la venta que alcanzó el tope. Categoría PLAN: por default solo la dueña
     (ADMIN), configurable en Configuración › Notificaciones. Se calcula en
     `_estado_tope_ventas`, que suma `_estados_notificaciones`. No avisa a un comercio
     en cortesía (precio acordado $0) ni fuera de prueba/activo (mismo criterio que los
     avisos de vencimiento). Ver [notificaciones.md](notificaciones.md).
  3. **/admincomerz**: columna "Ventas del mes" en la tabla de comercios ("N / tope",
     "tope del plan" al llegar, "sin tope"), y /admincomerz/planes con los topes de
     cada plan. `ventas_del_mes_por_comercio()` (solo super admin).
- **Costo del aviso** (medido el 23/10/2026 en producción): `_estado_tope_ventas` tarda
  ~7 ms en Librería Colores (2.854 ventas en el mes, el peor caso: lee hasta `tope`
  filas por el índice `(negocio_id, fecha_venta)`), y se corre en cada navegación de un
  ADMIN/ENCARGADO con tope declarado. Si se nota, el paso siguiente es guardarlo como
  hecho (una fila al cruzar el tope) en vez de derivarlo.
- **Migraciones aplicadas en producción el 23/10/2026** (el MCP las registra con la hora
  de aplicación: `20261023135021 planes_tope_ventas_y_arca` y
  `20261023135108 aviso_tope_ventas`; los archivos del repo son `...120000` y
  `...130000`). Verificado después: los 4 planes con sus reglas, funciones DEFINER
  cerradas a `authenticated` salvo la RPC de admin (que filtra por `is_super_admin()`),
  ningún comercio dispara el aviso hoy, y `supabase/tests/aviso_tope_ventas.sql` corrido
  en seco (`DRY_RUN_OK`). Reversiones en `supabase/reversals/`.
- **Falta (pata 2 y 3)**: commit + deploy del código (sin el deploy, la columna "Ventas
  del mes" de /admincomerz llama a una RPC que ya existe pero el código nuevo no está
  publicado) y el smoke test en producción.
- **Fotos de uso al aplicar** (ventas del mes al 23/10): Librería Colores 2.854 (tope
  5.000), El Nono Cacho 1.463, Evens 503, Estilo Bonito 118. Productos: Colores 2.071,
  Evens 1.657; ninguno supera el nuevo tope de 5.000 de Gestión.
- **ARCA en todos los planes**: `facturacion_electronica` se suma a Emprendedor.
- **Semestral = 20%** (`DESCUENTO_SEMESTRAL`): el comentario de `planes.ts` y el de
  `negocios.modalidad` decían 15%; ahora los tres dicen 20%.
- Los comercios con `reglas_override` (ej. los que venían sin tope de productos)
  conservan el suyo.
- **Pendiente**: aviso por mail al llegar al tope.

## S1: precio acordado (12/10/2026)

- `negocios.precio_acordado` (null = lista; 0 = cortesía total) y `precios_acordados`
  (historial con motivo, solo super admin, append-only, sin FK).
- `fijar_precio_acordado(negocio, precio, motivo)`: super admin; negocio + historial juntos.
- `comercios_con_uso`, `ciclo_de_vida_negocios` y `metricas_globales_comerz` devuelven
  `plan_precio` = precio efectivo; `metricas-comerz.ts` usa `precioEfectivo`
  (`features/admin/lib/precio-efectivo.ts`, con tests). Todo lo que suma MRR suma lo que
  cada comercio paga.
- /admincomerz: "Precio acordado…" en el menú del comercio (precio y motivo), marca
  "acordado" en la tabla, y "Registrar pago" sugiere el precio efectivo.
- **Falta cargar los precios reales** (ClickTostado y Estilo Bonito a $30.000, según sus
  pagos): hasta entonces el MRR sigue con el de lista para ellos.

## Datos cargados (12/10/2026, confirmados por Nacho)

ClickTostado y Estilo Bonito: $30.000 (Gestión a precio especial). Ninja Camisetas: $0
(cortesía). El Nono Cacho y Librería Colores deben septiembre y octubre: **se les cobra
solo desde ahora** (lo atrasado, aparte).

## S2 + S3: débito automático (12/10/2026)

- **Primer débito** (`inicioPrimerDebito`, `features/suscripciones/lib/preapproval.ts`, con
  tests): el día que vence lo ya pagado, al mediodía argentino; o al suscribirse si ya venció
  (o vence en menos de una hora). En prueba, el último día de la prueba.
- **Crear** (`activarDebitoAutomaticoAction`): super admin o ADMIN del comercio. Monto = precio
  efectivo (el acordado solo con SU plan; si en prueba elige otro, el de lista). Email = el del
  dueño. Una suscripción viva por comercio: una pendiente igual se reusa; una pendiente
  distinta se cancela en MP y se crea otra. Cortesía (precio 0) y demo no llevan.
- **Dónde**: /admincomerz › menú del comercio › "Link de débito automático" (lo crea y te lo
  muestra para copiar y mandar). Perfil › Plan del comercio: "Débito automático" (activar,
  terminar en MP, activo / pausado). En prueba elige el plan ahí.
- **Webhook** (`webhook-suscripciones.ts`): `subscription_preapproval` copia el estado;
  `subscription_authorized_payment` lee la cuota y, si el pago está aprobado,
  `registrar_pago_suscripcion_mp` (service_role, idempotente por pago de MP) registra el pago
  con medio `mercadopago`, corre el vencimiento un mes (mismo criterio que el pago manual,
  fechas en UTC) y pasa prueba → activo con el plan de la suscripción. Solo avisos firmados.
- **Panel del comercio**: el precio que se muestra es el efectivo (acordado o de lista).

**Para activarlo**:
1. Vercel: `MP_COMERZ_ACCESS_TOKEN` = access token de PRODUCCIÓN de la app "Comerz POS"
   (MP Developers › Tus integraciones › Comerz POS › Credenciales de producción). Sin la
   variable, la sección no aparece y la acción responde "todavía no está disponible".
2. Deploy.
3. Probar con un comercio: "Link de débito automático", autorizar, y ver que llegue el aviso.

**Riesgo a verificar en la primera prueba**: el link de MP se crea con el email del dueño
(`payer_email`). Si MP exige iniciar sesión con ESA cuenta y el comercio paga desde otra,
va a fallar; habría que pedir el email de su Mercado Pago (columna `payer_email` ya existe).

**Falta**: S4 (cambiar el precio actualiza el monto de la suscripción: hoy, si cambiás el
precio acordado de alguien con débito activo, hay que avisar y regenerar) y S5 (avisos de
vencido). Un pago que el webhook no recibió no se concilia solo todavía (no hay red de
seguridad por lectura como en la tienda).
