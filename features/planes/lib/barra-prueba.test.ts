import { describe, expect, it } from "vitest";
import {
  calcularProgresoActivacion,
  type EstadoActivacion,
} from "@/features/onboarding/lib/pasos-activacion";
import {
  construirBarraPrueba,
  diasCalendario,
  HREF_PLANES,
} from "./barra-prueba";

const SIN_NADA: EstadoActivacion = {
  rubro: "indumentaria",
  metodos_pago: true,
  marca: false,
  productos: false,
  stock_y_precios: false,
  empleados: false,
  catalogo_publicado: false,
  caja: false,
  primera_venta: false,
  venta_libre_elegida: false,
};

// Prueba de 14 días: arrancó el 1/10 a las 10 (hora argentina), vence el 15/10.
const INICIO = "2026-10-01T13:00:00Z";
const VENCE = "2026-10-15T13:00:00Z";
const el = (iso: string) => new Date(iso);

const base = {
  inicio: INICIO,
  vencimiento: VENCE,
  activacion: calcularProgresoActivacion(SIN_NADA),
  ventas: 0,
  planSolicitado: null,
};

describe("diasCalendario", () => {
  it("cuenta días argentinos, no horas UTC", () => {
    // 22:30 del 5/10 en Buenos Aires ya es 6/10 en UTC: siguen siendo 10 días.
    expect(diasCalendario(el("2026-10-06T01:30:00Z"), VENCE)).toBe(10);
    expect(diasCalendario(el("2026-10-05T12:00:00Z"), VENCE)).toBe(10);
  });

  it("el mismo día da 0 y un día después del vencimiento, -1", () => {
    expect(diasCalendario(el("2026-10-15T23:00:00Z"), VENCE)).toBe(0);
    expect(diasCalendario(el("2026-10-16T15:00:00Z"), VENCE)).toBe(-1);
  });
});

describe("construirBarraPrueba", () => {
  it("sin ventas, nombra el próximo paso de la guía", () => {
    const barra = construirBarraPrueba({ ...base, ahora: el("2026-10-04T15:00:00Z") });
    expect(barra.titulo).toBe("Te quedan 11 días de prueba");
    expect(barra.detalle).toBe("Prepará tus productos");
    expect(barra.cta).toEqual({ etiqueta: "Elegir cómo empezar", href: "/?empezar=1" });
    expect(barra.tono).toBe("neutral");
    expect(barra.porcentajeRestante).toBe(79);
  });

  it("el paso de abrir caja manda a la guía, no a /caja", () => {
    const barra = construirBarraPrueba({
      ...base,
      ahora: el("2026-10-04T15:00:00Z"),
      activacion: calcularProgresoActivacion({
        ...SIN_NADA,
        marca: true,
        productos: true,
        stock_y_precios: true,
      }),
    });
    expect(barra.detalle).toBe("Abrí la caja");
    expect(barra.cta).toEqual({ etiqueta: "Ver guía", href: "/" });
  });

  it("con ventas, muestra lo que ya hizo", () => {
    const barra = construirBarraPrueba({
      ...base,
      ahora: el("2026-10-08T15:00:00Z"),
      activacion: calcularProgresoActivacion({ ...SIN_NADA, primera_venta: true }),
      ventas: 23,
    });
    expect(barra.titulo).toBe("Te quedan 7 días de prueba");
    expect(barra.detalle).toBe("Ya hiciste 23 ventas con Comerz");
    // Queda la guía por la mitad: el CTA sigue siendo el próximo paso.
    expect(barra.cta?.etiqueta).toBe("Elegir cómo empezar");
  });

  it("con todo hecho, el CTA son los planes", () => {
    const todo: EstadoActivacion = {
      ...SIN_NADA,
      marca: true,
      productos: true,
      stock_y_precios: true,
      empleados: true,
      catalogo_publicado: true,
      caja: true,
      primera_venta: true,
    };
    const barra = construirBarraPrueba({
      ...base,
      ahora: el("2026-10-08T15:00:00Z"),
      activacion: calcularProgresoActivacion(todo),
      ventas: 1,
    });
    expect(barra.detalle).toBe("Ya hiciste 1 venta con Comerz");
    expect(barra.cta).toEqual({ etiqueta: "Ver planes", href: HREF_PLANES });
  });

  it("a 3 días o menos pasa a pedir un plan", () => {
    const barra = construirBarraPrueba({ ...base, ahora: el("2026-10-13T15:00:00Z") });
    expect(barra.titulo).toBe("Tu prueba termina en 2 días");
    expect(barra.cta).toEqual({ etiqueta: "Elegir plan", href: HREF_PLANES });
    expect(barra.tono).toBe("aviso");
  });

  it("dice mañana y hoy", () => {
    expect(
      construirBarraPrueba({ ...base, ahora: el("2026-10-14T15:00:00Z") }).titulo,
    ).toBe("Tu prueba termina mañana");
    expect(
      construirBarraPrueba({ ...base, ahora: el("2026-10-15T20:00:00Z") }).titulo,
    ).toBe("Tu prueba termina hoy");
  });

  it("vencida: error y sin barra", () => {
    const barra = construirBarraPrueba({ ...base, ahora: el("2026-10-20T15:00:00Z") });
    expect(barra.titulo).toBe("Tu prueba terminó");
    expect(barra.tono).toBe("error");
    expect(barra.porcentajeRestante).toBeNull();
  });

  it("si ya pidió un plan, no lo apura aunque esté vencida", () => {
    const barra = construirBarraPrueba({
      ...base,
      ahora: el("2026-10-20T15:00:00Z"),
      planSolicitado: "Gestión",
    });
    expect(barra.titulo).toBe("Pediste el plan Gestión");
    expect(barra.tono).toBe("exito");
  });

  it("sin datos de activación cae a los días y los planes", () => {
    const barra = construirBarraPrueba({
      ...base,
      ahora: el("2026-10-04T15:00:00Z"),
      activacion: null,
      ventas: null,
    });
    expect(barra.detalle).toBe("Aprovechalos para probar todo");
    expect(barra.cta?.href).toBe(HREF_PLANES);
  });
});
