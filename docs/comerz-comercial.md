# Comerz con mirada comercial (para marketing y redes)

Documento para quien hace el marketing y los posteos. Sale del código y de los textos
de la app al 23/10/2026: lo que dice acá existe, salvo lo marcado en la sección 5.
Los textos entre comillas son los que ve el usuario en pantalla. **Antes de prometer
algo que no esté acá, preguntá.** Los planes, precios y límites viven en la base y se
pueden cambiar sin aviso en este documento: confirmalos antes de publicar números.

Convenciones:
- 🟢 Disponible para todos los comercios.
- 🔒 Depende del plan (ver sección 4).
- 🟡 Existe pero lo prende Comerz comercio por comercio, o es muy nuevo. No
  promocionar como "para todos" sin confirmar.
- 🔴 No existe o está a medias. **No promocionar.**
- ❓ Duda: el código no alcanza para afirmarlo.

---

## 1. Qué es Comerz, en 3 líneas

Comerz es el sistema para manejar tu comercio desde el celular o la compu: vendés en
el mostrador, controlás la caja y el stock, y llevás el fiado de tus clientes sin
cuaderno. Todo lo que vendés se descuenta solo del inventario y te queda claro cuánta
plata hay, dónde está y quién te debe. Y con el mismo stock tenés tu tienda online
para que te compren por WhatsApp.

(El propio sistema se presenta así: "Tu comercio, más simple", "Tu comercio ordenado,
desde el primer día", "Una venta. Todo conectado." y, en el pie de cada tienda,
"Catálogo web, control de stock y punto de venta en un solo lugar.")

---

## 2. Módulos y funciones

En el menú lateral: **Punto de Venta**, y debajo los grupos **Gestión** (Caja,
Inventario, Ventas, Clientes, y si están prendidos Presupuestos y Órdenes) y
**Herramientas** (Reportes, Configuración). Arriba hay una campana de
**Notificaciones** y un **Buscador global** (Ctrl+K) que "Buscá productos, clientes,
pantallas y acciones".

### 2.1 Punto de venta (`/pos`) 🟢

**Qué hace.** Pantalla de venta con grilla de productos, buscador y lector de código
de barras, y un ticket a la derecha (en el celular, abajo). Se elige variante (talle,
color, etc.), cantidad, cliente, descuento y forma de pago, y se cobra.

**Qué problema resuelve.** Cobrar rápido sin anotar nada, con el stock descontado en
el momento y el ticket listo para imprimir o mandar.

**Lo que tiene adentro:**
- **Tipos de venta** en el pago: "Venta", "C. Corriente" (fiado) y "Reservado" (solo
  indumentaria, ver 6).
- **Pago mixto**: "Agregar otro método" para cobrar parte en efectivo y parte con otro
  medio. Si no suman, avisa "La suma de los pagos no coincide con el total".
- **Calculadora de vuelto**: con efectivo, el modal se llama "Calculadora de Vuelto",
  pregunta "¿Con cuánto billete físico paga?", ofrece "Montos rápidos de efectivo"
  ("Justo" y billetes redondos) y muestra "Valor a devolver" o "Falta".
- **Venta libre**: cobrar algo que no está cargado. "Qué cobrás (ej. 12 globos
  sueltos)", "No descuenta stock". Se abre con la tecla V o desde la búsqueda sin
  resultados ("Lo creás y seguís cobrando" / "Solo ponés el precio · V").
- **Listas de precios** por cliente (mayorista, distribuidor…): al elegir el cliente,
  el POS propone su lista ("Precios de [lista] para [cliente]").
- **Promociones y descuentos** aplicados en el paso de pago ("Aplicar descuento").
- **Recargo por medio de pago** (ej. tarjeta +10%) calculado solo.
- **Fiado** con "Forma de fiar", entrega mínima y, nuevo, **venta en cuotas** dentro
  de la cuenta corriente (ver 2.4).
