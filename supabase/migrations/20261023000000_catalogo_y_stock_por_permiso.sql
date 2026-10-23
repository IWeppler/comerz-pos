-- Catálogo y stock por permiso (auditoría de seguridad del 22/10/2026, opción 1).
--
-- Hasta acá `stock.editar_producto` existía solo en la base y casi nada lo
-- exigía: ni Node ni la UI lo miran, `productos` deja crear y editar a cualquier
-- rol, y `guardar_variantes_producto` / `ajustar_stock_*` no validan nada. Una
-- vendedora podía cambiar precios, costos y stock desde la consola.
--
-- Medido antes (90 días, todos los comercios): el ÚNICO rol sin el permiso que
-- crea o edita catálogo es VENDEDOR de Librería Colores (~940 altas de producto,
-- 13 ediciones de variantes, 16 cargas rápidas). Ningún otro rol sin permiso
-- baja ni sube stock fuera de su permiso; los reversos de venta los hizo siempre
-- un ADMIN. Por eso:
--
--  0. Librería Colores: su rol VENDEDOR recibe `stock.editar_producto` (es lo que
--     ya hace; decisión del 22/10). Nadie pierde nada.
--  1. `productos` por escritura directa: el ALTA y cambiar `precio` o
--     `precio_costo` piden `stock.editar_producto`. Las fotos, la publicación y la
--     categoría siguen abiertas: el 5/9/2026 cerrar `productos` entero dejó a las
--     vendedoras subiendo 104 fotos que no llegaban a la base.
--  2. Alta directa de variantes y valores: vuelve `stock.editar_producto`
--     (sacada en 20261022221000 por Librería). `productos_stock`: eso o
--     `stock.dar_baja`.
--  3. `guardar_variantes_producto` (y su `_impl`) pide `stock.editar_producto`.
--  4. `ajustar_stock_variante(s)` / `ajustar_stock_legacy`, por signo:
--     - bajar: `ventas.cobrar`, `stock.dar_baja` o `stock.editar_producto`;
--     - subir: `stock.editar_producto`, `ventas.anular`, `ventas.devolver` o
--       `stock.ingresar_remito`;
--     - excepción, el reverso de una venta que no llegó a registrarse
--       (`create-sale.ts`, origen REVERSO_VENTA): se puede devolver solo lo que
--       ESTE usuario descontó con ESA referencia, si la venta no existe, sin pasar
--       lo ya devuelto.
--     service_role pasa siempre.
--
-- Reversión: supabase/reversals/20261023000000_catalogo_y_stock_por_permiso.sql

begin;

-- ── 0. Librería Colores: VENDEDOR con stock.editar_producto ──────────────────
do $$
declare
  v_rol uuid;
  v_negocio uuid;
  v_permiso uuid;
begin
  -- `negocio_id` explícito: en una migración no hay sesión y su DEFAULT da null.
  select r.id, r.negocio_id into strict v_rol, v_negocio
    from public.roles r join public.negocios n on n.id = r.negocio_id
   where n.slug = 'libreria-colores' and r.nombre = 'VENDEDOR';
  select id into strict v_permiso from public.permisos where clave = 'stock.editar_producto';
  insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
  select v_rol, v_permiso, v_negocio
   where not exists (select 1 from public.rol_permisos where rol_id = v_rol and permiso_id = v_permiso);
end $$;

-- ── 1. productos: alta y precio/costo por escritura directa ─────────────────
create function security.proteger_campos_producto()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not security.es_escritura_directa() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if public.tiene_permiso('stock.editar_producto') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'SIN_PERMISO_EDITAR_PRODUCTO' using errcode = '42501';
  end if;
  if new.precio is distinct from old.precio
     or new.precio_costo is distinct from old.precio_costo then
    raise exception 'SIN_PERMISO_EDITAR_PRODUCTO' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_proteger_campos_producto
  before insert or update of precio, precio_costo on public.productos
  for each row execute function security.proteger_campos_producto();

-- ── 2. Alta directa de variantes, valores y espejo ──────────────────────────
create policy producto_variantes_alta_directa_permiso on public.producto_variantes
  as restrictive for insert to authenticated
  with check (not (select security.es_escritura_directa()) or (select public.tiene_permiso('stock.editar_producto')));
