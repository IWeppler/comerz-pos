/**
 * Cuánto le queda al certificado de ARCA. Dura dos años, y el día que vence
 * nadie se acuerda: la caja deja de facturar con un error de WSAA que no
 * dice "venció". Por eso se avisa con tiempo, y el tono sube al vencer.
 */

export const DIAS_AVISO_CERTIFICADO = 30;

export type EstadoCertificado =
  | { estado: "vigente"; dias: number }
  | { estado: "por_vencer"; dias: number }
  | { estado: "vencido"; dias: number };

export function estadoCertificado(
  vencimientoIso: string | null | undefined,
  ahora: Date = new Date(),
): EstadoCertificado | null {
  if (!vencimientoIso) return null;
  const vence = new Date(vencimientoIso).getTime();
  if (Number.isNaN(vence)) return null;
  const dias = Math.floor((vence - ahora.getTime()) / 86_400_000);
  if (dias < 0) return { estado: "vencido", dias: -dias };
  if (dias <= DIAS_AVISO_CERTIFICADO) return { estado: "por_vencer", dias };
  return { estado: "vigente", dias };
}
