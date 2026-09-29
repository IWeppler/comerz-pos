# Comerz — Contexto del proyecto

POS + catálogo público, SaaS multi-tenant. Next.js + TypeScript + Supabase.
Deploy: Vercel, branch main.

**Cómo se usa este documento.** Acá están las reglas que valen para TODO el código,
el índice de documentos por tema y las guías para cambios que cruzan módulos. El
detalle de cada tema vive en `docs/` y **se lee ANTES de tocar ese tema**: la tabla
"Índice" dice qué documento abrir según el archivo, la tabla o la RPC que vas a
tocar. Si un cambio toca dos o más temas, empezá por "Cambios que cruzan módulos".

Cada tema vive en UN solo documento, sin copias: si una regla aparece en dos lugares,
uno de los dos está de más. La versión anterior de este archivo (todo en uno, con la
historia completa de cada decisión) está en el tag de git `agents-md-completo` y en
el commit que precede a esta reorganización.

EN PRODUCCIÓN REAL: en Evens la dueña (Evelyn, admin) y 3 vendedoras (Mara, Brisa,
Zunilda) lo usan a diario, igual que los demás comercios. **Cualquier cambio que toque
ventas, caja o stock es plata real.**

---

## Índice: qué leer antes de tocar qué

| Documento | Leelo antes de tocar… |
|---|---|
| [docs/ventas.md](docs/ventas.md) | `create-sale.ts`, `cancel-sale.ts`, `registrar-devolucion.ts`, `registrar_venta` / `anular_venta` / `registrar_devolucion`, `ventas`, `ventas_items`, `venta_pagos`, `devoluciones`, el POS, venta libre, recargo por método, promociones |
| [docs/caja-y-dinero.md](docs/caja-y-dinero.md) | `features/caja/`, `turnos_caja`, `egresos`, `ingresos_financieros`, `movimientos_financieros`, `cuentas_financieras`, transferencias, `metodos_pago.cuenta_destino_id`, arqueo, cualquier consulta que sume efectivo/cobros/saldos, las pestañas de /caja |
| [docs/cuenta-corriente.md](docs/cuenta-corriente.md) | `clientes.saldo_pendiente`, `cuenta_corriente_movimientos`, `registrar_cobro_cc`, vencimiento, mora, saldo a favor, `features/clients/` |
| [docs/stock-y-catalogo.md](docs/stock-y-catalogo.md) | `productos`, `producto_variantes`, `productos_stock`, `movimientos_stock`, precios, remitos (`aprobar_orden_compra`, conciliación), importación, carga rápida, categorías, catálogo público, venta por peso, rubros |
| [docs/facturacion.md](docs/facturacion.md) | ARCA, `comprobantes`, `emitir-comprobante.ts`, `determinar-comprobante.ts`, IVA del producto, cliente fiscal, exportaciones al contador |
| [docs/seguridad.md](docs/seguridad.md) | Una tabla nueva, una policy, un GRANT, una función SECURITY DEFINER, un permiso, lo que lee `anon` |
| [docs/alta-y-sesion.md](docs/alta-y-sesion.md) | `/auth`, callback, onboarding, middleware, token/claim, invitaciones, /admincomerz, embudo de alta, planes |
| [docs/insights.md](docs/insights.md) | El panel (`/`), /reportes, cualquier señal o métrica nueva |
| [docs/presupuestos.md](docs/presupuestos.md) | `features/presupuestos/`, cotizaciones, planes en cuotas, un `tipo_movimiento` nuevo en `venta_pagos` |

**Mapa rápido de carpetas**: `features/<módulo>/{actions,lib,ui}` (la lógica pura con
tests vive en `lib/`), `entities/` (tipos y lógica de dominio compartida),
`shared/lib` (criterios compartidos POS/server: recargo, unidad de venta, CUIT,
facturación, fiscal, temporada), `supabase/migrations/` (desde el baseline),
`supabase/reversals/` (reversiones a mano, nunca en `migrations/`).

---

## Cambios que cruzan módulos

Estas son las operaciones que tocan varios temas a la vez. Antes de cambiarlas, leé
TODOS los documentos que nombran, y verificá cada punto.

