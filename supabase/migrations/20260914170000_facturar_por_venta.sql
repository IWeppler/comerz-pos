-- Facturar o no, POR VENTA.
--
-- Con ARCA conectado, la caja facturaba TODAS las ventas. Los comercios no
-- trabajan así: hay ventas que se facturan y ventas que salen con ticket
-- interno, y la que decide es la persona en el mostrador, en el momento.
--
-- Dos piezas:
--
--   `configuracion_pos.facturar_por_defecto`  con qué arranca el switch del
--     POS. Default TRUE: un comercio que se conecta a ARCA sin tocar nada
--     factura, que es lo que había hasta ahora. Solo importa con modo ARCA.
--
--   permiso `ventas.elegir_comprobante`  quién puede cambiar ese switch en
--     la venta. Sin el permiso, el POS no lo muestra y el server usa el
--     default aunque el request diga otra cosa (un server action es un
--     endpoint). Se otorga a los roles que hoy tienen `ventas.corregir_pago`
--     —ADMIN, ENCARGADO y VENDEDOR en todos los negocios—, o sea a todo el
--     que vende: la elección es del mostrador. La dueña que no quiera que
--     las vendedoras decidan se lo saca al rol desde Empleados y Permisos.
--
-- ADITIVA: ningún negocio cambia de comportamiento.

alter table public.configuracion_pos
  add column if not exists facturar_por_defecto boolean not null default true;

comment on column public.configuracion_pos.facturar_por_defecto is
  'Con modo ARCA: si el switch Factura/Ticket del POS arranca en factura. La vendedora con ventas.elegir_comprobante lo cambia por venta.';

insert into public.permisos (clave, modulo, descripcion)
values (
  'ventas.elegir_comprobante',
  'ventas',
  'Elegir en cada venta si sale factura o ticket interno'
)
on conflict (clave) do nothing;

insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select rp.rol_id, nuevo.id, rp.negocio_id
  from public.rol_permisos rp
  join public.permisos actual
    on actual.id = rp.permiso_id
   and actual.clave = 'ventas.corregir_pago'
 cross join (
   select id from public.permisos where clave = 'ventas.elegir_comprobante'
 ) as nuevo
on conflict (rol_id, permiso_id) do nothing;
