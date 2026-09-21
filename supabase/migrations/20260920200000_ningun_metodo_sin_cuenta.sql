-- Etapa 1: ningún método de pago puede quedar sin la cuenta donde cae su plata.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ
--
-- `cuenta_actual_venta_pago` manda un cobro directo a su cuenta solo si
-- `acreditacion_dias = 0` Y el método tiene `cuenta_destino_id`. Sin cuenta, el
-- cobro cae en el puente POR_ACREDITAR y —hasta `20260920190000`— se quedaba
-- ahí para siempre. Eso fue lo que hizo que la pestaña Dinero de Evens mostrara
-- $19.985.473 por acreditar contra $687.182 reales.
--
-- Esa migración limpió lo existente, pero **el agujero seguía abierto para
-- cualquier método nuevo**, y en particular para todos los negocios que se den
-- de alta: `crear_negocio_con_owner` siembra 'Efectivo', 'Transferencia' y
-- 'Mercado Pago', y las dos últimas nacen sin cuenta. O sea que el bug volvía
-- solo, en cada comercio nuevo, sin que nadie hiciera nada mal.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ UN TRIGGER Y NO UN CHECK
--
-- Un CHECK `tipo = 'EFECTIVO' or cuenta_destino_id is not null` sería más
-- estricto, pero obliga a reescribir las DOS sobrecargas de
-- `crear_negocio_con_owner` para que la siembra nazca en regla, y deja que
-- cualquier camino futuro que inserte un método reviente con un error de
-- constraint crudo en la cara de quien da de alta un comercio.
--
-- El trigger ya existía y ya hacía exactamente esto **para EFECTIVO**: si no
-- viene cuenta, le pone CAJA_DIARIA. Lo que se agrega acá es la otra mitad de
-- una regla que estaba escrita por la mitad. Mismo criterio que
-- `egresos.cuenta_origen_id`, que también se completa por trigger.
--
-- La cuenta que se crea se llama COMO EL MÉTODO, igual que en
-- `20260920180000`: el nombre lo puso el comercio, no lo inventa el sistema.
-- El tipo sale del tipo del método (BILLETERA_VIRTUAL → BILLETERA; el resto,
-- BANCO) y es un punto de partida editable desde el panel de cuentas.
--
-- En la práctica el trigger casi no va a actuar: el formulario de alta ahora
-- pide la cuenta. Es la red para los caminos que no pasan por el formulario —
-- la siembra de un negocio nuevo, un import, un server action futuro.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Y DE PASO, UN BUG LATENTE DEL MISMO TRIGGER
--
-- Al cambiar el TIPO de un método, la versión anterior hacía
-- `new.cuenta_destino_id := null` **siempre**. El modal de edición manda tipo y
-- cuenta juntos, así que cambiar de Transferencia a Tarjeta y elegir la cuenta
-- en la misma pantalla descartaba la elección en silencio. Ahora el reseteo
-- pasa solo cuando quien edita NO mandó una cuenta nueva: si la eligió, gana
-- la elección.

begin;

