-- Rollback de 20260903100000_super_admin_por_user_id.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- Devuelve `security.is_super_admin()` a su forma anterior, con el criterio
-- adentro y como `SECURITY DEFINER`, y borra `security.es_super_admin(uuid)`.
--
-- EL ORDEN IMPORTA: primero se restaura la externa (que deja de depender de la
-- interna) y recién después se dropea la interna. Al revés, entre los dos
-- statements `is_super_admin()` llamaría a una función que ya no existe, y
-- como la llaman 12 policies, CUALQUIER consulta sobre esas tablas fallaría en
-- esa ventana.
--
-- Si el custom access token hook ya está registrado, este rollback lo rompe:
-- el hook llama a `es_super_admin(user_id)`. Hay que desregistrarlo ANTES.

begin;

create or replace function security.is_super_admin()
returns boolean
language sql
stable
parallel safe
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from auth.users
     where id = auth.uid()
       and email = 'ignacionweppler@gmail.com'
  );
$$;

drop function if exists security.es_super_admin(uuid);

commit;
