import { describe, it, expect } from "vitest";
import {
  construirMensajeDeuda,
  PLANTILLA_DEUDA_EJEMPLO,
  variablesDesconocidas,
} from "./mensaje-deuda";

const base = {
  nombreCliente: "María Fernanda López",
  saldo: 50000,
  montoRecargo: 0,
  saldoConRecargo: 50000,
  fechaVencimiento: null,
  diasVencido: null,
};

describe("construirMensajeDeuda", () => {
  it("saluda por el primer nombre", () => {
    expect(construirMensajeDeuda(base)).toContain("Hola María");
    expect(construirMensajeDeuda(base)).not.toContain("Hola María Fernanda");
  });

  it("el total es el saldo cuando no hay recargo", () => {
    expect(construirMensajeDeuda(base)).toContain("Total a pagar");
    expect(construirMensajeDeuda(base)).toContain("50.000");
  });

  it("con recargo por mora desglosa y el total es el que se va a cobrar", () => {
    // Mandar el saldo pelado y después cobrar más es la forma más rápida de
    // tener una discusión en el mostrador.
    const m = construirMensajeDeuda({
      ...base,
      montoRecargo: 7500,
      saldoConRecargo: 57500,
      diasVencido: 12,
    });

    expect(m).toContain("Recargo por mora");
    expect(m).toContain("57.500");
    expect(m).toContain("Venció hace 12 días");
  });

  it("el detalle va como LINK, no como lista de movimientos", () => {
    const m = construirMensajeDeuda({
      ...base,
      urlResumen: "https://comerz.app/r/8dbfef9fda5843448dd05d6e8e04b8d5",
    });
    expect(m).toContain("Ver el detalle: https://comerz.app/r/8dbfef");
  });

  it("sin link el mensaje sale igual, solo que sin detalle", () => {
    const m = construirMensajeDeuda(base);
    expect(m).not.toContain("Ver el detalle");
    expect(m).toContain("Total a pagar");
  });

  it("es corto: un recordatorio largo no se lee", () => {
    const m = construirMensajeDeuda({ ...base, urlResumen: "https://x.co/r/a" });
    const lineasConTexto = m.split("\n").filter((l) => l.trim());
    expect(lineasConTexto.length).toBeLessThanOrEqual(7);
  });

  it("nombra al comercio cuando se lo pasan", () => {
    const m = construirMensajeDeuda({ ...base, nombreComercio: "Evens" });
    expect(m).toContain("de Evens");
  });

  it("plantilla vacía o null usa el mensaje por defecto", () => {
    expect(construirMensajeDeuda(base, null)).toBe(construirMensajeDeuda(base));
    expect(construirMensajeDeuda(base, "   \n ")).toBe(
      construirMensajeDeuda(base),
    );
  });
});

// Intl separa el $ con un espacio duro; acá se compara contra texto legible.
const msj = (...args: Parameters<typeof construirMensajeDeuda>) =>
  construirMensajeDeuda(...args).replace(/ /g, " ");

describe("plantilla del comercio", () => {
  it("reemplaza las variables", () => {
    const m = msj(
      { ...base, nombreComercio: "Evens" },
      "Hola {nombre} ({nombre_completo}), soy de {comercio}. Debés {total}.",
    );
    expect(m).toBe(
      "Hola María (María Fernanda López), soy de Evens. Debés $ 50.000.",
    );
  });

  it("{total} es lo que se va a cobrar: incluye el recargo por mora", () => {
    const m = msj(
      { ...base, montoRecargo: 7500, saldoConRecargo: 57500 },
      "Total {total} / saldo {saldo} / recargo {recargo}",
    );
    expect(m).toContain("Total $ 57.500");
    expect(m).toContain("saldo $ 50.000");
    expect(m).toContain("recargo $ 7.500");
  });

  it("{desglose} desglosa el recargo igual que el default", () => {
    const m = msj(
      { ...base, montoRecargo: 7500, saldoConRecargo: 57500 },
      "{desglose}",
    );
    expect(m).toBe(
      "Saldo: $ 50.000\nRecargo por mora: $ 7.500\n*Total a pagar: $ 57.500*",
    );
  });

  it("la línea que usa un dato que no hay no se manda", () => {
    const m = msj(
      base,
      "Hola {nombre}\n\n{vencimiento}\n\nVer el detalle: {link}\n\nGracias",
    );
    expect(m).toBe("Hola María\n\nGracias");
  });

  it("con los datos, esas líneas sí salen", () => {
    const m = msj(
      { ...base, diasVencido: 1, urlResumen: "https://x.co/r/a" },
      "{vencimiento}\nVer el detalle: {link}",
    );
    expect(m).toBe("Venció hace 1 día.\nVer el detalle: https://x.co/r/a");
  });

  it("las variables no distinguen mayúsculas", () => {
    expect(msj(base, "{NOMBRE} {Total}")).toBe(
      "María $ 50.000",
    );
  });

  it("una variable desconocida queda literal (no se borra texto en silencio)", () => {
    expect(msj(base, "Debés {totla}")).toBe("Debés {totla}");
  });

  it("la plantilla de ejemplo dice lo mismo que el default", () => {
    const datos = {
      ...base,
      nombreComercio: "Evens",
      montoRecargo: 7500,
      saldoConRecargo: 57500,
      diasVencido: 3,
      urlResumen: "https://x.co/r/a",
    };
    expect(msj(datos, PLANTILLA_DEUDA_EJEMPLO)).toBe(
      msj(datos),
    );
  });
});

describe("variablesDesconocidas", () => {
  it("lista las que no existen, sin repetir", () => {
    expect(
      variablesDesconocidas("{nombre} {totla} {totla} {link} {fecha}"),
    ).toEqual(["totla", "fecha"]);
  });

  it("vacío si todas son conocidas", () => {
    expect(variablesDesconocidas(PLANTILLA_DEUDA_EJEMPLO)).toEqual([]);
  });
});
