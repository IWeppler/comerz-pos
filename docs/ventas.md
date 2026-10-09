# Ventas: registrar, anular, devolver

Leé esto antes de tocar `create-sale.ts`, `cancel-sale.ts`, `registrar-devolucion.ts`,
las RPC `registrar_venta` / `anular_venta` / `registrar_devolucion`, las tablas
`ventas`, `ventas_items`, `venta_pagos`, `devoluciones`, o el POS.

Lo que la venta hace con la PLATA (arqueo, ledger, reintegros) está en
[caja-y-dinero.md](caja-y-dinero.md); con el FIADO, en
[cuenta-corriente.md](cuenta-corriente.md); con el STOCK, en
[stock-y-catalogo.md](stock-y-catalogo.md); con el COMPROBANTE, en
[facturacion.md](facturacion.md). Una venta toca los cinco: ver la guía
"Anular o devolver una venta" en AGENTS.md.

## Registrar una venta

- **La venta se escribe en UNA transacción: `registrar_venta`** (`20260816120000`).
  Cabecera + pagos + renglones + descuento + deuda de CC + espejo legacy de stock +
  reservas van juntos. Antes eran seis escrituras sueltas y el insert de pagos
  fallaba SIN revertir nada: quedaba una venta CONFIRMADA sin un solo pago y con el
  stock descontado.
  - Quedan AFUERA a propósito el descuento de stock (`ajustar_stock_variante`) y
    las unidades serializadas: ya son atómicos y fallan por otro motivo ("no hay
    mercadería" es una respuesta al usuario, no una rotura). Si la RPC falla,
    `create-sale.ts` revierte esos dos y no queda ningún punto intermedio.
  - **SECURITY INVOKER, no DEFINER**: el aislamiento sigue siendo la RLS de quien
    vende. Verificado que un usuario apuntando a un negocio ajeno no escribe nada.
  - **Inserta `ventas_items` con una lista de columnas FIJA** (`jsonb_to_recordset`):
    un campo nuevo que manda create-sale y no se suma ACÁ se descarta sin error.
    Pasó con la presentación: `20260918150000` nunca se aplicó y del 18/9 al 7/10
    ningún renglón guardó qué presentación se vendió (corregido en
    `20261007130000`, que también graba `motivo_sin_imei`).
- **Las cuatro hijas de `ventas` atan el INSERT al padre**: `venta_pagos`
  (`20260905140000`), `ventas_items`, `devoluciones`, `devoluciones_items`
  (`20260905180000`). El predicado pide que el padre sea VISIBLE
  (`exists (select 1 from ventas v where v.id = venta_id)`) y de eso se encarga la
  RLS de `ventas`. **Toda tabla hija nueva copia esa forma.** Antes tenían
  `with check (true)` y cualquiera podía colgar filas de una venta ajena.
- **Precios revalidados en el server** (`create-sale.ts`): nunca se confía en el
  precio del navegador. Mismo criterio para todo lo que toque plata: validación
  espejo en el server siempre.
  Precio por cantidad: agrupar la variante real antes de resolver el unitario;
  configuración, prioridad frente a listas y estado de implementación en
  [stock-y-catalogo.md](stock-y-catalogo.md#precio-unitario-por-tramo-de-cantidad-8102026).
- **Cantidad validada en el server** con `normalizarCantidadVendible`
  (`shared/lib/unidad-venta.ts`): rechaza cero, negativos, NaN y decimales en
  productos no fraccionables. Antes una cantidad negativa en un request
  modificado SUMABA stock y bajaba el total. Venta por peso: ver
  [stock-y-catalogo.md](stock-y-catalogo.md).
- **La variante se resuelve por `varianteId`, nunca por el nombre del carrito.**
  El nombre sale del catálogo cacheado en el celular y un renombre masivo lo deja
  viejo (incidente del 5/9: "Error de stock" con la base perfecta). El espejo
  legacy se busca por el nombre ACTUAL y en `ventas_items.variante` se guarda el
  vigente.
- **El espejo `productos_stock` no frena la venta.** Los datos del producto
  (precio, costo, unidad, categoría, IVA) se leen de `productos`, y una variante
  real de ese producto sin fila espejo se vende igual: el stock que manda es el de
  la variante y el espejo se descuenta solo si existe (log
  `[VENTA VARIANTE SIN ESPEJO]`). Sin variante ni espejo sigue siendo "Error de
  stock". Incidente del 5/10/2026: 15 variantes de Estilo Bonito de la carga del
  24-25/7 sin espejo nunca se pudieron vender; repuestas en `20261005160000`.

### Venta libre: la única excepción al precio revalidado (`20260917120000`)

Un renglón que no es ningún producto: `producto_id` y `variante_id` null,
descripción tipeada en `variante`, `es_venta_libre = true`. Nació para el cotillón
("12 globos sueltos"). El precio lo pone la vendedora; lo que se valida es la FORMA
(`features/pos/lib/venta-libre.ts`, compartida POS/server) y un CHECK impide que un
renglón libre apunte a un producto (no sirve para cobrar mercadería real a otro
precio). No mueve stock, costo cero (`margen_realizado` lo cuenta "sin costo"), no
entra en promos por categoría ni listas de precios.
- La marca es COLUMNA, no heurística: hay 15 renglones históricos con producto y
  variante null que son productos BORRADOS.
- Se descartó un producto oculto "Venta libre": `productos` lo leen 54 consultas
  que tendrían que aprender a esconderlo.
- Todo lo que nombra un renglón pasa por `features/sales/lib/nombre-renglon.ts`.
- Entradas: tecla V, botón al pie del ticket, "Vender 'X' sin cargarlo" en la
  grilla sin resultados (`useVentaLibreStore`).

## Columnas que se leen mal (tienen COMMENT en la base)

- **`ventas.cantidad` son UNIDADES** (Σ `ventas_items.cantidad`), no renglones.
  Guardaba `items.length` y subcontaba panel, rendimiento y exportación
  (`20260816170000`).
- **`ventas.precio_costo` es el costo TOTAL de la venta**, no unitario. Multiplicarlo
  otra vez por `cantidad` hundía el margen de las mejores clientas (CRM, scoring).
- **Las columnas del RENGLÓN son UNITARIAS**, al revés que la cabecera:
  `ventas_items.precio_final`, `precio_costo` y `descuento_monto` son por unidad;
  para sumar se multiplica por `cantidad`
  (`ventas.precio_costo = Σ items.precio_costo × cantidad`).
  `precio_final` YA tiene restado el descuento del renglón, y
  `ventas_descuentos.monto_descontado = Σ items.descuento_monto × cantidad`:
  restar la cabecera además del renglón lo cuenta dos veces.
- **`ventas.metodo_pago` NO es fuente de verdad; la fuente es `venta_pagos`.** Es
  texto legacy con CHECK (EFECTIVO | TRANSFERENCIA | TARJETA | PAGO_MIXTO |
  CUENTA_CORRIENTE) que miente de dos formas: `BILLETERA_VIRTUAL` se aplana a
  `TARJETA`, y las ventas con entrega parcial + fiado llevan el método de la
  ENTREGA. Una consulta que agrupe por esa columna está mal escrita.
- **`ventas.monto_pendiente` quedó CONGELADO al vender**: los pagos de CC bajan
  `clientes.saldo_pendiente`, nunca esa columna. Y hoy **pendiente = fiado** sin
  excepción (561 de 561): la leen 5 funciones SQL y 23 archivos TS. No la uses para
  otra deuda (ver presupuestos).

## Cobros: `venta_pagos`

- Para el resto del sistema `venta_pagos` es **PLATA QUE ENTRÓ**. Por eso el fiado
  NO es una fila de `venta_pagos`: `posicion_dinero` arma "por acreditar" con
  `metodo_tipo <> 'EFECTIVO'` y nueve lugares de TS suman `venta_pagos` como
  cobrado. La regla la sostiene `create-sale.ts`; **la base NO tiene un guard**
  (verificado sobre el cuerpo vivo). Si algo va a escribir fiado ahí, primero el
  guard.
- Dos `tipo_movimiento` hoy: `PAGO_VENTA` y `PAGO_CUENTA_CORRIENTE`. **En el código,
  "cobro sin venta" significa "cobro de CC"** — discriminar SIEMPRE por
  `tipo_movimiento`, nunca por `venta_id is null` (ver presupuestos, que agrega un
  tercero).
- **Comisión y recargo son dos porcentajes distintos** (`metodos_pago`):
  `comision` es lo que el comercio paga al procesador (interno, se resta) y
  `recargo_porcentaje` lo que le cobra al cliente (se suma, se muestra). Cálculo en
  `shared/lib/recargo-metodo.ts`, compartido POS/server; el server SIEMPRE
  recalcula desde la base. Invariante:
  `venta_pagos.monto_bruto = monto_base + recargo_monto`; la base es lo que imputa
  al ticket o a la deuda (la deuda de CC baja por base, nunca por bruto). El
  recargo va por método sobre SU porción (mixto), se redondea al peso y queda
  congelado en la fila. La comisión se calcula sobre el bruto. `anon` lee
  `recargo_porcentaje` (GRANT por columna); `comision` no se expone.
- **Recargo igual a comisión pierde plata**: 15% y 15% sobre 100 → bruto 115,
  comisión 17,25, neto 97,75. Para empatar 15% de comisión hay que cobrar 17,65%
  (lo muestra `rentabilidad_por_metodo`, ver [insights.md](insights.md)).

## Promociones

Condición (`tipo_regla`, null = sin condición) y visibilidad
(`mostrar_en_catalogo`) son ejes INDEPENDIENTES. **Fail-closed**: `tipo_regla`
desconocido = NO elegible. La RLS de SELECT para `anon` en promociones es
necesaria (su falta causó bugs silenciosos).

Cupones del catálogo (implementación local del 7/10, aún sin aplicar):
`promociones.codigo` null conserva una promoción automática; con código se valida
antes de entrar al cálculo público. En el POS se sigue eligiendo por ID, con el
código como etiqueta; `create-sale` recalcula desde la base y `registrar_venta`
cuenta el uso al cobrar. Aplicar el código en un carrito público no consume usos.
Migraciones y estado: [catalogo-marketing.md](catalogo-marketing.md).

## Anular una venta: `anular_venta` (`20260816150000`)

Transacción con el mismo corte que la venta: estado + cobros + egreso + crédito de
CC adentro; stock y unidades serializadas afuera (son compensaciones y no pueden
voltear una anulación hecha).
- **El reintegro lo elige el dueño y de eso depende el egreso de caja** — ver
  "Reintegros" en [caja-y-dinero.md](caja-y-dinero.md). El default (sin permiso
  `ventas.elegir_medio_devolucion`) es devolver por el medio del cobro.
- **El crédito de CC es `least(deuda de la venta, saldo actual)`**, nunca
  `ventas.monto_pendiente` (congelado). Lo ya pagado de un fiado que se anula queda
  como saldo a favor (ver [cuenta-corriente.md](cuenta-corriente.md)).
- **`anular_venta` marca SIEMPRE `ANULADO` los cobros** (`20260920160000`): un solo
  significado para ese estado. Qué pasa con la plata lo deciden los movimientos,
  no el estado.
- **El stock vuelve por `ventas_items.variante_id`** (`20260816130000`), sin FK
  (el historial sobrevive a que la variante se borre). El match por nombre es
  respaldo para los que el backfill no resolvió: 117 de 1.032 renglones ya no
  matcheaban por nombre.
- **Venta FACTURADA**: la nota de crédito se pide a ARCA ANTES de la RPC. Si la
  RPC falla (p. ej. `SALDO_INSUFICIENTE_CAJA` por el reintegro en efectivo) queda
  la NC emitida sin anulación; `cancel-sale.ts` lo loguea. Ver
  [facturacion.md](facturacion.md).
- **UPDATE condicional + chequeo de filas afectadas ANTES de cualquier escritura
  derivada**: el reembolso fantasma de `cancel-sale.ts` fue un `select` previo que
  dos llamadas concurrentes leían igual.

## Devolver renglones: `registrar_devolucion`

- Es SECURITY DEFINER, así que **filtra `negocio_id` en cada una de sus consultas**
  (`20260905160000`, guard que cuenta los filtros). Validaba la venta y después
  leía `venta_pagos`, `ventas_items` y `clientes` solo por id: era explotable.
- Con el medio de reintegro declarado ya no hace falta deducir de dónde sale la
  plata: `VENTA_CON_PAGO_MIXTO` y `METODO_NO_DEVOLVIBLE` solo aplican cuando nadie
  eligió.
- La devolución parcial NO toca `venta_pagos`; se representa como reintegro (ver
  [caja-y-dinero.md](caja-y-dinero.md)).
- Una devolución parcial de una venta pagada con saldo a favor vuelve a cuenta.
