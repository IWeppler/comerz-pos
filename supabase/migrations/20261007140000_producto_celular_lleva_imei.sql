-- Un celular o una tablet nace pidiendo IMEI (7/10/2026).
--
-- Quien necesita IMEI es el PRODUCTO (`productos.lleva_serie`). Hasta acá se
-- prendía solo al cargarle la primera unidad, y `categorias.lleva_serie`
-- (20261007120000) era un atajo que alguien tenía que acordarse de marcar: un
-- comercio que arranca con su carga inicial crea "Celulares" al vuelo y sus
-- celulares se vendían sin pedir nada.
--
-- Ahora, al CREAR un producto (por cualquier camino: remito, carga inicial,
-- carga rápida, alta a mano, importación) o al MOVERLO de categoría, si su
-- categoría o la de arriba SE LLAMA Celulares / Smartphones / Tablets (y
-- variantes, ver `categoria_pide_imei_por_nombre`), se marca `lleva_serie`.
-- Mismo patrón que `unidades_serie_marca_producto`: el dato no depende de que
-- cada camino se acuerde.
--
-- El nombre tiene que SER ese, no contenerlo: "Accesorios para celulares" o
-- "Fundas de tablet" no piden IMEI. Aires, heladeras, TV, microondas y
-- auriculares quedan afuera a propósito (no hay acuerdo de que lo necesiten):
-- se marcan a mano en el producto o con el switch de la categoría.
--
-- Solo PRENDE, nunca apaga: si alguien lo saca a mano en la ficha, un UPDATE
-- que no cambia la categoría no lo vuelve a prender.
--
-- `categoria_pide_imei_por_nombre` tiene ESPEJO en TS
-- (`shared/lib/categoria-pide-imei.ts`), que la conciliación usa para pedir
-- IMEI de los productos que todavía no creó. Los casos de prueba de abajo
-- son los mismos que los del test de TS.
--
-- Backfill: los productos que ya están en esas categorías (hoy: 8 celulares
-- de ClickTostado sin la marca propia; los otros 9 ya la tenían).
-- Reversión: supabase/reversals/20261007140000_producto_celular_lleva_imei.sql

create or replace function public.categoria_pide_imei_por_nombre(p_nombre text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(
    regexp_replace(
      lower(public.unaccent_immutable(trim(coalesce(p_nombre, '')))),
      '\s+', ' ', 'g'
    ) ~ '^(celular|celulares|smartphone|smartphones|tablet|tablets|celulares y tablets|tablets y celulares|telefonos celulares|telefonia celular|moviles|telefonos moviles)$',
    false
  );
$function$;

comment on function public.categoria_pide_imei_por_nombre(text) is
  'Espejo de shared/lib/categoria-pide-imei.ts. El nombre ES el de una categoria de celulares/tablets (no lo contiene).';

revoke all on function public.categoria_pide_imei_por_nombre(text) from public, anon;
grant execute on function public.categoria_pide_imei_por_nombre(text) to authenticated;

-- INVOKER: lee la categoría con la RLS de quien crea el producto, que es la
-- de su negocio.
create or replace function public.productos_lleva_serie_por_categoria()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.lleva_serie or new.categoria_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.categoria_id is not distinct from old.categoria_id then
    return new;
  end if;

  if exists (
    select 1
    from public.categorias c
    left join public.categorias padre on padre.id = c.parent_id
    where c.id = new.categoria_id
      and (
        public.categoria_pide_imei_por_nombre(c.nombre)
        or public.categoria_pide_imei_por_nombre(padre.nombre)
      )
  ) then
    new.lleva_serie := true;
  end if;
  return new;
end;
$function$;

revoke all on function public.productos_lleva_serie_por_categoria() from public, anon, authenticated;

drop trigger if exists productos_lleva_serie_por_categoria on public.productos;
create trigger productos_lleva_serie_por_categoria
  before insert or update of categoria_id on public.productos
  for each row execute function public.productos_lleva_serie_por_categoria();

-- Backfill + guards -------------------------------------------------------

do $$
declare
  v_casos_si text[] := array['Celulares', 'celular', 'SMARTPHONES', 'Tablets',
    'Celulares y Tablets', 'Teléfonos Celulares', 'Móviles', '  celulares  '];
  v_casos_no text[] := array['Accesorios para celulares', 'Fundas de tablet',
    'Televisores', 'Aires Acondicionados', 'Auriculares', 'Telefonos', '', null];
  v_caso text;
  v_marcados int;
  v_pendientes int;
begin
  foreach v_caso in array v_casos_si loop
    if not public.categoria_pide_imei_por_nombre(v_caso) then
      raise exception 'categoria_pide_imei_por_nombre: "%" deberia pedir IMEI', v_caso;
    end if;
  end loop;
  foreach v_caso in array v_casos_no loop
    if public.categoria_pide_imei_por_nombre(v_caso) then
      raise exception 'categoria_pide_imei_por_nombre: "%" no deberia pedir IMEI', v_caso;
    end if;
  end loop;

  update public.productos p
     set lleva_serie = true
    from public.categorias c
    left join public.categorias padre on padre.id = c.parent_id
   where p.categoria_id = c.id
     and not p.lleva_serie
     and (
       public.categoria_pide_imei_por_nombre(c.nombre)
       or public.categoria_pide_imei_por_nombre(padre.nombre)
     );
  get diagnostics v_marcados = row_count;

  -- Medido el 7/10/2026: 8 (ClickTostado). Tolera altas entre la medición y
  -- la aplicación, pero no un número que sugiera otra cosa.
  if v_marcados < 8 or v_marcados > 20 then
    raise exception 'backfill: se esperaban ~8 productos marcados y fueron %', v_marcados;
  end if;

  select count(*) into v_pendientes
  from public.productos p
  join public.categorias c on c.id = p.categoria_id
  left join public.categorias padre on padre.id = c.parent_id
  where not p.lleva_serie
    and (
      public.categoria_pide_imei_por_nombre(c.nombre)
      or public.categoria_pide_imei_por_nombre(padre.nombre)
    );
  if v_pendientes <> 0 then
    raise exception 'backfill: quedaron % productos sin marcar', v_pendientes;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'productos_lleva_serie_por_categoria'
      and tgrelid = 'public.productos'::regclass
  ) then
    raise exception 'falta el trigger productos_lleva_serie_por_categoria';
  end if;
end $$;
