-- mensaje_recordatorio_cc: plantilla del recordatorio de deuda por WhatsApp,
-- editable por comercio desde Configuración → Clientes.
--
-- NULL = el mensaje por defecto (features/clients/lib/mensaje-deuda.ts). No se
-- siembra el texto por defecto en las filas: si mañana mejora el default, los
-- comercios que nunca lo tocaron lo reciben solos.
--
-- Las variables ({nombre}, {total}, {desglose}, {link}, ...) se reemplazan en
-- TS con la misma función que arma el default. El total es SIEMPRE lo que va a
-- cobrar el sistema (saldo + recargo por mora).
--
-- SEGURIDAD. Escribe quien ya escribe configuracion_pos (policy
-- configuracion_pos_update_admin). anon NO la lee: tiene GRANT por columna en
-- esta tabla y la columna nueva nace sin él, que es lo correcto (es un texto
-- interno de cobranza, no del catálogo). El catálogo pide columnas explícitas
-- (COLUMNAS_CONFIG_PUBLICA), así que no se cae.

alter table public.configuracion_pos
  add column if not exists mensaje_recordatorio_cc text;

alter table public.configuracion_pos
  drop constraint if exists configuracion_pos_mensaje_recordatorio_cc_largo;

-- Un "" es "sin plantilla" disfrazado: se guarda NULL. Y un tope razonable
-- para un WhatsApp (el link de wa.me con el texto codificado tiene que entrar
-- en una URL).
alter table public.configuracion_pos
  add constraint configuracion_pos_mensaje_recordatorio_cc_largo
  check (
    mensaje_recordatorio_cc is null
    or (length(btrim(mensaje_recordatorio_cc)) between 1 and 1000)
  );

do $$
begin
  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'configuracion_pos'
      and column_name = 'mensaje_recordatorio_cc'
      and grantee = 'anon'
  ) then
    raise exception 'mensaje_recordatorio_cc no debe ser legible por anon';
  end if;

  if exists (
    select 1 from public.configuracion_pos
    where mensaje_recordatorio_cc is not null
  ) then
    raise exception 'mensaje_recordatorio_cc debe nacer en NULL en todas las filas';
  end if;
end $$;
