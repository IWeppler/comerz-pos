-- Reversa de 20260904140000.
--
-- NO hay reversa útil: volver atrás es volver a la función que pisa atributos
-- y no escribe unidades_serie, o sea reintroducir a mano el bug que esta
-- migración arregla. Si hay que revertir algo, se revierte hacia adelante con
-- una migración nueva que parta del cuerpo VIVO (pg_get_functiondef), que es
-- justo lo que no se hizo el 19/8 y produjo la regresión.
--
-- Se deja el archivo para no romper la convención de tener un _down por
-- migración, y falla explícito en vez de dejar creer que revirtió.

do $$
begin
  raise exception 'Sin reversa: revertir esto reintroduce la pérdida de unidades_serie y el pisado de atributos. Escribí una migración nueva partiendo del cuerpo vivo de la función.';
end;
$$;
