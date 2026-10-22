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
- **Comisiones por medio de cobro** (/reportes › Rentabilidad, 22/10/2026): el
  renglón "Comisiones" de la cascada abierto por medio, con el % de lo cobrado y,
  donde hay cobros de cuenta corriente, la parte de ventas y la de CC (con Mercado
  Pago online el mismo medio cobra la tienda y las deudas). Sale de
  `ventasPorMetodo.comisionCuentaCorriente` en `get-dashboard-metrics.ts`; la
  comisión es la guardada en cada cobro (`venta_pagos.comision_monto`). Decidido
  con Ignacio: estos números van en Reportes, no en Configuración.
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
- **Venta cruzada predictiva**: medido en 90 días de Evens, el par más frecuente
  aparece dos veces. Eso no permite prometer ventas ni presentar una correlación
  como palanca. La ampliación local del 7/10 muestra pares observados en 180 días y
  permite al ADMIN activar asociaciones para el catálogo, sin predicción ni
  incremento estimado. Estado, permisos y pruebas en
  [catalogo-marketing.md](catalogo-marketing.md), sección de ampliación de M4.

## Panel (`/`) y egress

- **El panel pide ventas con ventana**: `features/dashboard/lib/ventana-historial-panel.ts`
  ES la lista de hasta dónde mira cada regla. Una regla nueva que necesite más
  historia se agrega AHÍ: si mira más atrás que la ventana, no falla, devuelve un
  número más chico en silencio. /reportes lee el historial completo a propósito.
- **El panel calcula en RELOJ COMERCIAL** (6/10/2026,
  `features/dashboard/lib/reloj-comercial.ts`): "ahora" y las fechas de ventas,
  egresos, bajas y cobros de CC se corren a la hora de Buenos Aires ANTES de pasar
  por los helpers (que usan getters locales). Con el server en UTC el día cortaba a
  las 21:00 y de 21 a 24 "Hoy" era mañana. Las copias corridas son solo para
  CALCULAR: lo que se muestra sale de la fecha original (`formatearHora` y
  `formatearFechaHora` fijan `America/Argentina/Buenos_Aires`). Una fecha nueva
  que entre a las cuentas del panel se corre con `conFechasComerciales`, o queda
  3 horas desfasada contra los rangos.
- **Franja de plata: sacada del panel el 12/10/2026** (pedido de Nacho; `plata-hoy.tsx`
  borrado). Mostraba efectivo, por acreditar y deuda vencida; esos números viven en /caja.
  OJO: `getPosicionDineroAction("hoy")` además materializa las acreditaciones vencidas; ahora
  eso pasa solo al abrir /caja (donde se ven esos saldos), ya no al abrir el panel.
- Los avisos de stock llevan a `/stock?buscar=<nombre>`.
- `getProductosPanelAction` trae productos sin variantes ni fotos.
- Los ingresos libres NO suman a la ganancia del panel (lee ventas y egresos).

## Rediseño del panel (12/10/2026, sin commit)

Pedido de Nacho: el dueño no es financiero; números rápidos y fáciles, colores de Comerz
(azul de interfaz, naranja del logo). Una primera versión con color en todo (degradé, íconos
de colores, caja roja) fue rechazada como "AI slop". La vigente sigue dos referencias de
tableros (tarjetas blancas, gráfico de barras gris con una barra destacada, columna de
pendientes): **base neutra, tarjetas blancas y un solo acento por lugar**.
- **Saludo** ("Hola, <nombre>" + fecha) con el selector de período a la
  derecha. El nombre sale de `perfiles` en el mismo Promise.all (el usuario ya está en el
  cache del layout).
- **Cuatro tarjetas de números** (`KpiFranja` + `KpiMiniCard`): título arriba a la
  izquierda, variación como TEXTO arriba a la derecha (`growth-badge.tsx`) y número grande.
  Sin íconos ni leyenda "vs. …" (13/10/2026): contra qué se compara va en el tooltip.
