# Stock y catálogo: variantes, precios, remitos, importación

Leé esto antes de tocar `productos`, `producto_variantes`, `productos_stock`,
`movimientos_stock`, `ordenes_compra` / `ordenes_items`, `aprobar_orden_compra`,
`guardar_variantes_producto`, `features/stock/`, `features/purchases/`,
`features/carga-rapida/`, el catálogo público (`/store`) o la venta por peso.

## Variantes y stock

- **`producto_variantes` es la fuente canónica** (atributos JSONB + relación
  `producto_variante_valores`). **`productos_stock` es espejo legacy**: se mantiene
  sincronizado en cada escritura y NUNCA se normaliza su texto. Se mueve con
  `ajustar_stock_legacy` (delta en un statement), nunca leyendo y escribiendo.
- **El stock se descuenta con UPDATE atómico condicional** vía
  `ajustar_stock_variante`, por `variante_id`, nunca por nombre. Toma `p_origen` /
  `p_referencia_id` para `movimientos_stock`. **OJO**: es plpgsql y sus OUT params
  `id`/`stock` SOMBREAN las columnas; sin `#variable_conflict use_column`,
  `set stock = stock + p_delta` es "column reference is ambiguous" y se cae la venta.
- **Ediciones de producto: todo el ciclo en `guardar_variantes_producto`**
  (chequeo + delete + reinsert + auditoría, transaccional). Freno: si el payload trae
  menos variantes de las que existen, se rechaza.
- **Identidad de variante: `atributos_comparables`**, la misma función del índice
  único `idx_variante_identidad`. Comparar el JSONB crudo deja pasar "Marron" vs
  "MARRON".
- **Normalización de atributos**: siempre `normalizarAtributoKeyValor` /
  `canonicalizarValores` (slugify compartido), en alta manual Y en conciliación
  (`merge-purchase.ts`).
- **`producto_variantes.sku` tiene índice pero NO es único y no puede serlo**: en
  electro es el EAN de la unidad y en indumentaria el código del MODELO que
  comparten todos los talles.
- **Auditoría**: `actualizaciones_precio_items` (precios, con `variante_id`) y
  `producto_variantes_auditoria` (snapshot por guardado: CREADA / ACTUALIZADA /
  ELIMINADA / BLOQUEADO_FALTANTE), SIN FK dura — sobreviven al original.
- **Merge de variantes: reapuntar `ventas_items.variante_id` ANTES de borrar.** No
  tiene FK, así que el DELETE no avisa y la anulación vuelve a depender del nombre.
  El movimiento de stock se registra con origen `EDICION_VARIANTES` (el nivel cambió
  de verdad), sin apagar el trigger.

## `movimientos_stock`: la historia del nivel (`20260823182514`)

`producto_variantes.stock` es un escalar que se pisa; esta tabla guarda cada cambio.
- **La escribe un TRIGGER sobre `producto_variantes`**, no cada RPC: un camino que
  se olvida de registrar es un agujero que se descubre meses después. Anterior/nuevo
  salen del propio UPDATE (exactos con dos cajas a la vez).
- **El porqué viaja en `comerz.origen_movimiento`, transaction-local**
  (`is_local => true`: con `false` una venta le pondría origen VENTA al remito que se
  apruebe después en la misma conexión del pool). Sin declarar queda DESCONOCIDO, que
  es la verdad.
- Append-only por RLS (SELECT e INSERT, sin UPDATE/DELETE). Sin FK a la variante.
- `aprobar_orden_compra` y `guardar_variantes_producto` están detrás de wrappers
  (`_impl` es la original) que declaran el origen. El guardado de variantes BORRA y
  reinserta todo: el wrapper apaga el trigger (`comerz.omitir_movimiento`) y
  registra el NETO por `atributos_comparables` (si no, 9 talles = 18 movimientos y 9
  ceros falsos).