- **Saldo a favor** del cliente usado como pago.
- **Venta por peso o por importe** ("Peso", "O por importe", "Se vende fraccionado:
  podés cargar 0,750").
- **Presentaciones** (pack, caja, balde) con precio propio sobre el mismo stock.
- **Precio por cantidad** (tramos: "Desde cantidad"; ej. 10 o más a otro precio).
- **IMEI / número de serie** para celulares y electro: elegir la unidad exacta o
  "Vender sin IMEI" con motivo.
- **Pantalla de venta exitosa**: "Imprimir", "WhatsApp" (manda el ticket armado por
  WhatsApp), "Ver detalle", "Nueva venta". Festejo en la primera venta: "🎉 Primera
  venta registrada · Ya estás usando Comerz."
- **Factura o ticket**: con ARCA conectado se elige factura o ticket interno; si ARCA
  no responde, "Podés cobrar con ticket interno y facturar esta venta después desde el
  historial."
- **Atajos de teclado** para la compu: F4 ir a pagar, F7 elegir cliente, V venta
  libre, 1/2/3 tipo de venta, Ctrl+Enter cobrar, Alt+↑/↓ cantidad, F2 cobrar cuenta
  corriente, F9 caja, Ctrl+Shift+Backspace vaciar ticket.
- **Venta sin conexión** (ver 3).
- **Varios puestos, una caja** 🔒 ("Enviar a caja" / "Enviar Pedido"): el vendedor
  arma el pedido y lo cobra otra persona ("Pedido #N enviado a la caja", "Decile el
  número al cliente: con eso lo cobran en caja").
- **Cotizar** 🟡 (solo con Presupuestos prendido, ver 5).

**Qué se configura.** Exigir turno abierto para vender, permitir venta sin stock
(Configuración › Caja y Turnos); métodos de pago con recargo, comisión y días de
acreditación (› Métodos de Pago); listas de precios y promociones; formato del ticket.

### 2.2 Caja (`/caja`) 🟢

**Qué hace.** Turnos de caja con apertura ("Abrir turno · Declará el efectivo inicial
para empezar a vender"), gastos e ingresos, y cierre con arqueo ("Efectivo real en
cajón" contra "Efectivo esperado"). Se abre y se cierra desde el botón de caja de la
barra superior. Cuatro pestañas:
- **Hoy**: el turno propio y "Movimientos del local"; para el dueño, una vista con
  "Caja real", "Fiado en cuenta corriente", "Movimiento por medio de pago" y por
  vendedora.
- **Dinero**: dónde está la plata. "Disponible ahora", "Por acreditar" ("Plata que ya
  cobraste pero todavía no está en la cuenta… las tarjetas suelen ser a 20 días"),
  cuentas (caja chica, Caja Grande, banco, billetera), "Mover dinero" entre cuentas,
  "Gastos programados" y "Actividad de cuentas".
- **Movimientos**: "Todo lo que movió plata: cobros, gastos, transferencias y
  ajustes, de todas las cuentas", con filtros y descarga a Excel.
- **Cierres**: historial de turnos, "Ver auditoría" e "Imprimir Cierre Z" (con lugar
  para "Firma responsable del turno").

**Qué problema resuelve.** Saber si falta o sobra plata al cerrar, quién manejó cada
peso, y no confundir "lo que vendí" con "lo que tengo en el banco".

**Detalles que suman:**
- "Anotar gasto" pregunta primero "De dónde sale la plata" y el tipo: "Gasto
  operativo", "Retiro de socio", "Compra de mercadería" (asociable a un remito). Solo
  el gasto operativo resta de la ganancia.
- Ayuda que evita errores: "¿Le diste efectivo a alguien que te transfirió? Eso es un
  cambio, no un gasto: registralo con Transferir en Caja → Dinero."
- "Anotar ingreso" para plata que no es venta (aporte, préstamo): "Suma dinero a la
  cuenta elegida, pero NO cuenta como ganancia."
- **Gastos programados**: "Cargá el alquiler, los sueldos o una suscripción y Comerz
  te va a avisar cuando venzan."
- **Saldo inicial** de cada cuenta, una sola vez.
- **Comisiones**: el cierre separa "Monto Bruto", "Comisiones Retenidas" y
  "Acreditación Neta" de los cobros digitales.
- Si quedó un turno abierto de ayer, frena la venta hasta cerrarlo ("La caja quedó
  abierta desde otro día").

**Qué se configura** (Configuración › Caja y Turnos): "Modo de Caja": "Todas las
ventas van al mismo turno de caja" o 🔒 "Cada vendedor abre y cierra su propio turno";
"Exigir Turno Abierto para Vender"; "Permitir Venta Sin Stock"; cuentas propias
(Caja general, Cuenta bancaria, Billetera virtual, Otra).

### 2.3 Stock / Inventario (`/stock`) 🟢

**Qué hace.** Productos con variantes ("Talles, colores, materiales..."), fotos (hasta
un máximo por producto), categorías y subcategorías, costo y precio con "Ganancia
Neta", y stock por variante.

**Qué problema resuelve.** Saber qué hay, qué falta y a cuánto vendés, sin planillas
desactualizadas.

**Herramientas:**
- **Ingresar mercadería**: "De un proveedor" (su planilla; "El sistema propone contra
  qué producto tuyo va cada línea y aprende para la próxima") o "Planilla propia"
  ("Columnas de tu rubro", con plantilla para descargar). Todo pasa por una revisión
  antes de tocar el stock.
- **Proveedores y pago del remito** (nuevo, 22/10/2026): el remito se asocia a un
  **proveedor** (se crea al vuelo y no se duplica por mayúsculas). Al ingresar la
  mercadería, Comerz arma el gasto con el costo de lo que entró y pregunta si ya lo
  pagaste: "Registrar gasto" ahora, "Lo pago después" (queda como deuda con ese
  proveedor, se paga desde Caja) o "No registrar gasto" (ej. "Es stock que ya tenía,
  no fue una compra" en la carga inicial). Pagar al proveedor saca la plata del
  cajón pero **no resta ganancia** (ya está en el costo de lo vendido). Un remito
  que nunca se ingresó se puede **descartar**.
- **Importar productos** desde CSV o Excel: "Se revisa todo antes de escribir nada."
- **Carga rápida de mercadería** (`/stock/carga-rapida`): "Escaneá o escribí, Enter
  agrega a la lista, confirmá todo junto." Con recargo global para calcular el precio
  de venta. Para electro busca en el **Catálogo Maestro** ("Encontrado en el Catálogo
  Maestro").
- **Actualización Masiva de precios** en tres pasos (alcance: todo, una categoría o
  una marca; regla: ajuste directo o recargo sobre costo; redondeo "Múltiplo de $100",
  "Terminar en 90/99"; revisión final). Se puede deshacer desde **Historial de
  Precios** ("Revertir este ajuste").
- **Fotos pendientes** (`/stock/fotos-pendientes`): lista de productos sin foto para
  ir sacándolas con el celular ("Sacar o elegir").
- **Bajas de inventario** (`/stock/bajas`): reportar mercadería rota o faltante y
  aprobarla o rechazarla.
- **Movimientos de stock** (`/stock/movimientos`): "Historial de ingresos y egresos:
  remitos, ventas, bajas, devoluciones y ajustes manuales."
- **Combinar con otro producto** (duplicados), **Destacado en la portada del
  catálogo**, selección múltiple con "Mover de categoría" y "Compartir…" ("Enviar por
  WhatsApp", "Copiar link": abre el catálogo mostrando solo esos productos).
- **Números de serie / IMEI** por unidad.
- **Datos fiscales** por producto (tratamiento de IVA) para facturar.

**Qué se configura.** Categorías (con atributos requeridos), listas de precios,
precio por cantidad y presentaciones por producto.

### 2.4 Clientes y cuentas corrientes (`/clientes`) 🟢 (con tope por plan 🔒)

**Qué hace.** Directorio de clientes ("Directorio de Clientes · Gestiona el historial
de compras y las cuentas corrientes de tus clientes") con estado "Al día", "Con
deuda" o "Vencido", y tarjetas arriba: "Dinero en la Calle" (capital a cobrar),
"Cuentas con Deuda", "Clientes".

**Qué problema resuelve.** El cuaderno del fiado: cuánto debe cada uno, desde cuándo,
qué vence este mes y cuánto le corresponde de recargo, sin cuentas a mano.

**Funciones:**
- **Ficha del cliente**: "Debe por mes", "Libro Mayor", "Historial de Tickets",
  "Saldo a favor", "Notas internas", "Total Gasto".
- **Cobrar cuenta corriente** ("¿Cómo te paga?"), con **recibo** para imprimir (dos
  copias, con firma) o PDF para mandar: "Este pago cancela…", "Pendiente por
  vencimiento".
- **Resumen por WhatsApp con link**: botón "Resumen" en la ficha y columna "Resumen"
  en la tabla. Abre WhatsApp con un mensaje armado y un link a una página pública con
  el "Resumen de cuenta corriente": movimientos, "Qué vence cada mes" y "Pagá por
  transferencia" con el alias para copiar. Queda marcado "Resumen enviado".
- **Ciclo de cobro** (si el comercio usa cierre mensual): filtro "A abonar 15/10" /
  "Impagos 15/10" para saber a quién avisar.
- **Estado "Por vencer"** (nuevo): la deuda más vieja vence hoy o en los próximos 5
  días. Para los comercios que cuentan los días desde la compra hay una lista
  **"A cobrar"** (vencidos y por vencer, un aviso por vencimiento) y **"Enviar a N"**:
  una cola que abre WhatsApp cliente por cliente, sin armar los mensajes a mano.
- **Pagar con Mercado Pago desde el resumen** 🟡 (nuevo, 22/10/2026): en la página
  del resumen el cliente ve "Pagar lo vencido" / "Pagar lo del mes" / "Pagar todo",
  **solo si el comercio tiene Mercado Pago conectado**. El monto (con la mora) lo
  calcula el servidor, el cobro se registra solo al aprobarse el pago y avisa en la
  campana. Sin prueba larga en producción: ofrecerlo como "disponible a pedido".
- **Scoring del cliente** (ver 3).
- **Perdonar deuda** (queda en el historial), **cargar saldo inicial** por fecha,
  **corregir el medio de un cobro**, **importar clientes por CSV** (nombre, teléfono,
  DNI, deuda inicial, vencimiento).
- **Cliente fiscal** (CUIT validado, condición de IVA) para facturar A/B.
- **Venta en cuotas** 🟡 (salió el 19/10/2026): fiar en N cuotas mensuales con la tasa
  que fija el comercio; el ticket dice "N cuotas de $X · la 1ª vence el d/m".

**Qué se configura** (Configuración › Clientes (CRM)): "Límite de Crédito Base";
recargo por fiar ("Se sumará este porcentaje al total de la venta cuando el pago no
sea al contado"); **entrega mínima** ("Obliga al cliente a pagar este porcentaje por
adelantado para habilitar la deuda", con "Bloquear si no se cumple"); vencimiento
("Días desde cada compra" o "Cierre mensual" con día de cierre y de vencimiento);
**recargo por mora** ("Ninguno", "Monto fijo $", "Porcentaje %", sobre "Solo lo
vencido" o "Todo el saldo de la cuenta"); tasas de "Venta en cuotas"; "Alias para
transferencias"; "Mensaje del resumen de cuenta" con variables ({nombre}, {total},
{vencimiento}, {link}…). Por cliente: "Exceptuado de entrega mínima en cuenta
corriente".

### 2.5 Catálogo / tienda online 🟢

**Qué hace.** Cada comercio tiene su tienda en `nombre.comerz.app` con el mismo stock
y los mismos precios del local. La clienta navega por categorías, busca, filtra,
ordena ("Más vendidos", "Últimos ingresos", "Menor precio"), arma el carrito y manda
el pedido por WhatsApp.

**Qué problema resuelve.** Dejar de mandar fotos y precios uno por uno por WhatsApp e
Instagram: se manda un link y el catálogo está siempre actualizado.

**Lo que tiene:**
- Banner de portada con foto para celular y para compu, título y botón; barra de
  anuncios ("Texto Infinito", ej. "20% OFF EN EFECTIVO // ENVÍOS GRATIS").
- Horarios con indicador de abierto/cerrado, dirección, Instagram y Facebook.
- Precio tachado con descuento, "Precios por cantidad", "También te puede gustar".
- **Envío**: costo local, **envío gratis desde un monto o una cantidad** con barra de
  progreso, mensaje para envíos lejos ("Envío a convenir").
- **Código de descuento** ("¿Tenés un código de descuento?"), además de las promos
  automáticas.
- **Productos sugeridos en el carrito** y asociaciones "Productos que se compran
  juntos" que el dueño activa desde Reportes ("Comerz Intelligence").
- Compartir productos, categorías o una selección.
- Modo vidriera ("Ocultar los precios convierte el catálogo en solo vidriera"),
  mostrar u ocultar agotados, cerrar la tienda temporalmente.
- Checkout con "Retiro en el local" o "Envío a domicilio" y medio de pago.
- **Cobros online** 🟡 (Mercado Pago y transferencia con confirmación automática, ver
  5): con eso aparece **Órdenes** (`/ordenes`).

**Qué se configura** (Configuración › Catálogo Online): "Catálogo Activo", "Recibir
Pedidos por WhatsApp", "Mostrar Precios", "Mostrar Productos Sin Stock", anuncios,
horarios, redes, envíos, banner y "Dirección de tu tienda" (cambiarla rompe los links
y QR viejos).

**Ojo:** sin Cobros online, **el pedido por WhatsApp no queda guardado en Comerz**: el
comercio lo recibe en WhatsApp y lo cobra en el POS.

### 2.6 Ventas (historial, `/ventas`) 🟢

Historial con filtros ("Pagado", "Fiado", "Anulada", "Facturadas", "Sin facturar") y
búsqueda "Buscar por cliente o #ticket". Por venta: ver ticket, reimprimir,
"Devolver parte" (elegir qué vuelve, si vuelve al inventario o "Está fallada", y el
medio del reintegro, incluido "Saldo a favor"), "Anular la venta", "Corregir el
cobro", "Facturar esta venta" y completar el IMEI después.

### 2.7 Reportes (`/reportes`) 🔒 (Gestión y Empresa)

Rediseñado el 21/10/2026 con el mismo lenguaje de tarjetas y gráficos en todas las
secciones. Pestañas: **Resumen**, **Ventas** (con los **Vendedores** adentro),
**Rentabilidad**, **Inventario** (con las **Bajas** adentro), **CRM & Cobranza**,
**Finanzas**, **Exportaciones**. Con selector de período ("Últimos 7 días", "Este
mes", "Mes anterior", "Personalizado"…).
- **Rentabilidad**: estado de resultados con el **"Resultado operativo"** (antes
  "Ganancia Neta", con la aclaración de qué incluye), costo de mercadería, gastos,
  comisiones por medio de cobro (separando ventas y cuentas corrientes) y
  "Composición Financiera" (bruto, costo financiero y neto por medio de pago). Nuevo:
  **cobertura de costo**, qué parte de lo vendido tiene el costo cargado.
- **Unidades**: las piezas y lo fraccionado (kg, m) se muestran separados, ya no se
  suman juntos.
- **Inventario**: "Capital en Inventario", "Ganancia Potencial", "Stock sin
  movimiento".
- **CRM & Cobranza**: "Capital en la calle", "Antigüedad de la Deuda" (calculada desde
  la cuenta corriente real, no desde la venta), "Vencimientos de la semana", segmentos de "Calidad Comercial" ("Excelente", "Regular", "Valioso
  pero lento", "Riesgo Alto", "Poco Rentable", "Inactivo").
- **Vendedores**: "Ranking por total vendido", ticket promedio y anuladas.
- **Finanzas**: "Qué pasó con la plata": cobrado, reintegros, gastos por categoría,
  diferencias de arqueo, "Neto de caja".
- **Exportaciones** para el contador, en Excel: Libro IVA Ventas, Ventas,
  Comprobantes emitidos, Compras (remitos), Notas de crédito, Movimientos de caja y
  generales, y una hoja de **conciliación del período** (ventas, fiado, cobros de
  deuda y stock). La exportación de ventas ya no se corta en 1.000 filas. (Libro IVA
  Compras, Resumen de IVA y Notas de débito figuran como "Todavía no".)

En el menú, Reportes aparece con candado para el plan que no lo incluye.

### 2.8 Insights (panel inicial `/` y "Comerz Intelligence") 🟢

**Qué hace.** El panel saluda ("Hola, …") y muestra cuatro números del período:
"Vendiste", "Ganancia", "Ticket promedio", "Unidades vendidas", con la variación
contra el período anterior. Debajo: gráfico "Ventas del período" (ganancia y costo de
mercadería por barra, con línea del período anterior), "Top 5 categorías", "Stock
crítico", "Lo que más rinde" y **"Requiere tu atención"**.

**"Requiere tu atención"** son avisos automáticos que llevan a donde se resuelve:
"Deuda Vencida", "Mercadería sin ingresar" y "Remitos a pagar" (compras),
"Riesgo de Quiebre" (stock), "Categoría en Riesgo de Stock",
"[Medio de pago] te está costando plata" (cuando el recargo no cubre la comisión),
"Descuentos de mostrador", "Ventas sin costo cargado", "Capital Inmovilizado",
"Inventario Estancado", "Egresos Elevados", "Fuga de Capital en Bajas", "Alerta de
Rentabilidad", "Cuenta corriente sin cuadrar". Si no hay nada: "Todo en orden: no hay
nada urgente hoy."

Mientras el comercio no hizo su primera venta, el panel se reemplaza por **"Primeros
pasos"** (Prepará tus productos → Empezá a vender → Activá tu tienda online →
Completá los datos del negocio → Sumá a tu equipo).

❓ El plan lista "Comerz Intelligence (básico)" pero el código no lo restringe por plan:
hoy todos ven el panel completo.

### 2.9 Usuarios y permisos (Configuración › Empleados y Permisos) 🔒

- **Invitar a alguien** por mail ("Le llega un mail con un botón para crear su
  contraseña") o **Crear con contraseña** ("Sin mail: le cargás la clave vos y entra ya
  con su correo").
- Roles (Admin, Encargado, Vendedor…) y **Permisos por rol** en una matriz: qué puede
  ver y hacer cada uno (ver la plata, anular, devolver, elegir medio de reintegro,
  fiar sin recargo, etc.).
- Quitar a alguien: "Deja de poder entrar y se le cierran las sesiones abiertas. Sus
  ventas quedan registradas a su nombre." Cambiarle la contraseña si le robaron el
  teléfono cierra sus sesiones.
- Cada movimiento de caja y stock queda a nombre de quien lo hizo.
- Una persona puede trabajar en más de un comercio ("¿En qué negocio trabajás hoy?").
- Seguridad de las cuentas (auditoría del 22/10/2026): contraseña de **mínimo 8
  caracteres**, **límite de intentos** fallidos de ingreso (por mail y por conexión de origen),
  y recuperar la contraseña cierra las otras sesiones. El mail y la contraseña de un
  empleado los gestiona el dueño **solo** si esa cuenta se creó en el mostrador y no
  pertenece a otro comercio.

El tope de usuarios lo pone el plan; la pantalla muestra "5 de 5 usuarios" y ofrece
el plan que sube ese límite.

### 2.10 Sucursales 🔴

**No existe.** El plan Empresa lista "Múltiples sucursales", "Stock por sucursal",
"Transferencias entre sucursales" y "Dashboard consolidado", pero no hay ninguna
pantalla ni dato de sucursales en el sistema. Está en el backlog. **No promocionar.**

### 2.11 Configuración (`/configuracion`) 🟢

Secciones, agrupadas en Negocio / Ventas / Productos / Personas / Otros:
"Comercio" (datos, logo, condición de IVA), "Catálogo Online", "Caja y Turnos",
"Métodos de Pago" (recargo al cliente, comisión del procesador, acreditación y cuenta
destino), "Cobros online" 🟡, "Presupuestos" 🟡, "Ticket de Venta" (mensaje, ancho
58/80 mm, facturar por defecto, criterios fiscales), "Categorías", "Listas de
Precios", "Promociones" (por método de pago, categoría o monto mínimo; porcentaje o
monto fijo; con código o automáticas; acumulables o no), "Empleados y Permisos",
"Notificaciones" (qué avisos le llegan a cada rol), "Clientes (CRM)" y "Preferencias"
(tema claro/oscuro e instalar la app).

### 2.12 Facturación (ARCA) 🟢 ❓

- Conexión con ARCA desde Configuración › Ticket de Venta: genera el CSR, se pega en
  ARCA, se carga el certificado y se prueba la conexión; con ambiente de homologación
  para probar.
- El sistema elige solo la letra según la condición del comercio y del cliente
  (monotributo y exento: C; responsable inscripto: A a otro RI y B al resto).
- Factura con CAE al cobrar, o ticket interno y "facturar después". Anular una venta
  facturada emite la nota de crédito.
- Criterios configurables: "Cuando le vendés a un monotributista" (Factura B o A),
  "Tope a consumidor final sin DNI", cómo se declara el recargo.
- ❓ En producción hasta hoy solo se emitieron **Facturas C y Notas de crédito C**.
  Facturas A y B están programadas pero sin uso real: confirmar antes de usarlas como
  argumento.
- ARCA está en **todos** los planes (decidido el 23/10/2026).

---

## 3. Funciones que diferencian a Comerz

Las que un comerciante no espera de un sistema de caja. Todas existen.

| Función | Qué hace | Dónde está |
|---|---|---|
| Calculadora de vuelto | "¿Con cuánto billete físico paga?", botones de billetes y "Valor a devolver" | POS › cobrar en efectivo |
| Venta sin conexión | Si se corta internet, la venta se cobra igual, queda "en cola" en el celular y sube sola al volver la señal. El turno no se cierra hasta que suben. Sin señal no se puede usar saldo a favor ni vender en cuotas | POS (ícono "Ventas en cola") |
| Scoring del cliente | Puntaje de 1 a 100 con barra: "Le fiás tranquilo", "Buen pagador", "Se atrasa a veces", "Ojo con fiarle" | Clientes (columna) y Reportes › CRM & Cobranza |
| Resumen de cuenta por WhatsApp con link | Mensaje armado + página pública con lo que vence cada mes y el alias para transferir | Clientes › "Resumen" |
| Recargo por mora configurable | Monto fijo o %, sobre lo vencido o todo el saldo, una sola vez por venta; se puede perdonar | Configuración › Clientes (CRM) |
| Entrega mínima para fiar | % de anticipo obligatorio o solo advertencia; clientes exceptuados | Configuración › Clientes (CRM) / ficha del cliente |
| Vencimiento por cierre mensual | "Lo de todo el mes se paga hasta el 15 del siguiente", con filtro de a quién avisar | Configuración › Clientes / Clientes ("A abonar …") |
| Recibo de pago de cuenta corriente | Dice qué compras canceló el pago y qué queda; imprimible con firma o PDF | Clientes › cobro |
| Venta libre | Cobrar algo no cargado con la tecla V | POS |
| "Te está costando plata" | Avisa si un medio de pago cobra más comisión que el recargo que cobrás | Panel › Requiere tu atención; Configuración › Métodos de Pago |
| Por acreditar | Separa lo que vendiste con tarjeta de lo que ya está en el banco | Caja › Dinero |
| Gastos programados | Alquiler, sueldos y suscripciones con aviso de vencimiento | Caja › Dinero |
| Cierre Z imprimible | Arqueo del turno con firma y aclaración | Caja › Cierres |
| Actualización masiva reversible | Subir precios por categoría o marca, con redondeo, y deshacer después | Inventario › Actualizar precios / Historial de precios |
| Ingreso de remitos que aprende | Propone qué producto es cada línea del proveedor y recuerda la próxima | Inventario › Ingresar mercadería |
| Fotos pendientes | Lista para ir sacando las fotos que faltan con el celular | `/stock/fotos-pendientes` |
| Compartir una selección | Elegís productos y mandás un link del catálogo con solo esos | Inventario › selección › Compartir |
| Ticket por WhatsApp | El ticket (o la factura con CAE) armado como mensaje | POS › venta exitosa |
| Varios puestos, una caja 🔒 | Vendedores arman pedidos, una persona cobra | POS ("Enviar a caja") |
| Precio por cantidad | Tramos de precio por unidad según cuántas lleva | Producto › Precios por cantidad |
| Venta por peso / por importe | "Dame $2.000 de queso" | POS (productos fraccionables) |
| Envío gratis con barra de progreso | "Te falta $X para el envío gratis" en la tienda | Configuración › Catálogo Online |
| Cupones | Códigos de descuento para la tienda | Configuración › Promociones |
| "Productos que se compran juntos" | Pares reales de ventas que el dueño puede mostrar como sugerencia en el catálogo | Reportes › Comerz Intelligence |
| Alta en minutos con Google o mail | "Comenzar" crea la cuenta y el comercio en `/empezar`; quien ya tiene cuenta entra por `/ingresar`. Se puede entrar con Google. Cada comercio nuevo arranca con caja, métodos de pago, categorías de gasto y permisos ya armados | `app.comerz.app/empezar` |
| Proveedores y pago del remito | Al ingresar mercadería arma el gasto y pregunta si ya lo pagaste; lo que se debe queda por proveedor | Inventario › Ingresar mercadería / Caja |
| Cobrar la cuenta corriente con "Pagar" 🟡 | El cliente paga lo vencido desde el link del resumen con Mercado Pago y el cobro se registra solo | Resumen público de cuenta |
| "A cobrar" y envío en tanda | Lista de a quién avisar hoy y cola de WhatsApp para mandar todos los recordatorios | Clientes |
| App instalable | Se instala en el celular como app (sin tienda de apps) | Configuración › Preferencias |
| Notificaciones | Campana con avisos de stock agotado, caja abierta de otro día, órdenes y plan; configurables por rol | Barra superior / Configuración › Notificaciones |

---

## 4. Planes y límites (según la base, sin cambios de precio ni de límites al 23/10/2026)

| | **Emprendedor** | **Gestión** | **Empresa** |
|---|---|---|---|
| Precio de lista mensual | $30.000 | $50.000 | $70.000 |
| Usuarios | 1 | 5 | 99 (en la práctica, sin tope) |
| Productos | 1.000 | 5.000 | Sin límite |
| Ventas por mes (tope **blando**) 🟡 | 500 | 5.000 | Sin tope |
| Clientes con cuenta corriente | 50 | 250 | Sin límite |
| Sucursales | 1 | 1 | 10 🔴 (no existen, ver 2.10) |
| Punto de venta, caja, ventas, stock, tickets, historial | ✔ | ✔ | ✔ |
| Catálogo online | ✔ | ✔ | ✔ |
| Clientes y cuenta corriente | ✔ | ✔ | ✔ (ilimitada) |
| Reportes + exportación | — | ✔ | ✔ |
| Turno de caja por vendedor ("Múltiples cajas") | — | ✔ | ✔ |
| Roles de usuarios | — | ✔ | ✔ |
| Varios puestos, una caja | — | ✔ | ✔ |
| Facturación electrónica (ARCA) | ✔ | ✔ | ✔ |

Cómo se cuentan los límites:
- **Clientes con cuenta corriente**: "Se cuentan sólo los clientes que hoy tienen
  deuda", no todos los cargados. El cupo se ocupa al fiarle a alguien.
- **Productos**: el tope frena cargar nuevos; lo ya cargado se sigue vendiendo.
- **Ventas por mes** (decidido el 23/10/2026): cuenta las ventas del mes calendario
  argentino sin las anuladas. Es un aviso, **nunca frena una venta**: al llegar al
  tope, Perfil › Suscripción muestra "Llegaste al tope del plan" y ofrece el plan
  siguiente, y la dueña recibe el aviso en la campana. No hay aviso previo al 80%.
  Pensado para el que tiene pocos productos y
  mucho movimiento. En /admincomerz se ve en la tabla de comercios ("Ventas del mes").
  Detalle técnico y fuente de verdad: [suscripciones.md](suscripciones.md).
  Los topes ya están cargados en la base (23/10/2026).
- **Usuarios**: cuentan los miembros y las invitaciones pendientes.
- La pantalla **Perfil › Suscripción** muestra "Uso de tu plan" ("Cerca del límite",
  "Límite alcanzado") y "Todo lo que incluye tu plan".

Prueba y cobro:
- Todo comercio nuevo arranca en **prueba de 14 días** (barra "Días de prueba
  restantes"). ❓ No queda claro qué plan rige durante la prueba (el alta asigna uno);
  confirmar qué funciones ve un comercio en prueba.
- Cambiar de plan desde la app es un **pedido**: "Elegí a cuál querés pasar y te
  escribimos para coordinar el pago." No se cobra en el momento.
- Al vencer el plan **no se corta el acceso** solo; avisa ("Todavía podés usar Comerz,
  pero renovalo…"). Suspender lo decide Comerz.
- Débito automático con Mercado Pago 🟡: programado, pero depende de una credencial
  que todavía no está activa. No anunciarlo.
- Modalidad **semestral**: **20% de descuento** sobre el precio de lista, cobrado de
  una vez cada 6 meses (Emprendedor $24.000/mes, Gestión $40.000, Empresa $56.000).
  El código, el comentario del código y la base dicen lo mismo desde el 23/10/2026.
- Un comercio sin plan asignado tiene todo habilitado (es una regla de transición, no
  una oferta).

**Funciones que figuran en los planes pero no existen o no se controlan** (no
usarlas para vender un plan):
- 🔴 "Resumen semanal por mail" (Emprendedor en adelante): no hay código que lo envíe.
- 🔴 "Catálogo sin marca Comerz" (Gestión): todas las tiendas muestran "Hecho con
  Comerz" en el pie.
- 🔴 "Dominio personalizado" (Gestión): actualmente las tiendas tienen tienda.comerz.app
- 🔴 "Historial de acciones" (auditoría, Gestión): no hay una pantalla propia. Lo que
  sí hay: cada movimiento de caja y stock dice qué usuario lo hizo.
- 🔴 "Permisos avanzados", "Impresoras y lectores", "API", "Dashboard consolidado" y
  todo lo de sucursales (Empresa): no existen. (Imprimir tickets y usar lector de
  código de barras funciona en todos los planes, sin "integración" especial.)
  Lo que sí existe y no figura en ninguna lista de plan: la matriz de **permisos por
  rol** (hoy dentro de "Roles de usuarios", Gestión en adelante).

### 4.1 Propuesta de reparto de lo nuevo (a decidir, NO vigente)

Hoy el código **no restringe por plan** ninguna de las funciones nuevas: las ven todos
los comercios. Esta es una propuesta para revisar antes de tocar la base (los planes
se cambian en la tabla `planes`, `features` y `reglas`, y afectan a todos a la vez).

| Función nueva | Hoy | Propuesta |
|---|---|---|
| Proveedores, pago del remito, "Remitos a pagar" | Todos | Todos (es parte del stock) |
| Estado "Por vencer", "A cobrar", envío en tanda | Todos (dentro del tope de clientes con deuda) | Todos: el tope de 50 / 250 ya diferencia los planes |
| Recibo de cobro y resumen por WhatsApp | Todos | Todos |
| Venta en cuotas en cuenta corriente | Todos | Gestión en adelante |
| Pagar la cuenta corriente con Mercado Pago | Todos con MP conectado | Gestión en adelante |
| Cobros online en la tienda | A pedido (Comerz lo prende) | Gestión en adelante, siempre a pedido |
| Presupuestos y planes de pago propios | A pedido (en 1 comercio) | Esperar a que salga de prueba |
| Reportes rediseñados, conciliación, cobertura de costo | Gestión y Empresa | Sin cambios |
| Entrar con Google, seguridad, notificaciones | Todos | Todos (no se vende por plan) |

Para decidir antes de publicar precios:
- **Empresa ($70.000) vende hoy casi solo cosas que no existen** (sucursales, stock por
  sucursal, transferencias, dashboard consolidado, permisos avanzados, impresoras, API).
  Lo que sí da de más que Gestión es usuarios, productos, ventas por mes y cuenta
  corriente sin tope.
  Opciones: mostrarlo como "Gestión sin límites" o no ofrecerlo hasta que existan las
  sucursales.
- **Sacar de las listas** "Resumen semanal por mail" (nadie lo envía) y, si no se va a
  construir, "Historial de acciones" y "Catálogo sin marca Comerz".
- ~~Facturación (ARCA) en Emprendedor~~ y ~~semestral 15% o 20%~~: resueltos el
  23/10/2026 (ARCA en todos los planes; semestral 20%).

---

## 5. Lo que NO hace o está a medias (no promocionar)

**Detrás de un interruptor que prende Comerz comercio por comercio 🟡**
- **Cobros online en la tienda** (Mercado Pago con "Hasta 12 cuotas fijas, sin
  tarjeta", y transferencia que se confirma sola si el monto coincide). Funciona y la
  venta se registra sola al aprobarse el pago, pero tiene atajos pendientes: las
  órdenes impagas vencen recién cuando alguien las mira, los reembolsos no devuelven
  stock solos, y los productos con presentaciones, importe fijado o envío "a
  convenir" siguen por WhatsApp. Prendido en 7 de 18 comercios. Promocionar solo como
  "disponible a pedido", sin prometer que es para todos.
- **Presupuestos y planes de pago propios** (cotizar un carrito, cuotas semanales,
  quincenales o mensuales): en construcción, prendido en 1 comercio.

**Recién salido, sin prueba en producción 🟡**
- **Venta en cuotas en cuenta corriente** (19/10/2026). Esperar la confirmación de
  Comerz antes de mostrarla.
- **Pagar la cuenta corriente con Mercado Pago desde el resumen** (22/10/2026): solo
  con Mercado Pago conectado; todavía sin uso sostenido. Decirlo como "disponible a
  pedido".
- **Entrar con Google** (prendido en producción, 8 cuentas al 22/10/2026): funciona,
  pero es nuevo; no hace falta destacarlo como diferencial.

**No existe o está en el plan de trabajo 🔴**
- Sucursales / multi-depósito (ver 2.10).
- Notificación push "¡Venta realizada!" al celular y app en App Store / Google Play
  (hoy es una app web instalable).
- Que el pedido por WhatsApp quede guardado en Comerz (solo con Cobros online).
- Elegir a mano qué compras cancela un pago de cuenta corriente (hoy se cancela
  primero lo más viejo).
- Devolver en efectivo un saldo a favor (hoy es un ajuste manual).
- Libro IVA Compras, Resumen de IVA (débito/crédito) y Notas de débito.
- Facturas con varias alícuotas de IVA desglosadas.
- Balanza etiquetadora, bultos para kiosco, lotes y vencimientos (farmacia,
  alimentos).
- Pinturería con máquina tintométrica (fórmulas de color).
- Presupuestos con listas de precios y promociones (cotizan a precio base).
- Píxel de Meta / Google Analytics en la tienda, carrito abandonado, etiquetas
  "Nuevo" / "Últimas unidades".
- Asistente de compra ("qué comprar y cuánto").
- Todo lo listado en la sección 4 como 🔴.

**Dudas ❓** (preguntar antes de afirmar)
- Facturas A y B: programadas, sin uso real en producción.
- Qué plan rige durante la prueba.
- No hay un rubro "Kiosco" en el alta: un kiosco se da de alta como "Almacén y
  dietética" y funciona igual (ver 6).

---

## 6. Rubros

Al darse de alta, el comercio elige su rubro entre 17: Indumentaria y textil,
Cosmética y cuidado personal, Suplementos y nutrición, Bazar y decoración del hogar,
Electrónica y tecnología, Ferretería y materiales, Pinturería, Librería y papelería,
Juguetería, Farmacia, Gastronomía, Panadería y confitería, Almacén y dietética,
Bebidas, Mascotas, Cotillón y fiestas, Otro.

Ese rubro define una **configuración de trabajo** (se puede cambiar después en
Configuración). Lo que cambia según el rubro:

| Configuración | Rubros que caen acá | Qué distingue una variante | Columnas extra en la planilla | POS |
|---|---|---|---|---|
| Indumentaria | Indumentaria | Talle y color | Género | Con fotos. **Único rubro con "Reservado"** (apartar una prenda para una clienta) |
| Electro y tecnología | Electrónica | Color y memoria | Modelo, IMEI | Con fotos. Identidad por "Código de barras (EAN)"; IMEI por unidad; Catálogo Maestro en la carga rápida |
| Alimentos y bebidas | Almacén, Panadería, Gastronomía, Bebidas, Mascotas | Peso (500 g, 1 kg) | Marca, unidad de medida | **Modo lista, sin fotos** (entran más productos en pantalla) |
| Farmacia y perfumería | Farmacia, Cosmética, Suplementos | Presentación (50 ml, x60) | Laboratorio (en lugar de "Marca") | Sin fotos |
| Ferretería y construcción | Ferretería | Medida y material | Marca | Sin fotos |
| Pinturería | Pinturería | Capacidad y color | Marca, acabado, unidad de medida | Sin fotos |
| Cotillón y fiestas | Cotillón | Color y peso | Marca, unidad de medida | Con fotos |
| Otro rubro | Bazar, Librería, Juguetería, Otro | (nombre y código) | Código de barras | Con fotos |

Además:
- La **carga rápida** muestra las dos celdas de variante del rubro (talle/color en
  ropa, peso en almacén, medida/material en ferretería).
- Los rubros que piden marca la usan para distinguir productos ("Yerba Del Monte" vs.
  "Yerba La Merced").
- Los valores fiscales por defecto del producto salen del rubro.
- La **tienda online siempre muestra fotos**, en todos los rubros.
- La venta por peso no depende del rubro sino del producto: cualquier comercio puede
  vender algo por kilo, litro o metro.

---

## 7. Pantallas para capturar

**Comercios de muestra** (estado "demo", fuera de las métricas):
- **Tienda Demo** — indumentaria, con cobros online y ARCA configurados, ~37
  productos, 7 clientes y unas 200 ventas. Tienda: `tienda-demo.comerz.app`.
- **Kiosco Demo** — kiosco (modo lista sin fotos), ~60 productos y 17 clientes. Tienda:
  `kiosco-demo.comerz.app`. Sirve para los ángulos de kiosco y almacén.

Antes de capturar:
- ⚠️ El nombre visible de la Tienda Demo hoy es un texto de prueba ("Nombre de
  Prueba2"). Cambiarlo en Configuración › Comercio antes de sacar capturas.
- ⚠️ Revisar que los nombres de clientes de las demos sean inventados y que no quede
  ningún teléfono real a la vista.
- ⚠️ **No emitir una factura con CAE ni cobrar con Mercado Pago en la Tienda Demo**
  sin confirmar con Comerz en qué ambiente está ARCA y qué cuenta de Mercado Pago está
  conectada: podría ser un comprobante o un pago real.
- El acceso al panel de las demos lo da Comerz (no va en este documento).

| Función | Ruta / estado | Celular | Compu |
|---|---|---|---|
| Panel con números y "Requiere tu atención" | `/` con período "Mes" | ✔ | ✔ |
| Venta con talle y color | `/pos`, agregar una prenda y elegir variante | ✔ | ✔ |
| Calculadora de vuelto | `/pos` › cobrar › efectivo, tocar un billete | ✔ | |
| Pago mixto | `/pos` › "Agregar otro método" | ✔ | |
| Venta libre | `/pos`, tecla V (compu) o buscar algo inexistente | ✔ | ✔ |
| Fiado con entrega mínima | `/pos` › "C. Corriente" con un cliente | ✔ | |
| Ticket por WhatsApp | `/pos` › venta exitosa › "WhatsApp" | ✔ | |
| Modo lista de kiosco | `/pos` en Kiosco Demo | ✔ | ✔ |
| Abrir / cerrar turno | botón de caja de la barra | ✔ | |
| Dónde está la plata | `/caja` › Dinero | ✔ | ✔ |
| Cierre Z | `/caja` › Cierres › "Ver auditoría" › "Imprimir Cierre Z" | | ✔ |
| Gastos programados | `/caja` › Dinero › Gastos programados | ✔ | |
| Inventario con variantes | `/stock`, abrir un producto | ✔ | ✔ |
| Actualización masiva de precios | `/stock` › "Actualizar precios" (paso 3, revisión) | | ✔ |
| Carga rápida con lector | `/stock/carga-rapida` | | ✔ |
| Fotos pendientes | `/stock/fotos-pendientes` | ✔ | |
| Compartir una selección | `/stock` › seleccionar varios › Compartir | ✔ | |
| Clientes con estado y scoring | `/clientes`, filtro "Con deuda" | ✔ | ✔ |
| Ficha del cliente | `/clientes` › un cliente con deuda › "Debe por mes" | ✔ | |
| Resumen por WhatsApp | ficha › "Resumen" (mensaje) y el link `/r/…` abierto | ✔ | |
| Recibo de cobro | `/clientes` › cobrar › recibo | ✔ | |
| Rentabilidad | `/reportes` › Rentabilidad | | ✔ |
| CRM y cobranza | `/reportes` › CRM & Cobranza | | ✔ |
| Exportaciones | `/reportes` › Exportaciones | | ✔ |
| Reglas de fiado y mora | `/configuracion` › Clientes (CRM) | | ✔ |
| Métodos de pago con comisión | `/configuracion` › Métodos de Pago | | ✔ |
| Permisos por rol | `/configuracion` › Empleados y Permisos | | ✔ |
| Tienda: portada con banner | `tienda-demo.comerz.app` | ✔ | ✔ |
| Tienda: ficha con precio por cantidad | `tienda-demo.comerz.app/<producto>` | ✔ | |
| Tienda: carrito con envío gratis y cupón | tienda › carrito con productos | ✔ | |
| Tienda: checkout | `tienda-demo.comerz.app/checkout` | ✔ | ✔ |
| Órdenes de la tienda 🟡 | `/ordenes` | | ✔ |
| Notificaciones | campana de la barra | ✔ | |
| Primeros pasos | un comercio nuevo sin ventas | ✔ | ✔ |

---

## 8. Ideas de contenido (15)

1. **"¿Con cuánto te paga?"** — Reel del cobro en efectivo: tocás el billete y te dice
   el vuelto. *Respaldo: Calculadora de vuelto, POS.*
2. **"Se cortó internet y seguiste vendiendo"** — Historia de un sábado sin señal: la
   venta queda en cola y sube sola. *Respaldo: venta sin conexión.*
3. **"Chau cuaderno del fiado"** — Carrusel: quién debe, cuánto, desde cuándo, qué
   vence este mes. *Respaldo: Clientes, "Debe por mes", "Dinero en la Calle".*
4. **"¿Le fiás o no le fiás?"** — Explicar el scoring de 1 a 100 y las cuatro
   etiquetas ("Le fiás tranquilo"… "Ojo con fiarle"). *Respaldo: scoring de clientes.*
5. **"El resumen de cuenta que tus clientes entienden"** — Mostrar el mensaje de
   WhatsApp y la página con lo que vence cada mes y el alias. *Respaldo: Resumen por
   WhatsApp con link.*
6. **"Cómo cobrar recargo por mora sin pelearte"** — Educativo: monto fijo o %, solo
   sobre lo vencido, una vez por compra, y se puede perdonar. *Respaldo: Configuración
   › Clientes (CRM).*
7. **"Pedí una seña antes de fiar"** — Entrega mínima obligatoria o solo como aviso,
   con clientes exceptuados. *Respaldo: entrega mínima.*
8. **"Vendiste $100.000 con tarjeta, pero no tenés $100.000"** — Educativo sobre
   comisión y días de acreditación. *Respaldo: Caja › Dinero ("Por acreditar"),
   métodos de pago.*
9. **"Tu recargo con tarjeta te está haciendo perder plata"** — Si cobrás 15% y la
   comisión es 15%, perdés: Comerz te avisa. *Respaldo: aviso "te está costando
   plata", Reportes › Rentabilidad.*
10. **"Gasto, retiro o compra de mercadería: no es lo mismo"** — Por qué tu ganancia
    no baja cuando sacás plata para vos. *Respaldo: tipos de gasto en "Anotar gasto".*
11. **"El arqueo de caja en 1 minuto"** — Abrir turno, cerrar, diferencia y Cierre Z
    con firma. *Respaldo: Caja › turnos y Cierres.*
12. **"Aumentó el proveedor: actualizá 300 precios de una"** — Por categoría o marca,
    con redondeo a $100 o terminado en 90, y se puede deshacer. *Respaldo:
    Actualización Masiva e Historial de Precios.*
13. **"Tu catálogo en un link, con el stock real"** — Antes/después de mandar fotos
    por WhatsApp; compartir solo una selección. *Respaldo: tienda online y Compartir
    selección.*
14. **"Envío gratis desde $X: la barra que hace que te compren más"** — Mostrar la
    barra de progreso y un cupón en el carrito. *Respaldo: envío gratis y cupones del
    catálogo.* (No prometer que aumenta las ventas: el sistema todavía no lo mide.)
15. **"Un sistema que habla tu rubro"** — Serie por rubro: talles y colores con
    reservas en ropa; IMEI en celulares; venta por peso y modo lista en kiosco y
    almacén; medida y material en ferretería. *Respaldo: configuración por rubro
    (sección 6).*

Extras si hacen falta: "¿Qué te vendió más este mes?" (panel y Top 5 categorías);
"Varios vendedores, una sola caja" (solo Gestión/Empresa); "Cada cosa a nombre de
quien la hizo" (permisos y trazabilidad); "Instalá Comerz como app en tu celular".

**Evitar en el contenido**: sucursales, API, impresoras "integradas", resumen semanal
por mail, catálogo sin marca, notificación push de venta, app en tiendas, lotes y
vencimientos, balanza, y cualquier promesa de "vas a vender más" (los términos de uso
dicen que Comerz no garantiza resultados comerciales).
