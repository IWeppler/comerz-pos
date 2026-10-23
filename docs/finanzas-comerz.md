# Finanzas de Comerz: lo ganado, dólares y previsión (panel /admincomerz)

Es el negocio PROPIO de Comerz (lo que cobra a los comercios y lo que gasta), no el de un
comercio. Leelo antes de tocar `features/admin/lib/finanzas-comerz.ts`, `gastos_comerz`,
`pagos_suscripcion` en el panel, el gráfico de /admincomerz o la cotización del dólar. Las
suscripciones y los planes están en [suscripciones.md](suscripciones.md).

## Decisiones (Ignacio, 23/10/2026)

1. **"Cobrado este mes" pasa a "Ganado"** = ingresos − egresos del mes, sobre lo que
   ENTRÓ y SALIÓ en el mes (base caja). Hoy la tarjeta grande muestra solo lo cobrado.
2. **Dólares**: un gasto puede estar en USD. Se guarda el monto original, el MEP con que
   se cargó, y `monto` sigue siendo el equivalente en PESOS (así lo que ya lee `monto`
   sigue andando). Se muestra en pesos y en dólares.
   - Fuente: `dolarapi.com/v1/dolares/bolsa` (JSON público, sin clave), precio de VENTA
     (pagar en dólares es comprar dólares). **dolarhoy.com no tiene API** y sus tablas
     figuran como propiedad intelectual (Ley 11.723): no se scrapea. Los dos dan el mismo
     MEP (23/10/2026: 1.557,80 contra 1.558,80).
   - La cotización la pone el SERVER (o un valor manual validado), nunca el navegador.
     Sin cotización no se inventa: se pide cargar en pesos o reintentar.
   - ÚNICO en USD: queda congelado en los pesos de cuando se cargó. FIJO en USD: el mes
     en curso y los futuros van al MEP de hoy (la factura sigue llegando en dólares); los
     meses pasados, al MEP con que se cargó (no se guarda la cotización de cada mes).
   - Cache de 1 hora; el panel sin cotización muestra solo pesos.
3. **Fijos y variables** (supuesto a confirmar, es fácil de cambiar):
   - Ingreso FIJO = renovación (el comercio ya había pagado antes). Ingreso VARIABLE = el
     PRIMER pago de cada comercio (cliente nuevo; puede no repetirse y dispara la comisión).
   - Egreso FIJO = gasto `FIJO` (Vercel, Supabase). Egreso VARIABLE = gasto `UNICO`,
     incluidas las comisiones.
4. **Comisión por cliente**: el sueldo de Romina es lo que paga la PRIMERA suscripción de
   cada cliente que consigue (Librería Colores, 23/10/2026: cobro $50.000 y comisión
   $50.000). Categoría nueva `comision`, atada al comercio y al cobro que la origina
   (`negocio_origen_id`, `pago_origen_id`, sin FK dura: es historia). El gasto anotado
   hoy como "Romi - Libreria Colores" (sueldo, único) se re-categoriza y se vincula desde
   la pantalla, no a mano en SQL.
5. **Previsión**: solo lo RECURRENTE. Renovaciones de comercios al día (cada mes en su
   fecha de vencimiento; los semestrales una vez cada seis meses, con el 20%) y gastos
   fijos. NO inventa clientes nuevos ni gastos variables: con un puñado de comercios un
   supuesto de conversión es una intuición con forma de número. Un comercio con el plan
   VENCIDO no es ingreso seguro: va aparte como "en riesgo". Cortesías (`cuenta_en_mrr`),
   pruebas y cancelados no cuentan. El mes en curso solo cuenta lo que falta cobrar (lo
   cobrado ya está en la serie) y NO suma otra vez los gastos fijos (la serie los cuenta
   enteros en el mes en que aplican).
6. **Saldo**: "acumulado desde el primer cobro" (ingresos − egresos), sin saldo inicial
   cargado a mano. No incluye plata que se tuviera antes.
