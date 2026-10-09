-- Carga autorizada por el usuario: listado nuevo, anteriores intactos, stock inicial 1.
-- DML de un único comercio; no es una migración de schema ni un seed global.
-- Reejecutar verifica sin resetear existencias ni pisar cambios posteriores.
begin;
set local statement_timeout = '20s';
set local lock_timeout = '5s';
select set_config('comerz.origen_movimiento', 'CARGA_RAPIDA', true);
select pg_advisory_xact_lock(hashtextextended('colores-tarifario-20261009', 0));
do $carga$
declare
  negocio constant uuid := '27b693c8-44f5-49c2-b3df-66d00be6719a';
  listado constant jsonb := $datos$[{"nombre":"Fotocopia A4 blanco y negro simple faz","categoria":"Fotocopias blanco y negro","precio":250,"precios_por_cantidad":[{"desde":10,"precio":220},{"desde":50,"precio":200},{"desde":100,"precio":180}],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Fotocopia A4 blanco y negro doble faz","categoria":"Fotocopias blanco y negro","precio":400,"precios_por_cantidad":[{"desde":10,"precio":350},{"desde":50,"precio":320},{"desde":100,"precio":280}],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Fotocopia de DNI","categoria":"Fotocopias blanco y negro","precio":350,"precios_por_cantidad":[{"desde":10,"precio":300},{"desde":50,"precio":280},{"desde":100,"precio":250}],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Hoja blanca A4","categoria":"Hojas blancas","precio":70,"precios_por_cantidad":[{"desde":10,"precio":60},{"desde":50,"precio":50},{"desde":100,"precio":40}],"descripcion":""},{"nombre":"Fotocopia oficio blanco y negro simple faz","categoria":"Fotocopias blanco y negro","precio":300,"precios_por_cantidad":[{"desde":10,"precio":280},{"desde":50,"precio":250},{"desde":100,"precio":220}],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Fotocopia oficio blanco y negro doble faz","categoria":"Fotocopias blanco y negro","precio":450,"precios_por_cantidad":[{"desde":10,"precio":400},{"desde":50,"precio":360},{"desde":100,"precio":300}],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Hoja blanca oficio","categoria":"Hojas blancas","precio":80,"precios_por_cantidad":[{"desde":10,"precio":70},{"desde":50,"precio":60},{"desde":100,"precio":50}],"descripcion":""},{"nombre":"Fotocopia A3 / tabloide blanco y negro simple faz","categoria":"Fotocopias blanco y negro","precio":450,"precios_por_cantidad":[{"desde":10,"precio":400},{"desde":50,"precio":350},{"desde":100,"precio":300}],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Fotocopia A3 / tabloide blanco y negro doble faz","categoria":"Fotocopias blanco y negro","precio":700,"precios_por_cantidad":[{"desde":10,"precio":600},{"desde":50,"precio":550},{"desde":100,"precio":450}],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Hoja blanca A3","categoria":"Hojas blancas","precio":150,"precios_por_cantidad":[{"desde":10,"precio":130},{"desde":50,"precio":110},{"desde":100,"precio":100}],"descripcion":""},{"nombre":"Impresión A4 color + texto simple faz","categoria":"Impresiones color","precio":400,"precios_por_cantidad":[{"desde":10,"precio":350},{"desde":50,"precio":320},{"desde":100,"precio":280}],"descripcion":"Color + texto: trabajos escolares, apuntes y presentaciones. Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión A4 color + texto doble faz","categoria":"Impresiones color","precio":650,"precios_por_cantidad":[{"desde":10,"precio":600},{"desde":50,"precio":520},{"desde":100,"precio":450}],"descripcion":"Color + texto: trabajos escolares, apuntes y presentaciones. Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión A4 color pleno simple faz","categoria":"Impresiones color","precio":800,"precios_por_cantidad":[{"desde":10,"precio":700},{"desde":50,"precio":600},{"desde":100,"precio":500}],"descripcion":"Color pleno: imágenes, fondos y fotografías. Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión A4 color pleno doble faz","categoria":"Impresiones color","precio":1300,"precios_por_cantidad":[{"desde":10,"precio":1100},{"desde":50,"precio":1000},{"desde":100,"precio":850}],"descripcion":"Color pleno: imágenes, fondos y fotografías. Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión oficio color + texto simple faz","categoria":"Impresiones color","precio":500,"precios_por_cantidad":[{"desde":10,"precio":450},{"desde":50,"precio":400},{"desde":100,"precio":350}],"descripcion":"Color + texto: trabajos escolares, apuntes y presentaciones. Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión oficio color + texto doble faz","categoria":"Impresiones color","precio":800,"precios_por_cantidad":[{"desde":10,"precio":700},{"desde":50,"precio":650},{"desde":100,"precio":550}],"descripcion":"Color + texto: trabajos escolares, apuntes y presentaciones. Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión oficio color pleno simple faz","categoria":"Impresiones color","precio":1000,"precios_por_cantidad":[{"desde":10,"precio":900},{"desde":50,"precio":800},{"desde":100,"precio":700}],"descripcion":"Color pleno: imágenes, fondos y fotografías. Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión oficio color pleno doble faz","categoria":"Impresiones color","precio":1600,"precios_por_cantidad":[{"desde":10,"precio":1400},{"desde":50,"precio":1200},{"desde":100,"precio":1000}],"descripcion":"Color pleno: imágenes, fondos y fotografías. Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión en papel fotográfico A4 (pleno)","categoria":"Papel fotográfico","precio":3500,"precios_por_cantidad":[],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión en papel fotográfico 15 x 21 cm","categoria":"Papel fotográfico","precio":2800,"precios_por_cantidad":[],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión en papel fotográfico 13 x 18 cm","categoria":"Papel fotográfico","precio":2500,"precios_por_cantidad":[],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión en papel fotográfico 10 x 15 cm","categoria":"Papel fotográfico","precio":2000,"precios_por_cantidad":[],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión en papel fotográfico 9 x 13 cm","categoria":"Papel fotográfico","precio":1500,"precios_por_cantidad":[],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión en papel fotográfico 4 x 4 cm (pack x 4)","categoria":"Papel fotográfico","precio":2000,"precios_por_cantidad":[],"descripcion":"El precio corresponde al pack de 4 fotos. Cantidad 1 = un pack. Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión en papel adhesivo A4 color pleno","categoria":"Impresiones especiales","precio":1800,"precios_por_cantidad":[],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión en papel tarjeta 150 gr color","categoria":"Impresiones especiales","precio":1200,"precios_por_cantidad":[],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Portarretrato común laminado","categoria":"Portarretratos","precio":6600,"precios_por_cantidad":[],"descripcion":""},{"nombre":"Portarretrato 7 x 5 cm","categoria":"Portarretratos","precio":2300,"precios_por_cantidad":[],"descripcion":""},{"nombre":"Portarretrato 7 x 10 cm","categoria":"Portarretratos","precio":4500,"precios_por_cantidad":[],"descripcion":""},{"nombre":"Portarretrato 10 x 15 cm","categoria":"Portarretratos","precio":9000,"precios_por_cantidad":[],"descripcion":""},{"nombre":"Portarretrato con vidrio 7 x 5 cm","categoria":"Portarretratos","precio":4500,"precios_por_cantidad":[],"descripcion":""},{"nombre":"Portarretrato con vidrio 10 x 15 cm","categoria":"Portarretratos","precio":8300,"precios_por_cantidad":[],"descripcion":""},{"nombre":"Portarretrato con vidrio 13 x 15 cm","categoria":"Portarretratos","precio":9000,"precios_por_cantidad":[],"descripcion":""},{"nombre":"Portarretrato con vidrio 20 x 30 cm","categoria":"Portarretratos","precio":18000,"precios_por_cantidad":[],"descripcion":""},{"nombre":"Escaneo","categoria":"Otros servicios","precio":250,"precios_por_cantidad":[],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Impresión desde celular / WhatsApp","categoria":"Otros servicios","precio":300,"precios_por_cantidad":[],"descripcion":"Los trabajos se realizan con archivos en buen estado."},{"nombre":"Ajuste o edición simple de archivos","categoria":"Otros servicios","precio":300,"precios_por_cantidad":[],"descripcion":"Los trabajos se realizan con archivos en buen estado."}]$datos$::jsonb;
  fila jsonb;
  parent uuid;
  cat uuid;
  prod uuid;
  anterior public.productos%rowtype;
  slug_producto text;
  slug_categoria text;
  total_antes integer;
  creados integer := 0;
  afectados integer;
  indice integer := 0;
begin
  if not exists(select 1 from public.negocios where id=negocio and slug='libreria-colores' and nombre='Librería Colores') then
    raise exception 'El negocio no coincide con Librería Colores';
  end if;
  if jsonb_array_length(listado) <> 37 or
     (select count(*) from jsonb_array_elements(listado) f where jsonb_array_length(f->'precios_por_cantidad')>0) <> 18 then
    raise exception 'Listado incompleto';
  end if;
  select count(*) into total_antes from public.productos where negocio_id=negocio;
  -- Centro de copiado: padre nuevo; los portarretratos pertenecen a Regalería.
  select id into parent from public.categorias where negocio_id=negocio and slug='centro-de-copiado';
  if parent is null then
    insert into public.categorias(negocio_id,nombre,slug,descripcion)
    values(negocio,'Centro de copiado','centro-de-copiado','Fotocopias, impresiones y servicios del tarifario de Colores.')
    returning id into parent;
  elsif not exists(select 1 from public.categorias where id=parent and negocio_id=negocio and parent_id is null and activa) then
    raise exception 'Categoría Centro de copiado incompatible';
  end if;
  for fila in select value from jsonb_array_elements(listado) loop
    indice := indice+1;
    slug_producto := 'colores-tarifario-20261009-' || lpad(indice::text,2,'0');
    slug_categoria := case fila->>'categoria'
      when 'Fotocopias blanco y negro' then 'fotocopias-blanco-y-negro'
      when 'Hojas blancas' then 'hojas-blancas'
      when 'Impresiones color' then 'impresiones-color'
      when 'Papel fotográfico' then 'papel-fotografico'
      when 'Impresiones especiales' then 'impresiones-especiales'
      when 'Portarretratos' then 'portarretratos'
      when 'Otros servicios' then 'otros-servicios-copiado'
      else null end;
    if slug_categoria is null or not public.precios_por_cantidad_validos(fila->'precios_por_cantidad') then
      raise exception 'Fila inválida: %',fila->>'nombre';
    end if;
    select id into cat from public.categorias where negocio_id=negocio and slug=slug_categoria;
    if cat is null then
      insert into public.categorias(negocio_id,nombre,slug,parent_id)
      values(negocio,fila->>'categoria',slug_categoria,
        case when slug_categoria='portarretratos' then
          (select id from public.categorias where negocio_id=negocio and id='c2957954-dae1-43f3-8178-0743efa9621b')
        else parent end)
      returning id into cat;
    end if;
    if not exists(select 1 from public.categorias where id=cat and negocio_id=negocio and activa
      and parent_id=case when slug_categoria='portarretratos' then 'c2957954-dae1-43f3-8178-0743efa9621b'::uuid else parent end) then
      raise exception 'Categoría incompatible: %',slug_categoria;
    end if;
    select * into anterior from public.productos where negocio_id=negocio and slug=slug_producto;
    if found then
      prod := anterior.id;
      if anterior.nombre is distinct from fila->>'nombre'
         or anterior.precio is distinct from (fila->>'precio')::numeric
         or anterior.precios_por_cantidad is distinct from fila->'precios_por_cantidad'
         or anterior.categoria_id is distinct from cat then
        raise exception 'El producto ya existe con cambios; no se pisa: %',fila->>'nombre';
      end if;
    else
      if exists(select 1 from public.productos where negocio_id=negocio and lower(trim(nombre))=lower(trim(fila->>'nombre'))) then
        raise exception 'Ya existe un producto con este nombre; revisar: %',fila->>'nombre';
      end if;
      insert into public.productos(negocio_id,nombre,tipo,precio,slug,descripcion,categoria_id,atributos_globales,publicado,unidad_medida,precios_por_cantidad)
      values(negocio,fila->>'nombre',fila->>'categoria',(fila->>'precio')::numeric,slug_producto,
        nullif(fila->>'descripcion',''),cat,'{}'::jsonb,true,'UNIDAD',fila->'precios_por_cantidad')
      returning id into prod;
      -- Costo no informado: se conserva el default obligatorio de la app, sin inventar un costo.
      insert into public.producto_variantes(negocio_id,producto_id,nombre_display,atributos,precio,costo,stock)
      values(negocio,prod,'Único','{}'::jsonb,null,null,1);
      get diagnostics afectados = row_count;
      if afectados<>1 then raise exception 'No se creó la variante'; end if;
      insert into public.productos_stock(negocio_id,producto_id,variante,cantidad)
      values(negocio,prod,'Único',1);
      get diagnostics afectados = row_count;
      if afectados<>1 then raise exception 'No se creó el espejo de stock'; end if;
      creados := creados+1;
    end if;
    if (select count(*) from public.producto_variantes where negocio_id=negocio and producto_id=prod and nombre_display='Único' and activa and precio is null)<>1
       or (select count(*) from public.productos_stock where negocio_id=negocio and producto_id=prod and variante='Único')<>1
       or not exists(select 1 from public.producto_variantes v join public.productos_stock s on s.producto_id=v.producto_id and s.negocio_id=v.negocio_id and s.variante=v.nombre_display
         where v.negocio_id=negocio and v.producto_id=prod and v.stock=s.cantidad) then
      raise exception 'Variante o espejo incorrecto: %',fila->>'nombre';
    end if;
  end loop;
  if (select count(*) from public.productos where negocio_id=negocio) <> total_antes+creados then
    raise exception 'Conteo de productos inesperado';
  end if;
  if (select count(*) from public.productos where negocio_id=negocio and slug like 'colores-tarifario-20261009-%')<>37 then
    raise exception 'No están los 37 productos del listado';
  end if;
end;
$carga$;
commit;
select count(*) as productos, count(*) filter(where jsonb_array_length(precios_por_cantidad)>0) as con_tramos
from public.productos where negocio_id='27b693c8-44f5-49c2-b3df-66d00be6719a' and slug like 'colores-tarifario-20261009-%';
