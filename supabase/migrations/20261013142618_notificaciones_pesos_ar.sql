-- Notificaciones: los triggers de N2 pasan a usar `pesos_ar` (ya existía, mismo
-- formato "$1.234.567") y se borra `_monto_ar`, que lo duplicaba. "Un criterio, un
-- módulo". Va aparte de N3 porque el conector MCP rechaza el `execute` dinámico
-- junto con el resto (13/10/2026).
-- Reescritura desde el cuerpo VIVO (pg_get_functiondef + replace), con guard.
-- Reversión: supabase/reversals/20261013142618_notificaciones_pesos_ar.sql

do $$
declare
  f text;
  v_def text;
begin
  foreach f in array array['public._notificar_orden_tienda()', 'public._notificar_debito_cobrado()'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if position('public._monto_ar(' in v_def) = 0 then
      raise exception 'NOTIFICACIONES_N3_SIN_MONTO_AR en %', f;
    end if;
    v_def := replace(v_def, 'public._monto_ar(', 'public.pesos_ar(');
    if position('SECURITY DEFINER' in v_def) = 0 or position('exception when others' in v_def) = 0 then
      raise exception 'NOTIFICACIONES_N3_CUERPO_INESPERADO en %', f;
    end if;
    execute v_def;
  end loop;
end $$;
drop function public._monto_ar(numeric);

do $$
begin
  if exists (select 1 from pg_proc where proname = '_monto_ar')
    or exists (select 1 from pg_proc p where p.proname in ('_notificar_orden_tienda', '_notificar_debito_cobrado')
                 and (p.prosrc not like '%public.pesos_ar(%' or not p.prosecdef)) then
    raise exception 'NOTIFICACIONES_PESOS_AR_GUARD';
  end if;
end $$;
