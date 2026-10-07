-- M3. Los cupones NO son promociones automáticas ni se enumeran como anon.
begin;
alter table public.promociones add column codigo text;
alter table public.promociones add constraint promociones_codigo_formato
  check (codigo is null or codigo ~ '^[A-Z0-9]{4,20}$');
create unique index promociones_codigo_negocio_unico on public.promociones (negocio_id, codigo) where codigo is not null;

create function security.normalizar_codigo_promocion() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.codigo := nullif(upper(regexp_replace(coalesce(new.codigo, ''), '\s', '', 'g')), '');
  return new;
end $$;
revoke all on function security.normalizar_codigo_promocion() from public, anon, authenticated;
create trigger normalizar_codigo_promocion before insert or update of codigo on public.promociones
for each row execute function security.normalizar_codigo_promocion();

alter policy promociones_select_anon on public.promociones using (activa = true and codigo is null);
create policy cupones_no_enumerables on public.promociones as restrictive for select to anon using (codigo is null);
-- Los pivotes tampoco deben enumerar condiciones de cupones ocultos.
alter policy promociones_categorias_select_anon on public.promociones_categorias using (
  exists (select 1 from public.promociones p where p.id = promocion_id and p.negocio_id = promociones_categorias.negocio_id));
alter policy promociones_metodos_pago_select_anon on public.promociones_metodos_pago using (
  exists (select 1 from public.promociones p where p.id = promocion_id and p.negocio_id = promociones_metodos_pago.negocio_id));
alter policy promociones_productos_select_anon on public.promociones_productos using (
  exists (select 1 from public.promociones p where p.id = promocion_id and p.negocio_id = promociones_productos.negocio_id));
revoke select (codigo) on public.promociones from anon;

-- Privada: un registro por negocio, sin historial ni datos personales.
create table security.intentos_cupon_catalogo (
  negocio_id uuid primary key default security.current_negocio_id(),
  fallidos integer not null default 0,
  ultimo timestamptz not null default now(),
  bloqueado_hasta timestamptz,
  constraint intentos_cupon_negocio_fk foreign key (negocio_id) references public.negocios(id) on delete cascade
);
alter table security.intentos_cupon_catalogo enable row level security;
create policy aislamiento_negocio on security.intentos_cupon_catalogo as restrictive
  using (negocio_id = (select security.current_negocio_id())) with check (negocio_id = (select security.current_negocio_id()));
revoke all on security.intentos_cupon_catalogo from public, anon, authenticated;

create function public.validar_cupon_catalogo(p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_negocio uuid := security.negocio_publico();
  v_codigo text;
  v_resultado jsonb;
  v_intento security.intentos_cupon_catalogo%rowtype;
begin
  if v_negocio is null then return null; end if;
  -- Serializa contador y validación: llamadas concurrentes no evaden el límite.
  perform pg_advisory_xact_lock(hashtextextended(v_negocio::text, 203));
  insert into security.intentos_cupon_catalogo (negocio_id) values (v_negocio) on conflict do nothing;
  select * into v_intento from security.intentos_cupon_catalogo where negocio_id = v_negocio for update;
  if v_intento.bloqueado_hasta > now() then return null; end if;
  if v_intento.ultimo < now() - interval '5 minutes' then
    update security.intentos_cupon_catalogo set fallidos = 0, bloqueado_hasta = null where negocio_id = v_negocio;
  end if;
  v_codigo := upper(regexp_replace(left(coalesce(p_codigo, ''), 100), '\s', '', 'g'));
  if length(p_codigo) <= 100 and v_codigo ~ '^[A-Z0-9]{4,20}$' then
    select jsonb_build_object(
      'id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion,
      'activa', p.activa, 'acumulable', p.acumulable, 'tipo_descuento', p.tipo_descuento,
      'valor_descuento', p.valor_descuento, 'tipo_regla', p.tipo_regla,
      'monto_minimo', p.monto_minimo, 'mostrar_en_catalogo', p.mostrar_en_catalogo,
      'prioridad', p.prioridad, 'fecha_inicio', p.fecha_inicio, 'fecha_fin', p.fecha_fin,
      'limite_usos', p.limite_usos, 'usos_actuales', p.usos_actuales,
      'promociones_metodos_pago', (select coalesce(jsonb_agg(jsonb_build_object('metodo_pago', m.metodo_pago)), '[]'::jsonb) from public.promociones_metodos_pago m where m.negocio_id = v_negocio and m.promocion_id = p.id),
      'promociones_categorias', (select coalesce(jsonb_agg(jsonb_build_object('categoria_nombre', c.categoria_nombre)), '[]'::jsonb) from public.promociones_categorias c where c.negocio_id = v_negocio and c.promocion_id = p.id)
    ) into v_resultado from public.promociones p
    where p.negocio_id = v_negocio and p.codigo = v_codigo and p.activa and p.mostrar_en_catalogo
      and (p.fecha_inicio is null or p.fecha_inicio <= now())
      and (p.fecha_fin is null or p.fecha_fin >= now())
      and (p.limite_usos is null or coalesce(p.usos_actuales, 0) < p.limite_usos);
  end if;
  if v_resultado is null then
    update security.intentos_cupon_catalogo set
      fallidos = fallidos + 1, ultimo = now(),
      bloqueado_hasta = case when fallidos + 1 >= 30 then now() + interval '5 minutes' else null end
    where negocio_id = v_negocio;
  else
    update security.intentos_cupon_catalogo set fallidos = 0, ultimo = now(), bloqueado_hasta = null where negocio_id = v_negocio;
  end if;
  return v_resultado;
end $$;
revoke all on function public.validar_cupon_catalogo(text) from public, anon, authenticated;
grant execute on function public.validar_cupon_catalogo(text) to anon, authenticated;

do $$
declare v_qual text;
begin
  select qual into v_qual from pg_policies where schemaname = 'public' and tablename = 'promociones' and policyname = 'promociones_select_anon';
  if v_qual not ilike '%codigo IS NULL%' or v_qual not ilike '%activa%' then raise exception 'La lectura anon debe excluir cupones'; end if;
  if has_column_privilege('anon', 'public.promociones', 'codigo', 'select') then raise exception 'El código no debe enumerarse como anon'; end if;
  if has_table_privilege('anon', 'security.intentos_cupon_catalogo', 'select') or has_table_privilege('anon', 'security.intentos_cupon_catalogo', 'insert') then raise exception 'El contador debe ser privado'; end if;
  if not has_function_privilege('anon', 'public.validar_cupon_catalogo(text)', 'execute') then raise exception 'Falta EXECUTE de validación'; end if;
end $$;
commit;
