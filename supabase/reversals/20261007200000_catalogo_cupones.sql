-- Retirar primero el código de cupones del frontend y del administrador.
begin;
-- Al retirar la columna, un cupón NO puede convertirse en descuento automático.
update public.promociones set activa = false where codigo is not null;
drop function public.validar_cupon_catalogo(text);
drop table security.intentos_cupon_catalogo;
drop trigger normalizar_codigo_promocion on public.promociones;
drop function security.normalizar_codigo_promocion();
alter policy promociones_select_anon on public.promociones using (activa = true);
drop policy cupones_no_enumerables on public.promociones;
alter policy promociones_categorias_select_anon on public.promociones_categorias using (true);
alter policy promociones_metodos_pago_select_anon on public.promociones_metodos_pago using (true);
alter policy promociones_productos_select_anon on public.promociones_productos using (true);
alter table public.promociones drop column codigo;
commit;