- **Borrar un producto pasa por `eliminar_productos(uuid[])`** (`20260909150000`,
  origen `BAJA_PRODUCTO`): declara el origen y borra en la misma transacción.
  INVOKER a propósito (quién borra lo decide la RLS, `stock.eliminar_producto`) y
  devuelve el conteo porque un DELETE filtrado por RLS vuelve 0 filas sin error.
  `BAJA_PRODUCTO` ≠ `BAJA` (merma de la tabla `bajas`).
- `FOTO_INICIAL` (23/8/2026) es el punto de partida; lo anterior no es
  reconstruible.
- No cubre: `importar_productos_planilla` (sin origen) ni `BAJA` (nada aprueba
  `bajas`: `createBajaAction` inserta siempre PENDIENTE). La tabla todavía no se
  muestra: `get-movimientos-stock.ts` reconstruye desde remitos, ventas y bajas.
- `ordenes_items.producto_id` es ON DELETE SET NULL: borrar un producto blanquea sus
  líneas de remito. `variante_match` lleno + `producto_id` null = "entró y después se
  borró", no "nunca entró".

## Precios: un producto tiene DOS y en la venta gana la variante

- `productos.precio` (cabecera) y `producto_variantes.precio`; la venta y el
  catálogo usan `precioBaseDeVariante` = `variante.precio ?? producto.precio`.
- **`null` es un valor con significado: "heredo del producto".** Escribirle a una
  variante el mismo número "por las dudas" fabrica una copia que se desincroniza. Por
  eso la actualización masiva (`update-prices.ts`, `20260908200000`) toca solo
  variantes con precio PROPIO, columna por columna; `actualizaciones_precio_items`
  acepta null (con NOT NULL, "heredaba" y "valía 0" se guardaban igual y deshacer
  dejaba productos a $0); y `revertirPreciosAction` ya no tiene el fallback "revertí
  todas". Hoy ~1% de las variantes tiene precio propio real (p. ej. Maní con Sal por
  peso).
- **El remito baja el precio nuevo a la variante cuyo precio era una COPIA del
  vigente** y respeta la que decía otra cosa, contándola en `variantes_conservadas`
  (`20260908190000`). La comparación va contra el precio EFECTIVO viejo.
- **Precio efectivo**: vista `productos_precio_efectivo` (`20260908180000`), que lee
  la conciliación. Solo hay efectivo si TODAS las variantes tienen el suyo y dicen lo
  mismo; si no, `precios_dispares`. **No se promedia ni se toma el mínimo.** Espejo
  TS: `features/stock/lib/precio-efectivo-producto.ts`; los dos dicen lo mismo.
- **/stock muestra el precio de las VARIANTES, no el de la cabecera** — "uniforme" no
  quiere decir "igual al producto". El badge "precio por variante" sale solo cuando
  el número mostrado no es el de cabecera. WhatsApp también usa el efectivo.
- **"Usar este precio en todas"** (`precio-en-todas-las-variantes.ts`) VACÍA el
  precio propio, no lo copia. Deshacer con snapshot tomado ANTES y FUERA del updater
  de setState (en StrictMode corre dos veces).
- **El remito deja rastro de precios** (`20260908190000`): abre su lote en
  `actualizaciones_precio` (`tipo_operacion = 'REMITO'`), perezoso. El fallback legacy
  de `revertirPreciosAction` queda apagado para REMITO.

## Ingreso de mercadería: UN camino

- **"Ingresar mercadería" (`ingresar-mercaderia-modal.tsx`) igual para todos los
  rubros**; adentro se elige el ORIGEN (planilla del proveedor o propia) y los dos
  terminan en la misma conciliación (/compras/merge). La planilla propia también se
  concilia: con 300 productos nadie se acuerda si algo ya existe escrito distinto.
