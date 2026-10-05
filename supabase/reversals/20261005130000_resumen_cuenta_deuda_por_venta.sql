-- Reversión de 20261005130000_resumen_cuenta_deuda_por_venta.sql. Correr a mano.
-- Antes: revertir la página /r/[token] que lee `deudas`.

do $$
declare
  v_def text;
  v_ini int;
  v_fin int;
begin
  select pg_get_functiondef('public.resumen_cuenta_por_token(text)'::regprocedure) into v_def;
  v_ini := position('    ''deudas'', (' in v_def);
  v_fin := position('      where d.vivo > 0
    ),' in v_def);
  if v_ini = 0 or v_fin = 0 then
    raise exception 'resumen_cuenta_por_token: el cuerpo vivo no es el de la migración';
  end if;
  v_fin := v_fin + length('      where d.vivo > 0
    ),
');
  execute substr(v_def, 1, v_ini - 1) || substr(v_def, v_fin);
end $$;
