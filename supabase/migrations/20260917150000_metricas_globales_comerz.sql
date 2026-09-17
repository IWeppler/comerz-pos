-- Métricas globales del SaaS para /admincomerz/metricas.
--
-- Una sola RPC que cuenta del lado de la base y devuelve NÚMEROS, no filas:
-- "ventas totales" son 3.500 filas hoy y van a ser 100.000, y traerlas a Node
-- para sumarlas sería bajar el historial de los 11 negocios en cada carga del
-- panel. Mismo criterio que `comercios_con_uso`.
--
-- SECURITY DEFINER porque cruza tenants (la RLS de cada tabla solo deja ver el
-- negocio activo) y lee `auth.users` para saber quién entró. Lo único que la
-- protege es el `if not security.is_super_admin() then raise` de la primera
-- línea — misma forma que `funnel_comerz` y `embudo_de_alta`, con el guard de
-- abajo que falla si ese chequeo desaparece del cuerpo.
--
-- Devuelve HECHOS (conteos y sumas). Los porcentajes, qué se considera
-- "usuario activo" y cómo se rotula cada cosa se deciden en
-- `features/admin/lib/metricas-globales.ts`, con tests. Una tasa calculada
-- acá no se puede testear sin base.
--
-- Los negocios se devuelven TODOS con su estado y es el TS el que decide
-- quién cuenta como cliente. Los agregados globales (usuarios, catálogo,
-- ventas por mes) sí filtran acá, porque no vuelven por negocio: cuentan solo
-- los HABILITADOS (activo o prueba). Un cancelado no es un cliente y un demo
-- no lo fue nunca.
--
-- El rubro que se devuelve es el COMERCIAL (`negocios.rubro_comercial`: a
-- quién le vendemos), no el operativo de `configuracion_pos` (qué plantilla
-- usa). Librería Colores es una librería que opera con la identidad de
-- indumentaria; para segmentar clientes importa lo primero. Los cuatro
-- negocios anteriores al campo se backfillean abajo.

-- Los cuatro negocios anteriores a `rubro_comercial` no lo tienen cargado y
-- el panel los mostraría como "Sin rubro". Se deduce del operativo, que en
-- esos cuatro coincide con lo que venden (tres tiendas de ropa y un electro).
update public.negocios set rubro_comercial = 'indumentaria'
 where rubro_comercial is null and slug in ('evens-indumentaria', 'estilo-bonito', 'ninja-camisetas');
update public.negocios set rubro_comercial = 'electronica'
 where rubro_comercial is null and slug = 'clicktostado';

-- Librería Colores se dio de alta como librería y quedó operando con la
-- plantilla de indumentaria (talle, color, género). Su operativo correcto es
-- `otros`, que es a donde `rubroOperativoDesde` manda a las librerías. Es
-- lo mismo que hizo `20260908140000` con El Nono Cacho.
update public.configuracion_pos set rubro = 'otros'
 where rubro = 'indumentaria'
   and negocio_id = (select id from public.negocios where slug = 'libreria-colores');

create or replace function public.metricas_globales_comerz()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'security', 'pg_temp'
as $$
declare
  v_resultado jsonb;
