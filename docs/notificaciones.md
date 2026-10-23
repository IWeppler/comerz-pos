# Notificaciones: "Tu negocio" y "Novedades" (épica, sin pg_cron)

Plan aprobado por Nacho el 12/10/2026 (referencias: dos capturas de una campana con
pestañas "Tu negocio" / "Novedades", aviso "remera se ha quedado sin stock · Hace 1m",
novedad con título, fecha, negritas y viñetas, "Limpiar leídas").

## Decisiones

1. **Campana para todos, cada uno lo suyo.** Novedades: todos los usuarios. "Tu negocio":
   **solo ADMIN y/o ENCARGADO**, y **configurable**: en Configuración › Notificaciones el
   ADMIN elige qué tipos recibe cada uno de esos dos roles (por negocio). Las vendedoras
   no reciben avisos del negocio.
2. **Tipos de "Tu negocio" en V1**: stock (se quedó sin / bajó del mínimo), tienda online,
   plan y pagos, plata y caja.
3. **Novedades con editor en /admincomerz** (el super admin escribe y publica al instante).
4. **Frescura: al navegar y al abrir la campana.** Sin polling ni Realtime (egress).
5. **Sin pg_cron.** Nada se genera por reloj.

## Diseño: hechos guardados + estados derivados (mismo criterio que el feed de /admincomerz)

- **HECHOS** (pasan una vez, con hora): se escriben en `notificaciones` en la MISMA
  transacción que los produce. Ej.: una venta deja una variante en 0 (trigger sobre
  `producto_variantes.stock` en la transición >0 → ≤0, o al cruzar `stock_minimo`), una
  orden de la tienda pasa a PAGADA, se cobra el débito automático.
  **"Sin stock" NO puede ser derivado**: Evens tiene 1.883 variantes en 0 (39%), Estilo
  Bonito 545, Librería Colores 361 (12/10/2026). Listar lo agotado sería mil avisos.
- **ESTADOS** (se calculan al leer, no se guardan, se van solos cuando se resuelven): plan
  por vencer / vencido / prueba por terminar / primer débito, clientes con deuda vencida,
  caja abierta de otro día, remitos pendientes, órdenes para revisar o transferencias por
  confirmar. Su clave lleva la fecha que los origina (`plan_vence:2026-11-18`), así
  "leído" vale para ESE vencimiento y el siguiente vuelve a avisar.
- **Leído / limpiado por usuario**: `notificaciones_leidas (usuario, negocio, clave)`.
  "Limpiar leídas" las oculta para ese usuario.
- **Retención sin cron**: al leer, se borran los hechos de más de 60 días del negocio
  (mismo patrón perezoso que el vencimiento de órdenes).
- **Una lectura**: `mis_notificaciones()` devuelve las dos pestañas y el contador, filtrado
  por rol y configuración. El contador del ícono, `notificaciones_sin_leer()` (liviana), al
  navegar.

## Tareas

