import type { ModoFacturacion, TipoComprobante } from "@/shared/lib/facturacion";

export type RecargoMoraTipo = "NINGUNO" | "MONTO_FIJO" | "PORCENTAJE";

/**
 * Rubro del comercio. Decide dos cosas: qué columnas trae la plantilla de
 * mercadería (features/stock/lib/columnas-por-rubro.ts) y cómo se muestra la
 * identidad del producto en Inventario — indumentaria razona por talle/color
 * (N variantes), electro por modelo/EAN.
 */
export type Rubro =
  | "indumentaria"
  | "electro"
  | "alimentos"
  | "farmacia"
  | "ferreteria"
  | "quioscos"
  | "cotillon"
  | "otros";

export const RUBROS_VALIDOS: readonly Rubro[] = [
  "indumentaria",
  "electro",
  "alimentos",
  "farmacia",
  "ferreteria",
  "quioscos",
  "cotillon",
  "otros",
] as const;

export const RUBRO_DEFAULT: Rubro = "indumentaria";

/**
 * Fail-closed: un rubro desconocido (valor viejo, fila sin config, typo) cae a
 * indumentaria.
 *
 * Antes esto era `valor === "electro" ? "electro" : "indumentaria"`, o sea que
 * los otros cinco rubros del tipo se leían como indumentaria aunque estuvieran
 * bien guardados. Con la plantilla por rubro eso pasó de ser inofensivo a
 * darle a una ferretería las columnas de una tienda de ropa.
 */
export function normalizarRubro(valor: unknown): Rubro {
  return RUBROS_VALIDOS.includes(valor as Rubro) ? (valor as Rubro) : RUBRO_DEFAULT;
}

export interface ConfiguracionPOS {
  id: string;
  posName: string;
  posLogo: string;
  // La identidad fiscal del comercio y el pie del ticket NO salen al catálogo
  // público: anon no los tiene concedidos en la base (20260811140000), así que
  // en las páginas de tienda estos campos no vienen. Son opcionales por eso,
  // no porque el comercio pueda no tenerlos cargados.
  razon_social?: string;
  cuit?: string;
  condicion_iva?: string;
  inicio_actividades?: string;
  provincia: string;
  localidad: string;
  whatsapp: string;
  direccion: string;
  mensaje_ticket?: string;
  /** Ancho del papel de la impresora térmica: 58 u 80 mm. Ver
   * `shared/lib/ancho-ticket.ts`. Ausente = 80, que es lo de siempre. */
  ancho_ticket_mm?: number | null;

  // Catálogo y E-commerce
  catalogo_activo?: boolean;
  mostrar_precios?: boolean;
  mostrar_sin_stock?: boolean;
  pedidos_whatsapp?: boolean;
  direccion_visible?: boolean;
  horario_visible?: boolean;

  // Redes y Horarios
  instagram?: string;
  facebook?: string;
  horario_texto?: string;

  // Envíos del catálogo público
  localidad_negocio?: string | null;
  envio_costo_local?: number | null;
  envio_mensaje_lejos?: string | null;

  // Banner Promocional
  banner_activo?: boolean;
  banner_imagen?: string;
  /** Opcional. Vacío = se usa `banner_imagen` también en desktop. */
  banner_imagen_desktop?: string | null;
  /** Encuadre del banner: porcentajes 0-100. NULL = centrado (default de CSS). */
  banner_focal_x?: number | null;
  banner_focal_y?: number | null;
  banner_focal_desktop_x?: number | null;
  banner_focal_desktop_y?: number | null;
  banner_titulo?: string;
  banner_subtitulo?: string;
  banner_boton_texto?: string;
  banner_link?: string;

  // Marquee
  marquee_activo?: boolean;
  marquee_texto?: string;

  // Configuración de Cuentas Corrientes
  cc_activas?: boolean;
  cc_recargo_default?: number;
  cc_anticipo_default?: number;
  entrega_minima_bloqueante?: boolean;
  cc_limite_default?: number;
  cc_plazo_mora?: number;
  crm_dias_inactivo?: number;
  recargo_mora_tipo?: RecargoMoraTipo;
  recargo_mora_valor?: number;

  // Configuración de Caja
  modo_caja?: "UNICA" | "POR_USUARIO" | "POR_PUNTO_VENTA";
  requiere_caja_abierta?: boolean;

  // Configuración de Stock
  permitir_venta_sin_stock?: boolean;

  // Rubro del comercio (T4) — default 'indumentaria' en la BD
  rubro?: Rubro;

  // Facturación. Los valores y sus reglas viven en
  // features/ticket/lib/facturacion.ts: `comprobante_defecto` solo puede ser
  // una factura si `modo_facturacion` es ARCA, y eso lo frena un CHECK.
  modo_facturacion?: ModoFacturacion;
  comprobante_defecto?: TipoComprobante;
  /** Punto de venta de ARCA. null = todavía no dado de alta. */
  punto_venta?: number | null;
  /** Con modo ARCA: si el switch Factura/Ticket del POS arranca en factura.
   * Ausente = true (es lo que hacía la caja antes de que existiera). */
  facturar_por_defecto?: boolean;
  arca_ambiente?: "HOMOLOGACION" | "PRODUCCION";
}