create or replace function public.asignar_cuenta_financiera_actual()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'security', 'pg_temp'
as $function$
begin
  if tg_table_name = 'turnos_caja' then
    if new.cuenta_financiera_id is null then
      new.cuenta_financiera_id := public.cuenta_financiera_sistema(
        new.negocio_id, 'CAJA_DIARIA'
      );
    end if;

  elsif tg_table_name = 'egresos' then
    if new.cuenta_origen_id is null then
      new.cuenta_origen_id := public.cuenta_financiera_sistema(
        new.negocio_id, 'CAJA_DIARIA'
      );
    end if;

  elsif tg_table_name = 'metodos_pago' then
    -- Cambiar el tipo invalida la cuenta anterior, PERO solo si quien edita no
    -- mandó una nueva en el mismo UPDATE. Antes se reseteaba siempre y la
    -- elección del formulario se perdía sin aviso.
    if tg_op = 'UPDATE'
       and old.tipo is distinct from new.tipo
       and new.cuenta_destino_id is not distinct from old.cuenta_destino_id then
      new.cuenta_destino_id := null;
    end if;

    if new.cuenta_destino_id is null and new.negocio_id is not null then
      if new.tipo = 'EFECTIVO' then
        new.cuenta_destino_id := public.cuenta_financiera_sistema(
          new.negocio_id, 'CAJA_DIARIA'
        );
      else
        -- La otra mitad de la regla. Sin esto el cobro cae en el puente y no
        -- sale. Ver el encabezado.
        insert into public.cuentas_financieras (
          negocio_id, codigo, nombre, tipo,
          es_efectivo, requiere_arqueo, es_sistema, activa
        ) values (
          new.negocio_id,
          upper(left(regexp_replace(coalesce(new.nombre, 'CUENTA'),
                                    '[^a-zA-Z0-9]+', '_', 'g'), 24))
            || '_' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
          new.nombre,
          case new.tipo when 'BILLETERA_VIRTUAL' then 'BILLETERA' else 'BANCO' end,
          false, false, false, true
        )
        returning id into new.cuenta_destino_id;
      end if;
    end if;

  elsif tg_table_name = 'venta_pagos' then
    -- Una correccion de medio debe recalcular el snapshot. Si conservara la
    -- cuenta anterior, corregir Efectivo a Debito seguiria moviendo Caja.
    if tg_op = 'UPDATE'
       and row(old.metodo_pago_id, old.metodo_tipo)
           is distinct from row(new.metodo_pago_id, new.metodo_tipo) then
      new.cuenta_destino_id := null;
    end if;

    if new.cuenta_destino_id is null and new.metodo_pago_id is not null then
      select m.cuenta_destino_id
        into new.cuenta_destino_id
        from public.metodos_pago m
       where m.id = new.metodo_pago_id
         and m.negocio_id = new.negocio_id;
    end if;

    if new.cuenta_destino_id is null and new.metodo_tipo = 'EFECTIVO' then
      new.cuenta_destino_id := public.cuenta_financiera_sistema(
        new.negocio_id, 'CAJA_DIARIA'
      );
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.asignar_cuenta_financiera_actual() from public;

-- El trigger de `metodos_pago` escuchaba `UPDATE OF tipo`. Ahora también tiene
-- que despertarse cuando alguien BORRA la cuenta de un método (la deja en
-- null), que es el otro camino por el que un método se queda sin destino.
drop trigger if exists trg_metodos_pago_asignar_cuenta on public.metodos_pago;
create trigger trg_metodos_pago_asignar_cuenta
  before insert or update of tipo, cuenta_destino_id on public.metodos_pago
  for each row execute function public.asignar_cuenta_financiera_actual();

-- ─────────────────────────────────────────────────────────────────────────
-- GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_cuerpo text;
  v_metodo uuid;
  v_negocio uuid;
  v_cuenta uuid;
begin
  select pg_get_functiondef(p.oid) into v_cuerpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'asignar_cuenta_financiera_actual';

  if v_cuerpo not like '%insert into public.cuentas_financieras%' then
    raise exception 'GUARD: el trigger dejo de crear la cuenta del metodo digital';
  end if;

  -- Ninguno de los que ya existen puede quedar sin cuenta.
  if exists (
    select 1 from public.metodos_pago
     where tipo <> 'EFECTIVO'
       and cuenta_destino_id is null
       and negocio_id is not null
  ) then
    raise exception 'GUARD: quedo un metodo de pago digital sin cuenta destino';
  end if;

  -- Y la regla tiene que valer para el PROXIMO, no solo para los de ahora:
  -- se prueba insertando uno y viendo que salga con cuenta. Se deshace en el
  -- acto; la migracion entera es una transaccion, pero igual se limpia para no
  -- dejar basura si alguien corre este bloque suelto.
  select id into v_negocio from public.negocios order by created_at limit 1;

  if v_negocio is not null then
    insert into public.metodos_pago (negocio_id, nombre, tipo, comision, acreditacion_dias, activo)
    values (v_negocio, 'GUARD 20260920200000', 'TARJETA', 0, 0, false)
    returning id, cuenta_destino_id into v_metodo, v_cuenta;

    if v_cuenta is null then
      raise exception 'GUARD: un metodo digital nuevo salio sin cuenta destino';
    end if;

    delete from public.metodos_pago where id = v_metodo;
    delete from public.cuentas_financieras where id = v_cuenta;
  end if;
end;
$guard$;

commit;
