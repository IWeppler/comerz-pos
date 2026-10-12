-- Pagos en el checkout, T7: un pago de Mercado Pago mueve el estado de la orden.
--
-- `aplicar_pago_mp_orden` es la ÚNICA puerta por la que un pago de MP (leído de
-- la API con el token del comercio, nunca del navegador) cambia una orden. La
-- llaman el webhook y la conciliación por lectura: el mismo pago por los dos
-- caminos produce un solo efecto (clave `mp:<payment_id>:<status>`).
--
--   approved, monto y moneda = orden
--       orden viva (PENDIENTE_PAGO / EN_PROCESO)  → venta (`_registrar_venta_orden_tienda`)
--       orden que ya devolvió el stock (VENCIDA / CANCELADA) → PAGADA_SIN_STOCK
--   approved con monto o moneda distintos        → REVISAR (stock retenido)
--   pending / in_process / authorized            → EN_PROCESO (no vence mientras)
--   rejected / cancelled                         → EN_PROCESO vuelve a PENDIENTE_PAGO
--   refunded / charged_back / in_mediation       → REEMBOLSADA / CONTRACARGO / EN_DISPUTA
--       (solo sobre el pago que pagó la orden). STOPGAP #3: no anula la venta
--       ni devuelve stock; lo decide el comercio.
--
-- El monto se vuelve a comparar acá aunque el server ya lo haya hecho: lo que
-- mueve plata se valida donde se escribe.
-- Reversión: supabase/reversals/20261012171038_tienda_estados_pago_mp.sql

