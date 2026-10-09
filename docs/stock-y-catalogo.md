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

### Ajustes por marca y aplicación transaccional (`20261007160000`, aplicada el 7/10/2026)

- Alcances TODOS / CATEGORIA / SELECCION / MARCA. Las marcas se agrupan por NFD sin
  diacríticos, minúsculas y espacios colapsados/recortados. El filtro usa ese mismo
  criterio; los signos `%` y `_` son literales. Espejo TS/SQL:
  `marcas-del-catalogo.ts` / `normalizar_marca_precios`.
- `actualizaciones_precio.alcance_valor` congela la escritura de la marca o el nombre
  de la categoría. NULL significa que el alcance no tiene un valor.
- `aplicar_ajuste_precios` y `revertir_ajuste_precios` son nuevas RPC INVOKER:
  exigen admin en la base, respetan RLS, filtran negocio y escriben todo en una
  transacción. Aplicar recibe regla + ids, recalcula desde la base y chequea filas.
  Si cambiaron los precios desde la simulación, aborta y pide simular otra vez.
  El UUID de solicitud evita repetir un aumento ante un reintento; aplicar y deshacer
  se serializan por negocio y toman locks de productos/variantes en orden estable.
- Se conserva la regla anterior de variantes: solo columnas con valor propio reciben
  el nuevo valor de cabecera; lo heredado queda NULL. Deshacer restaura SOLO las filas
  auditadas, incluso NULL; una variante eliminada nunca se trata como producto.
- `ajuste-precios.ts` y `calcular_ajuste_precio` comparten casos de prueba para %,
  recargo sobre costo y seis redondeos. TS calcula con decimales exactos (BigInt):
  $200 + 10% redondeado a $10 es $220, sin el salto binario a $230. Se valida porcentaje finito, no negativo, con
  hasta dos decimales; reducción hasta 100%. COSTO + FIJAR_MARGEN se rechaza.
- Simulación, marcas, auditoría e historial se leen paginados, ordenados por id;
  los filtros por ids se parten en 200. Una lectura truncada o fallida aborta la
  simulación. Medido en producción el 7/10/2026 (prueba en seco, como admin y con
  el `statement_timeout` de 8 s de `authenticated`): aumento a TODO Evens, 1.542
  productos + 45 variantes con precio propio, 2,1 s; deshacer, 0,8 s.
- **"Recargo sobre costo" rechaza productos sin costo** (`SIN_COSTO_PARA_RECARGO`,
  espejo `productosSinCostoParaRecargo`): con costo null o 0 el precio quedaba en
  $0 y el POS y el catálogo lo vendían a $0. La simulación ya lo frena nombrando
  hasta 5. Medido: Librería Colores 795 productos sin costo, El Nono Cacho 91 de 92.
- Validación local: `scripts/verificar-ajustes-precios.mjs` levanta PostgreSQL temporal
  con tablas del baseline y roles simulados. Prueba 15 cálculos compartidos, tenant,
  admin, NULL heredado, reintento idempotente, RLS que filtra UPDATE, error intermedio
  con rollback, categoría en transacción revertida y aplicar/deshacer 1.542 productos.
  La UI se verificó a 390 px con sus componentes reales y acciones ficticias;
  esto no reemplaza el smoke en producción.
- Reversión manual en `supabase/reversals/`. Smoke pendiente tras el deploy:
  aplicar/deshacer por marca en un comercio de prueba.

### Precio unitario por tramo de cantidad (8/10/2026)

Estado: migración `20261009010453_precios_por_cantidad` aplicada en producción;
código local para revisión, sin commit/deploy ni smoke de venta en producción.

- Configuración en alta/edición del producto → **Precios por cantidad**. Vive en
  `productos.precios_por_cantidad`: hasta 20 pares `{desde, precio}`, mínimos enteros
  positivos, crecientes y únicos; importes absolutos positivos con hasta dos
  decimales. `[]` conserva el precio habitual. Quitar todos los tramos desactiva
  la regla; un formulario que no manda el campo conserva lo guardado.
- Debajo del primer mínimo se cobra `variante.precio ?? producto.precio`, con la
  lista elegida. El tramo elegible reemplaza ese precio de lista y se aplica a
  TODAS las unidades: 12 fotocopias con tramo desde 10 a $220 = $2.640. Después
  se calculan las promociones según las condiciones existentes, incluido
  `lista.admite_promociones`. No es un descuento por porcentaje ni marginal.
