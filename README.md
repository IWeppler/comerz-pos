# Comerz

**El sistema de gestión que reemplaza el cuaderno, el Excel y el grupo de WhatsApp.**
Punto de venta, stock, caja, clientes y catálogo web — todo en un solo lugar, funcionando desde el celular del mostrador.

> SaaS multi-comercio, hoy en producción real en comercios de Tostado, Santa Fe.
> Lo usan dueñas y vendedoras todos los días, con plata real.

---

## Por qué existe

Los comercios chicos y medianos del interior no necesitan un ERP de 200 pantallas.
Necesitan cobrar rápido, saber qué stock les queda, cuánto les debe cada cliente y
cuánto quedó en la caja al cerrar. Comerz hace exactamente eso, bien.

- **Se aprende en una tarde.** Una vendedora nueva vende sola el primer día.
- **Anda en el celular.** Mostrador, depósito o feria: la misma app.
- **Sin instalación ni servidor.** Web, siempre actualizado.
- **Tu catálogo online, gratis.** Los clientes miran precios y piden por WhatsApp.

---

## Qué incluye

### 🛒 Punto de venta

Venta en pocos toques, con búsqueda instantánea y carga rápida por código de barras o
SKU. Pagos mixtos (efectivo + tarjeta + transferencia en un mismo ticket), calculadora
de vuelto, descuentos y promociones. El stock se descuenta en el momento, sin
sobreventa: el descuento es atómico a nivel base de datos, no "a ver si llega".

### 📦 Inventario que se adapta a tu rubro

Productos simples o con variantes ilimitadas (talle, color, capacidad, material, lo que
uses). Costos, precios y margen calculados solos. Historial de cambios de precio y de
variantes, con auditoría de quién tocó qué.

- **Indumentaria:** grillas de talle × color, carga masiva por matriz de variantes.
- **Electro:** modelo y EAN como identidad del producto, con **Catálogo Maestro**
  compartido: escaneás el código y las especificaciones ya vienen cargadas.
- **Carga rápida:** alta de productos en lote, con sugerencia de categoría y detección
  de duplicados antes de crear basura en el inventario.

### 💵 Caja y finanzas

Apertura y cierre de turno con arqueo ciego (el vendedor no ve el esperado antes de
contar). Multi-caja por usuario: cada vendedora ve y cierra **solo su turno**; la dueña
ve todos. Turno cerrado es inmutable. Egresos, ingresos y ganancia neta del día en una
sola pantalla.

### 👥 Clientes y cuenta corriente

Fiado bien resuelto — el diferencial que la mayoría de los sistemas hace mal.
Ficha por cliente con historial, saldo, pagos parciales a cuenta, anticipos, límite de
crédito, recargo por mora y plazo configurables. Sabés a quién llamar y por cuánto.

### 📥 Remitos y órdenes de compra

Cargás el remito del proveedor (CSV o pegado) y el sistema **aprende los nombres**:
"REM. NEG. T2" queda asociado a tu producto para siempre. Sugiere el match, sugiere la
categoría, y al aprobar impacta precios, stock y alias en una sola operación
transaccional e idempotente — apretar dos veces no duplica el stock.

### 🌐 Catálogo web público

Tu vidriera online, con tu logo, tus colores y tu WhatsApp. Categorías en árbol,
filtros, banner y marquee de promos configurables desde el panel. El cliente arma el
carrito y el pedido llega a tu WhatsApp ya escrito, con detalle exacto.

### 🔐 Roles y permisos

Admin, encargado y vendedor, con permisos granulares (por ejemplo: ocultar costos y
rentabilidad al staff). Trazabilidad de cada venta, anulación y baja de stock por
usuario.

### 📉 Bajas y mermas

Roturas, robos, vencimientos y devoluciones registradas con motivo y origen, para que
la pérdida de capital sea un número y no una sorpresa.

### 🎨 Marca blanca

Nombre, logo, contacto, textos, visibilidad de precios y stock: todo se cambia desde el
panel, sin tocar código.

---

## Stack

Next.js (App Router, Server Actions) · TypeScript · Supabase (PostgreSQL, RLS, JSONB,
Storage, Auth) · Tailwind CSS · shadcn/ui · Zustand · Vercel.

Decisiones que importan: toda operación que toca plata se **revalida en el servidor**,
el stock se mueve con UPDATE atómico condicional, y todos los comercios comparten UNA
base, aislados por `negocio_id` con Row Level Security.

Las decisiones de arquitectura, los invariantes y los incidentes que las motivaron
empiezan en [`AGENTS.md`](AGENTS.md): las reglas generales y un índice que dice qué
documento de [`docs/`](docs/) leer antes de tocar cada tema.

---

## Puesta en marcha (desarrollo)

```bash
git clone <repo>
cd comerz-pos
npm install
npm run dev
```

Variables mínimas en `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_ROOT_DOMAIN=
NEXT_PUBLIC_SITE_URL=
```

Opcionales según la feature: `SUPABASE_SERVICE_ROLE_KEY`, `ARCA_CLAVE_CIFRADO`
(facturación), `RESEND_API_KEY` / `MAIL_REMITENTE` / `MAIL_RESPONDER_A` (mails),
`CATALOGO_MAESTRO_SUPABASE_URL` / `CATALOGO_MAESTRO_SUPABASE_PUBLISHABLE_KEY`
(Catálogo Maestro de electro).

App en http://localhost:3000. Las migraciones viven en `supabase/migrations/` y se
aplican a la única base del SaaS: **una migración impacta a todos los comercios a la vez**.

### Arquitectura de carpetas

```
app/
  (dashboard)/   Rutas privadas (POS, stock, caja, clientes, reportes)
  (public)/      Catálogo público (por subdominio)
  admincomerz/   Panel del super admin de Comerz
  api/           Route handlers
  auth/          Login y alta
entities/        Tipos e interfaces compartidas
features/        Módulos: pos, stock, caja, clients, purchases, carga-rapida,
                 catalog, categories, promotions, payments, reports, config…
shared/          UI base, utils, stores, clientes de Supabase
supabase/        Migraciones SQL versionadas
```

`middleware.ts` protege las rutas (sin sesión → login) y resuelve el comercio activo.
Los permisos por rol los hace cumplir la base (`tiene_permiso` en las policies), no la UI.

---

## Contacto

Desarrollado por **Ignacio Weppler** para comercios que quieren dejar de adivinar cuánto
vendieron.
¿Querés verlo funcionando en tu negocio? Escribime.
