# Asistente de gestión con IA (auditoría y plan, no empezado)

Leé esto antes de proponer o construir cualquier cosa con IA para el dueño: bandeja de
tareas, mensajes de cobranza, reposición, conversión de venta libre, recompra, chat de
preguntas.

Objetivo: que el dueño sepa **qué atender** y encuentre el trabajo **ya preparado**.
No es "un chat con tus datos": es una lista corta de tareas con evidencia y un
borrador que se aprueba, se edita o se descarta.

---

## Auditoría (21/10/2026, producción, últimos 30 días)

Medido en los comercios activos o en prueba. Se excluyen los demo y los cancelados.
Las consultas son de solo lectura; sus definiciones están al final.

### 1. En dos de los tres comercios más grandes, la mitad de lo vendido no pasa por el catálogo

| Comercio | Ventas 30 d | Renglones | Venta libre | Renglón sin costo | Productos con costo |
|---|---|---|---|---|---|
| Librería Colores | 3.603 | 7.747 | 2.057 (27%) | 2.904 (37%) | 1.213 / 2.063 |
| El Nono Cacho | 1.759 | 4.051 | **3.013 (74%)** | 987 | **1 / 118** |
| Evens | 604 | 1.316 | 38 (3%) | 0 | 1.644 / 1.644 |
| Estilo Bonito | 161 | 420 | 0 | 0 | 701 / 701 |

- Lo que más vende El Nono Cacho son textos libres: "Articulos Varios" (94), "dulce de
  leche" (37 + 13 "DULCE DE LECHE"), "globos", "Globos", "Globos Sueltos", "globos
  sueltos" (en total más de 90), "velita", "Velita" y "velitas", "bandeja", "Bandeja" y
  "bandejas". Es el **mismo producto escrito de varias formas**.
- Para estos comercios **todo análisis está ciego**: no hay stock, margen, quiebre ni
  ranking posible. Cualquier asistente de "vendé más" les va a contestar con nada.
- Librería Colores tiene **251 variantes con stock ≥ 1.000** (máximo 999.999.998):
  stock "infinito" para no controlarlo. Su capital inmovilizado calculado
  (1.176 millones) es basura por eso. **Antes de cualquier reposición hay que saber
  qué variantes NO llevan stock** (hoy se finge con un número).

**Conclusión:** la primera tarea de la IA es **ordenar los datos**, no interpretarlos.

### 2. Hay mucha plata en la calle y solo un comercio la persigue

| Comercio | Deudores | Deuda | Vencidos | Con teléfono | Avisos CC enviados |
|---|---|---|---|---|---|
| Librería Colores | 111 | $ 6.253.547 | 44 | 111 | **101** |
| Evens | 114 | $ 5.046.859 | 21 | 82 | **0** |
| ClickTostado | 9 | $ 2.261.770 | 0 | 9 | 0 |
| Estilo Bonito | 37 | $ 1.555.800 | 4 | 37 | 0 |
| Encanto (prueba, 2 días) | 13 | $ 1.275.200 | 1 | 13 | 0 |

- En total son **~16 millones** fiados. Librería demuestra que el circuito de avisos
  por WhatsApp se usa cuando el comercio lo adopta. Evens, con la misma deuda, no
  mandó ni uno.
- Los datos para cobrar ya están todos (saldo, vencimiento, teléfono, recibo). Falta
  que el trabajo llegue armado y que la clienta **pueda pagar desde el link**.

### 3. Lo quieto pesa más que lo que falta

| Comercio | Variantes vendidas que quedaron en 0 | Variantes con stock y sin venta en 90 d | Capital quieto a costo |
|---|---|---|---|
| Evens | 955 | 2.601 | **$ 34.564.968** |
| Estilo Bonito | 251 | 1.219 | **$ 15.444.800** |
| ClickTostado | 12 | 11 | $ 3.656.000 |
| Encanto | 11 | 59 | $ 1.348.300 |