- Los importes son del producto y se usan en todas sus variantes; las cantidades
  se suman por variante real, incluso con renglones duplicados o un nombre viejo.
  No se mezclan otros productos/variantes. Servicios con escalas distintas se
  cargan como productos distintos. Packs/baldes mantienen su precio por
  presentación y no participan de la cantidad de la unidad base.
- POS y catálogo público comparten `precio-por-cantidad.ts`; el carrito calcula
  al agregar, quitar, cambiar cantidades/listas/formas y restaurar tickets. En
  las líneas con tramos se puede tocar la cantidad y escribir 100 directamente;
  el diálogo muestra el total antes de aplicar y respeta el tope de stock.
  También permite unidades fraccionables, con mínimos de tramo enteros.
  No admite fijar importe: se vende indicando la cantidad, para evitar el ciclo
  importe → cantidad → otro precio. Una configuración nueva limpia un importe
  fijado previamente. Venta libre conserva su comportamiento.
- `create-sale.ts` agrupa cantidades validadas por la variante resuelta en la base
  y calcula desde la configuración vigente ANTES de cobrar/mover stock. Offline
  conserva el precio ya cobrado y registra el desfasaje, como antes. El unitario
  vendido queda congelado en `ventas_items.precio_unitario`/`precio_final`: cambiar
  tramos no reescribe ventas, devoluciones ni margen históricos.
- El catálogo del celular recibe el campo en el select compartido y la sync por
  delta (el trigger vivo de productos actualiza `updated_at`). Se resincronizan
  las reglas de los tickets abiertos al recibir el catálogo. Los pedidos internos
  por cobrar conservan el snapshot y se revalidan al vender. Presupuestos siguen
  cotizando a precio base, igual que las listas y promociones pendientes allí.
- SQL valida la forma con CHECK, espejo del validador TS. La columna hereda el
  aislamiento RESTRICTIVE de productos y tiene GRANT SELECT a `anon`, sin costo.
  Un trigger INVOKER exige `stock.editar_producto` si authenticated cambia los
  tramos: las policies vivas de UPDATE de productos todavía no piden ese permiso.
  No se reescribió ninguna RPC de ventas/stock.
- Medición y prueba en seco en producción el 8/10: migración completa en
  transacción revertida, guardar como ADMIN, bloqueo tras retirar el permiso
  del rol del Kiosco Demo SOLO en la transacción revertida, UPDATE ajeno = 0,
  SELECT anónimo con costo denegado. Repetidas tras aplicar; 4.149 productos,
  ninguno configurado automáticamente. SQL repetible en
  `scripts/verificar-tramos-produccion.sql`, siempre con BEGIN/ROLLBACK.
  Advisors: ningún hallazgo sobre los objetos nuevos. Reversión manual en
  `supabase/reversals/20261009010453_precios_por_cantidad.sql`.
- Validación local: suite completa 196 archivos / 2.094 tests; casos adicionales
  de suma fraccionada y limpieza de importe fijado en la suite enfocada. TypeScript
  y lint de los archivos nuevos/modificados sin errores nuevos (create-sale ya
  tenía `JSON.parse(cartData) as any[]`, señalado por ESLint). Componentes reales
  con datos ficticios en navegador a 360/390 px: 12 × $220, bajar a 9 × $250,
  tipear 100 × $180 en el editor, duplicados rechazados y sin desborde horizontal.
  No sustituye la prueba en celular físico ni el smoke posterior al deploy.

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

## IMEI / números de serie (`unidades_serie`, `productos.lleva_serie`)

- Una unidad nace por remito/planilla con columna IMEI, a mano desde la edición
  del producto (`features/stock/actions/unidades-serie.ts`) o tipeada en el POS al
  vender. Nace `disponible` y NO mueve stock: el aparato ya está contado en la
  variante. Solo se borra si está disponible y nunca se vendió.
- **Qué exige el server**: `create-sale` pide una unidad por aparato vendido, hasta
  las disponibles de la variante (con 1 con IMEI y 2 vendidos, el segundo sale sin
  número).
- **Qué lleva IMEI** (`20261007120000`): el producto (`productos.lleva_serie`), su
  categoría o la categoría padre (`categorias.lleva_serie`, switch con el ícono de
  código de barras en Configuración › Categorías). El criterio vive UNA vez en SQL:
  `productos_llevan_serie` / `variantes_llevan_serie` / `categorias_llevan_serie`;
  el POS, create-sale, la conciliación, la ficha y el historial lo consultan, nadie
  lo reescribe en TS. Por categoría y no por rubro (un electro vende fundas). El
  trigger `unidades_serie_marca_producto` sigue prendiendo la marca del producto al
  cargar cualquier unidad. Caso que lo originó: ClickTostado 1-18 (6/10/2026), un
  Redmi cargado sin IMEI (carga masiva) que el POS vendió sin pedir nada.
