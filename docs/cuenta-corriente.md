# Cuenta corriente: fiado, vencimiento, mora y saldo a favor

Leé esto antes de tocar `clientes.saldo_pendiente`, `cuenta_corriente_movimientos`,
`registrar_cobro_cc`, `recalcular_vencimiento_cc`, `deuda_cc_vencida`,
`calcularSaldoConRecargo`, `features/clients/`, o el fiado dentro de una venta,
anulación o devolución.

El cobro de CC es un `venta_pagos` con `tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'`
y sin `venta_id`: también es plata que entra a la caja (ver
[caja-y-dinero.md](caja-y-dinero.md)). El fiado de la venta, en cambio, NO es fila de
`venta_pagos` (ver [ventas.md](ventas.md)).

## Saldo del cliente: `clientes.saldo_pendiente` tiene SIGNO

(`20260928230000`, `240000`, `250000`) Positivo = debe; negativo = el comercio le
debe (saldo a favor). Una columna con signo y no dos: el libro compensa solo.
- **Se mueve con DELTA y nunca se recorta a cero** (`registrar_cobro_cc`,
  `ajustar_saldo_cliente`, `registrar_venta`). El `Math.max(0, ...)` escondía los
  saldos a favor: el libro decía "a favor" y la pantalla $0.
- **Toda lectura de DEUDA filtra `> 0`** (TS: `deudaDe` / `saldoAFavorDe` en
  `features/clients/lib/saldo-a-favor.ts`). Sumar el saldo crudo resta las señas de
  unos a la deuda de otros.
- El saldo reconcilia al peso con el libro (Σ débitos − Σ créditos). `antiguedad_saldo_cc`
  cuenta los `clientes_descuadrados` como control.

## Saldo a favor

- **Nace de**: pago de más o seña (con confirmación "dejar $X a favor",
  `p_pago.permitir_saldo_a_favor`), reintegro "a cuenta" al anular o devolver
  (`p_reintegro_a_cuenta`, lo elige quien puede devolver: no saca plata), y lo ya
  pagado de un fiado que se anula o devuelve (se acredita la deuda ENTERA y el resto
  queda a favor).
- **Se usa en el POS como pago aparte** (`saldo_a_favor_usado` →
  `ventas.saldo_a_favor_aplicado`), NO como fila de `venta_pagos`: esa plata entró
  antes. Sin recargo de CC sobre esa parte (`saldo-a-favor-venta.ts`), cuenta como
  entrega mínima, y el tope contra el saldo real lo pone `registrar_venta` con el
  cliente bloqueado. Offline no se usa. Anular la venta lo devuelve siempre.
- `cuenta_corriente_movimientos.es_saldo_a_favor` marca consumo y vales para que no
  cuenten como fiado.
- **Un vale no es plata que sale** (ver "Reintegros" en caja-y-dinero.md).
- Pendiente: devolver en efectivo un saldo a favor (hoy ajuste manual) y mostrar las
  señas aparte en el resumen del período.

## Cobro de CC: `registrar_cobro_cc` (`20260928210000`)

Una transacción, idempotente y con tope. Antes eran cuatro escrituras sueltas desde
Node, sin tope en el server y sin idempotencia; así nacieron dos cobros duplicados
(21/7).
- El `id` del cobro lo genera el MODAL al abrirse y es la clave de idempotencia
  (reintento → `ya_registrado`).
- Row lock sobre el cliente antes de todo; tope `COBRO_SUPERA_DEUDA` contra el saldo
  releído bajo lock + la mora de este cobro (espejo `tope-cobro-cc.ts`). Con
  `permitir_saldo_a_favor` el excedente queda a favor; sin él rechaza, que es lo que
  frena el duplicado.
- Recargo, comisión y mora se calculan en TS y viajan resueltos.
- Corregir el medio de un cobro de CC: `corregir_metodo_pago_cobro_cc` (permiso
  `clientes.corregir_cobro_cc`).

## La unidad de deuda: el TICKET con su recargo adentro, imputado FIFO (`20260909190000`)

Una clienta que paga, paga su compra más vieja COMPLETA con el recargo que esa
compra generó; recién ahí se salda y el vencimiento pasa a la siguiente. El vínculo
es `cuenta_corriente_movimientos.debito_origen_id` (`20260909180000`): el recargo es
un DEBITO propio que apunta a su ticket.
- Un ticket con recargo impago sigue vivo y viejo aunque el capital esté pagado.
- Un pago parcial no salda nada ni corre ninguna fecha.
- Un recargo que entra después revive su ticket con la fecha vieja.
- Recargo huérfano (sin `debito_origen_id`): devuelve su propia fecha sin sumar
  plazo. Hay uno (medido el 19/10/2026, ver "Venta en cuotas").
- **Controles al tocar la regla**: Vero duarte (Evens) tiene que seguir vencida —un
  pago parcial no saca de mora—; Angi Levis (Estilo Bonito) fue el caso que motivó
  la unidad (saldó agosto antes de vencer y seguía mostrando el 17/09). La
  imputación cambia QUÉ está vivo, nunca CUÁNTO se debe.
- Espejo TS: `features/clients/lib/imputar-pagos-fifo.ts` (41 tests con las cuentas
  reales). Los dos dicen lo mismo.
- **El vencimiento vive cacheado en `clientes.fecha_vencimiento_deuda`**: toda
  migración que cambie `recalcular_vencimiento_cc` tiene que rebackfillearlo.

## Deuda por ticket, por mes y recibo detallado (`20261001120000`)