### Anular o devolver una venta
Lee: ventas + caja-y-dinero + cuenta-corriente + stock-y-catalogo (+ facturacion si
factura).
- El reintegro lo elige el dueño (`ventas.elegir_medio_devolucion`) y **el egreso de
  caja depende del medio del reintegro, no del cobro**. Reintegro en efectivo →
  egreso `tipo = 'DEVOLUCION'` (no es gasto). A cuenta (`SALDO_A_FAVOR`) → la plata
  no sale.
- Los cobros quedan siempre `ANULADO`; el arqueo cuenta los movimientos, no el estado.
- El crédito de CC es `least(deuda de la venta, saldo actual)`; lo ya pagado queda a
  favor. Nunca `ventas.monto_pendiente` (congelado).
- El stock vuelve por `ventas_items.variante_id` con `ajustar_stock_variante`
  (afuera de la transacción, compensación que no voltea la anulación).
- Caja arqueada: `SALDO_INSUFICIENTE_CAJA` si el cajón no alcanza; turno de otro día
  frena. Venta facturada: la NC se pide ANTES de la RPC.

### Agregar o cambiar una forma de cobrar
Lee: ventas + caja-y-dinero (+ cuenta-corriente o presupuestos si es deuda).
- Un método digital necesita cuenta destino (el trigger la crea si falta) y define
  `acreditacion_dias` → va directo a la cuenta o al puente `POR_ACREDITAR`.
- **Un `tipo_movimiento` nuevo en `venta_pagos`** se clasifica mal sin error en ocho
  consumidores que hoy asumen "cobro sin venta = cobro de CC" (lista en
  presupuestos.md). Discriminar por `tipo_movimiento`, nunca por `venta_id is null`.
- El fiado NO es fila de `venta_pagos` (esa tabla es plata que entró).
- Comisión (interna, sobre el bruto) y recargo (al cliente, sobre la base) son dos
  porcentajes distintos; el server recalcula siempre.

### Tocar una consulta que suma plata
Lee: caja-y-dinero (+ insights si es del panel).
- Efectivo del turno: cobros en efectivo **anulados incluidos** − egresos +
  transferencias e ingresos al cajón. `flujo_caja_turno`, `efectivo_actual_turnos` y
  `posicion_dinero` son el mismo número: cambian juntas.
- Ventas / ingresos / rentabilidad: solo NO anulados. Deuda: solo `saldo > 0`.
- Ganancia: solo egresos OPERATIVO restan (`egreso_impacto_resultado`); ingresos
  libres no suman al panel.
- Saldos: desde el ledger, nunca desde `turnos_caja.efectivo_esperado`.

### Tocar precios, stock o el catálogo que ve la venta
Lee: stock-y-catalogo + ventas (+ seguridad si lo lee `anon`).
- La venta cobra `variante.precio ?? producto.precio`; `null` significa "hereda".
  Quien escribe un dato espejado escribe los DOS lados.
- El stock se mueve por `variante_id`, con `ajustar_stock_variante` o dentro de las
  RPC; `movimientos_stock` lo registra solo si se declara el origen.
- Una columna nueva en lo que lee el catálogo necesita el GRANT a `anon` en la misma
  migración, o la tienda se cae entera.
- Un renombre masivo necesita que los celulares resincronicen.

### Crear una tabla nueva
Lee: seguridad (+ el documento del tema).
- `negocio_id` con DEFAULT `security.current_negocio_id()`, policy RESTRICTIVE con
  `(select security.current_negocio_id())`, índices por FK empezando por
  `negocio_id`. Si es hija de `ventas`, INSERT atado a que el padre sea visible.
- Para `anon` nace cerrada (default privileges); si el catálogo la necesita, GRANT
  por columna.
- Si guarda historia, sin FK dura al original (tiene que sobrevivirlo) y append-only
  por RLS si corresponde.

### Agregar un permiso
Lee: seguridad.
- Fila en `permisos` + asignación en `rol_permisos` para los roles que ya hacían eso
  (nadie pierde nada: los guards lo cuentan). La pantalla de roles lo muestra sola.
