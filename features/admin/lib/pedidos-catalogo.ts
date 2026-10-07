import { esNegocioDemo } from "@/shared/lib/estado-negocio";

/**
 * Pedidos que salen del catálogo público, para decidir si vale la pena la
 * tienda online (Fase 0 de docs/tienda-online.md).
 *
 * Los HECHOS los cuenta `metricas_pedidos_catalogo()` desde `eventos_uso`
 * (tipo PEDIDO_CATALOGO, uno por "Enviar pedido" que abre WhatsApp). Acá se
 * decide qué cuenta: mismo criterio que `metricas-globales.ts` — cliente es el
 * negocio HABILITADO (activo o en prueba); demo y bajas no entran en los
 * totales.
 *
 * Un pedido del catálogo NO es una venta: es alguien que tocó "Enviar pedido"
 * y abrió WhatsApp. Puede no concretarse, y la dueña probando su propia tienda
 * también cuenta. Por eso se compara contra las ventas del POS como
 * proporción, no como conversión.
 *
 * Puro y sin IO: se testea sin base.
 */

export interface NegocioPedidosCrudo {
  marketing?: Partial<Record<"cupon" | "envio_gratis" | "sugeridos", { pedidos: number; monto: number; con_beneficio: number; monto_beneficio: number }>>;
  id: string;
  nombre: string;
  estado: string;
  rubro: string | null;
  catalogo_activo: boolean;
  pedidos_whatsapp: boolean;
  publicados: number;
  pedidos: number;
  pedidos_7d: number;
  pedidos_30d: number;
  monto_30d: number;
  ultimo_pedido: string | null;
  ventas_30d: number;
}

export interface PedidosCatalogoCrudos {
  medicion_desde: string | null;
  negocios: NegocioPedidosCrudo[];
  por_dia: { dia: string; pedidos: number; monto: number }[];
  por_modalidad: Record<string, number>;
  por_pago: Record<string, number>;
  generado_en: string;
}

export interface FilaPedidosNegocio extends NegocioPedidosCrudo {
  /** Pedidos del catálogo cada 100 ventas del POS en 30 días. null si no
   * vendió en el POS. */
  pedidosCada100Ventas: number | null;
  /** Ticket promedio de los pedidos en 30 días. null sin pedidos. */
  ticketPromedio30d: number | null;
  /** Puede recibir pedidos: catálogo prendido, botón de pedido prendido y al
   * menos un producto publicado. */
  puedeRecibir: boolean;
}

export interface ResumenPedidosCatalogo {
  marketing: { clave: string; etiqueta: string; porcentaje: number; ticketCon: number | null; ticketSin: number | null; cantidad: number }[];
  /** Días desde el primer pedido medido (redondeado hacia arriba). 0 si
   * todavía no hubo ninguno. */
  diasDeMedicion: number;
  medicionDesde: string | null;
  totales: {
    historico: number;
    ultimos7d: number;
    ultimos30d: number;
    monto30d: number;
    ticketPromedio30d: number | null;
    /** Clientes que pueden recibir pedidos (catálogo con productos). */
    negociosQuePuedenRecibir: number;
    /** De esos, cuántos recibieron al menos uno en 30 días. */
    negociosConPedidos30d: number;
  };
  /** Clientes ordenados por pedidos en 30 días, después por históricos. */
  porNegocio: FilaPedidosNegocio[];
  porDia: PedidosCatalogoCrudos["por_dia"];
  porModalidad: { clave: string; etiqueta: string; cantidad: number }[];
  porPago: { clave: string; etiqueta: string; cantidad: number }[];
}

const ETIQUETA_MODALIDAD: Record<string, string> = {
  RETIRO: "Retira en el local",
  ENVIO: "Envío",
  OTRA: "Otra",
};

function ordenarReparto(
  conteo: Record<string, number>,
  etiqueta: (clave: string) => string,
) {
  return Object.entries(conteo)
    .map(([clave, cantidad]) => ({ clave, etiqueta: etiqueta(clave), cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad || a.etiqueta.localeCompare(b.etiqueta));
}

export function resumirPedidosCatalogo(
  crudos: PedidosCatalogoCrudos,
  ahora: Date = new Date(),
): ResumenPedidosCatalogo {
  const clientes = crudos.negocios.filter(
    (n) => !esNegocioDemo(n.estado) && (n.estado === "activo" || n.estado === "prueba"),
  );

  const porNegocio: FilaPedidosNegocio[] = clientes
    .map((n) => ({
      ...n,
      pedidosCada100Ventas:
        n.ventas_30d > 0 ? Math.round((n.pedidos_30d / n.ventas_30d) * 1000) / 10 : null,
      ticketPromedio30d: n.pedidos_30d > 0 ? n.monto_30d / n.pedidos_30d : null,
      puedeRecibir: n.catalogo_activo && n.pedidos_whatsapp && n.publicados > 0,
    }))
    .sort(
      (a, b) =>
        b.pedidos_30d - a.pedidos_30d ||
        b.pedidos - a.pedidos ||
        a.nombre.localeCompare(b.nombre),
    );

  const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const ultimos30d = suma(porNegocio.map((n) => n.pedidos_30d));
  const monto30d = suma(porNegocio.map((n) => n.monto_30d));

  const desde = crudos.medicion_desde ? new Date(crudos.medicion_desde) : null;
  const diasDeMedicion = desde
    ? Math.max(1, Math.ceil((ahora.getTime() - desde.getTime()) / 86_400_000))
    : 0;

  return {
    marketing: ([ ["cupon", "Con cupón"], ["envio_gratis", "Con envío gratis"], ["sugeridos", "Con sugeridos"] ] as const).map(([clave, etiqueta]) => {
      const datos = clientes.map(n => n.marketing?.[clave]).filter(d => d !== undefined);
      const pedidos = suma(datos.map(d => d.pedidos));
      const monto = suma(datos.map(d => d.monto));
      const cantidad = suma(datos.map(d => d.con_beneficio));
      const montoCon = suma(datos.map(d => d.monto_beneficio));
      return { clave, etiqueta, cantidad, porcentaje: pedidos ? Math.round(cantidad / pedidos * 1000) / 10 : 0, ticketCon: cantidad ? montoCon / cantidad : null, ticketSin: pedidos > cantidad ? (monto - montoCon) / (pedidos - cantidad) : null };
    }),
    diasDeMedicion,
    medicionDesde: crudos.medicion_desde,
    totales: {
      historico: suma(porNegocio.map((n) => n.pedidos)),
      ultimos7d: suma(porNegocio.map((n) => n.pedidos_7d)),
      ultimos30d,
      monto30d,
      ticketPromedio30d: ultimos30d > 0 ? monto30d / ultimos30d : null,
      negociosQuePuedenRecibir: porNegocio.filter((n) => n.puedeRecibir).length,
      negociosConPedidos30d: porNegocio.filter((n) => n.pedidos_30d > 0).length,
    },
    porNegocio,
    porDia: crudos.por_dia,
    porModalidad: ordenarReparto(
      crudos.por_modalidad,
      (k) => ETIQUETA_MODALIDAD[k] ?? k,
    ),
    porPago: ordenarReparto(crudos.por_pago, (k) => k),
  };
}
