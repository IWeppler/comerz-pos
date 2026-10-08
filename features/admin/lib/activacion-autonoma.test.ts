import { expect, it } from "vitest";
import {
  horasHastaHito,
  comerciosAutonomos,
  type FechasActivacion,
} from "./activacion-autonoma";
it("conserva minutos, no redondea el TTFS a días", () => {
  expect(horasHastaHito("2026-10-08T12:00:00Z", "2026-10-08T12:12:00Z")).toBe(
    0.2,
  );
  expect(horasHastaHito("2026-10-08T12:00:00Z", null)).toBeNull();
  expect(
    horasHastaHito("2026-10-08T12:00:00Z", "2026-10-07T12:00:00Z"),
  ).toBeNull();
});
it("excluye demo y migrados del seguimiento", () => {
  const f: FechasActivacion = {
    id: "a",
    nombre: "Nuevo",
    estado: "prueba",
    alta: "2026-10-08",
    productos: null,
    caja: null,
    primera_venta: null,
    pos_abierto: null,
    camino: null,
    camino_elegido: null,
  };
  expect(
    comerciosAutonomos([
      f,
      { ...f, id: "demo", estado: "demo" },
      { ...f, id: "migrado", primera_venta: "2026-10-01" },
    ]).map((c) => c.id),
  ).toEqual(["a"]);
});
