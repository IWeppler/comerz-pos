-- Auditoría de seguridad del 22/10/2026, punto 5: RPC internas abiertas a la
-- API y buckets sin límite de tipo ni tamaño.
--
-- 1. Cinco funciones SECURITY DEFINER que reciben un `negocio_id` y NO lo
--    validan contra la sesión eran ejecutables por anon y authenticated por
--    PostgREST (default privileges de Supabase; `revoke ... from public` no
--    alcanza, ver docs/seguridad.md):
--      sembrar_categorias_egreso / sembrar_cuentas_financieras_sistema →
--        cualquiera insertaba las filas semilla en cualquier negocio;
--      reglas_negocio → leía el plan y los overrides de cualquier negocio;
--      cuenta_financiera_sistema / cuenta_actual_venta_pago → devolvían UUIDs
--        de cuentas de cualquier negocio.
--    Son de uso INTERNO: las llaman solo otras funciones DEFINER (dueño
--    postgres, verificado el 22/10) y triggers; la app no las llama (solo las
--    nombra en comentarios). Quedan para postgres y service_role.
--
-- 2. Buckets `productos` y `logos`: sin `allowed_mime_types` ni
--    `file_size_limit`, un usuario logueado podía subir HTML o SVG (con
--    script) a un bucket público. Ahora solo los formatos que la app acepta
--    (`shared/lib/formatos-imagen.ts`: png, jpeg, webp, avif) y 10 MB.
--    Lo que hay hoy (22/10): 13.300 imágenes, todas de esos 4 tipos, máximo
--    2 MB. El tope es holgado por el banner, que se sube crudo desde el
--    celular (una foto de teléfono pesa 5–10 MB). Lo ya subido no se toca: el
--    límite rige para las subidas nuevas.
--
-- Reversión: supabase/reversals/20261022210000_cierre_rpc_internas_y_storage.sql

begin;

revoke execute on function public.sembrar_categorias_egreso(uuid) from public, anon, authenticated;
revoke execute on function public.sembrar_cuentas_financieras_sistema(uuid) from public, anon, authenticated;
revoke execute on function public.reglas_negocio(uuid) from public, anon, authenticated;
revoke execute on function public.cuenta_financiera_sistema(uuid, text) from public, anon, authenticated;
revoke execute on function public.cuenta_actual_venta_pago(uuid, text, integer, uuid) from public, anon, authenticated;

grant execute on function public.sembrar_categorias_egreso(uuid) to service_role;
grant execute on function public.sembrar_cuentas_financieras_sistema(uuid) to service_role;
grant execute on function public.reglas_negocio(uuid) to service_role;
grant execute on function public.cuenta_financiera_sistema(uuid, text) to service_role;
grant execute on function public.cuenta_actual_venta_pago(uuid, text, integer, uuid) to service_role;

update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/avif'],
       file_size_limit = 10 * 1024 * 1024
 where id in ('productos', 'logos');

do $guard$
declare
  f text;
  r text;
  v_llamador text;
begin
  foreach f in array array[
    'public.sembrar_categorias_egreso(uuid)',
    'public.sembrar_cuentas_financieras_sistema(uuid)',
    'public.reglas_negocio(uuid)',
    'public.cuenta_financiera_sistema(uuid, text)',
    'public.cuenta_actual_venta_pago(uuid, text, integer, uuid)'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '% sigue ejecutando %', r, f;
      end if;
    end loop;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'service_role perdió %', f;
    end if;
  end loop;

  -- Ningún llamador INVOKER: ese sí correría con el rol del usuario y fallaría.
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_llamador
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prokind = 'f'
     and not p.prosecdef
     and pg_get_functiondef(p.oid) ~ '\m(sembrar_categorias_egreso|sembrar_cuentas_financieras_sistema|reglas_negocio|cuenta_financiera_sistema|cuenta_actual_venta_pago)\s*\(';
  if v_llamador is not null then
    raise exception 'funciones INVOKER que llaman a las cerradas: %', v_llamador;
  end if;

  -- Ninguna policy las usa (correría con el rol del usuario).
  if exists (select 1 from pg_policies
              where (coalesce(qual, '') || coalesce(with_check, ''))
                    ~ '(sembrar_categorias_egreso|sembrar_cuentas_financieras_sistema|reglas_negocio|cuenta_financiera_sistema|cuenta_actual_venta_pago)') then
    raise exception 'una policy usa una de las funciones cerradas';
  end if;

  if (select count(*) from storage.buckets
       where id in ('productos', 'logos')
         and file_size_limit = 10 * 1024 * 1024
         and allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/avif']) <> 2 then
    raise exception 'los buckets no quedaron con el límite';
  end if;
end $guard$;

commit;
