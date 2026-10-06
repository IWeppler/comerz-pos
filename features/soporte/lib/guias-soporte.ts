export const CATEGORIAS_SOPORTE = ["Ventas", "Caja y dinero", "Inventario", "Clientes", "Configuración", "Tienda online"] as const;
export type CategoriaSoporte = (typeof CATEGORIAS_SOPORTE)[number];
export type GuiaSoporte = {
  id: string; titulo: string; descripcion: string; categoria: CategoriaSoporte;
  pasos: string[]; nota?: string;
  /** URL de un archivo de video cuando el tutorial esté disponible. */
  videoUrl: string | null;
};
export const GUIAS_SOPORTE: GuiaSoporte[] = [
  { id: "primera-venta", titulo: "Registrar y cobrar una venta", categoria: "Ventas", descripcion: "Elegí los productos, revisá el ticket y registrá el cobro.", pasos: ["Abrí tu turno de caja antes de empezar a vender.", "En el punto de venta, buscá los productos y elegí la variante y la cantidad.", "Revisá el carrito y asigná un cliente si corresponde.", "Elegí cómo se paga, verificá los importes y confirmá la venta.", "Desde el comprobante podés entregar el ticket al cliente."], nota: "Revisá el precio y el medio de pago antes de confirmar. Las opciones dependen de los permisos y la configuración del comercio.", videoUrl: null },
  { id: "devolucion", titulo: "Registrar una devolución", categoria: "Ventas", descripcion: "Devolvé parte del ticket y elegí el destino de cada producto.", pasos: ["En Ventas, buscá el ticket y abrí su menú de acciones.", "Elegí la devolución y marcá las cantidades que vuelven.", "Indicá si cada producto vuelve al inventario o está fallado.", "Elegí el motivo y, si aparece el selector, el medio de reintegro.", "Revisá el total y registrá la devolución."], nota: "El medio de reintegro determina de dónde sale la plata. Para una venta facturada puede ser necesaria una nota de crédito.", videoUrl: null },
  { id: "abrir-cerrar-caja", titulo: "Abrir y cerrar la caja", categoria: "Caja y dinero", descripcion: "Declarar el fondo inicial y comparar el efectivo al terminar.", pasos: ["Abrí un turno e ingresá el fondo inicial de efectivo.", "Registrá los cobros y los movimientos de dinero del turno.", "Al terminar, contá el efectivo físico del cajón.", "Ingresá el monto contado y revisá la diferencia con el esperado.", "Confirmá el cierre. Podés consultar el turno desde Cierres."], nota: "Un turno pendiente de otro día debe cerrarse antes de continuar con las operaciones que requieren caja.", videoUrl: null },
  { id: "auditoria-cierre", titulo: "Consultar un cierre anterior", categoria: "Caja y dinero", descripcion: "Ver el arqueo, los ingresos por método y el cierre imprimible.", pasos: ["Entrá a Caja y abrí la pestaña Cierres.", "Buscá el día y desplegá sus turnos.", "Abrí la auditoría del turno que necesitás revisar.", "Consultá el arqueo físico, los cobros digitales y los ingresos por método.", "Usá Imprimir Cierre Z si necesitás el resumen en papel."], nota: "Si hubo una corrección posterior, la auditoría distingue los importes actuales del arqueo firmado al cerrar.", videoUrl: null },
  { id: "cuentas", titulo: "Entender dónde está la plata", categoria: "Caja y dinero", descripcion: "Consultar saldos y movimientos de las cuentas del comercio.", pasos: ["En Caja, abrí Dinero para consultar las cuentas.", "Revisá el saldo de la caja y de cada cuenta digital.", "En Actividad de cuentas, usá la búsqueda y los filtros para encontrar movimientos.", "Si movés dinero entre cuentas, registrá una transferencia con su origen y destino."], nota: "Los cobros con demora de acreditación pueden quedar pendientes antes de llegar a su cuenta destino. Vendido y saldo disponible son importes distintos.", videoUrl: null },
  { id: "productos", titulo: "Cargar productos y variantes", categoria: "Inventario", descripcion: "Organizar el catálogo con precios, variantes y existencias.", pasos: ["Entrá a Inventario y abrí la creación de un producto.", "Completá su nombre, categoría y precio.", "Agregá las variantes y cargá sus existencias.", "Revisá los datos antes de guardar.", "Buscá el producto en el punto de venta para comprobar cómo aparece."], nota: "Una variante puede tener un precio propio. Si lo tiene, ese es el precio que se usa al venderla.", videoUrl: null },
  { id: "stock", titulo: "Revisar diferencias de inventario", categoria: "Inventario", descripcion: "Buscar una variante y consultar sus movimientos de stock.", pasos: ["Buscá el producto en Inventario.", "Compará el stock de la variante con el conteo físico.", "Consultá los movimientos disponibles para reconstruir lo ocurrido.", "Revisá ventas, devoluciones e ingresos de mercadería antes de corregir la cantidad.", "Si la diferencia no está clara, contactá a soporte con el producto y la variante."], videoUrl: null },
  { id: "cuenta-corriente", titulo: "Consultar y cobrar una cuenta corriente", categoria: "Clientes", descripcion: "Ver la deuda de un cliente y registrar un cobro.", pasos: ["Entrá a Clientes y buscá la ficha del cliente.", "Revisá su saldo y los movimientos de cuenta corriente.", "Abrí el cobro de deuda e ingresá el importe recibido.", "Elegí el medio por el que cobraste y confirmá.", "Revisá el saldo actualizado y entregá el recibo si corresponde."], nota: "Una venta fiada genera deuda. El cobro de esa deuda es un movimiento de dinero posterior.", videoUrl: null },
  { id: "equipo", titulo: "Configurar el equipo y sus permisos", categoria: "Configuración", descripcion: "Dar acceso al comercio y definir qué puede hacer cada persona.", pasos: ["Como administrador, entrá a Configuración desde el menú de tu perfil.", "Abrí la sección del equipo y gestioná las invitaciones.", "Asigná el rol correspondiente a cada persona.", "Revisá los permisos del rol, especialmente ventas, caja y devoluciones.", "Cada persona debe ingresar con su propia cuenta."], nota: "La configuración del equipo corresponde al administrador. Una acción que no aparece puede depender del rol, de un permiso o del plan.", videoUrl: null },
  {
    id: "datos-comercio", titulo: "Datos del comercio, logo y contacto", categoria: "Configuración",
    descripcion: "Completá la identidad comercial, los datos fiscales y el WhatsApp del negocio.",
    pasos: ["Entrá a Configuración → Comercio desde el menú de tu perfil.", "Cargá el logo y el nombre comercial; completá razón social, CUIT, condición frente al IVA e inicio de actividades.", "Revisá la dirección, provincia y localidad que figurarán en tus comprobantes.", "Ingresá el WhatsApp con código de país, sin el signo +. Es el número que usa la tienda para recibir consultas y pedidos.", "Guardá los cambios y revisá cómo aparecen los datos en el ticket y en la tienda."], videoUrl: null,
  },
  {
    id: "config-caja", titulo: "Modo de caja y restricciones de venta", categoria: "Configuración",
    descripcion: "Elegí caja única o por usuario y definí las condiciones para cobrar.",
    pasos: ["Abrí Configuración → Caja y Turnos.", "Elegí Caja Única si todas las ventas pertenecen al mismo turno, o Caja por Usuario si cada vendedor rinde su propio dinero.", "Definí si se exige un turno abierto para vender.", "Revisá Permitir Venta Sin Stock: activarlo permite vender variantes sin existencias y dejar cantidades negativas.", "Guardá los cambios y comprobá el funcionamiento con el equipo."], nota: "Multicaja depende del plan. Permitir venta sin stock en el POS es una opción distinta de mostrar productos agotados en la tienda online.", videoUrl: null,
  },
  {
    id: "cobro-centralizado", titulo: "Varios puestos, una caja", categoria: "Configuración",
    descripcion: "Los vendedores preparan pedidos y el encargado cobra desde Por cobrar.",
    pasos: ["En Configuración → Caja y Turnos, buscá Varios puestos, una caja.", "Activá la opción para que el rol Vendedor envíe tickets a la caja en lugar de cobrarlos.", "El encargado o administrador abre el pedido por su número en Por cobrar y registra el cobro.", "Revisá Empleados y Permisos si alguna persona necesita una excepción."], nota: "Esta opción cambia los permisos del rol Vendedor para cobrar y operar caja. Su disponibilidad depende del plan y se guarda al cambiar el interruptor.", videoUrl: null,
  },
  {
    id: "config-categorias", titulo: "Categorías, subcategorías y atributos", categoria: "Configuración",
    descripcion: "Organizá productos, sus atributos y las temporadas de reposición.",
    pasos: ["Abrí Configuración → Categorías y creá las categorías principales.", "Agregá subcategorías para organizar el segundo nivel y revisá a qué categoría pertenece cada una.", "Gestioná los atributos disponibles para los productos desde las opciones de la categoría.", "Elegí la temporada cuando quieras ajustar las sugerencias de reposición.", "Antes de eliminar una categoría con subcategorías, revisá el aviso que indica cuáles se eliminarán."], nota: "La temporada controla las sugerencias de reposición; no determina por sí sola la visibilidad en la tienda. Las portadas y la visibilidad pública se explican en Tienda online.", videoUrl: null,
  },
  {
    id: "listas-precios", titulo: "Listas de precios para distintos clientes", categoria: "Configuración",
    descripcion: "Configurá precios mayoristas, ajustes porcentuales o multiplicadores del costo.",
    pasos: ["Entrá a Configuración → Listas de Precios y elegí Nueva lista.", "Completá el nombre y elegí un porcentaje sobre el precio de venta o un multiplicador sobre el costo.", "Para un ajuste porcentual, indicá si el precio aumenta o disminuye y revisá el ejemplo del formulario.", "Definí si se permiten promociones encima del precio de la lista y guardá.", "Asigná la lista al cliente correspondiente y verificá los precios al seleccionarlo en una venta."], nota: "Si usás un multiplicador sobre el costo, los productos sin costo mantienen su precio habitual. Las listas de precios requieren acceso de administrador.", videoUrl: null,
  },
  {
    id: "config-promociones", titulo: "Promociones y reglas de descuento", categoria: "Configuración",
    descripcion: "Definí condiciones, rebajas, acumulación y fechas de vigencia.",
    pasos: ["Abrí Configuración → Promociones y creá una promoción.", "Elegí la condición: método de pago, categoría, monto mínimo del carrito o sin condición.", "Definí la rebaja como porcentaje o monto fijo.", "Revisá si es acumulable, su prioridad y las fechas opcionales de inicio y fin.", "Elegí si se muestra en el catálogo, guardá y comprobá una venta que cumpla la condición.", "Desde el panel podés editar, activar, desactivar o eliminar la promoción."], nota: "Una lista de precios puede impedir aplicar promociones encima. Revisá ambas reglas si el descuento no aparece.", videoUrl: null,
  },
  {
    id: "config-pagos", titulo: "Métodos de pago, recargos y comisiones", categoria: "Configuración",
    descripcion: "Definí cómo cobrás y a qué cuenta llega cada cobro digital.",
    pasos: ["Entrá a Configuración → Métodos de Pago y agregá o editá un método.", "Ingresá el nombre y elegí efectivo, transferencia, billetera virtual o tarjeta.", "Para los métodos digitales, seleccioná la cuenta destino.", "Configurá el recargo al cliente, la comisión del procesador y los días de acreditación según corresponda.", "Guardá y revisá los métodos activos que aparecen al cobrar; desactivá los que ya no utilizás."], nota: "El recargo aumenta el importe que paga el cliente. La comisión es un costo del comercio. La demora de acreditación determina cuándo el cobro llega a la cuenta destino.", videoUrl: null,
  },
  {
    id: "config-presupuestos", titulo: "Cuotas y vigencia de presupuestos", categoria: "Configuración",
    descripcion: "Prepará las opciones de financiación y la duración de tus cotizaciones.",
    pasos: ["Como administrador, abrí Configuración → Presupuestos.", "Configurá las opciones de cantidad de cuotas y el recargo porcentual de cada una.", "Elegí la frecuencia semanal, quincenal o mensual.", "Definí cuántos días tiene vigencia una cotización y guardá.", "Revisá las opciones al preparar un presupuesto."], nota: "Esta sección aparece cuando el módulo Presupuestos está habilitado.", videoUrl: null,
  },
  {
    id: "config-ticket", titulo: "Personalizar el ticket y el modo de emisión", categoria: "Configuración",
    descripcion: "Ajustá el mensaje del recibo, su formato y la forma de emitir comprobantes.",
    pasos: ["Entrá a Configuración → Ticket de Venta.", "Personalizá el mensaje del ticket y revisá las opciones de formato de impresión.", "Seleccioná el modo de operación que utiliza el comercio.", "Revisá el punto de venta y, si utilizás ARCA, la opción Facturar por defecto.", "Guardá y comprobá la impresión con el equipo que usás en el local."], nota: "Los datos de identidad y fiscales del emisor se completan en Comercio. Para conectar la facturación electrónica, consultá la guía de ARCA.", videoUrl: null,
  },
  {
    id: "config-arca", titulo: "Conexión de ARCA y criterios fiscales", categoria: "Configuración",
    descripcion: "Ubicá la conexión de facturación electrónica y sus parámetros en Ticket de Venta.",
    pasos: ["Revisá los datos fiscales del comercio antes de configurar la emisión.", "En Configuración → Ticket de Venta, seleccioná el modo ARCA y completá el punto de venta dado de alta.", "Seguí las indicaciones del panel de conexión de ARCA y verificá el estado de la conexión.", "Con tu contador, revisá el IVA de los recargos, el comprobante para clientes monotributistas y el tope de identificación de consumidor final.", "Guardá la configuración y revisá si querés iniciar las ventas con Factura o Ticket interno mediante Facturar por defecto."], nota: "Los valores fiscales dependen de tu situación y de los criterios de tu contador. La conexión y las opciones disponibles también dependen de tu acceso y del plan.", videoUrl: null,
  },
  {
    id: "config-cuenta-corriente", titulo: "Reglas de cuenta corriente y financiación", categoria: "Configuración",
    descripcion: "Definí crédito, entregas mínimas, vencimientos y recargos por mora.",
    pasos: ["Abrí Configuración → Clientes (CRM) y revisá Cuentas Corrientes Activas.", "Configurá el límite de crédito base, los plazos y las alertas disponibles.", "Definí el recargo por financiación y la entrega mínima; elegí si incumplir la entrega bloquea la venta o solo muestra una advertencia.", "Elegí vencimiento por días o cierre mensual; en el segundo caso, revisá los días de cierre y vencimiento.", "Configurá la mora: sin recargo, monto fijo o porcentaje. Para porcentaje, elegí si se calcula sobre la porción vencida o el saldo completo.", "Guardá y revisá las condiciones particulares de cada cliente."], nota: "El recargo por mora se aplica una vez al vencer el ticket, no cada día. Es diferente del recargo por financiación al vender fiado.", videoUrl: null,
  },
  {
    id: "config-resumen-whatsapp", titulo: "Personalizar el resumen de deuda por WhatsApp", categoria: "Configuración",
    descripcion: "Prepará el mensaje que usás al compartir la cuenta corriente de un cliente.",
    pasos: ["En Configuración → Clientes (CRM), buscá la plantilla del resumen por WhatsApp.", "Escribí el mensaje e insertá las variables disponibles desde el panel.", "Revisá la vista previa y corregí las variables que el formulario marque como desconocidas.", "Guardá; si dejás la plantilla vacía, se utiliza el mensaje predeterminado.", "Desde la ficha del cliente, usá la acción de resumen o WhatsApp para compartirlo."], nota: "Configurar la plantilla no envía recordatorios automáticamente. El envío se inicia desde la acción del cliente.", videoUrl: null,
  },
  {
    id: "config-preferencias", titulo: "Apariencia e instalación de la aplicación", categoria: "Configuración",
    descripcion: "Elegí el tema visual e instalá Comerz en tu dispositivo.",
    pasos: ["Entrá a Configuración → Preferencias.", "Elegí el tema claro u oscuro; en pantallas donde aparezca, podés usar el tema automático del sistema.", "En Instalar Aplicación, usá Instalar App ahora si el navegador lo ofrece.", "Si aparece Cómo instalar en este dispositivo, seguí las indicaciones correspondientes a tu navegador.", "Abrí Comerz desde la pantalla de inicio para comprobar el acceso."], videoUrl: null,
  },
  {
    id: "tienda-publicar", titulo: "Activar y compartir tu tienda online", categoria: "Tienda online",
    descripcion: "Publicá el catálogo y copiá la dirección de tu tienda.",
    pasos: ["Entrá a Configuración → Catálogo Online.", "En la dirección de la tienda, copiá el enlace o abrilo para comprobar la vista pública.", "Activá el catálogo y elegí si se muestran precios y productos sin stock.", "Guardá los cambios y compartí el enlace en tus redes o con tus clientes.", "Si cambiás la dirección, actualizá los enlaces y códigos QR que ya compartiste."], nota: "Al desactivar el catálogo, se muestra Cerrado temporalmente. Cambiar la dirección deja de funcionar en los enlaces anteriores: no hay redirección automática.", videoUrl: null,
  },
  {
    id: "tienda-productos", titulo: "Productos, categorías y portadas de la tienda", categoria: "Tienda online",
    descripcion: "Revisá qué productos se muestran y cómo se organiza la navegación.",
    pasos: ["Revisá en Inventario las imágenes, precios, variantes y existencias de los productos que vas a mostrar.", "En Configuración → Categorías, organizá las categorías y subcategorías y revisá su visibilidad en la tienda.", "Cargá las portadas de las categorías principales para la página de inicio del catálogo.", "En Catálogo Online, revisá Mostrar precios y Mostrar sin stock.", "Abrí la tienda pública y comprobá las categorías y las variantes desde un celular."], nota: "Si falta un producto, revisá sus existencias y la visibilidad de su categoría. Mostrar productos sin stock no registra reservas ni ventas.", videoUrl: null,
  },
  {
    id: "tienda-pedidos", titulo: "Recibir pedidos por WhatsApp", categoria: "Tienda online",
    descripcion: "Conocé el recorrido del carrito y cómo atender el pedido recibido.",
    pasos: ["Revisá el número de WhatsApp en Configuración → Comercio.", "En Catálogo Online, activá Pedidos por WhatsApp y guardá.", "Probá agregar productos y variantes al carrito público; el primer paso permite revisar cantidades.", "En el segundo paso, completá nombre, modalidad de entrega, los datos que solicita y el método de pago.", "Revisá el desglose y abrí el mensaje de WhatsApp para comprobar que llega al número del comercio.", "Al recibir un pedido, confirmá disponibilidad y condiciones con el cliente y registrá la venta en el POS cuando corresponda."], nota: "El carrito no cobra ni reserva stock. El pedido se coordina por WhatsApp; enviarlo no registra automáticamente una venta en el POS.", videoUrl: null,
  },
  {
    id: "tienda-envios", titulo: "Retiro y costos de envío", categoria: "Tienda online",
    descripcion: "Definí el envío local y el mensaje para otras localidades.",
    pasos: ["En Configuración → Catálogo Online, buscá Envíos.", "Completá la localidad del negocio y el costo fijo del envío local.", "Escribí el mensaje para envíos a otras localidades, donde el costo se coordina a convenir.", "Guardá y probá en el carrito el retiro y el envío a domicilio.", "Revisá el desglose con una localidad igual a la del negocio y con otra diferente."], nota: "El costo configurado se informa en el pedido; la entrega se coordina con el cliente por WhatsApp.", videoUrl: null,
  },
  {
    id: "tienda-banner", titulo: "Banner, imágenes y encuadre", categoria: "Tienda online",
    descripcion: "Personalizá la portada para celular y computadora.",
    pasos: ["En Configuración → Catálogo Online, buscá Banner Promocional y activalo.", "Subí la imagen para celular; podés agregar otra apaisada para computadora.", "Usá Encuadrar para revisar el recorte de cada pantalla, incluso si ambas usan la misma imagen.", "Completá título, subtítulo, texto del botón y enlace de destino.", "Usá el botón Guardar del banner y revisá el resultado en la tienda."], nota: "El banner tiene su propio botón de guardado. Si no cargás una imagen para computadora, se utiliza la del celular con su encuadre para pantalla grande.", videoUrl: null,
  },
  {
    id: "tienda-contacto", titulo: "Anuncios, horarios y redes sociales", categoria: "Tienda online",
    descripcion: "Mostrá la información de tu local y una barra de anuncios.",
    pasos: ["En Configuración → Catálogo Online, activá la Barra de Anuncios si querés mostrar novedades.", "Escribí los mensajes; podés separarlos con //.", "Elegí si se muestran dirección y horarios y completá el texto de atención.", "Agregá los enlaces completos de Instagram y Facebook.", "Guardá los cambios y comprobá la información en la tienda pública."], nota: "La dirección y el WhatsApp del negocio se completan en Comercio. La visibilidad y los horarios del catálogo se ajustan en Catálogo Online.", videoUrl: null,
  },
  {
    id: "tienda-promociones", titulo: "Promociones y métodos de pago en el carrito", categoria: "Tienda online",
    descripcion: "Revisá el precio que ve el cliente antes de enviar su pedido.",
    pasos: ["En Configuración → Promociones, revisá cuáles están activas y habilitadas para mostrarse en el catálogo.", "Comprobá sus condiciones, importes y fechas de vigencia.", "En Métodos de Pago, revisá los métodos activos y sus recargos.", "En la tienda, armá un carrito y elegí un método de pago en el paso de datos.", "Revisá los descuentos, recargos y envío del desglose antes de enviar el pedido por WhatsApp."], nota: "Seleccionar un método de pago informa el total del pedido; no procesa un pago online. Las comisiones internas del comercio son distintas de los recargos al cliente.", videoUrl: null,
  },
];
export const PREGUNTAS_SOPORTE = [
  { pregunta: "¿Un pedido de la tienda cobra o reserva los productos?", respuesta: "No. El carrito prepara el pedido y su desglose para enviarlo por WhatsApp. Confirmá disponibilidad y condiciones con el cliente y registrá la venta en el POS cuando corresponda." },
  { pregunta: "¿Por qué mi tienda muestra Cerrado temporalmente?", respuesta: "Revisá que el catálogo esté activo en Configuración → Catálogo Online y guardá los cambios. Después abrí la dirección pública de la tienda para comprobarlo." },
  { pregunta: "¿Por qué no se guardó el banner con los cambios del catálogo?", respuesta: "El banner tiene su propio botón Guardar. Guardá desde Banner Promocional; el botón Guardar Cambios del catálogo corresponde a las otras preferencias de la tienda." },
  { pregunta: "¿Por qué no aparece una acción o un módulo?", respuesta: "Las opciones dependen de tu rol, los permisos del comercio y el plan contratado. Pedile al administrador que revise tu acceso en Configuración. Si debería estar disponible, escribinos indicando qué acción buscás." },
  { pregunta: "¿Qué hago si me pide cerrar una caja de otro día?", respuesta: "Buscá el turno pendiente en Caja, verificá el efectivo y completá su cierre antes de seguir. Si no podés identificar el turno o el monto, consultá al administrador del comercio." },
  { pregunta: "¿Por qué lo vendido no coincide con el efectivo de la caja?", respuesta: "Lo vendido puede incluir cobros digitales y ventas fiadas. El efectivo esperado también considera el fondo inicial, los gastos, los ingresos y las transferencias del turno. Revisá la auditoría para reconstruir los movimientos." },
  { pregunta: "¿Qué hago con una venta pendiente de sincronizar?", respuesta: "Recuperá la conexión y revisá el estado de sincronización. No vuelvas a cargar la misma venta ni borres los datos de la aplicación. Si sigue pendiente, contactá a soporte con el ticket y el dispositivo donde se registró." },
  { pregunta: "¿Qué información conviene enviar a soporte?", respuesta: "Indicá el comercio, la pantalla, qué intentabas hacer y el mensaje que apareció. Sumá el número de ticket o el producto si corresponde, y una captura sin datos sensibles. Nunca envíes tu contraseña." },
];