- **Dos columnas**: contenido (tarjetas, gráfico de ventas, y abajo stock crítico/reservas +
  "Lo que más rinde") y un aside a la derecha (ventas por categoría arriba, "Requiere tu
  atención" abajo). En celular se apilan, contenido primero.
- **"Ventas"** (`ventas-periodo-chart.tsx`, 13/10/2026): SIGUE al selector con los mismos
  dos rangos que las tarjetas (`construirSerieComparada`): Hoy por hora, Semana y Mes por
  día, Trimestre por semana (bloques de 7 días desde el inicio del rango, no semanas de
  calendario) y Año por mes. "Año" es la excepción de rango (`resolverRangosChart`): 12
  meses de calendario enteros contra los mismos del año anterior, porque los 364 días de
  las tarjetas empiezan a mitad de mes y el primer mes salía cortado. Con "Año" la suma de
  las barras puede diferir unos días de "Vendiste"; el historial del panel cubre ese rango. Reemplazó las pestañas
  Facturación / Unidades / Ganancia, que dibujaban casi la misma forma tres veces: cada barra
  es la facturación partida en ganancia (fuerte, ABAJO, pegada al piso para compararla
  entre tramos) y costo de mercadería (suave, arriba). Apilada y no lado a lado: la altura
  tiene que seguir siendo la facturación (contra ella se mide la línea del período
  anterior) y 52 tramos × 2 barras no se leen en un celular. Una línea punteada gris es la
  facturación del mismo tramo en el período anterior (mismos días de la semana). Tooltip
  corto: facturación, ganancia con margen, variación contra el anterior (solo el %, el
  monto ya lo dibuja la línea) y ventas/unidades. El tramo en curso va
  translúcido. Se fue la ventana fija de 28 días (`DIAS_CHART`) y la media móvil: la
  ventana fija existía porque el selector era de calendario, y ya no lo es.
- **"Requiere tu atención"** (Comerz Intelligence, `advisor-mini-list.tsx`): lo que un tablero
  genérico no tiene. Filas con ícono de gravedad, título, el porqué y flecha; toda la fila
  lleva a donde se resuelve. "N pendientes" cuenta danger + warning.
- **"Top 5 categorías"** (`ventas-por-categoria.tsx`, donut a pedido de Nacho): sigue al
  selector, las 5 que más facturan con color + "Otras" en gris; leyenda con nombre y %, el total en el centro
  del anillo. Paleta `--viz-1..5` (azul Comerz, naranja, aqua, amarillo, magenta) validada con el script
  del skill dataviz en claro y oscuro (CVD ≥ 8 entre vecinos). El color va por puesto, no por
  categoría: la leyenda lleva la identidad. Agrupa por categoría REAL (`categorias` de
  `getDashboardMetrics`, 13/10/2026): antes agrupaba por el nombre suelto y "Remeras" de
  Hombre y de Mujer se sumaban en una porción. La leyenda muestra la subcategoría y el
  padre en gris ("Remeras · Mujer"); "Otras" dice cuántas tiene. La leyenda va en una línea por
  categoría (un nombre largo se corta); el tooltip va afuera del anillo con nombre entero, monto y %, y en "Otras" lista
  lo que junta. Arreglo compartido con /reportes (mismo cálculo).
- Stock crítico/reservas y "Lo que más rinde": mismas cards de antes, bordes redondeados
  como el resto.

## Comerz Intelligence en /reportes (21/10/2026, sin commit)

- **El banner gigante de recomendaciones salió de /reportes** (`advisor-banner.tsx`
  borrado). Las recomendaciones ahora son la misma lista del panel
  (`AdvisorMiniList`), con tope común `LIMITE_RECOMENDACIONES = 5`.
- **Una recomendación por familia** (`FAMILIA_POR_ID` en `get-advisor-insights.ts`):
  quiebre, inventario, recargo, descuentos, rentabilidad, datos, venta. Dos avisos del
  mismo problema cuentan como uno; se queda el de mayor prioridad.
- **Regla de dependencia de catálogo retirada**: un producto con 40%+ de las unidades
  no es un problema por sí solo y no tenía acción.
- **Asociaciones: máximo 5 y con criterio** (`seleccionarAsociaciones` en
  `features/reports/lib/complementos-catalogo.ts`). Sugeridas: al menos 3 compras
  juntas y 20% de las ventas del producto menos vendido. Las activadas por el admin
  van primero aunque sean débiles. Medido en Evens (180 días): 85 pares con 2+ juntas,
  12 con 3+, 10 con 20%+. Con 2 compras juntas es coincidencia.
- El umbral de 20% es criterio, no medición de conversión: no promete ventas.
- **Asociaciones: la tarjeta grande de /reportes salió (21/10/2026).** La activación
  vive ahora en la fila "Se compran juntos" de Requiere tu atención (botón
  "Activar asociación", solo ADMIN, `getAsociacionSugeridaAction`). Limitación: la
  UI no permite QUITAR una asociación activada; `configurar_complemento_catalogo`
  sí lo permite (`p_activo = false`), pero no hay botón. Pendiente si hace falta.
