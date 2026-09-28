import { describe, expect, it } from "vitest";
import { contarPendientes, filtrarAlertas, type AlertaCaja } from "./alerta-caja";

const alerta = (clave: string, severidad: AlertaCaja["severidad"], revisada = false): AlertaCaja => ({
  clave,
  tipo: clave.split(":")[0],
  severidad,
  fecha: "2026-09-26T23:23:00Z",
  titulo: clave,
  detalle: "",
  monto: null,
  turno_id: null,
  revisada,
  revisada_por: null,
  revisada_en: null,
  nota: null,
});

const alertas = [
  alerta("FONDO_COPIADO:1", "ALTA"),
  alerta("DIFERENCIA_ARQUEO:2", "MEDIA"),
  alerta("SALIDA_CAJA_GRANDE:3", "BAJA"),
  alerta("DIFERENCIA_ARQUEO:4", "ALTA", true),
];

describe("filtrarAlertas", () => {
  it("pendientes, revisadas y todas", () => {
    expect(filtrarAlertas(alertas, "pendientes", []).map((a) => a.clave)).toHaveLength(3);
    expect(filtrarAlertas(alertas, "revisadas", []).map((a) => a.clave)).toEqual(["DIFERENCIA_ARQUEO:4"]);
    expect(filtrarAlertas(alertas, "todas", [])).toHaveLength(4);
  });

  it("por severidad", () => {
    expect(filtrarAlertas(alertas, "todas", ["ALTA"]).map((a) => a.clave)).toEqual([
      "FONDO_COPIADO:1",
      "DIFERENCIA_ARQUEO:4",
    ]);
  });
});

describe("contarPendientes", () => {
  it("cuenta urgentes y para revisar sin revisar; lo de solo saber no avisa", () => {
    expect(contarPendientes(alertas)).toBe(2);
  });
});
