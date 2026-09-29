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
  plazo. Hoy no hay.
- **Controles al tocar la regla**: Vero duarte (Evens) tiene que seguir vencida —un
  pago parcial no saca de mora—; Angi Levis (Estilo Bonito) fue el caso que motivó
  la unidad (saldó agosto antes de vencer y seguía mostrando el 17/09). La
  imputación cambia QUÉ está vivo, nunca CUÁNTO se debe.
- Espejo TS: `features/clients/lib/imputar-pagos-fifo.ts` (41 tests con las cuentas
  reales). Los dos dicen lo mismo.
- **El vencimiento vive cacheado en `clientes.fecha_vencimiento_deuda`**: toda
  migración que cambie `recalcular_vencimiento_cc` tiene que rebackfillearlo.

## Mora

- **La base es el SALDO COMPLETO, no la porción vencida** (5/9/2026): cláusula de
  aceleración aceptada a sabiendas por la dueña. Cuesta mucho más al cliente (CELESTE
  SCHOFER: $15.723,75 contra $26,25); el test de `calcular-saldo-con-recargo.test.ts`
  guarda esos números para que nadie la "corrija" de vuelta. `estaVencido` ya no
  exige `montoVencido > 0`; solo saldo cero apaga el recargo.
- **Pero sobre CAPITAL: el saldo NO incluye recargos anteriores**
  (`20260909170000`): base = `monto_pendiente − mora_previa` (de `mora_viva` en
  `deuda_cc_vencida`). Si no, interés compuesto, contra lo que promete Configuración
  ("se suma una única vez"). Los cuatro consumidores de `calcularSaldoConRecargo`
  (cobro, `datos-cobro-cc`, tabla y detalle) pasan `mora_previa`.
- **La mora NO se aplica sola: se materializa al cobrar.** Sin cron. La pantalla la
  calcula al vuelo; `registrarPagoDeudaAction` inserta el DEBITO real antes del
  cobro con su `debito_origen_id`. Un cambio de criterio de RECARGO no necesita
  backfill; uno de VENCIMIENTO sí.
- Configurable en Configuración > Clientes (`clients-panel.tsx`): `cc_plazo_mora` y
  `recargo_mora_tipo` / `recargo_mora_valor` (NINGUNO | MONTO_FIJO | PORCENTAJE).

## Recargo de CC en la venta (`20260823180630`)

`ventas.recargo_cc_porcentaje` / `recargo_cc_monto` (congelados, sin default: null =
"no se sabe", 0 = "se fió sin recargo") y `cuenta_corriente_movimientos.monto_recargo`.
El default del negocio es `configuracion_pos.cc_recargo_default`, recalculado en el
server.

## Anular o devolver un fiado

El crédito es `least(deuda de la venta, saldo actual)`, nunca `monto_pendiente`
(congelado). Lo ya pagado queda como saldo a favor. Los pagos de CC no están
imputados a una venta en la base (el FIFO es un cálculo), así que no se sabe con qué
medio se pagó ese ticket.
