-- Notificaciones: el aviso "remitos sin conciliar" linkeaba a /compras, que no
-- existe (solo /compras/merge/[id]): tocarlo daba 404 (Estilo Bonito, 13/10).
-- Apunta al más antiguo, igual que el Advisor del panel y que el texto del aviso
-- ("El más antiguo es de hace N días"). La clave no cambia: no re-avisa.
--
-- Desde el cuerpo VIVO con replace() + guards (AGENTS.md).
do $$
declare
  v_def text := pg_get_functiondef('public._estados_notificaciones(uuid)'::regprocedure);
  v_viejo text := $q$'/compras', max(r.creado_en)$q$;
  v_nuevo text := $q$'/compras/merge/' || (array_agg(r.id order by r.creado_en))[1], max(r.creado_en)$q$;
  v_nueva_def text;
begin
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'GUARD: el href de remitos no matchea exactamente una vez';
  end if;

  v_nueva_def := replace(v_def, v_viejo, v_nuevo);
  if v_nueva_def not like '%SECURITY DEFINER%' or v_nueva_def not like '%r.negocio_id = p_negocio%' then
    raise exception 'GUARD: se perdió SECURITY DEFINER o el filtro por negocio';
  end if;

  execute v_nueva_def;

  if pg_get_functiondef('public._estados_notificaciones(uuid)'::regprocedure) like $q$%'/compras',%$q$ then
    raise exception 'GUARD: sigue el link viejo';
  end if;
end $$;
