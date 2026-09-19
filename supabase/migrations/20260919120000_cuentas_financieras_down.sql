-- Reversa de Etapa 1.
-- Ejecutar primero 20260919130000_bitacora_financiera_down.sql: la bitacora
-- referencia cuentas_financieras y no se puede conservar sin ellas.

begin;

drop trigger if exists trg_venta_pagos_asignar_cuenta on public.venta_pagos;
drop trigger if exists trg_metodos_pago_asignar_cuenta on public.metodos_pago;
drop trigger if exists trg_egresos_asignar_cuenta on public.egresos;
drop trigger if exists trg_turnos_caja_asignar_cuenta on public.turnos_caja;
drop trigger if exists trg_negocios_sembrar_cuentas_financieras on public.negocios;

drop function if exists public.asignar_cuenta_financiera_actual();
drop function if exists public.cuenta_financiera_sistema(uuid, text);
drop function if exists public.sembrar_cuentas_financieras_nuevo_negocio();
drop function if exists public.sembrar_cuentas_financieras_sistema(uuid);

alter table public.venta_pagos drop column if exists cuenta_destino_id;
alter table public.metodos_pago drop column if exists cuenta_destino_id;
alter table public.egresos drop column if exists cuenta_origen_id;
alter table public.turnos_caja drop column if exists cuenta_financiera_id;

drop table if exists public.cuentas_financieras;

commit;
