import { Badge } from "@/shared/ui/badge";
import { ETIQUETA_ESTADO, type EstadoVisiblePresupuesto } from "../lib/estado";

const VARIANTE: Record<EstadoVisiblePresupuesto, "success" | "warning" | "danger" | "secondary" | "info"> = {
  VIGENTE: "success",
  VENCIDO: "warning",
  ACEPTADO: "info",
  RECHAZADO: "danger",
  ANULADO: "secondary",
};

export function EstadoPresupuestoBadge({ estado }: Readonly<{ estado: EstadoVisiblePresupuesto }>) {
  return <Badge variant={VARIANTE[estado]}>{ETIQUETA_ESTADO[estado]}</Badge>;
}
