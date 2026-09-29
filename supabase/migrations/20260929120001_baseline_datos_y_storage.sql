-- Baseline, segunda parte: lo que un dump de esquema NO trae.
--
-- `20260929120000_baseline.sql` es `supabase db dump` de producción (29/9/2026)
-- y reemplaza a las ~310 migraciones anteriores (siguen en git, tag
-- `migraciones-pre-baseline`). El dump es solo esquema de public / security /
-- archivo / respaldos, así que acá va lo que una base nueva necesita además:
--
--   1. Datos de catálogo GLOBALES (sin negocio_id): `permisos` y `planes`.
--      Sin `permisos`, `tiene_permiso()` dice que no a todo y
--      `crear_negocio_con_owner` le da al ADMIN cero permisos.
--   2. Buckets y policies de Storage (schema `storage`, fuera del dump).
--
-- Idempotente: en producción ya existe todo esto y no cambia nada.
--
-- Lo que NO se puede escribir en SQL y hay que configurar a mano en una base
-- nueva: el Custom Access Token Hook (Auth > Hooks →
-- `public.custom_access_token_hook`), los proveedores de Auth y las URLs de
-- redirect.

insert into public.permisos (id, clave, modulo, descripcion) values
  ('cd901204-c05e-4dd9-9bdb-772ebe06be10', 'caja.anular_movimiento', 'caja', 'Anular un gasto o revertir una transferencia ya registrada'),
  ('7815ed4e-c367-4659-9a7c-1f0641b3ac44', 'caja.cerrar_ajena', 'caja', 'Cerrar el turno de caja de otro vendedor'),
  ('73ba3f26-2172-4c1e-8f2d-36f7edae9991', 'caja.operar', 'caja', 'Operar la caja: abrir y cerrar el turno propio, registrar gastos'),
  ('76d0e083-9aaa-40f4-8b2b-613476542155', 'caja.registrar_egreso', 'caja', 'Registrar gastos y salidas de dinero'),
  ('5e1058c0-6fa0-4341-9bb4-650a1af35c2f', 'caja.registrar_ingreso', 'caja', 'Registrar ingresos de dinero que no vienen de una venta (aportes, préstamos, otros)'),
  ('8db2b134-355a-40b3-baba-9729ba7d444d', 'caja.transferir', 'caja', 'Pasar dinero entre cuentas propias (caja, banco, billeteras)'),
  ('ef110cf6-fc77-4c29-9694-6e09a88393ea', 'caja.ver_gerencial', 'caja', 'Ver la Vista Gerencial de Caja: resumen agregado del día y cierres de todas las cajeras'),
  ('88227499-2c7d-4fcf-b11a-9031567ea2be', 'caja.ver_movimientos', 'caja', 'Ver la tabla general de movimientos de dinero y el detalle de cada cuenta'),
  ('09d9c96c-9a32-43d8-829a-937f4b9354b8', 'clientes.cobrar_cc', 'clientes', 'Registrar el cobro de un saldo de cuenta corriente'),
  ('545fe048-bc2a-4171-9bed-54aeeed811ae', 'clientes.corregir_cobro_cc', 'clientes', 'Corregir el medio de pago de un cobro de cuenta corriente'),
  ('dc8fe748-018d-456c-9c95-bcc27073ceb5', 'clientes.importar_csv', 'clientes', 'Importar clientes de forma masiva desde CSV'),
  ('f2a03ff5-2867-45d3-8dcb-63432b3fb923', 'clientes.ver_modulo', 'clientes', 'Acceder al módulo de clientes'),
  ('1fcfa1a4-eb72-414b-b11d-b1f79de577c6', 'configuracion.empleados_y_permisos', 'configuracion', 'Gestionar empleados, roles y permisos'),
  ('a86623c3-cef8-4393-9492-84cefb1d66d4', 'configuracion.facturacion', 'configuracion', 'Configurar el modo de facturación, el punto de venta y la conexión con ARCA'),
  ('2384a6af-c7c0-40d6-88fc-f4b6a0bdbfb4', 'presupuestos.aceptar_plan', 'presupuestos', 'Convertir una cotización en un plan de pagos en cuotas (otorgar crédito)'),
  ('157699d4-6bf8-4972-963f-db5bdc44c55c', 'presupuestos.cancelar_plan', 'presupuestos', 'Cancelar un plan de pagos, devolver lo pagado y retener la penalidad'),
  ('25bf57ef-d5f4-489e-8363-43953df3e38a', 'presupuestos.cobrar_cuota', 'presupuestos', 'Cobrar cuotas y anticipos de un plan de pagos'),
  ('fc8d0ecb-ccc6-4929-aaa9-a878ba420253', 'presupuestos.crear', 'presupuestos', 'Armar y enviar cotizaciones'),
  ('c02eb4bb-3fc4-4f4c-b29c-f91a17420c73', 'reportes.ver_modulo', 'reportes', 'Acceder al módulo de reportes'),
  ('3145055e-d073-4c15-abaf-0dac08e89934', 'reportes.ver_todos_empleados', 'reportes', 'Ver reportes de todos los empleados, no solo los propios'),
  ('1378910c-d8a8-497f-95f3-495aadacd78e', 'stock.actualizar_precios_masivo', 'stock', 'Aplicar una actualización de precios masiva por lote'),
  ('65620c33-327f-434a-8069-e602eca04a14', 'stock.cambiar_categoria', 'stock', 'Cambiar la categoría de un producto'),
  ('832302c6-0631-47d9-9317-107a32b20b0b', 'stock.dar_baja', 'stock', 'Aprobar o rechazar una baja de stock reportada'),
  ('515d42ff-d640-476d-ab20-8e796996bf55', 'stock.editar_producto', 'stock', 'Editar los datos de un producto existente'),
  ('3c31af4b-bce6-4e05-852c-14b1a216b815', 'stock.eliminar_producto', 'stock', 'Eliminar un producto de forma permanente'),
  ('7430d9e4-9335-4da4-8134-5b59d6889d01', 'stock.importar_planilla', 'stock', 'Importar productos y stock de forma masiva desde una planilla CSV/XLSX'),
  ('82c08570-94a0-43f1-bc8a-fc4d165b0898', 'stock.ingresar_remito', 'stock', 'Cargar un remito/orden de compra entrante'),
  ('b368da1b-2067-4869-b76f-932bdea0f0e8', 'stock.ver_historial_precios', 'stock', 'Ver el historial de cambios de precio de un producto'),
  ('d2cd8548-1ea5-4477-9e3d-4d87bd923a03', 'ventas.anular', 'ventas', 'Anular una venta ya confirmada'),
  ('e40bcee3-ea18-454d-bb67-006034f2de6d', 'ventas.cobrar', 'ventas', 'Cobrar en el mostrador (confirmar la venta y recibir el pago)'),
  ('b8446e03-ad9b-4248-b06e-edbc64052919', 'ventas.corregir_pago', 'ventas', 'Corregir el metodo de pago de una venta propia mientras el turno sigue abierto'),
  ('fe90a969-eb07-4c59-8190-3d06d868c6ec', 'ventas.devolver', 'ventas', 'Registrar la devolucion de renglones de una venta propia'),
  ('40a271c6-f7d4-4c9e-99f0-01ec1a4fcf30', 'ventas.elegir_comprobante', 'ventas', 'Elegir en cada venta si sale factura o ticket interno'),
  ('34242fd5-b5be-4c77-84c9-b89ab2f62cf5', 'ventas.elegir_medio_devolucion', 'ventas', 'Elegir por que medio se le devuelve la plata al cliente en una anulacion o devolucion'),
  ('c7fd8b85-5ebe-4992-b8fc-25c8e57fccba', 'ventas.ver_todas', 'ventas', 'Ver las ventas de todos los vendedores, no solo las propias')
