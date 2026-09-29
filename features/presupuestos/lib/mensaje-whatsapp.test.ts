import { describe, expect, it } from "vitest";
import { fechaCorta, mensajeWhatsappPresupuesto } from "./mensaje-whatsapp";

const base = {
  numero: 7,
  cliente_nombre: "Juan Perez",
  total: 8900,
  vigencia_hasta: "2026-10-06",
  modalidad_entrega: "AL_INICIO",
  tasas_financiacion: [] as unknown,
  frecuencia: "MENSUAL",
  nota: null as string | null,
  items: [
    { descripcion: "Agua Mineral 500ml", variante: "Única", unidad_medida: "UNIDAD", cantidad: 2, precio_unitario: 1500 },
    { descripcion: "Aceitunas Verdes", variante: null, unidad_medida: "KG", cantidad: 0.5, precio_unitario: 9800 },
  ],
};

describe("mensajeWhatsappPresupuesto", () => {
  it("lista los renglones con su subtotal, el total y la vigencia", () => {
    const m = mensajeWhatsappPresupuesto(base, "Kiosco Demo");
    expect(m).toContain("Cotización #0007");
    expect(m).toContain("Para: Juan Perez");
    expect(m).toContain("Agua Mineral 500ml (Única)");
    expect(m).toContain("0,5 kg × Aceitunas Verdes");
    expect(m).toMatch(/Total: \$\s?8\.900,00/);
    expect(m).toContain("válidos hasta el 06/10/2026");
    expect(m).not.toContain("cuotas");
  });

  it("muestra las cuotas con las tasas congeladas de la cotización", () => {
    const m = mensajeWhatsappPresupuesto(
      { ...base, total: 10_000, tasas_financiacion: [{ cuotas: 3, pct: 0 }] },
      "Kiosco Demo",
    );
    expect(m).toMatch(/3 cuotas mensuales de \$\s?3\.333,33 \(la última \$\s?3\.333,34\)/);
  });
});

describe("fechaCorta", () => {
  it("no corre el día por la zona horaria", () => {
    expect(fechaCorta("2026-10-06")).toBe("06/10/2026");
  });
});
