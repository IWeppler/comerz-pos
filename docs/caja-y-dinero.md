# Caja y dinero: turnos, arqueo, ledger y cuentas

Leé esto antes de tocar `features/caja/`, `turnos_caja`, `egresos`,
`ingresos_financieros`, `movimientos_financieros`, `cuentas_financieras`,
`transferencias`, `metodos_pago.cuenta_destino_id`, o cualquier consulta que sume
efectivo, cobros o saldos (`flujo_caja_turno`, `efectivo_actual_turnos`,
`posicion_dinero`, `resumen_gerencial_caja`, `resumen_financiero_periodo`,
`movimientos_financieros_negocio`).

**Toda anulación, devolución o cobro mueve plata acá.** Si tocás ventas o cuenta
corriente, las reglas de "Reintegros" y "El flujo de dinero" de este documento
aplican igual.

## Mapa

| Pregunta | Dónde | Fuente |
|---|---|---|
| ¿Cuánto hay en el cajón de este turno? | /caja → Hoy | `flujo_caja_turno` / ledger por turno |
| ¿Cuánto tengo y dónde? | /caja → Dinero | `posicion_dinero` (única fuente de saldos) |
| ¿Qué pasó, uno por uno, entre tal y tal día? | /caja → Movimientos | `movimientos_financieros_negocio` vista COMPLETA |
| ¿Cómo cerró cada turno? | /caja → Cierres | `turnos_caja` + `efectivo_esperado_actual` |
| ¿Qué pasó con la plata en el período? | /reportes → Finanzas | `resumen_financiero_periodo` |

## Turnos y arqueo

- **Multicaja POR_USUARIO**: cada vendedor ve y cierra SOLO su turno (matching
  estricto `vendedor_id === userId`); ADMIN ve todos. **Un turno cerrado es
  inmutable para todos** (trigger `trg_bloquear_edicion_turno_cerrado`).
- **Efectivo del turno = TODOS los cobros en efectivo, anulados incluidos, menos
  los egresos, más transferencias e ingresos al cajón** (`20260920160000`). Vive en
  `flujo_caja_turno` (la que congela el cierre), `efectivo_actual_turnos` (la del
  historial) y `posicion_dinero`: **son el MISMO número desde tres pantallas y
  cambian juntas.** El término de transferencias/ingresos lo suman CINCO consultas
  (esas tres + `resumen_gerencial_caja` + `transferencias_caja_turno`) con
  `origen_tipo in ('TRANSFERENCIA','INGRESO')`: toda consulta nueva incluye los dos.
- **Los cierres firmados no se tocan.** `turnos_caja.efectivo_esperado` y
  `diferencia` son lo que la cajera vio y firmó: hecho histórico. Lo que se corrige
  es `efectivo_esperado_actual`, que el historial muestra con el badge AJUSTADO
  (motivo + los dos números). Un esperado negativo es un aviso legítimo: salió más
  plata de la que entró.
- **Un turno de otro día no se usa** (`entities/caja/lib/turno-de-otro-dia.ts`,
  `20260928190000`). Si el turno abierto es de un día comercial anterior (hora
  argentina), `resolverTurnoActivo` lo marca `turnoDeOtroDia` y frenan venta
  (`TURNO_DE_OTRO_DIA`), gasto de caja chica, devolución, anulación, ingreso y
  transferencia con la caja diaria, hasta cerrarlo. Excepción: venta OFFLINE
  cobrada el mismo día del turno. `cerrarTurnoAction` fecha el cierre un minuto
  después de su último movimiento (`ultimo_movimiento_turno`), en el día del turno.
  El chip de caja del navbar se pone ámbar.
- **"Día" siempre es el día comercial argentino**, nunca UTC ni el huso del
  navegador: `diaComercial` / `rangoDiaComercial` (offset fijo −03:00, sin DST).

## El flujo de dinero mira los MOVIMIENTOS, no si la venta se anuló (`20260920160000`)

`venta_pagos.estado_pago_operacion = 'ANULADO'` contesta "¿cuenta como venta?", NO
"¿entró la plata al cajón?". Mezclarlas descontó el efectivo DOS veces (anulación +
egreso de la devolución) en 25 turnos, y dejó esperados negativos imposibles.
- **Efectivo** = todos los cobros en efectivo (anulados incluidos) − egresos.
- **Digital** = cobros digitales − los revertidos por su propio medio − reintegros
  parciales.