- **Un solo motor de escritura de stock por ingreso: `aprobar_orden_compra`**, en
  transacción y en batch (antes ~1.500 round-trips). Hace precios + stock + alias +
  estado + unidades con IMEI.
  - **Guard de idempotencia PRIMERO** (`update ... where estado <> 'APROBADA'` +
    `if not found`): toma el row lock y devuelve `{ya_aprobada: true}` como
    resultado normal.
  - **`REMITO_LINEAS_SIN_PRODUCTO`** (`20260908130000`) compara contra
    `ordenes_items` REAL: antes un `.filter(item => item.producto_id)` descartaba
    líneas sin vincular y la orden quedaba APROBADA sin stock (213 líneas, ~$2,8M).
  - La canonicalización de atributos se queda en Node; la RPC recibe `atributos` ya
    canonicalizado.
  - **Se perdió una vez**: `20260819180039` reescribió la función entera desde una
    copia vieja y borró las `unidades_serie` y el guard de atributos vacíos. Hay guard
    de que el cuerpo los conserve.
- `ordenes_compra.hash_planilla` (unique parcial por negocio) frena crear dos órdenes
  del mismo archivo.
- **Nunca `withTimeout` alrededor de una acción que mueve stock o plata**: solo
  rechaza la promesa del cliente y el server sigue. 8 reintentos = stock ×8 en Estilo
  Bonito (27/7).

## Conciliación de remitos

- **Dos modos, el default lo decide el dato** (`modo-conciliacion.ts`): CARGA INICIAL
  (toda fila arranca como producto nuevo, tabla editable) cuando el catálogo tiene
  menos de 20 productos publicados o menos del **70%** de los GRUPOS ya existen;
  CONCILIACIÓN en el resto. Medido: de 2.053 grupos conciliados solo el 1,1% terminó
  asociado a un producto existente. El modo elegido queda en el borrador.
- **En CONCILIACIÓN la acción principal es crear en lote.** Incluye los AMBIGUO con
  categoría elegida; **los que tienen candidato (POSIBLE_MATCH) quedan afuera**: crear
  pisando un candidato sin mirarlo fabrica el duplicado que la pantalla evita. El
  conteo va desglosado ("creo 34, quedan 12").
- **Se muestran TODOS los candidatos**, y con `hayEmpate` (`afinidad-nombre.ts`) la
  pantalla no recomienda y muestra la diferencia de nombre.
- **Carga inicial agrupa por nombre + MARCA + GÉNERO** y todo llega PRELLENADO:
  categoría inferida (`inferir-categoria-fila.ts`, cuatro escalones; diccionario
  genérico `terminos-por-rubro.ts`), precio = costo × recargo (default 100%). Costo y
  cantidad se editan.
- **Creación en lote idempotente por `ordenes_items.producto_id`**
  (`crear_productos_desde_remito`, `20260904120000`), escrito ANTES del stock; el
  stock lo sigue impactando `aprobar_orden_compra`. Row lock sobre la orden.
- **El progreso vive en la base** (`ordenes_borradores`, payload con `modo`); el de
  IndexedDB gana cuando están los dos.
- Las tablas **se apilan en mobile** (`data-label` para el rótulo; `before:content`
  no funciona sobre `<input>`).
- **La foto no está en el camino del alta**: se cuenta el pendiente (banner +
  `/stock/fotos-pendientes`).

## Plantilla por rubro

- Lo que cambia por RUBRO son las COLUMNAS, no el flujo
  (`features/stock/lib/columnas-por-rubro.ts`). Las base son iguales; lo específico se
  AGREGA. Cada columna declara si parte variantes. El parser reconoce las de TODOS
  los rubros. No existen `vencimiento` ni `lote` (no hay tabla de lotes).
- **`configuracion_pos.rubro`** tiene 7 valores con CHECK. Cambia la identidad en la
  UI (`identidad-por-rubro.ts`: indumentaria "N var.", electro Modelo + EAN), no el
  schema. `normalizarRubro` cubre los 7.
- **El GÉNERO no es un atributo de variante, es la categoría de arriba**
  (HOMBRE › ZAPATILLAS). Viaja como `raw_genero` hasta `resolverCategoriaImport`.
  Única excepción: Ropa Bebé (Bebé/Beba sí es un eje). Se limpió en
  `20260904160000`. Alias de la columna en `shared/lib/alias-columna-genero.ts`,
  compartido por los DOS importadores.
