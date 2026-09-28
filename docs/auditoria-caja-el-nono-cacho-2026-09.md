# Auditoría de caja — El Nono Cacho (17/9 al 28/9/2026)

Estado al **lunes 28/9/2026**. Documento de trabajo para retomar la auditoría en
una sesión nueva: qué se encontró, qué ya se corrigió en producción, qué falta y
qué datos hay que pedirle a la dueña.

- Negocio: El Nono Cacho — `negocio_id = 106f0b93-9211-47f9-945f-4691d634f6f3`
  (rubro cotillón, estado `prueba`, alta 7/9/2026).
- Un solo usuario opera la caja: `vendedor_id = 4146a63a-75ed-40e7-9b4e-79c5065ecb9f`.
- Cuentas: Caja diaria (`643d6c3e-39fb-4058-83a1-9356b730af68`, arqueada),
  Caja Grande (`CAJA_GENERAL`, `faf4fc21-2237-4a26-a058-783aa650b8d7`),
  Transferencia (BANCO), Mercado Pago, Mercado Pago Posnet, Dinero por acreditar.
- **Calendario**: jueves 17, lunes 21, jueves 24, **viernes 25**, **sábado 26**,
  lunes 28. (En la sesión anterior se nombraron mal los días de la semana
  24–26; los horarios estaban bien.) Todas las horas de este documento son de
  Argentina (UTC−3).

---

## 1. Lo que motivó la auditoría

La dueña reportó primero "demasiado sobrante" en los arqueos y después un
faltante de ~$270.800–$278.000. Las dos cosas resultaron ser caras del mismo
problema más un error de suma del cajero.

## 2. Hallazgos

### 2.1 El sistema suma bien; el problema es lo que se carga

- 563 cobros, todos con turno; ninguna venta sin pago; ningún cobro en un turno
  distinto al de su venta.
- El ledger (`movimientos_financieros`) reconcilia: cada turno cerrado queda en
  saldo 0.

### 2.2 Egresos cargados a la caja diaria que se pagaron con otra plata

El modal de egreso (`features/caja/ui/egreso-modal.tsx`) usa por defecto
"Caja diaria (tu turno abierto)". Un gasto pagado con plata de la Caja Grande
o por transferencia queda descontado del cajón: el esperado baja, la cajera
cuenta lo que realmente hay y aparece un **sobrante** falso. En espejo, la
Caja Grande del sistema no descuenta ese pago y queda **inflada**.

| Turno | Sobrante | Egreso sospechoso |
|---|---|---|
| Jue 17 tarde | +182.452 | Ramiro 102.000 + Dipa 100.000 (+ dos "cambio por transferencia" 100.000) |
| Sáb 19 tarde | +81.501 | DESCARTABLE 78.000 |
| Jue 24 | +44.290 | dulce de leche 250.000 → 205.710 del cajón, **44.290 de otro lado** |
| Sáb 26 tarde | +235.001 | sueldos Analía 100.000 + Claudia 150.000 + Agu 150.000 → 164.999 del cajón, **235.001 de la Caja Grande** |

El sábado 26 el cajón tenía 375.799 y se cargaron 400.000 de sueldos: el
esperado cerró en **−24.200,70**, que es imposible. Es el caso que motivó el
freno de saldo (sección 3.1).

Los del 17 y 19/9 **no pueden haber salido de la Caja Grande**: el 17/9 a las
18:54 la Caja Grande no había recibido ningún cierre y quedaría en negativo.
Tuvieron que pagarse por banco o del bolsillo de la dueña. Lo mismo "Diferencia
Sueldo Ani Transferencia" (80.000, 19/9), cargada a Caja Grande con "transferencia"
en el nombre.

### 2.3 "Cambio de efectivo por transferencia" cargado como gasto

