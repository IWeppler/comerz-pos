-- Reversión de 20261012165722_tienda_gracia_mp.sql: vuelve al vencimiento sin gracia.

do $$
declare
  v_def text;
  v_buscar constant text := E'       -- MP: 30 min de gracia para registrar un pago del último minuto (20261012180000).\n'
                         || E'       and vence_en + case when medio = ''TRANSFERENCIA'' then interval ''0''\n'
                         || E'                           else interval ''30 minutes'' end < now()\n';
  v_nuevo constant text := E'       and vence_en < now()\n';
  v_veces int;
begin
  v_def := pg_get_functiondef('public.liberar_ordenes_tienda_vencidas(uuid)'::regprocedure);
  v_veces := (length(v_def) - length(replace(v_def, v_buscar, ''))) / length(v_buscar);
  if v_veces <> 1 then raise exception 'REVERSION_ANCLA: matchea % veces', v_veces; end if;
  execute replace(v_def, v_buscar, v_nuevo);
end $$;
