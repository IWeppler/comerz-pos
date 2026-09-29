# Presupuestos y planes en cuotas (en construcción)

Leé esto antes de tocar `features/presupuestos/`, `negocios.modulo_presupuestos`,
las tablas `presupuestos` / `planes_pago` / `plan_cuotas`, o un `tipo_movimiento`
nuevo en `venta_pagos`. Depende de [ventas.md](ventas.md),
[caja-y-dinero.md](caja-y-dinero.md) y [cuenta-corriente.md](cuenta-corriente.md).

Parámetros definidos el 28/9/2026. Tres cosas encadenadas, no tres módulos:
**cotización** (carrito con precio congelado y vencimiento; no toca stock, caja
ni factura, como `pedidos`), **plan de pagos** (nace al ACEPTAR una cotización
con financiación: crédito PROPIO del comercio, N cuotas con vencimiento; las
cuotas con tarjeta siguen siendo una venta normal con recargo por método) y
**pagos anticipados** (cobros imputados al plan antes de que exista la venta).

Decisiones tomadas:
- Entrega por presupuesto: `AL_FINALIZAR` (retira al completar) o `AL_INICIO`
  (se lo lleva y queda debiendo).
- **Deuda en un ledger propio por plan, FUERA de la cuenta corriente.** La CC,
  su FIFO, su vencimiento y su mora no se tocan.
- Stock (AL_FINALIZAR): se aparta con el PRIMER PAGO; cotizar o aceptar sin
  plata no reserva.
- Cancelación con penalidad configurable (% por negocio): se retiene esa parte
  (es resultado) y el resto vuelve por el medio que elige el dueño o como saldo
  a favor (patrón `reintegro_metodo_*`).

**La llave es `negocios.modulo_presupuestos`** (default false, solo la prende
el super admin desde /admincomerz). En `negocios` y no en `configuracion_pos`
porque a esa la escribe el ADMIN del negocio; verificado simulando a la ADMIN
de Evens: 0 filas. NO es feature de plan: `tieneFeature` falla ABIERTO (sin
plan tiene todo), y cuando se venda en un plan se suma la feature ADEMÁS del
interruptor. `modulo_presupuestos_habilitado()` / `modulo-habilitado.ts` son
**fail-closed**: ante error no aparece. Con false no hay ruta, ni link, ni botón
en el POS, y las RPCs lanzan `MODULO_NO_HABILITADO`.

Configuración (`configuracion_pos`, todo se COPIA al plan al aceptar — cambiar
la config no cambia un plan firmado): `plan_tasas_financiacion` jsonb
(`[{cuotas:3, pct:10}]`, sobre el saldo FINANCIADO = total − anticipo),
`plan_frecuencia_default`, `plan_mora_tipo` / `_valor` (por cuota vencida, una
sola vez, sobre capital: misma regla que la CC), `plan_dias_gracia`,
`plan_penalidad_cancelacion_pct`, `presupuesto_vigencia_dias`.

Reglas que no se negocian:
- **La imputación de cada pago a una cuota se DECLARA y se guarda**
  (`plan_imputaciones`), no se reconstruye: es la lección de la CC, donde "un
  CREDITO no apunta a nada". FIFO por default, pero escrito en una tabla.
- **El anticipo entra a la caja el día que entra**, por `venta_pagos` con tipo
  propio (`PAGO_PLAN`, `plan_pago_id`), así arqueo, ledger y acreditación lo
  ven sin reescribirlos. Pero **no es una venta**: no suma a ingresos ni margen
  hasta la entrega, y la venta se registra con los anticipos APLICADOS (molde
  `saldo_a_favor_aplicado`).
- Todo en RPC transaccional e idempotente (id generado por el modal, como
  `registrar_cobro_cc`): aceptar, cobrar cuota, entregar, cancelar.
- Precio revalidado en el server al cotizar; al aceptar se congela si la
  cotización está VIGENTE, si venció se recotiza. Una cotización emitida NO se
  edita (trigger `presupuestos_solo_estado_editable`): si cambió, es otra.
- El cobro de un plan cancelado NO se marca ANULADO: la bitácora buscaría el
  reintegro en `ventas` y un anticipo no tiene venta. La devolución va como
  movimiento propio (egreso `DEVOLUCION` o reintegro digital).