- **Un celular nace pidiendo IMEI** (`20261007140000`): quien lo necesita es el
  PRODUCTO. El trigger `productos_lleva_serie_por_categoria` (antes de INSERT o de
  cambiar `categoria_id`) prende `productos.lleva_serie` si su categoría o la de
  arriba SE LLAMA Celulares / Smartphones / Tablets / Móviles
  (`categoria_pide_imei_por_nombre`; "Accesorios para celulares" no). Cubre todos
  los caminos de alta, también una categoría creada en la misma carga inicial.
  Solo prende, nunca apaga. Aires, heladeras, TV, microondas y auriculares quedan
  afuera: se marcan a mano. Espejo TS para la conciliación:
  `shared/lib/categoria-pide-imei.ts` (mismos casos en test y en la migración).
- **Un renglón por aparato también sin número**: en un producto que lleva IMEI,
  create-sale graba cada aparato que sale sin IMEI en su propio renglón de cantidad
  1 (`renglonesPorAparato` con `partirSinUnidad`), para poder completarle el IMEI
  después. Antes 2 iguales sin IMEI quedaban en un renglón de cantidad 2 que no se
  podía completar.
- **Aparato que sale sin número = motivo obligatorio** (venta ONLINE): el modal del
  POS pide escanear el IMEI o elegir por qué sale sin él (`aparatos-sin-imei.ts`,
  `motivo-sin-imei-field.tsx`); también para los que sobran en una línea con menos
  IMEI que unidades. create-sale rechaza la venta online sin motivo y lo guarda en
  `ventas_items.motivo_sin_imei` (vía `registrar_venta`). La venta OFFLINE se graba
  igual sin motivo (queda pendiente): rechazarla no deshace la venta, la deja en la
  cola del celular para siempre.
- **Completar después**: el ticket del historial ofrece "Agregar IMEI" en los
  renglones pendientes (cantidad 1, sin unidad, sin devolver, venta no anulada).
  `completar_imei_venta_item` (SECURITY DEFINER, `ventas.cobrar` + venta propia o
  `ventas.ver_todas`) crea la unidad ya VENDIDA atada a la venta, sin mover stock,
  idempotente con el mismo número. Un renglón de 2+ aparatos sin IMEI no se parte.
- **Conciliación**: los renglones que llevan IMEI y vinieron sin número muestran un
  input por aparato (`imeis-remito-panel.tsx`; Enter del escáner salta al
  siguiente), guardados en el borrador. `aprobar_orden_compra` recibe `imeis` (array)
  además del `imei` del Excel y frena con `REMITO_IMEIS_DE_MAS` si hay más números
  que unidades. Aprobar con IMEI sin completar muestra la alerta con la lista y deja
  aprobar igual: el POS los pide al vender. Para un producto que todavía no existe
  (o se creó en esta pantalla) decide la categoría con la que se crea: elegida,
  sugerida o del Excel, también una que se crea en la carga inicial.
- `normalizar_imei` (SQL) es el espejo de `normalizarImei` (TS): sin espacios y en
  mayúsculas. Desde `20261007120000` también los IMEI del remito se guardan así.
- **Marca deducida del nombre** (`inferir-marca.ts`): si el Excel no trae columna
  Marca, la conciliación la deduce de la primera palabra contra un diccionario de
  electro ("SAMSUNG A17" → la escritura que ya use el comercio). Fuera de la lista
  no adivina. Va en `marca_inferida`, nunca pisa `raw_marca`.
