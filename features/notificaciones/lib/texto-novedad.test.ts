import { describe, it, expect } from "vitest";
import { parsearNovedad, tramosDe } from "./texto-novedad";

describe("tramosDe", () => {
  it("separa las negritas", () => {
    expect(tramosDe("Ahora **podés** vender **online**.")).toEqual([
      { texto: "Ahora ", negrita: false },
      { texto: "podés", negrita: true },
      { texto: " vender ", negrita: false },
      { texto: "online", negrita: true },
      { texto: ".", negrita: false },
    ]);
  });

  it("un ** sin cerrar queda como texto", () => {
    expect(tramosDe("2 ** 3 es potencia")).toEqual([{ texto: "2 ** 3 es potencia", negrita: false }]);
  });

  it("**** vacío no deja una negrita vacía", () => {
    expect(tramosDe("a****b")).toEqual([{ texto: "ab", negrita: false }]);
  });

  it("el HTML queda como texto (lo escapa React al dibujar)", () => {
    expect(tramosDe("<script>x</script>")).toEqual([{ texto: "<script>x</script>", negrita: false }]);
  });
});

describe("parsearNovedad", () => {
  it("párrafos y listas", () => {
    const bloques = parsearNovedad("Llegó la **campana**.\nTe avisa de:\n\n- Agotados\n- Ventas online\n\nListo.");
    expect(bloques).toEqual([
      {
        tipo: "parrafo",
        tramos: [
          { texto: "Llegó la ", negrita: false },
          { texto: "campana", negrita: true },
          { texto: ". Te avisa de:", negrita: false },
        ],
      },
      {
        tipo: "lista",
        items: [[{ texto: "Agotados", negrita: false }], [{ texto: "Ventas online", negrita: false }]],
      },
      { tipo: "parrafo", tramos: [{ texto: "Listo.", negrita: false }] },
    ]);
  });

  it("una lista pegada a un párrafo igual es lista; acepta • y CRLF", () => {
    const bloques = parsearNovedad("Mejoras:\r\n• Más rápido\r\n• Más **claro**");
    expect(bloques[0].tipo).toBe("parrafo");
    expect(bloques[1]).toEqual({
      tipo: "lista",
      items: [
        [{ texto: "Más rápido", negrita: false }],
        [
          { texto: "Más ", negrita: false },
          { texto: "claro", negrita: true },
        ],
      ],
    });
  });

  it("vacío: sin bloques", () => {
    expect(parsearNovedad("  \n\n ")).toEqual([]);
  });
});
