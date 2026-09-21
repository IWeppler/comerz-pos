-- Reversa de 20260908170000_ancho_ticket_y_eventos_uso.
--
-- Sacar `ancho_ticket_mm` devuelve la impresión a 80mm fijos, que es como
-- estaba: ningún ticket cambia de contenido, solo de ancho de papel.
--
-- Dropear `eventos_uso` pierde la telemetría acumulada, y eso NO se puede
-- reconstruir: no hay otra fuente que diga si alguien apretó el botón del PDF.
-- Si la idea es dejar de medir, conviene dejar de escribir y conservar la
-- tabla; esto es para revertir la migración entera.
--
-- Nada de esto toca una venta ni un comprobante.

drop table if exists public.eventos_uso;

alter table public.configuracion_pos
  drop constraint if exists configuracion_pos_ancho_ticket_valido;
alter table public.configuracion_pos
  drop column if exists ancho_ticket_mm;
