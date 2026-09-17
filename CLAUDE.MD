# Comerz — Contexto del proyecto

POS + catálogo público, SaaS multi-tenant. Next.js + TypeScript + Supabase.
Deploy: Vercel, branch main.

**La región importa y es la latencia más grande del sistema.** La base está en
**Ohio (`us-east-2`)**, y las funciones en `cle1` (Cleveland), que es la MISMA
región de AWS: función y base a milisegundos.

Esto estuvo mal escrito acá hasta el 22/8/2026, y el error costó caro. Este
archivo decía que la base estaba en San Pablo, y sobre esa premisa `vercel.json`
fijaba `regions: ["gru1"]` para "acercar las funciones a la base". Lo que hacía
en realidad era lo contrario: dejaba las funciones en San Pablo y la base en
Ohio, o sea que CADA consulta cruzaba el continente (~120 ms). Con ~15 consultas
por venta eran ~1.800 ms de red por ticket.

Verificado por dos caminos independientes: el dashboard de Supabase, y el IPv6
de `db.<ref>.supabase.co` (`2600:1f16:…`) contra el registro oficial de AWS,
donde `2600:1f16::/34` es us-east-2. San Pablo sería `2600:1f2e::/36`.

La medición vieja que justificaba el pin —"430-540 ms de primer byte en `/auth`
contra 110-140 ms yendo directo a Supabase"— no probaba lo que parecía: el
segundo número es una máquina argentina contra el edge de Cloudflare que
Supabase tiene adelante, no contra Postgres. Síntoma real, causa equivocada.

El middleware NO se ve afectado (runtime edge: siempre corre cerca del usuario);
lo que se mueve son los Server Components y las Server Actions, que es
exactamente donde vive el camino de la venta. Por eso `cle1` es la elección
correcta MIENTRAS la base siga en Ohio: paga un viaje largo (usuario → función)
una vez, en lugar de quince.

La configuración ideal sigue siendo base en San Pablo + funciones en `gru1`
(~125 ms por venta contra ~350 ms hoy), pero la región de un proyecto Supabase
no se puede cambiar: hay que crear uno nuevo y migrar. Está pendiente.

Regla que se desprende, y que sigue valiendo: cualquier optimización de SQL
rinde menos que un viaje de red ahorrado. Antes de indexar algo, contar los
round-trips. Y antes de razonar sobre latencia, VERIFICAR dónde está cada cosa
en vez de confiar en lo que dice un documento.
EN PRODUCCIÓN REAL: en Evens la dueña (Evelyn, admin) y 3 vendedoras (Mara,
Brisa, Zunilda) lo usan a diario. Cualquier cambio que toque ventas/caja/stock
es plata real.

## UNA base, un repo, N negocios

Multi-tenant por `negocio_id` en una sola base Supabase: la que era de Evens
es hoy la base de todo el SaaS (MCP ref `evens-project`). **No hay ninguna
otra base de la app**: si aparece un proyecto Supabase con tablas del POS que
no sea esta, es un resto viejo, no un tenant. Única excepción legítima:
`catalogo_maestro`, que vive aparte y es solo-lectura (ver más abajo).

Negocios vivos: Evens Indumentaria, Estilo Bonito, Ninja Camisetas
(indumentaria) y ClickTostado (electro).

Cómo se resuelve el tenant, sin detección por dominio en el panel:

- Toda tabla del tenant tiene `negocio_id`, con DEFAULT
  `security.current_negocio_id()`. Las policies RESTRICTIVE con
  `security.same_negocio()` son el freno real; pasar `negocio_id` explícito
  en los INSERT es defensa en profundidad, no reemplazo.
- La elección del usuario queda en la cookie `negocio_activo_id` y viaja a
  PostgREST como header `x-negocio-activo` (supabase-js habla con otro
  origen: las cookies no llegan). La cookie NO es credencial —
  `security.current_negocio_id()` valida contra `usuarios_negocios`.
- Pertenencia y rol son POR NEGOCIO (`usuarios_negocios`); `perfiles` es el
  usuario global. En el server: `negocio_actual()` y `rol_actual()`.
- Modo Dios: el super admin de Comerz impersona vía `impersonate_negocio_id`
  / `x-impersonate-negocio`, y la base solo lo honra si
  `security.is_super_admin()`.
- El catálogo público sí se resuelve por subdominio (`negocio-slug.ts`), que
  es otro camino que el del panel.

## Regla de trabajo más importante (aprendida a los golpes)

Un cambio que toca código + schema NO está terminado hasta confirmar las
3 cosas: (1) migración aplicada en Supabase prod, (2) código commiteado,
pusheado Y deploy de Vercel exitoso, (3) smoke test real en producción.
Hubo 3 incidentes por confirmar solo una pata.

Con una sola base la pata (1) es una sola aplicación, pero el precio cambió
de lado: **toda migración impacta a los 4 negocios a la vez**. Un cambio de
schema mal probado ya no rompe un comercio, los rompe a todos. Antes de
aplicar, pensar qué pasa con el negocio que tiene 994 productos y con el que
tiene 11.

## Arquitectura y decisiones clave

- `producto_variantes` es la fuente canónica (atributos JSONB + relación
  producto_variante_valores). `productos_stock` es espejo legacy: se
  mantiene sincronizado en cada escritura, NUNCA se normaliza su texto.
- Stock se descuenta con UPDATE atómico condicional vía RPC
  `ajustar_stock_variante` (por variante_id, nunca por nombre).
- La venta se ESCRIBE en una transacción: cabecera + pagos + renglones +
  descuento + deuda de CC + espejo legacy de stock + reservas van juntos en la
  RPC `registrar_venta` (`20260816120000`). Antes eran seis escrituras sueltas
  y el insert de pagos devolvía error SIN revertir nada: quedaba una venta
  CONFIRMADA sin un solo pago, con el stock ya descontado. El de `ventas_items`
  ni se chequeaba. Quedan AFUERA a propósito el descuento de stock y las
  unidades serializadas: ya son atómicos y fallan por otro motivo (no hay
  mercadería, que es una respuesta al usuario, no una rotura). Si la RPC falla,
  create-sale revierte esos dos y no queda ningún punto intermedio.
  SECURITY INVOKER, no DEFINER: el aislamiento tiene que seguir siendo la RLS
  del que llama. Verificado que un usuario apuntando a un negocio ajeno no
  escribe nada.
  **Y al revés: toda función SECURITY DEFINER tiene que filtrar `negocio_id`
  en CADA consulta, a mano.** DEFINER apaga la RLS, así que validar el negocio
  del padre no alcanza — las tablas hijas hay que filtrarlas una por una.
  `registrar_devolucion` validaba la venta y después consultaba `venta_pagos`,
  `ventas_items` y `clientes` solo por id, y eso era explotable: hasta
  `20260905140000` cualquiera podía dejar filas colgando de una venta ajena
  (todas las hijas de `ventas` tenían `INSERT ... with check (true)`). Un cobro
  fantasma dejaba la venta sin poder devolverse para siempre, y si la venta no
  tenía cobros la devolución salía con el método del atacante. Corregido en
  `20260905160000`, con las 6 consultas filtradas y un guard que cuenta los
  filtros en el cuerpo.
  **Las cuatro hijas de `ventas` ya atan el INSERT al padre**: `venta_pagos`
  (`20260905140000`) y `ventas_items` + `devoluciones` + `devoluciones_items`
  (`20260905180000`). El predicado no compara `negocio_id` a mano: pide que el
  padre sea VISIBLE (`exists (select 1 from ventas v where v.id = venta_id)`),
  y de eso ya se encarga la RLS de `ventas`. Cualquier tabla hija nueva copia
  esa forma.
- Anular también corre en una transacción (`anular_venta`, `20260816150000`),
  con el mismo corte: estado + cobros + egreso + crédito de CC adentro; stock y
  unidades serializadas afuera (son compensaciones y no pueden voltear una
  anulación ya hecha). Arregla dos cosas que movían plata mal:
  1. El egreso de caja sale SOLO por la porción cobrada en EFECTIVO. Antes
     salía por `monto_cobrado` entero: una venta con débito sacaba plata de un
     cajón donde nunca estuvo, y el turno cerraba con faltante. No es raro —
     43% de los cobros de venta no son efectivo. Lo cobrado por otros medios
     vuelve como aviso: se devuelve por donde entró.
  2. El crédito de cuenta corriente es `least(deuda de la venta, saldo actual)`,
     no `ventas.monto_pendiente`, que quedó CONGELADO en el momento de la venta
     — los pagos de CC bajan `clientes.saldo_pendiente` y nunca esa columna.
     Anular un fiado a medio pagar le perdonaba al cliente lo ya pagado, y el
     `max(0, ...)` tapaba que el libro y el saldo decían cosas distintas.
     Lo que el cliente YA pagó no se devuelve solo y es a propósito: los pagos
     de CC no están imputados a una venta, así que la base no sabe cuánto era
     de ese ticket ni con qué medio se cobró. Vuelve como aviso para resolverlo
     a mano en vez de mover plata por una suposición.
- `ventas_items.variante_id` (`20260816130000`): sin él la anulación tenía que
  buscar la variante por `nombre_display` para devolver el stock, contra la
  regla de mover stock por id. 117 de 1.032 renglones ya no matcheaban por
  nombre (talles renombrados), o sea que anular esas ventas devolvía el stock a
  ningún lado, sin error. Sin FK: el historial sobrevive a que la variante se
  borre. El match por nombre queda de respaldo para los que el backfill no pudo
  resolver.
- `movimientos_stock` (`20260823182514`): la historia del NIVEL de stock por
  variante. `producto_variantes.stock` es un escalar que se pisa, así que la
  base sabía cuánto hay AHORA y nada más — "esta variante estuvo en cero del 3
  al 11" no se podía reconstruir, y un quiebre no deja registro por definición
  (la venta que no se hizo no existe en ninguna tabla). Por eso entra ANTES que
  cualquier señal que la use: cada día sin la tabla es historia que no vuelve.
  La escribe un TRIGGER sobre `producto_variantes`, no una llamada dentro de
  cada RPC, y la diferencia es el punto: un camino que se olvida de registrar
  es un agujero que se descubre meses después con los números ya mal. Con
  trigger no hay camino que lo saltee — ni el UPDATE en batch de
  `aprobar_orden_compra`, ni un ajuste a mano, ni el código que todavía no
  existe. Además `stock_anterior` / `stock_nuevo` salen del propio UPDATE: son
  exactos con dos cajas vendiendo la misma variante a la vez.
  El PORQUÉ no lo puede adivinar el trigger: viaja en `comerz.origen_movimiento`
  (transaction-local, `is_local => true` — con `false` una venta le pondría
  origen VENTA al remito que se apruebe después en la misma conexión del pool).
  Sin declarar queda DESCONOCIDO, que es la verdad, no 'AJUSTE', que sería una
  suposición disfrazada de dato. Append-only por RLS: hay policy de SELECT e
  INSERT y NO de UPDATE ni DELETE, mismo criterio que `comprobantes`. Sin FK a
  la variante: el historial tiene que sobrevivir a que la variante desaparezca,
  que es uno de los movimientos que registra.
  `ajustar_stock_variante` toma `p_origen` / `p_referencia_id` porque la venta,
  la anulación y Carga Rápida lo llaman suelto desde Node y `set_config` no
  cruza transacciones. Ojo con esa función: pasó de `language sql` a plpgsql, y
  sus OUT params `id`/`stock` SOMBREAN las columnas — sin
  `#variable_conflict use_column`, `set stock = stock + p_delta` es "column
  reference is ambiguous" y la venta se cae entera. Pasó al aplicar.
  `aprobar_orden_compra` y `guardar_variantes_producto` quedaron detrás de
  wrappers (`_impl` es la original renombrada): declaran el origen sin que haya
  que reescribir 6.000 caracteres de lógica probada.
  El caso especial es el guardado de variantes, que BORRA todas las variantes
  del producto y las reinserta en cada guardado: con el trigger suelto,
  corregir un precio de un producto con 9 talles escribiría 18 movimientos y 9
  ceros intermedios que nunca pasaron en el local — y esos ceros falsos
  arruinarían justo la cuenta de quiebres que motiva la tabla. Por eso el
  wrapper apaga el trigger (`comerz.omitir_movimiento`) y registra el
  movimiento NETO comparando antes contra después por `atributos_comparables`.
  Verificado: guardar sin tocar stock no escribe ninguna fila.
  `FOTO_INICIAL` (5.129 filas, 23/8/2026) es el punto de partida, con delta y
  stock_anterior en NULL porque no hubo movimiento. La historia hacia atrás NO
  es reconstruible —el nivel pasado no está guardado en ningún lado— pero sí se
  puede fechar el arranque: sin la foto, una variante hoy en cero que no se
  mueva más no tendría una sola fila.
  Lo que NO cubre: `importar_productos_planilla` (hoy sin punto de entrada) no
  declara origen, así que escribiría DESCONOCIDO. Y el origen BAJA no lo emite
  nadie: `bajas` está VACÍA en los 4 negocios y `createBajaAction` inserta
  siempre en estado PENDIENTE, sin ningún camino que apruebe ni descuente —
  `get-movimientos-stock.ts` lee bajas con `estado = 'APROBADA'` que nada crea.
  **Borrar un producto también mueve stock, y desde `20260909150000` lo dice**
  (origen `BAJA_PRODUCTO`). El DELETE cascadea a las variantes y el trigger ya
  lo registraba, pero sin origen: quedaba DESCONOCIDO. Como el origen es
  transaction-local, no alcanza con declararlo desde Node — por eso el borrado
  pasa por `eliminar_productos(uuid[])`, que lo declara y borra en la misma
  transacción. SECURITY INVOKER a propósito: quién puede borrar lo sigue
  decidiendo la RLS (`stock.eliminar_producto`), y una DEFINER ahí sería una
  puerta de atrás a ese permiso. Devuelve el conteo de filas borradas porque un
  DELETE filtrado por RLS vuelve con 0 filas y `error: null` — el mismo éxito
  silencioso que costó 35 fotos el 5/9.
  `BAJA_PRODUCTO` es un origen APARTE de `BAJA`: ese es el de la tabla `bajas`
  (merma, rotura), y meter las dos en el mismo cajón deja "¿cuánta mercadería
  se perdió?" sin respuesta.
  Por qué importaba: `ordenes_items.producto_id` es ON DELETE SET NULL, así que
  borrar un producto blanquea las líneas de remito que lo alimentaron. Eran 109
  líneas en la base, y sin origen no se podía distinguir —salvo abriendo
  movimientos_stock a mano— entre "esta mercadería nunca entró" y "entró y
  después alguien borró el producto". Las dos lecturas llevan a acciones
  opuestas. Ojo que `movimientos_stock` todavía no se muestra en ninguna
  pantalla: `get-movimientos-stock.ts` reconstruye el historial desde
  `ordenes_compra`, `ventas` y `bajas`, y nunca lee la tabla.
