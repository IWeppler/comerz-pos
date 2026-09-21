-- `estado_cuentas_financieras` expone `revierte_a` y `revertida_por` en cada
-- transferencia, para que la pantalla sepa cuál se puede revertir.
--
-- Sin esto el botón "Revertir" tendría que adivinar: una reversa se vería
-- igual que una transferencia común y una ya revertida ofrecería revertirse
-- otra vez, para caer en `TRANSFERENCIA_YA_REVERTIDA` después del click.
--
-- Parche sobre el cuerpo VIVO con `replace()` + `execute` (el vivo está
-- minificado y no coincide con el archivo de `20260919150000`), mismo criterio
-- que `20260921180000`. Falla si el fragmento no aparece exactamente una vez.

begin;

do $$
declare
  v_def text := pg_get_functiondef('public.estado_cuentas_financieras()'::regprocedure);
  v_viejo constant text := '''registrado_por_nombre'',p.nombre)';
  v_nuevo constant text := '''registrado_por_nombre'',p.nombre,''revierte_a'',x.revierte_a,''revertida_por'',(select r.id from public.transferencias_financieras r where r.revierte_a=x.id))';
begin
  if v_def like '%revertida_por%' then
    return; -- ya parcheada
  end if;
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'GUARD: el jsonb de transferencias no aparece exactamente una vez en estado_cuentas_financieras';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;

do $guard$
begin
  if pg_get_functiondef('public.estado_cuentas_financieras()'::regprocedure) not like '%revertida_por%' then
    raise exception 'GUARD: estado_cuentas_financieras no expone revertida_por';
  end if;
  if pg_get_functiondef('public.estado_cuentas_financieras()'::regprocedure) not like '%caja.ver_gerencial%' then
    raise exception 'GUARD: estado_cuentas_financieras perdió su gate';
  end if;
end
$guard$;

commit;