- **Ingresos / ventas / rentabilidad** = solo los NO anulados.
- La asimetría es a propósito: en el cajón la salida tiene movimiento propio (el
  egreso); en el banco no hay ninguno, así que "revertido por su propio medio" es
  la única forma de decir que el banco dio marcha atrás. Si se devolvió por OTRO
  medio, el banco no reversó y ese cobro SIGUE contando (con su comisión:
  `rentabilidad_por_metodo` filtra por `estado_pago_operacion`, no por
  `ventas.estado_operacion`).
- `resumen_gerencial_caja` tiene dos CTE: `pagos` (ventas, sin anulados) y
  `pagos_caja` (el cajón, todo). Que el desglose por medio y el esperado difieran un
  día con anulación es correcto.

## Reintegros: el medio lo ELIGE el dueño (`20260920130000`)

- **Egreso de caja si y solo si el reintegro es EFECTIVO, por el total cobrado.**
  Y al revés: devolver por transferencia una venta cobrada en efectivo NO genera
  egreso (el cajón se queda la plata). El egreso mira el reintegro, no el cobro.
- Con otro medio **no se registra ningún movimiento**: un egreso sin cuenta lo
  completaría el trigger con la caja y le bajaría el arqueo al cajón.
- Permiso `ventas.elegir_medio_devolucion` (solo ADMIN): sin él no hay selector y
  sale por el medio del cobro. Con el selector visible, **elegir es obligatorio, sin
  default**. Importa porque `ventas.devolver` lo tiene VENDEDOR en muchos negocios y
  elegir "efectivo" es sacar plata del cajón.
- Se guarda en columnas propias, congeladas y sin FK: `reintegro_metodo_id` /
  `_tipo` / `_nombre` en `ventas` y `devoluciones`. (`devoluciones.metodo_tipo` dice
  con qué se COBRÓ; no se reusa.)
- **`reintegros_al_cliente`** es la fuente única de "qué le devolvimos y por qué
  medio" (anulación y devolución parcial en la misma forma). La CC no entra: ahí
  baja la deuda, no sale plata.
- **Un vale (reintegro a cuenta, `SALDO_A_FAVOR`) no es plata que sale**: el cobro
  queda ANULADO pero la plata sigue en el negocio. La bitácora no revierte,
  `posicion_dinero` lo cuenta, `reintegros_al_cliente` lo EXCLUYE. Toda consulta que
  decida "¿volvió la plata?" mira `reintegro_metodo_tipo = 'SALDO_A_FAVOR'`.
- **Una devolución al cliente NO es un gasto** (`20260921180000`): el egreso lleva
  `tipo = 'DEVOLUCION'` (lo escriben `anular_venta` y `registrar_devolucion`). Sale
  del cajón pero no toca resultado: la venta ya salió de los ingresos.

## El ledger: `movimientos_financieros`

Bitácora append-only de todo lo que mueve plata, escrita por triggers sobre
`venta_pagos`, `egresos`, turnos, transferencias e ingresos.
- **El invariante, que verifican las migraciones antes de commitear**: el saldo de
  `CAJA_DIARIA` = suma del esperado de los turnos ABIERTOS, y el saldo de cada cuenta
  digital = neto de los cobros vivos que `cuenta_actual_venta_pago` manda ahí. El
  guard **llama a la función**, no copia su condición.
- **Cada método digital tiene su cuenta, llamada como el método**
  (`20260920180000`): BILLETERA_VIRTUAL → BILLETERA, TRANSFERENCIA y TARJETA → BANCO.
  Un cobro va directo a su cuenta solo si `acreditacion_dias = 0` y el método tiene
  `cuenta_destino_id`; si no, al puente `POR_ACREDITAR`.
- **Ningún método puede quedar sin cuenta** (`20260920200000`): el trigger
  `asignar_cuenta_financiera_actual` le crea una al método digital que no la trae
  (EFECTIVO → CAJA_DIARIA). Trigger y no CHECK: un CHECK rompería el alta de un
  comercio con un error crudo. En la UI la cuenta es obligatoria y el selector
  (`selector-cuenta-destino.tsx`) trae adentro la creación de la cuenta; criterio en
  `features/payments/lib/cuenta-destino-metodo.ts`, fail-closed sobre el tipo.
