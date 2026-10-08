-- Reversión de 20261008120000_negocios_cuenta_en_mrr.sql.
-- Antes de correrla, volver el código que lee `cuenta_en_mrr` (métricas de
-- /admincomerz y el menú del comercio): si no, esas consultas fallan.

-- 1. La RPC deja de devolver la columna (desde el cuerpo vivo).
do $$
declare
  v_def text := pg_get_functiondef('public.metricas_globales_comerz()'::regprocedure);
  v_quitar text := $q$
        'cuenta_en_mrr', n.cuenta_en_mrr,$q$;
begin
  if position(v_quitar in v_def) = 0 then
    raise exception 'Reversión: no encuentro cuenta_en_mrr en metricas_globales_comerz';
  end if;
  execute replace(v_def, v_quitar, '');
end $$;

-- 2. La columna.
alter table public.negocios drop column if exists cuenta_en_mrr;