Permisos: `presupuestos.crear` (quien vende), `.aceptar_plan` (ADMIN +
ENCARGADO), `.cobrar_cuota` (los que tienen `clientes.cobrar_cc`),
`.cancelar_plan` (solo ADMIN).

Modelo: `presupuestos` (BORRADOR → ENVIADO → ACEPTADO | RECHAZADO | VENCIDO),
`planes_pago` (1:1 con el aceptado, condiciones congeladas, ACTIVO →
COMPLETADO → ENTREGADO | CANCELADO), `plan_cuotas` (deuda viva = capital +
recargo + mora − Σ imputaciones), `plan_imputaciones`, y `reservas.plan_pago_id`
(se reusa la tabla de reservas en vez de inventar otra).

**Lo que midió la auditoría previa (28/9) y condiciona las etapas:**
- **"Cobro sin venta" significa hoy "cobro de cuenta corriente" en el código**,
  y un `PAGO_PLAN` caería en el cajón equivocado sin error. Lo cuentan bien sin
  cambios los que no miran el tipo (bitácora del ledger, `flujo_caja_turno`,
  `efectivo_actual_turnos`, `posicion_dinero`, acreditación, arqueo en TS) y
  los que filtran por `venta_id` / `PAGO_VENTA` (anular, devolver, corregir
  medio). Hay que ajustar OCHO: `resumen_financiero_periodo` (lo mostraría como
  cobro de deuda), `resumen_gerencial_caja` (entra al esperado y a ningún
  bloque: el día no cierra), `rentabilidad_por_metodo` (perdería la comisión),
  `detalle_medios_pago_dia`, `get-dashboard-metrics.ts`, los rótulos de
  `caja-dashboard` / `caja-detail-sheet` / `vista-gerencial`,
  `construir-filas.ts` de exportaciones y `get-sales.ts`. Discriminar SIEMPRE
  por `tipo_movimiento`, nunca por `venta_id is null`. Antes, ampliar el CHECK
  `venta_pagos_tipo_movimiento_check`.
- **Una venta con saldo pendiente ES fiado**: 561 de 561 con
  `monto_pendiente > 0` tienen movimiento de CC, y lo leen 5 funciones SQL y 23
  archivos TS. Por eso la venta `AL_INICIO` va con `monto_pendiente = 0` y lo
  financiado en columnas propias (`ventas.plan_pago_id`,
  `monto_financiado_plan`), con CHECK `monto_cobrado + saldo_a_favor_aplicado +
  monto_financiado_plan = total` y probablemente un `estado_pago` nuevo
  (`FINANCIADA`) para que ninguna pantalla de CC lo levante.
- **Una reserva NO frena la venta en el server**: `ajustar_stock_variante` no
  conoce `reservas`; solo el catálogo mostrado las resta (UI), así que un
  catálogo viejo, la venta offline o `permitir_venta_sin_stock` venden la
  unidad reservada. Además la policy de `reservas` es `true` para ALL y
  `reservas.cliente_id` es ON DELETE CASCADE. **Es la primera tarea de la
  etapa 3**: el descuento en el server resta las reservas activas AJENAS, y las
  de un plan solo se liberan por RPC.
- Colaterales: `venta_pagos_insert_de_venta_propia` terminaba en `ELSE true`
  (cerrado en la etapa 1: ahora `else false`, probado); `venta_pagos.cliente_id`
  es ON DELETE CASCADE, así que borrar un cliente borra sus cobros de CC y
  cambia arqueos cerrados — para los de plan tiene que ser RESTRICT / SET NULL.

Etapas (cada una con las 3 patas):
0. Auditoría — hecha, resultado arriba.
1. Llave y configuración — **aplicada** (`20260928260000`): interruptor, columnas
   con CHECK (13 negocios en defaults, sin financiación ni mora), 4 permisos y
   el cierre del `ELSE true`. Faltan push + deploy y probar el interruptor
   desde /admincomerz.
