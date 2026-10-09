# Carga del tarifario de Librería Colores — 8/10/2026

Carga aplicada en producción para `27b693c8-44f5-49c2-b3df-66d00be6719a`
(`libreria-colores`), autorizada por el usuario: listado nuevo sin modificar los
productos anteriores; stock inicial 1 por producto.

- Fuente: imagen de precios aportada en la conversación.
- 37 productos con precio definido, 18 con tramos desde 10, 50 y 100.
- 8 categorías nuevas: Centro de copiado, sus 6 subcategorías y Portarretratos
  bajo Regalería. Precios finales tal como aparecen en la imagen.
- Una variante Único por producto, precio/costo heredados; stock canónico y espejo
  legacy en 1. Costos no informados: el alta conserva el default obligatorio del
  sistema (0); no representa un costo relevado.
- No se crean promociones adicionales: el precio por cantidad es la condición
  comercial del tarifario y duplicarlo como descuento reduciría de nuevo el precio.
- Se dejan pendientes Impresión de PDF (desde $250) y Armado de trabajos
  (consultar): la imagen no define un precio fijo para cobrarlos.

Datos exactos: `datos-libreria-colores-precios.json`.
Carga reproducible: `cargar-libreria-colores-precios.sql`; se ejecutó primero
con ROLLBACK y luego con COMMIT. Es DML de un solo comercio, no una migración
global. El script verifica al reejecutar, sin resetear stock ni pisar precios.

Verificación posterior: 37 nombres, precios, configuraciones de tramos,
publicación, herencia de variante y existencias coinciden con el JSON. Conteo
total de Colores: 1666 antes, 1703 después. No se registraron ventas de prueba.

Con stock 1 y la configuración actual que impide vender sin stock, cantidades
mayores requieren aumentar las existencias. El cálculo de precios por cantidad
está implementado en el working tree y sigue pendiente de publicación: esta carga
de datos no publica el código.