Aparece 9 veces como egreso; 3 como `OPERATIVO` (40.000 del 17/9, 50.000 del
18/9, 25.000 del 19/9): **115.000 contados como gasto que no son gasto**. Es un
movimiento entre cuentas (efectivo sale, entra transferencia). También hay tipos
mal elegidos: "Retiro Dueño efectivo de caja" como OPERATIVO, "Venta de Flores de
Tela Analia" como RETIRO_SOCIO.

### 2.4 Turnos que quedaron abiertos de noche (ya corregido, ver 3.2)

- Jueves 24: abrió 09:04, su último movimiento fue a las 12:17, se cerró el
  viernes 25 a las 08:14.
- Viernes 25 tarde: abrió 16:41, última venta del viernes 20:39, se cerró el
  sábado 26 a las 08:38 con 12 cobros del sábado adentro (08:22–08:29: 76.500
  efectivo + 48.400 transferencia) y los dos cambios de 175.000.

### 2.5 El viernes 25: mañana cerró 394.500, la tarde abrió 254.700

En la práctica del negocio la tarde abre con lo mismo que cerró la mañana
(lun 22, mar 23 y sáb 26 lo cumplen). El viernes faltan **139.800** que el
sistema dio por "llevados a la Caja Grande" sin que nadie lo registrara.
**254.700 es exactamente el conteo del cierre del sábado 19**: posible tipeo de
memoria o fila equivocada del historial. Si la tarde abrió en realidad con
394.500, ese turno no tuvo sobrante sino un faltante de ~66.320.
**Sin resolver: preguntar a la dueña.**

### 2.6 Los dos sobrantes de ~73.500 del viernes 25

+73.668 (mañana) y +73.480 (tarde, ahora imputado al conteo del sábado 08:38).
Casi idénticos: sospecha de un sobre o cambio que no es de las ventas contado
dos veces. Parte del de la tarde puede ser la transferencia
"Transferencia → Caja Grande 40.000, cambio efectivo por transferencia" del
viernes 18:42, si el efectivo quedó físicamente en el cajón.
**Sin resolver.**

### 2.7 La cuenta del cajero ("faltan ±270.800") suma dos veces la mañana del sábado

Mensaje reenviado por la dueña:

```
$250.000 del viernes + $243.200 sábado mañana + $366.600 sábado tarde = $859.800
− sueldos Clau 150.000, Agu 150.000, Ani 100.000 = $459.800 debería haber
Hay $189.000 → faltan ±$270.800
```

- La mañana del sábado **no se retiró**: sus 286.600 quedaron enteros como fondo
  de la tarde. Sumarla aparte la cuenta dos veces. 270.800 − 243.200 = 27.600.
- 243.200 no coincide con nada del sábado; es el conteo del cierre del **lunes 21**.
- **366.600** sí tiene explicación: el ledger muestra el cajón en **366.499 a las
  19:43** del sábado (antes de las dos últimas ventas, que lo llevan a 375.799).
  La dueña contó el cajón en ese momento.

Cuenta corregida desde el sábado 08:38 (Caja Grande = 250.000 según la dueña):

| Concepto | Importe |
|---|---|
| Caja Grande (retiro del sáb 08:38) | 250.000 |
| Cajón sáb tarde antes de sueldos (sistema) | 375.799 |
| Sueldos | −400.000 |
| **Debería haber (Caja Grande + cajón)** | **225.799** |
| Cajón al cerrar el sábado (contado) | 210.800 |
| Caja Grande: 250.000 − 235.001 + 210.800 − 29.400 (fondo del lunes) | **196.399** |

**Hay 189.000 → faltante real entre 7.399 (si 189.000 es solo la Caja Grande) y
36.799 (si incluye los 29.400 del cajón del lunes).** No 270.800.

### 2.8 La Caja Grande del sistema no es un número confiable

Saldo en el sistema: **393.602**. Arrastra:
- los −750.000 de sueldos del 19/9 cargados antes de que existiera un saldo
  inicial;
- que los cierres del 17 al 19/9 (997.900 contados, 169.600 de fondos) nunca
  entraron a la Caja Grande, porque la cuenta de sistema y las patas automáticas
  de apertura/cierre recién existen desde el 21/9 (`20260921170000`);
