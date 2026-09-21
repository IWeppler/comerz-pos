begin;
alter table public.movimientos_financieros disable trigger trg_movimientos_financieros_inmutable;
delete from public.movimientos_financieros where origen_tipo = 'TRANSFERENCIA';
alter table public.movimientos_financieros enable trigger trg_movimientos_financieros_inmutable;
drop function if exists public.estado_cuentas_financieras();
drop function if exists public.transferencias_caja_turno(uuid);
drop function if exists public.registrar_transferencia_financiera(uuid, uuid, numeric, text, uuid);
drop table if exists public.transferencias_financieras;
alter table public.movimientos_financieros
  drop constraint if exists movimientos_financieros_origen_tipo_check,
  add constraint movimientos_financieros_origen_tipo_check
    check (origen_tipo in ('VENTA_PAGO', 'EGRESO'));
commit;
