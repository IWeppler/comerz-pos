-- Reversión de 20261012200111_precio_acordado.sql.
-- 1. Las tres RPC vuelven al precio de lista.  2. Se borran función, historial y columna.
do $$
declare v_def text; r record;
begin
  for r in
    select * from (values
      ('public.comercios_con_uso()', E'    coalesce(n.precio_acordado, pl.precio_mensual, 0) as plan_precio,\n', E'    coalesce(pl.precio_mensual, 0) as plan_precio,\n'),
      ('public.ciclo_de_vida_negocios()', E'    coalesce(n.precio_acordado, p.precio_mensual) as plan_precio,\n', E'    p.precio_mensual as plan_precio,\n'),
      ('public.metricas_globales_comerz()', E'        ''plan_precio'', coalesce(n.precio_acordado, pl.precio_mensual, 0),\n', E'        ''plan_precio'', coalesce(pl.precio_mensual, 0),\n')
    ) as t(funcion, buscar, nuevo)
  loop
    v_def := pg_get_functiondef(r.funcion::regprocedure);
    execute replace(v_def, r.buscar, r.nuevo);
    if position('precio_acordado' in pg_get_functiondef(r.funcion::regprocedure)) > 0 then
      raise exception 'REVERSION_INCOMPLETA %', r.funcion;
    end if;
  end loop;
end $$;
drop function if exists public.fijar_precio_acordado(uuid, numeric, text);
drop table if exists public.precios_acordados;
alter table public.negocios drop column if exists precio_acordado;
