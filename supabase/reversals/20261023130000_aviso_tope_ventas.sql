-- Reversión de 20261023130000_aviso_tope_ventas.sql (correr a mano).
-- Saca la rama del tope de _estados_notificaciones desde el cuerpo vivo.
do $$
declare
  v_def text := pg_get_functiondef('public._estados_notificaciones(uuid)'::regprocedure);
  v_viejo text := E'\n\n  union all\n  select * from public._estado_tope_ventas(p_negocio)';
begin
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'REVERSION: la rama del tope no matchea exactamente una vez';
  end if;
  execute replace(v_def, v_viejo, '');
end $$;

drop function if exists public._estado_tope_ventas(uuid);
drop function if exists public.ventas_del_mes_por_comercio();