- las reimputaciones de 2.2 sin hacer.

Reconstrucción completa desde el 17/9 con saldo inicial 0 daría ~942.611 contra
los ~115.600–189.000 físicos: **salió mucha plata de la Caja Grande sin
registro** (retiros, depósitos, proveedores). No se puede deducir de la base.
Decisión propuesta: usar como corte **sábado 26/9 08:38, Caja Grande = 250.000**
(dato de la dueña); desde ahí la cadena del sistema está completa.

## 3. Lo que ya está en producción

### 3.1 `20260928120000_caja_arqueada_sin_saldo_negativo.sql` — APLICADA

Trigger `validar_saldo_caja_arqueada` (BEFORE INSERT en
`movimientos_financieros`): toda salida de una cuenta con `requiere_arqueo` que
deje el saldo del turno por debajo de cero falla con `SALDO_INSUFICIENTE_CAJA`
(detail JSON `disponible` / `monto`). Cubre egresos, devoluciones de
`anular_venta` / `registrar_devolucion`, transferencias y sus reversas,
anulación de ingresos y gastos programados. Excluye `TURNO_CAJA` (arqueo y
cierre) y `VENTA_PAGO` (corrección de cobros). Row lock sobre el turno. Aplica a
**todos** los negocios.

Riesgo conocido: al anular una venta FACTURADA la nota de crédito se pide a ARCA
antes de la RPC; si el cajón no alcanza para el reintegro en efectivo queda la
NC emitida sin anulación (caso residual que ya loguea `cancel-sale.ts`).

**Falta probar en producción**: un egreso mayor al saldo del turno abierto tiene
que mostrar el mensaje nuevo; uno por el saldo exacto tiene que pasar.

### 3.2 `20260928130000_nono_cacho_horarios_de_cierre.sql` — APLICADA (sin errores)

Solo El Nono Cacho. Reversa + re-emisión en el ledger (nada borrado ni editado;
22 filas con `datos.motivo = 'Corrección de horarios de cierre…'`). Apaga
`trg_bloquear_edicion_turno_cerrado` solo dentro de la transacción, con guard de
que queda activo (autorizado por Ignacio el 28/9).

Resultado verificado el 28/9 leyendo la base:

| Turno | Horario | Fondo | Esperado | Contado | Dif. | Ledger |
|---|---|---|---|---|---|---|
| Jue 24 | 09:04 → **12:45** | 94.900 | 54.910 | 99.200 | +44.290 | 0 |
| Vie 25 mañana | 08:15 → 12:47 | 47.200 | 320.831,9 | 394.500 | +73.668,1 | 0 |
| Vie 25 tarde | 16:41 → **20:45** | 254.700 | 325.520,2 | 325.520,2 | 0 (**reconstruido, sin conteo**) | 0 |
| Sáb 26 mañana | **08:21** → 12:41 | 325.520,2 | 212.212,7 | 286.600 | +74.387,3 (73.479,8 conteo 08:38 + 907,5 cierre) | 0 |
| Sáb 26 tarde | 16:14 → 20:23 | 286.600 | −24.200,7 | 210.800 | +235.000,7 | 0 |

- Retiro de 250.000 a la Caja Grande como transferencia explícita el sáb 08:38.
- Ningún cobro fuera del horario de su turno.
- Caja Grande sin cambio (393.602); caja diaria = turno abierto de hoy.
- También parchea `resumen_financiero_periodo` (todos los negocios): los
  sobrantes/faltantes se netean **por turno** incluyendo las reversas de ajuste
  (`CORRECCION_REVERSA` con `datos.evento_corregido = 'AJUSTE_ARQUEO'`). Sin
  correcciones da lo mismo que antes.
- Efecto lateral: mover `venta_pagos.turno_caja_id` dejó filas
  `CORRECCION_REVERSA` / `CORRECCION_APLICADA` de `VENTA_PAGO` fechadas el 28/9;
  netas en cero por cuenta.