- **El turno entra en tres movimientos**: `APERTURA_TURNO` (+fondo), `AJUSTE_ARQUEO`
  (±declarado − saldo del turno, con `impacto_resultado`) y `CIERRE_TURNO`
  (−declarado). Cerrado, el saldo del turno queda en cero. El saldo sale del LEDGER,
  nunca de `turnos_caja.efectivo_esperado` (foto congelada).
- **La reversa de un cobro no es ciega al medio**: en efectivo es 0 (el egreso ya la
  representa); en digital revierte, salvo que el reintegro haya salido por otro
  medio. Una CORRECCIÓN (cambiar medio o monto) revierte siempre. Si no se revierte
  la plata, tampoco la comisión.
- **Se quedan en el puente, y está bien**: cobros diferidos no vencidos y cobros sin
  `metodo_pago_id` (métodos borrados): inventarles una cuenta sería inventar dónde
  cayó la plata.
- **Un cobro diferido se acredita solo al llegar su fecha** (`20260921120000`,
  `acreditar_cobros_vencidos`), fechado en la fecha ESPERADA (nunca `now()`, con
  guard) y marcado `estimada`; la conciliación real es corrección opcional. Sin
  cron: se materializa al abrir Dinero (`getPosicionDineroAction`). Idempotente por
  `unique (negocio_id, venta_pago_id)` en `acreditaciones_financieras_pagos`.
- **Las correcciones se fechan en el hecho original**, no en `now()`: la de un
  egreso de julio va en julio (`registrado_en` conserva cuándo se corrigió).
- **Trampa que costó una migración**: `trg_venta_pagos_asignar_cuenta` es
  `BEFORE INSERT OR UPDATE OF metodo_pago_id, metodo_tipo`; un UPDATE que toca otra
  columna NO lo despierta y sale no-op sin error. Un trigger con lista de columnas
  es donde se esconde "un UPDATE que no falla no es un UPDATE que hizo algo".

## Cuentas: caja chica, caja grande, banco

- **`CAJA_GENERAL` (Caja Grande) es cuenta de SISTEMA** (`20260921170000`), como
  CAJA_DIARIA y POR_ACREDITAR. La diaria la arquea quien vende; la general la maneja
  el dueño.
- **El ciclo del efectivo cierra solo, con dos patas**: abrir turno = general −fondo
  / diaria +fondo; cerrar = diaria −declarado / general +declarado, misma
  `operacion_id`. La pata de la general va SIN `turno_caja_id` (vínculo en
  `origen_id`). No se backfillearon los cierres viejos a propósito: el saldo real se
  declara con `registrar_saldo_inicial_cuenta`.
- **Saldo inicial** (`20260921140000`): declara lo que la cuenta YA tenía, con
  `impacto_resultado = 0`. Nunca en una cuenta con arqueo, una sola vez por cuenta,
  solo ADMIN.
- **De una caja arqueada no sale plata que no está** (`20260928120000`, trigger
  `validar_saldo_caja_arqueada` en el ledger): una salida que deje el saldo del turno
  bajo cero falla con `SALDO_INSUFICIENTE_CAJA` (detail `disponible`/`monto`, mensaje
  en `features/caja/lib/saldo-insuficiente-caja.ts`). Cubre egresos, devoluciones,
  transferencias, reversas y anulaciones. Quedan afuera `TURNO_CAJA` y `VENTA_PAGO`.
  Row lock sobre el turno.
- **Un egreso de una cuenta ARQUEADA exige turno ABIERTO de esa cuenta, siempre**
  (`20260921130000`), sin importar `requiere_caja_abierta`. Egreso sin cuenta: con
  turno va al cajón, sin turno a la Caja Grande.

## Egresos (gastos)

- **Dos ejes que no son el mismo**: `tipo` (OPERATIVO | RETIRO_SOCIO |
  COMPRA_MERCADERIA | DEVOLUCION, CHECK fail-closed). TODOS sacan plata del cajón;
  **solo OPERATIVO resta de la ganancia** (un retiro es la ganancia ya hecha; una
  compra ya está en `precio_costo` de lo vendido; una devolución ya salió de
  ingresos). Criterio en `features/caja/lib/tipo-egreso.ts` (modal, action y panel);
  espejo SQL `egreso_impacto_resultado(tipo, monto)`.
