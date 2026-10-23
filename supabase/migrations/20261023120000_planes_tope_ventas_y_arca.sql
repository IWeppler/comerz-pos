-- Tope BLANDO de ventas por mes en los planes + ARCA en todos + semestral 20%.
--
-- Decidido con Ignacio el 23/10/2026:
--   * Emprendedor: 500 ventas por mes. Gestión: 5.000 ventas por mes y 5.000
--     productos. Empresa y Prueba: sin tope. (Hasta hoy Gestión no tenía tope de
--     productos: Evens tiene 1.660 y Librería Colores 2.070, quedan holgados. El
--     tope de productos frena SOLO el alta; lo ya cargado se sigue vendiendo.)
--   * Es un aviso comercial, NO un límite duro: no hay trigger ni chequeo en
--     registrar_venta. La app lo lee de planes.reglas ->> 'max_ventas_mensuales'
--     y avisa en Perfil › Suscripción. Una venta nunca se frena por esto.
--   * Facturación electrónica (ARCA) pasa a Emprendedor. Gestión y Empresa ya
--     la tenían; el código no la bloqueaba en ninguno.
--   * El descuento semestral es 20% (DESCUENTO_SEMESTRAL): el comentario de
--     negocios.modalidad decía 15%.
--
-- Precios, usuarios, productos de Emprendedor y clientes con cuenta corriente NO
-- cambian.
-- Aditiva y reversible (supabase/reversals/20261023120000_...).
-- Los comercios con reglas_override conservan el suyo (reglas_negocio lo
-- mezcla por encima del plan): no se toca.

do $$
declare
  v_emprendedor constant uuid := '5c9f1d20-fd49-42d2-aa67-4eff7b1694e9';
  v_gestion     constant uuid := 'bcbc54c4-65b7-4e0d-9a9d-ca586981a375';
  v_empresa     constant uuid := 'c5ed28c7-9bb5-4b2a-bd83-edf64e9f9b94';
  v_prueba      constant uuid := 'b85b6457-af66-4f2e-a341-fabdf0017b31';
  v_filas       int;
begin
  -- Guard previo: los cuatro planes existen con esos ids.
  select count(*) into v_filas from public.planes
   where id in (v_emprendedor, v_gestion, v_empresa, v_prueba);
  if v_filas <> 4 then
    raise exception 'Se esperaban 4 planes y hay %', v_filas;
  end if;

  update public.planes
     set reglas = reglas || jsonb_build_object('max_ventas_mensuales', 500)
   where id = v_emprendedor;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'Emprendedor: % filas', v_filas; end if;

  update public.planes
     set reglas = reglas || jsonb_build_object('max_ventas_mensuales', 5000, 'max_productos', 5000)
   where id = v_gestion;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'Gestión: % filas', v_filas; end if;

  -- null declarado = "sin tope" (distinto de clave ausente, ver esIlimitado).
  update public.planes
     set reglas = reglas || jsonb_build_object('max_ventas_mensuales', null)
   where id in (v_empresa, v_prueba);
  get diagnostics v_filas = row_count;
  if v_filas <> 2 then raise exception 'Empresa/Prueba: % filas', v_filas; end if;

  -- ARCA en Emprendedor, sin duplicar si ya estuviera.
  update public.planes
     set reglas = jsonb_set(
           reglas, '{features}',
           (reglas -> 'features') || to_jsonb('facturacion_electronica'::text)
         )
   where id = v_emprendedor
     and not (reglas -> 'features') ? 'facturacion_electronica';

  -- Guard posterior: forma final exacta y nada más se movió.
  if not exists (
    select 1 from public.planes
     where id = v_emprendedor
       and (reglas ->> 'max_ventas_mensuales')::int = 500
       and (reglas -> 'features') ? 'facturacion_electronica'
       and (reglas ->> 'max_usuarios')::int = 1
       and (reglas ->> 'max_productos')::int = 1000
       and precio_mensual = 30000
  ) then raise exception 'Emprendedor quedó mal'; end if;

  if not exists (
    select 1 from public.planes
     where id = v_gestion
       and (reglas ->> 'max_ventas_mensuales')::int = 5000
       and (reglas ->> 'max_productos')::int = 5000
       and (reglas ->> 'max_usuarios')::int = 5
       and precio_mensual = 50000
  ) then raise exception 'Gestión quedó mal'; end if;

  if (select count(*) from public.planes
       where id in (v_empresa, v_prueba)
         and reglas ? 'max_ventas_mensuales'
         and reglas -> 'max_ventas_mensuales' = 'null'::jsonb) <> 2 then
    raise exception 'Empresa/Prueba quedaron mal';
  end if;
end $$;

comment on column public.negocios.modalidad is
  'mensual = precio de lista; semestral = 20% off (DESCUENTO_SEMESTRAL en shared/lib/planes.ts). El precio efectivo se calcula, no se guarda.';
