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
  de public; saldado el 22/10/2026 (`20261022210000`) junto con `reglas_negocio` y
  `cuenta_actual_venta_pago`: quedan solo para postgres y service_role. Las llaman
  funciones DEFINER (corren como postgres), así que cerrarlas no rompe nada; una
  función INVOKER o una policy que las llame sí se rompería (la migración lo
  verifica).
- **Storage**: `productos` y `logos` aceptan solo png, jpeg, webp y avif (los de
  `shared/lib/formatos-imagen.ts`) y hasta 10 MB (el banner sube crudo desde el
  celular). Un formato nuevo en la app pide sumarlo también al bucket, o la subida
  falla con 400/415.

## Aislamiento entre ROLES (`20260905120000`)

- Dentro del comercio, el corte es `permisos` / `rol_permisos` +
  `tiene_permiso(clave)` (generaliza `is_admin()`). Roles ADMIN / ENCARGADO /
  VENDEDOR; `perfiles.rol` (texto legacy) se sincroniza, ENCARGADO → 'VENDEDOR'.
  Pertenencia y rol son POR NEGOCIO (`usuarios_negocios`).
- Las policies de configuración y catálogo exigen permiso: `productos` pide
  `stock.editar_producto` (borrar `stock.eliminar_producto`) — **OJO: hasta el 23/10/2026
  solo el borrado lo pedía; desde `20261023000000` el alta y el cambio de precio
  o costo también (por trigger, ver "Catálogo y stock por permiso")** —, `categorias`
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
    desde Empleados y permisos. El UPDATE de movimientos manuales y
    `ajustar_saldo_cliente`, que quedaban abiertos, se cerraron el 22/10/2026 (ver
    "Escritura DIRECTA vs. por RPC").
- **Escritura DIRECTA vs. por RPC** (`20261022220000`, auditoría del 22/10/2026).
  `clientes`, `cuenta_corriente_movimientos`, `promociones`, `producto_variantes`,
  `producto_variante_valores` y `productos_stock` tenían "permitir todo" para
  cualquier rol porque la venta (INVOKER) las escribe con la RLS de quien vende.
  Ahora `security.es_escritura_directa()` mira `request.path` (lo setea PostgREST en
  cada pedido): `'/clientes'` es directa, `'/rpc/…'` es dentro de una función, sin
  path no viene de PostgREST. La escritura DIRECTA pide permiso:
  - `clientes`: saldo (o alta con saldo ≠ 0) `clientes.cargar_saldo`; lista de
    precios ADMIN; borrar ADMIN. Por trigger (`trg_proteger_campos_cliente`), porque
    una policy no compara viejo con nuevo. service_role pasa.
  - `cuenta_corriente_movimientos`: CRÉDITO manual `clientes.cargar_saldo` (el DÉBITO
    ya lo pedía en todos los caminos); editar y borrar ADMIN.
  - `promociones`: editar ADMIN. Variantes y valores: EDITAR y BORRAR directo
    `stock.editar_producto`. El ALTA quedó abierta y `productos_stock` también
    (`20261022221000`): cerrarlas rompió el alta de producto de las vendedoras de
    Librería Colores, que no tienen ese permiso y crean productos a diario.
  - `productos`: las policies de INSERT y UPDATE siguen `true`; lo que cierra el
    alta y el precio es el trigger de `20261023000000` (ver abajo).
  - `ajustar_saldo_cliente` pide `clientes.cargar_saldo` adentro.
  - **Regla**: dentro de una RPC manda la RPC, así que **toda RPC que escribe estas
    tablas tiene que validar su propio permiso**. Desde `20261022230000` lo hacen
    `anular_venta` (`ventas.anular`), `registrar_cobro_cc` (`clientes.cobrar_cc`;
    service_role pasa porque la llama `aplicar_pago_mp_cobro_cc` desde el webhook),
    `importar_productos_planilla` (`stock.importar_planilla`) y
    `fusionar_productos` (`stock.eliminar_producto`). Medido antes: 0 usos sin
    permiso en 90 días.
  - **Catálogo y stock por permiso** (`20261023000000`, 23/10/2026). Antes se le dio
    `stock.editar_producto` al VENDEDOR de Librería Colores (único rol sin el
    permiso que hacía catálogo, medido en todos los comercios). Ahora:
    - `productos` por escritura directa: el ALTA y cambiar `precio` o
      `precio_costo` piden `stock.editar_producto` (`trg_proteger_campos_producto`).
      Fotos, publicación y categoría siguen abiertas: el 5/9/2026 cerrar
      `productos` entero dejó 104 fotos de vendedoras sin llegar a la base.
    - Alta directa de variantes y valores: `stock.editar_producto`;
      `productos_stock`: eso o `stock.dar_baja`.
    - `guardar_variantes_producto` (y `_impl`): `stock.editar_producto`.
    - `ajustar_stock_*` (`security.puede_ajustar_stock`): bajar pide
      `ventas.cobrar` / `stock.dar_baja` / `stock.editar_producto`; subir pide
      `stock.editar_producto` / `ventas.anular` / `ventas.devolver` /
      `stock.ingresar_remito`. Excepción: `REVERSO_VENTA` de una venta que no
      existe, hasta lo que ESE usuario descontó con ESA referencia (lo hace
      `create-sale.ts` cuando `registrar_venta` falla). service_role pasa.
    - **`stock.editar_producto` no lo mira la UI**: la pantalla deja intentar y el
      error llega traducido (`features/stock/lib/mensaje-permiso-stock.ts`).
      Pendiente: esconder la edición a quien no lo tiene.
    - Verificado en seco (15 casos) y en vivo después de aplicar: venta de una
      vendedora de Evens, alta de producto de una vendedora de Librería Colores.
  - **Antes de cerrar una escritura, medir quién la hace HOY** (movimientos_stock,
    anulada_por, importado_por…): el 22/10 una policy de alta de variantes rompió
    el alta de producto de Librería Colores por confiar en lo que decía este
    documento sobre `productos` en vez de mirar la base.
  - La lista de precios del cliente es una SUGERENCIA: en el POS la vendedora
    elige cualquier lista en el ticket. Cerrar la ficha no cierra eso.
  - Verificado en seco el 22/10 con la vendedora y la admin reales del Kiosco
    Demo, simulando las dos rutas (17 casos + lista de precios).