create or replace function public.aplicar_pago_mp_orden(
  p_negocio uuid,
  p_orden uuid,
  p_origen text,
  p_pago jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_orden record;
  v_id text := nullif(p_pago->>'mp_payment_id', '');
  v_status text := nullif(p_pago->>'estado_mp', '');
  v_monto numeric := (p_pago->>'monto')::numeric;
  v_moneda text := p_pago->>'moneda';
  v_clave text;
  v_nuevo text;
  v_resultado text := 'APLICADO';
  v_insertado uuid;
begin
  if p_origen not in ('MP_WEBHOOK', 'SISTEMA') then raise exception 'ORIGEN_INVALIDO'; end if;
  if v_id is null or v_status is null then raise exception 'PAGO_INCOMPLETO'; end if;
  v_clave := 'mp:' || v_id || ':' || v_status;

  select * into v_orden from public.ordenes_tienda o
   where o.id = p_orden and o.negocio_id = p_negocio
   for update;
  if v_orden.id is null then raise exception 'ORDEN_NO_ENCONTRADA'; end if;
  if v_orden.medio = 'TRANSFERENCIA' and v_status <> 'approved' then
    v_resultado := 'IGNORADO';
  end if;

  -- ─── approved ───
  if v_status = 'approved' and v_resultado = 'APLICADO' then
    if v_moneda is distinct from 'ARS' or v_monto is null or abs(v_monto - v_orden.total) >= 0.005 then
      if v_orden.estado in ('PENDIENTE_PAGO', 'EN_PROCESO') and v_orden.venta_id is null then
        update public.ordenes_tienda
           set estado = 'REVISAR', mp_payment_id = v_id, actualizado_en = now()
         where id = p_orden and negocio_id = p_negocio;
      end if;
      v_resultado := 'RECHAZADO_MONTO';

    elsif v_orden.venta_id is not null
       or (v_orden.estado in ('PENDIENTE_PAGO', 'EN_PROCESO') and v_orden.stock_liberado_en is null) then
      -- Venta nueva, o DUPLICADO / PAGO_DUPLICADO si ya estaba: lo registra ella.
      perform public._registrar_venta_orden_tienda(p_negocio, p_orden, p_origen, null, p_pago || jsonb_build_object('clave', v_clave));
      return case when v_orden.venta_id is null then 'APLICADO' else 'DUPLICADO' end;

    elsif v_orden.stock_liberado_en is not null and v_orden.estado in ('VENCIDA', 'CANCELADA') then
      -- Cobrada después de devolver el stock: no se re-descuenta sola.
      update public.ordenes_tienda
         set estado = 'PAGADA_SIN_STOCK', mp_payment_id = v_id, pagada_en = now(), actualizado_en = now()
       where id = p_orden and negocio_id = p_negocio;

    elsif v_orden.mp_payment_id is not null and v_orden.mp_payment_id <> v_id then
      v_resultado := 'PAGO_DUPLICADO';
    else
      v_resultado := 'IGNORADO';
    end if;

  -- ─── en proceso ───
  elsif v_status in ('pending', 'in_process', 'authorized') and v_resultado = 'APLICADO' then
    if v_orden.estado = 'PENDIENTE_PAGO' and v_orden.stock_liberado_en is null then
      update public.ordenes_tienda
         set estado = 'EN_PROCESO', mp_payment_id = v_id, actualizado_en = now()
       where id = p_orden and negocio_id = p_negocio;
    else
      v_resultado := 'IGNORADO';
    end if;

  -- ─── rechazado: puede reintentar hasta que venza ───
  elsif v_status in ('rejected', 'cancelled') and v_resultado = 'APLICADO' then
    if v_orden.estado = 'EN_PROCESO' and v_orden.mp_payment_id is not distinct from v_id then
      update public.ordenes_tienda
         set estado = 'PENDIENTE_PAGO', mp_payment_id = null, actualizado_en = now()
       where id = p_orden and negocio_id = p_negocio;
    else
      v_resultado := 'IGNORADO';
    end if;

  -- ─── después de pagada ───
  elsif v_status in ('refunded', 'charged_back', 'in_mediation') and v_resultado = 'APLICADO' then
    v_nuevo := case v_status when 'refunded' then 'REEMBOLSADA'
                             when 'charged_back' then 'CONTRACARGO'
                             else 'EN_DISPUTA' end;
    if v_orden.mp_payment_id = v_id
       and v_orden.estado in ('PAGADA', 'ENTREGADA', 'PAGADA_SIN_STOCK', 'EN_DISPUTA', 'REVISAR')
       and v_orden.estado <> v_nuevo then
      -- STOPGAP #3: la venta y el stock quedan como están.
      update public.ordenes_tienda
         set estado = v_nuevo, actualizado_en = now()
       where id = p_orden and negocio_id = p_negocio;
    else
      v_resultado := 'IGNORADO';
    end if;

  elsif v_resultado = 'APLICADO' then
    v_resultado := 'IGNORADO';
  end if;

  insert into public.eventos_pago (negocio_id, orden_id, origen, clave_idempotencia, mp_payment_id,
                                   estado_mp, monto, moneda, payload, resultado)
  values (p_negocio, p_orden, p_origen, v_clave, v_id, v_status, v_monto, v_moneda,
          coalesce(p_pago->'resumen', '{}'::jsonb), v_resultado)
  on conflict (clave_idempotencia) do nothing
  returning id into v_insertado;

  -- El mismo aviso otra vez: el UPDATE de arriba ya no cambió nada (o repitió
  -- lo mismo), y el log no se duplica.
  if v_insertado is null then return 'DUPLICADO'; end if;
  return v_resultado;
end $$;

comment on function public.aplicar_pago_mp_orden(uuid, uuid, text, jsonb) is
  'Un pago de MP (leído de la API, nunca del navegador) aplicado a una orden de la tienda. Idempotente por mp:<payment_id>:<status>. Solo service_role (webhook y conciliación). Ver docs/pagos-auditoria.md §16.';

revoke all on function public.aplicar_pago_mp_orden(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_pago_mp_orden(uuid, uuid, text, jsonb) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.aplicar_pago_mp_orden(uuid,uuid,text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.aplicar_pago_mp_orden(uuid,uuid,text,jsonb)', 'EXECUTE')
    or (select count(*) from pg_proc where proname = 'aplicar_pago_mp_orden') <> 1 then
    raise exception 'ESTADOS_PAGO_GUARD';
  end if;
end $$;
