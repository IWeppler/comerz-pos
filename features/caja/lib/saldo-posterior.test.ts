import { describe, expect, it } from "vitest";
import { conSaldoPosterior } from "./saldo-posterior";

const CAJA = "caja";
const MP = "mp";

describe("conSaldoPosterior", () => {
  it("acumula por cuenta, en orden de fecha e id", () => {
    const filas = conSaldoPosterior([
      { id: 3, fecha: "2026-09-03T10:00:00Z", cuenta_id: CAJA, importe: -200 },
      { id: 1, fecha: "2026-09-01T10:00:00Z", cuenta_id: CAJA, importe: 1000 },
      { id: 2, fecha: "2026-09-02T10:00:00Z", cuenta_id: MP, importe: "500" },
    ]);
    expect(filas.map((f) => [f.id, f.saldo_posterior])).toEqual([
      [1, 1000],
      [2, 500],
      [3, 800],
    ]);
  });

  it("dos movimientos con la misma fecha se ordenan por id", () => {
    const filas = conSaldoPosterior([
      { id: 9, fecha: "2026-09-01T10:00:00Z", cuenta_id: CAJA, importe: -100 },
      { id: 8, fecha: "2026-09-01T10:00:00Z", cuenta_id: CAJA, importe: 300 },
    ]);
    expect(filas.map((f) => [f.id, f.saldo_posterior])).toEqual([
      [8, 300],
      [9, 200],
    ]);
  });

  it("una corrección fechada en el pasado corre el saldo de todo lo posterior", () => {
    // La reversa de un gasto de julio se REGISTRÓ en septiembre pero lleva la
    // fecha de julio (20260921180000): el saldo de agosto la tiene que ver.
    const filas = conSaldoPosterior([
      { id: 1, fecha: "2026-07-10T10:00:00Z", cuenta_id: CAJA, importe: -1000 },
      { id: 2, fecha: "2026-08-10T10:00:00Z", cuenta_id: CAJA, importe: 5000 },
      { id: 3, fecha: "2026-07-10T10:00:00Z", cuenta_id: CAJA, importe: 1000 },
    ]);
    const agosto = filas.find((f) => f.id === 2);
    expect(agosto?.saldo_posterior).toBe(5000);
  });

  it("una transferencia deja cada cuenta con su propia mitad", () => {
    const filas = conSaldoPosterior([
      { id: 1, fecha: "2026-09-01T10:00:00Z", cuenta_id: CAJA, importe: 10000 },
      { id: 2, fecha: "2026-09-02T10:00:00Z", cuenta_id: CAJA, importe: -4000 },
      { id: 3, fecha: "2026-09-02T10:00:00Z", cuenta_id: MP, importe: 4000 },
    ]);
    expect(filas.find((f) => f.id === 2)?.saldo_posterior).toBe(6000);
    expect(filas.find((f) => f.id === 3)?.saldo_posterior).toBe(4000);
  });

  it("no muta la lista que recibe", () => {
    const entrada = [
      { id: 2, fecha: "2026-09-02T10:00:00Z", cuenta_id: CAJA, importe: 1 },
      { id: 1, fecha: "2026-09-01T10:00:00Z", cuenta_id: CAJA, importe: 1 },
    ];
    conSaldoPosterior(entrada);
    expect(entrada.map((e) => e.id)).toEqual([2, 1]);
  });
});