create policy producto_variante_valores_alta_directa_permiso on public.producto_variante_valores
  as restrictive for insert to authenticated
  with check (not (select security.es_escritura_directa()) or (select public.tiene_permiso('stock.editar_producto')));

do $$
declare
  v_cond text := '(not (select security.es_escritura_directa()) or (select public.tiene_permiso(''stock.editar_producto'')) or (select public.tiene_permiso(''stock.dar_baja'')))';
begin
  execute format('create policy productos_stock_alta_directa_permiso on public.productos_stock as restrictive for insert to authenticated with check %s', v_cond);
  execute format('create policy productos_stock_edicion_directa_permiso on public.productos_stock as restrictive for update to authenticated using %s with check %s', v_cond, v_cond);
  execute format('create policy productos_stock_baja_directa_permiso on public.productos_stock as restrictive for delete to authenticated using %s', v_cond);
end $$;

-- ── 4. Quién puede mover stock y cuánto ──────────────────────────────────────
create function security.puede_ajustar_stock(
  p_movimientos jsonb,
  p_origen      text,
  p_referencia  uuid
)
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_sube boolean;
  v_baja boolean;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return true;
  end if;

  select coalesce(bool_or(t.delta > 0), false), coalesce(bool_or(t.delta < 0), false)
    into v_sube, v_baja
    from (select sum((m->>'delta')::numeric) as delta
            from jsonb_array_elements(coalesce(p_movimientos, '[]'::jsonb)) m
           group by m->>'variante_id') t;

  if v_baja and not (public.tiene_permiso('ventas.cobrar')
                     or public.tiene_permiso('stock.dar_baja')
                     or public.tiene_permiso('stock.editar_producto')) then
    return false;
  end if;

  if v_sube and not (public.tiene_permiso('stock.editar_producto')
                     or public.tiene_permiso('ventas.anular')
                     or public.tiene_permiso('ventas.devolver')
                     or public.tiene_permiso('stock.ingresar_remito')) then
    -- Única subida sin esos permisos: devolver lo que la venta fallida descontó.
    if p_origen is distinct from 'REVERSO_VENTA' or p_referencia is null then
      return false;
    end if;
    if exists (select 1 from public.ventas v where v.id = p_referencia) then
      return false;
    end if;
    if exists (
      select 1
        from (select (m->>'variante_id')::uuid as variante_id, sum((m->>'delta')::numeric) as delta
                from jsonb_array_elements(p_movimientos) m
               group by 1) p
       where p.delta > 0
         and p.delta > coalesce((
               select -sum(ms.delta)
                 from public.movimientos_stock ms
                where ms.referencia_id = p_referencia
                  and ms.variante_id = p.variante_id
                  and ms.usuario_id = auth.uid()
                  and ms.origen in ('VENTA', 'REVERSO_VENTA')), 0)
    ) then
      return false;
    end if;
  end if;

  return true;
end $$;

revoke all on function security.puede_ajustar_stock(jsonb, text, uuid) from public;
grant execute on function security.puede_ajustar_stock(jsonb, text, uuid) to authenticated, service_role;

-- ── 3 y 4. Chequeo al principio de cada RPC (cuerpo vivo, begin principal) ───
do $$
declare
  r record;
  d text;
  v_ancla text;
  v_veces int;
