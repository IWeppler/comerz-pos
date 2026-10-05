-- Reversión de 20261005120000_cc_base_recargo_configurable.sql. Correr a mano.
-- Antes: revertir el código que lee `recargo_mora_base` / `capital_vencido` /
-- `recargado_*`.
-- NO devuelve el plazo de Colores a 0 (era un error de carga): queda en 32.

drop trigger if exists trg_recachear_vencimientos_por_plazo on public.configuracion_pos;
drop function if exists public.recachear_vencimientos_por_plazo();

alter table public.configuracion_pos drop constraint if exists configuracion_pos_cc_plazo_mora_check;
alter table public.configuracion_pos drop column if exists recargo_mora_base;

-- `deuda_cc_vencida` sin las columnas nuevas, desde el cuerpo VIVO.
do $$
declare
  v_def     text;
  v_comment text;
  v_ini     int;
  v_fin     int;
begin
  select pg_get_functiondef('public.deuda_cc_vencida(uuid)'::regprocedure) into v_def;
  select obj_description('public.deuda_cc_vencida(uuid)'::regprocedure, 'pg_proc') into v_comment;
  if position('vivos_r' in v_def) = 0 or position('recargado_vencido numeric)' in v_def) = 0 then
    raise exception 'deuda_cc_vencida: el cuerpo vivo no es el de la migración';
  end if;

  -- RETURNS TABLE
  v_def := replace(v_def,
    'debito_capital_mas_antiguo_id uuid, capital_vencido numeric, recargado_saldo numeric, recargado_vencido numeric)',
    'debito_capital_mas_antiguo_id uuid)');
  -- CTEs moras + vivos_r: desde el comentario hasta "  ancla as ("
  v_ini := position('  -- Las moras cobradas' in v_def);
  v_fin := position('  ancla as (' in v_def);
  v_def := substr(v_def, 1, v_ini - 1) || substr(v_def, v_fin);
  v_def := replace(v_def, '  from vivos_r v', '  from vivos v');
  -- columnas nuevas del select final
  v_ini := position('a.debito_id as debito_capital_mas_antiguo_id,' in v_def);
  v_fin := position('as recargado_vencido' in v_def) + length('as recargado_vencido');
  v_def := substr(v_def, 1, v_ini - 1) || 'a.debito_id as debito_capital_mas_antiguo_id' || substr(v_def, v_fin);

  drop function public.deuda_cc_vencida(uuid);
  execute v_def;
  grant execute on function public.deuda_cc_vencida(uuid) to anon, authenticated, service_role;
  execute format('comment on function public.deuda_cc_vencida(uuid) is %L',
    split_part(v_comment, ' `capital_vencido`', 1));
end $$;
