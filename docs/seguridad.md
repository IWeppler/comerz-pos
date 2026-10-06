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
  `stock_minimo`), `productos_stock`, `promociones` (activas) y pivotes,
  `metodos_pago` (activos, SIN `comision`; sí `recargo_porcentaje`), e INSERT-only en
  `solicitudes_comercio`.
- Todas menos `negocios` llevan la RESTRICTIVE `aislamiento_negocio_publico`
  (`negocio_id = security.negocio_publico()`, fail-closed: sin header no hay tienda).
- **Pedir una columna no concedida devuelve 403 y la tienda se cae ENTERA.**
  `COLUMNAS_PRODUCTO_PUBLICO` la comparten catálogo y POS: sumarle una columna exige
  el GRANT a `anon` en la misma migración (`unidad_medida`, `20260819140000`, con
  guard de que el costo sigue oculto).
- Riesgo asumido: `anon` lista los negocios activos (lo necesita `tenant.ts` antes de
  saber el slug).
- El schema `archivo` guarda backups sin USAGE para nadie.

## Auth y sesión

Ver [alta-y-sesion.md](alta-y-sesion.md): claim del token, callback de un solo uso,
Google + confirmación de mail.