on conflict (id) do nothing;

insert into public.planes (id, nombre, precio_mensual, reglas, activo, orden, descripcion, link_suscripcion) values
  ('b85b6457-af66-4f2e-a341-fabdf0017b31', 'Prueba', 0.00, '{"features": ["pos", "caja", "ventas", "stock", "catalogo_publico", "clientes", "cuenta_corriente", "cuenta_corriente_ilimitada", "tickets", "historial_ventas", "insights_basico", "resumen_semanal", "reportes", "reportes_exportar", "multicaja", "roles", "auditoria", "facturacion_electronica", "catalogo_sin_marca", "multisucursal", "stock_por_sucursal", "transferencias_sucursal", "dashboard_consolidado", "permisos_avanzados", "integraciones", "api", "pedidos_a_caja"], "max_usuarios": 99, "max_productos": null, "max_sucursales": 10, "max_clientes_cuenta_corriente": null}'::jsonb, false, 0, 'Todo desbloqueado por 14 días. Al terminar se elige un plan.', null),
  ('5c9f1d20-fd49-42d2-aa67-4eff7b1694e9', 'Emprendedor', 30000.00, '{"features": ["pos", "caja", "ventas", "stock", "catalogo_publico", "clientes", "cuenta_corriente", "tickets", "historial_ventas", "insights_basico", "resumen_semanal"], "max_usuarios": 1, "max_productos": 1000, "max_sucursales": 1, "max_clientes_cuenta_corriente": 50}'::jsonb, true, 10, 'Para el que arranca solo: vender, cobrar y tener el stock ordenado.', 'https://mpago.la/2U2MnGh'),
  ('bcbc54c4-65b7-4e0d-9a9d-ca586981a375', 'Gestión', 50000.00, '{"features": ["pos", "caja", "ventas", "stock", "catalogo_publico", "clientes", "cuenta_corriente", "tickets", "historial_ventas", "insights_basico", "resumen_semanal", "reportes", "reportes_exportar", "multicaja", "roles", "auditoria", "facturacion_electronica", "catalogo_sin_marca", "pedidos_a_caja"], "max_usuarios": 5, "max_productos": null, "max_sucursales": 1, "max_clientes_cuenta_corriente": 250}'::jsonb, true, 20, 'Para el comercio con empleados: reportes, roles y varias cajas.', 'https://mpago.la/1LFRiSv'),
  ('c5ed28c7-9bb5-4b2a-bd83-edf64e9f9b94', 'Empresa', 70000.00, '{"features": ["pos", "caja", "ventas", "stock", "catalogo_publico", "clientes", "cuenta_corriente", "cuenta_corriente_ilimitada", "tickets", "historial_ventas", "insights_basico", "resumen_semanal", "reportes", "reportes_exportar", "multicaja", "roles", "auditoria", "facturacion_electronica", "catalogo_sin_marca", "multisucursal", "stock_por_sucursal", "transferencias_sucursal", "dashboard_consolidado", "permisos_avanzados", "integraciones", "api", "pedidos_a_caja"], "max_usuarios": 99, "max_productos": null, "max_sucursales": 10, "max_clientes_cuenta_corriente": null}'::jsonb, true, 30, 'Para varias sucursales, con stock propio y dashboard consolidado.', null)