- El predicado va `(select public.tiene_permiso('...'))` CON subselect (misma razón
  que `current_negocio_id`).
- **Antes de restringir una tabla, buscar quién la escribe siguiendo el CÓDIGO**, no
  lo que la UI parece esconder: un botón dentro de un sheet no aparece en el grep de
  `isAdmin` (5/9: 35 fotos perdidas con "Foto guardada" en pantalla).
- Guards sobre `pg_policies`: en una policy de INSERT `qual` es SIEMPRE null y en
  una de DELETE lo es `with_check`.
- La pantalla de roles lee el catálogo `permisos` entero: un permiso nuevo aparece
  solo. `crear_negocio_con_owner` le da al ADMIN todas las filas de `permisos`.
- **Un ADMIN no maneja cuentas ajenas** (`20261022190000`, auditoría del
  22/10/2026). Hasta ahí, `alta_empleado_local` (DEFINER, llamable por PostgREST)
  sumaba al negocio CUALQUIER cuenta sin membresías, y `editarEmpleadoAction` le
  ponía contraseña con service_role: el admin de cualquier comercio podía
  quedarse con la cuenta del super admin (sin membresías, con su UUID visible en
  `movimientos_stock` de 4 comercios). Ahora:
  - `alta_empleado_local` solo acepta la cuenta que la action acaba de crear
    (< 10 min, sin login) y nunca al super admin (`USUARIO_NO_ELEGIBLE`).
  - `editar_empleado` devuelve `gestiona_acceso`, que decide mail, contraseña y
    cierre de sesiones: solo cuentas creadas en el mostrador y sin otro negocio.
    Afuera: invitadas (ACEPTADA a su mail), dueños, Google, super admin. La action
    falla cerrado si el dato no viene.
  - Las invitaciones nunca suman al super admin a un negocio.
  - **Regla**: una RPC que recibe un `usuario_id` y lo ata al negocio, o una action
    que toca Auth con service_role, tiene que probar que la cuenta es DEL negocio,
    no solo que quien llama es ADMIN.

## Acceso anónimo: cerrado por default (`20260811140000`)