- En indumentaria la mediana de stock por variante es **1**. Que una variante quede en
  0 no es un quiebre: es la venta del último talle. La pregunta de reposición ahí es
  **"¿vuelvo a pedir este modelo, y en qué curva?"**, no "reponé el M negro".
- **Nadie usa `stock_minimo`** (0 variantes en los comercios reales). La reposición no
  puede depender de que lo carguen: se calcula desde el ritmo de venta.
- Evens tiene el proveedor derivable para **1.620 de 1.644 productos** desde sus 155
  remitos (59 proveedores). Estilo Bonito, para 464. Agrupar la compra por proveedor
  es posible hoy, pero el proveedor es un **texto** en `ordenes_compra.proveedor`, no
  una entidad con teléfono.

### 4. Las clientas vuelven, pero solo vemos a las que fían

- Evens: 171 clientas identificadas, **91 recompraron**, cada ~26 días. Estilo Bonito:
  43 de 81, cada ~23 días. Librería: 100 de 118, cada ~5 días.
- En Librería, ventas con cliente = ventas fiadas (485 = 485). Confirma el sesgo
  documentado en [insights.md](insights.md): **"clienta" significa "a la que se le
  fía"**. Cualquier campaña de recompra hoy le escribe solo a deudoras.

### 5. Lo que la medición descarta

- **Descuentos que comen margen**: en Evens el descuento es 3,2% del bruto y 6,2% del
  margen; en Estilo Bonito, 4,2% y 8,4%. No es donde se pierde la plata. **No
  priorizar.**
- **Promociones y venta cruzada predictiva**: siguen sin evidencia (ver insights.md).
  Las promociones casi no se usan (5 activas en total).
- **Importación de planillas**: `importaciones_productos` tiene 0 filas. El Excel entra
  hoy solo como remito (Evens y Estilo Bonito). Librería y El Nono Cacho nunca
  cargaron una lista.
- **Actualización de precios**: solo la usan Evens (11 lotes, último 15/10) y Estilo
  Bonito (5 lotes, **último 31/7**, con 531 productos sin tocar hace 45 días). Con la
  inflación, ahí sí hay plata, pero solo donde hay costos (indumentaria).

---

## Principios

1. **Los números los calcula SQL; la IA agrupa, empareja y redacta.** El LLM nunca
   calcula una cifra ni la inventa. Cada número de una tarea sale de una consulta y
   queda **congelado en la tarea** como evidencia, con un enlace al detalle.
2. **Bandeja de tareas, no chat.** Cada tarjeta tiene qué se detectó, la evidencia, un
   borrador listo y tres botones: aprobar, editar, descartar. Máximo 5 por día: si
   todo es urgente, nada lo es.
3. **Escribe solo lo aprobado y por el camino de siempre.** Aprobar ejecuta la misma
   RPC que la pantalla (alta de productos, actualización masiva, aviso de CC). Con la
   sesión del admin: RLS y permisos siguen siendo el freno. El asistente no tiene
   escritura propia.
4. **Fail-closed sobre datos faltantes.** Sin costo no hay tarea de margen; con stock
   "infinito" no hay tarea de reposición. En su lugar va la tarea de completar el dato.
5. **Se mide por aceptación.** Cada tarea guarda si se aprobó, editó o descartó. Si un
   tipo de tarea se descarta tres veces seguidas en un comercio, se silencia ahí y se
   revisa el criterio.
6. **La IA no promete ventas.** Describe lo que pasó y lo que dejó preparado. Vale
   "correlación no es palanca" (insights.md).

---

## Plan por épicas (en orden)

El orden sale de: plata en juego × comercios afectados × datos disponibles hoy.

### A1. Venta libre → productos (desde cero) — prioridad 1

**Para quién:** El Nono Cacho (74% de los renglones), Librería Colores (27%) y todo
comercio que arranca sin catálogo (el alta más común en kioscos, cotillón, almacén).

- Cada noche, la IA agrupa los textos de venta libre de los últimos 30 días ("globos",
  "Globos Sueltos", "GLOBOS"), sin mezclar precios muy distintos ("globos sueltos" a
  $287 contra "Globos Sueltos" a $2.498 probablemente son dos productos). Propone:
  nombre, categoría, precio (la mediana de lo cobrado) y cuántas veces se vendió.
