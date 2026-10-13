-- Pagos en el checkout: "Marcar entregada".
--
-- La orden pagada ya tiene su venta (se registra al pagar); entregar NO toca
-- plata ni stock, solo cierra el ciclo de la orden para que no se acumule en
-- "Para entregar". Por eso es reversible: un toque de más se deshace desde el
-- aviso ("Deshacer"), sin diálogo de confirmación.
--
--   1. `ordenes_tienda.entregada_en` / `entregada_por` (quién la entregó).
--   2. `marcar_orden_entregada(p_orden, p_entregada)`: DEFINER, negocio de la
--      SESIÓN y permiso `ventas.cobrar` (el mismo que confirmar y cancelar).
--      PAGADA → ENTREGADA con true; ENTREGADA → PAGADA con false. UPDATE
--      condicional: devuelve false si la orden no estaba en el estado de
--      partida (otra pestaña ya lo hizo).
-- Reversión: supabase/reversals/20261012190806_tienda_marcar_entregada.sql

alter table public.ordenes_tienda
  add column entregada_en timestamptz,
  add column entregada_por uuid;

create or replace function public.marcar_orden_entregada(p_orden uuid, p_entregada boolean default true)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_id uuid;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not coalesce(public.tiene_permiso('ventas.cobrar'), false) then raise exception 'SIN_PERMISO'; end if;

  if p_entregada then
    update public.ordenes_tienda
       set estado = 'ENTREGADA', entregada_en = now(), entregada_por = auth.uid(), actualizado_en = now()
     where id = p_orden and negocio_id = v_negocio and estado = 'PAGADA'
    returning id into v_id;
  else
    update public.ordenes_tienda
       set estado = 'PAGADA', entregada_en = null, entregada_por = null, actualizado_en = now()
     where id = p_orden and negocio_id = v_negocio and estado = 'ENTREGADA'
    returning id into v_id;
  end if;
  return v_id is not null;
end $$;

comment on function public.marcar_orden_entregada(uuid, boolean) is
  'PAGADA ↔ ENTREGADA de una orden de la tienda. No toca venta, plata ni stock. Sesión + ventas.cobrar.';

revoke all on function public.marcar_orden_entregada(uuid, boolean) from public, anon;
grant execute on function public.marcar_orden_entregada(uuid, boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.marcar_orden_entregada(uuid,boolean)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.marcar_orden_entregada(uuid,boolean)', 'EXECUTE')
    or (select count(*) from pg_proc where proname = 'marcar_orden_entregada') <> 1 then
    raise exception 'ENTREGADA_GUARD';
  end if;
end $$;