Precios por cantidad (8/10, migración aplicada): columna pública de productos,
CHECK de forma y trigger INVOKER que protege su escritura con
`stock.editar_producto`. Mantiene las policies de aislamiento existentes.
Detalle y verificación en [stock-y-catalogo.md](stock-y-catalogo.md#precio-unitario-por-tramo-de-cantidad-8102026).

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
- Pagos del catálogo (`20261012133049`): `ordenes_tienda`, `ordenes_tienda_items`,
  `eventos_pago` cerradas a `anon` (la tienda va a entrar por RPC DEFINER); el panel
  solo las LEE con `tienda.ver_ordenes`. `mercadopago_conexiones`,
  `mercadopago_oauth_estados` y `ordenes_tienda_numeradores`: RLS sin policies ni
  GRANT, solo service_role (patrón `arca_credenciales`; tokens cifrados en la app).
  `negocios.pagos_online_habilitado` no está concedida a `anon`. Test:
  `supabase/tests/pagos_rls.sql`.
- Tablas de la reorganización de variantes (`20261022120000`, señaladas por el
  advisor como críticas: sin RLS y con GRANT ALL a `authenticated`).
  `variantes_fusionadas` está viva (la escribe `fusionar_productos`, INVOKER):
  aislamiento RESTRICTIVE por negocio y solo INSERT (append-only, la app no la lee).
  `variantes_remapeo` y `variantes_remapeo_aplicado`: RLS sin policies ni GRANT
  (patrón `backfill_variante_id_20260903`). La migración aborta si queda **cualquier**
  tabla de `public` sin RLS.
  Órdenes (`20261012162746`): `crear_orden_tienda` y `liberar_ordenes_tienda_vencidas`
  son SOLO de service_role (las llama la server action después de recalcular precios;
  con anon cualquiera mandaría su total por curl). `anon` solo ejecuta
  `opciones_cobro_online()`, que devuelve dos booleanos.
  Cobro (`20261012162839`): `_registrar_venta_orden_tienda` y `metodo_pago_tienda` solo
  service_role (los usan la conciliación y el webhook); `confirmar_transferencia_orden`
  y `cancelar_orden_tienda` para `authenticated` con `ventas.cobrar` y el negocio de la
  sesión; `orden_tienda_publica(token)` para anon (token de 48 hex, alias solo mientras
  espera pago). Los métodos `uso_tienda` nacen inactivos por CHECK.
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

Asociaciones del catálogo (`20261007220000`, aplicada el 13/10/2026):
`productos_complementarios_catalogo` nace cerrada a anon y sin escritura directa
de authenticated. Lectura con aislamiento RESTRICTIVE y `caja.ver_gerencial`;
`configurar_complemento_catalogo` valida ADMIN, negocio de sesión y ambos productos.
`analisis_complementos_catalogo` pide el permiso gerencial en la base. La fuente
compartida `security.compras_catalogo_180d` no concede EXECUTE a anon/authenticated.
La RPC pública sigue devolviendo únicamente IDs. Diseño y estado en
[catalogo-marketing.md](catalogo-marketing.md), ampliación de M4.

## Auth y sesión

Ver [alta-y-sesion.md](alta-y-sesion.md): claim del token, callback de un solo uso,
Google + confirmación de mail (resuelto el 22/10/2026 anulando la clave previa).
- Contraseña: mínimo 8 en TODOS los lugares (`shared/lib/password.ts`), y el mismo
  número tiene que estar en Supabase (Email → Minimum password length). La
  protección contra contraseñas filtradas (HaveIBeenPwned) va prendida.
- **Límite de intentos propio** (`20261022200000`, auditoría del 22/10/2026): el
  login corre en una server action y Supabase ve la IP de Vercel, así que su
  límite por IP no frena a nadie. `intentos_auth` (solo service_role, claves
  hasheadas) cuenta por IP real (`x-forwarded-for` de Vercel) y por mail. Topes
  en `shared/lib/limites-auth.ts`: login 30 fallidos por IP / 10 por mail en 15
  min (solo FALLIDOS: las vendedoras de un local comparten IP); recuperar 10/5 por
  hora; registro 10 por IP por hora; reenviar verificación 20/5 por hora. Falla
  ABIERTO si la base no contesta. Queda afuera quien pegue directo a la API de
  Auth con la anon key: ahí rige el límite por IP de Supabase, que sí ve la IP
  real.