2. Cotizaciones — migración **aplicada** el 29/9/2026
   (`20260929130000_presupuestos_cotizaciones.sql`); código en el working tree.
   Tablas `presupuestos`, `presupuestos_items`, `presupuesto_numeracion`; RPC
   `crear_presupuesto`. Pantallas: link "Presupuestos" en el sidebar, "Cotizar"
   en el footer del carrito del POS (`cotizar-dialog.tsx`, no vacía el
   carrito), `/presupuestos` y `/presupuestos/[id]` (impresión A4, WhatsApp,
   rechazar / anular), sección "Presupuestos" en Configuración (tasas,
   frecuencia, vigencia). Todo detrás de la llave: sin módulo, 404 y nada en
   el menú. La llave viaja en la consulta de membresías del layout
   (`listarMisNegociosAction` → `useModuloPresupuestos()`), sin consultas
   nuevas por navegación.
   - **La única puerta para crear es la RPC, y es SECURITY DEFINER.** Ninguna
     de las tres tablas tiene policy ni privilegio de INSERT (ni DELETE) para
     `authenticated`. La primera versión era INVOKER con policy de INSERT, y
     el ensayo en seco creó desde "la consola" una cotización con total $1,
     vigencia de 10 años y número 999 (que después choca con la numeración).
     Como DEFINER no la protege la RLS, filtra `negocio_id = v_negocio` en
     CADA consulta; hay un guard que cuenta esos filtros. Probado el 29/9 con
     el módulo prendido en dos negocios: producto, cliente e id de cotización
     del otro negocio se rechazan, y cada negocio numera desde 1.
   - El precio lo resuelve la BASE (`coalesce(variante.precio,
     producto.precio)`), no el carrito; la venta libre es la única excepción.
     Del carrito viajan producto, variante y cantidad. Un renglón sin
     `varianteId` (carrito viejo) se resuelve por nombre en el server action;
     si no aparece, falla con el nombre puesto.
   - Inmutable: la trigger solo deja cambiar el estado, VIGENTE → RECHAZADO |
     ANULADO, y congela `resuelto_en` / `resuelto_por`. `ACEPTADO` existe en
     el CHECK pero la trigger no deja llegar hasta la etapa 3. VENCIDO no se
     guarda: `estadoVisiblePresupuesto` (vigencia inclusiva, día comercial).
   - Cerrar la puede quien la hizo o un ADMIN (policy); la acción chequea las
     filas tocadas.
   - Cuotas: `features/presupuestos/lib/cuotas.ts` (en centavos; el resto va a
     la ÚLTIMA cuota). La etapa 3 genera las cuotas con esta misma función.

   **Lo que la cotización todavía NO cubre** (y qué ve el cliente):
   - **Listas de precios**: sale a precio base aunque el POS tenga una lista
     activa. El modal lo avisa y el toast muestra el total real, que puede no
     coincidir con el del carrito.
   - **Promociones**: no se aplican. Con promo, el papel dice MÁS que lo que
     pagaría en la caja (nunca menos).
   - **Presentaciones** (el balde de 4,7 kg): se rechazan nombrando el
     renglón (el modal avisa y no deja guardar). Su precio no es
     `variante ?? producto`, y cotizarlas a precio de kilo sería mentir.
   - **Importe por peso** ("$1000 de jamón"): se cotiza peso × precio por kilo
     de lista, no el importe fijado.
   - Falta: el smoke test en producción (necesita elegir el negocio) y probar
     el interruptor desde /admincomerz.
3. Plan y cobro de cuotas — arranca por las reservas en el server, después el
   CHECK y los 8 ajustes, ANTES del primer cobro de plan.
4. Entrega — AL_FINALIZAR registra la venta con anticipos aplicados y libera la
   reserva en la misma transacción; AL_INICIO usa las columnas propias.
5. Mora (materializada al cobrar, sin cron) y cancelación.
6. Visibilidad — planes y cuotas vencidas en el cliente y el panel; cobros de
   plan como fila propia en Dinero.

Abierto: qué negocio lo usa (para el smoke test); si factura con ARCA, un
anticipo puede exigir factura de anticipo (confirmar con el contador; hasta
entonces el módulo no se prende en negocios en modo ARCA); indexar el saldo por
precio vigente queda fuera del v1; varias opciones por cotización se MUESTRAN
todas y el cliente acepta una.

