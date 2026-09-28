-- El Nono Cacho: la Caja Grande del sistema se alinea con el conteo físico.
--
-- Después de 20260928140000–170000 la Caja Grande del sistema tiene todo lo
-- que entró (cierres desde el 17/9 y cambios) y todo lo que se cargó como
-- salida: 1.225.612. El conteo físico del lunes 28/9 a la mañana es 189.000,
-- de los cuales 29.400 estaban en el cajón como fondo del lunes: en la Caja
-- Grande hay 159.600. Desde ese conteo entró el cierre del lunes (50.100) y
-- salió el mismo monto como fondo de la tarde, así que sigue en 159.600.
--
-- La diferencia (~1.066.012) son pagos, depósitos o retiros hechos con la
-- plata de la Caja Grande entre el 17 y el 28/9 que nunca se cargaron.
-- Decidido con la dueña (Ignacio, 28/9/2026): un solo ajuste, con nombre,
-- en vez de reconstruirlos uno por uno.
--
-- impacto_resultado = 0 a propósito: no se sabe cuánto de esa plata fue gasto
-- del negocio y cuánto retiro del dueño o pago de mercadería. Si después se
-- identifica algo, se carga como egreso con su tipo y se achica este ajuste.

begin;

do $ajuste$
declare
  v_neg    constant uuid := '106f0b93-9211-47f9-945f-4691d634f6f3';
  v_conteo constant numeric := 159600;
  v_cg     uuid;
  v_caja   uuid;
  v_saldo  numeric;
  v_caja_antes numeric;
  v_res_antes  numeric;
  v_ajuste numeric;
begin
  if not exists (select 1 from public.negocios where id = v_neg) then
    raise notice '20260928180000: El Nono Cacho no existe en esta base; nada que hacer';
    return;
  end if;

  select id into v_cg   from public.cuentas_financieras where negocio_id = v_neg and tipo = 'CAJA_GENERAL';
  select id into v_caja from public.cuentas_financieras where negocio_id = v_neg and codigo = 'CAJA_DIARIA';

  select coalesce(sum(importe), 0) into v_saldo from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_cg;
  select coalesce(sum(importe), 0) into v_caja_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja;
  select coalesce(sum(impacto_resultado), 0) into v_res_antes from public.movimientos_financieros
   where negocio_id = v_neg;

  if v_saldo <> 1225612 then
    raise exception 'GUARD: la Caja Grande está en % (se esperaba 1.225.612); revisar antes de ajustar', v_saldo;
  end if;

  v_ajuste := v_conteo - v_saldo;

  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, descripcion, datos, fecha_movimiento
  ) values (
    gen_random_uuid(), v_neg, v_cg, 'AJUSTE', v_cg, 'REGISTRO',
    v_ajuste, 0,
    'Diferencia no identificada 17–28/9: pagos, depósitos o retiros de la Caja Grande que no se cargaron (ajuste al conteo físico)',
    jsonb_build_object('conteo_fisico', v_conteo, 'saldo_sistema', v_saldo,
                       'motivo', 'Auditoría 28/9/2026: conteo 189.000 − 29.400 del fondo del lunes en el cajón'),
    now()
  );

  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_cg) <> v_conteo then
    raise exception 'GUARD: la Caja Grande no quedó en el conteo físico';
  end if;
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja) <> v_caja_antes then
    raise exception 'GUARD: cambió la caja diaria';
  end if;
  if (select coalesce(sum(impacto_resultado), 0) from public.movimientos_financieros
       where negocio_id = v_neg) <> v_res_antes then
    raise exception 'GUARD: cambió el resultado';
  end if;
end;
$ajuste$;

commit;