- `orden_compra_id` linkea el pago al remito (solo COMPRA_MERCADERIA, ON DELETE SET
  NULL: borrar el remito no borra el egreso).
- **Un gasto dice de dónde sale la plata, sin default** (28/9/2026): modal de dos
  pasos, primero la caja (`features/caja/lib/origen-egreso.ts`), después el tipo. El
  `turno_caja_id` se anota SOLO si la cuenta es arqueada. El default a la caja chica
  fabricó los sobrantes falsos de El Nono Cacho. Un "cambio de efectivo por
  transferencia" es una transferencia, no un gasto.
- **Categorías** (`20260921190000`): eje descriptivo debajo de OPERATIVO, opcional y
  sin default; CHECK impide categorizar los otros tipos. `egresos` tiene UNA rendija
  de UPDATE: solo `categoria_id` y `concepto`
  (`EGRESO_SOLO_CATEGORIA_Y_CONCEPTO_EDITABLES`); plata se anula y se vuelve a
  cargar. La categoría se lee VIVA.
- **Anular un gasto BORRA la fila** (`20260921210000`, `anular_egreso`): siete
  consumidores suman `egresos` directo y un estado ANULADO obligaba a los siete a
  filtrar. La bitácora lo modela (`ELIMINACION_REVERSA`, motivo por
  `comerz.motivo_anulacion`, fechada en el egreso). Frenos: turno ABIERTO si la
  cuenta es arqueada, y nunca un `DEVOLUCION` (eso se corrige desde la venta).

## Ingresos libres y transferencias

- **Ingresos libres** (`20260922100000`): plata que entra sin venta (aporte, préstamo,
  alquiler). `APORTE_SOCIO` y `PRESTAMO` con impacto 0; solo
  `INGRESO_EXTRAORDINARIO` es resultado (`ingreso_impacto_resultado`, espejo
  `tipo-ingreso.ts`). Anular es REVERSA, no borrado. Permiso `caja.registrar_ingreso`
  solo ADMIN (es la otra forma de hacer aparecer plata; con eso se "cuadra" un
  faltante). **No suman a la ganancia del panel**, a propósito.
- **Transferencias reversibles** (`20260921200000`): la reversa es OTRA transferencia
  destino → origen con `revierte_a`; una vez por original, una reversa no se revierte,
  y si toca la caja diaria va contra el turno ABIERTO de quien revierte. Lógica en
  `registrar_transferencia_financiera_impl`.

## Pantallas de /caja (Hoy · Dinero · Movimientos · Cierres)

Separadas por PREGUNTA, no por origen del dato (`features/caja/ui/caja-vistas.tsx`).
- **Hoy**: el turno propio arriba y el resumen del día abajo.
- **Dinero**: una sola lista de cuentas con saldo (de `posicion_dinero`, la ÚNICA
  fuente de saldos de la pantalla) y tres preguntas que **no se suman en un total**:
  disponible ahora (sin el puente), por acreditar, acreditado en el período. El
  disclaimer "no es el saldo del banco" va pegado a la cifra. Cuentas en cero se
  muestran; el negativo entra al total. Acciones: Egreso · Transferir · Cuenta.
  "Actividad de cuentas" es la vista CONSOLIDADA (cobros sumados por cuenta y día;
  esconde gastos/ingresos del cajón, que viven en el turno) con rango de días.
- **Movimientos** (`movimientos-financieros-table.tsx`, gate `caja.ver_movimientos`):
  la TRAZABILIDAD, una fila por movimiento sin consolidar ni separar por turno
  ("todas las transferencias del sábado"). Filtros Desde/Hasta (día comercial),
  cuenta, tipo, categoría, método, usuario y texto; Excel con los mismos filtros.
  Encabezado con cantidad y sumas de TODO lo filtrado (`importe_total` /
  `_entradas` / `_salidas`, `20260929140000`), calculadas por la base antes de
  paginar; con plata para los dos lados se desglosa (`sumas-movimientos.ts`).
  "Usuario" es quien REGISTRÓ el movimiento (la anulación queda a nombre de quien
  anuló). Pide `p_vista = 'COMPLETA'`; la consolidada es la de Dinero.