**No verificado todavía** (el MCP de Supabase no respondía): que
`trg_bloquear_edicion_turno_cerrado` está activo (`tgenabled = 'O'`) y que
`resumen_financiero_periodo` contiene `evento_corregido`. Los dos los exige la
migración antes del commit, pero conviene confirmarlo.

### 3.3 Código (en el working tree, SIN commitear)

- `features/caja/lib/saldo-insuficiente-caja.ts` (+ test): mensaje para
  `SALDO_INSUFICIENTE_CAJA`, conectado en `caja-action.ts` (egreso),
  `cuentas-financieras.ts` (transferencia y reversa), `ingresos-financieros.ts`
  (anular ingreso), `egresos-programados.ts`, `cancel-sale.ts`,
  `registrar-devolucion.ts`.
- `features/caja/lib/movimiento-financiero.ts` (+ test): las reversas se leen
  "Corrección de horario de caja" / "Transferencia corregida" en vez de
  "Faltante de arqueo" / "Entró desde otra cuenta".
- `CLAUDE.md`: bullet de la regla de saldo.
- Tests de `features/caja/lib`: 86/86. `tsc` limpio.

Hasta que se deploye, la pantalla muestra mal las filas de corrección.

## 4. Pendiente

### 4.1 Datos a pedirle a la dueña

1. ¿Los **189.000** son solo la Caja Grande o incluyen el cajón del lunes (29.400)?
2. ¿Los **366.600** se contaron antes o después de pagar los sueldos? (El sistema
   dice que coinciden con el cajón a las 19:43, antes.)
3. ¿Quién retiró los **139.800** el viernes 25 al mediodía y a dónde fueron?
   ¿O la tarde abrió en realidad con 394.500?
4. ¿Los dos sobrantes de ~73.500 del viernes son un sobre / cambio ajeno a las
   ventas? ¿Los 40.000 del cambio del viernes 18:42 quedaron en el cajón?
5. ¿Cuándo pasaron los dos cambios de 175.000 cargados el sábado 08:38?
6. Cómo se pagó cada gasto identificado (cajón / Caja Grande / banco / bolsillo):
   Ramiro, Dipa, DESCARTABLE, sueldos del 19 y del 26, dulce de leche del 24,
   diferencia de Ani (80.000).
7. Retiros propios o depósitos al banco no registrados entre el 17 y el 28.
8. Conteo físico de la Caja Grande en una fecha de corte (puede ser hoy).

### 4.2 Rebalanceo (diseñado, NO ejecutado)

Asientos, con fecha económica original y sin tocar cierres firmados:

1. Corte: Caja Grande = 250.000 el sáb 26/9 08:38 (o saldo inicial al 17/9 si la
   dueña lo da) vía `registrar_saldo_inicial_cuenta` o equivalente fechado.
2. Si se reconstruye desde el 17/9: patas de apertura/cierre de los turnos
   anteriores al 21/9 hacia la Caja Grande.
3. **Reimputación** de cada egreso mal cargado (hace falta una RPC nueva):
   partir el egreso (ej. sueldos 26/9: 164.999 cajón + 235.001 Caja Grande; total
   del panel intacto), revertir el sobrante falso de arqueo equivalente, y
   escribir la salida en la cuenta real. **No** usar un egreso OPERATIVO nuevo:
   el panel (`get-dashboard-metrics`) ya cuenta los 400.000 y lo duplicaría.
   Los del 17 y 19/9 van contra Transferencia o como aporte de la dueña, no
   contra la Caja Grande.
4. Ajuste de conciliación = conteo − reconstrucción: lo identificado como retiro
   de la dueña va `RETIRO_SOCIO`; el resto "diferencia no identificada 17–28/9".
5. Guards: Caja Grande nunca negativa en toda la historia, termina igual al
   conteo, caja diaria = turnos abiertos, gasto del panel sin cambio.