- **18/8/2026 se perdieron 4 IMEI de ClickTostado**: la edición de variantes
  borraba y recreaba, y el FK estaba en CASCADE. Hoy el FK es RESTRICT. OJO: la
  grilla de edición conserva el id solo si los ATRIBUTOS no cambian
  (`guardar_variantes_producto` reconoce por `atributos_comparables`); cambiar un
  valor es para ella borrar y crear. Por eso: (1) borrar/renombrar una variante con
  IMEI falla ANTES con `VARIANTE_CON_IMEI` y el nombre; (2) dos filas que quedan
  iguales fallan con `VARIANTES_REPETIDAS` (antes un `CONTINUE` tiraba el stock de
  la segunda); (3) el error de tipeo se corrige con **"Corregir" en la sección de
  IMEI** → `corregir_variante` (`20261001150000`): renombra conservando el id, o si
  choca con otra variante pregunta y la FUSIONA (reapunta IMEI, ventas,
  devoluciones, presupuestos y reservas ANTES de borrar, suma el stock con origen
  `EDICION_VARIANTES`, escribe el espejo). SECURITY DEFINER con
  `stock.editar_producto`. Frena si precio/costo difieren. Caso que lo originó: A56
  "12/257" de ClickTostado, 1/10/2026 (`20261001130000`). El 30/9 se recuperó
  el IMEI del A7 Pro desde `ordenes_items.raw_imei`; siguen perdidos los del A07,
  A16 y Redmi Pad (este último tenía un EAN en la columna IMEI).
- **Dos aparatos iguales en un ticket** (1/10/2026): el carrito los junta en una
  línea de cantidad N; el modal pide un IMEI por unidad (hasta las que tienen
  número) y create-sale graba un renglón de `ventas_items` por aparato
  (`renglones-por-aparato.ts`: exacto porque precio y descuento son por unidad).
  Stock, promo, factura y totales siguen con la línea entera. El formato del
  payload (`[{varianteId, unidadId}]`) no cambió: los clientes viejos y la
  outbox offline siguen andando.
- **Remito: `REMITO_IMEI_REPETIDO`** (`20261001140000`): un IMEI dos veces en el
  remito o ya cargado en el comercio frena la aprobación con los números. Antes
  `on conflict do nothing` sumaba el stock sin crear la unidad. Va después del
  guard de idempotencia (re-aprobar sigue devolviendo `ya_aprobada`).
- **El IMEI sigue a la mercadería al devolver.** Anulación: por `venta_id`
  (`devolver_unidades_venta`). Devolución parcial (desde el 1/10/2026): por
  renglón, con `ventas_items.unidad_serie_id` (cada renglón con IMEI es un aparato),
  en `registrar-devolucion.ts` junto al stock y afuera de la transacción (es
  compensación: si falla, avisa). STOCK → `disponible`; BAJA → `baja`. UPDATE
  condicional a `estado = 'vendido'` y a esta venta, con conteo de filas. Antes el
  celular volvía al stock con su IMEI todavía `vendido` y el POS no lo ofrecía.

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
- **Cada renglón viaja exactamente una vez** (`20261006130000`): `aprobar_orden_compra`
  rechaza con `REMITO_LINEAS_FALTANTES` / `REMITO_LINEAS_INVALIDAS` (repetido, de otra
  orden, sin `item_id`) / `REMITO_CANTIDAD_INVALIDA` (negativa). Antes solo controlaba
  los renglones con `producto_id is null`: uno que ya tenía producto y no venía en el
  payload no entraba al stock sin error.
- **Lo recibido contra lo facturado**: `ordenes_items.cantidad` no se toca;
  `cantidad_recibida` (NULL = igual, 0 = no vino, otro = corregido) y `motivo_ajuste`
  los escribe la RPC al aprobar. "Descartar agrupación" marca "No vino" (cantidad 0) en
  vez de sacar las filas, y se deshace con "Sí vino"; la cantidad se corrige por línea.
  Un renglón en 0 no necesita producto ni mueve stock. Criterio único:
  `features/purchases/lib/recepcion.ts` (con tests); un borrador viejo sin los
  descartados los recupera como no recibidos (`completarConFaltantes`).
- **La conciliación crea con la misma RPC que Carga inicial** (6/10/2026):
  `crearProductoAlVueloAction` (sin idempotencia, envuelto en `withTimeout`, el
  reintento duplicaba) se eliminó. El lote es UNA llamada; las fotos del modal se suben
  después del alta, como en Fotos pendientes. Si el grupo tiene costos distintos por
  variante se manda `costo: null` para no pisar el de cada línea.
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
- **`configuracion_pos.rubro`** tiene 9 valores con CHECK (incluye cotillón y pinturería). Cambia la identidad en la
  UI (`identidad-por-rubro.ts`: indumentaria "N var.", electro Modelo + EAN), no el
  schema. `normalizarRubro` cubre los 9.
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

### Pinturería (`20261007170000`, aplicada el 7/10/2026)

