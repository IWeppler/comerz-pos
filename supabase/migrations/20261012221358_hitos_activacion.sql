-- Aditiva. La modificación de las RPC se deriva del cuerpo VIVO al aplicar.
create table public.hitos_activacion (
  negocio_id uuid not null default security.current_negocio_id() references public.negocios(id) on delete cascade,
  hito text not null check (hito in ('POS_ABIERTO','CAMINO_VENTA_LIBRE','CAMINO_IMPORTACION','CAMINO_CARGA_RAPIDA','CAMINO_CARGA_MANUAL','PRIMERA_VENTA_FESTEJADA')),
  usuario_id uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  primary key (negocio_id, hito)
);
alter table public.hitos_activacion enable row level security;
revoke all on public.hitos_activacion from public, anon, authenticated;
grant select on public.hitos_activacion to authenticated;
create policy hitos_aislamiento on public.hitos_activacion as restrictive for select to authenticated
  using (negocio_id = (select security.current_negocio_id()) or (select security.is_super_admin()));
create policy hitos_lectura on public.hitos_activacion as permissive for select to authenticated
  using (negocio_id = (select security.current_negocio_id()) or (select security.is_super_admin()));

create function public.registrar_hito_activacion(p_hito text) returns void
language plpgsql security definer set search_path = public as $$
declare v_negocio uuid;
begin
  if auth.uid() is null then return; end if;
  v_negocio := security.current_negocio_id();
  if v_negocio is null then return; end if;
  if p_hito is null or p_hito not in ('POS_ABIERTO','CAMINO_VENTA_LIBRE','CAMINO_IMPORTACION','CAMINO_CARGA_RAPIDA','CAMINO_CARGA_MANUAL','PRIMERA_VENTA_FESTEJADA') then
    raise exception 'HITO_DESCONOCIDO';
  end if;
  insert into public.hitos_activacion(negocio_id,hito,usuario_id)
    values(v_negocio,p_hito,auth.uid()) on conflict (negocio_id,hito) do nothing;
end $$;
revoke execute on function public.registrar_hito_activacion(text) from public, anon, authenticated;
grant execute on function public.registrar_hito_activacion(text) to authenticated;

do $$
declare firma text; cuerpo text; modificado text; filtro text; permiso text;
begin
  foreach firma in array array['public.estado_activacion()','public.estado_activacion_de(uuid)'] loop
    cuerpo := pg_get_functiondef(firma::regprocedure);
    permiso := case when firma = 'public.estado_activacion()' then 'public.is_admin()' else 'security.is_super_admin()' end;
    filtro := case when firma = 'public.estado_activacion()' then 'security.current_negocio_id()' else 'p_negocio' end;
    if length(cuerpo)-length(replace(cuerpo,'jsonb_build_object(','')) <> length('jsonb_build_object(')
      or position('venta_libre_elegida' in cuerpo)>0
      or position(permiso in cuerpo)=0
      or cuerpo !~* 'when\s+not\s+[^\n]+then\s+null' then
      raise exception 'ESTADO_ACTIVACION_ANCLA_O_PERMISO_INESPERADO: %',firma;
    end if;
    modificado := replace(cuerpo,'jsonb_build_object(',
      'jsonb_build_object(' || E'\n      ''venta_libre_elegida'', exists (select 1 from public.hitos_activacion h where h.negocio_id = ' || filtro || ' and h.hito = ''CAMINO_VENTA_LIBRE''),');
    execute modificado;
    if pg_get_functiondef(firma::regprocedure) not like '%venta_libre_elegida%'
      or position(permiso in pg_get_functiondef(firma::regprocedure))=0
      or pg_get_functiondef(firma::regprocedure) not like '%stock_y_precios%'
      or pg_get_functiondef(firma::regprocedure) not like '%primera_venta%' then
      raise exception 'ESTADO_ACTIVACION_GUARD';
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid='public.hitos_activacion'::regclass)
    or not exists(select 1 from pg_policies where schemaname='public' and tablename='hitos_activacion' and policyname='hitos_aislamiento' and permissive='RESTRICTIVE')
    or has_table_privilege('anon','public.hitos_activacion','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege('anon','public.hitos_activacion','SELECT,INSERT,UPDATE,REFERENCES')
    or has_table_privilege('authenticated','public.hitos_activacion','INSERT,UPDATE,DELETE')
    or has_function_privilege('anon','public.registrar_hito_activacion(text)','EXECUTE')
    or not (select prosecdef from pg_proc where oid='public.registrar_hito_activacion(text)'::regprocedure)
    or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='registrar_hito_activacion')<>1 then
    raise exception 'HITOS_ACTIVACION_GUARD';
  end if;
end $$;