Después del rebalanceo: documento para la dueña explicando qué pasó, cómo se
corrigió y qué tener en cuenta.

### 4.3 Mejoras de producto propuestas (ninguna implementada)

Prioridad alta (son las que causaron casi todo):

1. **Egreso: "¿De dónde sale la plata?" obligatorio**, sin default, con botones
   Cajón / Caja Grande / Banco / Mercado Pago y el saldo de cada uno.
2. **Botón propio "Cambio"** (efectivo ↔ transferencia) con la dirección en
   palabras; por dentro es una transferencia entre cuentas, no un egreso.
3. **Cierre explícito de lo que queda y lo que va a la Caja Grande**: al cerrar,
   "¿cuánto dejás en el cajón?"; el resto va a la Caja Grande como movimiento
   propio; la apertura siguiente viene precargada y si difiere pide motivo.
4. **Un turno de otro día no se usa**: si el turno abierto es de ayer, el POS no
   deja vender hasta cerrarlo con conteo.

Después:

5. Elegir el motivo en palabras (sueldo, proveedor, retiro, cambio, gasto chico)
   y deducir el `tipo`.
6. Egreso con dos orígenes (parte cajón, parte Caja Grande).
7. Revisión de egresos del turno antes de contar el cierre.
8. Egresos de Caja Grande solo para ADMIN.
9. Vista "saldo del cajón en cada momento" en el detalle del turno (hubiera
   resuelto el 366.600 sin reconstrucción manual).

### 4.4 Operativo

- Commit + push + deploy del código de 3.3 (CLAUDE.md: tres patas).
- Smoke test del freno de saldo en producción.
- Confirmar los dos puntos "no verificados" de 3.2.

## 6. Auditoría profunda del 28/9 (segunda sesión)

Verificado antes de empezar: `trg_bloquear_edicion_turno_cerrado` activo (`O`),
`resumen_financiero_periodo` con `evento_corregido`, y el freno de saldo activo
(trigger `trg_movimientos_financieros_saldo_caja` → `validar_saldo_caja_arqueada`).
Los dos puntos "no verificados" de 3.2 quedan cerrados.

### 6.1 Integridad de los datos: el sistema no pierde plata

- Ninguna venta con total distinto a la suma de sus cobros. Sin cuenta
  corriente. Sin devoluciones parciales. 5 anulaciones, todas chicas
  (2 / 13.000 / 5.996,5 / 10.200 / 2.700) y con su egreso DEVOLUCION.
- Ninguna corrección MANUAL de medio de pago. Las 182 filas de corrección de
  cobros previas al 28/9 son todas de la migración del puente del 20/9 17:16
  (Dinero por acreditar → Transferencia / Mercado Pago); ninguna toca la caja
  diaria salvo la `CORRECCION_HISTORICA` de 5.996,5 (anulación ya representada
  por su egreso).
- Primera venta: 17/9 18:25. Ese día entraron 40 cobros en efectivo (411.052)
  en dos horas y el turno abrió con fondo 1.000: el primer día no es
  confiable como punto de partida.

### 6.2 Descomposición exacta de los 270.800

Cuenta del cajero: 250.000 + 243.200 + 366.600 − 400.000 = 459.800 "debería
haber"; hay 189.000.

| Pieza | Importe | Qué es |
|---|---|---|
| Doble conteo | 234.000,70 | Suma 243.200 (conteo del **lunes 21**, no del sábado) como "sábado mañana", cuando los 366.600 **ya incluyen** la mañana (fondo 286.600 de la tarde). Descontado: las dos ventas en efectivo posteriores a las 19:43 (9.199,30) que no estaban en su conteo. |
| Fondo del lunes | 29.400 | Salió de la Caja Grande al cajón el lunes 08:52. No falta: está en el cajón. |
| **Diferencia real** | **7.399,30** | Caja Grande debería tener 196.399,30. |
| **Total** | **270.800** | |

