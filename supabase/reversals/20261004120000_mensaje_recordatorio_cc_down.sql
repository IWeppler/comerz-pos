-- Revierte 20261004120000_mensaje_recordatorio_cc.sql.
-- ANTES: desplegar código que no lea la columna (getClientesPageDataAction la
-- pide en el select y el listado de clientes se cae sin ella). Se pierden las
-- plantillas que hayan escrito los comercios.

alter table public.configuracion_pos
  drop constraint if exists configuracion_pos_mensaje_recordatorio_cc_largo;

alter table public.configuracion_pos
  drop column if exists mensaje_recordatorio_cc;
