# Insights: señales de negocio

Leé esto antes de tocar el panel (`/`), /reportes, `get-dashboard-metrics`, o
cualquier señal (`rentabilidad_por_metodo`, `margen_realizado`,
`composicion_ticket`, `ventas_por_momento`, `curva_de_precio`,
`antiguedad_saldo_cc`), y antes de proponer una señal nueva.

## Principios

- **Correlación no es palanca.** El número que se promete tiene que ser el que se
  cumple POR CONSTRUCCIÓN, no el que casualmente coincide. `composicion_ticket`
  devolvía la diferencia entre el ticket de dos renglones y el de uno: eso compara
  dos POBLACIONES, no el valor de una conversión. Lo que se promete es
  `renglon_adicional` (el precio y margen de la prenda que se suma). Si la UI lo
  rotula "oportunidad", miente.
- **Toda señal de estancamiento se compara contra su CATEGORÍA**, nunca contra un
  umbral absoluto: si toda la categoría cayó, el producto está fuera de temporada.
- **`categorias.temporada` sirve SOLO para silenciar, nunca para sugerir**: el
  helper se llama `categoriasFueraDeTemporada` (forma negativa). Default
  `TODO_EL_ANIO` no silencia nada: acá el lado seguro es MOSTRAR. Criterio en
  `shared/lib/temporada-categoria.ts` y `categoria_en_temporada`, que dicen lo mismo.
- **Al cliente solo se lo identifica cuando se le fía**, y eso sesga toda la
  analítica de clientas: "clienta" en la base significa "clienta a la que se le fía".
  Antes de cualquier señal de clientas hay que identificar en la venta de contado
  (cambio de producto en el POS).
- Con markup uniforme (en indumentaria el precio es casi siempre ×2 del costo), el
  margen porcentual no varía por producto sino por DESCUENTO. Ordenar por margen ahí
  ordena por quién recibió más descuento. `margen_realizado` devuelve
  `dispersion_markup` y `uniforme` para avisarlo.

## Señales (todas gateadas por `caja.ver_gerencial`)

- `rentabilidad_por_metodo`: recargo cobrado menos comisión, por medio. Cuenta
  corriente va aparte (no es una forma de cobrar sino de no cobrar todavía); la
  comisión de cobrar una deuda con tarjeta se le imputa a la CC.
  `sin_dato_recargo` avisa cuando el total está subestimado.
- `margen_realizado`: desde `ventas_items.precio_costo` congelado. Recargos afuera.
  `p_min_unidades` es el piso del ranking y los que no llegan se cuentan en
  `base_insuficiente`. Costo cero queda fuera de todo ranking (es un costo que nadie
  cargó, no margen 100%).
- `composicion_ticket`: tickets por cantidad de renglones, tramo abierto "6 o más".
  QUÉ ofrecer lo elige la vendedora.
- `ventas_por_momento`: día de semana NORMALIZADO por cuántos días de cada tipo hubo;
  la hora va aparte (una grilla día × hora a este volumen es ruido).
- `curva_de_precio`: a qué descuento se vendió cada unidad, por renglón.
- `antiguedad_saldo_cc`: imputa FIFO y lo declara (`imputacion`); `clientes_descuadrados`
  es su control de calidad.

## Lo que NO se construyó y qué le falta

No volver a proponerlo sin resolver el bloqueo:
- **Días reales hasta cobrar**: la base no sabe qué ticket saldó cada pago (el FIFO
  es un cálculo). Hace falta imputación declarada en el pago (schema).
- **Costo del dinero**: necesita una TASA del comercio o del contador.
- **Costo de reposición**: `producto_variantes.costo` está vacío en casi todo el
  catálogo (el costo REALIZADO sí está completo).
- **Sell-through por lote / capital inmovilizado**: falta un `lote_id` en
  `ventas_items`.
- **Ciclo de conversión de efectivo**: faltan los días de pago a proveedor.
- **Venta cruzada**: medido en 90 días de Evens, el par más frecuente aparece dos
  veces. No hay señal hasta ~6 meses. (La fragmentación de categorías duplicadas
  degrada toda señal por categoría.)

## Panel (`/`) y egress

- **El panel pide ventas con ventana**: `features/dashboard/lib/ventana-historial-panel.ts`
  ES la lista de hasta dónde mira cada regla. Una regla nueva que necesite más
  historia se agrega AHÍ: si mira más atrás que la ventana, no falla, devuelve un
  número más chico en silencio. /reportes lee el historial completo a propósito.
- `getProductosPanelAction` trae productos sin variantes ni fotos.
- Los ingresos libres NO suman a la ganancia del panel (lee ventas y egresos).
