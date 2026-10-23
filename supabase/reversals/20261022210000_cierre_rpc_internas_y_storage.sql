-- Reversión de 20261022210000_cierre_rpc_internas_y_storage.sql.
-- OJO: reabre las RPC internas a la API (anon podía sembrar filas en cualquier
-- negocio) y los buckets a cualquier tipo de archivo.

begin;

grant execute on function public.sembrar_categorias_egreso(uuid) to anon, authenticated;
grant execute on function public.sembrar_cuentas_financieras_sistema(uuid) to anon, authenticated;
grant execute on function public.reglas_negocio(uuid) to anon, authenticated;
grant execute on function public.cuenta_financiera_sistema(uuid, text) to anon, authenticated;
grant execute on function public.cuenta_actual_venta_pago(uuid, text, integer, uuid) to anon, authenticated;

update storage.buckets
   set allowed_mime_types = null,
       file_size_limit = null
 where id in ('productos', 'logos');

commit;
