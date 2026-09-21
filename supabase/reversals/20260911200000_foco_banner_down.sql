-- Vuelve al recorte desde el centro. Se pierde el encuadre elegido por cada
-- comercio; la imagen no se toca.
alter table public.configuracion_pos
  drop constraint if exists configuracion_pos_focal_rango;

alter table public.configuracion_pos
  drop column if exists banner_focal_x,
  drop column if exists banner_focal_y,
  drop column if exists banner_focal_desktop_x,
  drop column if exists banner_focal_desktop_y;
