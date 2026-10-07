-- M5. Patch sobre las funciones VIVAS, preservando validación y aislamiento.
begin;
do $$
declare v_def text; v_antes text; v_despues text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'registrar_pedido_catalogo') <> 1 then raise exception 'Firma de registrar_pedido_catalogo ambigua'; end if;
  v_def := pg_get_functiondef('public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean)'::regprocedure);
  if v_def not ilike '%security.negocio_publico()%' or v_def not ilike '%SECURITY DEFINER%' or v_def not ilike '%v_recientes >= 20%' then raise exception 'Cambió la protección del registro; revisar cuerpo vivo'; end if;
  v_antes := 'p_envio_a_coordinar boolean DEFAULT false)';
  v_despues := 'p_envio_a_coordinar boolean DEFAULT false, p_cupon text DEFAULT NULL, p_envio_gratis boolean DEFAULT false, p_items_sugeridos integer DEFAULT 0)';
  if (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes) <> 1 then raise exception 'Cambió la firma viva; revisar'; end if;
  v_def := replace(v_def, v_antes, v_despues);
  v_antes := '''envio_a_coordinar'', coalesce(p_envio_a_coordinar, false)';
  v_despues := v_antes || ',
      ''cupon'', case when p_cupon ~ ''^[A-Z0-9]{4,20}$'' then p_cupon else null end,
      ''envio_gratis'', coalesce(p_envio_gratis, false),
      ''items_sugeridos'', greatest(0, least(coalesce(p_items_sugeridos, 0), p_renglones))';
  if (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes) <> 1 then raise exception 'Cambió el evento vivo; revisar'; end if;
  v_def := replace(v_def, v_antes, v_despues);
  -- No dejar la firma vieja como sobrecarga. Los nuevos argumentos tienen defaults.
  drop function public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean);
  execute v_def;

  v_def := pg_get_functiondef('public.metricas_pedidos_catalogo()'::regprocedure);
  if v_def not ilike '%security.is_super_admin()%' or v_def not ilike '%SECURITY DEFINER%' then raise exception 'Falta guard super admin en métricas vivas'; end if;
  v_antes := '''ultimo_pedido'', (select max(x.creado_en) from pedidos x where x.negocio_id = n.id),';
  v_despues := v_antes || '
        ''marketing'', (select coalesce(jsonb_object_agg(g.clave, g.datos), ''{}''::jsonb) from (
          select b.clave, jsonb_build_object(
            ''pedidos'', count(*), ''monto'', coalesce(sum((e.detalle->>''total'')::numeric), 0),
            ''con_beneficio'', count(*) filter (where b.aplica),
            ''monto_beneficio'', coalesce(sum((e.detalle->>''total'')::numeric) filter (where b.aplica), 0)
          ) datos
          from public.eventos_uso e cross join lateral (values
            (''cupon'', coalesce(e.detalle->>''cupon'', '''') <> ''''),
            (''envio_gratis'', coalesce(e.detalle->>''envio_gratis'', ''false'') = ''true''),
            (''sugeridos'', coalesce((e.detalle->>''items_sugeridos'')::integer, 0) > 0)
          ) b(clave, aplica)
          where e.negocio_id = n.id and e.tipo = ''PEDIDO_CATALOGO'' and e.creado_en >= now() - interval ''30 days''
          group by b.clave
        ) g),';
  if (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes) <> 1 then raise exception 'Cambió la métrica viva; revisar'; end if;
  execute replace(v_def, v_antes, v_despues);
end $$;
revoke all on function public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean,text,boolean,integer) from public, anon, authenticated;
grant execute on function public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean,text,boolean,integer) to anon, authenticated;
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'registrar_pedido_catalogo') <> 1 then raise exception 'Quedó una sobrecarga'; end if;
  if not has_function_privilege('anon', 'public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean,text,boolean,integer)', 'execute') or has_function_privilege('anon', 'public.metricas_pedidos_catalogo()', 'execute') then raise exception 'GRANT incorrectos'; end if;
end $$;
commit;