- Tarea: **"Vendiste 'globos' 99 veces escrito de 6 formas. ¿Lo creamos como
  producto?"** Al aprobar se crea el producto (stock opcional: sin stock es un estado
  declarado, no un 999999998).
- En el POS: al escribir en venta libre un texto que coincide con un producto creado
  así, se ofrece el producto. Así se cierra el circuito.
- **Necesita:** una marca de "no lleva stock" por producto o variante, para reemplazar
  el stock ficticio (Librería ya tiene 251). Tema de stock-y-catalogo.md.
- **Éxito:** % de renglones con venta libre por comercio, medido cada semana.

### A2. Cobranza armada + pago por link — prioridad 1

**Para quién:** Librería, Evens, Estilo Bonito, ClickTostado (~16 millones).

**Por qué Evens mandó 0 avisos (22/10/2026):** la lista "a quién avisar hoy"
(`avisos-cc.ts`) existe **solo para comercios con cierre mensual** (decidido el
5/10). Evens, Estilo Bonito y ClickTostado están en modo `DIAS`: tienen 8,8 millones
fiados y **ninguna lista de a quién cobrar**. Solo pueden mandar el resumen cliente
por cliente desde la tabla. No es un problema de WhatsApp: les falta la lista.

Hay más fricción, medida en la configuración:
- **Nadie cargó `alias_transferencia`**. Librería escribió su alias ("pagocolores.mp")
  dentro del texto de la plantilla, así que el resumen público no muestra el bloque
  "Pagá por transferencia" con el monto para copiar.
- **Ningún comercio real conectó Mercado Pago** (las 2 conexiones son de un demo y de
  un comercio en prueba).
- Cuando la clienta transfiere, el comercio tiene que ver el comprobante en WhatsApp,
  buscar a la clienta y cargar el cobro a mano. **Esa es la parte más manual de
  todas**, más que el envío.

Lo que propongo, en orden. No hace falta la API de WhatsApp (se sigue usando `wa.me`):
1. **Lista de cobro también en modo días**: deudas vencidas y las que vencen en los
   próximos 5 días (ver "Decidido" abajo), agrupadas por cliente, una sola vez por semana o por vencimiento,
   con el mismo registro `cc_avisos`. La regla "una lista diaria sería ruidosa" se
   resuelve agrupando, no escondiendo la lista.
2. **Envío en tanda**: una pantalla en forma de cola. Se toca "Enviar", se abre
   WhatsApp con el mensaje, se vuelve y ya está listo el siguiente. Pasa de 111 envíos
   sueltos a 111 toques seguidos. No hace falta ninguna API.
3. **Pagar desde el resumen con Mercado Pago** (lo que estaba en stand by en
   cuenta-corriente.md): el botón crea un pago por el total del momento (con la mora
   recalculada), con el OAuth del comercio (el mismo que la tienda), y el **webhook**
   registra el cobro con `registrar_cobro_cc`, idempotente por id de pago. **Un alias
   no alcanza para "redirección directa":** un alias no lleva monto ni avisa que se
   pagó. Lo que redirige con el monto y avisa es un pago creado por la API (Checkout
   Pro). Con eso desaparece la carga manual.
4. **"Ya transferí" en el resumen** (para el que no usa MP): la clienta sube el
   comprobante y el admin ve una tarea "Cobro por confirmar: María, $45.000, ver
   comprobante", con el cobro ya armado. Confirma con un toque. Sigue siendo una
   persona la que decide que la plata entró (fail-closed).
5. **Saber si lo vio**: registrar la apertura de `/r/<token>`. "Lo vio hace 3 días y
   no pagó" es otra conversación que "no lo vio".
6. Educación inmediata, sin código: cargar `alias_transferencia` en Colores, Evens y
   Estilo Bonito, y sacar el alias del texto de la plantilla.

