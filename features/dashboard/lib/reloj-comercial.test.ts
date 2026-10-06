import { describe, expect, it } from "vitest";
import {
  aRelojComercial,
  conFechasComerciales,
  desfaseRelojComercial,
} from "./reloj-comercial";

// Los tests no dependen del huso de la máquina: el desfase se calcula con el
// getTimezoneOffset de la referencia y se verifica el resultado en hora local.
function desfase(referencia: Date) {
  return desfaseRelojComercial(referencia);
}

describe("reloj comercial", () => {
  it("una venta a las 22:30 de Buenos Aires cae en ESE día, no en el siguiente", () => {
    // 22:30 ART del 6/10 = 01:30 UTC del 7/10
    const instante = new Date("2026-10-07T01:30:00Z");
    const local = aRelojComercial(instante, desfase(instante));
    expect(local.getDate()).toBe(6);
    expect(local.getHours()).toBe(22);
    expect(local.getMinutes()).toBe(30);
  });

  it("la medianoche argentina es la frontera del día", () => {
    const antes = new Date("2026-10-07T02:59:00Z"); // 23:59 ART del 6
    const despues = new Date("2026-10-07T03:00:00Z"); // 00:00 ART del 7
    expect(aRelojComercial(antes, desfase(antes)).getDate()).toBe(6);
    expect(aRelojComercial(despues, desfase(despues)).getDate()).toBe(7);
  });

  it("corre solo los campos pedidos, deja los demás y los vacíos", () => {
    const ref = new Date("2026-10-07T01:30:00Z");
    const [fila] = conFechasComerciales(
      [{ id: "a", fecha_venta: "2026-10-07T01:30:00Z", otra: "2026-10-07T01:30:00Z", vacia: "" }],
      ["fecha_venta", "vacia"],
      desfase(ref),
    );
    expect(new Date(fila.fecha_venta).getDate()).toBe(6);
    expect(fila.otra).toBe("2026-10-07T01:30:00Z");
    expect(fila.vacia).toBe("");
  });
});