- La base lo tiene que exigir (policy o RPC). El botón escondido no es control de
  acceso: un server action es un endpoint.

### Aprobar un remito o pagar a un proveedor
Lee: stock-y-catalogo + caja-y-dinero.
- Todo el impacto (precios, stock, alias, IMEI, estado) va en `aprobar_orden_compra`,
  idempotente, con `REMITO_LINEAS_SIN_PRODUCTO` contra las líneas reales.
- El precio nuevo baja a las variantes que eran COPIA del vigente y deja rastro en
  `actualizaciones_precio` (lote REMITO).
- El pago al proveedor es un egreso `COMPRA_MERCADERIA` con `orden_compra_id`: sale
  del cajón pero NO resta ganancia (ya está en el costo de lo vendido).

### Abrir, operar o cerrar un turno de caja
Lee: caja-y-dinero (+ ventas si toca el POS).
- Abrir y cerrar escriben las dos patas (caja diaria ↔ Caja Grande) en el ledger; el
  cierre deja el saldo del turno en cero con el ajuste de arqueo como movimiento
  propio.
- Un turno de otro día frena venta, gasto de caja chica, devolución, anulación,
  ingreso y transferencia hasta cerrarlo; el cierre se fecha en el día del turno.
- El cierre firmado (`efectivo_esperado`, `diferencia`) nunca se reescribe; se
  corrige `efectivo_esperado_actual`.

### Dar de alta un comercio o un empleado
Lee: alta-y-sesion + seguridad + caja-y-dinero.
- `crear_negocio_con_owner` siembra cuentas de sistema, métodos de pago (el trigger
  les crea cuenta), categorías de gasto y todos los permisos al ADMIN.
- Crear el negocio y aceptar una invitación refrescan el token: el claim es una foto.

### Vender offline o sincronizar el catálogo
Lee: ventas + stock-y-catalogo.
- La venta offline es idempotente por id y puede cerrar contra un turno del mismo día
  (excepción a "turno de otro día"). No usa saldo a favor.
- El catálogo del celular es una copia: la venta resuelve por `varianteId`, y un
  cambio masivo de nombres o un borrado necesita que los dispositivos resincronicen.

---

## Mapa de tablas compartidas

Quién escribe y quién lee cada tabla que cruza módulos. Si vas a cambiar su forma o
su significado, revisá TODOS los lectores.

| Tabla / columna | La escriben | La leen (y qué suponen) |
|---|---|---|
| `venta_pagos` | `registrar_venta`, `registrar_cobro_cc`, `anular_venta`, correcciones de medio | Ledger (trigger), arqueo (`flujo_caja_turno`, `efectivo_actual_turnos`), `posicion_dinero`, acreditación, `resumen_gerencial_caja`, `resumen_financiero_periodo`, `rentabilidad_por_metodo`, panel, exportaciones, historial. **Suponen: es plata que entró; sin `venta_id` = cobro de CC.** |
| `venta_pagos.estado_pago_operacion` | `anular_venta` (siempre ANULADO), correcciones | Ventas/rentabilidad excluyen anulados; **el arqueo NO** (efectivo anulado sigue contando, lo resta el egreso). |
| `ventas.monto_pendiente` / `estado_pago = PARCIAL` | `registrar_venta` (congelado) | Antigüedad, CRM, detalle del cliente, mora, tickets. **Suponen: pendiente = fiado.** |
| `ventas.metodo_pago` | `registrar_venta`, `corregir_metodo_pago_venta` | Nadie debería agruparla: miente (usar `venta_pagos`). |
| `clientes.saldo_pendiente` | `registrar_venta`, `registrar_cobro_cc`, `ajustar_saldo_cliente`, anulación/devolución | Deuda (`> 0`), saldo a favor (`< 0`), vencimiento, mora, CRM. Con signo; se mueve con delta. |
| `egresos` | Modal de gasto, `anular_venta`, `registrar_devolucion` (tipo DEVOLUCION), pago a proveedor | Arqueo (todos), ganancia del panel (solo OPERATIVO), resumen del período, exportaciones, saldo de remitos, ledger. Anular BORRA la fila. |
| `movimientos_financieros` | Triggers sobre cobros, egresos, turnos, transferencias, ingresos; acreditación | Dinero, Movimientos, saldos de cuentas, validación de saldo de caja arqueada. Append-only. |
| `producto_variantes.stock` | `ajustar_stock_variante`, `aprobar_orden_compra`, `guardar_variantes_producto`, `eliminar_productos` | POS, catálogo público, panel, `movimientos_stock` (trigger). |
| `producto_variantes.precio` / `productos.precio` | Alta/edición, remito, actualización masiva | Venta (`variante ?? producto`), /stock, catálogo, WhatsApp, `productos_precio_efectivo`. `null` = hereda. |
| `productos_stock` | Espejo: se escribe junto con la variante (`ajustar_stock_legacy`) | Panel (deuda: todavía lee el espejo). |
| `comprobantes` | `emitir-comprobante.ts`, NC al anular | Ticket impreso, historial, exportaciones. Inmutable. |
| `turnos_caja.efectivo_esperado` | Cierre (congelado) | Historial como "lo firmado"; el número vigente es `efectivo_esperado_actual`. |

