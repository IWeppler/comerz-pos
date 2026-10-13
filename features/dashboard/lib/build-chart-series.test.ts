import { describe, it, expect } from 'vitest';
import {
  construirSerie,
  construirSerieComparada,
  type Granularidad,
} from './build-chart-series';
import type { Venta } from '@/entities/ventas/types';

const MIERCOLES = new Date(2026, 6, 22, 15, 0, 0); // miércoles 2026-07-22

function venta(
  fecha: string,
  total: number,
  costo: number,
  cantidad: number,
): Venta {
  return {
    id: crypto.randomUUID(),
    total,
    precio_costo: costo,
    cantidad,
    fecha_venta: fecha,
  } as Venta;
}

/** Rango explícito: construirSerie recibe un rango, no un período del panel
 * — el chart dejó de seguir al selector. */
function rango(inicio: Date, fin: Date) {
  return { inicio, fin };
}

function serieDe(inicio: Date, fin: Date, gran: Granularidad, ventas: Venta[]) {
  return construirSerie(ventas, rango(inicio, fin), gran, MIERCOLES);
}

describe('construirSerie', () => {
  it('un punto por día del rango, recortado en ahora', () => {
    const serie = serieDe(new Date(2026, 6, 20), new Date(2026, 6, 26, 23, 59), 'dia', []);
    // El rango llega al 26 pero ahora es el 22: no se grafican días futuros.
    expect(serie).toHaveLength(3);
    expect(serie[0].etiqueta).toBe('20/07');
    expect(serie[2].etiqueta).toBe('22/07');
  });

  it('rango largo por día: un punto por cada uno', () => {
    const serie = serieDe(new Date(2026, 6, 1), new Date(2026, 6, 22, 23, 59), 'dia', []);
    expect(serie).toHaveLength(22);
    expect(serie[0].etiqueta).toBe('01/07');
    expect(serie[21].etiqueta).toBe('22/07');
  });

  it('granularidad mes: un punto por mes', () => {
    const serie = serieDe(new Date(2026, 0, 1), new Date(2026, 6, 22, 23, 59), 'mes', []);
    expect(serie).toHaveLength(7); // ene…jul
    expect(serie[0].etiqueta).toBe('ene');
    expect(serie[6].etiqueta).toBe('jul');
  });

  it('hoy: un punto por hora transcurrida, sin las horas que todavía no pasaron', () => {
    const serie = serieDe(new Date(2026, 6, 22), new Date(2026, 6, 22, 23, 59), 'hora', []);
    expect(serie).toHaveLength(16); // 00h…15h, no 24
    expect(serie[0].etiqueta).toBe('00h');
    expect(serie[15].etiqueta).toBe('15h');
  });

  it('buckets sin ventas quedan en 0, no se saltean', () => {
    const serie = serieDe(new Date(2026, 6, 20), new Date(2026, 6, 22, 23, 59), 'dia', []);
    expect(
      serie.every((p) => p.ingresos === 0 && p.unidades === 0 && p.ganancia === 0),
    ).toBe(true);
  });

  it('acumula ingresos/unidades/ganancia en el bucket correcto', () => {
    const serie = serieDe(new Date(2026, 6, 20), new Date(2026, 6, 22, 23, 59), 'dia', [
      venta('2026-07-22T10:00:00', 1000, 400, 2),
      venta('2026-07-22T14:00:00', 500, 200, 1),
      venta('2026-07-21T10:00:00', 300, 100, 1),
    ]);

    expect(serie[2].ingresos).toBe(1500);
    expect(serie[2].ganancia).toBe(900);
    expect(serie[2].unidades).toBe(3);
    expect(serie[1].ingresos).toBe(300);
  });

  it('ignora ventas fuera del rango', () => {
    const serie = serieDe(new Date(2026, 6, 20), new Date(2026, 6, 22, 23, 59), 'dia', [
      venta('2026-06-01T10:00:00', 999, 0, 5),
    ]);
    expect(serie.reduce((acc, p) => acc + p.ingresos, 0)).toBe(0);
  });
});