Etapa 1 de 3 hacia pagos imputados a mano (decidido el 1/10/2026: por mes de
VENCIMIENTO, imputación guardada, desglose en el detalle del cliente).
- **`cc_deudas_vivas(cliente, excluir_pago)`** es la regla única: deuda viva por
  ticket con su recargo adentro, `vence_el` = fecha + `cc_plazo_mora` (un recargo
  huérfano vence el día que nació). `recalcular_vencimiento_cc` es
  `min(vence_el)` de ella. `cc_deudas_vivas_detalle` le suma el número del
  comprobante de emisión (`numeroTicketVenta`). Espejo TS de nombres y grupos:
  `features/clients/lib/deuda-por-mes.ts` (no recalcula, solo agrupa).
- **El día de un movimiento sin `fecha_origen` es el día comercial argentino**,
  no UTC (también en `deuda_cc_vencida` y su "hoy"). Movió 7 vencimientos.
- **Cada cobro guarda su recibo** en la misma transacción
  (`registrar_cobro_cc` → `registrar_recibo_cobro_cc`): `cc_imputaciones` (qué
  canceló de cada ticket = vivo sin el cobro − vivo con el cobro) y
  `cc_recibos` (saldos y lo pendiente por ticket, foto del momento). Sin
  INSERT para `authenticated`; la función es DEFINER y solo acepta un cobro
  creado en la transacción en curso (`xmin`). `recibo_cobro_cc` lo relee para
  reimprimir; los cobros anteriores al 1/10/2026 no tienen recibo guardado.
- **El recibo se imprime o se descarga** (`recibo-cc-sheet.tsx`). Impreso
  salen dos copias (cliente y comercio con firma); el PDF
  (`download-recibo-cc-pdf.tsx`, A5) es SOLO la del cliente: es la constancia
  que se le manda, y un PDF no se firma. Misma entrega que el comprobante de
  venta (hoja de compartir en el celular, descarga en la PC) y
  `@react-pdf/renderer` cargado recién al tocar el botón.
- Hoy la imputación es la AUTOMÁTICA (la misma que decide vencimiento y mora),
  así nada se contradice. Las etapas 2 y 3 están abajo, en "Pendiente".
- Estado de la etapa 1 (1/10/2026): migración APLICADA en prod; código en el
  working tree (commit/deploy a cargo de Ignacio); falta el smoke test (un
  cobro chico: modal por mes, recibo con "Este pago cancela", reimprimir).

### Pendiente: etapa 2 — la imputación guardada pasa a mandar

Objetivo: vencimiento, mora y antigüedad leen `cc_imputaciones` en vez de
reconstruir el FIFO. Sin esto la etapa 3 no se puede hacer: una imputación
manual que dejara viva una compra vieja contradiría la mora calculada por FIFO.
- [ ] Backfill de los cobros anteriores al 1/10/2026 con `origen =
      'RECONSTRUIDA'`, con la misma regla de `cc_deudas_vivas`, incluido el
      saldo a favor consumido por compras posteriores. Guard: por cliente, lo
      vivo según imputaciones = lo vivo según `cc_deudas_vivas`.
- [ ] Decidir cómo se imputa el saldo a favor cuando entra una compra fiada
      (propuesta: trigger AFTER INSERT del DEBITO que le imputa los créditos sin
      asignar, sin tocar `registrar_venta`).
- [ ] Mantener las imputaciones en TODOS los escritores del libro: anular y
      devolver venta (lo imputado a ese ticket queda libre = a favor, coherente
      con "lo ya pagado queda a favor"), anular/editar movimiento manual,
      `corregir_metodo_pago_cobro_cc` (no cambia montos), perdonar deuda,
      `ajustar_saldo_cliente`, consumo de saldo a favor en el POS. Buscar los
      escritores siguiendo el código, no la UI.
- [ ] Reescribir `cc_deudas_vivas` para que lea lo imputado (vivo = monto −
      Σ aplicado), y desde ahí `recalcular_vencimiento_cc`. Guard antes/después
      para TODOS los clientes: el mismo resultado.
- [ ] Unificar `deuda_cc_vencida` (base de la mora; hoy trata el recargo como
      deuda aparte con la fecha del cobro) y `antiguedad_saldo_cc` sobre la
      misma función. Rebackfill de `fecha_vencimiento_deuda` si cambia.
- [ ] Revisar el espejo TS `imputar-pagos-fifo.ts` (41 tests): queda como
      propuesta del modal, no como regla.
- [ ] Controles de siempre: Vero duarte (Evens) sigue vencida; Angi Levis
      (Estilo Bonito) con su vencimiento correcto.

### Pendiente: etapa 3 — el cajero elige qué paga

- [ ] Modal de cobro: los tickets de cada mes con checkbox y monto editable,
      pre-marcados en orden (la propuesta automática). "$90 entre estas 4
      compras": lo no cubierto queda como resto en cada una.
- [ ] `registrar_cobro_cc` recibe `p_imputaciones [{debito_id, monto}]`; el
      server valida bajo el lock del cliente que cada parte ≤ lo vivo de ese
      ticket y que la suma = monto base (+ mora). Sin imputaciones, la
      automática. `origen = 'MANUAL'`.
- [ ] La mora: decidir a qué ticket se carga cuando el cajero NO paga el más
      viejo (hoy va al ticket de capital más antiguo vivo).
- [ ] Recibo y detalle sin cambios de forma (ya leen `cc_imputaciones`).

### Pendiente: vencimientos cacheados desfasados

- [ ] 3 clientes con deuda real con `fecha_vencimiento_deuda` distinta de la
      regla (Librería Colores +13 días, Evens −1 día, Estilo Bonito sin
      vencimiento = sin mora): decidir con cada dueña antes de re-cachear.
- [ ] Encontrar qué escritor deja el cache sin recalcular (la venta fiada de
      Estilo Bonito del 19/9 quedó sin vencimiento).
