-- Aceptación de invitaciones POR EMAIL, sin depender del link.
--
-- El link del mail de invitación aterriza en /auth/actualizar-password con la
-- sesión en el HASH de la URL (implicit flow: `#access_token=…&type=invite`,
-- verificado el 14/9/2026 siguiendo un invite real). Esa página no monta ningún
-- cliente de Supabase de navegador, así que la sesión nunca llega a las
-- cookies, `updateUser` falla y la persona termina registrándose sola en
-- /onboarding — "completá los datos del negocio". Pasó en Librería Colores y
-- ya había pasado en agosto (khzev04: contraseña puesta, membresía nunca
-- creada).
--
-- El token nunca fue la credencial: `aceptar_invitacion(p_token)` ya exige que
-- el email de la invitación sea el de la sesión. Lo que identifica al invitado
-- es su mail verificado por Auth, y eso está disponible en CUALQUIER punto
-- donde la app se pregunta "¿esta cuenta no tiene negocio?": al guardar la
-- contraseña, en el login y en el paso 2 del onboarding. Esta función acepta
-- todas las invitaciones PENDIENTES vigentes del email de la sesión y devuelve
-- el negocio de la primera, o null si no había ninguna.
--
-- SECURITY DEFINER porque escribe `usuarios_negocios` y `invitaciones` de un
-- negocio del que el usuario todavía NO es miembro (la RLS lo dejaría afuera).
-- Lo acota `auth.uid()`: no recibe usuario ni email por parámetro, así que
-- nadie acepta a nombre de otro. Misma forma que `aceptar_invitacion`.
create or replace function public.aceptar_invitaciones_pendientes()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user    uuid := auth.uid();
  v_email   text;
  v_inv     public.invitaciones;
  v_rol     text;
  v_negocio uuid;
begin
  if v_user is null then
    return null;
  end if;

  select email into v_email from auth.users where id = v_user;
  if v_email is null then
    return null;
  end if;

  -- El perfil puede no existir todavía (cuenta creada por el invite, sin
  -- pasar por el alta). Mismo guard que aceptar_invitacion.
  insert into public.perfiles (id, email, nombre)
  values (v_user, v_email, split_part(v_email, '@', 1))
  on conflict (id) do nothing;

  for v_inv in
    update public.invitaciones
    set estado = 'ACEPTADA'
    where lower(email) = lower(v_email)
      and estado = 'PENDIENTE'
      and expira_en > now()
    returning *
  loop
    select case when r.nombre = 'ENCARGADO' then 'VENDEDOR' else r.nombre end
    into v_rol
    from public.roles r
    where r.id = v_inv.rol_id;

    insert into public.usuarios_negocios (usuario_id, negocio_id, rol_id, rol)
    values (v_user, v_inv.negocio_id, v_inv.rol_id, v_rol)
    on conflict (usuario_id, negocio_id) do nothing;

    v_negocio := coalesce(v_negocio, v_inv.negocio_id);
  end loop;

  return v_negocio;
end;
$$;

-- Los default privileges del proyecto le dan EXECUTE a anon sobre toda función
-- nueva de public; sin sesión devuelve null igual, pero no hay motivo para que
-- anon la vea.
revoke all on function public.aceptar_invitaciones_pendientes() from public, anon;
grant execute on function public.aceptar_invitaciones_pendientes() to authenticated;

comment on function public.aceptar_invitaciones_pendientes() is
  'Acepta todas las invitaciones PENDIENTES vigentes del email de la sesión y devuelve el negocio de la primera (null si no había). El email verificado es la credencial, no el token del link.';
