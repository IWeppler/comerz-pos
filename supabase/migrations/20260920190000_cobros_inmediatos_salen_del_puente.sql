-- El paso 3 de `20260920180000` salió NO-OP en silencio. Esto lo ejecuta.
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUÉ PASÓ, Y POR QUÉ VALE LA PENA ANOTARLO
--
-- Aquella migración movía los cobros inmediatos fuera del puente
-- POR_ACREDITAR tocando `venta_pagos.cuenta_destino_id` y dejando que el
-- trigger `trg_venta_pagos_asignar_cuenta` lo completara desde `metodos_pago`.
-- No completó nada: ese trigger es
--
--     BEFORE INSERT OR UPDATE **OF metodo_pago_id, metodo_tipo**
--
-- y el UPDATE tocaba solo `cuenta_destino_id`, así que nunca corrió. La fila
-- quedó con null, `v_cambio` dio false en la bitácora y no se escribió un solo
-- movimiento. **Un UPDATE que no falla no es un UPDATE que hizo algo**, y un
-- trigger con lista de columnas es justo donde eso se esconde — el mismo
-- síntoma que el éxito silencioso de PostgREST del 5/9.
--
-- Lo destapó el número: después de aplicar, la caja diaria de Evens quedó
-- perfecta en $163.800, pero POR_ACREDITAR seguía en $19.985.473 y las tres
-- cuentas nuevas en CERO.
--
-- Acá el valor se escribe a mano. `20260920180000` quedó corregida también, así
-- que reconstruir el schema desde cero hace esto en su paso 3 y esta migración
-- no encuentra nada que mover.

begin;

update public.venta_pagos vp
   set cuenta_destino_id = m.cuenta_destino_id
  from public.metodos_pago m
 where m.id = vp.metodo_pago_id
   and m.negocio_id = vp.negocio_id
   and m.cuenta_destino_id is not null
   and vp.metodo_tipo <> 'EFECTIVO'
   and coalesce(vp.acreditacion_dias, 0) = 0
   and vp.cuenta_destino_id is null
   and vp.negocio_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- EL INVARIANTE, ESCRITO CON LA MISMA REGLA QUE LO PRODUCE
--
-- El saldo de CADA cuenta digital tiene que ser igual al neto de los cobros
-- vivos que la propia `cuenta_actual_venta_pago` manda a esa cuenta. No se
-- reescribe la condicion aca: se llama a la funcion, que es la unica que sabe
-- cuando un cobro esta en el puente y cuando en su cuenta real. Una copia de
-- esa regla en el guard seria una segunda version que se desincroniza.
--
-- Lo que queda en el puente despues de esto, y que es correcto que quede:
--   * los cobros DIFERIDOS (tarjetas a 20 dias) hasta que alguien los concilie
--     con `registrar_acreditacion_financiera`. El ledger no los acredita solo
--     por fecha estimada, y eso ya lo decidio la Etapa 2.
--   * los cobros sin `metodo_pago_id` — metodos borrados o anteriores a la
--     tabla. Son 16 en Evens por $528.900 (" Transf. Banco Nacion " y
--     "Transf. Mercado Pago"). No hay metodo del que sacar la cuenta, asi que
--     el sistema no sabe donde cayo esa plata; dejarlos en el puente es
--     decirlo, y crearles una cuenta seria inventarla.
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  r record;
begin
  for r in
    select n.nombre negocio, c.nombre cuenta,
           coalesce((select sum(m.importe) from public.movimientos_financieros m
                      where m.cuenta_financiera_id = c.id), 0) saldo_ledger,
           coalesce((select sum(vp.monto_neto) from public.venta_pagos vp
                      where vp.negocio_id = c.negocio_id
                        and vp.metodo_tipo <> 'EFECTIVO'
                        and public.cuenta_actual_venta_pago(
                              vp.negocio_id, vp.metodo_tipo,
                              vp.acreditacion_dias, vp.cuenta_destino_id) = c.id
                        and (
                          vp.estado_pago_operacion <> 'ANULADO'
                          or exists (
                            select 1 from public.ventas v
                             where v.id = vp.venta_id
                               and v.negocio_id = vp.negocio_id
                               and v.reintegro_metodo_id is not null
                               and v.reintegro_metodo_id is distinct from vp.metodo_pago_id
                          )
                        )
                        and not exists (
                          select 1 from public.acreditaciones_financieras_pagos ap
                           where ap.negocio_id = vp.negocio_id
                             and ap.venta_pago_id = vp.id
                        )), 0) esperado
      from public.cuentas_financieras c
      join public.negocios n on n.id = c.negocio_id
     where not c.es_efectivo
  loop
    if abs(r.saldo_ledger - r.esperado) > 0.01 then
      raise exception
        'GUARD: la cuenta % de % no cierra contra sus cobros (ledger %, esperado %)',
        r.cuenta, r.negocio, r.saldo_ledger, r.esperado;
    end if;
  end loop;
end;
$guard$;

commit;
