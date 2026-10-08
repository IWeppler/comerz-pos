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
- **En stand by: "Pagar cuenta" desde el resumen** (charlado el 8/10/2026).
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

## Recargo de CC en la venta (`20260823180630`)

`ventas.recargo_cc_porcentaje` / `recargo_cc_monto` (congelados, sin default: null =
"no se sabe", 0 = "se fió sin recargo") y `cuenta_corriente_movimientos.monto_recargo`.
El default del negocio es `configuracion_pos.cc_recargo_default`, recalculado en el
server.
- Anularlo en el ticket ("Anular" en RECARGO CC) pide `ventas.fiar_sin_recargo`;
  cargar deuda a mano pide `clientes.cargar_saldo`; corregir el medio de un cobro
  (que cambia su recargo por método) quedó solo para ADMIN. Ver
  [seguridad.md](seguridad.md) (`20261007230000`).

## Anular o devolver un fiado

El crédito es `least(deuda de la venta, saldo actual)`, nunca `monto_pendiente`
(congelado). Lo ya pagado queda como saldo a favor. Los pagos de CC no están
imputados a una venta en la base (el FIFO es un cálculo), así que no se sabe con qué
medio se pagó ese ticket.
