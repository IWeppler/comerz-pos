-- Volver primero al cliente anterior. No borra eventos ni otros cambios vivos.
begin;
do $$
declare v_def text; v_antes text; v_corte text;
begin
  v_def := pg_get_functiondef('public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean,text,boolean,integer)'::regprocedure);
  v_antes := 'p_envio_a_coordinar boolean DEFAULT false, p_cupon text DEFAULT NULL::text, p_envio_gratis boolean DEFAULT false, p_items_sugeridos integer DEFAULT 0)';
  if (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes) <> 1 then raise exception 'Firma inesperada para revertir'; end if;
  v_def := replace(v_def, v_antes, 'p_envio_a_coordinar boolean DEFAULT false)');
  v_antes := ',
      ''cupon'', case when p_cupon ~ ''^[A-Z0-9]{4,20}$'' then p_cupon else null end,
      ''envio_gratis'', coalesce(p_envio_gratis, false),
      ''items_sugeridos'', greatest(0, least(coalesce(p_items_sugeridos, 0), p_renglones))';
  if (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes) <> 1 then raise exception 'Evento inesperado para revertir'; end if;
  v_def := replace(v_def, v_antes, '');
  drop function public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean,text,boolean,integer);
  execute v_def;

  v_def := pg_get_functiondef('public.metricas_pedidos_catalogo()'::regprocedure);
  if (length(v_def) - length(replace(v_def, '''marketing'',', ''))) / length('''marketing'',') <> 1 then raise exception 'Métricas inesperadas para revertir'; end if;
  v_corte := substring(v_def from E'\n        ''marketing'',.*?\n        ''ventas_30d''');
  if v_corte is null then raise exception 'No se encuentra bloque de métricas'; end if;
  execute replace(v_def, v_corte, E'\n        ''ventas_30d''');
end $$;
revoke all on function public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean) from public, anon, authenticated;
grant execute on function public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean) to anon, authenticated;
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'registrar_pedido_catalogo') <> 1 then raise exception 'Quedó sobrecarga'; end if;
end $$;
commit;