7. **Alcance**: solo /admincomerz. El panel de los comercios ya tiene campana en el navbar
   y sidebar colapsable.

## Fases

| # | Qué | Estado |
|---|---|---|
| F1 | Lógica pura con tests: `cotizacion-mep.ts`, `finanzas-comerz.ts` (ganado, fijos/variables, serie con acumulado, previsión, saldo proyectado) | Hecha 23/10/2026, sin commit |
| F2 | Base: `gastos_comerz` con moneda, `monto_usd`, `cotizacion_mep`, `negocio_origen_id`, `pago_origen_id`, categoría `comision` (`20261023140000`, probada en seco). Acciones: MEP, gasto en USD y con comisión validados en el server | **Aplicada en producción el 23/10/2026** (registrada como `20261023...` por el MCP; los 3 gastos existentes quedaron como pesos, sin pérdida) |
| F3 | UI: header con la campana (reemplaza la tabla de notificaciones del dashboard), sidebar colapsable, tarjeta "Ganado", KPIs al lado del gráfico (fijos/variables, previsión, "en riesgo"), formulario de gasto en USD y comisión, mostrar los totales en pesos y dólares | Código hecho 23/10/2026 (tests de la lógica, `tsc` y lint limpios), **sin verificar en el navegador**, sin commit |
| F4 | Commit, deploy y prueba en producción | Pendiente |

## Notas de la prueba en seco

- Un `CHECK` que da `NULL` DEJA PASAR la fila: `monto_usd > 0` con `monto_usd` nulo no es
  falso, es nulo. La primera versión de `gastos_comerz_usd_completo` aceptaba un gasto en
  USD sin monto; la prueba en seco lo encontró y se corrigió con `coalesce`.

## Cómo quedó la pantalla (F3)

- **Marco** (`admin-shell.tsx`): menú lateral que se colapsa a solo íconos (botón en el
  encabezado, desde el ancho de escritorio) y encabezado con la campana. El estado del menú
  va en la cookie `admin_nav_colapsado`, que lee el layout en el servidor: el primer render ya
  sale colapsado o abierto, sin saltar al hidratar. En celular sigue la barra con hamburguesa.
- **Campana** (`campana-admin.tsx`): es el feed de siempre (`getFeedComerzAction`), que era una
  tabla en medio del dashboard. El número es lo que se puede marcar como visto; si no hay
  nuevos pero hay algo urgente derivado (plan vencido), muestra un punto: esos no se pueden
  marcar como vistos a propósito. Va en un `Suspense` en el layout para no frenar la pantalla.
- **Dashboard** (`panel-finanzas.tsx`, `finanzas-chart.tsx`, `vista-finanzas.ts`): a la
  izquierda "Ganado este mes" (con el cambio contra el mes pasado), ingresos y egresos
  fijos/variables, acumulado, neto previsto del mes que viene, "en riesgo" y MRR teórico; a la
  derecha el gráfico con 6 meses vividos y 6 por venir. Botón $ / US$ si hay cotización. El
  "Margen del mes" de las métricas se sacó: es lo mismo que el "Ganado".
- **Gastos** (`formulario-gasto.tsx`, `gastos-del-mes.tsx`): moneda por gasto, cotización
  opcional, y la categoría "Comisión por cliente" con el comercio y el cobro que la origina.
  Cada fila muestra su monto en su moneda y el equivalente. El total del mes usa
  `montoEnPesos`, igual que el panel.

## Para dejar los datos de hoy como corresponde (desde la pantalla)

1. Editar el gasto FIJO "Vercel": moneda Dólares, monto 20 (la cotización la pone el servidor).
   El ÚNICO "Vercel" de septiembre es otro gasto: pasa a USD aparte si querés.
2. Editar "Romi - Libreria Colores": categoría "Comisión por cliente", cliente Librería
   Colores, cobro del 23/10 ($50.000).
