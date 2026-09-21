-- Vuelve al banner único. Se pierden las imágenes de desktop cargadas: el
-- archivo sigue en Storage, pero la referencia no.
alter table public.configuracion_pos
  drop column if exists banner_imagen_desktop;
