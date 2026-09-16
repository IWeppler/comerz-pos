-- Pedidos a caja por Supabase Realtime Broadcast, en lugar de polling.
--
-- Hasta acá `pedidos-por-cobrar.tsx` preguntaba por server action cada 15 s
-- —1.836 invocaciones de Vercel por día en Librería Colores, con una sola
-- caja, hubiera o no pedidos—. Ahora la base AVISA: un trigger sobre `pedidos`
-- publica en el topic `pedidos:<negocio_id>` y el navegador, al recibirlo,
-- invalida la query y vuelve a pedir los datos por el camino de siempre. El
-- payload del mensaje NO se usa como fuente de datos: es una señal.
--
-- POR QUÉ BROADCAST Y NO `postgres_changes`. Con `postgres_changes` Realtime
-- evalúa la RLS de `pedidos` fila por fila con el JWT del suscriptor, y ahí no
-- hay request de PostgREST: `security.current_negocio_id()` no encuentra el
-- header `x-negocio-activo` y cae a su último fallback —"si el usuario tiene
-- exactamente UNA membresía, esa; si no, NULL"—. Para cualquiera con dos
-- negocios (el super admin, una dueña con dos locales) la policy filtra todo
-- y NO avisa: la caja simplemente no recibe nada. Con Broadcast la
-- autorización es UNA sola, al unirse al canal, sobre `realtime.messages`, y
-- la escribimos acá sin pasar por `current_negocio_id()`: pertenencia directa
-- en `usuarios_negocios`, o super admin.
--
-- `pedidos` NO se agrega a la publicación `supabase_realtime`: Broadcast no
-- la necesita y sin ella no hay forma de escuchar `postgres_changes` por
-- error.

-- 1. El trigger. SECURITY DEFINER porque `realtime.broadcast_changes` escribe
--    en `realtime.messages`, y quien dispara el trigger es el usuario del
--    mostrador (crear_pedido / cobrar_pedido / cancelar son SECURITY INVOKER a
--    propósito). search_path vacío: es DEFINER.
create or replace function public.pedidos_broadcast_cambio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_negocio uuid := coalesce(new.negocio_id, old.negocio_id);
begin
  if v_negocio is null then
    return null;
  end if;

  -- FAIL-OPEN A PROPÓSITO. Esto es una señal: si Realtime no puede escribir
  -- el mensaje, el pedido se guarda igual y la caja lo ve por el fallback de
  -- polling. Lo contrario —que un problema del canal rebote `cobrar_pedido`,
  -- que corre DESPUÉS de una venta ya cobrada— sería dejar la venta hecha y el
  -- pedido colgado como POR_COBRAR para siempre.
  begin
    perform realtime.broadcast_changes(
      'pedidos:' || v_negocio::text, -- topic
      tg_op,                         -- event: INSERT | UPDATE | DELETE
      tg_op,                         -- operation
      tg_table_name,
      tg_table_schema,
      new,
      old
    );
  exception when others then
    raise warning '[PEDIDOS BROADCAST] no se pudo publicar %: %', tg_op, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.pedidos_broadcast_cambio() from public, anon, authenticated;

drop trigger if exists trg_pedidos_broadcast on public.pedidos;
create trigger trg_pedidos_broadcast
  after insert or update or delete on public.pedidos
  for each row execute function public.pedidos_broadcast_cambio();

-- 2. Autorización del canal. Realtime la evalúa al unirse a un canal
--    PRIVADO: hace un SELECT sobre `realtime.messages` con el JWT del
--    suscriptor y `realtime.topic()` puesto al topic pedido. Sin policy, la
--    tabla tiene RLS y nadie se une a ningún canal privado (hoy no hay ninguna
--    policy: verificado el 16/9/2026).
--
--    La regla: solo topics `pedidos:<negocio>` donde el usuario tiene una
--    fila en `usuarios_negocios` para ESE negocio, o es super admin (modo
--    dios). No mira estado del negocio ni rol: la caja que puede cobrar ya la
--    decide `tiene_permiso('ventas.cobrar')` sobre los datos; esto solo
--    autoriza la SEÑAL, y una señal sin datos que leer no sirve para nada.
--
--    Nada de INSERT: los mensajes los escribe el trigger (DEFINER), no el
--    navegador. Un cliente no puede inventar un evento de pedido.
drop policy if exists "pedidos_broadcast_miembros" on realtime.messages;
create policy "pedidos_broadcast_miembros"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'pedidos:%'
    and (
      exists (
        select 1
        from public.usuarios_negocios un
        where un.usuario_id = (select auth.uid())
          and 'pedidos:' || un.negocio_id::text = realtime.topic()
      )
      or (select security.is_super_admin())
    )
  );

-- 3. Guards. Fallan si el trigger no quedó o si la policy no ata el topic a
--    la membresía: mismo criterio que los guards de 20260816100000.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pedidos'::regclass and tgname = 'trg_pedidos_broadcast'
  ) then
    raise exception 'GUARD: falta trg_pedidos_broadcast sobre public.pedidos';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and policyname = 'pedidos_broadcast_miembros'
      and qual like '%usuarios_negocios%'
      and qual like '%realtime.topic()%'
  ) then
    raise exception 'GUARD: la policy de realtime.messages no ata el topic a usuarios_negocios';
  end if;

  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'pedidos'
  ) then
    raise exception 'GUARD: pedidos no debe estar en supabase_realtime (Broadcast no lo necesita)';
  end if;
end $$;