- **Vencimientos cacheados desfasados de antes** (medido el 1/10/2026, no
  tocados por la migración): 58 clientes con `fecha_vencimiento_deuda` distinta
  de la regla. 48 no deben nada y tienen una fecha vieja, 7 son del Kiosco Demo
  y no tienen vencimiento, y 3 tienen deuda real (ver "Pendiente" abajo).

## Venta en cuotas (en construcción, 19/10/2026)

Pedido de ClickTostado (aires, celulares: compras caras que el comercio
financia). **Es fiado, dentro de la CC**, no el plan de pagos de
[presupuestos.md](presupuestos.md): sin cotización, sin reservas, sin ledger
aparte. No se refinancia deuda existente.

Decidido con Ignacio el 19/10/2026:
- **Las tasas se arman en Configuración** (cuotas → %), por comercio; en la
  venta se elige una. Es la MISMA lista que presupuestos
  (`configuracion_pos.plan_tasas_financiacion`, `[{cuotas, pct}]`): la
  pregunta "cuánto cobra este comercio por financiar en N cuotas" tiene una
  respuesta. Reparto en `shared/lib/cuotas.ts` (centavos, el resto a la última).
- **La tasa del plan REEMPLAZA el recargo de fiar** (`cc_recargo_default`) en
  esa venta, y va sobre lo FINANCIADO (subtotal − entrega − saldo a favor),
  como en presupuestos: la entrega no paga interés. Queda congelada en
  `ventas.recargo_cc_porcentaje` / `recargo_cc_monto`, así anular y devolver
  (que prorratean `recargo_cc_monto`) no cambian.
- **Mensual**: la cuota k vence fecha de venta (día comercial) + k meses,
  contados desde la fecha de venta, no encadenados (31/1 → 28/2, 31/3, 30/4),
  igual que `fecha + k * interval '1 month'` en Postgres. No sigue el cierre
  mensual del comercio.
- **Los pagos cancelan por VENCIMIENTO**, no por fecha de compra: si no, una
  compra fiada de noviembre quedaría vencida mientras el pago se va a la cuota
  de diciembre de un plan viejo.

Modelo: una venta en N cuotas son **N tickets** (DEBITO con `venta_id`) con
`cuenta_corriente_movimientos.vence_el` propio (null = la regla del comercio,
como hasta ahora) y `cuota_numero` / `cuotas_total`. Todo lo que mira deuda
pasa por `cc_deudas_vivas`, así que vencimiento del cliente (= próxima cuota),
mora (`PORCION_VENCIDA` toma solo las cuotas vencidas), deuda por mes, resumen
público, recibo y avisos lo ven sin cambios. `ventas.monto_pendiente` = Σ
cuotas (sigue siendo fiado, que es lo que suponen sus lectores).

Lo que midió la auditoría (19/10/2026):
- `anular_venta` acredita `monto_pendiente` entero y `registrar_devolucion`
  prorratea `recargo_cc_monto`: funcionan sin cambios con N tickets.
- `deuda_cc_vencida.ventas_vencidas_nuevas` cuenta TICKETS: con MONTO_FIJO, un
  fijo por cuota vencida (cada cuota es un vencimiento; decidido así).
- `debito_capital_mas_antiguo_id` (a qué ticket se pega la mora) ordena por
  fecha: pasa a vencimiento junto con `cc_deudas_vivas`.
- `registrar_venta` calcula `ventas.fecha_vencimiento` con la fecha en UTC, no
  el día comercial (una venta fiada después de las 21 vence un día más tarde
  en esa columna; `cc_deudas_vivas` usa el día AR). Se corrige en la etapa 2.
- El FIFO en TS (`imputar-pagos-fifo.ts`) solo lo usan sus tests.
- ClickTostado: plazo 30 días, modo DIAS, recargo de fiar 4,8%, mora 0%,
  `PORCION_VENCIDA`; 8 clientes deben $2.046.770 en 11 ventas.

Etapas (cada una se cierra y se reporta antes de la siguiente):
1. Lógica pura con tests: `shared/lib/cuotas.ts` (movido de presupuestos) y
   `features/clients/lib/plan-cuotas-cc.ts` (tasa elegida, cuotas y
   vencimientos; espejo de lo que va a hacer la RPC).