**Decidido con Ignacio (22/10/2026):**
- **Estado nuevo "Por vencer"**: saldo > 0 y vence dentro de los próximos **5 días**
  (fijo; configurable solo si alguien lo pide). Se suma en `clasificar-estado-cliente.ts`
  (única fuente de tabla, filtro y detalle) y en el filtro de estado. Medido el
  22/10: Evens 5 clientas ($154 mil), Estilo Bonito 3 ($144 mil), Encanto 1 ($30 mil).
- **Lista de cobro en modo días = vencidos + por vencer** (5 días, no 7), con envío
  en tanda. **Hecho el 22/10/2026** (código en el working tree, sin migración):
  detalle en cuenta-corriente.md, "Modo días y Por vencer".
- **Pagar con Mercado Pago desde el resumen (punto 3): anotado para después.** Ignacio
  lo prefiere al "Ya transferí" (punto 4), que baja de prioridad. Funciona solo en los
  comercios que conecten MP, y la comisión la paga el comercio.
- **API de WhatsApp: no por ahora.** La vía no oficial (automatizar WhatsApp Web)
  viola los términos y arriesga el número del comercio: descartada. La oficial (Cloud
  API de Meta) obliga a cada comercio a registrar su número y verificarse, usa
  plantillas aprobadas, cobra por mensaje y baja la calidad del número si las
  clientas bloquean o reportan. Un recordatorio de una deuda real, con
  consentimiento y una vez por vencimiento, no es spam; mandar seguido sí. Se
  reconsidera si la tanda por `wa.me` muestra decenas de envíos por semana por
  comercio (medir con `cc_avisos`).

La IA entra recién en el punto 1: ordenar la lista y adaptar el tono del mensaje
(primer aviso, cliente de siempre, mora larga). Los puntos 2 a 5 son producto, no IA.
Lee caja-y-dinero.md y cuenta-corriente.md antes de los puntos 3 y 4: es un medio de
cobro nuevo y es plata real.
- **Éxito:** deuda vencida a 30 días y días promedio hasta cobrar, antes y después.

### A3. Mercadería quieta → acción (prioridad 2)

**Para quién:** Evens ($34,5 M), Estilo Bonito ($15,4 M).

- Cálculo determinístico: variantes con stock y sin venta en N días, **comparadas
  contra su categoría** y silenciadas si la categoría está fuera de temporada
  (`categoriasFueraDeTemporada`). N depende del rubro (indumentaria: 60–90 días).
- Lo que deja preparado, a elección del dueño:
  1. una selección para destacar en el catálogo (ya existe `destacado_en`);
  2. el texto de la publicación de Instagram o del estado de WhatsApp, con fotos,
     talles y precios reales (Evens tiene foto en 1.358 de 1.644 productos);
  3. una propuesta de rebaja con el margen que queda (indumentaria tiene costo en
     todo).
- **Éxito:** capital quieto a costo, mes a mes.

### A4. Recompra de clientas (prioridad 2)