| # | Qué | Estado |
|---|---|---|
| N1 | Base: `notificaciones` (hechos), `notificaciones_leidas`, `notificaciones_config`; trigger de stock (sin stock / bajo mínimo) con agrupación para no inundar (una venta de 30 renglones = un aviso) | Aplicada el 13/10/2026 (a mano por Nacho desde el SQL Editor: el conector MCP cortaba el script entero con "Invalid or expired requestState"; registrada en `schema_migrations` como 20261013100000). Primer aviso real ese mismo día (Librería Colores). Quedó por PRODUCTO agotado, no "bajo mínimo", y la config es la columna `configuracion_pos.notificaciones_roles` |
| N2 | Hechos de tienda online (orden pagada / sin stock / revisar) y de suscripción (débito cobrado) | Aplicada 13/10/2026 (`20261013140623`, test `supabase/tests/notificaciones_tienda_y_debito.sql`). Triggers sobre `ordenes_tienda` (cambio de estado) y `pagos_suscripcion` (con `mp_payment_id`), blindados con exception. PAGADA avisa solo si la pagó Mercado Pago (una transferencia la confirma alguien del negocio); PAGADA_SIN_STOCK, REVISAR, EN_DISPUTA, CONTRACARGO y REEMBOLSADA avisan con su título; una notificación por orden y estado. Débito: solo el de MP (el pago cargado a mano no). PLAN llega a ADMIN y ENCARGADO hasta N6 |
| N3 | Estados derivados (plan, prueba, deuda vencida, caja de otro día, remitos) en `mis_notificaciones()` | Aplicada 13/10/2026 (`20261013142607`, test `supabase/tests/notificaciones_estados.sql`; `20261013142618` pasa N2 a `pesos_ar` y borra el duplicado `_monto_ar`). `_estados_notificaciones(negocio)`: caja abierta desde otro día (por turno), transferencias por confirmar y remitos sin conciliar (agrupados; la clave es el más nuevo, así uno nuevo vuelve a avisar), prueba en sus últimos 3 días o terminada, plan a 5 días de vencer o vencido (salvo débito automático autorizado). Las vendedoras ni los calculan. **Sin deuda vencida**: `deuda_cc_vencida` exacta tarda ~290 ms en Evens (108 clientes con saldo, medido 13/10/2026), demasiado para cada navegación; ya es el primer aviso de "Requiere tu atención" del panel. Ajuste del mismo día (`20261013142953`, decidido por Nacho): PLAN llega por default solo al ADMIN (con config explícita manda la config) y un negocio con precio acordado $0 no recibe avisos de vencimiento. Ojo: la N1 se aplicó a mano desde Windows y sus funciones vivas tienen CRLF; los `replace` sobre el cuerpo vivo tienen que tolerarlo |
| N4 | Campana: ícono con contador en el navbar (desktop y celular), popover con pestañas "Tu negocio" / "Novedades", leído, "Limpiar leídas", tiempo relativo | Hecha 13/10/2026, sin commit. `features/notificaciones/`: acciones sobre las RPC de N1, `lib/notificaciones.ts` (normalizar, tiempo relativo, contador; con tests), store compartido del contador (las dos campanas, compu y celular, piden una vez) y `SincronizadorNotificaciones` en el layout (refresca al navegar). La lista se pide al abrir; lo no leído se marca leído en la base al abrir pero conserva el punto azul hasta cerrar. "Novedades" vacía hasta N5 |
| N5 | Novedades: tabla global `novedades` + vistas por usuario; editor en /admincomerz (título, ícono, texto con negritas y viñetas, vista previa, publicar) | Hecha 13/10/2026. Base aplicada en dos partes (`20261013144754_novedades_tablas`, `20261013144814_novedades_lectura`; el conector MCP rechazaba el script entero), test `supabase/tests/novedades.sql` corrido en seco contra producción. `novedades` es GLOBAL (sin negocio_id, a propósito) y `novedades_vistas` es por usuario (no por negocio); un usuario nuevo no recibe como sin leer lo publicado antes de su cuenta; lista = últimas 20 en 120 días. Escritura solo por RPC de super admin (`guardar_novedad`, `eliminar_novedad`, `novedades_admin`). Cuerpo: `**negrita**`, viñetas con "- ", párrafos; se parsea (`texto-novedad.ts`, con tests) y se dibuja con React, nunca HTML crudo. Editor en /admincomerz/novedades con vista previa = el mismo componente de la campana; publicar pide confirmación. En la campana, leído POR PESTAÑA (se marca lo que se mira; abre en Novedades si solo hay novedades nuevas). Código sin commit |
| N7 | Aviso al llegar al tope de ventas del mes (`PLAN_TOPE_VENTAS`) | Aplicada 23/10/2026 (`20261023130000`, registrada como `20261023135108`; test en seco `supabase/tests/aviso_tope_ventas.sql` OK). Estado derivado `_estado_tope_ventas`, sumado a `_estados_notificaciones` con replace() sobre el cuerpo vivo. Categoría PLAN (solo ADMIN por default). Clave por mes. Detalle y costo en [suscripciones.md](suscripciones.md) |
| N6 | Configuración › Notificaciones: tipos × roles (Admin / Encargado) | Hecha 13/10/2026 (`20261013145823`, test `supabase/tests/notificaciones_config_roles.sql`, en seco). Sección "Notificaciones" en Configuración (grupo Personas, solo ADMIN): categoría × rol con switches. `notificaciones_roles_efectivos()` devuelve lo que SE APLICA (defaults incluidos) calculado por `_rol_recibe_notificacion`, la misma función que decide quién recibe; `guardar_notificaciones_roles(jsonb)` exige las cuatro categorías y solo ADMIN/ENCARGADO, y falla con nombre si no. Las dos solo ADMIN en la base. Una categoría sin nadie se puede guardar (avisa "Nadie recibe estos avisos"). Código sin commit |