---

## La región importa y es la latencia más grande del sistema

La base está en **Ohio (`us-east-2`)** y las funciones en **`cle1`** (Cleveland), la
misma región de AWS: función y base a milisegundos. Hasta el 22/8/2026 `vercel.json`
fijaba `gru1` (San Pablo) creyendo que la base estaba ahí, y CADA consulta cruzaba el
continente (~120 ms × ~15 por venta). Verificado por el dashboard y por el IPv6 de
`db.<ref>.supabase.co` (`2600:1f16::/34` = us-east-2).
- El middleware corre en edge (cerca del usuario); lo que se mueve con la región son
  los Server Components y las Server Actions, donde vive la venta.
- La configuración ideal sería base + funciones en San Pablo, pero la región de un
  proyecto Supabase no se cambia: hay que migrar a uno nuevo. Pendiente.
- **Cualquier optimización de SQL rinde menos que un viaje de red ahorrado**: antes
  de indexar, contar round-trips. **Y antes de razonar sobre latencia, VERIFICAR
  dónde está cada cosa** en vez de confiar en un documento.

---

## UNA base, un repo, N negocios

Multi-tenant por `negocio_id` en una sola base Supabase (MCP ref `evens-project`).
**No hay otra base de la app**: un proyecto Supabase con tablas del POS que no sea
esta es un resto viejo. Única excepción: `catalogo_maestro`, padrón de electro de solo
lectura en otro proyecto.

- Toda tabla del tenant tiene `negocio_id` con DEFAULT
  `security.current_negocio_id()`; las policies RESTRICTIVE son el freno real.
- El negocio elegido va en la cookie `negocio_activo_id` y viaja a PostgREST como
  header `x-negocio-activo`. **La cookie NO es credencial**: la base valida contra
  `usuarios_negocios`.
- Pertenencia y rol son POR NEGOCIO (`usuarios_negocios`); `perfiles` es el usuario
  global. En el server: `negocio_actual()` y `rol_actual()`.
- Modo Dios: el super admin impersona con `x-impersonate-negocio`, honrado solo si
  `security.is_super_admin()`.
- El catálogo público se resuelve por subdominio (`negocio-slug.ts`), otro camino que
  el panel.

---

## Reglas de trabajo

- **Un cambio que toca código + schema NO está terminado hasta las 3 patas**: (1)
  migración aplicada en Supabase prod, (2) código commiteado, pusheado y deploy de
  Vercel exitoso, (3) smoke test real en producción. Hubo 3 incidentes por confirmar
  una sola.
- **Toda migración impacta a TODOS los negocios a la vez.** No hay release gradual:
  probar bien antes (en seco, dentro de una transacción revertida), preferir cambios
  aditivos y reversibles, y pensar en el negocio con 994 productos y en el de 11.
- **Lo que se aplica a mano y no queda como migración se pierde.** El repo tiene que
  poder reconstruir el schema.
