-- Reversión de 20261022150000_proveedores_y_pago_de_remitos.sql.
--
-- Vuelve los remitos descartados a PENDIENTE (con el hash que tenían: solo 2 lo
-- tenían, respaldados abajo), saca las columnas de pago y proveedor, borra la
-- tabla de proveedores, el trigger y la RPC, y devuelve a `authenticated` los
-- permisos de tabla que tenía sobre ordenes_compra.
--
-- OJO: si después de la migración se descartaron remitos desde la app, también
-- vuelven a PENDIENTE (sin hash). Si hay gastos asociados a remitos o
-- proveedores cargados, se pierde el proveedor del remito; los gastos quedan.

begin;

drop trigger trg_validar_estado_remito on public.ordenes_compra;
drop function public.validar_estado_remito();
drop function public.definir_pago_remito(uuid, text, uuid);

update public.ordenes_compra set estado = 'PENDIENTE' where estado = 'DESCARTADA';

update public.ordenes_compra o
   set hash_planilla = b.hash
  from (values
    ('94b66b14-c5b4-4355-b0a6-44981fe46f8d'::uuid, '07d85aac1a6748e3ff7bc0260178be4c1a6b8071fd0f49f3ea05cd7cb9ed160f'),
    ('d29c4b0c-7add-4cdb-bb75-f27f5a3811b6'::uuid, 'e1f3b5d0128578730ed85f786d6882cdd829235c7120a0c45ce647b57e7285af')
  ) as b(id, hash)
 where o.id = b.id;

alter table public.ordenes_compra
  drop constraint ordenes_compra_pago_solo_aprobada,
  drop constraint ordenes_compra_pago_modo_check,
  drop constraint ordenes_compra_estado_check,
  drop constraint ordenes_compra_proveedor_fkey;

drop index public.idx_ordenes_compra_negocio_proveedor;

alter table public.ordenes_compra
  drop column proveedor_id,
  drop column pago_modo,
  drop column pago_definido_en,
  drop column pago_definido_por,
  drop column descartado_en,
  drop column descartado_por;

drop table public.proveedores;

grant insert, update, truncate, references, trigger on public.ordenes_compra to authenticated;

-- Los 30 remitos que la migración descartó (por si hay que verificar a mano):
-- Evens y Estilo Bonito, PENDIENTE creados antes del 1/10/2026.
--   d92188ee-d2f5-4fc7-aa2b-f90e6039d461, ac9d4b90-c05f-4bd2-b24d-f4a100456350,
--   3672e849-8877-48bd-8a18-926c21d19f6d, bf3642ca-eda2-478e-a288-3d8ac0c24c77,
--   daa94c7c-0e7f-498a-a7e7-72f79b809702, ad148885-8c61-496e-914e-400be253b30c,
--   3527f073-50d2-42e0-ba29-75b8f2bc1cae, d90f93e7-5a4e-4c72-b355-7cab2b760def,
--   a44e4ab4-8d8f-4762-a538-7c232b6e513b, 5354a004-3a0a-4d5c-9af4-3ea20242159d,
--   2e13fe19-c7ba-4c06-9b79-acb815c6cdbd, 8e96f03e-161c-4905-8513-fa3a82768087,
--   73517294-d7ae-4fb8-a2e9-428815e8fce1, 81d23e86-c100-4edf-841c-9929a878836a,
--   3ec794c6-fa0f-465c-b979-5f012bb54c96, 4738afc6-4274-4c98-ae45-cf8257d6e490,
--   1ba66c15-ab52-4ebb-aee2-4a89aece9568, 1d99ee1a-483c-44ea-ab37-fa161c3c34dd,
--   ec853c5f-e02b-4511-bd35-bfb537fb2470, 38818552-87ff-48ba-a5d1-479e91801c02,
--   495113db-0f0e-4c80-a0eb-d0288f70d3eb, 9cc075d3-34ca-4f06-81b2-5314c82fd17c,
--   539c2477-07c1-4ee5-85b5-6dae7311464b, 39c90e1f-52fc-4ae3-838f-adfae528f600,
--   393766a4-b832-4a96-b319-5cd33288123e, 3873c67c-3a7f-4f0a-9761-8503c00a3f29,
--   9f355e38-e994-48c1-ab56-7ecc13aee303, 9a234bda-1261-4843-aa99-311cc67dc21b,
--   94b66b14-c5b4-4355-b0a6-44981fe46f8d, d29c4b0c-7add-4cdb-bb75-f27f5a3811b6

do $guard$
begin
  if to_regclass('public.proveedores') is not null then
    raise exception 'proveedores sigue existiendo';
  end if;
  if exists (select 1 from public.ordenes_compra where estado not in ('PENDIENTE', 'APROBADA')) then
    raise exception 'quedó un estado que el código viejo no conoce';
  end if;
  if not has_table_privilege('authenticated', 'public.ordenes_compra', 'UPDATE') then
    raise exception 'authenticated no recuperó UPDATE sobre ordenes_compra';
  end if;
end
$guard$;

commit;