La reconstrucción (250.000 + 375.799,30 del cajón antes de sueldos − 400.000
de sueldos = 225.799,30 entre las dos cajas, menos 29.400 de fondo) **no
depende de qué caja pagó cada sueldo**: el reparto cambia el sobrante del
cajón, no el total. Supuestos: Caja Grande = 250.000 el sáb 08:38 (dato de la
dueña), sueldos 400.000 en efectivo, ningún movimiento de Caja Grande sin
registrar entre el sáb 20:23 y el conteo de los 189.000.

Si los 189.000 incluyen el cajón del lunes, la diferencia real es 36.799,30.

### 6.3 Qué SÍ queda sin explicar (todo antes del corte del sáb 08:38)

1. **Viernes 25 → sábado 08:38.** Los dos sobrantes (+73.668,1 y +73.479,8 =
   147.148) dependen de dos retiros que nadie registró: 52.000 al cerrar el
   jueves (vie 08:14, contó 99.200 y abrió 47.200) y 139.800 al mediodía
   (cerró 394.500, abrió 254.700). Si esa plata **no** salió del cajón, los
   147.148 de sobrante se convierten en un **faltante de 44.652**. Y si los
   dos cambios del sábado 08:38 (100.000 + 75.000 a Mercado Pago) no
   ocurrieron de verdad, el faltante sube a 219.652. **Se resuelve mirando el
   resumen de Mercado Pago del 25–26/9** (¿entraron 100.000 y 75.000?).
2. **Sobrante del viernes mañana (+73.668).** Ningún egreso lo explica (los del
   turno suman 13.100). La hipótesis más barata es un cobro cargado como
   Transferencia que en realidad fue en efectivo: el turno tiene 228.856,50 en
   transferencias. Se resuelve contra el extracto bancario de esa mañana.
3. **Egresos que calzan con los sobrantes** (probable pago con otra plata):
   jue 17 +182.452 ≈ Ramiro 102.000 + cambio 60.000 + retiro compra 20.000
   (182.000); sáb 19 tarde +75.504 ≈ DESCARTABLE 78.000; jue 24 +44.290
   (parte del dulce de leche); sáb 26 tarde +235.000,70 (sueldos).
4. **Tres movimientos de Caja Grande mal cargados** (distorsionan el saldo del
   sistema, no el efectivo físico después del corte):
   - 22/9 19:07: "Transferencia a Caja Grande: Cambio por transferencia"
     100.002 desde el cajón. Si fue un cambio a un cliente, la plata salió a
     un cliente (y entró al banco), no a la Caja Grande.
   - 25/9 18:42: Transferencia → Caja Grande 40.000 "cambio efectivo por
     transferencia". Dirección probablemente invertida: un cambio es banco +,
     efectivo −.
   - 19/9: 750.000 de sueldos contra una Caja Grande que no tenía registrado
     ningún ingreso (incluye "Diferencia Sueldo Ani Transferencia" 80.000).
5. **Salidas de la Caja Grande sin registrar, 17–26/9.** Entre cierres y
   aperturas se retiraron ~1.401.500 del cajón (240.600, 187.000, 147.000,
   225.700, 211.100, 79.200, 119.100, 52.000, 139.800). Con los sueldos del 19
   y los movimientos de arriba, la Caja Grande habría tenido ~790.000 el
   sábado 08:38, y la dueña dice 250.000. Esos ~540.000 son retiros,
   depósitos o pagos a proveedores de la dueña que no pasaron por el sistema.
   No se pueden deducir de la base; es la pregunta 7 de 4.1.

### 6.4 Conclusión

El reclamo de 270.800 es un error de suma: la diferencia real, después del
retiro del sábado, es de **7.399,30** (o 36.799,30). No hay señal de robo en
los datos: los sobrantes grandes calzan con gastos pagados con otra plata, y
lo que no calza es anterior al corte y depende de retiros que nadie anotó. Lo
que falta es **desorganización del circuito de efectivo**: retiros de cajón a
Caja Grande sin registro, egresos imputados a la caja equivocada y cambios
cargados como gasto o al revés.