- **Importación de planilla DIRECTA** (`importar_productos_planilla`): sin punto de
  entrada desde que se unificó el ingreso; se conserva. Tenía idempotencia por hash
  del contenido parseado (`importaciones_productos`, unique parcial), plan firmado
  (`firma-plan-import.ts`: si cambió al confirmar, no escribe) y permiso
  `stock.importar_planilla`.

## Venta por peso (`20260819120000`, `130000`, `140000`)

- **La cantidad es `numeric(12,3)` para todos; el comportamiento es del PRODUCTO**,
  vía `productos.unidad_medida` y `shared/lib/unidad-venta.ts` (`esFraccionable`:
  KG/GRAMO/LITRO/METRO sí, UNIDAD/PAR no). Nunca por rubro: un kiosco vende la
  gaseosa por unidad y los caramelos por 100 g. Con UNIDAD todo es bit a bit como
  antes.
- `ajustar_stock_variante` se DROPeó y recreó: cambiar el tipo con `create or
  replace` crea una SOBRECARGA y PostgREST elige a veces la vieja. Guard de que queda
  una.
- `CantidadControl`: stepper por unidad, teclado por peso, "cobrar por importe".
  `parsear-numero-es.ts` tiene DOS parsers ("1.500" es 1,5 kg o $1.500). El redondeo
  se hace una vez, sobre el total de la línea.
- `alimentos` nace en UNIDAD a propósito (`defaultsFiscalesPorRubro`).
- Pendiente: balanza etiquetadora (EAN-13 prefijo 20–29, formato configurable por
  marca; serie/USB fuera de alcance), bultos para kiosco (`unidades_por_bulto` por
  `aprobar_orden_compra`), farmacia (troquel; lote/vencimiento necesita tabla de
  lotes). Abiertas: `ventas.cantidad` mezcla kg y unidades, stock negativo por
  merma, alícuota de la carne (confirmar con el contador).

## Catálogo

- **Categorías en árbol de 2 niveles** (`parent_id`), tolerante a estado mixto.
  `shared/utils/category-tree.ts` separa resolución de slug (sin conteos, para que un
  link viejo resuelva) de construcción del árbol.
- **`categorias.temporada`** (`20260823185816`) sirve SOLO para silenciar, nunca para
  sugerir (ver [insights.md](insights.md)). OJO: la columna es NOT NULL y el upsert
  de PostgREST arma el UPDATE con la UNIÓN de claves del lote, así que `temporada`
  (igual que `imagen_url`) va SIEMPRE en el payload de `build-categorias-payload.ts`.
- **Catálogo Maestro** (`catalogo_maestro`): OTRO proyecto Supabase, solo lectura
  por RLS, padrón compartido de fichas de electro. Carga Rápida busca por EAN y por
  texto (`word_similarity` + ranking). Los datos se COPIAN al producto;
  `productos.id_master` es trazabilidad SIN FK.
- **Catálogo público**: el negocio se resuelve por subdominio (`negocio-slug.ts`) y
  del HEADER que escribe el middleware, nunca de un parámetro (la clave del cache es
  el `negocio_id`). El índice lee del mismo `unstable_cache` que el render. El panel
  sincroniza el catálogo por DELTA (`catalogo-delta.ts`). Lo que `anon` puede leer:
  ver [seguridad.md](seguridad.md).
- **El catálogo público no descuenta reservas** (`anon` no tiene policy sobre
  `reservas`; la consulta vuelve vacía a propósito). Y una reserva tampoco frena la
  venta en el server: `ajustar_stock_variante` no conoce `reservas` (ver
  [presupuestos.md](presupuestos.md)).

## Renombrar variantes en producción

El nombre también vive en el catálogo cacheado de cada celular. Tras un renombre
masivo, los dispositivos sin resincronizar mandan el nombre viejo. La venta ya
resuelve por `varianteId`, pero **un renombre masivo necesita además que los
dispositivos refresquen**: la migración bumpea `updated_at` y el delta lo trae en el
próximo sync; si es de nombres, avisar que recarguen el POS. Una variante BORRADA no
se puede vender desde un catálogo viejo ni con el fix.
