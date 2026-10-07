/** PostgreSQL temporal. No usa credenciales ni conexiones de la app.
 * Uso: node scripts/verificar-ajustes-precios.mjs [ruta al paquete @electric-sql/pglite]
 * Instalar ese paquete en un directorio temporal; no hace falta cambiar package.json.
 * Las tablas salen del baseline; las identidades/roles se simulan exclusivamente acá.
 */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const { PGlite } = await import(process.argv[2]
  ? pathToFileURL(join(resolve(process.argv[2]), 'dist/index.js')).href : '@electric-sql/pglite');
const db = new PGlite();
const baseline = readFileSync('supabase/migrations/20260929120000_baseline.sql', 'utf8');
const migraciones = ['20261007170000_rubro_pintureria.sql', '20261007160000_ajustes_precios_por_marca.sql'];
const negocio = '10000000-0000-0000-0000-000000000001';
const otro = '10000000-0000-0000-0000-000000000002';
const usuario = '20000000-0000-0000-0000-000000000001';
const producto = '30000000-0000-0000-0000-000000000001';
const categoria = '40000000-0000-0000-0000-000000000001';
let solicitud = 0;
const siguienteId = () => `50000000-0000-0000-0000-${String(++solicitud).padStart(12, '0')}`;
const sql = (s) => s === null ? 'NULL' : `'${String(s).replaceAll("'", "''")}'`;
const tablas = ['actualizaciones_precio','actualizaciones_precio_items','productos','producto_variantes','categorias','configuracion_pos'];

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA security;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.usuario', true)::uuid $$;
    CREATE FUNCTION security.current_negocio_id() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.negocio', true)::uuid $$;
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.admin', true) = 'true' $$;
    GRANT USAGE ON SCHEMA public, auth, security TO authenticated;
    SELECT set_config('test.usuario', '${usuario}', false), set_config('test.negocio', '${negocio}', false), set_config('test.admin', 'true', false);`);
  for (const tabla of tablas) {
    const ddl = baseline.match(new RegExp(`CREATE TABLE IF NOT EXISTS "public"\\."${tabla}" \\([\\s\\S]*?\\n\\);`))?.[0];
    assert(ddl, `Falta tabla ${tabla}`);
    await db.exec(ddl);
    await db.exec(`ALTER TABLE public.${tabla} ADD PRIMARY KEY(id);
      ALTER TABLE public.${tabla} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON public.${tabla} AS RESTRICTIVE TO authenticated
        USING (negocio_id = (SELECT security.current_negocio_id()))
        WITH CHECK (negocio_id = (SELECT security.current_negocio_id()));
      CREATE POLICY acceso ON public.${tabla} TO authenticated USING (true) WITH CHECK (true);
      GRANT SELECT, INSERT, UPDATE ON public.${tabla} TO authenticated;`);
  }
  const alta = baseline.match(/CREATE OR REPLACE FUNCTION "public"\."crear_negocio_con_owner"\("p_nombre" "text", "p_slug" "text", "p_whatsapp"[\s\S]*?\n\$\$;/)?.[0];
  assert(alta, 'Falta el alta del baseline');
  await db.exec(alta);
  const altaAnterior = (await db.query("SELECT pg_get_functiondef('public.crear_negocio_con_owner(text,text,text,text,text,text,text,text,text)'::regprocedure) AS cuerpo")).rows[0].cuerpo;
  await db.exec('BEGIN');
  for (const m of migraciones) await db.exec(readFileSync(`supabase/migrations/${m}`, 'utf8'));
  await db.exec('COMMIT');
  console.log('Migraciones y guards: OK');
  const altaNueva = (await db.query("SELECT pg_get_functiondef('public.crear_negocio_con_owner(text,text,text,text,text,text,text,text,text)'::regprocedure) AS cuerpo")).rows[0].cuerpo;
  assert.match(altaNueva, /'pintureria'\) THEN p_rubro/);
  assert.match(altaNueva, /public\.rol_permisos/);

  const casos = JSON.parse(readFileSync('features/stock/lib/ajuste-precios-casos.json', 'utf8'));
  for (const c of casos) {
    const { rows } = await db.query(`SELECT * FROM public.calcular_ajuste_precio(${c.costo ?? 'NULL'}, ${c.precio}, ${sql(c.campo)}, ${sql(c.operacion)}, ${c.valor}, ${sql(c.redondeo)})`);
    assert.equal(rows[0].costo === null ? null : Number(rows[0].costo), c.nuevoCosto);
    assert.equal(Number(rows[0].precio), c.nuevoPrecio);
  }
  for (const [texto, esperado] of [[' ÁLBÁ  Color ', 'alba color'], ['\tNike\n', 'nike'], ['A_% Straße', 'a_% straße'], ['', null], [' \u00a0 ', null]]) {
    assert.equal((await db.query('SELECT public.normalizar_marca_precios($1) AS marca', [texto])).rows[0].marca, esperado);
  }
  console.log(`Espejo SQL: ${casos.length} cálculos y normalización OK`);
  await db.exec(`INSERT INTO public.categorias(id, nombre, slug, negocio_id) VALUES ('${categoria}', 'Pinturas', 'pinturas', '${negocio}');
    INSERT INTO public.productos(id, nombre, marca, precio, precio_costo, categoria_id, negocio_id)
      VALUES ('${producto}', 'Látex', ' ÁLBÁ ', 200, 100, '${categoria}', '${negocio}');
    INSERT INTO public.productos(id, nombre, marca, precio, precio_costo, negocio_id)
      VALUES ('30000000-0000-0000-0000-000000000002', 'De otro negocio', 'Alba', 800, 400, '${otro}');
    INSERT INTO public.producto_variantes(producto_id, nombre_display, precio, costo, negocio_id) VALUES
      ('${producto}', 'Hereda', NULL, NULL, '${negocio}'),
      ('${producto}', 'Precio propio', 250, NULL, '${negocio}'),
      ('${producto}', 'Costo propio', NULL, 90, '${negocio}');
    SET ROLE authenticated;`);
  const aplicar = async (id, opciones = {}) => {
    const { alcance = 'MARCA', marca = 'alba', campo = 'PRECIO', valor = 10, ids = [producto] } = opciones;
    const prevision = opciones.prevision ?? (await db.query('SELECT id AS producto_id, precio AS precio_anterior, precio_costo AS costo_anterior FROM public.productos WHERE id = ANY($1::uuid[])', [ids])).rows;
    return db.query(`SELECT public.aplicar_ajuste_precios($1::uuid, '', $2, $3, $4, 'AUMENTAR_PORCENTAJE', $5::numeric, 'SIN_REDONDEO', $6::uuid[], $7::jsonb)`, [id, alcance, marca, campo, valor, ids, JSON.stringify(prevision)]);
  };
  const estado = async () => (await db.query(`SELECT nombre_display, precio, costo FROM public.producto_variantes ORDER BY nombre_display`)).rows.map((v) => ({
    ...v, precio: v.precio === null ? null : Number(v.precio), costo: v.costo === null ? null : Number(v.costo),
  }));
  const id = siguienteId();
  await aplicar(id);
  await assert.rejects(aplicar(siguienteId(), { prevision: [{ producto_id: producto, precio_anterior: 200, costo_anterior: 100 }] }), /precios cambiaron/);
  assert.deepEqual(await estado(), [
    { nombre_display: 'Costo propio', precio: null, costo: 90 },
    { nombre_display: 'Hereda', precio: null, costo: null },
    { nombre_display: 'Precio propio', precio: 220, costo: null },
  ]);
  await aplicar(id);
  assert.equal(Number((await db.query('SELECT precio FROM public.productos WHERE id = $1', [producto])).rows[0].precio), 220);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.actualizaciones_precio')).rows[0].n, 1);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.actualizaciones_precio_items')).rows[0].n, 2);
  await db.query('SELECT public.revertir_ajuste_precios($1::uuid)', [id]);
  await db.query('SELECT public.revertir_ajuste_precios($1::uuid)', [id]);
  assert.equal(Number((await estado()).find((v) => v.nombre_display === 'Precio propio').precio), 250);
  assert.equal(Number((await db.query('SELECT precio FROM public.productos WHERE id = $1', [producto])).rows[0].precio), 200);
  await assert.rejects(aplicar(siguienteId(), { alcance: 'SELECCION', ids: ['30000000-0000-0000-0000-000000000002'] }), /alcance cambió/);
  await db.exec("SELECT set_config('test.admin', 'false', false)");
  await assert.rejects(aplicar(siguienteId()), /administrador/);
  await assert.rejects(db.query('SELECT public.revertir_ajuste_precios($1::uuid)', [id]), /administrador/);
  await db.exec("SELECT set_config('test.admin', 'true', false)");
  await assert.rejects(aplicar(siguienteId(), { valor: -1 }), /inválida/);
  await assert.rejects(aplicar(siguienteId(), { valor: 0.123 }), /inválida/);
  console.log('Admin, tenant, herencia, auditoría, aplicar/deshacer y reintento: OK');

  // Provoca un error DESPUÉS del INSERT de lote/ítems y del UPDATE del producto.
  await db.exec(`RESET ROLE;
    CREATE FUNCTION public.fallar_variante_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Error forzado en variante'; END $$;
    CREATE TRIGGER fallar_variante BEFORE UPDATE ON public.producto_variantes FOR EACH ROW EXECUTE FUNCTION public.fallar_variante_test();
    SET ROLE authenticated;`);
  const antes = await estado();
  const antesLotes = (await db.query('SELECT count(*) AS n FROM public.actualizaciones_precio')).rows[0].n;
  await assert.rejects(aplicar(siguienteId()), /Error forzado/);
  assert.deepEqual(await estado(), antes);
  assert.equal(Number((await db.query('SELECT precio FROM public.productos WHERE id = $1', [producto])).rows[0].precio), 200);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.actualizaciones_precio')).rows[0].n, antesLotes);
  await db.exec('RESET ROLE; DROP TRIGGER fallar_variante ON public.producto_variantes; DROP FUNCTION public.fallar_variante_test();');
  console.log('Falla intermedia revierte lote, auditoría y precios: OK');

  await db.exec('SET ROLE authenticated; BEGIN');
  const idSeco = siguienteId();
  await aplicar(idSeco, { alcance: 'CATEGORIA', marca: categoria });
  assert.equal((await db.query('SELECT alcance_valor FROM public.actualizaciones_precio WHERE id = $1', [idSeco])).rows[0].alcance_valor, 'Pinturas');
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*) AS n FROM public.actualizaciones_precio WHERE id = $1', [idSeco])).rows[0].n, 0);
  assert.equal(Number((await db.query('SELECT precio FROM public.productos WHERE id = $1', [producto])).rows[0].precio), 200);
  console.log('Categoría y ejecución en seco dentro de transacción revertida: OK');
  await db.exec('RESET ROLE');

  await db.exec(`CREATE POLICY bloquear_update_test ON public.productos AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (id <> '${producto}') WITH CHECK (id <> '${producto}'); SET ROLE authenticated;`);
  await assert.rejects(aplicar(siguienteId()), /No se pudo actualizar/);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.actualizaciones_precio')).rows[0].n, antesLotes);
  await db.exec('RESET ROLE; DROP POLICY bloquear_update_test ON public.productos');
  console.log('UPDATE filtrado por RLS aborta el lote: OK');

  // El alcance completo supera los 1.000 productos de PostgREST.
  await db.exec(`INSERT INTO public.productos(nombre, marca, precio, precio_costo, negocio_id)
    SELECT 'Producto ' || n, 'Nike', 100, 50, '${negocio}' FROM generate_series(1, 1542) n;
    SET ROLE authenticated;`);
  const todosIds = (await db.query("SELECT id FROM public.productos WHERE marca = 'Nike'")).rows.map((p) => p.id);
  const loteGrande = siguienteId();
  await aplicar(loteGrande, { marca: ' NIKE ', ids: todosIds, campo: 'AMBOS' });
  assert.equal((await db.query('SELECT cantidad_afectada FROM public.actualizaciones_precio WHERE id = $1', [loteGrande])).rows[0].cantidad_afectada, 1542);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.actualizaciones_precio_items WHERE lote_id = $1', [loteGrande])).rows[0].n, 1542);
  assert.equal((await db.query("SELECT count(*) AS n FROM public.productos WHERE marca = 'Nike' AND precio = 110 AND precio_costo = 55")).rows[0].n, 1542);
  await db.query('SELECT public.revertir_ajuste_precios($1::uuid)', [loteGrande]);
  assert.equal((await db.query("SELECT count(*) AS n FROM public.productos WHERE marca = 'Nike' AND precio = 100")).rows[0].n, 1542);
  console.log('1.542 productos: aplicar y revertir sin truncamiento OK');
  await db.exec('RESET ROLE');
  assert.equal(Number((await db.query("SELECT precio FROM public.productos WHERE negocio_id = $1", [otro])).rows[0].precio), 800);
  await db.exec(readFileSync('supabase/reversals/20261007160000_ajustes_precios_por_marca.sql', 'utf8'));
  await db.exec(readFileSync('supabase/reversals/20261007170000_rubro_pintureria.sql', 'utf8'));
  assert.equal((await db.query("SELECT pg_get_functiondef('public.crear_negocio_con_owner(text,text,text,text,text,text,text,text,text)'::regprocedure) AS cuerpo")).rows[0].cuerpo, altaAnterior);
  console.log('Reversiones de schema: OK');
} catch (error) {
  console.error(error.message);
  if (error.detail) console.error(error.detail);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
