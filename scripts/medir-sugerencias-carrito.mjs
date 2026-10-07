/** Genera SELECT/EXPLAIN del MISMO SQL candidato, sin aplicar migraciones.
 * node scripts/medir-sugerencias-carrito.mjs > .next/medir-sugerencias.sql
 * Ejecutar el archivo en la conexión SQL de lectura y registrar tiempos/buffers.
 */
import { readFileSync } from 'node:fs';
const ddl = readFileSync('supabase/migrations/20261007210000_catalogo_sugerencias.sql', 'utf8');
const cuerpo = ddl.split('as $$\n')[1]?.split('\n$$;')[0];
if (!cuerpo) throw new Error('No se encontró el SQL de sugerencias');
const negocio = `(select id from public.negocios where slug = 'libreria-colores')`;
const frecuentes = `array(select vi.producto_id from public.ventas_items vi join public.ventas v on v.id = vi.venta_id and v.negocio_id = vi.negocio_id where vi.negocio_id = ${negocio} and v.fecha_venta >= now() - interval '30 days' and v.estado_operacion <> 'ANULADA' and vi.producto_id is not null group by vi.producto_id order by count(*) desc limit 3)`;
console.log(`begin transaction read only; set local statement_timeout = '15s';\nselect count(*) ventas_180d from public.ventas where negocio_id = ${negocio} and fecha_venta >= now() - interval '180 days' and estado_operacion <> 'ANULADA';`);
for (const ids of [`'{}'::uuid[]`, frecuentes, frecuentes]) {
  console.log('explain (analyze, buffers, format json)\n' + cuerpo.replaceAll('security.negocio_publico()', negocio).replaceAll('p_producto_ids', ids).replaceAll('p_limite', '6') + '\n');
}
console.log('rollback;');