begin
  for r in
    select * from (values
      ('public.guardar_variantes_producto(uuid, uuid, jsonb, uuid, jsonb)'::regprocedure,
       E'  if coalesce(auth.role(), '''') <> ''service_role''\n     and not public.tiene_permiso(''stock.editar_producto'') then\n    raise exception ''SIN_PERMISO_EDITAR_PRODUCTO'' using errcode = ''42501'';\n  end if;\n'),
      ('public.guardar_variantes_producto_impl(uuid, uuid, jsonb, uuid, jsonb)'::regprocedure,
       E'  if coalesce(auth.role(), '''') <> ''service_role''\n     and not public.tiene_permiso(''stock.editar_producto'') then\n    raise exception ''SIN_PERMISO_EDITAR_PRODUCTO'' using errcode = ''42501'';\n  end if;\n'),
      ('public.ajustar_stock_variante(uuid, numeric, boolean, text, uuid)'::regprocedure,
       E'  if not security.puede_ajustar_stock(\n       jsonb_build_array(jsonb_build_object(''variante_id'', p_variante_id, ''delta'', p_delta)),\n       p_origen, p_referencia_id) then\n    raise exception ''SIN_PERMISO_STOCK'' using errcode = ''42501'';\n  end if;\n'),
      ('public.ajustar_stock_variantes(jsonb, boolean, text, uuid)'::regprocedure,
       E'  if not security.puede_ajustar_stock(p_movimientos, p_origen, p_referencia_id) then\n    raise exception ''SIN_PERMISO_STOCK'' using errcode = ''42501'';\n  end if;\n'),
      ('public.ajustar_stock_legacy(uuid, text, numeric)'::regprocedure,
       E'  if not security.puede_ajustar_stock(\n       jsonb_build_array(jsonb_build_object(''variante_id'', null, ''delta'', p_delta)),\n       null, null) then\n    raise exception ''SIN_PERMISO_STOCK'' using errcode = ''42501'';\n  end if;\n')
    ) as t(fn, chequeo)
  loop
    d := pg_get_functiondef(r.fn);
    -- El `begin` principal (columna 0) está en minúscula o en mayúscula según
    -- la función (`guardar_variantes_producto_impl` usa BEGIN).
    v_ancla := case when position(E'\nBEGIN\n' in d) > 0 then E'\nBEGIN\n' else E'\nbegin\n' end;
    v_veces := (length(d) - length(replace(d, v_ancla, ''))) / length(v_ancla);
    if v_veces <> 1 then
      raise exception '%: el begin principal aparece % veces', r.fn, v_veces;
    end if;
    execute replace(d, v_ancla, v_ancla
      || E'  -- Permiso en la base (20261023000000).\n' || r.chequeo);
  end loop;
end $$;

-- ── Guards ───────────────────────────────────────────────────────────────────
do $guard$
declare
  f text;
begin
  if not exists (
    select 1 from public.rol_permisos rp
      join public.roles r on r.id = rp.rol_id
      join public.negocios n on n.id = r.negocio_id
      join public.permisos p on p.id = rp.permiso_id
     where n.slug = 'libreria-colores' and r.nombre = 'VENDEDOR' and p.clave = 'stock.editar_producto') then
    raise exception 'Librería Colores VENDEDOR no quedó con stock.editar_producto';
  end if;

  foreach f in array array[
    'public.guardar_variantes_producto(uuid, uuid, jsonb, uuid, jsonb)',
    'public.guardar_variantes_producto_impl(uuid, uuid, jsonb, uuid, jsonb)',
    'public.ajustar_stock_variante(uuid, numeric, boolean, text, uuid)',
    'public.ajustar_stock_variantes(jsonb, boolean, text, uuid)',
    'public.ajustar_stock_legacy(uuid, text, numeric)'
  ] loop
    if position('20261023000000' in pg_get_functiondef(f::regprocedure)) = 0 then
      raise exception '%: no quedó el chequeo', f;
    end if;
    if (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception '%: no debía volverse DEFINER', f;
    end if;
  end loop;

  if (select count(*) from pg_proc where proname in ('guardar_variantes_producto', 'guardar_variantes_producto_impl',
        'ajustar_stock_variante', 'ajustar_stock_variantes', 'ajustar_stock_legacy')) <> 5 then
    raise exception 'apareció una sobrecarga en las RPC de stock';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and policyname in (
        'producto_variantes_alta_directa_permiso', 'producto_variante_valores_alta_directa_permiso',
        'productos_stock_alta_directa_permiso', 'productos_stock_edicion_directa_permiso',
        'productos_stock_baja_directa_permiso')) <> 5 then
    raise exception 'faltan policies de alta directa';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_proteger_campos_producto'
                    and tgrelid = 'public.productos'::regclass and tgenabled = 'O') then
    raise exception 'falta el trigger de productos';
  end if;
end $guard$;

commit;
