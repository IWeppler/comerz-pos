-- Configuración chica y atómica en la cabecera. No duplica el precio habitual.
-- Cada variante aplica estos importes por separado, sólo en unidad base.
create function public.precios_por_cantidad_validos(p_tramos jsonb)
returns boolean language plpgsql immutable security invoker
set search_path = '' as $$
declare
  t jsonb;
  v_desde numeric;
  v_precio numeric;
  v_anterior numeric := 0;
begin
  if p_tramos is null or jsonb_typeof(p_tramos) <> 'array' then return false; end if;
  if jsonb_array_length(p_tramos) > 20 then return false; end if;
  for t in select value from jsonb_array_elements(p_tramos) loop
    if jsonb_typeof(t) <> 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(t)) <> 2
       or jsonb_typeof(t->'desde') is distinct from 'number'
       or jsonb_typeof(t->'precio') is distinct from 'number' then return false; end if;
    v_desde := (t->>'desde')::numeric;
    v_precio := (t->>'precio')::numeric;
    if v_desde <> trunc(v_desde) or v_desde < 1 or v_desde > 1000000000
       or v_desde <= v_anterior or v_precio <= 0 or v_precio > 1000000000
       or v_precio <> round(v_precio, 2) then return false; end if;
    v_anterior := v_desde;
  end loop;
  return true;
end;
$$;
revoke all on function public.precios_por_cantidad_validos(jsonb) from public, anon, authenticated;
grant execute on function public.precios_por_cantidad_validos(jsonb) to authenticated, service_role;

alter table public.productos add column precios_por_cantidad jsonb not null default '[]'::jsonb
  constraint productos_precios_por_cantidad_validos check (public.precios_por_cantidad_validos(precios_por_cantidad));
comment on column public.productos.precios_por_cantidad is
  'Tramos [{desde: cantidad entera mínima, precio: importe unitario absoluto}]. Orden creciente, máximo 20. Cada variante suma por separado. Sin presentación. Tramo reemplaza lista antes de promociones. [] = precio habitual. El precio vendido queda congelado en ventas_items.precio_unitario.';
grant select (precios_por_cantidad) on public.productos to anon;

-- Las policies vivas de UPDATE de productos no exigen permiso. Restringir
-- esta columna nueva sin cambiar los caminos existentes de stock/precios.
create function security.validar_permiso_tramos_cantidad()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_cambio boolean;
begin
  if tg_op = 'INSERT' then
    v_cambio := new.precios_por_cantidad <> '[]'::jsonb;
  else
    v_cambio := new.precios_por_cantidad is distinct from old.precios_por_cantidad;
  end if;
  if v_cambio and current_user in ('authenticated', 'anon')
     and not coalesce(public.tiene_permiso('stock.editar_producto'), false) then
    raise exception 'SIN_PERMISO_PRECIOS_POR_CANTIDAD' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function security.validar_permiso_tramos_cantidad() from public, anon, authenticated;
create trigger productos_permiso_tramos_cantidad before insert or update of precios_por_cantidad
  on public.productos for each row execute function security.validar_permiso_tramos_cantidad();

do $$
begin
  if exists (select 1 from public.productos where precios_por_cantidad <> '[]'::jsonb) then
    raise exception 'La migración no debe configurar productos existentes';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.productos'::regclass)
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='productos'
       and policyname='aislamiento_negocio' and permissive='RESTRICTIVE')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='productos'
       and policyname='aislamiento_negocio_publico' and permissive='RESTRICTIVE') then
    raise exception 'Falta aislamiento de productos';
  end if;
  if not has_column_privilege('anon', 'public.productos', 'precios_por_cantidad', 'SELECT')
     or has_column_privilege('anon', 'public.productos', 'precio_costo', 'SELECT')
     or has_function_privilege('anon', 'security.validar_permiso_tramos_cantidad()', 'EXECUTE') then
    raise exception 'Grants inesperados';
  end if;
  if not public.precios_por_cantidad_validos('[{"desde":10,"precio":220},{"desde":50,"precio":200},{"desde":100,"precio":180}]')
     or public.precios_por_cantidad_validos('[{"desde":10,"precio":220},{"desde":10,"precio":200}]')
     or public.precios_por_cantidad_validos('[{"desde":10,"precio":0}]') then
    raise exception 'Validación de tramos inconsistente';
  end if;
end;
$$;
notify pgrst, 'reload schema';