describe("construirSerie por semana", () => {
  it("bloques de 7 días desde el inicio del rango, no semanas de calendario", () => {
    // Arranca un jueves: cada barra va de jueves a miércoles.
    const serie = serieDe(new Date(2026, 6, 2), new Date(2026, 6, 22, 23, 59), "semana", [
      venta("2026-07-08T10:00:00", 100, 0, 1), // miércoles: primera semana
      venta("2026-07-09T10:00:00", 200, 0, 1), // jueves: segunda
      venta("2026-07-22T10:00:00", 400, 0, 1), // tercera
    ]);
    expect(serie).toHaveLength(3);
    expect(serie[0].etiquetaCompleta).toBe("Semana del 02/07 al 08/07");
    expect(serie.map((p) => p.ingresos)).toEqual([100, 200, 400]);
    expect(serie.map((p) => p.tickets)).toEqual([1, 1, 1]);
  });
});

describe("construirSerieComparada", () => {
  it("sigue al selector: semana = 7 días, trimestre = 13 semanas, año = 52", () => {
    expect(construirSerieComparada([], "semana", MIERCOLES)).toHaveLength(7);
    expect(construirSerieComparada([], "mes", MIERCOLES)).toHaveLength(28);
    expect(construirSerieComparada([], "trimestre", MIERCOLES)).toHaveLength(13);
    expect(construirSerieComparada([], "anio", MIERCOLES)).toHaveLength(12);
    expect(construirSerieComparada([], "hoy", MIERCOLES)).toHaveLength(16);
  });

  it("la suma de las barras es la facturación del período", () => {
    const ventas = [
      venta("2026-07-16T10:00:00", 1000, 400, 2),
      venta("2026-07-22T09:00:00", 500, 100, 1),
      venta("2026-07-10T09:00:00", 999, 0, 1), // fuera de los últimos 7 días
    ];
    const serie = construirSerieComparada(ventas, "semana", MIERCOLES);
    expect(serie.reduce((acc, p) => acc + p.ingresos, 0)).toBe(1500);
    expect(serie[serie.length - 1].enCurso).toBe(true);
    expect(serie[0].enCurso).toBe(false);
  });

  it("aparea cada tramo con el mismo día de la semana del período anterior", () => {
    const ventas = [
      venta("2026-07-22T10:00:00", 500, 0, 1), // miércoles actual
      venta("2026-07-15T10:00:00", 300, 0, 1), // miércoles anterior
    ];
    const serie = construirSerieComparada(ventas, "semana", MIERCOLES);
    const ultimo = serie[serie.length - 1];
    expect(ultimo.ingresos).toBe(500);
    expect(ultimo.ingresosAnterior).toBe(300);
  });

  it("año: 12 meses enteros, el primero desde el día 1, contra los del año anterior", () => {
    const ventas = [
      venta("2025-08-01T10:00:00", 100, 0, 1), // primer mes del gráfico (ago 2025), día 1
      venta("2025-07-31T10:00:00", 999, 0, 1), // afuera
      venta("2024-08-15T10:00:00", 50, 0, 1), // mismo mes del año anterior
    ];
    const serie = construirSerieComparada(ventas, "anio", MIERCOLES);
    expect(serie[0].etiqueta).toBe("ago");
    expect(serie[11].etiqueta).toBe("jul");
    expect(serie[0].ingresos).toBe(100);
    expect(serie[0].ingresosAnterior).toBe(50);
  });

  it("sin ventas en el período anterior no hay comparación (null, no ceros)", () => {
    const serie = construirSerieComparada([venta("2026-07-22T10:00:00", 500, 0, 1)], "semana", MIERCOLES);
    expect(serie.every((p) => p.ingresosAnterior === null)).toBe(true);
  });
});