- **Bloqueo:** hoy solo se identifica a quien fía. La carga rápida de cliente en el
  POS **ya existe** (al tocar el botón de cliente): falta **educación**, no
  funcionalidad (Ignacio, 22/10/2026). Medir cada semana el % de ventas de contado
  con cliente, y mostrarle al comercio para qué le sirve ("estas 12 clientas no
  vuelven hace 50 días"). Sin esto, A4 le habla solo a las deudoras.
- Con eso: clientas cuya última compra superó 2× su frecuencia (Evens: ~26 días) →
  mensaje con novedades de **su** categoría y talle, armado con stock real.
- **Éxito:** % de ventas con cliente identificado (prerrequisito) y luego recompra a
  60 días.

### C1. Compra de mercadería: un solo circuito (no es IA, va antes que A5 y A6)

**Auditoría (22/10/2026):** en toda la historia, **ningún gasto quedó asociado a un
remito** (`egresos.orden_compra_id` está en null en todas las filas).

| Comercio | Remitos | Sin conciliar (desde) | Gastos COMPRA_MERCADERIA | Asociados a remito |
|---|---|---|---|---|
| Evens | 155 | 27 (10/7) | 0 | 0 |
| Estilo Bonito | 21 | 3 (22/7) | 0 | 0 |
| ClickTostado | 3 | 0 | 0 | 0 |
| El Nono Cacho | 0 | — | 27 ($ 4.824.700) | 0 |

- Hoy son dos caminos que no se cruzan. El **remito** (Stock: mercadería, costo,
  precio) y el **pago** (Caja › Gasto › tipo Compra de mercadería › selector
  opcional "Remito"). La asociación vive en un selector opcional al final de un modal
  de caja. Por eso nadie la usa: quien carga el remito no está pensando en la caja, y
  quien paga no está pensando en el remito.
- La alerta "Remitos sin conciliar" (`get-advisor-insights.ts`) habla de
  **mercadería** (remito `PENDIENTE`: el stock no entró), no de pago. Las 27 de Evens
  vienen desde julio: son, casi seguro, borradores abandonados, y la alerta es ruido
  que enseña a ignorar alertas.
- No hay manera de ver "cuánto le debo a cada proveedor". `resumen_remitos_financiero`
  ya calcula `saldo_pendiente` por remito, pero no se muestra en ningún lado como
  deuda.

**Propuesta: el remito es la factura del proveedor, y el pago cuelga de él.**
1. **Al aprobar el remito, una sola pregunta: "¿Lo pagaste?"**
   - *Sí, ahora*: de qué caja o cuenta sale (sin default, igual que el gasto) y
     cuánto (sugiere el total del remito, acepta pagos parciales). Crea el egreso
     `COMPRA_MERCADERIA` con `orden_compra_id`.
   - *Lo pago después*: el remito queda "a pagar".
   El pago es **una transacción aparte**, después de la aprobación (que ya es
   idempotente): si falla por caja cerrada o saldo insuficiente, el remito queda
   aprobado y "a pagar", que es un estado verdadero. No se mete el egreso dentro de
   `aprobar_orden_compra`: las reglas de caja (turno abierto, `SALDO_INSUFICIENTE_CAJA`)
   no tienen que poder voltear el ingreso de mercadería.
2. **"Proveedores a pagar"**: una lista con el saldo por proveedor y por remito
   (`resumen_remitos_financiero`), y un botón "Pagar" que abre el gasto ya armado
   (tipo, remito y monto). Es el camino inverso: desde la deuda, no desde la caja.
3. **Desde Caja › Gasto**: elegir "Compra de mercadería" muestra arriba los remitos
   con saldo pendiente, no al final del modal. Pagar sin remito sigue permitido (El
   Nono Cacho compra sin remito), pero con una línea: "¿Querés cargar qué entró?".
4. **La alerta pasa a ser dos**: "Mercadería sin ingresar" (remito pendiente; después
   de N días se ofrece **descartarlo**, no recordarlo para siempre) y "Remitos a
   pagar", con el monto.
5. **Proveedor como entidad** (hoy es texto en `ordenes_compra.proveedor`): nombre,
   teléfono y plazo. Es la base de "a pagar" por proveedor y de A5. Al migrar hay que
   unificar los textos: Evens tiene 59 proveedores escritos a mano. Esa
   unificación es una tarea de la IA (agrupar los nombres parecidos y que el admin
   apruebe).

**Decidido con Ignacio (22/10/2026). Va antes que cualquier IA:**
- **Los remitos aprobados que ya existen quedan "pagados (anterior al registro)"**,
  sin crear gastos. Un gasto con fecha vieja descuadra cajas cerradas, y dejarlos "a
  pagar" le inventaría a Evens una deuda de $73 M. Evens hoy considera pagados todos
  sus remitos.
- **Al aprobar, tres opciones**: *Sí, ahora* (caja, monto, parcial), *Lo pago
  después* (queda a pagar) y *Ya está pagado, no sale de una caja de Comerz* (lo que
  hace Evens: queda pagado sin egreso).
- **`ordenes_compra.proveedor` NO es el proveedor: es el nombre del ingreso.** Evens
  escribe "INGRESO", "INGRESOS", "VERANO23", "BERMUDASSS"; Estilo Bonito "Parte 5",
  "Ingreso Ropa Interior". El label dice "Nombre del Proveedor" y nadie lo usa así.
  Por eso **no hay nombres que unificar** (el punto 5 de arriba queda sin la tarea de
  la IA): los remitos viejos quedan sin proveedor.
  - El texto pasa a ser el **nombre del ingreso**, con copy que pida lo útil (la fecha
    del remito ya está en `fecha_remito`; un proveedor trae varias veces).
  - **El proveedor pasa a ser entidad propia en esta etapa** (`proveedores`: nombre,
    teléfono, plazo de pago) con `ordenes_compra.proveedor_id`, elegido o creado al
    vuelo al cargar el remito.
- **Proveedor obligatorio solo en "Lo pago después"** (una deuda sin acreedor no
  sirve); opcional en las otras dos.
- **Los 27 remitos sin ingresar de Evens** (julio a septiembre, $24,2 M): 20 tienen un
  gemelo APROBADO (mismo nombre a ±3 días o misma planilla): son subidas repetidas
  ("Rop" 6 veces, "CAMPERAS" 4). Ignacio no quiere egresos. **Aprobarlos o marcarlos
  "impactados" sería falso o duplicaría stock**, así que (propuesto, a confirmar) pasan a un estado nuevo
  **DESCARTADA** (archivado): no mueve stock, no crea gasto, sale de la alerta y queda
  visible en el historial. Mismo trato para los 3 de Estilo Bonito.

**Hecho el 22/10/2026** (migraciones `20261022150000`, `160000`, `170000`,
aplicadas): proveedores, `pago_modo`, DESCARTADA, selector de proveedor y "Nombre
del ingreso" al subir el remito y la alerta partida en dos. **Rehecho el mismo día a
pedido de Ignacio**: la pantalla `/compras` se sacó ("muy cruda, solo muestra los
remitos; lo que buscaba no eran más cosas sino que al ingresar mercadería se
entienda que se hizo un gasto"), y "¿Lo pagaste?" pasó a ser el gasto ya armado en
una pantalla (monto = costo de lo que entró, caja, "Registrar gasto"; "Lo pago
después" y "No registrar gasto" discretas; en carga inicial "Es stock que ya
tenía"). Descartar quedó en la página del remito. Detalle en stock-y-catalogo.md. Falta: editar proveedores (teléfono, plazo),
la campana (`REMITO_PENDIENTES` sigue diciendo "sin conciliar") y borrar
`resumen_remitos_financiero`.

**Lo que ya existía y se reusó** (auditado el 22/10): `resumen_remitos_financiero`
calcula `valor_historico` (Σ cantidad × costo de las líneas), `total_pagado` (Σ
egresos `COMPRA_MERCADERIA` con `orden_compra_id`) y `saldo_pendiente` por remito;
`egresos.orden_compra_id` existe con ON DELETE SET NULL; el modal de gasto ya tiene
el selector (`getOrdenesParaEgresoAction`, últimos 30). Falta: el estado de pago del
remito (para distinguir "pagado fuera de Comerz" de "a pagar", que el saldo solo no
distingue), la tabla de proveedores, la pregunta al aprobar (merge-table y carga
inicial llaman a `aprobarOrdenAction`) y la lista "Proveedores a pagar".

Lee stock-y-catalogo.md y caja-y-dinero.md antes ("Aprobar un remito o pagar a un
proveedor" en AGENTS.md). El egreso de compra **sale del cajón pero no resta
ganancia**: eso no cambia.

### A5. Reposición por proveedor (prioridad 3)

- **Indumentaria:** a nivel MODELO, no variante. "Vendiste 9 de 10 de este modelo en
  25 días y te queda 1 talle. Última compra a <proveedor> el <fecha> a $X". Agrupado
  por proveedor, con un borrador del pedido para mandar por WhatsApp.
- **Librería / kiosco:** a nivel variante, por cobertura en días (stock ÷ ritmo), solo
  donde el stock es real (después de A1).
- **Desde cero:** proveedor como entidad (nombre, teléfono, plazo de entrega), migrando
  el texto de `ordenes_compra.proveedor`. El plazo se le pregunta al dueño una vez.
- **Éxito:** pedidos armados que se mandaron; quiebres de modelos que se reponían.

### A6. Listas de proveedor e inflación (prioridad 3)

- La conciliación de remitos ya existe con `diccionario_alias` (1.920 alias). La IA
  mejora solo el tramo **dudoso** (sugiere el emparejamiento con su razón) y nunca
  descarta una fila.
- Un Excel de **lista de precios** (sin mercadería) completa costos y detecta
  aumentos: "en el último remito de <proveedor> el costo subió 14%, estos 38 productos
  quedaron con margen menor al de siempre". Propone la actualización por el camino de
  `actualizaciones_precio`, que es reversible.
- Aviso de precios viejos: Estilo Bonito no actualiza desde el 31/7.

### A7. Resumen semanal y preguntas (prioridad 4)

- Resumen del lunes: qué cambió (operaciones, unidades por ticket, ticket promedio,
  cobrado contra fiado) usando las señales que ya existen, con su explicación.
- Chat de preguntas al final, sobre las mismas herramientas de solo lectura, con la
  cifra y su origen en cada respuesta. Es lo que más se presta a inventar y lo que
  menos trabajo deja hecho.

---

## Arquitectura propuesta

- **Tabla `tareas_asistente`** (nueva, por negocio): `tipo`, `clave` (única por
  negocio + tipo + objeto, para no repetir la misma tarea), `evidencia` jsonb
  congelada, `borrador` jsonb, `estado` (PENDIENTE / APROBADA / EDITADA / DESCARTADA /
  VENCIDA), `decidida_por`, `decidida_en`. RLS restrictiva como toda tabla del tenant
  (ver seguridad.md).
- **Generación nocturna**, no a cada visita: un job por negocio activo calcula las
  señales en SQL, le pasa al LLM solo lo que hay que agrupar o redactar y escribe las
  tareas. El panel lee la tabla (sin costo de egress ni latencia de IA al abrir).
- **Modelos:** uno chico para agrupar y emparejar (A1, A6) y uno mediano para redactar
  (A2, A3, A4). Los precios por token se verifican al momento de decidir; no se
  copian acá.
- **Permiso nuevo** `asistente.ver`, asignado al ADMIN. Los mensajes a clientes no
  salen solos: los manda una persona desde su WhatsApp.
- **Datos que salen a un proveedor de IA:** nombres de productos, textos de venta
  libre, montos y el nombre de pila de la clienta para el mensaje. Ni DNI, ni CUIT, ni
  teléfono (se agregan después de la redacción, en el server).

---

## Lo que NO hacer (con la medición de arriba)

- Asistente de descuentos: el descuento pesa 6–8% del margen.
- Promociones inteligentes o "se compran juntos" con promesa de venta: no hay
  evidencia.
- Reposición basada en `stock_minimo`: nadie lo carga.
- Reposición por variante en indumentaria: el stock por talle es 1.
- Cualquier análisis de margen en comercios sin costos: primero A1 y A6.

---

## Consultas de la auditoría

Todas sobre los últimos 30 días a la fecha, excluyendo ventas con
`estado_operacion = 'ANULADA'`.
- Venta libre: `ventas_items.es_venta_libre`. Sin costo: `precio_costo` 0 o null en un
  renglón que no es venta libre.
- Quiebre: variante activa con ventas en 30 días y `stock <= 0`. Quieta: variante
  activa con `stock > 0` sin ningún renglón en 90 días; capital a
  `coalesce(nullif(variante.costo, 0), producto.precio_costo)`.
- Proveedor derivable: productos con alguna línea en `ordenes_items`.
- Recompra: clientes con más de una venta; frecuencia = (última − primera) ÷
  (compras − 1).
- Descuento sobre margen: `sum(descuento_monto) / sum((precio_unitario − precio_costo)
  × cantidad)` en renglones con costo.