- **Las migraciones arrancan en un BASELINE** (29/9/2026):
  `20260929120000_baseline.sql` (dump de producción) +
  `20260929120001_baseline_datos_y_storage.sql` (permisos, planes, Storage). Las
  anteriores y sus reversiones están en el tag `migraciones-pre-baseline`: **las
  versiones viejas que citan los documentos (`20260816100000`, etc.) se buscan ahí**
  (`git ls-tree --name-only migraciones-pre-baseline supabase/migrations/` y
  `git show migraciones-pre-baseline:supabase/migrations/<archivo>`). El MCP registra
  cada migración con la hora de aplicación, no con la del archivo. Una base nueva
  necesita además, a mano, el Custom Access Token Hook
  (`public.custom_access_token_hook`).
- **`create or replace function` no avisa de nada.** Reescribir una función se hace
  desde el cuerpo VIVO (`pg_get_functiondef`), nunca desde el último archivo que la
  tocó ni desde el baseline. Para cambios chicos: `replace()` sobre el cuerpo vivo +
  `execute`, con guard de que cada reemplazo matchea exactamente una vez y de que lo
  crítico (permiso, `SECURITY DEFINER`, filtros) sigue ahí. `20260819180039` se llevó
  puestas dos funcionalidades por reescribir desde una copia vieja.
- **Cambiar el tipo de un parámetro con `create or replace` crea una SOBRECARGA** y
  PostgREST elige "a veces" la vieja. DROP explícito y guard de que queda una.
- **Las migraciones llevan guards que abortan** si el resultado no es el esperado
  (invariantes, conteos antes/después, forma de las policies). Un guard que falla es
  una migración que no rompió producción.
- Reversiones en `supabase/reversals/`, nunca en `migrations/` (el CLI las correría).
- **No commitear sin pedido explícito**: los cambios quedan en el working tree para
  revisión.

---

## Reglas que valen para todo el código

**Datos y consistencia**
- **Un dato duplicado en dos tablas se desincroniza, y el que manda no es el que se
  ve.** El que escribe un dato espejado escribe los DOS lados o ninguno, y antes de
  calcular sobre un precio, stock o saldo se verifica cuál copia usa la venta.
  (Precio de cabecera vs variante; `productos_stock` vs `producto_variantes`.)
- **`null` es un valor con significado** ("hereda", "no se sabe"). No se reemplaza por
  una copia ni por 0 "por las dudas". Un default que adivina es una suposición
  disfrazada de dato: si no se sabe, se guarda que no se sabe.
- **Congelar en la fila lo que tiene que sobrevivir a un cambio de configuración**
  (recargo en `venta_pagos`, receptor en `comprobantes`, condiciones de un plan). Los
  historiales, sin FK dura al original.
- **Fail-closed por default** (tipo desconocido = no elegible, sin cuenta = pide
  cuenta), salvo donde el lado seguro es MOSTRAR (etiquetas de movimientos,
  temporada): esconder plata o mercadería en silencio es peor que una fila de más.
- **Un criterio, un módulo.** Cuando la misma pregunta se contesta en TS y en SQL, hay
  un espejo declarado y los dos dicen lo mismo (con tests). Dos funciones que
  responden lo mismo con distinta información terminan en dos respuestas distintas.

**Escrituras**
- **Plata y stock en transacción, en RPC.** Varias escrituras sueltas desde Node dejan
  puntos intermedios (venta sin pagos, cobro sin saldo). Lo que queda afuera de la
  transacción es solo lo que es compensación y se revierte explícitamente.
- **UPDATE condicional + chequeo de filas afectadas ANTES de cualquier escritura
  derivada.** Un `select` previo no sirve: dos llamadas concurrentes leen lo mismo.
  Idempotencia con un guard que toma el row lock primero y devuelve "ya hecho" como
  resultado normal, o con un id generado por el cliente.
