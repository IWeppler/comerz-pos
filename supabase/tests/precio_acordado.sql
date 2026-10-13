-- Test de 20261012200111_precio_acordado.sql (correr la migración antes, en la
-- misma transacción). Termina en DRY_RUN_OK: no deja nada.
-- Cubre: el super admin fija un precio y queda en el historial con el motivo;
-- las tres RPC devuelven el precio efectivo; volver a null = precio de lista;
-- un usuario común no puede fijarlo ni leer el historial.
do $$
declare
  sa uuid := (select id from auth.users where email = 'ignacionweppler@gmail.com');
  otro uuid := (select id from auth.users where email <> 'ignacionweppler@gmail.com' limit 1);
  n uuid := (select id from public.negocios where slug = 'clicktostado');
  lista numeric;
  mrr_antes numeric; mrr_despues numeric;
begin
  select p.precio_mensual into lista from public.negocios ng join public.planes p on p.id = ng.plan_id where ng.id = n;

  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.fijar_precio_acordado(n, 30000, 'Ayuda con feedback') then raise exception 'FALLA fijar'; end if;
  if (select plan_precio from public.comercios_con_uso() where id = n) <> 30000 then raise exception 'FALLA comercios_con_uso'; end if;
  if (select plan_precio from public.ciclo_de_vida_negocios() where negocio_id = n) <> 30000 then raise exception 'FALLA ciclo'; end if;
  if (select (e->>'plan_precio')::numeric from jsonb_array_elements(public.metricas_globales_comerz()->'negocios') e where e->>'id' = n::text) <> 30000 then
    raise exception 'FALLA metricas';
  end if;
  if (select motivo from public.precios_acordados where negocio_id = n order by creado_en desc limit 1) <> 'Ayuda con feedback' then
    raise exception 'FALLA historial';
  end if;
  perform public.fijar_precio_acordado(n, null, 'Vuelve a lista');
  if (select plan_precio from public.comercios_con_uso() where id = n) <> lista then raise exception 'FALLA volver a lista'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', otro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.fijar_precio_acordado(n, 1, null);
    raise exception 'FALLA: un usuario común fijó precio';
  exception when others then if sqlerrm <> 'SIN_PERMISO' then raise; end if; end;
  if exists (select 1 from public.precios_acordados) then raise exception 'FALLA: un usuario común lee el historial'; end if;
  reset role;

  raise exception 'DRY_RUN_OK';
end $$;