### 6.5 Reimputación aplicada — `20260928140000_nono_cacho_reimputar_gastos_a_caja_grande.sql`

Decidido con la dueña el 28/9. Aplicada y verificada ese día (prueba en seco
revertida antes, todos los guards pasaron).

| Turno | Gasto que pasa a Caja Grande | Esperado | Contado | Diferencia antes | Diferencia ahora |
|---|---|---|---|---|---|
| Jue 17 tarde | Ramiro 102.000 + Dipa 100.000 | 288.548 | 269.000 | +182.452 | **−19.548** |
| Sáb 19 tarde | DESCARTABLE 78.000 | 257.196 | 254.700 | +81.500,50 firmado / +75.504 ledger | **−2.496** |
| Jue 24 | 44.290 del dulce de leche (partido: 205.710 cajón + 44.290 CG) | 99.200 | 99.200 | +44.290 | **0** |
| Sáb 26 tarde | Sueldo Agu 150.000 + Sueldo Analia 100.000 | 225.799,30 | 210.800 | +235.000,70 | **−14.999,30** |

- Gastos: cambian de cuenta y pierden el turno; el ledger escribe solo el par
  CORRECCION_REVERSA / CORRECCION_APLICADA fechado en el gasto. Total de gastos
  sin cambio.
- Arqueo: reversa del ajuste vigente + ajuste nuevo, fechados en el cierre. El
  conteo firmado no cambia; la observación del turno guarda el esperado y la
  diferencia firmados.
- El sábado 19 además queda con el esperado correcto (el firmado tenía una
  devolución restada dos veces).
- Caja diaria sin cambio (0). **Caja Grande: 443.702 → −130.588.** Es
  esperable: le faltan el saldo inicial al 17/9 y los cierres del 17–19/9.
- Etiqueta en pantalla de las reversas de turno: "Corrección de cierre de
  caja" (`movimiento-financiero.ts`).

### 6.6 Caja Grande desde el 17/9 — `20260928150000_nono_cacho_caja_grande_desde_el_17.sql`

Aplicada el 28/9, con prueba en seco antes.

- Saldo inicial **202.000** al 17/9 16:29. La dueña: "era igual a la
  cantidad de egresos", o sea justo Ramiro + Dipa.
- Patas de Caja Grande de los turnos del 17 al 19/9: +997.900 de cierres,
  −168.600 de fondos. El fondo de 1.000 del primer turno no sale de la Caja
  Grande: la dejaría en −1.000 esa tarde.
- Caja Grande: −130.588 → **900.712**. Caja diaria y resultado sin cambio.

Mínimos diarios de la Caja Grande en el sistema después de esto:

| Día | Mínimo | Fin del día |
|---|---|---|
| 17/9 | 0 | 269.000 |
| 18/9 | 240.600 | 460.200 |
| **19/9** | **−253.400** | 1.300 |
| **21/9** | **−27.700** | 215.500 |
| 22/9 en adelante | positivo | |

El 19/9 los sueldos (750.000, 20:35–20:39) se cargan antes del cierre de la
tarde (20:47) y superan lo que había. Parte se pagó con otra plata (al menos
"Diferencia Sueldo Ani Transferencia" 80.000). El 21/9 el fondo (29.000) sale
de una Caja Grande con 1.300.

**Diferencia contra lo físico:** sistema 900.712 contra ~209.700 físicos
(159.600 del lunes a la mañana + 50.100 del cierre del lunes). Son **~691.000
que salieron de la Caja Grande sin registrarse** entre el 17 y el 28/9. Hay
que pedirle a la dueña la lista de pagos, depósitos y retiros.

### 6.7 Jueves 17 exacto — `20260928160000_nono_cacho_jueves_17_exacto.sql`

