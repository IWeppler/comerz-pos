# Seguridad: RLS, permisos, acceso anónimo

Leé esto antes de crear una tabla, escribir o cambiar una policy, una función
SECURITY DEFINER, un GRANT, un permiso nuevo, o cualquier cosa que lea el catálogo
público. Las reglas de forma (cómo se escribe una policy) están también en
AGENTS.md porque aplican a toda migración.

## Aislamiento entre negocios

- **Es RLS, no el código.** Toda tabla del tenant tiene `negocio_id` (DEFAULT
  `security.current_negocio_id()`) y una policy RESTRICTIVE de negocio. Filtrar por
  `negocio_id` en la query es defensa en profundidad. **Una tabla nueva sin su policy
  es un negocio viendo los datos de otro.**
- **Forma de la policy**: `negocio_id = (select security.current_negocio_id())`,
  NUNCA `security.same_negocio(negocio_id)`. Mismo resultado, pero la segunda se
  ejecuta una vez POR FILA y el índice no se usa (132 ms contra 4 ms; era la causa de
  listados de 2 s). Guard en `20260816100000`.
- La cookie `negocio_activo_id` viaja como header `x-negocio-activo`; NO es
  credencial: `current_negocio_id()` valida contra `usuarios_negocios`.
- Modo Dios: `x-impersonate-negocio`, honrado solo si `security.is_super_admin()`.
- **SECURITY DEFINER apaga la RLS**: filtrar `negocio_id` en CADA consulta, a mano,
  incluidas las tablas hijas (caso `registrar_devolucion`, ver
  [ventas.md](ventas.md)). Preferir INVOKER cuando el aislamiento puede seguir
  siendo la RLS de quien llama.
- **`revoke ... from public` NO alcanza en funciones internas**: Supabase da EXECUTE
  a `anon` y `authenticated` por default privileges; hay que nombrarlos (guard con
  `has_function_privilege`). `cuenta_financiera_sistema` y `sembrar_*` revocaron solo
  de public: deuda.

## Aislamiento entre ROLES (`20260905120000`)

- Dentro del comercio, el corte es `permisos` / `rol_permisos` +
  `tiene_permiso(clave)` (generaliza `is_admin()`). Roles ADMIN / ENCARGADO /
  VENDEDOR; `perfiles.rol` (texto legacy) se sincroniza, ENCARGADO → 'VENDEDOR'.
  Pertenencia y rol son POR NEGOCIO (`usuarios_negocios`).
- Las policies de configuración y catálogo exigen permiso: `productos` pide
  `stock.editar_producto` (borrar `stock.eliminar_producto`), `categorias`
  `stock.cambiar_categoria`, y `configuracion_pos`, `metodos_pago` y alta/baja de
  promociones `is_admin()`. Sin eso, una vendedora cambiaba precios y comisiones
  desde la consola del navegador.
- **Remitos piden `stock.ingresar_remito`** (`20261006140000`): escribir
  `ordenes_compra` / `ordenes_items` y todo `ordenes_borradores` /
  `diccionario_alias`. LEER órdenes y renglones sigue abierto al negocio porque el
  pago a proveedor de caja (`resumen_remitos_financiero`, INVOKER) lo usan las
  vendedoras. `aprobar_orden_compra_impl` y `crear_productos_desde_remito` lo exigen
  de entrada (`SIN_PERMISO`): con RLS sola, aprobar sin permiso devolvía un
  `ya_aprobada` engañoso (el UPDATE de la orden no veía filas). Probado como vendedora
  y admin reales del Kiosco Demo.
- **Crear clientes pide `clientes.crear`** (`20261006170000`): RESTRICTIVE de INSERT
  sobre `clientes` (alta del POS, ficha e importación CSV). Editar/leer/borrar no
  cambian. Se asignó a todos los roles menos ENCARGADO/VENDEDOR de Librería Colores
  (las vendedoras duplicaban clientes); `crear_negocio_con_owner` se lo da a
  ENCARGADO y VENDEDOR al alta. El botón del POS y de /clientes se esconden sin él.
- **Recargos de CC y deuda manual, solo ADMIN por default** (`20261007230000`,
  aplicada el 7/10/2026):
  - `ventas.fiar_sin_recargo` (nuevo): el "Anular" de RECARGO CC en el POS. Lo exigen
    `create-sale.ts` (antes de mover stock o pedir CAE) y `registrar_venta`
    (`SIN_PERMISO_FIAR_SIN_RECARGO` si el comercio tiene recargo > 0 y la venta
    fiada llega con porcentaje o monto en 0). Sin permiso, el ticket sigue
    mostrando "Aplicar" para deshacer un pedido que llegó a la caja sin recargo.
  - `clientes.cargar_saldo` (nuevo): "Cargar saldo" de la ficha y la deuda de la
    importación CSV. RESTRICTIVE de INSERT `cc_debito_manual_requiere_permiso`
    sobre `cuenta_corriente_movimientos`: el DÉBITO sin `venta_id` ni `pago_id`
    pide el permiso (los de las RPC llevan uno de los dos; la mora, `pago_id`).
    La importación se frena entera si trae deudas y no hay permiso: si no, el
    cliente nacía con saldo y sin su movimiento.
  - `clientes.corregir_cobro_cc` se sacó de ENCARGADO y VENDEDOR (15 filas; en Evens
    lo tenían las 4 vendedoras).
  - Los dos nuevos se asignaron solo al ADMIN; cada comercio los da a otros roles
    desde Empleados y permisos. Quedan abiertos, sin cambio: el UPDATE de
    movimientos manuales (`editarMovimientoManualAction` chequea `is_admin` en
    Node, la RLS no) y `ajustar_saldo_cliente` (INVOKER).