- El espejo legacy `productos_stock` se mueve con `ajustar_stock_legacy`
  (delta en un statement), nunca leyendo y escribiendo después.
- Dos columnas de `ventas` que se leyeron mal durante mucho tiempo:
  `cantidad` es UNIDADES (suma de `ventas_items.cantidad`), no renglones —
  guardaba `items.length`, así que 3 remeras en una línea contaban 1, y el
  gráfico del panel, la tarjeta de rendimiento y la columna "Unidades" de la
  exportación al contador venían subcontando. Corregido y backfilleado en
  `20260816170000`.
  `precio_costo` es el costo TOTAL de la venta (cada renglón ya entra
  multiplicado por su cantidad), NO unitario. crm-tab.tsx y
  scoring-desde-cliente.ts lo multiplicaban otra vez por `cantidad`: sobre las
  226 ventas de más de un renglón daba $25.386.500 de costo contra $6.323.000
  real, hundiendo el margen justo de los clientes que más compran. Las dos
  columnas tienen COMMENT en la base para que no vuelva a pasar.
- Precios se revalidan server-side en create-sale.ts (nunca confiar en
  el precio que manda el cliente). Mismo criterio para todo lo que toque
  plata: validación espejo en el server siempre.
  **La única excepción declarada es la VENTA LIBRE** (`20260917120000`):
  un renglón que no es ningún producto (`ventas_items.producto_id` y
  `variante_id` null, descripción tipeada en `variante`, marca
  `es_venta_libre = true`). Nació para el cotillón —"12 globos sueltos" que
  nadie va a dar de alta con la clienta esperando— y el precio lo pone la
  vendedora porque no hay contra qué revalidarlo; lo que se valida es la
  forma (`features/pos/lib/venta-libre.ts`, compartida por POS y server) y
  un CHECK en la base impide que un renglón marcado libre apunte a un
  producto: no sirve para cobrar mercadería real a otro precio. No mueve
  stock, costo cero (margen = precio, y `margen_realizado` lo cuenta como
  "sin costo", que es la verdad), no entra en promos por categoría ni en
  listas de precios. Se descartó el producto oculto "Venta libre" por negocio
  porque `productos` la leen 54 consultas (fotos pendientes, plan, búsqueda,
  remitos) y todas tendrían que aprender a esconderlo; un renglón sin
  producto ya es un estado que todo el sistema maneja. La marca es columna y
  NO heurística: hay 15 renglones históricos con producto y variante null que
  son productos BORRADOS. Todo lo que nombra un renglón pasa por
  `features/sales/lib/nombre-renglon.ts`. Entradas: la tecla V, el botón al pie del
  ticket, y "Vender 'X' sin cargarlo" en la grilla cuando la búsqueda no
  encuentra nada (`useVentaLibreStore`).
- RBAC: roles ADMIN/ENCARGADO/VENDEDOR + tabla permisos + función
  `tiene_permiso(clave)` (generaliza `is_admin()`, que sigue vigente).
  perfiles.rol (texto legacy) se mantiene sincronizado — ENCARGADO se
  mapea a 'VENDEDOR' en el texto hasta terminar el cableado.
- Multicaja POR_USUARIO: cada vendedor ve/cierra SOLO su turno
  (matching estricto vendedor_id === userId). Admin ve todas. Turno
  cerrado es inmutable para todos.
- Ediciones de producto: TODO el ciclo de variantes (chequeo + delete +
  reinsert + auditoría) corre en la RPC transaccional
  `guardar_variantes_producto`. Freno: si el payload trae menos
  variantes de las que existen, se rechaza el guardado.
- Auditoría: `actualizaciones_precio_items` (precios, con variante_id) y
  `producto_variantes_auditoria` (snapshots por guardado, acción
  CREADA/ACTUALIZADA/ELIMINADA/BLOQUEADO_FALTANTE, SIN FK dura — debe
  sobrevivir a la desaparición del original).
- Catálogo público: RLS de SELECT para anon en producto_variantes y
  promociones ya aplicadas (fueron la causa de bugs silenciosos).
- Promociones: condición (tipo_regla, puede ser null=sin condición) y
  visibilidad (mostrar_en_catalogo) son ejes INDEPENDIENTES. Fail-closed:
  tipo_regla desconocido = NO elegible.
- Normalización de atributos: siempre vía normalizarAtributoKeyValor /
  canonicalizarValores (slugify compartido) — en creación manual Y en
  conciliación de remitos (merge-purchase.ts).
- **El GÉNERO no es un atributo de variante, es la categoría de arriba.** En
  indumentaria el género dice a QUIÉN está destinada la prenda, y eso acá es
  el padre del árbol (HOMBRE › ZAPATILLAS). Viaja como `raw_genero` hasta
  `resolverCategoriaImport`, que cruza género (padre) con tipo de prenda
  (hijo). ÚNICA excepción: Ropa Bebé, donde Bebé/Beba sí es un eje real (la
  misma remera talle 3 en las dos versiones) — es lo que declara la propia
  base, con la única fila de `categoria_atributos` que apunta a Género.
  Los datos de julio son anteriores a la regla y quedaron con la clave puesta:
  `20260904160000` la sacó de 2.238 variantes (Evens pasó de 1.720 a 9).
  Por qué importaba y no era prolijidad: quedó A MEDIAS —332 de 605 productos
  de MUJER en Evens, 11 de 146 en NENA— y `build-propiedades-filtro.ts` pone
  Género PRIMERO en la barra de filtros, así que lo primero que ofrecía la
  pantalla era el filtro que escondía la mitad del catálogo sin decirlo.
  Además `product-detail.tsx` arma un selector por cada clave y exige
  elegirlas todas: en 661 productos la clienta tenía que elegir "Género:
  Mujer" —un desplegable de una sola opción— y en el resto no.
  Dos cosas que dejó la limpieza:
  * **Comparar identidad de variantes va por `atributos_comparables`**, la
    misma función del índice único `idx_variante_identidad`. Comparar el JSONB
    crudo deja pasar "Marron" contra "MARRON": la primera corrida se cayó con
    23505 a mitad del UPDATE por eso.
  * Quedaron 9 variantes con Género (7 en Evens, 2 en Estilo Bonito) porque
    sacárselo las volvía indistinguibles de otra variante del mismo producto:
    duplicados reales de carga, y fusionarlos es decidir qué pasa con dos
    stocks, que es del comercio y no de una migración. Las resolvió Evelyn y
    las ejecutó `20260904170000`: PANTALON PELUCHE se PARTIÓ en dos productos
    (adentro convivían la prenda de hombre y dos pantalones de mujer, que
    pasaron a MUJER › ROPA DEPORTIVA), JEANS COQUETTAS se unificó por talle, y
    las dos de Estilo Bonito se fusionaron. Hoy no queda ninguna fuera de Ropa
    Bebé.
    De ahí sale la regla para el próximo merge de variantes: **reapuntar
    `ventas_items.variante_id` ANTES de borrar**. No tiene FK (el historial
    tiene que sobrevivir a que la variante desaparezca), así que el DELETE no
    avisa: deja el renglón apuntando a la nada y la anulación vuelve a
    depender del match por nombre, que es justo lo que `20260816130000` vino a
    sacar del medio. Y el movimiento de stock se registra con origen
    EDICION_VARIANTES en vez de apagar el trigger: el nivel cambió de verdad,
    y el +1 de la que queda contra el -1 de la que se borra cuentan la
    historia completa.
  Las formas en que puede venir la columna viven en
  `shared/lib/alias-columna-genero.ts` y las comparten los DOS importadores.
  Estaban duplicadas: la planilla propia reconocía seis y el remito de
  proveedor solo dos, así que una columna "SEXO" entraba por el remito al
  `else` de atributos libres y volvía a pegar el género en cada variante.
- Aprobación de remitos: TODO (precios + stock + alias + estado) corre en la
  RPC `aprobar_orden_compra`, en una transacción y en batch (antes era un for
  con await adentro: ~1500 round-trips en el remito más grande). El guard de
  idempotencia (`update ... where estado <> 'APROBADA'` + `if not found`) va
  PRIMERO, antes de escribir stock: toma el row lock que serializa dos
  aprobaciones concurrentes y devuelve `{ya_aprobada: true}` como resultado
  normal, no como excepción. La canonicalización de atributos se queda en
  Node a propósito; la RPC recibe `atributos` ya canonicalizado.
- **Un producto tiene DOS precios y en la venta gana la variante.**
  `productos.precio` es el de cabecera —lo que muestra /stock— y
  `producto_variantes.precio` es el de cada variante; `precioBaseDeVariante`
  resuelve `variante.precio ?? producto.precio`, y lo mismo hace el catálogo
  público. Cuando difieren, /stock miente y nadie se entera hasta el
  mostrador.
  Lo producía el remito: `aprobar_orden_compra_impl` escribía la cabecera pero
  sobre una variante que YA existe solo hacía `stock = stock + cantidad`, así
  que aprobar cambiaba el precio que se MUESTRA y no el que se COBRA. (La
  actualización masiva de `update-prices.ts` sí escribe los dos, por eso la
  divergencia venía siempre del mismo lado.) Lo reportó Evelyn el 8/9/2026
  sobre "Pantalon sastrero HHP": $52.000 en el listado, $20.000 en la caja.
  Quedaron 16 productos en Evens, 12 en Estilo Bonito y 2 en Kiosco Demo.
  Desde `20260908190000` la RPC baja el precio nuevo a la variante cuyo precio
  propio **era una copia del vigente** —eso no es un precio especial, es el
  mismo número guardado dos veces— y respeta a la que decía otra cosa, pero la
  CUENTA y devuelve `variantes_conservadas` para que la pantalla lo avise. La
  comparación va contra el precio EFECTIVO viejo, no contra el de cabecera:
  contra la cabecera, los 30 ya desalineados no matchearían nunca y se
  quedarían así para siempre.
  Ese "precio efectivo" es la vista `productos_precio_efectivo`
  (`20260908180000`), que la conciliación lee en lugar de `productos`: hasta
  entonces calculaba el markup anterior con la cabecera, o sea que
  "conservaba" un margen sacado de un precio que nadie cobra. Solo hay precio
  efectivo cuando TODAS las variantes tienen el suyo y todas dicen lo mismo;
  si no, `precios_dispares` y se muestra el aviso. **No se promedia ni se
  toma el mínimo**: inventar un precio que nadie fijó es el mismo error al
  revés. Y dispar no siempre es bug — "Maní con Sal" de Kiosco Demo a $1.800 /
  $3.900 / $7.200 son pesos distintos, y por eso los 30 no los arregla una
  migración.
