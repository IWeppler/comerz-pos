// PostgreSQL temporal, sin credenciales ni escrituras en producción.
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(join(resolve(process.argv[2]),'dist/index.js')).href : '@electric-sql/pglite');
const db = new PGlite();
const migraciones = ['20261008134656_hitos_activacion.sql','20261008134700_embudo_activacion_autonoma.sql'];
const a='10000000-0000-0000-0000-000000000001', b='10000000-0000-0000-0000-000000000002', demo='10000000-0000-0000-0000-000000000003', migrado='10000000-0000-0000-0000-000000000004';
const uid='20000000-0000-0000-0000-000000000001';
const q=async(sql)=>(await db.query(sql)).rows;
try {
  await db.exec(`create role anon; create role authenticated; create schema security; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function security.current_negocio_id() returns uuid language sql as $$ select nullif(current_setting('test.negocio',true),'')::uuid $$;
    create function security.is_super_admin() returns boolean language sql as $$ select coalesce(current_setting('test.super',true),'false')='true' $$;
    create function public.is_admin() returns boolean language sql as $$ select coalesce(current_setting('test.admin',true),'false')='true' $$;
    grant usage on schema auth,security,public to authenticated,anon;
    create table public.negocios(id uuid primary key,nombre text,estado text,created_at timestamptz);
    create table public.producto_variantes(id uuid,negocio_id uuid,created_at timestamptz);
    create table public.turnos_caja(negocio_id uuid,fecha_apertura timestamptz);
    create table public.ventas(id uuid,negocio_id uuid,fecha_venta timestamptz,estado_operacion text);
    create function public.estado_activacion() returns jsonb language sql stable as $$
      select case when not public.is_admin() then null::jsonb
      else jsonb_build_object('stock_y_precios',false,'primera_venta',false,'clave_ajena','conservar') end;
    $$;
    create function public.estado_activacion_de(p_negocio uuid) returns jsonb language sql stable security definer as $$
      select case when not security.is_super_admin() then null::jsonb
      else jsonb_build_object('stock_y_precios',false,'primera_venta',false,'clave_ajena','conservar') end;
    $$;
    select set_config('test.uid','${uid}',false),set_config('test.negocio','${a}',false),set_config('test.admin','true',false),set_config('test.super','false',false);
    insert into public.negocios values ('${a}','Nuevo','prueba',now()-interval '2 days'),('${b}','Otro','prueba',now()-interval '2 days'),('${demo}','Demo','demo',now()-interval '2 days'),('${migrado}','Migrado','activo',now()-interval '2 days');`);
  const original=(await q("select pg_get_functiondef('public.estado_activacion()'::regprocedure) as cuerpo"))[0].cuerpo;
  await db.exec('begin'); for(const m of migraciones)await db.exec(readFileSync('supabase/migrations/'+m,'utf8')); await db.exec('rollback');
  assert.equal((await q("select to_regclass('public.hitos_activacion') as tabla"))[0].tabla,null);
  for(const m of migraciones)await db.exec(readFileSync('supabase/migrations/'+m,'utf8'));
  await db.exec(`set role authenticated; select public.registrar_hito_activacion('CAMINO_VENTA_LIBRE'); select public.registrar_hito_activacion('CAMINO_VENTA_LIBRE');`);
  assert.equal((await q('select count(*)::int as n from public.hitos_activacion'))[0].n,1);
  assert.equal((await q('select public.estado_activacion() as estado'))[0].estado.venta_libre_elegida,true);
  assert.equal((await q('select public.estado_activacion() as estado'))[0].estado.clave_ajena,'conservar');
  await assert.rejects(()=>db.exec("select public.registrar_hito_activacion('DESCONOCIDO')"),/HITO_DESCONOCIDO/);
  await assert.rejects(()=>db.exec("insert into public.hitos_activacion(hito) values('POS_ABIERTO')"),/permission denied/);
  await db.exec(`select set_config('test.negocio','${b}',false)`);
  assert.equal((await q('select count(*)::int as n from public.hitos_activacion'))[0].n,0);
  assert.equal((await q('select public.estado_activacion() as estado'))[0].estado.venta_libre_elegida,false);
  await db.exec("select set_config('test.admin','false',false)");
  assert.equal((await q('select public.estado_activacion() as estado'))[0].estado,null);
  await assert.rejects(()=>db.exec('select public.embudo_activacion_autonoma()'),/SIN_PERMISO/);
  await db.exec(`reset role; insert into public.ventas values('${uid}','${a}',now()-interval '47 hours','CONFIRMADA'),('${uid}','${migrado}',now()-interval '3 days','CONFIRMADA'),('${uid}','${b}',now()-interval '47 hours','ANULADA');
    set role authenticated; select set_config('test.super','true',false);`);
  const datos=(await q('select public.embudo_activacion_autonoma() as datos'))[0].datos;
  assert.deepEqual(datos.comercios.map(c=>c.id).sort(),[a,b]);
  assert.equal(datos.cohortes[0].comercios,2); assert.equal(datos.cohortes[0].vendidos_24h,1); assert.equal(datos.cohortes[0].porcentaje_24h,50);
  assert.equal((await q('select count(*)::int as n from public.hitos_activacion'))[0].n,1);
  await db.exec('reset role; set role anon');
  await assert.rejects(()=>db.exec('select * from public.hitos_activacion'),/permission denied/);
  await assert.rejects(()=>db.exec("select public.registrar_hito_activacion('POS_ABIERTO')"),/permission denied/);
  await assert.rejects(()=>db.exec('select public.embudo_activacion_autonoma()'),/permission denied/);
  await db.exec('reset role');
  for(const m of [...migraciones].reverse())await db.exec(readFileSync('supabase/reversals/'+m,'utf8'));
  assert.equal((await q("select pg_get_functiondef('public.estado_activacion()'::regprocedure) as cuerpo"))[0].cuerpo,original);
  console.log('OK: prueba en transacción revertida, idempotencia, aislamiento, ADMIN, super admin, anon, cohortes y reversiones.');
} finally { await db.close(); }
