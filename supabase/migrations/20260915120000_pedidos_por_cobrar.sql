-- Pedidos por cobrar: varios puntos de venta, una sola caja.
--
-- El caso es Librería Colores: las vendedoras arman la venta en el salón y
-- el cobro lo hace UNA cajera. `modo_caja = UNICA` ya resuelve la parte de
-- la plata (todos cobran contra el mismo turno); lo que faltaba es que la
-- vendedora pueda NO cobrar y mandarle el ticket a la caja.
--
-- Un pedido NO es una venta: no toca stock, ni caja, ni factura. Es un
-- snapshot del carrito con un código corto que el cliente lleva en la mano.
-- La cajera lo abre, lo carga al carrito y cobra por el camino de siempre
-- (`registrar_venta`), que revalida precios y stock. Recién ahí existe la
-- venta, con `vendedor_id` = quien lo armó (las comisiones y el rendimiento
-- por vendedora siguen diciendo la verdad) y `cobrado_por` acá en el pedido.
--
-- Por qué no "venta PENDIENTE que después se marca pagada": PENDIENTE es
-- cuenta corriente —exige cliente, escribe movimientos de CC, corre mora y
-- entra a toda la analítica de deuda—. Y el cobro real (método, turno,
-- recargo, CAE) recién se conoce en la caja, así que igual hay que escribir
-- la venta entera en ese momento.
--
-- Dos llaves para que nada cambie en los negocios que no lo usan:
--   `configuracion_pos.pedidos_a_caja`  (default false) prende la feature.
--   permiso `ventas.cobrar`             quién puede cobrar. Se otorga a todos
--     los roles que hoy venden (ADMIN, ENCARGADO, VENDEDOR): nadie pierde
--     capacidad. Colores se lo saca a VENDEDOR y esas solo ven "Enviar a caja".

alter table public.configuracion_pos
  add column if not exists pedidos_a_caja boolean not null default false;

comment on column public.configuracion_pos.pedidos_a_caja is
  'Si el POS ofrece "Enviar a caja": la venta se arma en un punto y la cobra la caja. Con false nada cambia.';

insert into public.permisos (clave, modulo, descripcion)
values ('ventas.cobrar', 'ventas', 'Cobrar en el mostrador (confirmar la venta y recibir el pago)')
on conflict (clave) do nothing;

insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select rp.rol_id, nuevo.id, rp.negocio_id
  from public.rol_permisos rp
  join public.permisos actual
    on actual.id = rp.permiso_id
   and actual.clave = 'ventas.corregir_pago'
 cross join (select id from public.permisos where clave = 'ventas.cobrar') as nuevo
on conflict (rol_id, permiso_id) do nothing;

-- ---------------------------------------------------------------------------

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id),
  -- Número corto del día, para cantarlo en la caja: "el 14".
  numero integer not null,
  dia date not null,
  estado text not null default 'POR_COBRAR',
  vendedor_id uuid not null default auth.uid() references public.perfiles(id),
  cliente_id uuid references public.clientes(id) on delete set null,
  -- Snapshot del carrito, opaco para la base. Lo que importa para cobrar
  -- (producto, variante_id, cantidad) lo revalida `registrar_venta`.
  items jsonb not null,
  -- Solo orientativo para la lista: el total real lo calcula la caja.
  total_estimado numeric(14, 2) not null default 0,
  nota text,
  cobrado_por uuid references public.perfiles(id),
  venta_id uuid references public.ventas(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint pedidos_estado_check
    check (estado in ('POR_COBRAR', 'COBRADO', 'CANCELADO')),
  constraint pedidos_items_check
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0)
);

create unique index if not exists pedidos_numero_dia_idx
  on public.pedidos (negocio_id, dia, numero);
create index if not exists pedidos_por_cobrar_idx
  on public.pedidos (negocio_id, estado, creado_en desc);

alter table public.pedidos enable row level security;

drop policy if exists aislamiento_negocio on public.pedidos;
create policy aislamiento_negocio on public.pedidos
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

drop policy if exists pedidos_select on public.pedidos;
create policy pedidos_select on public.pedidos
  for select to authenticated using (true);

-- Crear: cualquiera del negocio, a su propio nombre.
drop policy if exists pedidos_insert on public.pedidos;
create policy pedidos_insert on public.pedidos
  for insert to authenticated
  with check (vendedor_id = auth.uid());

-- Cambiar de estado: quien lo armó (cancelar el propio) o quien cobra.
drop policy if exists pedidos_update on public.pedidos;
create policy pedidos_update on public.pedidos
  for update to authenticated
  using (vendedor_id = auth.uid() or (select public.tiene_permiso('ventas.cobrar')))
  with check (vendedor_id = auth.uid() or (select public.tiene_permiso('ventas.cobrar')));

comment on table public.pedidos is
  'Carrito armado en un punto de venta, pendiente de cobro en caja. NO es una venta: no toca stock ni caja. Se convierte en venta con registrar_venta desde la caja.';

-- Número del día, serializado por row lock (nunca max()+1).
create table if not exists public.pedidos_numeracion (
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id),
  dia date not null,
  ultimo integer not null default 0,
  primary key (negocio_id, dia)
);

alter table public.pedidos_numeracion enable row level security;
drop policy if exists aislamiento_negocio on public.pedidos_numeracion;
create policy aislamiento_negocio on public.pedidos_numeracion
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));
drop policy if exists pedidos_numeracion_todo on public.pedidos_numeracion;
create policy pedidos_numeracion_todo on public.pedidos_numeracion
  for all to authenticated using (true) with check (true);

create or replace function public.crear_pedido(
  p_items jsonb,
  p_cliente_id uuid default null,
  p_total_estimado numeric default 0,
  p_nota text default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_dia    date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_numero integer;
  v_id     uuid;
begin
  if security.current_negocio_id() is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  insert into public.pedidos_numeracion as n (dia, ultimo)
  values (v_dia, 1)
  on conflict (negocio_id, dia) do update set ultimo = n.ultimo + 1
  returning n.ultimo into v_numero;

  insert into public.pedidos (numero, dia, cliente_id, items, total_estimado, nota)
  values (v_numero, v_dia, p_cliente_id, p_items, coalesce(p_total_estimado, 0), nullif(trim(p_nota), ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'dia', v_dia);
end;
$function$;

grant execute on function public.crear_pedido(jsonb, uuid, numeric, text) to authenticated;

-- Marcar cobrado: UPDATE condicional sobre el estado, que es el freno contra
-- dos cajeras cobrando el mismo pedido. Devuelve false si ya no estaba
-- POR_COBRAR; quien llama decide qué hacer con eso.
create or replace function public.cobrar_pedido(p_pedido_id uuid, p_venta_id uuid)
returns boolean
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_filas integer;
begin
  update public.pedidos
     set estado = 'COBRADO',
         venta_id = p_venta_id,
         cobrado_por = auth.uid(),
         actualizado_en = now()
   where id = p_pedido_id
     and estado = 'POR_COBRAR';
  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$function$;

grant execute on function public.cobrar_pedido(uuid, uuid) to authenticated;
