import { normalizarRubro } from "@/entities/config/types";
import type { HitoActivacion } from "./hitos-activacion";

export interface CaminoInicio {
  titulo: string;
  detalle: string;
  href: string;
  hito: HitoActivacion;
}
export function caminosInicio(rubro: string): CaminoInicio[] {
  return [
    {
      titulo: "Quiero empezar a vender ahora",
      detalle:
        "Vendé escribiendo qué es y el precio. Los productos los cargás después.",
      href: "/pos?inicio=venta-libre",
      hito: "CAMINO_VENTA_LIBRE" as const,
    },
    {
      titulo: "Ya tengo mis productos en Excel",
      detalle: "Subís tu planilla y revisás antes de que toque el stock.",
      href: "/stock?accion=importar",
      hito: "CAMINO_IMPORTACION" as const,
    },
    ...(normalizarRubro(rubro) !== "indumentaria"
      ? [
          {
            titulo: "Quiero cargarlos rápido",
            detalle:
              "Escaneás el código de barras y la ficha se completa sola.",
            href: "/stock/carga-rapida",
            hito: "CAMINO_CARGA_RAPIDA" as const,
          },
        ]
      : []),
    {
      titulo: "Un producto con todos sus datos",
      detalle: "De a uno, con precio, stock y fotos.",
      href: "/stock?accion=nuevo",
      hito: "CAMINO_CARGA_MANUAL" as const,
    },
  ];
}
