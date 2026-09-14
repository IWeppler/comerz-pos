-- Saca la feature de los planes y la función de configuración. El permiso
-- ventas.cobrar del rol VENDEDOR queda como esté (si estaba prendido, lo
-- devuelve el admin desde Empleados y Permisos).
drop function if exists public.configurar_pedidos_a_caja(boolean);
update public.planes
   set reglas = jsonb_set(reglas, '{features}', (reglas -> 'features') - 'pedidos_a_caja')
 where reglas -> 'features' ? 'pedidos_a_caja';
