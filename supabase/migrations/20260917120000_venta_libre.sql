-- Venta libre: un renglón que no es ningún producto del catálogo.
--
-- El caso es el mostrador de un cotillón (El Nono Cacho, 17/9/2026): una
-- clienta pide "12 globos sueltos" o "la piñata que está colgada" y la
-- vendedora no puede parar la venta para dar de alta el producto, elegirle
-- categoría y foto, y recién después cobrarlo. Hasta acá la ÚNICA forma de
-- cobrar algo era que existiera en `productos` — y lo que no existía se cobraba
-- afuera del sistema, o sea que no quedaba en caja, ni en el ticket, ni en el
-- cierre del turno.
--
-- Se modela como un renglón de `ventas_items` SIN producto y SIN variante, con
-- la descripción tipeada en `variante` (que ya era el texto libre del renglón)
-- y una marca explícita `es_venta_libre`. La marca es una columna y no una
-- heurística ("producto_id null y variante_id null") a propósito: hoy hay 15
-- renglones históricos con esa forma que son productos BORRADOS, no ventas
-- libres, y se tienen que seguir mostrando como "Producto eliminado". Un
-- renglón que dice lo que es no depende de que nadie adivine.
--
-- Lo que NO se hace, y por qué: no se crea un producto oculto "Venta libre"
-- por negocio. Parecía más barato (todo el historial ya sabe nombrar un
-- producto), pero `productos` la leen 54 consultas —el banner de fotos
-- pendientes, el conteo del plan, la búsqueda global, el matching de
-- remitos— y cada una tendría que aprender a esconderlo. Un renglón sin
-- producto ya es un estado que TODO el sistema sabe manejar (producto
-- eliminado): acá solo se le pone nombre.
--
-- Lo que un renglón libre NO hace: no mueve stock (no hay variante), no
-- entra en promociones por categoría (no tiene categoría), no lleva costo (no
-- hay costo cargado, así que el margen de ese renglón es el precio entero — y
-- `margen_realizado` lo cuenta como costo cero, o sea "sin cargar", que es la
-- verdad) y su precio lo pone la vendedora. Ese último punto es la ÚNICA
-- excepción nueva a la regla de que el precio lo revalida el server: no hay
-- contra qué revalidarlo. create-sale.ts lo valida como número (> 0, finito,
-- redondeado al centavo) y lo registra; el desfasaje no aplica.

alter table public.ventas_items
  add column if not exists es_venta_libre boolean not null default false;

comment on column public.ventas_items.es_venta_libre is
  'true = renglón cobrado sin producto del catálogo (venta libre): producto_id y variante_id van null y la descripción tipeada vive en `variante`. NO confundir con producto_id null por producto borrado, que es es_venta_libre = false.';

-- Un renglón libre no apunta a nada del catálogo. Sin este CHECK, un request
-- armado a mano podría mandar `es_venta_libre: true` con un producto_id real y
-- cobrar un producto al precio que quiera, esquivando la revalidación.
alter table public.ventas_items
  drop constraint if exists ventas_items_venta_libre_sin_catalogo;
alter table public.ventas_items
  add constraint ventas_items_venta_libre_sin_catalogo
  check (not es_venta_libre or (producto_id is null and variante_id is null));

