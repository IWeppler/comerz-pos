-- productos.lleva_serie: el producto se vende con IMEI / número de serie.
--
-- Hasta ahora "este producto lleva IMEI" se deducía de que la variante tuviera
-- unidades DISPONIBLES en unidades_serie. Un celular cargado a mano (sin remito
-- con IMEI) no tenía ninguna, así que el POS lo vendía sin pedir nada y el
-- ticket salía sin IMEI, sin aviso. Caso real: ClickTostado, 10 ventas y 3 con
-- IMEI (30/9/2026).
--
-- El flag es una marca explícita del producto y NO cambia qué se exige en el
-- server: create-sale sigue exigiendo unidad solo si hay disponibles. Lo usa el
-- POS para ADVERTIR (y ofrecer tipear el IMEI) cuando una línea de un producto
-- que lleva serie no tiene ninguna unidad cargada. Un electro también vende
-- fundas y cargadores: por eso es por producto y no por rubro.
--
-- Aditiva: default false, nadie cambia de comportamiento salvo los productos
-- que ya tienen historia de IMEI (backfill abajo).
--
-- `anon` NO la necesita: el catálogo público no la lee y la tabla tiene GRANT
-- por columna para anon, así que la columna nueva nace cerrada para la tienda.

alter table public.productos
  add column if not exists lleva_serie boolean not null default false;

comment on column public.productos.lleva_serie is
  'El producto se vende con IMEI / numero de serie. Solo sirve para que el POS advierta si una linea no tiene unidad cargada; no obliga nada en el server. Se prende solo al cargar una unidad (trigger unidades_serie_marca_producto) y se edita en la ficha.';

-- Backfill: todo producto que alguna vez tuvo una unidad o una línea de remito
-- con IMEI. Incluye los de ClickTostado cuyos IMEI se perdieron el 18/8
-- (edición de variantes + FK en CASCADE, corregido en 20260902170353).
do $$
declare
  v_esperados int;
  v_marcados int;
begin
  select count(distinct p.id) into v_esperados
  from public.productos p
  where exists (
      select 1
      from public.producto_variantes v
      join public.unidades_serie u on u.producto_variante_id = v.id
      where v.producto_id = p.id
    )
    or exists (
      select 1 from public.ordenes_items oi
      where oi.producto_id = p.id
        and nullif(trim(oi.raw_imei), '') is not null
    );

  update public.productos p
     set lleva_serie = true
   where not p.lleva_serie
     and (
       exists (
         select 1
         from public.producto_variantes v
         join public.unidades_serie u on u.producto_variante_id = v.id
         where v.producto_id = p.id
       )
       or exists (
         select 1 from public.ordenes_items oi
         where oi.producto_id = p.id
           and nullif(trim(oi.raw_imei), '') is not null
       )
     );

  select count(*) into v_marcados from public.productos where lleva_serie;

  if v_marcados <> v_esperados then
    raise exception 'lleva_serie: se esperaban % productos marcados y hay %',
      v_esperados, v_marcados;
  end if;
end $$;

-- Cargar una unidad por cualquier camino (remito, planilla, ficha, POS) marca
-- el producto. Así el flag no depende de que cada camino se acuerde.
--
-- INVOKER: corre con la RLS de quien carga la unidad. Si esa persona no puede
-- editar productos, el UPDATE queda filtrado sin error y el flag no se prende;
-- es aceptable porque el flag solo alimenta una advertencia, y el camino del
-- POS (la vendedora tipea el IMEI) solo existe para productos ya marcados.
create or replace function public.unidades_serie_marca_producto()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  update public.productos p
     set lleva_serie = true
    from public.producto_variantes v
   where v.id = new.producto_variante_id
     and p.id = v.producto_id
     and not p.lleva_serie;
  return new;
end;
$function$;

revoke all on function public.unidades_serie_marca_producto() from public, anon, authenticated;

drop trigger if exists unidades_serie_marca_producto on public.unidades_serie;
create trigger unidades_serie_marca_producto
  after insert on public.unidades_serie
  for each row execute function public.unidades_serie_marca_producto();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'unidades_serie_marca_producto'
      and tgrelid = 'public.unidades_serie'::regclass
  ) then
    raise exception 'falta el trigger unidades_serie_marca_producto';
  end if;

  if has_column_privilege('anon', 'public.productos', 'lleva_serie', 'select') then
    raise exception 'anon no deberia leer productos.lleva_serie';
  end if;
end $$;
