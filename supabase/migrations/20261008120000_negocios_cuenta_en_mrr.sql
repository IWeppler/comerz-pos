-- Qué comercios suman al MRR lo decide Comerz, no el estado.
--
-- Hasta ahora el MRR era "todo lo `activo` a precio de lista". Pero hay
-- comercios activos que no pagan (una cortesía, un comercio amigo): están
-- operando y tienen que estar `activo` —si no, la barra de prueba les dice que
-- se les terminó—, pero sumarlos al MRR es contar plata que no va a entrar.
--
-- Es un eje aparte del estado a propósito, como `plan_vencimiento`: un comercio
-- puede ser activo y no sumar. Default true: todos los que ya sumaban siguen
-- sumando, y el código anterior a esta columna no cambia de comportamiento.
--
-- Solo la escribe el super admin (`negocios_update_super_admin`). No se le da
-- a `anon`: el catálogo público no la necesita.

alter table public.negocios
  add column if not exists cuenta_en_mrr boolean not null default true;

comment on column public.negocios.cuenta_en_mrr is
  'Suma al MRR de /admincomerz (si además está activo). La decide Comerz.';

do $$
declare
  v_falsos int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'negocios'
       and column_name = 'cuenta_en_mrr'
       and data_type = 'boolean' and is_nullable = 'NO'
  ) then
    raise exception 'Guard: negocios.cuenta_en_mrr no quedó boolean not null';
  end if;

  -- Recién creada, nadie puede estar afuera: si no, el MRR cambió solo.
  select count(*) into v_falsos from public.negocios where not cuenta_en_mrr;
  if v_falsos <> 0 then
    raise exception 'Guard: % negocios nacieron fuera del MRR', v_falsos;
  end if;

  -- Sigue siendo solo del super admin.
  if (select count(*) from pg_policies
       where tablename = 'negocios' and cmd = 'UPDATE') <> 1
     or not exists (select 1 from pg_policies
       where tablename = 'negocios' and policyname = 'negocios_update_super_admin'
         and qual like '%is_super_admin%') then
    raise exception 'Guard: cambió la policy de UPDATE de negocios';
  end if;
end $$;

-- La página de métricas calcula su MRR con los hechos de esta RPC: tiene que
-- recibir la columna, o el panel y las métricas dan dos MRR distintos.
-- Desde el cuerpo VIVO, con un solo reemplazo y lo crítico verificado.
do $$
declare
  v_def text := pg_get_functiondef('public.metricas_globales_comerz()'::regprocedure);
  v_buscar text := $q$'plan_precio', coalesce(pl.precio_mensual, 0),$q$;
  v_nuevo text;
begin
  if (length(v_def) - length(replace(v_def, v_buscar, ''))) / length(v_buscar) <> 1 then
    raise exception 'Guard: el ancla de metricas_globales_comerz no aparece exactamente una vez';
  end if;

  v_nuevo := replace(
    v_def,
    v_buscar,
    v_buscar || $q$
        'cuenta_en_mrr', n.cuenta_en_mrr,$q$
  );
  execute v_nuevo;

  v_def := pg_get_functiondef('public.metricas_globales_comerz()'::regprocedure);
  if v_def not like '%''cuenta_en_mrr'', n.cuenta_en_mrr%' then
    raise exception 'Guard: metricas_globales_comerz no devuelve cuenta_en_mrr';
  end if;
  if v_def not like '%security.is_super_admin()%' or v_def not like '%SOLO_SUPER_ADMIN%' then
    raise exception 'Guard: metricas_globales_comerz perdió el chequeo de super admin';
  end if;
  if not (select prosecdef from pg_proc
           where oid = 'public.metricas_globales_comerz()'::regprocedure) then
    raise exception 'Guard: metricas_globales_comerz dejó de ser SECURITY DEFINER';
  end if;
  if (select count(*) from pg_proc
       where proname = 'metricas_globales_comerz'
         and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'Guard: más de una metricas_globales_comerz';
  end if;
end $$;
