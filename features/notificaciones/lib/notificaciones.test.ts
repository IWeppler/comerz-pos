import { describe, it, expect } from "vitest";
import { etiquetaContador, normalizarNotificaciones, tiempoRelativo } from "./notificaciones";

describe("normalizarNotificaciones", () => {
  it("convierte la respuesta de la RPC y cuenta las no leídas", () => {
    const r = normalizarNotificaciones({
      tu_negocio: [
        { clave: "stock_agotado:2026-10-13", tipo: "STOCK_AGOTADO", categoria: "STOCK", titulo: "Sin stock", detalle: "Remera se quedó sin stock", href: "/stock", fecha: "2026-10-13T12:00:00Z", leida: false },
        { clave: "x:1", tipo: "ORDEN_PAGADA", categoria: "TIENDA", titulo: "Orden pagada", detalle: null, href: null, fecha: "2026-10-12T12:00:00Z", leida: true },
      ],
      sin_leer: 1,
    });
    expect(r.tuNegocio).toHaveLength(2);
    expect(r.sinLeer).toBe(1);
    expect(r.tuNegocio[0].href).toBe("/stock");
  });

  it("descarta filas sin forma y anula links que no son internos", () => {
    const r = normalizarNotificaciones({
      tu_negocio: [
        { titulo: "sin clave", fecha: "2026-10-13T12:00:00Z" },
        { clave: "a:1", titulo: "Ok", fecha: "2026-10-13T12:00:00Z", href: "//evil.com", categoria: "RARA" },
      ],
    });
    expect(r.tuNegocio).toHaveLength(1);
    expect(r.tuNegocio[0].href).toBeNull();
    expect(r.tuNegocio[0].categoria).toBe("PLATA");
  });

  it("null o basura: lista vacía, no explota", () => {
    expect(normalizarNotificaciones(null)).toEqual({ tuNegocio: [], novedades: [], sinLeer: 0 });
    expect(normalizarNotificaciones("x")).toEqual({ tuNegocio: [], novedades: [], sinLeer: 0 });
  });

  it("novedades: se suman al contador; un ícono desconocido cae en sparkles", () => {
    const r = normalizarNotificaciones({
      tu_negocio: [],
      novedades: [
        { clave: "novedad:1", icono: "rocket", titulo: "Llegó", cuerpo: "**Hola**", fecha: "2026-10-13T12:00:00Z", leida: false },
        { clave: "novedad:2", icono: "bomba", titulo: "Vieja", cuerpo: "", fecha: "2026-10-01T12:00:00Z", leida: true },
      ],
    });
    expect(r.novedades.map((n) => n.icono)).toEqual(["rocket", "sparkles"]);
    expect(r.sinLeer).toBe(1);
  });
});

describe("tiempoRelativo", () => {
  const ahora = new Date(2026, 9, 13, 12, 0, 0);
  const antes = (ms: number) => new Date(ahora.getTime() - ms).toISOString();

  it("minutos, horas, ayer y fecha", () => {
    expect(tiempoRelativo(antes(20_000), ahora)).toBe("Recién");
    expect(tiempoRelativo(antes(5 * 60_000), ahora)).toBe("Hace 5 min");
    expect(tiempoRelativo(antes(3 * 3_600_000), ahora)).toBe("Hace 3 h");
    expect(tiempoRelativo(antes(30 * 3_600_000), ahora)).toBe("Ayer");
    expect(tiempoRelativo(new Date(2026, 9, 1, 9, 0).toISOString(), ahora)).toBe("01/10");
  });
});

describe("etiquetaContador", () => {
  it("nada con cero, 9+ pasado nueve", () => {
    expect(etiquetaContador(0)).toBeNull();
    expect(etiquetaContador(3)).toBe("3");
    expect(etiquetaContador(12)).toBe("9+");
  });
});