-- Cuerpo tomado del VIVO (pg_get_functiondef) el 17/9/2026, no del último
-- archivo que lo tocó. Lo único que cambia es `es_venta_libre` en el INSERT
-- de renglones; el resto es idéntico.
create or replace function public.registrar_venta(
  p_venta jsonb,
  p_pagos jsonb default '[]'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_stock_legacy jsonb default '[]'::jsonb,
  p_descuento jsonb default null::jsonb,
  p_cc jsonb default null::jsonb,
  p_reserva_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_negocio uuid := security.current_negocio_id();
  v_venta_id uuid;
  v_fecha_venta timestamptz;
  v_vencimiento date;
  v_turno uuid := nullif(p_venta->>'turno_caja_id', '')::uuid;
  v_vendedor uuid := (p_venta->>'vendedor_id')::uuid;
  v_cliente uuid;
  v_pendiente numeric;
  v_promocion uuid;
  v_recargo_cc numeric;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  insert into public.ventas (
    id, negocio_id, vendedor_id, cliente_id, turno_caja_id, estado_operacion,
    metodo_pago, total, precio_costo, cantidad, total_bruto,
    recargo_metodo_total, comision_total, total_neto, es_pago_mixto,
    monto_cobrado, monto_pendiente, estado_pago,
    recargo_cc_porcentaje, recargo_cc_monto,
    fecha_venta, registrada_offline, desfasaje_precio,
    lista_precio_id, lista_precio_nombre
  )
  values (
    (p_venta->>'id')::uuid,
    v_negocio,
    v_vendedor,
    nullif(p_venta->>'cliente_id', '')::uuid,
    v_turno,
    p_venta->>'estado_operacion',
    p_venta->>'metodo_pago',
    (p_venta->>'total')::numeric,
    (p_venta->>'precio_costo')::numeric,
    (p_venta->>'cantidad')::numeric,
    (p_venta->>'total_bruto')::numeric,
    (p_venta->>'recargo_metodo_total')::numeric,
    (p_venta->>'comision_total')::numeric,
    (p_venta->>'total_neto')::numeric,
    (p_venta->>'es_pago_mixto')::boolean,
    (p_venta->>'monto_cobrado')::numeric,
    (p_venta->>'monto_pendiente')::numeric,
    p_venta->>'estado_pago',
    (p_venta->>'recargo_cc_porcentaje')::numeric,
    (p_venta->>'recargo_cc_monto')::numeric,
    coalesce((p_venta->>'fecha_venta')::timestamptz, now()),
    coalesce((p_venta->>'registrada_offline')::boolean, false),
    (p_venta->>'desfasaje_precio')::numeric,
    nullif(p_venta->>'lista_precio_id', '')::uuid,
    nullif(p_venta->>'lista_precio_nombre', '')
  )
  on conflict (id) do nothing
  returning id, fecha_venta into v_venta_id, v_fecha_venta;

  if v_venta_id is null then
    return jsonb_build_object(
      'ya_registrada', true,
      'venta_id', (p_venta->>'id')::uuid
    );
  end if;

  insert into public.venta_pagos (
    negocio_id, venta_id, metodo_pago_id, metodo_nombre, metodo_tipo,
    monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
    comision_porcentaje, comision_monto, monto_neto, acreditacion_dias,
    turno_caja_id
  )
  select
    v_negocio, v_venta_id, p.metodo_pago_id, p.metodo_nombre, p.metodo_tipo,
    p.monto_base, p.recargo_porcentaje, p.recargo_monto, p.monto_bruto,
    p.comision_porcentaje, p.comision_monto, p.monto_neto,
    p.acreditacion_dias, v_turno
  from jsonb_to_recordset(p_pagos) as p(
    metodo_pago_id uuid, metodo_nombre text, metodo_tipo text,
    monto_base numeric, recargo_porcentaje numeric, recargo_monto numeric,
    monto_bruto numeric, comision_porcentaje numeric, comision_monto numeric,
    monto_neto numeric, acreditacion_dias int
  );

  -- `es_venta_libre` ausente en el JSON = false: los renglones de siempre no
  -- lo mandan y siguen entrando igual.
  insert into public.ventas_items (
    negocio_id, venta_id, producto_id, variante, variante_id, unidad_serie_id, cantidad,
    precio_unitario, precio_costo, descuento_monto, precio_final,
    promocion_id, promocion_nombre, es_venta_libre
  )
  select
    v_negocio, v_venta_id, i.producto_id, i.variante, i.variante_id, i.unidad_serie_id,
    i.cantidad, i.precio_unitario, i.precio_costo, i.descuento_monto,
    i.precio_final, i.promocion_id, i.promocion_nombre,
    coalesce(i.es_venta_libre, false)
  from jsonb_to_recordset(p_items) as i(
    producto_id uuid, variante text, variante_id uuid, unidad_serie_id uuid, cantidad numeric,
    precio_unitario numeric, precio_costo numeric, descuento_monto numeric,
    precio_final numeric, promocion_id uuid, promocion_nombre text,
    es_venta_libre boolean
  );

  if not exists (select 1 from public.ventas_items where venta_id = v_venta_id) then
    raise exception 'VENTA_SIN_RENGLONES';
  end if;

  if p_descuento is not null then
    v_promocion := (p_descuento->>'promocion_id')::uuid;

    insert into public.ventas_descuentos (
      negocio_id, venta_id, promocion_id, promocion_nombre, tipo_descuento,
      monto_descontado
    )
    values (
      v_negocio, v_venta_id, v_promocion,
      p_descuento->>'promocion_nombre',
      p_descuento->>'tipo_descuento',
      (p_descuento->>'monto_descontado')::numeric
    );

    update public.promociones
       set usos_actuales = coalesce(usos_actuales, 0) + 1
     where id = v_promocion;
  end if;

  if p_cc is not null then
    v_cliente := nullif(p_cc->>'cliente_id', '')::uuid;
    v_pendiente := coalesce((p_cc->>'monto_pendiente')::numeric, 0);

    if v_cliente is not null and v_pendiente > 0.05 then
      v_vencimiento := (v_fecha_venta at time zone 'UTC')::date
                       + coalesce((p_cc->>'plazo_mora')::int, 30);

      v_recargo_cc := least(
        coalesce((p_venta->>'recargo_cc_monto')::numeric, 0),
        v_pendiente
      );

      insert into public.cuenta_corriente_movimientos (
        negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,
        monto_recargo, recargo_porcentaje
      )
      values (
        v_negocio, v_cliente, v_venta_id, 'DEBITO', v_pendiente,
        p_cc->>'descripcion', v_vendedor,
        v_recargo_cc,
        (p_venta->>'recargo_cc_porcentaje')::numeric
      );

      update public.clientes
         set saldo_pendiente = coalesce(saldo_pendiente, 0) + v_pendiente,
             fecha_vencimiento_deuda = coalesce(
               public.recalcular_vencimiento_cc(v_cliente),
               v_vencimiento
             )
       where id = v_cliente;

      if not found then
        raise exception 'CLIENTE_NO_ENCONTRADO';
      end if;

      update public.ventas
         set fecha_vencimiento = v_vencimiento
       where id = v_venta_id;
    end if;
  end if;

  update public.productos_stock ps
     set cantidad = ps.cantidad - s.cantidad
    from jsonb_to_recordset(p_stock_legacy) as s(stock_id uuid, cantidad numeric)
   where ps.id = s.stock_id;

  if array_length(p_reserva_ids, 1) > 0 then
    update public.reservas
       set estado = 'CONFIRMADA',
           venta_id = v_venta_id,
           resuelto_en = now()
     where id = any(p_reserva_ids)
       and estado = 'ACTIVA';
  end if;

  return jsonb_build_object(
    'venta_id', v_venta_id,
    'fecha_venta', v_fecha_venta,
    'fecha_vencimiento', v_vencimiento
  );
end;
$function$;

-- Guard: si alguien vuelve a reescribir la función desde un archivo viejo, que
-- se entere acá y no en el mostrador. Mismo criterio que `20260904140000`.
do $$
begin
  if position('es_venta_libre' in pg_get_functiondef('public.registrar_venta(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[])'::regprocedure)) = 0 then
    raise exception 'registrar_venta quedó sin es_venta_libre';
  end if;
end $$;