begin
  if not security.is_super_admin() then
    raise exception 'SOLO_SUPER_ADMIN';
  end if;

  select jsonb_build_object(
    -- Un objeto por negocio con lo que hace falta para agrupar: estado, plan
    -- y rubro. Agrupar acá obligaría a una consulta por eje; con 11 filas (y
    -- con 500) es más barato mandarlas y agrupar en TS, que además puede
    -- cruzar ejes ("planes solo de los activos") sin volver a la base.
    'negocios', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', n.id,
        'nombre', n.nombre,
        'estado', n.estado,
        'created_at', n.created_at,
        'plan_id', n.plan_id,
        'plan_nombre', pl.nombre,
        'plan_precio', coalesce(pl.precio_mensual, 0),
        'rubro', n.rubro_comercial,
        'usuarios', (select count(*) from public.usuarios_negocios u where u.negocio_id = n.id),
        'productos', (select count(*) from public.productos p where p.negocio_id = n.id),
        'ventas', (select count(*) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA'),
        'facturado', (select coalesce(sum(v.total), 0) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA'),
        'ventas_30d', (select count(*) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA' and v.fecha_venta >= now() - interval '30 days'),
        'facturado_30d', (select coalesce(sum(v.total), 0) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA' and v.fecha_venta >= now() - interval '30 days'),
        'ultima_venta', (select max(v.fecha_venta) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA')
      ) order by n.created_at), '[]'::jsonb)
      from public.negocios n
      left join public.planes pl on pl.id = n.plan_id
    ),

    -- Los planes que existen, para que el panel muestre también los que
    -- tienen cero clientes (un plan sin nadie es un dato).
    'planes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nombre', p.nombre, 'precio_mensual', p.precio_mensual
      ) order by p.precio_mensual), '[]'::jsonb)
      from public.planes p
    ),

    -- Personas, no membresías: un usuario en dos negocios cuenta una vez.
    -- La actividad sale de auth: `last_sign_in_at` es el último login y
    -- `sessions.updated_at` el último refresh de token, que es lo más cerca
    -- de "estuvo usando la app" que guarda Supabase.
    'usuarios', (
      with personas as (
        select distinct un.usuario_id
        from public.usuarios_negocios un
        join public.negocios n on n.id = un.negocio_id
        where n.estado in ('activo', 'prueba')
      ),
      actividad as (
        select p.usuario_id,
               greatest(
                 (select u.last_sign_in_at from auth.users u where u.id = p.usuario_id),
                 (select max(s.updated_at) from auth.sessions s where s.user_id = p.usuario_id)
               ) as ultima
        from personas p
      )
      select jsonb_build_object(
        'total', (select count(*) from personas),
        'activos_7d', (select count(*) from actividad where ultima >= now() - interval '7 days'),
        'activos_30d', (select count(*) from actividad where ultima >= now() - interval '30 days'),
        'por_rol', (
          select coalesce(jsonb_object_agg(rol, n), '{}'::jsonb)
          from (
            select un.rol, count(distinct un.usuario_id) n
            from public.usuarios_negocios un
            join public.negocios ng on ng.id = un.negocio_id
            where ng.estado in ('activo', 'prueba')
            group by un.rol
          ) r
        )
      )
    ),

    -- Volumen del catálogo y de la cuenta corriente, solo habilitados.
    'catalogo', (
      select jsonb_build_object(
        'productos', (select count(*) from public.productos p join public.negocios n on n.id = p.negocio_id where n.estado in ('activo', 'prueba')),
        'variantes', (select count(*) from public.producto_variantes v join public.negocios n on n.id = v.negocio_id where n.estado in ('activo', 'prueba')),
        'clientes', (select count(*) from public.clientes c join public.negocios n on n.id = c.negocio_id where n.estado in ('activo', 'prueba')),
        'deuda_cc_viva', (select coalesce(sum(c.saldo_pendiente), 0) from public.clientes c join public.negocios n on n.id = c.negocio_id where n.estado in ('activo', 'prueba') and c.saldo_pendiente > 0)
      )
    ),

    -- Ventas por mes, últimos 12, sin anuladas y solo habilitados: la curva
    -- de uso del sistema entero.
    'ventas_por_mes', (
      select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'ventas', ventas, 'facturado', facturado) order by mes), '[]'::jsonb)
      from (
        select to_char(date_trunc('month', v.fecha_venta), 'YYYY-MM') mes,
               count(*) ventas,
               coalesce(sum(v.total), 0) facturado
        from public.ventas v
        join public.negocios n on n.id = v.negocio_id
        where v.estado_operacion <> 'ANULADA'
          and n.estado in ('activo', 'prueba')
          and v.fecha_venta >= date_trunc('month', now()) - interval '11 months'
        group by 1
      ) m
    ),

    'generado_en', now()
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.metricas_globales_comerz() from public;
grant execute on function public.metricas_globales_comerz() to authenticated;

comment on function public.metricas_globales_comerz() is
  'Métricas globales del SaaS para el panel de Comerz. Solo super admin: cruza tenants y lee auth.users.';

-- Guard: si alguien reescribe la función y se lleva el chequeo, que falle acá.
do $$
begin
  if position('is_super_admin' in pg_get_functiondef('public.metricas_globales_comerz()'::regprocedure)) = 0 then
    raise exception 'metricas_globales_comerz quedó sin el chequeo de super admin';
  end if;
end $$;