on conflict (id) do nothing;

-- Storage: las imágenes van en una carpeta por negocio (`<negocio_id>/...`),
-- y esa carpeta es lo que aísla un negocio de otro al escribir.
insert into storage.buckets (id, name, public) values
  ('productos', 'productos', true),
  ('logos', 'logos', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'Lectura publica de imagenes') then
    create policy "Lectura publica de imagenes" on storage.objects
      for select to public
      using (bucket_id = any (array['productos', 'logos']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'Subir imagenes del propio negocio') then
    create policy "Subir imagenes del propio negocio" on storage.objects
      for insert to authenticated
      with check (bucket_id = any (array['productos', 'logos'])
        and (storage.foldername(name))[1] = (security.current_negocio_id())::text);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'Actualizar imagenes del propio negocio') then
    create policy "Actualizar imagenes del propio negocio" on storage.objects
      for update to authenticated
      using (bucket_id = any (array['productos', 'logos'])
        and (storage.foldername(name))[1] = (security.current_negocio_id())::text)
      with check (bucket_id = any (array['productos', 'logos'])
        and (storage.foldername(name))[1] = (security.current_negocio_id())::text);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'Borrar imagenes del propio negocio') then
    create policy "Borrar imagenes del propio negocio" on storage.objects
      for delete to authenticated
      using (bucket_id = any (array['productos', 'logos'])
        and (storage.foldername(name))[1] = (security.current_negocio_id())::text);
  end if;
end $$;
