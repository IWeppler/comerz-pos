import { esNegocioDemo } from "@/shared/lib/estado-negocio";
export interface FechasActivacion {
  id: string;
  nombre: string;
  estado: string;
  alta: string;
  productos: string | null;
  caja: string | null;
  primera_venta: string | null;
  pos_abierto: string | null;
  camino: string | null;
  camino_elegido: string | null;
}
export interface CohorteActivacion {
  semana: string;
  comercios: number;
  evaluables: number;
  vendidos_24h: number;
  porcentaje_24h: number | null;
}
export interface EmbudoActivacion {
  comercios: FechasActivacion[];
  cohortes: CohorteActivacion[];
}
export function horasHastaHito(
  alta: string,
  fecha: string | null,
): number | null {
  if (!fecha) return null;
  const horas = (Date.parse(fecha) - Date.parse(alta)) / 3_600_000;
  return Number.isFinite(horas) && horas >= 0 ? horas : null;
}
export function comerciosAutonomos(
  filas: FechasActivacion[],
): FechasActivacion[] {
  return filas.filter(
    (f) =>
      !esNegocioDemo(f.estado) &&
      !(f.primera_venta && Date.parse(f.primera_venta) < Date.parse(f.alta)),
  );
}
export function nombreCamino(hito: string | null): string {
  switch (hito) {
    case "CAMINO_VENTA_LIBRE":
      return "Venta libre";
    case "CAMINO_IMPORTACION":
      return "Excel";
    case "CAMINO_CARGA_RAPIDA":
      return "Carga rápida";
    case "CAMINO_CARGA_MANUAL":
      return "Carga manual";
    default:
      return "—";
  }
}
