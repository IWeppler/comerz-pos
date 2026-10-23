-- Reversión de 20261023120000_planes_tope_ventas_y_arca.sql (correr a mano).
update public.planes
   set reglas = reglas - 'max_ventas_mensuales'
 where id in (
   '5c9f1d20-fd49-42d2-aa67-4eff7b1694e9',
   'bcbc54c4-65b7-4e0d-9a9d-ca586981a375',
   'c5ed28c7-9bb5-4b2a-bd83-edf64e9f9b94',
   'b85b6457-af66-4f2e-a341-fabdf0017b31'
 );

-- Gestión vuelve a productos sin tope (null declarado).
update public.planes
   set reglas = reglas || jsonb_build_object('max_productos', null)
 where id = 'bcbc54c4-65b7-4e0d-9a9d-ca586981a375';

-- Saca ARCA de Emprendedor (volvía a no tenerla en la lista de features).
update public.planes
   set reglas = jsonb_set(
         reglas, '{features}',
         (select coalesce(jsonb_agg(f), '[]'::jsonb)
            from jsonb_array_elements(reglas -> 'features') f
           where f <> to_jsonb('facturacion_electronica'::text))
       )
 where id = '5c9f1d20-fd49-42d2-aa67-4eff7b1694e9';