- **Un UPDATE/DELETE filtrado por RLS es un ÉXITO silencioso**: PostgREST devuelve 0
  filas y `error: null`. Todo update que el usuario cree que guardó algo lleva
  `.select("id")` y chequeo de filas. (5/9/2026: 35 fotos perdidas con "Foto
  guardada" en pantalla.)
- **Un UPDATE que no falla no es un UPDATE que hizo algo**: un trigger con lista de
  columnas no se despierta si el UPDATE toca otra. Verificar con el número, no con el
  log.
- **Descartar filas en silencio antes de escribir es perder datos** (`.filter()` antes
  de un INSERT costó 213 líneas de remito sin stock). Si sobran filas, se falla con
  los nombres puestos. **La validación que cuenta es la que mira la BASE**, no el
  estado del cliente.
- **Timeout de UI ≠ cancelación**: `withTimeout` solo rechaza la promesa del cliente y
  el server sigue. Nunca alrededor de algo que mueve stock o plata (stock ×8 el 27/7).
- **Validación espejo en el server siempre** para todo lo que toque plata: precio,
  cantidad, tipo de comprobante, tope de un cobro. Lo que viene del navegador se elige
  con las DevTools abiertas.

**Seguridad** (detalle en docs/seguridad.md)
- **El aislamiento entre negocios Y entre roles es RLS**, no el código. Tabla nueva sin
  policy = un negocio viendo a otro.
- **Policy**: `negocio_id = (select security.current_negocio_id())` y
  `(select public.tiene_permiso('...'))`, con subselect. `same_negocio(negocio_id)`
  corre por fila y apaga el índice.
- **SECURITY DEFINER filtra `negocio_id` en CADA consulta a mano**, hijas incluidas.
  Preferir INVOKER si alcanza con la RLS de quien llama. Al revocar EXECUTE, nombrar
  `anon` y `authenticated`, no solo `public`.
- **Antes de restringir una tabla, buscar quién la escribe siguiendo el código**, no la
  UI.

**Rendimiento**
- Toda tabla del camino de la venta necesita índice por sus FK, compuestos empezando
  por `negocio_id` (`venta_pagos` llegó a leer 92 millones de filas sobre 623).
- Paginar ANTES de enriquecer; los filtros que necesitan otra tabla van con EXISTS.
- PostgREST corta en 1.000 filas: "faltan productos" casi nunca es un borrado.

**Diagnóstico**
- **Un rebote infinito es casi siempre dos fuentes que se contradicen** (el claim del
  token contra la base, un conteo contra otro): buscarlas antes que el redirect.
- **Medir antes de decidir y dejar la medición en el documento** con fecha: un umbral
  sin dato es una intuición.
- **Un síntoma real puede tener una causa equivocada** (la región): verificar la
  premisa, no solo el síntoma.

**UI**
- `Suspense` con `fallback={null}` alrededor de una pantalla entera es una pantalla en
  blanco: la boundary va alrededor de lo que suspende, con un esqueleto.
- Mobile primero: el mostrador es un celular. Tablas que se apilan con `data-label`,
  blancos táctiles de 44px.
- Un día es el día comercial argentino (`diaComercial`, `rangoDiaComercial`), nunca UTC
  ni el huso del navegador.

---

## Plataforma y egress

Auditado el 16/9/2026 sobre 24 h de logs: sin culpable grande tras la sync por delta
del catálogo (`catalogo-delta.ts`). El panel pide ventas con ventana
(`ventana-historial-panel.ts`) y el índice del catálogo público lee del mismo
`unstable_cache` que el render. El tramo Vercel → Supabase viaja gzip (~6:1). Lo que
cuesta requests (no bytes): polling de caja, `tiene_permiso` por permiso,
`unidades_serie` en cada cambio del carrito, ~10 consultas de layout por navegación.

---

## Backlog de producto (no empezado)

- **Multi-sucursal**: el Plan Empresa lo vende y no existe. Es UN negocio con varias
  ubicaciones (catálogo y clientes compartidos, stock por depósito): un `sucursal_id`
  bajo `negocio_id`, no otro tenant.
- **Asistente de orden de compra**: "qué comprar y cuánto" desde ventas + stock mínimo
  + stock actual; determinístico, la IA solo redacta. Respeta temporada y compara
  contra la categoría (ver docs/insights.md).
- **IVA**: débito / crédito / neto. Depende de ARCA y de compras con datos fiscales.
- **Región**: migrar a un proyecto Supabase en San Pablo con funciones en `gru1`.
- **Lotes y vencimientos**: tabla de lotes (farmacia, alimentos, sell-through).