Aplicada el 28/9. De Ramiro, 82.452 con Caja Grande y 19.548 con la caja
chica (fila nueva "Pago Proveedor Ramiro (parte pagada con la caja chica)").
Turno del jueves 17 en 0. Saldo inicial de la Caja Grande corregido a 182.452
(reversa del de 202.000 y re-emisión, misma fecha). Caja Grande sin cambio:
900.712.

Nota: a las 16:44 del 28/9 el detalle del turno del sábado 19 tarde no cargó
(turnos_caja 406, `transferencias_caja_turno` 400, `flujo_caja_turno` 403):
los pedidos salieron sin negocio activo. Los datos del turno están intactos.

### 6.8 Modelo final del 17/9 y cambios — `20260928170000_nono_cacho_jueves_17_y_cambios.sql`

Aplicada el 28/9. **Reemplaza** lo que 140000/150000/160000 hicieron con el
jueves 17, siguiendo el modelo de la dueña:

- El 17/9 todo arranca en cero y la Caja Grande todavía no existe. Ramiro y
  Dipa salieron de la caja física, así que vuelven a la caja chica del turno.
  La Caja Grande **no tiene saldo inicial** (se revirtió el de 182.452) y
  nace con el cierre de ese turno (269.000).
- El sobrante de 182.452 era plata que ya estaba en la caja antes de la
  primera venta del sistema: el fondo del jueves se corrige de 1.000 a
  **183.452**, sin pata en la Caja Grande. El turno cierra en 0.
- Los seis "Cambio de efectivo por transferencia" cargados como egreso
  (375.000, de los cuales 115.000 eran OPERATIVO) pasan a transferencias
  caja chica → Caja Grande, con el mismo formato que el del 22/9 (que la
  dueña confirma como bien cargado). El egreso se borra (ELIMINACION_REVERSA
  con motivo) y la transferencia queda con su fecha y su turno. Ningún arqueo
  cambia.

Efectos: caja diaria sin cambio, Caja Grande +375.000 (**1.225.612**),
ganancia +115.000, gastos −375.000. La Caja Grande ya no queda negativa en
ningún día: el mínimo del 19/9 pasa a 121.600.

Diferencia contra lo físico: 1.225.612 en el sistema contra ~159.600 (189.000
del conteo del lunes − 29.400 del cajón; el cierre del lunes 50.100 volvió al
cajón como fondo de la tarde). Son **~1.066.000 que salieron de la Caja Grande
sin registrarse** entre el 17 y el 28/9. La dueña tiene que listarlos o se
carga un ajuste único con el conteo de hoy.

### 6.9 Ajuste al conteo — `20260928180000_nono_cacho_caja_grande_ajuste_conteo.sql`

Aplicada el 28/9. Un solo movimiento en la Caja Grande (origen AJUSTE,
evento REGISTRO, `impacto_resultado = 0`) de **−1.066.012**: "Diferencia no
identificada 17–28/9". La Caja Grande queda en **159.600**, que es el conteo
físico: 189.000 del lunes a la mañana menos los 29.400 del fondo del cajón. El
cierre del lunes (+50.100) y el fondo de la tarde (−50.100) se compensan.

Va con impacto 0 porque no se sabe cuánto fue gasto del negocio, cuánto
retiro del dueño y cuánto mercadería. Si la dueña identifica algo, se carga
como egreso de la Caja Grande con su tipo y se achica este ajuste (reversa +
re-emisión por el resto).

## 5. Cómo consultar

- MCP `supabase` (`execute_sql`). Si no responde, los datos se pueden leer con
  la service key de `.env.local` y `@supabase/supabase-js` desde un script
  temporal (solo lectura; borrarlo después).
- Saldo de un turno en el ledger:
  `sum(importe) from movimientos_financieros where turno_caja_id = <turno> and cuenta_financiera_id = <caja diaria>`.
- Saldo de una cuenta: `sum(importe)` por `cuenta_financiera_id`.
- Filas de la corrección de horarios: `datos->>'motivo' like 'Corrección de horarios%'`.