- **Cierres**: turnos cerrados agrupados por día, detalle e "Imprimir Cierre Z".
- Reglas de `movimientos_financieros_negocio`: el **saldo posterior se calcula sobre
  el ledger ENTERO de la cuenta antes de filtrar**; el orden es por fecha económica +
  id, nunca `registrado_en`; **se pagina ANTES de enriquecer** (731 ms → 22 ms en
  Evens), filtros con otra tabla van con EXISTS. Una transferencia son dos filas con
  la misma `operacion_id`. Espejo TS del saldo: `saldo-posterior.ts`.
- **Etiqueta de cada fila por `origen_tipo` + SIGNO, nunca por `evento`**
  (`features/caja/lib/movimiento-financiero.ts`, fail-closed: desconocido dice
  "Movimiento"). Miles de filas son `CORRECCION_*` de la migración del puente y cada
  una es un cobro que entró a esa cuenta. Cada fila dice si mueve la ganancia o solo
  la plata.
- **El período** (`shared/lib/periodo-ranges.ts` + `periodo-selector.tsx`) lo resuelve
  la BASE (`p_periodo`) y gobierna solo lo acreditado; efectivo y pendiente son fotos
  de ahora.
- La pestaña **Auditoría** (`alertas_caja`) se sacó el 29/9/2026; sus funciones y la
  tabla `alertas_caja_revisadas` (vacía) siguen en la base sin uso. La pantalla está
  en el tag `agents-md-completo` / commits previos al 29/9.

## Permisos de caja (`20260921160000`)

VER la plata y MOVERLA son dos confianzas: `caja.ver_gerencial` (Hoy gerencial y
Dinero), `caja.ver_movimientos`, `caja.registrar_egreso`, `caja.transferir`,
`caja.anular_movimiento` (solo ADMIN), `caja.registrar_ingreso` (solo ADMIN),
`caja.operar`. `egresos_insert_propio` pide `caja.registrar_egreso` **o
`ventas.anular`**: `anular_venta` es INVOKER e inserta el egreso de la devolución
con la sesión de quien anula.

## Resumen del período (`resumen_financiero_periodo`, /reportes → Finanzas)

Qué PASÓ con la plata: cobros no anulados por medio (ventas y deuda aparte),
reintegros, egresos por tipo, gastos operativos por categoría ("Sin categoría" como
fila), transferencias (se informan, no suman), otros ingresos, faltantes/sobrantes
netos por turno, y `neto_caja`. **`neto_caja` NO es la ganancia** y la pantalla lo
dice. El reintegro en efectivo existe dos veces (fila de `reintegros_al_cliente` y
egreso DEVOLUCION): el neto resta por la vista y excluye el tipo DEVOLUCION.

## El Nono Cacho (auditoría 17–28/9/2026, cerrada)

El sistema sumaba bien; lo mal cargado era la plata: gastos pagados con otra plata
imputados al cajón (sobrante falso en la chica, Caja Grande inflada), cambios de
efectivo cargados como gasto, retiros al cajón sin registrar, turnos cerrados a la
mañana siguiente. El "faltante de $270.800" era un error de suma; la diferencia real
fue $7.399,30. De ahí salieron: saldo no negativo en caja arqueada, egreso sin
default de origen y turno de otro día. Correcciones solo de ese negocio:
`20260928130000` a `180000` (en el tag `migraciones-pre-baseline`); la última es un
AJUSTE de −$1.066.012 con impacto 0 que deja la Caja Grande en el conteo físico. Si
la dueña identifica una salida, se carga como egreso de la Caja Grande y se ACHICA
el ajuste (reversa + re-emisión) — nunca un egreso además del ajuste. El detalle
turno por turno: `git show 34fcf07:docs/auditoria-caja-el-nono-cacho-2026-09.md`.

**30/9/2026** (`20260930130000`): un cambio de efectivo por transferencia de
$85.000 del turno del 29/9 a la tarde no se cargó y el arqueo lo mostró como
faltante (−96.020). Se registró como transferencia caja diaria → Caja Grande
dentro del turno, y el ajuste se revirtió y se re-emitió por −11.020 (sin
explicar). El cierre firmado no se tocó. Así se corrige un movimiento olvidado en
un turno cerrado: reversa del ajuste, el movimiento en su fecha, ajuste nuevo.