- **Tres tablas quedan abiertas a propósito**: `producto_variantes`,
  `productos_stock` y el UPDATE de `promociones`. La venta las escribe con la RLS de
  quien vende (INVOKER) y la RLS es por fila, no por columna. Cerrarlas pide mover la
  escritura angosta a una DEFINER que valide el negocio; toca el camino de la venta.
- El predicado va `(select public.tiene_permiso('...'))` CON subselect (misma razón
  que `current_negocio_id`).
- **Antes de restringir una tabla, buscar quién la escribe siguiendo el CÓDIGO**, no
  lo que la UI parece esconder: un botón dentro de un sheet no aparece en el grep de
  `isAdmin` (5/9: 35 fotos perdidas con "Foto guardada" en pantalla).
- Guards sobre `pg_policies`: en una policy de INSERT `qual` es SIEMPRE null y en
  una de DELETE lo es `with_check`.
- La pantalla de roles lee el catálogo `permisos` entero: un permiso nuevo aparece
  solo. `crear_negocio_con_owner` le da al ADMIN todas las filas de `permisos`.

## Acceso anónimo: cerrado por default (`20260811140000`)

La anon key es pública y el tenant del catálogo se elige con un header: **todo lo que
`anon` pueda leer es público para todos los negocios con un `curl`.** Que la UI no lo
muestre no es control de acceso.
- Se revocó todo a `anon` y se cambiaron los default privileges: **una tabla nueva
  nace cerrada para anon.**
- SELECT columna por columna solo sobre: `negocios` (activos), `configuracion_pos`
  (branding, contacto, envío), `categorias` (activas), `productos` (publicados, SIN
  `precio_costo` ni `id_master`), `producto_variantes` (activas, SIN `costo` ni
  `stock_minimo`), `productos_stock`, `promociones` (activas; cambio local de cupones debajo) y pivotes,
  `metodos_pago` (activos, SIN `comision`; sí `recargo_porcentaje`), e INSERT-only en
  `solicitudes_comercio`.
- EXECUTE en `registrar_pedido_catalogo` (`20261007150000`): DEFINER, negocio desde
  `negocio_publico()`, solo escribe un evento `PEDIDO_CATALOGO` en `eventos_uso` sin
  datos personales, tope de 20 por minuto por negocio. `anon` sigue sin acceso a la
  tabla. Ver [tienda-online.md](tienda-online.md).
- Todas menos `negocios` llevan la RESTRICTIVE `aislamiento_negocio_publico`
  (`negocio_id = security.negocio_publico()`, fail-closed: sin header no hay tienda).
- **Pedir una columna no concedida devuelve 403 y la tienda se cae ENTERA.**
  `COLUMNAS_PRODUCTO_PUBLICO` la comparten catálogo y POS: sumarle una columna exige
  el GRANT a `anon` en la misma migración (`unidad_medida`, `20260819140000`, con
  guard de que el costo sigue oculto).
- Riesgo asumido: `anon` lista los negocios activos (lo necesita `tenant.ts` antes de
  saber el slug).
- **Cupones, cambio local pendiente de aplicar** (`20261007200000`): `anon` solo
  enumera promociones automáticas activas. No se concede `codigo`; la RPC
  `validar_cupon_catalogo` devuelve una promoción concreta validada y sus
  condiciones, con negocio desde `negocio_publico()`. El contador vive privado en
  `security`. `sugerencias_carrito` (`20261007210000`, candidata pendiente de
  medición) solo devuelve IDs públicos; nunca datos de ventas. Estado y validación:
  [catalogo-marketing.md](catalogo-marketing.md).
- El schema `archivo` guarda backups sin USAGE para nadie.

Ampliación local de asociaciones del catálogo (`20261007220000`, sin aplicar):
`productos_complementarios_catalogo` nace cerrada a anon y sin escritura directa
de authenticated. Lectura con aislamiento RESTRICTIVE y `caja.ver_gerencial`;
`configurar_complemento_catalogo` valida ADMIN, negocio de sesión y ambos productos.
`analisis_complementos_catalogo` pide el permiso gerencial en la base. La fuente
compartida `security.compras_catalogo_180d` no concede EXECUTE a anon/authenticated.
La RPC pública sigue devolviendo únicamente IDs. Diseño y estado en
[catalogo-marketing.md](catalogo-marketing.md), ampliación de M4.

## Auth y sesión

Ver [alta-y-sesion.md](alta-y-sesion.md): claim del token, callback de un solo uso,
Google + confirmación de mail.
