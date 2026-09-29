# Facturación: comprobantes, ARCA, IVA y exportaciones

Leé esto antes de tocar `features/arca/`, `comprobantes`,
`emitir-comprobante.ts`, `determinar-comprobante.ts`, `configuracion_pos` en lo
fiscal, los datos fiscales de productos o clientes, o /reportes → exportaciones.

## Modo y preferencia

- **Dos ejes**: `modo_facturacion` es la CAPACIDAD (INTERNO | MANUAL | ARCA; solo
  ARCA emite con CAE; MANUAL factura fuera y para el POS es INTERNO) y
  `comprobante_defecto` la ELECCIÓN. Criterio en `shared/lib/facturacion.ts`.
- El CHECK cruza las dos columnas, así que el UPDATE **las manda siempre juntas**.
  Que la letra corresponda a la condición de IVA del emisor NO es CHECK a propósito
  (impediría pasar de Monotributo a RI con un default viejo). **La condición se lee
  de la BASE, nunca del form.**

## Qué comprobante corresponde: `shared/lib/determinar-comprobante.ts`

Una función pura en el server cruza condición del EMISOR, del RECEPTOR, tipo de
operación y config. **El POS manda la venta, NUNCA el tipo de comprobante** (uno
elegido en el navegador se elige con las DevTools).
- Monotributista o exento emiten SIEMPRE C. Un RI emite A solo a otro RI y B a todo
  el resto, incluido el receptor sin datos.
- La celda RI → Monotributo está aislada en `RI_A_MONOTRIBUTO` (hoy B): **confirmar
  con el contador**.
- `comprobante_defecto` es preferencia: si la matriz no lo habilita, gana la matriz.
- `determinarComprobanteFiscal` es la matriz sin el corte de
  `ARCA_EMISION_DISPONIBLE`, para poder testearla con el flag apagado.

## Tabla `comprobantes`

- Tabla aparte porque una venta puede tener MÁS de un comprobante (una factura
  anulada se compensa con una NC con su propio CAE) y porque **un comprobante es
  INMUTABLE**: sin policy de UPDATE ni DELETE. Receptor e importes van CONGELADOS en
  la fila.
- `siguiente_numero_comprobante` serializa por row lock (un `insert ... on conflict
  do update ... returning`), nunca `max + 1`. Es autoridad SOLO para TICKET; en lo
  fiscal manda ARCA (`FECompUltimoAutorizado`).
- **El TICKET interno va siempre en la serie 1**, desacoplado del punto de venta de
  ARCA (18/9/2026): antes imprimía "00005-…", un número que en ARCA no existe.
- CHECK: TICKET nunca lleva CAE; todo lo fiscal siempre lo lleva.
- `comprobantes.venta_id` es ON DELETE RESTRICT: una venta con comprobante no se
  borra (la app anula, nunca borra).
- Número impreso: `formatearNumeroComprobante` ("0001-00000123"); si no hay
  comprobante cae al prefijo del UUID de la venta.

## Emisión en la venta

- **Con TICKET**, la emisión es el paso 11 de `create-sale.ts`
  (`features/sales/lib/emitir-comprobante.ts`): el único paso que NO voltea la venta
  (la plata y el stock ya se movieron). Devuelve resultado, nunca lanza, y loguea
  `[COMPROBANTE]` como error si falla.
- **Con ARCA se invierte**: una factura no se entrega sin CAE, así que el CAE va ANTES
  de cerrar la venta.
- **Anular una venta FACTURADA exige nota de crédito** (`requiereNotaCredito` en
  `cancel-sale.ts`); la NC se pide a ARCA antes de la RPC de anulación (ver el caso
  residual en [ventas.md](ventas.md)).

## Conexión con ARCA

- **Las llamadas van por `node:https` con agente propio, NO por `fetch`**
  (`features/arca/lib/http-arca.ts`). `servicios1.afip.gov.ar` prefiere DHE de 1024
  bits y OpenSSL 3 lo rechaza (`ERR_SSL_DH_KEY_TOO_SMALL`). El agente no ofrece DHE;
  NO se baja el nivel de seguridad. **Que funcione en homologación no prueba
  producción** (esos hosts negocian ECDHE).
- Los errores de red se muestran con su `code` (`error-red.ts`): "fetch failed" no
  distingue DNS, firewall ni TLS. "Certificado no emitido por AC de confianza" en
  WSAA = certificado del OTRO ambiente.
- El padrón de ARCA (autocompletar CUIT) pide WSAA con el mismo certificado.

## IVA del producto

- **UN campo `productos.tratamiento_iva`** (GRAVADO_21 | GRAVADO_105 | GRAVADO_27 |
  EXENTO | NO_GRAVADO), no dos: con dos existen combinaciones imposibles. EXENTO y
  NO_GRAVADO van en columnas distintas del libro. Desglose en
  `shared/lib/fiscal-producto.ts`: **neto = precio / (1 + alícuota/100)**, no
  `precio − precio × alícuota`.
- Es NOT NULL aunque haya venta "en negro": eso es de la VENTA (se emite o no
  comprobante fiscal), no del producto. Antes de la primera factura con ARCA: avisar
  "tenés N productos en 21% sin revisar".
- `unidad_medida` guarda la unidad SEMÁNTICA; la traducción a ARCA entra con la
  integración.
- Los defaults salen del rubro (`defaultsFiscalesPorRubro`) y se COPIAN al alta: no
  se recalculan al cambiar el rubro. `farmacia` y `alimentos` quedan en 21% hasta
  confirmarlo con el contador.
- El bloque fiscal del formulario va colapsado y, cerrado, no monta sus inputs; las
  actions miran `formData.has(...)` para no pisar la alícuota.
- `comprobantes` tiene UN neto y UN iva: una factura con varias alícuotas necesita
  subtotales por alícuota (tabla hija, pendiente).

## Cliente fiscal

- Comercial y fiscal son el MISMO cliente; lo fiscal se revela con `es_fiscal`.
  **Apagar el toggle BORRA los datos fiscales**, por eso el modal de edición siembra
  el switch desde `cliente.cuit` durante el render (no en un efecto).
- `direccion_comercial` (entrega) ≠ `direccion` (domicilio fiscal).
- CUIT validado por dígito verificador (`shared/lib/cuit.ts`, módulo 11) en el form y
  en la action, guardado a 11 dígitos. `(negocio_id, cuit)` y `(negocio_id, dni)`
  únicos con índice PARCIAL.

## Exportaciones para el contador (/reportes)

- Comerz no lleva la contabilidad: prepara la información. El catálogo
  (`catalogo-exportaciones.ts`) declara qué tiene fuente real hoy y por qué no.
- **Los libros de IVA están deshabilitados**: armados con tickets serían información
  falsa firmada por el comercio. El de COMPRAS no se destraba con ARCA:
  `ordenes_compra` son remitos, no facturas.
- El período tiene su propio selector (`periodo-exportacion.ts`): el del panel
  recorta mes-a-la-fecha.
- Importes como NÚMERO y fechas ISO. Las ventas anuladas aparecen marcadas.