2. Base (`20261019140000_cc_venta_en_cuotas.sql`, reversión en
   `supabase/reversals/`): columnas con CHECK y trigger `CUOTA_INMUTABLE`
   (la policy de la tabla deja hacer UPDATE de cualquier columna, `monto`
   incluido: hueco viejo, sin tocar acá); `cc_registrar_cuotas_venta`
   (INVOKER) relee la tasa (fail-closed: `PLAN_CUOTAS_INVALIDO`), valida
   porcentaje (`PLAN_CUOTAS_TASA_DISTINTA`) e interés sobre lo financiado
   (`PLAN_CUOTAS_INTERES_DISTINTO`), rechaza offline (`PLAN_CUOTAS_OFFLINE`)
   y escribe los N tickets; `registrar_venta` la llama con `p_cc.cuotas`, el
   plan no pide `fiar_sin_recargo`, y la venta vence con la primera cuota.
   - **Orden de cancelación**: `cc_deudas_vivas` devuelve `vence_el` (lo que
     se muestra) y ordena por `orden`. Un ticket ordena por su vencimiento;
     un **recargo huérfano** vence el día que nace pero ordena como una
     compra de ese día. El guard lo encontró: hay UNO (SILVINA GONZALEZ,
     Librería Colores, $1.414,50 del 7/10, "Recargo por mora"), y ordenarlo
     por su vencimiento lo pagaba antes que el ticket del 3/10 y la sacaba de
     vencida.
   - **Por qué quedó huérfano (investigado el 19/10/2026)**: NO nació sin
     origen. El 7/10 a las 10:37 se cobraron $37.644,50 por transferencia y
     el recargo nació pegado a un "Saldo inicial (deuda del 14/08/2026)" de
     $9.430 (15% = $1.414,50); el recibo dice que ese cobro canceló el saldo
     inicial con su mora y el ticket del 24/9. A las 17:26 Maximiliano ANULÓ
     ese saldo inicial (`anularMovimientoManualAction`), que no mira las
     moras que apuntan al movimiento: el saldo bajó $9.430, pero el recargo
     de $1.414,50 siguió vivo y `cc_deudas_vivas` lo ve huérfano (filtra los
     anulados). A las 17:36 entró otro cobro de exactamente $1.414,50, pero
     el FIFO lo imputó al ticket del 3/10, no al recargo, así que el recargo
     sigue debiéndose y vencido desde el 7/10. Es el ÚNICO caso en la base
     (moras vivas con origen anulado, inexistente o nulo).
   - Pendiente: decidir con la dueña de Colores qué pasa con esos $1.414,50
     (si el saldo inicial no existía, la mora sobre él tampoco: "Perdonar
     deuda").
   - **Arreglado (19/10/2026)**: `anularMovimientoManualAction` frena si el
     movimiento tiene moras vivas apuntándolo y manda a "Perdonar deuda"
     primero. Además el UPDATE pasó a condicional (`anulado = false`) con
     chequeo de filas: antes una anulación filtrada por RLS, o dos al mismo
     tiempo, reversaban el saldo igual.
   - Ensayo en seco (19/10, transacción revertida, como la admin de
     ClickTostado): guards de equivalencia OK para todos los clientes; 6
     cuotas de $20.000 sobre $100.000 al 20% vendidas a las 23:30 vencen el
     19 de cada mes (día AR); un pago de $30.000 cancela la deuda vieja
     ($27.500) y $2.500 de la cuota 1; los cinco frenos responden.
   - **Aplicada en prod el 19/10/2026** (guards OK; verificado: columnas,
     trigger, `registrar_venta` llama al plan, `anon` sin EXECUTE, 0 cuotas).
3. Pantallas (código en el working tree, 19/10/2026):
   - Configuración > Clientes, tarjeta "Venta en cuotas": el editor de tasas
     es `shared/ui/editor-tasas-cuotas.tsx`, el mismo que usa Presupuestos
     (una lista por comercio). Se guarda con `validarTasas`.
   - POS: al fiar, chips "Fiado / N cuotas" en el pie del ticket
     (`cart-sidebar-footer.tsx`), renglón "Financiación N cuotas (x%)" y
     "N cuotas de $X · la 1ª vence el d/m". El modal de la entrega rehace el
     plan con lo que se tipea (`payment-modal.tsx`, prop `planCuotas`) y no
     deja confirmar si la entrega cubre todo. **La entrega mínima del plan va
     sobre el precio de contado** (POS y server): el interés depende de la
     entrega y no puede ser su propia base. El recargo de fiar y su "Anular"
     desaparecen con plan.
   - `create-sale.ts`: los pagos se calculan ANTES del recargo de fiar (el
     interés va sobre lo que queda después de la entrega); con `cuotas_cc`
     arma el plan con `armarPlanCuotasCc`, manda `p_cc.cuotas` y traduce los
     `PLAN_CUOTAS_*` (`mensajeRechazoPlanCuotas`).
   - **Sin señal no se vende en cuotas** y una venta en cuotas no se encola:
     si la red se corta a mitad, el POS pide revisar en Ventas antes de
     volver a cobrar (reconfirmar genera OTRO id, no es idempotente).
   - Ticket (pantalla, papel y WhatsApp): las cuotas con su vencimiento,
     desde `TicketData.planCuotas`. Al cerrar la venta lo arma el POS; al
     reabrirlo desde /ventas sale de las cuotas guardadas
     (`features/sales/lib/plan-cuotas-ticket.ts`), pedidas SOLO al abrir el
     ticket de una venta fiada, no como embed del listado (egress).
   - El detalle del cliente, la deuda por mes y el resumen público ya las
     muestran sin cambios (cada cuota es un ticket con "Cuota k/N" en la
     descripción y su `vence_el`).
4. Smoke en ClickTostado.

## Mora

- **La regla (Ignacio con Evelyn, 8/10/2026)**: cada venta vence en su plazo
  y es independiente. Hay mora nueva SOLO cuando vence una venta nueva (un
  cobro sin venta nueva vencida no recarga), y entonces el porcentaje va sobre
  TODO el capital vencido vivo, sin la mora anterior (el 15% de fiar sí entra:
  es parte del ticket). Ejemplo: A $10.000 vence 6/10, B $20.000 vence 20/10;
  cobro del 10/10 → 15% × 10.000; cobro del 14/10 → nada; cobro del 25/10 →
  15% × 30.000. Monto fijo: uno por cada venta vencida. Una compra hecha con la
  cuenta vencida no entra en mora hasta que vence ella.
  - Evens y Estilo Bonito (`20261008150000`) y ClickTostado
    (`20261008170000`) pasaron a `PORCION_VENCIDA`: ningún comercio queda en
    `SALDO_COMPLETO`.
  - **`deuda_cc_vencida` imputa como `cc_deudas_vivas`** (`20261008180000`):
    la mora dentro de su venta y pagada primero (capital vivo =
    `least(capital, vivo)`). Antes armaba su propio FIFO con la mora como
    deuda aparte, al final de la fila: `mora_viva` inflada y base de menos
    (Vero duarte: $10.000 contra $14.500 vivos). Medido al aplicar: el saldo
    vivo no cambió para nadie y la base solo cambió para Vero.
  - **Monto fijo: uno por cada venta vencida que no recargó**
    (`ventas_vencidas_nuevas`). Sin el dato, el TS cae al criterio viejo (uno
    por cobro).
  - **Pendiente de decidir**: `PORCION_VENCIDA` recarga solo el capital
    vencido que todavía no recargó; el ejemplo de arriba (15% × 30.000 el
    25/10, A otra vez) todavía no está implementado.
  - **Corrección de lo mal cobrado** (`20261008160000`, decisión de la dueña):
    a los 6 clientes de Evens que todavía deben, cada recargo bajó al monto que
    correspondía con esta regla y los que no correspondían se borraron, sin
    rastro de "perdón" ni saldo a favor ($53.256,34; CELESTE SCHOFER
    $23.278,84: 26/9 $18.828,75 → $30,19 y 7/10 $6.555 → $2.074,72). A los 7
    que ya tienen saldo cero no se les tocó nada ("lo que se cobró se cobró").
    Cálculo: cada mora REALMENTE cobrada contra el libro de ese momento, plazo
    30 días hasta el 28/8 y 35 después. Reversión en `supabase/reversals/`.
- **La base la elige cada comercio** (`configuracion_pos.recargo_mora_base`,
  `20261005120000`): `SALDO_COMPLETO` (default, cláusula de aceleración) o
  `PORCION_VENCIDA` (solo `capital_vencido` de `deuda_cc_vencida`). Nació del
  reclamo de Librería Colores (5/10/2026): NATI CORDOBA, $14.800 vencidos y una
  compra de $302.150 de seis días, $47.542,50 de mora sobre el saldo contra
  $2.220 sobre lo vencido; ROMI MANSILLA pagó $17.377,50 donde sobre lo vencido
  eran $9.270.
- **SALDO_COMPLETO** (5/9/2026): cláusula de aceleración aceptada a sabiendas por
  la dueña de Evens, que quedó global hasta el 5/10. Cuesta mucho más al cliente
  (CELESTE SCHOFER: $15.723,75 contra $26,25); el test de
  `calcular-saldo-con-recargo.test.ts` guarda esos números. `estaVencido` no exige
  `montoVencido > 0`; solo saldo cero apaga el recargo.
- **El vencimiento es "días desde la compra" o "cierre mensual"**, por comercio
  (`cc_vencimiento_modo`, `20261005140000`). Con cierre: lo comprado ANTES de
  `cc_dia_cierre` cierra ese día y vence el `cc_dia_vencimiento` siguiente (NULL =
  el día del cierre); días 1..28. **Una sola regla: `cc_vence_el`**, que usan
  `cc_deudas_vivas`, `deuda_cc_vencida` y `registrar_venta`; espejo TS
  `calcularVencimientoCc` (mismos casos en el test y en el guard de la migración).
  Cambiar el modo o los días re-cachea los vencimientos del comercio (mismo
  trigger). **Librería Colores: cierre 1, vence 15** (`20261005170000`): lo
  comprado en todo el mes se avisa alrededor del 5 y se paga hasta el 15 del mes
  siguiente. **El día de aviso no es el día de cierre**: `20261005140000` cargó
  cierre 5 por ese malentendido y lo del 1 al 4 de cada mes caía en el ciclo
  anterior (NATI CORDOBA: $14.800 del 4/9 "vencidos el 15/9"). Al corregirlo,
  los vencidos al 5/10 pasaron de 54 a 37 clientes.
  Mora cobrada el 5/10 con la regla mal: MARIANA BOLEA, $1.522,50 sobre un saldo
  inicial del 1/9 que con cierre 1 vence el 15/10. Ajuste a decidir con la dueña.
- Pendiente: crear y editar cliente (`crearClienteAction`, `editClienteAction`)
  escriben `fecha_vencimiento_deuda` a mano desde el formulario, por fuera de la
  regla; probable escritor del "cache desfasado" de abajo.
- **El plazo (`cc_plazo_mora`) es >= 1** (CHECK). Con 0 una compra vence el día
  que se hizo y al siguiente toda la cuenta está en mora. **Cambiar el plazo re-cachea `fecha_vencimiento_deuda`**
  de todo el comercio (trigger `trg_recachear_vencimientos_por_plazo`); antes el
  cache quedaba con el plazo viejo hasta el próximo movimiento de cada cliente.
- **"Hoy" es el día comercial argentino también en TS** (`calcularDiasVencido`,
  5/10/2026). Con el calendario del server (UTC) una deuda que vencía hoy cobraba
  mora desde las 21:00.
- **Pero sobre CAPITAL: el saldo NO incluye recargos anteriores**
  (`20260909170000`): base = `monto_pendiente − mora_previa` (de `mora_viva` en
  `deuda_cc_vencida`). Si no, interés compuesto, contra lo que promete Configuración
  ("se suma una única vez"). Los cuatro consumidores de `calcularSaldoConRecargo`
  (cobro, `datos-cobro-cc`, tabla y detalle) pasan `mora_previa`.
- **La mora NO se aplica sola: se materializa al cobrar.** Sin cron. La pantalla la
  calcula al vuelo; `registrarPagoDeudaAction` inserta el DEBITO real antes del
  cobro con su `debito_origen_id`. Un cambio de criterio de RECARGO no necesita
  backfill; uno de VENCIMIENTO sí.
- Configurable en Configuración > Clientes (`clients-panel.tsx`): `cc_plazo_mora`,
  `recargo_mora_tipo` / `recargo_mora_valor` (NINGUNO | MONTO_FIJO | PORCENTAJE) y
  `recargo_mora_base`.
- **La mora se cobra UNA vez por venta** (`20261005120000`). Hasta el 5/10/2026
  cada cobro con la cuenta vencida recargaba de nuevo el mismo capital (9 clientes
  con 2 o 3 recargos; Evens, MARA MANSILLA: 4/9, 14/9 y 26/9). `deuda_cc_vencida`
  devuelve el capital vivo que ya pagó su recargo y se resta de la base:
  `recargado_saldo` (la venta existía cuando se cobró una mora; SALDO_COMPLETO) y
  `recargado_vencido` (ya estaba vencida en ese momento; PORCION_VENCIDA). Vale
  también para MONTO_FIJO: sin capital por recargar no hay otro fijo.
- Librería Colores: plazo 32 días y PORCION_VENCIDA desde el 5/10/2026 (lo puso la
  migración; antes tenía plazo 0).

## Recordatorio de deuda por WhatsApp (`20261004120000`)

Botón "Recordar" del detalle del cliente; arma el texto `construirMensajeDeuda`
(`features/clients/lib/mensaje-deuda.ts`) y el detalle viaja como link a `/r/<token>`.
- **Plantilla por comercio**: `configuracion_pos.mensaje_recordatorio_cc`, editable en
  Configuración > Clientes. NULL = mensaje por defecto (no se siembra el texto: si el
  default mejora, lo reciben los que nunca lo tocaron). CHECK de 1 a 1000 caracteres.
  anon no la lee (GRANT por columna, la columna nació sin él).
- Variables: `{nombre}`, `{nombre_completo}`, `{comercio}`, `{total}`, `{saldo}`,
  `{recargo}`, `{desglose}`, `{vencimiento}`, `{link}`. **`{total}` es lo que va a
  cobrar el sistema** (saldo + mora, misma `calcularSaldoConRecargo` que el cobro).
- **El resumen público (`/r/<token>`) muestra qué vence cada mes**
  (`20261005130000`): `resumen_cuenta_por_token` devuelve `deudas` de
  `cc_deudas_vivas_detalle` y la página agrupa con `agruparDeudaPorMes` y
  `DeudaPorMesLista`, lo mismo que el detalle del cliente. Antes mostraba un solo
  "vence el" (el vencimiento más viejo) para todo el saldo: EESO 405 en Colores leía
  $276.450 "vence el 10/10" cuando ese día vencían $98.850. Sin botón "Escribirle al
  comercio" ni pie de emisión (pedido del 5/10/2026).
- **"Pagar con Mercado Pago" desde el resumen: decidido con Ignacio el 22/10/2026**
  (no empezado). El botón aparece SOLO si el comercio tiene Mercado Pago conectado
  (`mercadopago_conexiones` ACTIVA). Montos: "Pagar lo vencido $X" y "Pagar todo
  $Y" (con cierre mensual, lo del ciclo), mora incluida y calculada al tocar el
  botón; sin monto libre. Si al llegar el pago la deuda ya bajó (pagó en el local
  entre medio), se registra igual y el excedente queda a favor, con aviso al
  comercio. La comisión la absorbe el comercio (se registra la real, de
  `fee_details`). La plata entra a la cuenta de Mercado Pago del comercio, la misma
  "Mercado Pago (tienda online)", sin turno. Aviso "María pagó $X con Mercado Pago"
  en la campana (y por push cuando exista). Hace falta: tabla de intentos (cliente,
  monto, mora congelada, preference, vence ~1 h), un cobro de CC llamable sin sesión
  (service_role, como `_registrar_venta_orden_tienda`), `external_reference` con
  prefijo `cc:` para que el webhook distinga deuda de orden. Antes: probar de punta a
  punta en producción el checkout de la tienda con un pago real chico (nunca se
  procesó un pago de MP en producción; `MP_WEBHOOK_SECRET` está cargado en Vercel
  según Ignacio) y que un comercio que fía conecte MP (Evens).
  **Construido el 22/10/2026** (migración `20261022180000`, código en el working
  tree, sin prueba real):
  - `cobros_cc_online`: un intento por botón tocado (capital + mora congelada,
    vence en 1 h, tope 10 por clienta y hora). Su id es el id del cobro en
    `venta_pagos`. Lectura con `clientes.ver_modulo`; escriben solo el server y la RPC.
  - `aplicar_pago_mp_cobro_cc` (solo service_role) es la única puerta, desde el
    webhook (`external_reference = cc:<intento>`, `destinoDelPago`) y desde la
    conciliación (`conciliarCobrosCc`, dentro de `conciliarPagosNegocio` y al volver
    al resumen con `?pago=`). Aprobado y exacto → `registrar_cobro_cc` sin turno, al
    método MP_CHECKOUT de la tienda, con la comisión real; si la deuda bajó entre
    medio la mora no se materializa y el excedente queda a favor. Monto distinto →
    REVISAR sin cobro. Mismo pago dos veces → DUPLICADO; otro pago aprobado →
    PAGO_DUPLICADO con aviso. Aviso `COBRO_CC_ONLINE` (categoría PLATA).
  - **El cobro sin sesión**: `registrar_cobro_cc`, `registrar_recibo_cobro_cc` y
    `recibo_cobro_cc` leen `coalesce(security.current_negocio_id(),
    _negocio_de_sistema())`. `_negocio_de_sistema()` solo devuelve algo con rol
    service_role y la variable `comerz.negocio_sistema` de la transacción; con
    una sesión normal la sesión gana. Probado en seco contra producción.
  - Montos (`opcionesPagoCc`, con tests): "Pagar lo vencido" / "lo del mes" y
    "Pagar todo", mora de hoy en los dos. La leyenda de la mora es
    `descripcionMora`, compartida con el cobro del mostrador.
  - La página `/r/<token>` muestra los botones solo con Mercado Pago conectado y
    deuda, y al volver dice "recibimos tu pago" / "lo estamos confirmando".
  - **La comisión que se guarda** (`comisionDelPago`, vale también para la
    tienda): `transaction_amount − net_received_amount`, o sea todo lo que
    Mercado Pago le descuenta al comercio (comisión + impuestos y retenciones);
    sin el neto, solo los `fee_details` con `fee_payer` collector. Hasta el
    22/10/2026 sumaba TODOS los `fee_details`, incluido el interés de las cuotas
    que paga la clienta (`financing_fee`, payer): habría inflado la comisión de
    cualquier pago en cuotas (no hubo pagos reales). El desglose (comisión de MP,
    neto, interés a cargo de la clienta) queda en `eventos_pago.payload`.
  - Pendiente: la prueba real (un pago chico en un comercio con MP conectado).
- Lo charlado el 8/10/2026, que lo de arriba completa:
  Decidido hasta acá: el pago entra a la cuenta de Mercado Pago del comercio
  por default (sin turno de caja), con la cuenta destino CONFIGURABLE; el monto
  se recalcula al pagar (la mora pudo cambiar desde que se mandó el link).
  Falta decidir y auditar: el aviso de pago (un redirect a Mercado Pago no
  alcanza para registrar el cobro: hace falta el webhook, idempotente por id
  de pago, que llame a `registrar_cobro_cc`) y cómo entra la comisión de
  Mercado Pago. Mismo OAuth por comercio que la Fase 3 de
  [tienda-online.md](tienda-online.md).
- **Alias para transferir** (`20261008200000`, 8/10/2026):
  `configuracion_pos.alias_transferencia` (alias de 6 a 20 caracteres o
  CBU/CVU de 22 dígitos, CHECK + espejo `validarAliasTransferencia`), cargado
  en Configuración > Clientes. El resumen muestra "Pagá por transferencia" con
  alias y monto para copiar (`CopiarDato`), solo si debe algo. No hay forma
  estándar de abrir la transferencia ya cargada sin pasarela. Sin botón
  "Avisar que pagué": la clienta confirma mandando el comprobante por
  WhatsApp. anon no lee la columna: sale solo por la RPC, a quien tiene el
  link.
- **Cabecera, catálogo y firma** (`20261008190000`, pedido del 8/10/2026):
  arriba el logo de la tienda (`posLogo`; sin logo, la inicial) y el nombre;
  al final un botón "Ver el catálogo de …" solo si el catálogo no está
  cerrado (`catalogo_activo` distinto de false, mismo criterio que la tienda:
  la RPC devuelve `catalogo_slug` o null y la URL la arma `urlDeCatalogo`); y
  afuera de la tarjeta, discreto, "Gestión de cuenta corriente con Comerz ·
  www.comerz.app".
- **Con cierre mensual, el resumen es el del ciclo** (`20261006120000`, pedido del
  6/10/2026 para Colores): el mensaje y el link muestran lo que vence hasta el
  vencimiento del ciclo vigente, deuda vieja incluida (cada mes en su renglón);
  lo comprado después del cierre vence el mes que viene y no aparece. Si no debe
  nada del ciclo, el corte es su próximo vencimiento. Una regla:
  `corteResumenCc` (`features/clients/lib/resumen-ciclo.ts`, con tests). El
  mensaje usa el `monto` de `useAvisosCc` (capital del ciclo) + la mora entera
  (la mora es solo sobre lo vencido, que siempre cae en el ciclo). La RPC
  devuelve `regla_vencimiento` y `movimientos[].vence_el` (de `cc_deudas_vivas`:
  la mora pegada a un ticket vence con su ticket); la página saca los cargos que
  vencen después del corte, deja TODOS los pagos y recalcula el saldo corriente.
- Una línea que usa un dato que no hay (sin vencimiento, sin link) no se manda. Una
  variable desconocida no se puede guardar; si llegara, queda literal (no se borra
  texto en silencio).

## Avisos de cuenta corriente (en curso, 5/10/2026)

"A quién avisar hoy" para comercios con CIERRE MENSUAL (no en modo días: sería una
lista diaria y ruidosa). Semiautomático: el sistema arma la lista y el mensaje, la
persona toca Enviar y se abre WhatsApp. Sin API de Meta.
- **Fase 1 (lógica)**: `features/clients/lib/avisos-cc.ts`, con tests. Ciclo
  vigente = último cierre <= hoy y su vencimiento V (misma regla
  `calcularVencimientoCc`). CIERRE desde el cierre hasta V−3, PREVIO de V−2 a V
  (`DIAS_AVISO_PREVIO`), MORA desde V+1 hasta el cierre siguiente. Los tres
  avisan TODO lo que vence hasta V, deuda vieja incluida (Colores el 5/10: 56
  clientes arrastraban deuda del 15/9). Mismo mensaje que "Recordar".
- **Fase 2 (base, `20261005150000`)**: `cc_deuda_por_vencimiento()` (INVOKER, deuda
  viva por cliente y vencimiento del negocio en un viaje, de `cc_deudas_vivas`;
  Colores: 116 clientes, cuadra al peso con el saldo, 100 ms) y `cc_avisos`
  (append-only, UNIQUE por cliente + tipo + vencimiento, sin FK al cliente, monto
  como foto; leer y marcar piden `clientes.ver_modulo`, el acceso del botón
  Recordar; se registra solo a nombre propio). "Enviado" = se abrió WhatsApp, no
  que el mensaje salió.
- **Fase 3 (pantalla)**, rediseñada el mismo día a pedido de Ignacio (un banner con
  panel aparte "medio raro y con poca información"): en la tabla de Clientes,
  (a) un toggle aparte del select de estado (`FiltroCicloCobro`), "A abonar 15/10"
  ("Impagos 15/10" desde el día siguiente al vencimiento), solo con cierre
  mensual; se combina con el estado y, prendido, los tres KPI pasan a contar el
  ciclo (cuentas, capital a abonar + mora, resúmenes enviados); el estado pasó de
  tabs a select en todos los tamaños; (b) una columna
  "Resumen" con el ícono de WhatsApp en cada cliente con deuda, para mandar el
  resumen de cuenta en CUALQUIER momento del mes. Si el cliente está en el ciclo,
  el envío queda en `cc_avisos` y el ícono se pone verde con un check. El botón
  "Recordar" del detalle pasó a "Resumen" y también registra. Todo sale de
  `useAvisosCc` (`getAvisosCcAction` lee la config primero: en modo días no paga
  el viaje de la deuda; `marcarAvisoCcEnviadoAction`, 23505 = ya estaba) y de
  `useRecordatorioCc` (el envío: mismo link, plantilla y total con mora en los dos
  lugares). Clave de query `clientes.avisos` cuelga de `clientes.listado`: un
  cobro invalida los dos.
- Pendiente: fase 4 (smoke en Colores).
- **Modo días y "Por vencer" (22/10/2026, docs/asistente-ia.md A2)**. La regla de
  arriba ("en modo días no, sería ruidosa") se revirtió: Evens, Estilo Bonito y
  ClickTostado tenían millones fiados y ninguna lista. Se resolvió agrupando:
  - **Estado "Por vencer"** en `clasificarEstadoCliente`: saldo > 0 y la deuda más
    vieja vence hoy o en los próximos `DIAS_POR_VENCER` (5) días. Sale de
    `fecha_vencimiento_deuda`, que es el vencimiento de la deuda viva más vieja
    (verificado: 152 de 152 iguales a `cc_deudas_vivas` en Evens y Estilo Bonito).
  - **Lista "A cobrar"** (`avisosModoDias`, pura, con tests): vencidos (MORA) y
    por vencer (PREVIO), un renglón por cliente, monto = lo vencido + lo que vence
    en la ventana. Clave en `cc_avisos`: MORA con la ÚLTIMA venta vencida (un
    vencimiento nuevo es un aviso nuevo; no uno por día, misma idea que la mora),
    PREVIO con el próximo vencimiento. Sin migración: reusa tipos y UNIQUE.
  - `getAvisosCcAction` devuelve `modo` y cada cliente con SU tipo y vencimiento
    (con cierre son los del ciclo para todos); `marcar` usa los del cliente.
  - **Envío en tanda** (`envio-en-tanda.tsx`), para los dos modos: "Enviar a N"
    abre una cola con los de la lista sin enviar; Enviar abre WhatsApp con el mismo
    mensaje y registro que la columna, y pasa a la siguiente. La cola se congela al
    abrir. Sin API de WhatsApp (decisión del 22/10: riesgo de bloqueo del número y
    costo por mensaje; se reconsidera si la tanda muestra decenas por semana).

## Recargo de CC en la venta (`20260823180630`)

`ventas.recargo_cc_porcentaje` / `recargo_cc_monto` (congelados, sin default: null =
"no se sabe", 0 = "se fió sin recargo") y `cuenta_corriente_movimientos.monto_recargo`.
El default del negocio es `configuracion_pos.cc_recargo_default`, recalculado en el
server.
- **"Modificar" el recargo en el ticket** (23/10/2026, antes solo "Anular"): en
  RECARGO CC, "Modificar" abre los atajos `Sin recargo · 5% · 10% · 15%` y un campo
  numérico (0 a 100, coma o punto), más "Restaurar" al del comercio. Solo viaja el
  PORCENTAJE (`cc_recargo_pct`); el monto lo recalcula el server, y se guarda en las
  mismas `recargo_cc_porcentaje` / `recargo_cc_monto`: anular, devolver, el ticket y la
  factura ya funcionaban con un porcentaje cualquiera. Con plan de cuotas manda la
  tasa del plan. Solo aparece si el comercio tiene recargo de fiar > 0.
  - **Apartarse del default —anular, bajar o subir— pide `ventas.fiar_sin_recargo`**
    (antes solo pedía el 0, y la base no protegía un 5% donde rige 15%). Lo exige
    `create-sale.ts` y, de nuevo, `registrar_venta` (`20261023150000`, guard sobre el
    cuerpo vivo). **`tiene_permiso` devuelve siempre true para ADMIN**: una prueba del
    guard tiene que usar una vendedora real, no el admin.
  - Compat: `cc_sin_recargo=true` (lo mandan pedidos a caja y tickets guardados antes)
    vale 0; `ventas-en-cola-store` y `PedidoContexto` leen el booleano viejo.
  - **Fase 2 hecha (23/10/2026)**: recargo libre en venta común (contado), con columnas
    propias y permiso `ventas.recargo_libre`. Ver [ventas.md](ventas.md#recargo-libre-del-ticket-venta-de-contado-23102026).
    Un ticket tiene UN solo recargo: en cuenta corriente se modifica este, en contado
    se usa el libre.
- Cargar deuda a mano pide `clientes.cargar_saldo`; corregir el medio de un cobro
  (que cambia su recargo por método) quedó solo para ADMIN. Ver
  [seguridad.md](seguridad.md) (`20261007230000`).

## Anular o devolver un fiado

El crédito es `least(deuda de la venta, saldo actual)`, nunca `monto_pendiente`
(congelado). Lo ya pagado queda como saldo a favor. Los pagos de CC no están
imputados a una venta en la base (el FIFO es un cálculo), así que no se sabe con qué
medio se pagó ese ticket.
