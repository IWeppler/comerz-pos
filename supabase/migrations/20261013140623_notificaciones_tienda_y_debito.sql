-- Notificaciones, N2: hechos de la tienda online y del débito automático
-- (docs/notificaciones.md). Se escriben en la MISMA transacción que los produce,
-- con triggers; un aviso que falla nunca voltea un pago (exception + warning).
--
--   1. `_notificar(...)`: alta o actualización de un hecho por `clave`. Interna.
--   2. Órdenes de la tienda (AFTER UPDATE OF estado), una notificación por orden y
--      estado (`orden:<id>:<estado>`):
--        PAGADA ............ solo si la pagó Mercado Pago (desde PENDIENTE_PAGO o
--                            EN_PROCESO). Una transferencia la confirma una persona
--                            del negocio: avisarle lo que acaba de hacer es ruido.
--        PAGADA_SIN_STOCK .. el pago llegó después de que la orden venció.
--        REVISAR, EN_DISPUTA, CONTRACARGO, REEMBOLSADA: plata en duda o devuelta.
--      Todo con tipo ORDEN_PAGADA / ORDEN_SIN_STOCK / ORDEN_REVISAR (los del CHECK
--      de N1); el título dice qué pasó.
--   3. Débito automático cobrado: `pagos_suscripcion` con `mp_payment_id` (los que
--      registra el webhook). Los pagos cargados a mano por el super admin no avisan.
-- Reversión: supabase/reversals/20261013140623_notificaciones_tienda_y_debito.sql

create or replace function public._notificar(
  p_negocio uuid, p_tipo text, p_clave text, p_titulo text, p_detalle text, p_href text,
  p_datos jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  insert into public.notificaciones (negocio_id, tipo, clave, titulo, detalle, href, datos, actualizado_en)
  values (p_negocio, p_tipo, p_clave, left(p_titulo, 200), left(p_detalle, 600), p_href,
          coalesce(p_datos, '{}'::jsonb), clock_timestamp())
  on conflict (negocio_id, clave) do update
     set titulo = excluded.titulo, detalle = excluded.detalle, href = excluded.href,
         datos = excluded.datos, actualizado_en = clock_timestamp();
exception when others then
  raise warning '[NOTIFICACIONES] % falló: %', p_clave, sqlerrm;
end $$;
revoke all on function public._notificar(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;

-- "$45.000": separador de miles con punto, sin decimales (es un aviso, no un ticket).
create or replace function public._monto_ar(p numeric)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $$
  select '$' || replace(to_char(round(coalesce(p, 0)), 'FM999,999,999,990'), ',', '.')
$$;
revoke all on function public._monto_ar(numeric) from public, anon, authenticated;

-- ─── Órdenes de la tienda ────────────────────────────────────────────────
create or replace function public._notificar_orden_tienda()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_ref text := 'Orden #' || new.numero || ' · ' || public._monto_ar(new.total);
  v_tipo text;
  v_titulo text;
  v_detalle text;
begin
  begin
  case new.estado
    when 'PAGADA' then
      if new.medio = 'TRANSFERENCIA' or old.estado not in ('PENDIENTE_PAGO', 'EN_PROCESO') then
        return null;
      end if;
      v_tipo := 'ORDEN_PAGADA';
      v_titulo := 'Venta online pagada';
      v_detalle := v_ref || ' · ' || new.cliente_nombre || '. Mercado Pago acreditó el pago: preparala para '
                   || case when new.modalidad_entrega = 'ENVIO' then 'enviar.' else 'que la retiren.' end;
    when 'PAGADA_SIN_STOCK' then
      v_tipo := 'ORDEN_SIN_STOCK';
      v_titulo := 'Pago de una orden vencida';
      v_detalle := v_ref || ' · ' || new.cliente_nombre
                   || '. El pago llegó después de que la orden venció y el stock ya se había liberado. Fijate si podés entregarla o devolvé el pago.';
    when 'REVISAR' then
      v_tipo := 'ORDEN_REVISAR';
      v_titulo := 'Orden para revisar';
      v_detalle := v_ref || '. El pago no coincide con el total de la orden: revisalo antes de entregar.';
    when 'EN_DISPUTA' then
      v_tipo := 'ORDEN_REVISAR';
      v_titulo := 'Reclamo en Mercado Pago';
      v_detalle := v_ref || ' · ' || new.cliente_nombre || '. El cliente abrió un reclamo por este pago.';
    when 'CONTRACARGO' then
      v_tipo := 'ORDEN_REVISAR';
      v_titulo := 'Contracargo de una venta online';
      v_detalle := v_ref || ' · ' || new.cliente_nombre || '. El banco del cliente desconoció el pago.';
    when 'REEMBOLSADA' then
      v_tipo := 'ORDEN_REVISAR';
      v_titulo := 'Pago devuelto';
      v_detalle := v_ref || ' · ' || new.cliente_nombre || '. Se devolvió el pago de esta orden.';
    else
      return null;
  end case;

  perform public._notificar(new.negocio_id, v_tipo, 'orden:' || new.id || ':' || new.estado,
    v_titulo, v_detalle, '/ordenes', jsonb_build_object('orden_id', new.id, 'numero', new.numero));
  exception when others then
    raise warning '[NOTIFICACIONES] aviso de orden falló: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public._notificar_orden_tienda() from public, anon, authenticated;

create trigger trg_notificar_orden_tienda
  after update of estado on public.ordenes_tienda
  for each row
  when (old.estado is distinct from new.estado
        and new.estado in ('PAGADA', 'PAGADA_SIN_STOCK', 'REVISAR', 'EN_DISPUTA', 'CONTRACARGO', 'REEMBOLSADA'))
  execute function public._notificar_orden_tienda();

-- ─── Débito automático cobrado ───────────────────────────────────────────
create or replace function public._notificar_debito_cobrado()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  perform public._notificar(new.negocio_id, 'DEBITO_COBRADO', 'debito:' || new.mp_payment_id,
    'Se cobró tu plan',
    public._monto_ar(new.monto) || coalesce(' · ' || new.plan_nombre, '')
      || coalesce('. Cubre hasta el ' || to_char(new.periodo_hasta, 'DD/MM/YYYY'), '') || '.',
    '/perfil?tab=plan', jsonb_build_object('pago_id', new.id));
  return null;
exception when others then
  raise warning '[NOTIFICACIONES] aviso de débito falló: %', sqlerrm;
  return null;
end $$;
revoke all on function public._notificar_debito_cobrado() from public, anon, authenticated;

create trigger trg_notificar_debito_cobrado
  after insert on public.pagos_suscripcion
  for each row
  when (new.mp_payment_id is not null)
  execute function public._notificar_debito_cobrado();

do $$
begin
  if has_function_privilege('authenticated', 'public._notificar(uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public._notificar(uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
    or (select count(*) from pg_trigger
         where tgname in ('trg_notificar_orden_tienda', 'trg_notificar_debito_cobrado') and not tgisinternal) <> 2
    or public._monto_ar(1234567.4) <> '$1.234.567' then
    raise exception 'NOTIFICACIONES_N2_GUARD';
  end if;
end $$;
