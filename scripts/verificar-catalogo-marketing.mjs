/** PostgreSQL temporal sin credenciales. Uso: node scripts/verificar-catalogo-marketing.mjs [ruta @electric-sql/pglite] */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(join(resolve(process.argv[2]), 'dist/index.js')).href : '@electric-sql/pglite');
const db = new PGlite();
const baseline = readFileSync('supabase/migrations/20260929120000_baseline.sql', 'utf8');
const cargar = (nombre, carpeta = 'migrations') => db.exec(readFileSync(`supabase/${carpeta}/${nombre}.sql`, 'utf8'));
const n = '10000000-0000-0000-0000-000000000001';
const otro = '10000000-0000-0000-0000-000000000002';
try {
  await db.exec(`create role anon; create role authenticated; create schema security;
    create function security.current_negocio_id() returns uuid language sql as $$ select '${n}'::uuid $$;
    create function security.is_super_admin() returns boolean language sql as $$ select current_setting('test.admin', true) = 'true' $$;
    create function public.cantidad_base(numeric,numeric) returns numeric language sql as $$ select $1*$2 $$;
    grant usage on schema security, public to anon, authenticated;`);
  for (const tabla of ['negocios','configuracion_pos','promociones','promociones_categorias','promociones_metodos_pago','promociones_productos','eventos_uso','productos','producto_variantes','ventas','ventas_items']) {
    const ddl = baseline.match(new RegExp(`CREATE TABLE IF NOT EXISTS "public"\\."${tabla}" \\([\\s\\S]*?\\n\\);`))?.[0];
    assert(ddl, tabla);
    await db.exec(ddl);
    await db.exec(`alter table public.${tabla} add primary key(id); alter table public.${tabla} enable row level security;`);
  }
  const publico = baseline.match(/CREATE OR REPLACE FUNCTION "security"\."negocio_publico"\(\)[\s\S]*?\n\$\$;/)?.[0];
  assert(publico); await db.exec(publico);
  for (const tabla of ['promociones','promociones_categorias','promociones_metodos_pago','promociones_productos']) {
    const nombre = { promociones: 'promociones_select_anon', promociones_categorias: 'promociones_categorias_select_anon', promociones_metodos_pago: 'promociones_metodos_pago_select_anon', promociones_productos: 'promociones_productos_select_anon' }[tabla];
    await db.exec(`create policy ${nombre} on public.${tabla} for select to anon using (${tabla === 'promociones' ? 'activa = true' : 'true'});
      create policy aislamiento_negocio_publico on public.${tabla} as restrictive to anon using (negocio_id = security.negocio_publico());
      grant select on public.${tabla} to anon;`);
  }
  // Reproducir GRANT por columna: nunca tabla entera en promociones.
  await db.exec(`revoke select on public.promociones from anon; grant select (id, negocio_id, nombre, descripcion, activa, acumulable, tipo_descuento, valor_descuento, tipo_regla, monto_minimo, mostrar_en_catalogo, prioridad, fecha_inicio, fecha_fin) on public.promociones to anon;
    insert into public.negocios(id,nombre,slug) values ('${n}','Uno','tienda-uno'), ('${otro}','Dos','tienda-dos');
    insert into public.configuracion_pos(negocio_id,whatsapp) values ('${n}','');
    select set_config('request.headers', '{"x-negocio-slug":"tienda-uno"}', false), set_config('test.admin', 'true', false);`);
  await cargar('20261007150000_pedidos_catalogo_medicion');
  const registroAntes = (await db.query(`select pg_get_functiondef('public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean)'::regprocedure) d`)).rows[0].d;
  const metricasAntes = (await db.query(`select pg_get_functiondef('public.metricas_pedidos_catalogo()'::regprocedure) d`)).rows[0].d;
  for (const m of ['20261007180000_catalogo_envio_gratis','20261007190000_catalogo_marketing_medicion','20261007200000_catalogo_cupones','20261007210000_catalogo_sugerencias']) await cargar(m);
  const pids = [1,2,3,4].map(i => `30000000-0000-0000-0000-00000000000${i}`);
  for (let i = 0; i < pids.length; i++) {
    await db.exec(`insert into public.productos(id,negocio_id,nombre,precio,slug,publicado) values ('${pids[i]}','${i === 3 ? otro : n}','Producto ${i}',1000,'producto-${i}',true);
      insert into public.producto_variantes(producto_id,negocio_id,nombre_display,stock) values ('${pids[i]}','${i === 3 ? otro : n}','Único',${i === 2 ? 0 : 5});`);
  }
  await db.exec(`insert into public.ventas(id,negocio_id) values ('40000000-0000-0000-0000-000000000001','${n}');
    insert into public.ventas_items(venta_id,negocio_id,producto_id,variante,cantidad,precio_unitario) values
    ('40000000-0000-0000-0000-000000000001','${n}','${pids[0]}','Único',1,1000), ('40000000-0000-0000-0000-000000000001','${n}','${pids[1]}','Único',1,1000);`);
  await db.exec(`insert into public.promociones (negocio_id,nombre,codigo,tipo_descuento,valor_descuento,mostrar_en_catalogo) values
    ('${n}','Automática',null,'PORCENTAJE',5,true), ('${n}','Cupón',' verano 10 ','PORCENTAJE',10,true), ('${otro}','Ajeno','SECRETO10','PORCENTAJE',90,true);`);
  await db.exec(`insert into public.promociones (negocio_id,nombre,codigo,tipo_descuento,valor_descuento,mostrar_en_catalogo,fecha_fin,fecha_inicio,limite_usos,usos_actuales,activa) values
    ('${n}','Vencido','VENCIDO10','PORCENTAJE',10,true,now()-interval '1 day',null,null,0,true),
    ('${n}','Futuro','FUTURO10','PORCENTAJE',10,true,null,now()+interval '1 day',null,0,true),
    ('${n}','Agotado','AGOTADO10','PORCENTAJE',10,true,null,null,1,1,true),
    ('${n}','Apagado','APAGADO10','PORCENTAJE',10,true,null,null,null,0,false);`);
  assert.equal((await db.query(`select codigo from public.promociones where nombre = 'Cupón'`)).rows[0].codigo, 'VERANO10');
  await db.exec('set role anon');
  assert.deepEqual((await db.query(`select * from public.sugerencias_carrito(array['${pids[0]}']::uuid[],6)`)).rows, [{ producto_id: pids[1] }]);
  assert.equal((await db.query(`select * from public.sugerencias_carrito('{}'::uuid[],4)`)).rows.length, 2);
  assert.deepEqual((await db.query(`select * from public.sugerencias_carrito('{}'::uuid[],0)`)).rows, []);
  assert.deepEqual((await db.query('select nombre from public.promociones')).rows.map(r => r.nombre), ['Automática']);
  await assert.rejects(db.query('select codigo from public.promociones'));
  assert.equal((await db.query(`select public.validar_cupon_catalogo('verano10') p`)).rows[0].p.nombre, 'Cupón');
  assert.equal((await db.query(`select public.validar_cupon_catalogo('SECRETO10') p`)).rows[0].p, null);
  for (const codigo of ['VENCIDO10','FUTURO10','AGOTADO10','APAGADO10']) assert.equal((await db.query(`select public.validar_cupon_catalogo('${codigo}') p`)).rows[0].p, null);
  await db.exec(`select public.registrar_pedido_catalogo(1000, 2, 3, 'ENVIO', 'Efectivo', false, 'VERANO10', true, 1);
    select public.registrar_pedido_catalogo(500, 1, 1, 'RETIRO', 'Efectivo');`);
  await assert.rejects(db.query('select * from public.eventos_uso'));
  await assert.rejects(db.query('select public.metricas_pedidos_catalogo()'));
  for (let i = 0; i < 30; i++) await db.query(`select public.validar_cupon_catalogo('NOEXISTE')`);
  assert.equal((await db.query(`select public.validar_cupon_catalogo('VERANO10') p`)).rows[0].p, null);
  await db.exec('reset role');
  const metricas = (await db.query('select public.metricas_pedidos_catalogo() p')).rows[0].p;
  assert.equal(metricas.negocios.find(r => r.id === n).marketing.cupon.con_beneficio, 1);
  await db.exec(`update security.intentos_cupon_catalogo set ultimo = now() - interval '6 minutes', bloqueado_hasta = now() - interval '1 minute' where negocio_id = '${n}';`);
  assert.equal((await db.query(`select public.validar_cupon_catalogo('VERANO10') p`)).rows[0].p.nombre, 'Cupón');
  for (const m of ['20261007210000_catalogo_sugerencias','20261007200000_catalogo_cupones','20261007190000_catalogo_marketing_medicion','20261007180000_catalogo_envio_gratis']) await cargar(m, 'reversals');
  assert.equal((await db.query(`select pg_get_functiondef('public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean)'::regprocedure) d`)).rows[0].d, registroAntes);
  assert.equal((await db.query(`select pg_get_functiondef('public.metricas_pedidos_catalogo()'::regprocedure) d`)).rows[0].d, metricasAntes);
  assert.equal((await db.query(`select activa from public.promociones where nombre = 'Cupón'`)).rows[0].activa, false);
  console.log('OK: migraciones/reversiones, anon, aislamiento, cupón, límite concurrente serializado y medición compatible con clientes viejos.');
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await db.close(); }
