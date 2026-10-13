export const HITOS_ACTIVACION = [
  "POS_ABIERTO",
  "CAMINO_VENTA_LIBRE",
  "CAMINO_IMPORTACION",
  "CAMINO_CARGA_RAPIDA",
  "CAMINO_CARGA_MANUAL",
  "PRIMERA_VENTA_FESTEJADA",
  // "Saltear tutorial" de Primeros pasos: vuelve el panel de siempre, por negocio.
  "PRIMEROS_PASOS_SALTEADOS",
] as const;
export type HitoActivacion = (typeof HITOS_ACTIVACION)[number];
