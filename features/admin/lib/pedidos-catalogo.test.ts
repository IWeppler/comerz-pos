import { describe, expect, it } from "vitest";
import {
  resumirPedidosCatalogo,
  type NegocioPedidosCrudo,
  type PedidosCatalogoCrudos,
} from "./pedidos-catalogo";

const negocio = (extra: Partial<NegocioPedidosCrudo>): NegocioPedidosCrudo => ({
  id: "n",
  nombre: "Local",
  estado: "activo",
  rubro: null,
  catalogo_activo: true,
  pedidos_whatsapp: true,
  publicados: 10,
  pedidos: 0,
  pedidos_7d: 0,
  pedidos_30d: 0,
  monto_30d: 0,
  ultimo_pedido: null,
  ventas_30d: 0,
  ...extra,
});

const crudos = (
  negocios: NegocioPedidosCrudo[],
  extra: Partial<PedidosCatalogoCrudos> = {},
): PedidosCatalogoCrudos => ({
  medicion_desde: null,
  negocios,
  por_dia: [],
  por_modalidad: {},
  por_pago: {},
  generado_en: "2026-10-07T12:00:00Z",
  ...extra,
});

describe("resumirPedidosCatalogo", () => {
  it("compara tickets con beneficio y el resto sin mezclar demos", () => {
    const r = resumirPedidosCatalogo(crudos([
      negocio({ marketing: { cupon: { pedidos: 4, monto: 8000, con_beneficio: 1, monto_beneficio: 5000 } } }),
      negocio({ estado: "demo", marketing: { cupon: { pedidos: 100, monto: 99999, con_beneficio: 100, monto_beneficio: 99999 } } }),
    ]));
    expect(r.marketing[0]).toMatchObject({ porcentaje: 25, cantidad: 1, ticketCon: 5000, ticketSin: 1000 });
    expect(r.marketing[1]).toMatchObject({ cantidad: 0, ticketCon: null, ticketSin: null });
  });
  it("suma solo clientes: demo y bajas quedan afuera", () => {
    const r = resumirPedidosCatalogo(
      crudos([
        negocio({ id: "a", pedidos: 5, pedidos_30d: 3, monto_30d: 30000 }),
        negocio({ id: "b", estado: "prueba", pedidos: 1, pedidos_30d: 1, monto_30d: 10000 }),
        negocio({ id: "c", estado: "demo", pedidos: 50, pedidos_30d: 50 }),
        negocio({ id: "d", estado: "cancelado", pedidos: 9, pedidos_30d: 9 }),
      ]),
    );
    expect(r.porNegocio.map((n) => n.id)).toEqual(["a", "b"]);
    expect(r.totales.historico).toBe(6);
    expect(r.totales.ultimos30d).toBe(4);
    expect(r.totales.monto30d).toBe(40000);
    expect(r.totales.ticketPromedio30d).toBe(10000);
  });

  it("ordena por pedidos de 30 días y después por históricos", () => {
    const r = resumirPedidosCatalogo(
      crudos([
        negocio({ id: "pocos", nombre: "B", pedidos_30d: 1, pedidos: 1 }),
        negocio({ id: "muchos", nombre: "A", pedidos_30d: 7, pedidos: 7 }),
        negocio({ id: "viejos", nombre: "C", pedidos_30d: 1, pedidos: 20 }),
      ]),
    );
    expect(r.porNegocio.map((n) => n.id)).toEqual(["muchos", "viejos", "pocos"]);
  });

  it("compara contra las ventas del POS como pedidos cada 100 ventas", () => {
    const r = resumirPedidosCatalogo(
      crudos([
        negocio({ id: "a", pedidos_30d: 5, ventas_30d: 200 }),
        negocio({ id: "b", pedidos_30d: 2, ventas_30d: 0 }),
      ]),
    );
    expect(r.porNegocio.find((n) => n.id === "a")?.pedidosCada100Ventas).toBe(2.5);
    expect(r.porNegocio.find((n) => n.id === "b")?.pedidosCada100Ventas).toBeNull();
  });

  it("puede recibir pedidos solo con catálogo, botón y productos publicados", () => {
    const r = resumirPedidosCatalogo(
      crudos([
        negocio({ id: "ok" }),
        negocio({ id: "sin-productos", publicados: 0 }),
        negocio({ id: "catalogo-apagado", catalogo_activo: false }),
        negocio({ id: "sin-boton", pedidos_whatsapp: false }),
      ]),
    );
    expect(r.totales.negociosQuePuedenRecibir).toBe(1);
  });

  it("días de medición: desde el primer pedido; 0 si no hubo ninguno", () => {
    const ahora = new Date("2026-10-17T12:00:00Z");
    expect(resumirPedidosCatalogo(crudos([]), ahora).diasDeMedicion).toBe(0);
    expect(
      resumirPedidosCatalogo(
        crudos([], { medicion_desde: "2026-10-07T15:00:00Z" }),
        ahora,
      ).diasDeMedicion,
    ).toBe(10);
  });

  it("repartos de modalidad y pago, de mayor a menor", () => {
    const r = resumirPedidosCatalogo(
      crudos([], {
        por_modalidad: { RETIRO: 2, ENVIO: 5 },
        por_pago: { Efectivo: 1, Transferencia: 4 },
      }),
    );
    expect(r.porModalidad).toEqual([
      { clave: "ENVIO", etiqueta: "Envío", cantidad: 5 },
      { clave: "RETIRO", etiqueta: "Retira en el local", cantidad: 2 },
    ]);
    expect(r.porPago[0]).toEqual({ clave: "Transferencia", etiqueta: "Transferencia", cantidad: 4 });
  });
});