- Rubro comercial y operativo `pintureria`; plantilla con marca, capacidad, color,
  acabado y unidad de medida. Carga rápida muestra Capacidad y Color. POS en lista
  sin fotos, marca habilitada y sin reservas; defaults Unidad y 21%.
- Latas cerradas: VARIANTES (Capacidad × Color), cada una con su stock. Las
  PRESENTACIONES comparten stock en unidad base y sirven para venta fraccionada:
  una lata cerrada de 20 L no es una presentación. Aguarrás suelto: unidad LITRO.
- Ambos parsers reconocen litros/lts; en Pinturería también capacidad/contenido/tamaño.
  Se pasa el rubro para conservar capacidad=memoria en electro y tamaño=talle en ropa.
  Acabado se conserva como atributo de la fila; no se ofrece como eje inline.
- Categorías sugeridas: Látex, Esmaltes, Barnices, Impermeabilizantes, Preparación,
  Diluyentes, Herramientas y Aerosoles. La categoría Pinturería de ferretería sigue.
- Migración `20261007170000` agrega el noveno rubro sin reclasificar comercios;
  también corrige el CASE del alta que en el baseline fuerza indumentaria salvo
  electro. Lee el cuerpo vivo de `crear_negocio_con_owner`, exige un único match
  y verifica que no cambie nada fuera de ese CASE. Si producción difiere, aborta
  para revisar. Reversión aborta si ya existe algún comercio con Pinturería.
- Smoke pendiente de migración/deploy: alta de comercio Pinturería, descargar plantilla,
  importar sus tres filas, vender una lata y 0,5 L de aguarrás. Verificar stock por
  variante y que el aguarrás baje exactamente 0,5 L. En precios: marca con distintas
  escrituras, simular/aplicar/deshacer, revisar historial y un catálogo de 1.000+.

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

### Buscador público (7/10/2026, pendiente de deploy)

- Patrón de Dope Snow: lupa en mobile que abre pantalla completa; campo visible
  y panel ancho bajo la cabecera en desktop (desde 1024 px). Foco en el input,
  Escape/volver/clic fuera para cerrar, limpiar conserva el foco. Inputs de 16 px,
  blancos de 44 px, `dvh`, scroll propio y safe areas.
- Sugerencias desde nombre/marca/modelo reales (hasta tres), cuatro tarjetas y
  acceso a todos los resultados. Sin consulta: categorías del comercio; no se
  inventan “búsquedas populares”. Matching por `coincideConBusqueda` compartido
  con la grilla, con acentos normalizados y SKU. Respeta productos publicados,
  ruta de ficha y `mostrar_sin_stock`. Prioriza coincidencias exactas/prefijos y
  entre iguales los más recientes.
- `CatalogoPublicoProvider` comparte la descarga entre navbar y grilla, deduplica
  solicitudes concurrentes y admite reintento. En una ficha recién se pide al
  abrir búsqueda. Instancia por negocio, sin cache global en el navegador.
- Tipear no cambia la URL. Enter, sugerencia o “Ver todos los resultados” busca
  globalmente en la tienda, sin heredar categoría, variantes o selección curada.
  En portada usa History API; al salir de ficha/categoría/selección usa router
  porque hay que cambiar la página o regenerar metadata. Links siguen usando
  `useRutaCatalogo` tanto por path como por subdominio. Al confirmar una búsqueda
  se lleva la grilla bajo la cabecera, sin tener que atravesar el banner.
- QA local: búsqueda, visibilidad y navegación tienen tests; revisar también con
  teclado y a 390/768/1440 px. El teclado virtual y safe areas requieren teléfono
  real. No necesita columnas nuevas ni migración.
- Hallazgo aparte en dev (7/10): Next rechazó cachear el índice de Evens porque
  pesa 2.362.649 bytes y `unstable_cache` admite hasta 2 MB. La lectura respondió,
  pero el cache no se guardó. Verificar en producción antes de optimizar ese
  payload; este cambio comparte la descarga del cliente, no altera sus columnas.

## Renombrar variantes en producción

El nombre también vive en el catálogo cacheado de cada celular. Tras un renombre
masivo, los dispositivos sin resincronizar mandan el nombre viejo. La venta ya
resuelve por `varianteId`, pero **un renombre masivo necesita además que los
dispositivos refresquen**: la migración bumpea `updated_at` y el delta lo trae en el
próximo sync; si es de nombres, avisar que recarguen el POS. Una variante BORRADA no
se puede vender desde un catálogo viejo ni con el fix.
