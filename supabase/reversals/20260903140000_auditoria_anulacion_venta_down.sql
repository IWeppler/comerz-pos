-- Rollback de 20260903140000_auditoria_anulacion_venta.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- LO QUE SE PIERDE, y no vuelve: quién anuló cada venta, cuándo y por qué. El
-- destino de la mercadería sobrevive porque `motivo_anulacion` se siguió
-- escribiendo en paralelo, pero `anulada_por`, `anulada_en`, `motivo_codigo` y
-- `motivo_detalle` no están duplicados en ningún lado. Copiar antes:
--
--   create table ventas_auditoria_anulacion_respaldo as
--     select id, anulada_por, anulada_en, destino_mercaderia,
--            motivo_codigo, motivo_detalle
--       from ventas where estado_operacion = 'ANULADA';
--
-- ORDEN: primero la función y después las columnas. Al revés, la función
-- quedaría un instante referenciando columnas que ya no existen y cualquier
-- anulación en ese momento fallaría.
--
-- La función vuelve a su firma de TRES parámetros, que es la que espera el
-- código anterior a este cambio. Si el código desplegado es el nuevo —el que
-- manda cinco— hay que bajarlo ANTES de correr esto, o sus llamadas van a
-- fallar por argumentos que la función ya no acepta.

begin;

drop function if exists public.anular_venta(uuid, text, uuid, text, text);

create function public.anular_venta(
  p_venta_id uuid,
  p_motivo text,
  p_turno_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_cliente uuid;
  v_pendiente numeric;
  v_efectivo numeric;
  v_otros numeric;
  v_saldo numeric;
  v_credito numeric := 0;
  v_excedente numeric := 0;
  v_ticket text := upper(split_part(p_venta_id::text, '-', 1));
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  update public.ventas
     set estado_operacion = 'ANULADA',
         estado_pago = 'ANULADA',
         motivo_anulacion = p_motivo
   where id = p_venta_id
     and estado_operacion <> 'ANULADA'
  returning cliente_id, coalesce(monto_pendiente, 0)
       into v_cliente, v_pendiente;

  if not found then
    raise exception 'VENTA_NO_ANULABLE';
  end if;

  update public.venta_pagos
     set estado_pago_operacion = 'ANULADO'
   where venta_id = p_venta_id;

  select
    coalesce(sum(monto_bruto) filter (where metodo_tipo = 'EFECTIVO'), 0),
    coalesce(sum(monto_bruto) filter (where metodo_tipo <> 'EFECTIVO'), 0)
    into v_efectivo, v_otros
  from public.venta_pagos
  where venta_id = p_venta_id;

  if v_efectivo > 0 then
    insert into public.egresos (negocio_id, concepto, monto, creado_por, turno_caja_id)
    values (
      v_negocio,
      'Devolucion en efectivo - Venta #' || v_ticket,
      round(v_efectivo)::int,
      auth.uid(),
      p_turno_id
    );
  end if;

  if v_cliente is not null and v_pendiente > 0 then
    select coalesce(saldo_pendiente, 0) into v_saldo
      from public.clientes
     where id = v_cliente
       for update;

    if found then
      v_credito := least(v_pendiente, greatest(v_saldo, 0));
      v_excedente := v_pendiente - v_credito;

      if v_credito > 0 then
        insert into public.cuenta_corriente_movimientos (
          negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por
        )
        values (
          v_negocio, v_cliente, p_venta_id, 'CREDITO', v_credito,
          'Anulacion de Venta #' || v_ticket, auth.uid()
        );

        update public.clientes
           set saldo_pendiente = greatest(0, coalesce(saldo_pendiente, 0) - v_credito)
         where id = v_cliente;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'efectivo_devuelto', v_efectivo,
    'no_efectivo_a_devolver', v_otros,
    'credito_aplicado', v_credito,
    'excedente_ya_pagado', v_excedente,
    'cliente_id', v_cliente
  );
end;
$$;

revoke all on function public.anular_venta(uuid, text, uuid) from public;
grant execute on function public.anular_venta(uuid, text, uuid) to authenticated;

alter table public.ventas
  drop constraint if exists ventas_destino_mercaderia_check,
  drop constraint if exists ventas_motivo_codigo_check;

alter table public.ventas
  drop column if exists anulada_por,
  drop column if exists anulada_en,
  drop column if exists destino_mercaderia,
  drop column if exists motivo_codigo,
  drop column if exists motivo_detalle;

comment on column public.ventas.motivo_anulacion is null;

commit;
