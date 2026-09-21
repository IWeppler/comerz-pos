# Reversiones

Cómo deshacer cada migración de `supabase/migrations`. Un archivo por
migración, con el mismo nombre más `_down`.

## Por qué NO viven en `supabase/migrations`

Porque ahí no serían reversiones: serían migraciones que deshacen la anterior.

El CLI de Supabase ejecuta **todo** `.sql` de `migrations/` cuyo prefijo
numérico no figure en `supabase_migrations.schema_migrations`. No le importa el
sufijo del nombre. Con los 65 archivos adentro de esa carpeta, **64 califican
como pendientes**, así que un `supabase db push` los corre contra producción:
restaura cuerpos viejos de `registrar_venta`, `aprobar_orden_compra` y
`anular_venta`, y borra columnas de precios, de listas y del embudo de alta.

Eso es exactamente lo que pasó y por qué durante semanas no se pudo pushear:
toda migración hubo que aplicarla a mano. Verificado el 21/9/2026 — de las 65
versiones, la única que figura en `schema_migrations` es `20260918160000`, y esa
fila es la del **up** (`corregir_metodo_pago_cobro_cc`), no la del down.
Ninguna reversión corrió nunca.

**Si alguna vez las movés de vuelta, el push vuelve a romperse.**

## Cómo se usa una

A mano, y leyéndola antes. No hay comando que las corra, y es a propósito: casi
todas tocan plata o el catálogo, y varias no son reversibles sin pérdida —
deshacer un backfill no devuelve el dato que pisó.

```sql
-- revisar qué hace, y recién ahí:
\i supabase/reversals/20260908200000_variantes_heredan_el_precio_down.sql
```

## Cómo se escribe una nueva

Mismo nombre que la migración, con `_down` antes de la extensión, en esta
carpeta. **Nunca en `migrations/`.**

Ojo con el criterio del repo, que está en `CLAUDE.md`: acá se prefieren los
cambios **aditivos y reversibles** con guards que fallan si alguien rompe la
regla, antes que confiar en un rollback. Una reversión es la red, no el plan.