- **La fábrica de ese desacople era la actualización masiva de precios**, y se
  apagó en `20260908200000` + `update-prices.ts`. `aplicarPreciosAction`
  escribía el producto y después COPIABA el precio a TODAS sus variantes,
  convirtiendo herederas (`precio` null = "seguime al producto") en copias con
  el número encima. Medido: Estilo Bonito corrió 5 lotes en julio (3.605 filas
  de variante) y tenía 1.142 copias sobre 1.514 variantes, el 75%; Evens corrió
  5 pero anteriores a que esa función escribiera variantes y tenía 108; Ninja
  Camisetas y ClickTostado, que nunca corrieron uno, tenían CERO en 687. Los
  tres caminos de alta/edición y el remito ya escribían null cuando el precio
  coincide con el del padre: la fuga era una sola.
  Ahora el ajuste masivo toca solo las variantes con valor PROPIO, y columna
  por columna (una variante puede tener precio propio y costo heredado).
  La normalización nuleó las 1.252 copias y **no cambió un solo precio** — la
  migración lo prueba, no lo promete: guarda el precio efectivo de las 5.926
  variantes antes de tocar nada y aborta si alguno difiere después. Quedaron
  **5.835 heredando y 69 con precio propio real en todo el SaaS, el 1,2%**. Ese
  es el tamaño verdadero de la feature "precio por variante", y no se toca:
  incluye casos legítimos como el Maní con Sal por peso.
  Efecto medible: los productos con problema pasaron de 30 a 22, y los que de
  verdad muestran un precio y cobran otro, a 8.
  **La regla que queda: null es un valor con significado.** Si una variante
  hereda, se deja heredar — escribirle el mismo número "por las dudas" no es
  redundancia inofensiva, es fabricar una copia que se va a desincronizar. Por
  eso `actualizaciones_precio_items` pasó a aceptar null (`20260908210000`):
  con las columnas NOT NULL, "heredaba" y "valía cero" se guardaban igual, y
  deshacer un ajuste sobre una variante que heredaba le escribía 0 — que
  `variante.precio ?? producto.precio` devuelve tal cual, dejando el producto a
  $0 sin que nadie toque un precio.
  Y por eso también se sacó el fallback de `revertirPreciosAction` ("si el
  producto no tiene fila de variante, revertí todas"): volvía a fabricar
  copias, y encima cambiaba variantes que la pantalla de confirmación no
  mostraba, porque la preview lista solo las filas del lote.
- **/stock muestra el precio de las VARIANTES, no el de la cabecera**
  (`features/stock/lib/precio-efectivo-producto.ts`, con tests). La tabla ya
  calculaba un rango cuando las variantes NO eran uniformes, pero cuando
  coincidían entre sí caía a `producto.precio` — y ese era justo el caso de
  HHP: las 7 en $20.000, la cabecera en $52.000. **Uniforme no quiere decir
  igual al producto.** Con una sola variante fallaba por otro lado: el rango
  pedía más de una. Es la contraparte en TS de la vista
  `productos_precio_efectivo` y las dos tienen que decir lo mismo.
  El badge "precio por variante" sale SOLO cuando se muestra un número y ese
  número no es el de la cabecera (8 productos hoy): con rango no hace falta,
  porque dos extremos ya dicen que no hay un precio único. El mensaje de
  compartir por WhatsApp también usa el efectivo — mandarle a una clienta un
  precio que la caja no va a cobrar es peor que mostrarlo mal en una tabla.
  Y el campo "Precio Venta" de la ficha avisa, pegado al input, cuáles
  variantes tienen el suyo y no se van a enterar. El aviso sale del estado VIVO
  de la grilla, no de la base: si le borran el precio a una variante,
  desaparece en el acto, porque a partir de ahí sí hereda.
  Al lado del aviso está **"Usar este precio en todas"**
  (`precio-en-todas-las-variantes.ts`, con tests), que es la acción que la
  dueña quería y no existía — antes había que ir fila por fila en la tabla de
  variantes, que es justo donde no mira. **VACÍA el precio propio, no lo
  copia**, y esa es toda la regla: copiarlo se vería idéntico el mismo día y
  volvería a fabricar el desacople en el próximo cambio de precio. No toca la
  base hasta guardar y tiene Deshacer con el snapshot previo, tomado ANTES de
  vaciar y FUERA del updater de setState — adentro se lee tarde, y en
  StrictMode corre dos veces.
- **Un cambio de precio hecho por un remito no dejaba NINGÚN rastro.**
  `actualizaciones_precio(_items)` la escribía solo la actualización masiva, y
  `productos.updated_at` lo pisa cualquier guardado posterior: al auditar el
  caso de Evelyn no se pudo fechar cuándo había cambiado el precio. Plata que
  se mueve sin registro. Desde `20260908190000` el remito abre su propio lote
  (`tipo_operacion = 'REMITO'`), PEREZOSO —un remito que no mueve precios no
  ensucia el historial— con una fila por producto y una por variante alineada.
  Va en el formato que ya existía a propósito: así "Deshacer" del historial de
  precios funciona sobre un remito sin una línea más (devuelve los precios, no
  la mercadería). Ojo con el fallback legacy de `revertirPreciosAction` —"si el
  producto no tiene fila de variante, revertí todas"—: sobre un lote REMITO le
  pisaría a las variantes su precio especial, porque ahí la ausencia de fila
  significa "no la moví", no "no la registré". Queda apagado para REMITO.
- Métodos de pago, dos porcentajes que NO son lo mismo: `comision` es lo que
  el comercio le paga al procesador (se resta, interno) y `recargo_porcentaje`
  es lo que le cobra al cliente (se suma, se muestra). El cálculo vive en
  `shared/lib/recargo-metodo.ts` y lo comparten POS y server; el server SIEMPRE
  recalcula desde la base. Invariante: `venta_pagos.monto_bruto = monto_base +
  recargo_monto`, donde la base es lo que imputa al ticket o a la deuda — la
  deuda de cuenta corriente baja por base, nunca por bruto. El recargo se
  aplica por método sobre SU porción del pago (mixto), se redondea al peso, y
  queda congelado en la fila del pago. La comisión se calcula sobre el bruto
  (es lo que pasa por el posnet). anon lee `recargo_porcentaje` para el
  catálogo público vía policy + GRANT por columna: `comision` NO se expone.
- **La unidad de deuda es el TICKET CON SU RECARGO ADENTRO, y los pagos se
  imputan FIFO sobre esas unidades** (`20260909190000`). Cuando una clienta
  paga, paga su compra más vieja COMPLETA, con el recargo que esa compra
  generó incluido; recién ahí esa deuda queda saldada, el recargo se va con
  ella y el vencimiento pasa a la compra siguiente.
  El vínculo lo da `cuenta_corriente_movimientos.debito_origen_id`
  (`20260909180000`), porque el recargo se guarda como un DEBITO propio y hasta
  entonces no apuntaba a ninguna compra.
  Tres consecuencias que no son obvias y que hay que tener presentes antes de
  tocar esto:
  * Un ticket con recargo impago **sigue vivo y viejo** aunque su capital esté
    pagado. Por eso NO hace falta ninguna regla extra de "mora viva = vencida":
    la unidad se sostiene sola. (Hubo una versión intermedia con esa regla; se
    tiró al reemplazarla por la unidad.)
  * Un pago parcial no salda nada ni corre ninguna fecha. Sobre un ticket de
    $13.000 ($10.000 de compra + $3.000 de recargo), pagar $12.999 lo deja vivo
    con su fecha original.
  * Un recargo que entra DESPUÉS de que el capital se pagó **revive** ese
    ticket, con su fecha vieja. No está saldado hasta que se pague todo.
  El recargo huérfano (`debito_origen_id` null) es el único caso con regla
  aparte: devuelve su propia fecha SIN sumarle el plazo, porque ese día la
  cuenta ya estaba vencida. Hoy son cero y los nuevos nacen con el vínculo
  declarado, pero la puerta queda cerrada.
  **ESTO REEMPLAZA la regla del ciclo de deuda de `20260905190000`** —"el
  vencimiento lo fija el débito más viejo posterior al último saldo cero"— sin
  deshacer lo que esa regla vino a arreglar. El ancla por ciclo tenía un
  agujero propio: como el saldo de una clienta que compra seguido nunca toca
  cero, el ancla quedaba clavada en el primer fiado de su vida para siempre.
  Lo destapó Angi Levis (Estilo Bonito, 9/9/2026): debía $50.000 del 17/08 y
  $122.000 del 05/09, pagó $109.500 entre el 05 y el 07 —o sea saldó la compra
  de agosto entera y antes de su vencimiento— y el sistema le seguía mostrando
  el 17/09 en vez del 06/10.
  Al aplicarlo, **8 clientas cambiaron de fecha y 5 pasaron de vencidas a al
  día** ($191.556): Magui araya, CELESTE SCHOFER, IVANA JEREZ, MICAELA ACOSTA y
  Remisería La Estrella. Ninguna entró en mora. Confirmado con la dueña,
  incluido el caso de CELESTE, que sale por $26,25 de recargo ya saldado dentro
  de su ticket viejo.
  **Vero duarte —el caso que fijó el criterio del 5/9— sigue vencida** (08/09),
  y ese es el control que hay que repetir si alguien vuelve a tocar la regla:
  un pago parcial no puede sacarla de mora. Lo mismo MIRTA GARCIA, cuya deuda
  viva desde febrero fue el peor caso del cambio anterior (176 días de mora
  escondida).
  El saldo reconcilia al peso con `clientes.saldo_pendiente` en las 8: la
  imputación cambia QUÉ está vivo, nunca CUÁNTO se debe.
  El espejo en TypeScript es `features/clients/lib/imputar-pagos-fifo.ts`
  (41 tests, con las cuentas reales de Angi y de Vero) y los dos tienen que
  decir lo mismo, mismo criterio que `temporada-categoria.ts` contra
  `categoria_en_temporada`.
- **La base del recargo por mora es el SALDO COMPLETO, no la porción vencida**
  (5/9/2026). Es una cláusula de aceleración —si se atrasó, toda la cuenta entra
  en mora— y **revierte a propósito** el arreglo del 30/8, que había hecho lo
  contrario. Hay que saber lo que cuesta antes de volver a tocarlo: sobre
  CELESTE SCHOFER (Evens, $104.825 de saldo con $175 vencidos) son **$15.723,75
  de mora contra $26,25**. Está aceptado a sabiendas por la dueña; el test de
  `calcular-saldo-con-recargo.test.ts` conserva justo esos números para que la
  próxima persona vea el precio de la decisión y no la "corrija" de vuelta.
  `montoVencido` se sigue calculando y devolviendo —lo usan la antigüedad y el
  Advisor— pero ya no manda en el cobro.
  Consecuencia que hay que tener presente: `estaVencido` dejó de exigir
  `montoVencido > 0`. Con la imputación por unidad, una clienta puede estar en
  mora con el FIFO por renglón diciendo cero, y tiene que cobrar igual. El
  único caso que apaga el recargo es saldo cero.
  **PERO capital: el saldo completo NO incluye los recargos anteriores**
  (`20260909170000`). Cuando el recargo pasó a materializarse como un DEBITO
  propio, entró al saldo — y como la base es el saldo entero, el segundo
  recargo de una clienta se habría calculado sobre uno que ya contenía al
  primero. Interés compuesto, contra lo que promete la pantalla de
  Configuración > Clientes con todas las letras ("se suma una única vez ... no
  se acumula día a día"). No llegó a pasar —los 39 recargos del SaaS son todos
  primeros— pero alcanzaba con que una pagara parcial y se volviera a atrasar.
  La base es `monto_pendiente - mora_previa`, y `mora_previa` sale de
  `mora_viva` en `deuda_cc_vencida`. Lo que se evitó, medido: $10.525,88 sobre
  9 clientas con recargo impago, la peor GIULIANA PEREZ con $3.447.
  El default de `mora_previa` es 0 y eso NO es "no se sabe": es un hecho para
  casi toda la base. Los cuatro consumidores de `calcularSaldoConRecargo`
  (el cobro, `datos-cobro-cc`, la tabla y el detalle del cliente) lo pasan, y
  tienen que seguir pasándolo o la caja y la pantalla dicen números distintos.
- **La mora NO se aplica sola al día 31: se materializa cuando la clienta
  paga.** No hay cron ni proceso agendado (no está instalado `pg_cron` ni hay
  `crons` en `vercel.json`), y no hace falta: la pantalla la calcula al vuelo
  con `calcularSaldoConRecargo` para mostrarla, y `registrarPagoDeudaAction`
  inserta el DEBITO real justo antes del cobro, declarando en `debito_origen_id`
  a qué ticket pertenece. Por eso un cambio de criterio de RECARGO no necesita
  backfill: a las clientas afectadas les entra solo en su próximo pago, por el
  camino de siempre. Ojo que eso NO vale para el VENCIMIENTO: ese vive
  cacheado en `clientes.fecha_vencimiento_deuda`, así que toda migración que
  cambie `recalcular_vencimiento_cc` tiene que rebackfillearlo — si no, la
  fecha vieja sigue disparando el recargo hasta el próximo movimiento.
  Lo configurable vive en Configuración > Clientes (`clients-panel.tsx`):
  `cc_plazo_mora` (días) y `recargo_mora_tipo` / `recargo_mora_valor`
  (NINGUNO | MONTO_FIJO | PORCENTAJE). NO existe un toggle de "se reaplica":
  la ayuda de esa misma pantalla promete lo contrario —"se suma una única vez
  ... no se acumula día a día"— y el cálculo lo cumple porque parte siempre de
  capital.
- Recargo de cuenta corriente: existía y se cobraba (`configuracion_pos.
  cc_recargo_default`, 15% en Evens, recalculado server-side) pero se disolvía
  dentro de `ventas.total` — no había columna que dijera cuánto de un ticket
  fiado era mercadería y cuánto el precio de esperar, así que "¿me conviene
  fiar al 15% o cobrar con tarjeta al 15%?" no se podía contestar.
  `20260823180630` agrega `ventas.recargo_cc_porcentaje` / `recargo_cc_monto`
  (congelados en la fila, mismo criterio que el recargo por método) y empieza a
  escribir `cuenta_corriente_movimientos.monto_recargo`, que existía desde el
  esquema maestro y estaba en 0 en los 220 movimientos vivos. null significa
  "no se sabe" y 0 significa "se fió sin recargo": son distintos, por eso las
  columnas NO tienen default. El backfill escribe solo donde la aritmética de
  create-sale.ts cierra al peso (164 de 171 ventas fiadas); las 7 que no
  cierran quedan null en vez de con un número inventado.
  **`ventas.metodo_pago` NO es fuente de verdad. La fuente es `venta_pagos`.**
  Es una columna de texto con CHECK (EFECTIVO | TRANSFERENCIA | TARJETA |
  PAGO_MIXTO | CUENTA_CORRIENTE) que sobrevive de antes del multimedio, la
  escriben `registrar_venta` y `corregir_metodo_pago_venta`, y miente de dos
  formas medidas el 5/9/2026: `BILLETERA_VIRTUAL` se aplana a `'TARJETA'`
  (create-sale.ts:854), y las **124 ventas con entrega parcial + fiado** llevan
  el método de la ENTREGA, no el fiado — 61 dicen EFECTIVO, 48 TRANSFERENCIA,
  15 TARJETA, escondiendo $5.015.325 de deuda. Agrupar por esa columna da mal.
  Ninguna señal ni reporte la usa hoy (las 8 funciones de plata leen
  `venta_pagos`); si aparece una consulta nueva que la agrupe, está mal escrita.
  Cuenta corriente NO es una fila de `venta_pagos`, y es a propósito aunque
  conceptualmente sea una forma de saldar el ticket: para el resto del sistema
  esa tabla es PLATA QUE ENTRÓ. `posicion_dinero` arma "por acreditar" con
  `metodo_tipo <> 'EFECTIVO'` sin mirar `tipo_movimiento` (una fila de fiado se
  contaría como plata en camino) y nueve lugares en TypeScript suman
  `venta_pagos` embebido en la venta como cobrado. La comparación entre medios
  se arma en LECTURA, en `rentabilidad_por_metodo`, que no puede romper un
  arqueo.
  **OJO: acá decía que `registrar_venta` tiene un guard que falla si alguien
  escribe fiado en `venta_pagos`. NO EXISTE.** Verificado sobre el cuerpo vivo
  (`pg_get_functiondef`) el 5/9/2026: sus únicas tres excepciones son
  `SIN_NEGOCIO_ACTIVO`, `VENTA_SIN_RENGLONES` y `CLIENTE_NO_ENCONTRADO`, y la
  cadena `PAGO_CUENTA_CORRIENTE` no aparece en la función. La regla de no meter
  fiado en `venta_pagos` sigue valiendo y sigue respetada por los datos (112
  ventas fiadas, cero filas de pago), pero la sostiene el código de
  create-sale.ts, NO la base. Si se va a escribir ahí, hay que poner el guard
  de verdad primero.
- `rentabilidad_por_metodo` (`20260823180705`, gateada por
  `caja.ver_gerencial`): primera señal de Comerz Intelligence. Recargo cobrado
  menos comisión pagada, sobre la base, por medio. Deja ver que **recargo
  igual a comisión pierde plata**: la comisión se cobra sobre el bruto y el
  recargo se calcula sobre la base, así que 15% y 15% sobre 100 dan bruto 115,
  comisión 17,25 y neto 97,75 — −2,25%, medido exacto en Tarjeta Banco Nación.
  Para empatar 15% de comisión hay que cobrar 17,65% de recargo.
  Cuenta corriente va en su propio bloque, FUERA del ranking de medios: no es
  una forma de cobrar sino de no cobrar todavía, su neto es DEVENGADO, y
  `pendiente_foto` / `vencido_foto` son fotos de ahora que no respetan el
  período (el saldo de un cliente no tiene versión "de julio"). La comisión de
  cobrar una deuda con tarjeta se le imputa a CUENTA CORRIENTE, no a la
  tarjeta: sin el fiado ese cobro no existía. No se devuelven días REALES
  hasta cobrar —los pagos de CC no están imputados a una venta— sino
  `dias_plazo_pactado`, y el nombre lo dice; tampoco incobrabilidad, que con
  5 semanas de historia sería un juicio y no un hecho. `sin_dato_recargo`
  cuenta los débitos del período sin recargo registrado: con > 0 el total está
  subestimado y la tarjeta tiene que decirlo.
- **Unidades en `ventas_items`: las columnas del RENGLÓN son UNITARIAS**, al
  revés que las de la cabecera. `precio_final`, `precio_costo` y
  `descuento_monto` son por unidad, y para sumar hay que multiplicar por
  `cantidad`. Verificado contra la cabecera sobre las ventas con líneas de más
  de una unidad: `ventas.precio_costo = Σ (items.precio_costo × cantidad)`,
  12 de 12. Es la misma trampa que el bullet de arriba pero en el otro
  sentido, y ya mordió: el primer backfill de `20260823180630` reconstruyó el
  subtotal como `sum(precio_final)` y dejó afuera exactamente las 7 ventas
  fiadas con líneas multi-unidad (corregido en `20260823184214`). No quedó
  nada mal escrito porque el backfill solo escribía donde la cuenta cerraba al
  peso: el fail-closed convirtió un error en 7 nulls recuperables.
  `precio_final` YA tiene restado el descuento del renglón, y
  `ventas_descuentos.monto_descontado` = Σ (`items.descuento_monto` ×
  `cantidad`) en las 423 ventas del período: restar la cabecera además del
  renglón lo cuenta dos veces.
- `margen_realizado` (`20260823184551`, gateada por `caja.ver_gerencial`):
  margen de lo vendido, por producto y por categoría, desde el
  `ventas_items.precio_costo` congelado en la venta (806 renglones en 30 días
  de Evens, CERO sin costo). Los recargos quedan afuera: ni el de método ni el
  de cuenta corriente son mercadería.
  **Devuelve `dispersion_markup`, y ese bloque importa más que el ranking.**
  La promesa clásica de esta señal es "vas a descubrir que tu producto más
  vendido es el de peor margen"; en estos negocios ESO NO EXISTE. En Evens el
  86,3% de los renglones tiene costo exactamente igual a la mitad del precio
  (Estilo Bonito, 97,1%): el precio no es una decisión por producto sino una
  regla, ×2 sobre el costo. Con markup uniforme el margen porcentual es el
  mismo para todo el catálogo y lo único que lo mueve es el descuento — 50%
  sin descuento, 44,4% con 10%, 37,5% con 20%, que es exactamente la
  distribución observada. Ordenar por margen porcentual ahí no ordena por
  rentabilidad: ordena por quién recibió más descuento, y presentarlo como
  hallazgo es justo el error que hace que el módulo se apague a la semana.
  Por eso la señal devuelve también el bloque `descuentos`, que es donde está
  toda la variación real: 30 días de Evens dan $6.785.170 de margen (47,63%),
  con $768.680 descontados en 168 de 401 tickets — 2,68 puntos de margen. El
  día que se fijen precios por producto, el mismo ranking pasa a decir algo, y
  `uniforme` es lo que avisa cuándo.
  `p_min_unidades` (3) es el piso para entrar al ranking porcentual: 289 de
  372 productos no llegan, y se cuentan en `base_insuficiente` en vez de
  desaparecer sin explicación. Costo en cero queda fuera de todo ranking: no
  es margen del 100%, es un costo que nadie cargó.
- `composicion_ticket` (`20260823185658`, gateada por `caja.ver_gerencial`):
  distribución de tickets por cantidad de renglones, con ticket y margen
  promedio de cada tramo. Nace de una corrección: el ticket de 1,88 renglones
  de Evens no es solo un obstáculo estadístico (con 173 tickets multi-item no
  hay base para reglas de asociación) sino ADEMÁS el KPI más accionable que
  tiene el negocio. Son dos lecturas del mismo número y las dos valen.
  **`brecha_1_a_2` es DESCRIPTIVA, no causal**, y el nombre del campo es
  deliberado: los tickets de dos renglones no son los mismos clientes que los
  de uno, así que la diferencia de $14.810 NO es "lo que ganás por cada ticket
  que convertís". Sirve como orden de magnitud y como línea de base contra la
  cual comparar el mes que viene — eso último SÍ es causal y es el cierre que
  hace que Insights rinda cuentas. Si la UI lo rotula "oportunidad" o
  "ganancia potencial", miente.
  QUÉ ofrecer no lo decide el sistema: con 173 tickets multi-item el par más
  frecuente aparece 3 o 4 veces, que es ruido. La señal pone el objetivo y el
  número; el complemento lo elige la vendedora. Los tramos se cortan en "6 o
  más" (`es_tramo_abierto`) porque una fila por cada valor hasta 14 son filas
  de un ticket cada una que se leen como si fueran un patrón.
- `ventas_por_momento` (`20260823192530`): cuándo se vende. El día de semana va
  NORMALIZADO por cuántos días de cada tipo hubo en el rango (`ventas_por_dia`):
  sin eso, comparar sábados contra lunes en un rango de 60 días compara 9
  sábados contra 8 lunes y la diferencia incluye el calendario. Evens, 60 días:
  sábado 17,67 ventas por día y viernes 13,22, contra 3,75 el lunes. El domingo
  tiene 1,89 por día pero el ticket promedio más alto de la semana ($46.791) —
  dos hechos que van juntos en la misma fila, porque "cerrar los domingos" y
  "el domingo entra la clienta que más gasta" salen de ahí. El corte por HORA
  va aparte y con su conteo: 488 ventas en 14 horas × 7 días son celdas de 5, y
  una grilla día × hora a ese volumen es un mapa de calor de ruido. Las franjas
  (mañana/tarde/noche) sí tienen base.
- `curva_de_precio` (`20260823192553`): a qué precio se vendió cada unidad. Es
  la contracara accionable de lo que descubrió `margen_realizado` — con markup
  uniforme el margen no varía por producto, varía por descuento, y ACÁ vive esa
  variación. Evens, 30 días: 63,5% de las unidades a precio lleno (50,32% de
  margen), 28,2% con hasta 10% (44,87%), 8,3% con hasta 20% (37,60%), y NINGUNA
  por encima del 20%. No hay liquidación: hay descuento de mostrador, $768.680
  resignados. Los tramos se calculan sobre el descuento del RENGLÓN, no del
  ticket: una promo que toca un solo producto no descuenta el ticket entero.
- `antiguedad_saldo_cc` (`20260823192614`): el sustituto honesto de la
  incobrabilidad, que con 5 semanas de historia no se puede calcular — nada es
  incobrable todavía, pero la antigüedad SÍ es un hecho.
  **Imputa FIFO y lo declara en la respuesta** (`imputacion`): los pagos de CC
  no están imputados a una venta, así que para saber qué deuda sigue viva hay
  que suponer que los pagos cancelan lo más viejo primero. Es lo que hace
  cualquier reporte de antigüedad y lo que asume el propio cliente, pero es un
  supuesto y no un dato.
  `clientes_descuadrados` es el control de calidad de la propia señal: cuenta
  los clientes donde el libro (Σ débitos − Σ créditos) no coincide con
  `clientes.saldo_pendiente`. Hoy son 2 de 156, $32.200. Si crece, la
  antigüedad deja de cerrar contra el saldo que ve la dueña y la tarjeta tiene
  que avisarlo. Validación: el `total_vivo` que devuelve la función
  ($4.220.336,75) reconcilia al peso con la suma de `saldo_pendiente`.
- Lo que NO se construyó del roadmap de Insights, y qué le falta a cada uno
  para poder construirse. Está acá para no volver a proponerlo sin resolver
  primero el bloqueo:
  * **Días REALES hasta cobrar** y **imputación de pagos de CC** — la base
    sigue sin saber qué ticket saldó cada pago: un CREDITO no apunta a nada.
    Lo que SÍ existe desde `20260909190000` es la imputación FIFO calculada, y
    es la que manda en el vencimiento; pero es un SUPUESTO reconstruido, no el
    dato. Para "días reales hasta cobrar" hace falta el dato, y eso es un
    cambio de schema (imputación declarada en el pago), no una consulta.
    Ojo con la excepción: el RECARGO sí sabe de qué ticket es
    (`debito_origen_id`), porque se declara al cobrarlo. Los pagos no.
  * **Costo del dinero en el tiempo** — cálculo barato, pero necesita una TASA.
    Un default inventado diría con precisión falsa si conviene fiar. Tiene que
    salir de configuración del comercio o del contador.
  * **Costo de reposición vs histórico** — `producto_variantes.costo` está en
    cero en 3.020 de 3.153 variantes de Evens. No hay costo actual del catálogo
    contra el cual comparar. (El costo REALIZADO sí está completo: es
    `ventas_items.precio_costo`, congelado por renglón.)
  * **Sell-through por lote** y **capital inmovilizado por antigüedad de
    compra** — nada ata una unidad vendida al remito que la trajo. Es un
    `lote_id` en `ventas_items`, no una consulta.
  * **Ciclo de conversión de efectivo** — le falta una de las tres patas: los
    días de pago a proveedor. `ordenes_compra` guarda remitos, no condiciones.
    Media métrica cuyo sentido entero está en las tres patas es peor que
    ninguna.
- **Correlación no es palanca** (`20260823191708`). La primera versión de
  `composicion_ticket` devolvía `brecha_1_a_2` —la diferencia entre el ticket
  promedio de dos renglones y el de uno, $14.810— con un `es_descriptiva: true`
  al lado. La advertencia no alcanza: si el único número grande de la señal es
  ese, alguien lo usa para proyectar. Y es la diferencia entre DOS POBLACIONES
  (las que venían a comprar una cosa y las que venían a comprar varias), no el
  valor de una conversión. Lo que se agrega al convertir es UNA PRENDA, y en un
  ticket de dos la que se suma es la más barata: $14.302 de precio y **$6.823
  de margen**. Ese es `renglon_adicional`, y es el único que se puede prometer.
  Los dos números quedaron cerca en Evens por un motivo empírico —la prenda
  cara de un ticket de dos ($25.113) se parece al ticket de uno ($24.605)— que
  puede dejar de valer el mes que viene o en otro comercio. **El número que se
  promete tiene que ser el que se cumple por construcción, no el que
  casualmente coincide.** Si el módulo promete $170.000 y entrega $60.000, se
  perdió la confianza aunque los $60.000 sean excelentes.
- **Venta cruzada: medida, y no hay señal en ningún grano.** Evens, 90 días:
  por PRODUCTO hay 654 pares distintos y **el par más frecuente aparece DOS
  veces** (cero pares con 3 o más); por CATEGORÍA el máximo es 7. Contra el
  piso de ~30 co-ocurrencias que hace falta para que un par no sea azar, no
  alcanza ni agregando. No se construye "lo que se lleva junto a X" hasta tener
  ~6 meses. La señal pone el objetivo y el valor; QUÉ ofrecer lo elige la
  vendedora. (Apareció midiendo: entre los pares de categorías más frecuentes
  está "REMERAS, BLUSAS Y CAMISAS" con "REMERAS,BLUSAS Y CAMISAS", que son la
  MISMA categoría cargada dos veces — hay tres variantes de JEANS y dos de
  CAMPERAS. La fragmentación del catálogo degrada toda señal por categoría.)
- **Al cliente solo se lo identifica cuando se le fía, y eso sesga TODA la
  analítica de clientas.** Medido: en Evens el 23,0% de las ventas tiene
  `cliente_id`, y de esas 112 solo **5** no son fiado. En Estilo Bonito, 49,2%
  identificadas y 8 sin fiado. O sea que "clienta" en la base significa hoy
  "clienta a la que se le fía". Consecuencias: la comparación "¿la clienta de
  cuenta corriente compra más?" NO tiene grupo de control (81 de 83 clientas
  identificadas de Evens usaron CC), y recencia, frecuencia y tasa de
  repetición miden a las fiadas, no a la clientela. **Antes de cualquier señal
  de clientas hay que identificar en la venta de contado**, y eso es un cambio
  de producto en el POS, no de analítica.
- **Toda señal de estancamiento se compara contra el comportamiento de su
  CATEGORÍA, nunca contra un umbral absoluto.** Si toda la categoría abrigo
  cayó 70%, ese producto no está estancado: está fuera de temporada. Sale de
  los datos y no necesita carga manual, a diferencia de
  `categorias.temporada`, que es el respaldo rústico. Todavía no hay señal
  que lo implemente —con 5 semanas no hay dos ventanas comparables— pero la
  regla vale desde ya para cualquier señal de rotación que se escriba.
- `categorias.temporada` (`20260823185816`): la ventana de venta de cada
  categoría, cargada a mano. Existe para que Insights no diga "necesitamos más
  camperas" un 15 de septiembre. Esperar un año de historia para aprender la
  estacionalidad de los datos no sirve con 5 semanas de POS; un campo cargado
  una vez vale más y se puede tener hoy.
  **Sirve SOLO para silenciar, nunca para sugerir.** "No me muestres abrigos
  en la reposición de noviembre" es seguro — el peor caso es que falte una
  fila. "Comprá mallas que viene el verano" es una predicción que el sistema
  no puede respaldar. Por eso el helper de TS se llama
  `categoriasFueraDeTemporada` y devuelve la forma NEGATIVA: obliga a usarla
  para restar, no para agregar.
  El default `TODO_EL_ANIO` NO silencia nada, y eso va contra la costumbre
  fail-closed del resto de esta base: acá el lado seguro es mostrar. Un default
  que adivinara la temporada por el nombre de la categoría escondería
  mercadería real sin que nadie lo pidiera. Además el freno principal contra el
  consejo fuera de temporada no es este campo sino la VENTANA CORTA de la
  reposición (si no vendió en 14-21 días no aparece, sin saber qué mes es); la
  temporada es la segunda línea.
  Ventanas de VENTA, no meteorológicas, y se solapan a propósito: en marzo
  conviven la liquidación de verano y la entrada de media estación. El criterio
  vive en `shared/lib/temporada-categoria.ts` (con test) y en
  `public.categoria_en_temporada`, y los dos tienen que decir lo mismo —
  verificado mes por mes. Mismo patrón que `tipo-egreso.ts`.
  OJO al tocar `build-categorias-payload.ts`: la columna es NOT NULL y el
  upsert de PostgREST arma el UPDATE con la UNIÓN de las claves del lote, así
  que `temporada` tiene que ir SIEMPRE en el payload — igual que `imagen_url`,
  por el mismo motivo ya documentado ahí.
- Egresos, dos ejes que no son el mismo: `egresos.tipo` (OPERATIVO |
  RETIRO_SOCIO | COMPRA_MERCADERIA, CHECK fail-closed, default OPERATIVO).
  Los TRES sacan plata del cajón — el arqueo de cierre sigue restando todo
  (`calcular_egresos_turno` no filtra por tipo) — pero solo OPERATIVO resta
  de la ganancia: un retiro es la ganancia ya hecha y una compra ya viene
  contada en `precio_costo` de lo vendido (restarla era contarla dos veces).
  El criterio vive en `features/caja/lib/tipo-egreso.ts` y lo comparten el
  modal, la action y `get-dashboard-metrics`. `orden_compra_id` linkea el
  pago al remito, con CHECK de que solo COMPRA_MERCADERIA puede tenerlo y
  ON DELETE SET NULL (borrar el remito no puede borrar el egreso: la plata
  salió igual y el arqueo tiene que seguir cerrando).
- /caja son 3 vistas separadas por PREGUNTA, no por origen del dato: Hoy (el
  turno propio arriba, si opera caja, y abajo el resumen del día: mismo tema
  con dos niveles de zoom) / Dinero / Historial. El período de calendario
  (`shared/lib/periodo-ranges.ts` + `shared/components/periodo-selector.tsx`,
  movidos ahí desde features/dashboard cuando pasaron a tener dos consumidores)
  gobierna SOLO lo acreditado; el efectivo y lo pendiente son fotos de ahora y
  lo dicen en el título. El rango lo resuelve la BASE (`p_periodo`), no el
  cliente: mismo motivo que `p_fecha` en el resumen gerencial.
- Posición de dinero (`posicion_dinero`, gateada por `caja.ver_gerencial`):
  responde "dónde está la plata" y es DERIVADA de turnos/venta_pagos/egresos —
  NO es el saldo del banco (la cuenta se mueve por cosas que el POS no ve).
  Tres bloques que a propósito no se suman en un total: efectivo de turnos
  ABIERTOS (misma fórmula que el cierre; no se lee `turnos_caja.
  efectivo_esperado`, que en un turno abierto quedó congelado en el monto
  inicial), cobrado sin acreditar (`creado_en + acreditacion_dias > now()`,
  las tarjetas a 20 días) y acreditado en el período. Mezclar plata
  disponible con plata futura en un solo número es justo el error que hace
  gastar lo que todavía no entró.
- Rubro: flag `configuracion_pos.rubro` ('indumentaria' | 'electro', CHECK
  fail-closed, default indumentaria). Cambia la identidad del producto en la
  UI, no el schema: indumentaria muestra "N var.", electro muestra Modelo +
  EAN (`features/stock/lib/identidad-por-rubro.ts`). El EAN vive en
  `producto_variantes.sku` — misma columna, otro label.
- Catálogo Maestro (`catalogo_maestro`): tabla de fichas de electro que vive
  en OTRO proyecto Supabase (`CATALOGO_MAESTRO_SUPABASE_URL`, cliente aparte
  en `shared/config/supabase/catalogo-maestro.ts`) — la ÚNICA base fuera de
  la del SaaS, y a propósito: es un padrón compartido por todos los negocios,
  no datos de un tenant. Solo-lectura por RLS (no hay política de
  INSERT/UPDATE/DELETE: anon y authenticated no escriben ni por error) y no
  recibe migraciones desde este repo.
  Carga Rápida busca por EAN exacto y por texto (word_similarity + ranking,
  porque word_similarity sola satura en 1.000). Los datos se COPIAN al
  producto local; `productos.id_master` es trazabilidad SIN FK — la venta
  nunca depende de alcanzar el maestro en tiempo real.
- Categorías en árbol de 2 niveles (parent_id), tolerante a estado mixto:
  padres con hijos, sueltas sin padre, o todo plano. `shared/utils/
  category-tree.ts` separa resolución de slug (sin conteos, para que un link
  viejo resuelva igual) de construcción del árbol (con conteos y facetado).
- RLS: el baseline real de producción está versionado desde
  `20260728130000_rls_baseline_desde_evens.sql` (antes el repo cubría 7 de 34
  tablas; las 88 políticas vivas nunca habían estado en git). Con
  multi-tenant la base tiene 44 tablas y 144 políticas: cada tabla nueva
  necesita su policy de negocio, no alcanza con la columna.
  **Cómo se escribe la policy importa tanto como qué dice**: va
  `negocio_id = (select security.current_negocio_id())`, NUNCA
  `security.same_negocio(negocio_id)`. Dan el mismo resultado fila por fila,
  pero la segunda recibe la columna como argumento, así que Postgres la ejecuta
  UNA VEZ POR FILA y el predicado queda como `Filter` en vez de `Index Cond`
  — o sea que el índice de negocio_id ni se usa. Medido con un usuario real
  sobre producto_variantes: 132 ms contra 4 ms. Era la causa de que los
  listados de productos promediaran entre 663 y 2.372 ms y de que
  producto_variantes acumulara 14.700 millones de filas leídas sobre una tabla
  de 4.951. Corregido en `20260816100000`, que además deja un guard: la
  migración falla si queda alguna policy con la forma vieja.
  `same_negocio()` sigue existiendo para las migraciones que ya la usan, con
  un COMMENT que avisa que no va adentro de una policy.
- Índices: toda tabla del camino de la venta necesita índice por sus FK, no
  solo por `negocio_id` (`20260816110000`). Antes, `venta_pagos` leía 92
  millones de filas sobre una tabla de 623 para armar los tickets y el arqueo.
  Los compuestos arrancan por `negocio_id` porque, con la RLS ya resuelta por
  statement, ese es el primer filtro de toda consulta.
  OJO con `producto_variantes.sku`: tiene índice pero NO es único, y no puede
  serlo — en electro guarda el EAN de la unidad y en indumentaria el código del
  MODELO, que todos los talles comparten (Estilo Bonito tiene hasta 9 variantes
  con el mismo). Son dos semánticas en una columna; separarlas es otro cambio.
- Ingreso de mercadería: UN solo camino, "Ingresar mercadería"
  (`ingresar-mercaderia-modal.tsx`), igual para todos los rubros. Adentro se
  elige el ORIGEN del archivo —planilla del proveedor o planilla propia— y las
  dos terminan en la MISMA conciliación (/compras/merge). Antes eran dos
  botones distintos elegidos por el rubro, y esa era la lectura equivocada: la
  diferencia nunca fue el rubro sino quién escribió el archivo. Una tienda de
  ropa también tiene planillas propias y una de electro también recibe
  remitos.
  Por qué la planilla propia TAMBIÉN se concilia (antes escribía derecho):
  con 300 productos cargados nadie se acuerda si "Remera blanca talle M Levis"
  ya existe o si la cargó escrita distinto, y esa pregunta sin responder es la
  que produce el catálogo duplicado. Quién escribió el archivo no la cambia.
  Como consecuencia hay UN solo motor de escritura de stock por ingreso
  (`aprobar_orden_compra`), que ahora también crea las unidades de
  `unidades_serie` cuando la línea trae IMEI.
  **Eso se perdió una vez y volvió** (`20260904140000`): la migración
  `20260819180039` reescribió la función ENTERA para aceptar cantidad decimal
  partiendo de una copia anterior al 18/8, y se llevó puestas las dos cosas
  que esa fecha había agregado — la creación de `unidades_serie` y el guard de
  que un `atributos` vacío NO pise los que la variante ya tenía. Las dos
  migraciones estaban aplicadas y ganó la última; el síntoma medible eran 5
  líneas de remito con IMEI contra 2 filas en `unidades_serie` en toda la
  base. La lección vale más que el arreglo: **`create or replace function` no
  avisa de nada**, así que reescribir un cuerpo completo hay que hacerlo desde
  el cuerpo VIVO (`pg_get_functiondef`), nunca desde el último archivo que lo
  tocó. La migración deja un guard que falla si el cuerpo queda sin
  `unidades_serie` o sin el `case` de atributos, mismo criterio que el guard de
  policies de `20260816100000`.
  El guard contra subir dos veces el mismo archivo es
  `ordenes_compra.hash_planilla` (unique parcial por negocio, null en los
  remitos de proveedor): la conciliación ya protegía contra aprobar dos veces
  la misma orden, pero no contra crear dos órdenes desde el mismo archivo.
- La conciliación tiene DOS MODOS y el default lo decide el dato, no una
  preferencia (`features/purchases/lib/modo-conciliacion.ts`). El modo
  CONCILIACIÓN es la pantalla de siempre: vincular cada fila contra el
  catálogo. El modo CARGA INICIAL da vuelta el default —toda fila arranca como
  producto nuevo, en una tabla editable, sin combobox y sin modales— y abre
  cuando el catálogo tiene menos de 20 productos publicados o cuando menos del
  **70%** de los GRUPOS del remito ya existen.
  **El umbral pasó de 40% a 70% el 9/9/2026, y el motivo es un dato nuevo.**
  El 40% se fijó midiendo la ENTRADA (cuántos grupos matchean al abrir).
  Después se pudo medir la SALIDA —qué termina siendo cada grupo que cae en la
  pantalla— y dice otra cosa: de los 2.053 grupos que pasaron por conciliación
  en los 115 remitos aprobados, **solo 23 (1,1%) terminaron asociados a un
  producto que ya existía**. El resto fue alta nueva. O sea que el porcentaje
  de auto-match NO predice el destino: incluso un remito que matchea 30%
  termina dando de alta casi todo lo que cae.
  Es un cambio chico —4 remitos de 146 cambian de modo, 25 grupos, y esos 25
  terminaron en alta nueva 25 de 25— y va en la dirección que los datos
  señalan. Lo que de verdad mueve el volumen es qué acción ofrece el modo
  CONCILIACIÓN, no cuándo abre.
  **El umbral no es una intuición: la premisa de la pantalla vieja era falsa.**
  Medido sobre los 142 remitos reales de los 4 negocios, Evens matchea el
  17,9% de los grupos y Estilo Bonito el 27,8%, con 1.226 y 572 productos en
  catálogo — o sea que "la mayoría de las filas ya existen" no pasa ni en el
  comercio establecido, y no mejora con el tiempo (por semana: 89, 97, 64, 95,
  89, 84, 100, 100, 67% de grupos nuevos). El corte en 40% cae en un valle
  vacío: 117 remitos matchean menos del 20%, 21 más del 40% y solo 3 en el
  medio, así que mover el número entre 20 y 40 cambia de modo 3 remitos de 142.
  El síntoma que lo hacía visible: 26 de 118 remitos de Evens quedaron
  PENDIENTE para siempre, y los abandonados son el DOBLE de grandes que los
  aprobados (30,3 grupos promedio contra 14,6).
  La dueña cambia de modo a mano cuando quiere; el modo elegido queda en el
  borrador, así que reabrir el remito no la devuelve al otro.
  Lo que el modo NO cambia: las filas que el import sí reconoció siguen
  vinculadas y solo suman stock. El modo cambia el default y el trabajo, no lo
  que el remito puede hacer.
- **En el modo CONCILIACIÓN la acción principal es dar de alta en lote, no
  vincular** (9/9/2026), por el mismo dato: el 98,9% de lo que cae en esa
  pantalla termina siendo producto nuevo. "Crear los N" salió de la barra gris
  de acciones rápidas —donde vivía al lado del recargo global— a un bloque
  propio arriba de la tabla, en primario.
  El lote incluye los grupos AMBIGUO **a los que ya se les eligió categoría a
  mano**: un ambiguo con categoría no está ambiguo, y antes quedaba afuera —el
  toast decía "ahora podés usar Crear en cada una", o sea 30 clicks para
  ejecutar una decisión ya tomada. El conteo va desglosado ("creo 34, te quedan
  12 para revisar") porque prometer "todos" y dejar filas rojas es peor que
  prometer menos y cumplirlo.
  **Los grupos con candidato (POSIBLE_MATCH) quedan afuera del lote a
  propósito**, aunque casi todos terminen siendo alta nueva: crear en lote
  pisando un candidato sin mirarlo es exactamente cómo se fabrica el catálogo
  duplicado que la pantalla existe para evitar.
- **La pantalla muestra TODOS los candidatos, no el mejor.**
  `construirMapaSimilares` se quedaba con uno solo y tiraba los otros dos que
  devuelve la RPC. Con familias de nombre largo eso convierte una elección en
  una afirmación: Evens tiene 25 productos "VESTIDO EGRESADA …", y sobre una
  muestra de 200 nombres de remito, 78 tienen 2 o más candidatos sobre el
  umbral y 14 tienen 5 o más.
  `hayEmpate` (en `afinidad-nombre.ts`, margen 0,05 de cobertura) detecta
  cuándo los dos mejores no se pueden separar; ahí la pantalla NO recomienda
  —el orden lo puso el trigrama, que es justo lo que no distingue esos
  nombres— y muestra las opciones con su diferencia ("le falta 'alana'").
- Las dos tablas de conciliación **se apilan en mobile** (`max-md:block` en
  merge-table, `max-md:grid-cols-1` en carga-inicial). Tenían un ancho mínimo
  fijo de 1.000 y 1.110 px dentro de un `overflow-x-auto`: en un teléfono de
  390 px se veía menos de la mitad de un renglón y había que arrastrar de
  costado para llegar al botón. La cabecera se esconde —apilada no ordena
  nada— y el rótulo de cada columna viaja en `data-label`, porque sin el thead
  un número suelto no dice si es el costo o el precio. Ojo: `before:content`
  no funciona sobre un `<input>`, así que los inputs sueltos de carga-inicial
  van envueltos en una celda que sí lo puede mostrar.
- En carga inicial la fila se agrupa por nombre + MARCA + GÉNERO, no solo por
  `raw_nombre` como en el modo viejo. Con la clave vieja, "babucha rustica" de
  dos marcas distintas —o "bermuda chino" de nene y de hombre— se funden en un
  producto: pasa en 4 de 94 grupos del primer remito de un comercio nuevo y en
  32 de 1.309 de Estilo Bonito.
  Todo llega PRELLENADO, no en blanco: nombre, marca y género ya venían en
  columnas propias del remito; la categoría se infiere
  (`inferir-categoria-fila.ts`, cuatro escalones: la columna del archivo ya
  resuelta, el árbol por audiencia, el diccionario de términos POR RUBRO, o
  proponer crearla); y el precio sale de costo × recargo, con default 100%
  porque el 93,1% de los productos de Evens y el 94,4% de los de Estilo Bonito
  tienen precio exactamente el doble del costo. Nunca más "Esperando
  asignación": era la pantalla diciendo que no sabía algo que sí podía
  calcular.
  El diccionario nuevo (`terminos-por-rubro.ts`) devuelve nombres GENÉRICOS
  ("Camperas"), no los literales de Evens que devuelve `category-suggestions.ts`
  ("CAMPERAS Y CHALECOS DE  HOMBRE", con doble espacio): ese sirve para Evens y
  para nadie más, y el comercio que arranca es justo el que no tiene ninguna
  categoría con ese nombre. El genérico se resuelve por slug contra el árbol
  local y, si no existe, es lo que se propone crear.
  Costo y cantidad SE EDITAN, que en el modo viejo no se podía: en el primer
  remito del comercio nuevo las 186 líneas vienen con costo 0 (la planilla
  traía precio de venta, no costo) y no había forma de arreglarlo en esa
  pantalla.
- **La creación en lote es idempotente por `ordenes_items.producto_id`**
  (`crear_productos_desde_remito`, `20260904120000`). No es un hash inventado:
  es un dato que había que escribir igual, y escribirlo ANTES de impactar el
  stock es lo que hace que el reintento reuse en vez de duplicar. Antes se
  creaba de a un producto por grupo con `crearProductoAlVueloAction`, sin
  ningún guard: doble click, reintento tras timeout o pestaña vieja creaban
  todo dos veces. El stock queda AFUERA de esa RPC a propósito: lo sigue
  impactando `aprobar_orden_compra`, que ya es idempotente por su propio guard.
  Dos guards para dos escrituras es más simple que uno que tenga que decidir
  qué hacer cuando una está hecha y la otra no. La RPC toma un row lock sobre
  la orden (`select ... for update`) para serializar dos confirmaciones
  simultáneas, y crea la categoría propuesta solo si la persona la dejó puesta.
- El progreso de una conciliación vive en la BASE (`ordenes_borradores`, una
  fila por orden, payload jsonb opaco discriminado por `modo`). El borrador de
  IndexedDB (`merge-draft-db.ts`) se mantiene y gana cuando están los dos —es
  el más inmediato—, pero no sobrevivía a cambiar de máquina ni a limpiar el
  navegador, y un remito de 94 grupos es media hora de tipeo. Los dos modos
  escriben la misma fila; sin el campo `modo` en el payload, reabrir el remito
  podía elegir la pantalla equivocada y descartar el trabajo del otro modo.
- **La foto NO está en el camino crítico del alta.** Nunca lo estuvo en la
  base ni en las actions (nada la exige, y el catálogo público, el POS e
  Inventario ya dibujan un placeholder), pero el modal de creación de la
  conciliación la pedía en el medio: 94 productos son 94 fotos antes de poder
  cargar el remito. Ahora se crean sin foto y el pendiente se cuenta y se
  muestra —banner en Inventario + `/stock/fotos-pendientes`, que las sube por
  tanda y guarda cada una en el acto, sin botón "Guardar" al final. Sacar la
  foto del camino sin dejar el pendiente sería peor: un producto sin foto del
  que nadie se entera se queda sin foto para siempre.
- Lo que cambia por RUBRO son las COLUMNAS de la plantilla, no el flujo
  (`features/stock/lib/columnas-por-rubro.ts`). Las columnas base —categoría,
  producto, stock, costo, venta— son iguales en todos: es lo que hace a un
  producto vendible y no depende de qué se vende. Lo específico se AGREGA y
  nunca reemplaza, así una planilla de un rubro entra en otro perdiendo lo que
  no aplica en vez de fallar entera. Cada columna declara si parte variantes
  (talle, color, medida, material, peso, presentación sí; marca y modelo no),
  y eso es lo que le permite a la conciliación agrupar filas del mismo
  producto. El parser reconoce TODAS las columnas de TODOS los rubros a
  propósito: una planilla armada con otra plantilla tiene que entrar igual.
  Indumentaria NO lleva `codigo_barras`: la ropa de proveedor local rara vez
  lo trae y una columna siempre vacía enseña a ignorar columnas.
  NO existen `vencimiento` ni `lote` aunque alimentos y farmacia los
  necesiten: el vencimiento es del LOTE, y esa tabla no existe todavía.
  Ofrecer la columna y tirar el dato al importar es peor que no ofrecerla.
- Los 7 rubros del tipo `Rubro` ahora son los 7 del CHECK. Hasta
  `20260815100000` el CHECK aceptaba solo indumentaria y electro, y
  `normalizarRubro` era `valor === "electro" ? ... : "indumentaria"`, o sea
  que los otros cinco se leían como indumentaria aunque estuvieran bien
  guardados. Inofensivo antes; con plantilla por rubro le daba a una
  ferretería las columnas de una tienda de ropa.
- Importación de planilla DIRECTA (`importar_productos_planilla` y su UI):
  quedó SIN punto de entrada al unificar el ingreso, pero no se borró todavía
  — el flujo nuevo tiene que probarse con planillas reales antes de tirar el
  que funcionaba. Lo que sigue describe ese camino, hoy inactivo.
  TODA la escritura corre en la RPC
  `importar_productos_planilla` (productos + variantes + relaciones de
  atributos + IMEI + stock + espejo legacy), en una transacción y en batch —
  antes era un `for` con await adentro, ~10.000 round-trips con el tope de
  3000 filas. Cada fila es atómica (bloque BEGIN/EXCEPTION = savepoint): una
  fila que falla no deja producto sin variante ni IMEI sin stock, y las demás
  siguen. La canonicalización de atributos se queda en Node, igual que en
  `aprobar_orden_compra`. Idempotencia: `importaciones_productos` con unique
  PARCIAL `(negocio_id, hash) where not forzada`; el INSERT del guard va
  PRIMERO (toma el row lock que serializa dos importaciones simultáneas) y
  "ya se importó" vuelve como `{ya_importada: true}`, no como excepción. El
  hash es sha256 del CONTENIDO parseado (`hash-import-productos.ts`), no de
  los bytes: la misma planilla en CSV y en XLSX es el mismo import, y
  cambiar una cantidad la vuelve otra. Reimportar a propósito existe y es
  explícito (`p_forzar`, que marca la fila `forzada` y esquiva el unique).
  El plan va FIRMADO (`firma-plan-import.ts`): la preview devuelve una firma
  del plan (acción + destino + categoría + unidades + si la fila está
  bloqueada, por fila; los avisos quedan afuera porque no cambian lo que se
  escribe) y confirmar recalcula el plan contra el catálogo de ESE momento y
  compara. Si no coincide no escribe nada y devuelve el plan nuevo con las
  filas que cambiaron. Falta de firma = desactualizada (fail-closed).
  La preview (`import-preview.tsx` + `filtrar-plan-import.ts`) es filtrable
  por contadores y corrige el precio de venta inline: la corrección NO
  parchea el plan en el cliente, cambia las filas y vuelve a pedir la preview
  (debounce) — plan y firma tienen que salir siempre del mismo lado. Las dos
  actions chequean `tiene_permiso('stock.importar_planilla')`: el botón
  escondido no es control de acceso, un server action es un endpoint. El
  permiso se otorgó a los roles que ya tenían `stock.ingresar_remito` (son
  los dos flujos hermanos por rubro) y los negocios nuevos lo reciben solos
  porque `crear_negocio_con_owner` le da al ADMIN todas las filas de
  `permisos`.
- Facturación, dos ejes que no son el mismo: `modo_facturacion` es la
  CAPACIDAD (INTERNO | MANUAL | ARCA — solo ARCA emite con CAE; MANUAL factura
  fuera de Comerz y para el POS se comporta como INTERNO) y
  `comprobante_defecto` es la ELECCIÓN. El criterio vive en
  `shared/lib/facturacion.ts` y lo comparten el panel, la action y —para la
  regla de modo— un CHECK. Ese CHECK cruza las dos columnas, así que el UPDATE
  las manda SIEMPRE juntas: pasar de ARCA a INTERNO con 'FACTURA_B' guardado
  es violación de CHECK aunque el usuario solo haya tocado el modo. La regla
  de que la letra corresponda a la condición de IVA del emisor (un
  monotributista no emite A ni B) NO es CHECK a propósito: como CHECK
  impediría guardar el cambio de Monotributo a RI mientras arrastra un default
  viejo. La condición se lee de la BASE, nunca del form.
- `comprobantes`: qué papel salió por cada venta, tabla aparte y no columnas en
  `ventas` porque una venta puede tener MÁS de un comprobante (anular una
  factura no es editarla: es emitir una nota de crédito, con su propio CAE y su
  propio número) y porque un comprobante es INMUTABLE y una venta no. La
  inmutabilidad es RLS: no hay policy de UPDATE ni de DELETE, así que la base
  las deniega — mismo criterio que el turno de caja cerrado. Los datos del
  receptor y los importes van CONGELADOS en la fila (igual que el recargo en
  `venta_pagos`): si mañana la clienta corrige su CUIT, la factura ya emitida
  tiene que seguir diciendo lo que decía, y leerlos por join contra `clientes`
  los haría cambiar solos. `siguiente_numero_comprobante` serializa por row
  lock (un solo `insert ... on conflict do update ... returning`) para que el
  número no salga nunca de un `select max(numero) + 1`, y es autoridad SOLO
  para TICKET: en los fiscales el último número autorizado lo dice ARCA
  (FECompUltimoAutorizado), no esta base.
  **El TICKET interno va siempre en la serie 1, desacoplado del punto de venta
  de ARCA** (18/9/2026, `emitir-comprobante.ts`). Antes seguía al
  `punto_venta` configurado: cuando Estilo Bonito dio de alta su punto 5 para
  facturar, los recibos internos pasaron a "00005-…" —un papel que dice
  "punto de venta 5" con un número que en ARCA no existe— y cada cambio de
  punto reiniciaba la serie (1 → 2 → 5 en dos días). El ticket es un recibo
  de control interno y el punto de venta es de lo fiscal; no se mezclan. El
  formato impreso se mantiene igual a propósito (decisión del 18/9).
- Exportaciones para el contador (pestaña en /reportes), NO "Contabilidad":
  Comerz no lleva la contabilidad, prepara la información para que la lleve el
  contador. El catálogo (`features/exportaciones/lib/catalogo-exportaciones.ts`)
  declara por exportación si tiene fuente de datos REAL hoy, y el motivo cuando
  no. Los libros de IVA están deshabilitados a propósito: uno armado con
  tickets internos como si fueran facturas es información falsa firmada por el
  comercio. El de COMPRAS no se destraba con ARCA — `ordenes_compra` no guarda
  CUIT, tipo de comprobante ni IVA: son remitos, no facturas de compra.
  El período tiene su propio selector (`periodo-exportacion.ts`) y NO reusa
  `resolverRangoAnterior("mes")` de shared: esa recorta al mismo día del mes
  para que el panel compare mes-a-la-fecha, así que un contador que pide julio
  un 8 de agosto se llevaría del 1 al 8 y presentaría un mes incompleto.
  En las planillas los importes van como NÚMERO (un contador filtra y suma;
  "$1.234" como texto convierte la planilla en un dibujo) y las fechas como ISO
  (Excel lee 03/04 como marzo o abril según la máquina de quien abre). Las
  ventas anuladas aparecen marcadas: sacarlas deja huecos sin explicación.
- QUÉ comprobante corresponde lo decide UNA función en el server:
  `shared/lib/determinar-comprobante.ts`. Cruza cuatro datos —condición de IVA
  del EMISOR, del RECEPTOR, tipo de operación (venta/devolución) y config del
  comercio— y por eso es módulo propio y no ifs repartidos. Es pura y sin IO:
  recibe los cuatro datos resueltos, así la matriz entera se testea sin base.
  El POS manda la venta, NUNCA el tipo de comprobante: uno elegido en el
  navegador es uno que se elige con las DevTools abiertas.
  La matriz: monotributista o exento emiten SIEMPRE C (no discriminan IVA
  porque no lo liquidan); un RI emite A solo a otro RI —que es el único que
  computa crédito fiscal— y B a todo el resto, incluido el receptor sin datos.
  La celda RI → Monotributo está aislada en la constante `RI_A_MONOTRIBUTO`
  (hoy en B, por el mismo criterio del crédito fiscal): es la única donde el
  criterio y la costumbre pueden discrepar, y **hay que confirmarla con el
  contador** antes de facturar.
  `comprobante_defecto` es una PREFERENCIA, no una orden: si la matriz no lo
  habilita para ese receptor, gana la matriz. Un comercio con "Factura A" por
  defecto que le vende a consumidor final emite B.
  `determinarComprobanteFiscal` es la matriz sin el corte por
  `ARCA_EMISION_DISPONIBLE`, y existe para poder testearla HOY con el flag
  apagado — si la única puerta incluyera el corte, la regla quedaría sin una
  sola prueba hasta el día en que ya no se puede descubrir que estaba mal.
- Emisión del comprobante: paso 11 de create-sale.ts, vía
  `features/sales/lib/emitir-comprobante.ts`. Es el ÚNICO paso de la venta que
  NO puede voltearla: cuando corre, la plata ya se cobró y el stock ya se
  descontó, y no hay transacción que abarque las dos cosas. Con TICKET interno
  dejar la venta sin comprobante es menos malo que hacer rebotar una venta que
  ya pasó en el mostrador, así que la función devuelve resultado y NUNCA lanza
  — pero loguea `[COMPROBANTE]` como error, porque una venta sin comprobante
  es un hueco contable que hay que poder encontrar. **Con ARCA esto se
  invierte**: una factura no se entrega sin CAE, así que el CAE hay que
  pedirlo ANTES de cerrar la venta.
  Qué se emite lo decide `tipoComprobanteAEmitir`, no `comprobante_defecto`:
  mientras `ARCA_EMISION_DISPONIBLE` sea false sale TICKET aunque la config
  diga Factura B, porque una fila FACTURA_B sin CAE es un comprobante inválido
  guardado como válido. La base lo respalda: CHECK de que TICKET nunca lleva
  CAE y todo lo fiscal siempre lo lleva. Prender ARCA es cambiar esa constante
  en UN lugar.
  Ojo con la FK `comprobantes.venta_id ON DELETE RESTRICT`: la policy
  `ventas_delete_propia_o_admin` existe y ahora una venta con comprobante ya
  no se puede borrar. Es lo buscado (la app nunca borra ventas: anula con
  `estado_operacion`), pero es un camino que antes funcionaba.
- **Las llamadas a ARCA van por `node:https` con un agente propio, NO por
  `fetch`** (`features/arca/lib/http-arca.ts`). `servicios1.afip.gov.ar` (WSFE
  de producción) prefiere DHE con un grupo de **1024 bits**, y OpenSSL 3 —el
  Node de Vercel— lo rechaza: `ERR_SSL_DH_KEY_TOO_SMALL`. La prueba de conexión
  de Estilo Bonito se caía en FEDummy, antes de firmar nada, con "fetch
  failed" a secas (16/9/2026); desde una máquina local conectaba, así que
  parecía un bloqueo de red de ARCA y no lo era. El agente no ofrece DHE
  (`!DH`) y el servidor elige otra cosa —ECDHE en `wsaa`/`wsaahomo`/`wswhomo`,
  RSA-AES256-GCM en `servicios1`—; NO se baja el nivel de seguridad
  (`@SECLEVEL=1`), que aceptaría el DH chico. Homologación no lo sufre porque
  esos hosts negocian ECDHE: **que funcione en homologación no prueba que
  funcione en producción.** Volver a `fetch` ahí rompe la facturación sin
  tocar una línea de ARCA.
  Y los errores de red se muestran con su `code` (`error-red.ts`): "fetch
  failed" no distingue DNS, firewall ni TLS, y son tres arreglos distintos.
  Un "Certificado no emitido por AC de confianza" en WSAA es otra cosa: el
  certificado es del OTRO ambiente (producción lo emite el ARCA real,
  homologación el portal WSASS, con CAs distintas).
- El número que se imprime es el del comprobante (`formatearNumeroComprobante`,
  "0001-00000123"), no más el prefijo del UUID de la venta. En el POS viaja en
  la respuesta de `registrarVentaAction` (sin consulta extra); en el historial
  entra por embed en `getVentasAction`. Las dos puntas caen al prefijo del UUID
  si no hay comprobante — ventas anteriores a la tabla, o emisiones fallidas —
  así que ningún ticket queda sin número que decirle al cliente.
- Tratamiento de IVA del producto: UN campo (`productos.tratamiento_iva`:
  GRAVADO_21 | GRAVADO_105 | GRAVADO_27 | EXENTO | NO_GRAVADO), no dos. Con
  "alícuota" y "exento/gravado" separados existen combinaciones imposibles
  —exento con 21%, gravado sin alícuota— y alguien las guarda. EXENTO y
  NO_GRAVADO se distinguen aunque los dos den cero: van en columnas distintas
  del libro de IVA. El criterio vive en `shared/lib/fiscal-producto.ts` con el
  desglose (`desglosarIva`), y OJO con la dirección de esa cuenta: el neto es
  `precio / (1 + alícuota/100)`, NO `precio - precio * alícuota/100` — con 21%
  la segunda da 79 en vez de 82,64 sobre 100.
  `unidad_medida` guarda la unidad SEMÁNTICA, no el código numérico de ARCA: la
  traducción entra con la integración, donde se puede verificar contra la tabla
  oficial. Los defaults salen del rubro (`defaultsFiscalesPorRubro`) y se COPIAN
  al producto en el alta: son punto de partida, no regla viva — cambiar el rubro
  del comercio NO recalcula lo ya cargado.
  El bloque fiscal del formulario va COLAPSADO y, cerrado, no monta sus inputs;
  las actions miran `formData.has(...)`. Es lo que evita que corregir un precio
  le devuelva al 21% un producto que estaba al 10,5% — mismo patrón que el
  toggle fiscal del cliente.
- Cliente comercial y cliente fiscal son el MISMO cliente con dos niveles de
  datos, no dos entidades: lo fiscal (razón social, CUIT, condición IVA,
  domicilio fiscal) es opcional y se revela con el toggle `es_fiscal`. Apagar
  el toggle BORRA los datos fiscales, y es a propósito — por eso el modal de
  edición siembra el switch desde `cliente.cuit` durante el render (no en un
  useEffect): si arrancara apagado, guardar sin tocarlo le borraría al cliente
  todos sus datos fiscales sin avisar. `direccion_comercial` (contacto/entrega)
  es OTRA columna que `direccion` (domicilio fiscal, el que va en la factura):
  antes solo existía la fiscal, así que un cliente sin CUIT no podía tener
  dirección ni para mandarle mercadería.
  El CUIT se valida por dígito verificador (`shared/lib/cuit.ts`, módulo 11) en
  el form y otra vez en la action, y se guarda normalizado a 11 dígitos para
  que "30-712..." y "30712..." no entren como dos clientes. Es la mitad del
  autocompletado de ARCA que se puede tener sin certificado: no dice quién es
  el titular, pero atrapa el dígito mal tipeado en el mostrador y no dos días
  después. `(negocio_id, cuit)` y `(negocio_id, dni)` son únicos con índice
  PARCIAL (la mayoría no tiene ninguno de los dos, y el filtro cubre tanto NULL
  como cadena vacía); son por negocio porque dos comercios comparten clientes.
  Hasta que se agregaron, el `if (error.code === "23505")` de crearCliente era
  código muerto y los duplicados entraban sin chistar.
- Anular una venta CON FACTURA está frenado (`requiereNotaCredito` en
  cancel-sale.ts): una factura no se anula marcando la venta, se compensa con
  una nota de crédito, que necesita su CAE y por lo tanto ARCA. Dejar pasar la
  anulación dejaría una factura viva en ARCA contra una venta que el sistema
  da por anulada. Con TICKET interno NUNCA se activa, así que hoy anular
  funciona igual que siempre; es la red para el día que se prenda ARCA.
- **Egress (auditoría del 16/9/2026).** Medido sobre 24 h de logs de Supabase
  (60.591 requests): hoy no hay un culpable grande. El que había —el catálogo
  del panel bajado entero 6.849 veces/día, ~1,68 GB/día— lo resolvió la sync
  por delta del 3/9 (`catalogo-delta.ts`: 3 bajadas completas de Evens por
  día contra 643 deltas). Lo que queda son ~130–160 MB/día repartidos entre
  Storage (~40 MB, 78 % CDN hit), el sobrecosto de ~60.000 requests (~40 MB)
  y consultas que traen historial o catálogo completo. Dos cosas se cerraron
  ese día, y son las que escalaban mal:
  * **El panel (`/`) pide ventas con ventana**, no el historial entero.
    `features/dashboard/lib/ventana-historial-panel.ts` ES LA LISTA de hasta
    dónde mira cada regla del panel (comparación, día típico, gráfico,
    Insights, quiebres, temporada, inventario estancado) y de ahí sale el
    `desde` de ventas, egresos y cobros de CC. Cualquier regla nueva que
    necesite más historia se agrega AHÍ, no en la página: una regla que mire
    más atrás que la ventana no falla, devuelve un número más chico en
    silencio. El productos del panel es `getProductosPanelAction`
    (`ProductoPanel`: sin variantes ni fotos; 2.348 kB → 772 kB en Evens).
    Sigue leyendo el stock del espejo `productos_stock`, que es deuda aparte.
    `/reportes` queda con el historial completo a propósito: tiene "histórico"
    y el CRM mide recencia sobre toda la vida de la clienta.
  * **El índice del catálogo público lee del mismo `unstable_cache` que el
    render** (`shared/actions/indice-catalogo-publico.ts`). La action anterior
    ejecutaba la consulta entera por visitante —301 kB en el cable, 1,8 MB
    crudos en Evens— aunque el server acababa de servirla desde el cache. El
    negocio se resuelve DEL HEADER que escribe el middleware, nunca de un
    parámetro: la clave del cache es el `negocio_id`, y un id mandado desde el
    navegador con el slug de otro negocio dejaría el catálogo de uno en el
    cache del otro.
  Verificado que el tramo Vercel → Supabase viaja gzip (~6:1): los "MB crudos"
  de los comentarios se dividen por seis para pensar en egress de Supabase.
  Lo que NO se tocó y cuesta requests, no bytes: polling de caja (3 req/min
  por pestaña), `tiene_permiso` por permiso, `unidades_serie` en cada cambio
  del carrito sin gatear por rubro, ~10 consultas de layout por navegación.

## Aprendizajes que ya costaron plata (no repetir)

- **Renombrar una variante NO termina en la base: el nombre también vive en el
  catálogo cacheado de cada celular.** La venta buscaba el espejo legacy por
  `producto_id | nombre_que_trae_el_carrito`, y ese nombre sale de la copia
  local del catálogo. El 5/9/2026, sacar `Género` renombró 1.718 variantes de
  Evens a las 00:12; los dispositivos que no habían resincronizado siguieron
  mandando `"Azul/celeste / 2 / Hombre"` contra un espejo que ya decía
  `"Azul/celeste / 2"`, y la venta se caía con **"Error de stock en ..."** con
  la mercadería sobre el mostrador. La base estaba PERFECTA —cero variantes sin
  fila espejo, stock y espejo en 1 y 1— y aun así no se podía vender.
  El síntoma que lo identifica: el nombre del error **incluye el género**, que
  es justo el pedazo que dejó de existir.
  Dos cosas, y la segunda es la que hay que recordar:
  1. `create-sale.ts` ya no depende del texto: resuelve la variante por
     `varianteId` (que un renombre NO cambia) y busca el espejo por su nombre
     ACTUAL, dejando el del carrito como respaldo. En `ventas_items.variante`
     se guarda el nombre vigente, no el del carrito.
  2. **Un renombre masivo en producción necesita, además de la migración, que
     los dispositivos del local refresquen.** La sincronización incremental
     (`catalogo-delta.ts`) los trae sola porque la migración bumpea
     `producto_variantes.updated_at` — pero recién en el próximo sync. Si el
     cambio es de nombres, hay que avisar de recargar el POS, o esperar que
     alguien no pueda vender.
  Ojo con lo que el refresh NO arregla: una variante BORRADA (la unificación de
  duplicados borró 3 de `JEANS COQUETTAS`) no se puede vender desde un catálogo
  viejo ni con el fix, porque ya no existe. Ahí el refresh es la única salida.
- **Un UPDATE filtrado por RLS es un ÉXITO silencioso, no un error.** PostgREST
  devuelve 0 filas y `error: null`, así que un `.update(...).eq(...)` sin
  `.select()` no distingue "guardado" de "no tenías permiso". Todo update que
  el usuario cree que guardó algo lleva `.select("id")` y chequeo de filas
  afectadas.
  Costó un día de trabajo de una empleada: el 5/9/2026 se exigió
  `stock.editar_producto` para escribir `productos` (`20260905123115`) creyendo
  que ninguna vendedora lo necesitaba — la UI de /stock y de fotos-pendientes
  ya gateaban por admin. Faltó un camino: el botón de foto DENTRO del sheet de
  edición sí es alcanzable por una vendedora, y llama
  `actualizarFotosProductoAction`, que hace `UPDATE productos`. Mara subió
  fotos entre las 12:52 y las 13:38 (la migración entró 12:31): **104 de 113
  archivos quedaron huérfanos en Storage, 35 fotos perdidas**, con la pantalla
  diciendo "Foto guardada" en cada una y CERO errores en Vercel. Revertido en
  `20260905170000`.
  Las dos lecciones, y la segunda es la que importa: (1) antes de restringir
  una tabla, buscar quién la escribe siguiendo el CÓDIGO, no lo que la UI
  parece esconder — un botón adentro de un sheet no aparece en el grep de
  `isAdmin`; (2) el permiso que falta tiene que doler donde falta.
- **Un dato duplicado en dos tablas se desincroniza, y el que manda no es el
  que se ve.** El precio vive en `productos` y en `producto_variantes`; el
  remito escribía uno solo y la caja cobra el otro. Estuvo así desde julio y lo
  descubrió la dueña, no el sistema: nada comparaba los dos números. Las dos
  reglas que quedan: **el que escribe un dato espejado escribe los DOS lados o
  ninguno**, y **antes de calcular sobre un precio (o un stock, o un saldo),
  verificar cuál de las dos copias es la que se usa en la venta**. Es el mismo
  patrón que `productos_stock`, que sí está documentado como espejo — la
  diferencia era que del precio nadie había escrito que lo fuera.
- **El funnel del panel no veía dónde se pierde la gente, porque empezaba
  después.** `funnel_comerz` arranca en `negocios.created_at`: su primer
  escalón es "el negocio ya existe". Las cuatro personas que confirmaron el
  mail, entraron y nunca crearon nada no aparecían ahí **ni como fila** — para
  entrar a esa tabla hay que haber pasado justamente el paso donde se cayeron.
  `embudo_de_alta` (`20260909120000`) cubre el tramo de antes y termina donde
  el otro empieza. Medido el 9/9/2026 sobre 17 altas: **100% crea la cuenta,
  88% confirma el mail, 82% recibe sesión y 41% crea el negocio.** El mail se
  lleva 3 de 17; el último paso se lleva 7. La mediana hasta confirmar es de
  **24 segundos**, que es el dato que cierra la discusión sobre si el problema
  es la entrega.
  El escalón **"vio el formulario"** (`20260909140000`) es el ÚNICO que no se
  deduce de `auth.users`: lo escribe el propio onboarding al mostrar el paso 2,
  vía `registrar_paso_onboarding`. Esa función es SECURITY DEFINER y lo que la
  acota es que **no recibe el usuario**: sale de `auth.uid()`, el `negocio_id`
  va null siempre y el paso se valida contra una lista cerrada — nadie escribe
  a nombre de otro. Idempotente por (usuario, paso): interesa cuándo lo vio la
  primera vez, no cuántas veces recargó. Hizo falta una tabla propia porque las
  dos que existían no servían: `eventos_uso.negocio_id` es NOT NULL y el alta
  pasa entera antes de que haya negocio, y `eventos_comerz` solo la escribe el
  super admin.
  **OJO con el tercer escalón: "sesión creada" NO es "entró".** Sale de
  `auth.users.last_sign_in_at`, que Supabase escribe cuando EMITE el token —
  o sea en el `POST /auth/v1/token` que dispara `/auth/callback` al canjear el
  link. La persona no tocó nada, y con el bug del doble canje terminaba viendo
  "El enlace venció". Por eso existe `sesionSoloDelLink`: si la última sesión
  está a menos de un minuto de la confirmación, no hubo ninguna posterior — la
  emitió el mail y la persona no volvió. **6 de los 10 que quedaron sin negocio
  están en ese estado**, o sea que la hipótesis de "vio el formulario del paso
  2 y abandonó" casi no tiene casos: la mayoría no llegó a ver nada. Medir de
  verdad "vio el paso 2" necesita un evento propio en el onboarding, que
  todavía no existe.
  Lee `auth.users`, así que es SECURITY DEFINER y **el `where
  security.is_super_admin()` es lo único que la protege** — misma forma que
  `funnel_comerz`, con un guard que falla si el filtro desaparece. Verificado
  simulando a una ADMIN de negocio: 0 filas.
  **Las cuentas de prueba propias salen del denominador**, y la mayoría se
  deduce sin marcar nada: `ignacionweppler+4@gmail.com` es un subaddress de una
  casilla que YA está registrada, o sea que va al mismo buzón y es de la misma
  persona. Eran 4 de las 10 "pérdidas" del 9/9. Lo que NO se hace es adivinar
  por el nombre del mail —nada de buscar "test" o "prueba"—: esconder un
  cliente real del embudo es peor que contar una prueba de más. Para la prueba
  hecha con otro mail está `usuarios_prueba` (`20260909130000`) y un botón en
  la lista; las marcadas siguen apareciendo, para poder desmarcarlas.
  Devuelve HECHOS, no métricas: las etapas, la tasa y a quién se excluye se
  deciden en `features/admin/lib/embudo-alta.ts` con tests. **"Cuenta sin
  negocio" no es una sola cosa**: el super admin no tiene negocio por diseño,
  un empleado invitado no crea ninguno, y uno que todavía no usó su link se ve
  idéntico a un dueño que abandonó — se separan por la invitación pendiente,
  el mismo criterio que `destinoSinNegocio`. Contarlos juntos infla el agujero
  con gente que está bien.
- **Continuar con Google + "Confirm email" apagado abren un agujero JUNTOS.**
  Supabase vincula identidades cuando el mail coincide y viene verificado del
  proveedor; Google siempre lo verifica. Pero con la confirmación apagada
  (9/9/2026) cualquiera puede registrarse con un mail ajeno y esa cuenta queda
  con `email_confirmed_at` puesto sin que nadie lo haya probado. Si después el
  dueño real entra con Google, cae en ESA cuenta — y el que la creó tiene la
  contraseña. Las dos decisiones por separado son razonables; juntas, no.
  Está escrito en `shared/lib/auth-google.ts` con las dos salidas posibles, y
  **hay que elegir una antes de prender el flag en producción**. Por eso
  `GOOGLE_AUTH_HABILITADO` es una env var con default apagado y solo el
  literal `"on"` la prende: el orden es configurar OAuth en el dashboard,
  decidir esto, y recién ahí prender.
- **El claim del token es una FOTO, y crear el primer negocio la deja vieja.**
  El middleware no lee las membresías de la base: las lee del claim `comerz`,
  que el custom access token hook (`20260903110000`) calculó al EMITIR el
  token. En el alta ese token se emite en el `signUp`, cuando la persona
  todavía no tiene ningún negocio — y treinta segundos después crea el suyo.
  El resultado, medido el 9/9/2026 con `ignacionweppler+5` (registro 13:40:23,
  negocio 13:41:10, cuatro pasadas por el gate en dos segundos):
  `/` → el claim dice "ningún negocio" → `/seleccionar-negocio` → la base dice
  "uno" → `redirect("/")` → **ERR_TOO_MANY_REDIRECTS**.
  Es la MISMA forma del incidente de `sesion-interrumpida.ts` y del de
  `salir-sesion.ts`, con un disparador nuevo: dos lugares que responden la
  misma pregunta con distinta información y se la pasan para siempre. **Cada
  vez que aparece un rebote infinito en el panel, buscar las dos fuentes que se
  contradicen antes que el redirect.**
  **Y la misma contradicción estaba en el conteo, con otro disfraz**: el gate 4
  contaba TODAS las membresías mientras `listarMisNegociosAction` filtra por
  `negocioHabilitado`. Con la única membresía en `cancelado` el middleware
  decía "tenés uno, andá a elegir" y el selector contestaba "no tenés ninguno,
  andá al login". Ahora el gate pide el estado y cuenta habilitados: cero
  habilitados con membresías va a `/auth?error=sin-negocio`, y **uno solo lo
  elige el middleware seteando la cookie** — porque `current_negocio_id()`
  cuenta membresías sin mirar estado, así que con un negocio muerto al lado
  devuelve null y el selector redirigía a `/` sin dejar nada elegido.
  Se arregló en las dos puntas, y las dos hacen falta: `crearNegocioAction` y
  `aceptarInvitacionAction` refrescan el token (son los DOS únicos momentos en
  que cambian las membresías), y el gate 4 del middleware, cuando el conteo
  desmiente al claim, le pregunta a la base en vez de rebotar. Lo primero
  arregla el caso conocido; lo segundo, el próximo — un cambio de rol deja el
  claim igual de viejo y nadie se va a acordar de este archivo.
- **Un handler que canjea un token de un solo uso tiene que poder correr dos
  veces.** `/auth/callback` se ejecuta DOS veces con el mismo `code` de PKCE.
  Medido en producción el 9/9/2026: `POST /auth/v1/token` 200 a las 11:57:48 y
  404 con el MISMO code a las 11:57:49. El primero crea la sesión, el segundo
  falla siempre, y como el navegador ve la respuesta del segundo, la versión
  vieja mandaba a `/auth?error=El enlace venció` a alguien que acababa de
  quedar logueado.
  Eso explica a las **4 personas que entre agosto y septiembre confirmaron el
  mail, iniciaron sesión y nunca crearon su negocio** — están en `auth.users`
  con `email_confirmed_at` y `last_sign_in_at` cargados y cero filas en
  `usuarios_negocios`. No era fricción de onboarding: el sistema las autenticó
  y acto seguido les dijo que el link no servía.
  Por qué corre dos veces NO está identificado: no es el service worker
  (`public/sw.js` no tiene `NavigationRoute` ni handler de `fetch`) y no es un
  reintento del cliente (los dos POST salen con user agent `node`, o sea dos
  ejecuciones reales del handler). Queda el prefetch del navegador o del
  cliente de correo. El arreglo no depende de saberlo: **el callback termina
  siempre en `destino` y nunca en una pantalla de error.** Un cartel de "el
  enlace venció" no le cambiaba la acción a nadie — `/onboarding` es público y
  detecta la sesión: con sesión arranca en el paso 2 y sin sesión en el paso 1,
  que es lo que la persona tiene que hacer en cada caso.
- **`Suspense` con `fallback={null}` alrededor de una pantalla entera es una
  pantalla en blanco.** `/auth` envolvía todo `AuthPanel` así, cuando lo único
  que suspende es `LoginForm` (usa `useSearchParams`). Mientras ese árbol no
  hidratara no había NADA — y en mobile es literal, porque la marca vive
  adentro del panel; en desktop al menos quedaba el logo de la esquina. En un
  celular con mala señal se queda así para siempre. Es el síntoma que apareció
  acompañando a una clienta el 7/9/2026, y venía encadenado al bug de arriba:
  el callback la mandaba a `/auth` y `/auth` no mostraba nada.
  La boundary va alrededor de lo que suspende, no de la pantalla, y el fallback
  tiene que ser un esqueleto: es la diferencia entre "está cargando" y "se
  rompió".
- **Un `.filter()` que descarta filas antes de escribir es pérdida de datos en
  silencio.** `aprobarOrdenAction` armaba el payload del remito con
  `itemsResueltos.filter((item) => item.producto_id)`: las líneas sin vincular
  desaparecían, la RPC nunca se enteraba y la orden quedaba APROBADA. El único
  freno era `handleAprobar` en el cliente, que mira el estado de React y no las
  filas de la base — si un grupo no llegaba a ese estado (borrador restaurado a
  medias, fila fuera de `items`), no lo veía.
  **Costó 213 líneas / 416 unidades / ~$2,81 M de costo** entre julio y agosto
  de 2026: mercadería que entró por un remito aprobado y nunca tocó el stock,
  sin un solo error. 196 líneas en julio, 17 en agosto, 0 desde que
  `20260908130000` puso el guard `REMITO_LINEAS_SIN_PRODUCTO` en la RPC, que
  compara contra `ordenes_items` real.
  Las dos reglas: **la validación que cuenta es la que mira la BASE, no el
  estado del cliente** (un server action es un endpoint), y **descartar filas
  en silencio antes de un INSERT no es filtrar, es perder**. Si sobran filas,
  se falla con los nombres puestos.
  Ojo con el diagnóstico, que también tiene trampa: de las 322 líneas de
  remitos aprobados con `producto_id` en null, **109 no son pérdida** — se
  impactaron bien y quedaron huérfanas después porque `ordenes_items.producto_id`
  es ON DELETE SET NULL y alguien borró el producto. El discriminador es
  `variante_match`: la RPC lo escribe junto con `producto_id` al impactar, así
  que lleno + `producto_id` null significa "entró y después se borró el
  producto", no "nunca entró".
- **Timeout de UI ≠ cancelación de server action.** `withTimeout` solo rechaza
  la promesa del cliente; el server sigue hasta el final. Nunca envolver en
  `withTimeout` una acción que muta stock o plata (ver comentario en
  merge-table.tsx). Incidente 27/7 en Estilo Bonito: 8 reintentos = stock ×8
  (1960 unidades donde iban 245).
- **UPDATE condicional + chequeo de filas afectadas ANTES de cualquier
  escritura derivada.** Mismo bug apareció en cancel-sale.ts (reembolso
  fantasma) y en aprobar_orden_compra. Un `select` previo NO sirve: dos
  llamadas concurrentes leen lo mismo y las dos escriben.
- **Un cambio no está terminado hasta las 3 patas** (migración aplicada +
  push con deploy verde + smoke test real). Regla arriba del todo.
- **Lo que se aplica a mano y no queda como migración, se pierde.** Era el
  drift entre bases; con una sola base sigue valiendo igual, porque el repo
  tiene que poder reconstruir el schema desde cero.
- **Una migración ahora toca a todos los negocios.** El modelo por-proyecto
  daba, sin querer, un release gradual: se aplicaba en uno y se miraba. Eso
  ya no existe — lo reemplaza probar bien antes, y preferir cambios
  aditivos y reversibles.
- **El aislamiento entre negocios es RLS, no el código.** Filtrar por
  `negocio_id` en la query es defensa en profundidad; si una tabla nueva
  queda sin policy RESTRICTIVE, un negocio ve los datos de otro.
- **Y el aislamiento entre ROLES también es RLS** (`20260905120000`). Aislar
  el negocio no alcanzaba: adentro del comercio las policies de configuración
  y catálogo decían `true` o `auth.role() = 'authenticated'`, así que
  cualquier miembro con cualquier rol podía escribirlas. Medido simulando a
  una VENDEDORA de Evens: pudo tocar `configuracion_pos` (el
  `cc_recargo_default` del 15%, el modo de facturación), `metodos_pago`
  (`comision` y `recargo_porcentaje`), los precios de los 1.253 productos y
  las 3 promociones. Y no hace falta un server action: el navegador ya tiene
  supabase-js con la sesión, así que alcanza con la consola.
  El corte NO se inventó: ya estaba declarado en `permisos` / `rol_permisos`
  desde `20260717001048`. La migración solo hace que la base lo cumpla —
  `productos` pide `stock.editar_producto` (borrar, `stock.eliminar_producto`),
  `categorias` pide `stock.cambiar_categoria`, y `configuracion_pos`,
  `metodos_pago` y el alta/baja de promociones piden `is_admin()`.
  **Tres tablas quedaron abiertas a propósito y hay que saber por qué**:
  `producto_variantes`, `productos_stock` y el UPDATE de `promociones`. La
  venta las escribe con la RLS de quien vende (`ajustar_stock_variante` y
  `registrar_venta` son SECURITY INVOKER a propósito) y la RLS es por FILA,
  no por columna: no hay policy que diga "puede tocar `stock` pero no
  `precio`". Cerrarlas deja al mostrador sin poder vender. La salida es mover
  esa escritura angosta a una función SECURITY DEFINER que valide el negocio
  por su cuenta y recién entonces cerrar la tabla; toca el camino de la venta,
  así que va sola.
  El predicado va `(select public.tiene_permiso('...'))` CON subselect, misma
  razón que `current_negocio_id()`: sin él la función se evalúa una vez por
  fila y un update masivo de precios pasa de 1 llamada a 1.253.
  Ojo al escribir guards sobre `pg_policies`: en una policy de INSERT `qual`
  es SIEMPRE null y en una de DELETE lo es `with_check`, así que un
  `coalesce(qual,'true')` marca como agujero a toda policy bien escrita. El
  primer guard de esta migración abortó por eso una migración correcta.

## Estado al 8/8/2026 (viernes)

La decisión de arquitectura SaaS ya se tomó y está ejecutada: multi-tenant
por `negocio_id` en una sola base. Los 4 negocios corren ahí, con
`usuarios_negocios`, negocio activo por header, super admin con modo dios y
planes por negocio.

Hecho y en producción:

- Idempotencia de aprobación de remitos (guard + `ya_aprobada` consumido por
  merge-purchase.ts / merge-table.tsx).
- Baseline de RLS versionado, `thumbnail_url`, `rubro` + `modelo`,
  `id_master`.
- Catálogo Maestro + búsqueda por texto; Carga Rápida con picker de maestro,
  prefill y quick-create.
- Merge de remitos: sugerencias de match y de categoría, umbral y audiencia,
  clasificación de match (T1/T2/T3). Gotcha visto en datos reales:
  `estado_match` guardado puede quedar stale.
- Categorías en árbol (Evens ya no es catálogo plano; REGLAS_CATEGORIA quedó
  obsoleto y silencioso).
- Seed de métodos de pago default; CC + método de pago; historial de
  movimientos por producto (`features/stock/ui/movimientos-table.tsx`).

En curso (código sin pushear al 8/8):

- Panel: selector de período único (Hoy/Semana/Mes/Año) que gobierna también
  el gráfico, con comparación contra el período anterior equivalente; gráfico
  mobile sin eje Y y con tooltip táctil; header sin duplicar el comercio
  activo (el logo ES el switcher); dropdowns con blanco táctil de 44px en
  mobile.
- Ingreso de mercadería separado por rubro y RPC
  `importar_productos_planilla` (esta SÍ está aplicada en la base).
- Base fiscal previa a ARCA: `configuracion_pos.modo_facturacion` /
  `comprobante_defecto` / `punto_venta`, tabla `comprobantes` +
  `comprobante_numeracion` y permiso `configuracion.facturacion` (las DOS
  migraciones SÍ están aplicadas; los 4 negocios quedaron en INTERNO/TICKET,
  o sea sin cambio de comportamiento). El TicketPanel pasó de maqueta a
  guardar de verdad: su submit era un `setTimeout` con toast de éxito. Se
  sacó el wizard de CSR, que "generaba" un CSR de texto fijo y avisaba
  "certificado .p12 guardado en el servidor" sin subir nada.

- Emisión conectada de punta a punta: create-sale.ts escribe en `comprobantes`
  (paso 11), el número emitido se imprime en el ticket y en el historial, y la
  anulación tiene el freno de nota de crédito. Los 4 negocios emiten TICKET
  interno, que es lo que necesitan hoy; el terreno queda listo para facturar.

- Exportaciones (Excel) de Ventas, Comprobantes, Compras, Movimientos de caja
  y Movimientos generales. Libros de IVA y notas de crédito/débito listados
  pero deshabilitados, cada uno explicando qué le falta.
- Determinación centralizada del comprobante (`determinar-comprobante.ts`,
  27 tests sobre la matriz real). Se eliminó `tipoComprobanteAEmitir`, que
  miraba solo la config y nunca al cliente: dos funciones que responden la
  misma pregunta con distinta información terminan en dos respuestas distintas.
- Productos: `tratamiento_iva`, `unidad_medida` y `genero`, con defaults por
  rubro y bloque fiscal colapsado. Los 1.606 productos existentes quedaron en
  21% + Unidad, que es lo correcto para los 4 negocios. Falta el desglose de
  IVA en el comprobante: `comprobantes` tiene UN neto y UN iva_monto, y una
  factura con líneas al 21% y al 10,5% necesita subtotales POR alícuota — eso
  es una tabla hija y entra con ARCA.
- Clientes: dirección para el no-fiscal, validación de CUIT por dígito
  verificador y unicidad de CUIT/DNI por negocio. El autocompletado del
  padrón (tipear CUIT → traer razón social y condición) NO se puede hacer
  todavía: los web services de padrón de ARCA piden WSAA con el MISMO
  certificado X.509 que la facturación, así que está bloqueado por lo mismo.
  Se sacó el botón "Buscar en ARCA", que era un setTimeout con un toast.

Lo único que falta para facturar de verdad es la conexión con ARCA: generar el
CSR, cargar el certificado y pedir el CAE. Cuando se haga hay que revisar DOS
decisiones que hoy están tomadas para el mundo sin ARCA: el comprobante se
emite DESPUÉS de cerrar la venta (con factura el CAE va antes) y la anulación
frena en vez de emitir la nota de crédito. Ojo: lo vendido ANTES de esto no es
recuperable hacia atrás — solo hay datos fiscales desde que el POS empezó a
escribir la tabla.

Próximo en el importador de planilla, por orden de riesgo: idempotencia por
hash del archivo (hoy reimportar suma stock de nuevo), plan firmado (el plan
que se aprueba en la preview se recalcula al confirmar y puede haber
cambiado), y preview filtrable con corrección inline.
