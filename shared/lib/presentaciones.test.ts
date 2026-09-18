import { describe, expect, it } from "vitest";
import {
  cantidadBase,
  costoBaseDePresentacion,
  normalizarCantidadEnForma,
  precioDePresentacion,
  presentacionDefault,
  presentacionesDeVariante,
  presentacionesDisponibles,
  validarPresentaciones,
  type Presentacion,
  type PresentacionInput,
} from "./presentaciones";

const balde: Presentacion = {
  id: "balde",
  variante_id: null,
  nombre: "Balde 4,7 kg",
  factor: 4.7,
  regla_precio: "FIJO",
  precio: 45000,
  sku: null,
  es_default: false,
  activa: true,
};

const packx10: Presentacion = {
  id: "x10",
  variante_id: null,
  nombre: "Pack x10",
  factor: 10,
  regla_precio: "FIJO",
  precio: 9000,
  sku: "7790000000010",
  es_default: true,
  activa: true,
};

function input(parcial: Partial<PresentacionInput>): PresentacionInput {
  return {
    variante_id: null,
    nombre: "Pack",
    factor: 1,
    regla_precio: "FIJO",
    precio: 100,
    costo: null,
    sku: null,
    es_default: false,
    visible_catalogo: true,
    activa: true,
    orden: 0,
    ...parcial,
  };
}

describe("cantidadBase", () => {
  it("multiplica por el factor a la resolución del stock", () => {
    expect(cantidadBase(1, 4.7)).toBe(4.7);
    expect(cantidadBase(3, 4.7)).toBe(14.1);
    expect(cantidadBase(2, 10)).toBe(20);
  });

  it("no arrastra colas binarias", () => {
    // 3 × 0,1 en binario es 0,30000000000000004
    expect(cantidadBase(3, 0.1)).toBe(0.3);
  });
});

describe("presentacionesDisponibles", () => {
  it("es el piso entero del stock sobre el factor", () => {
    expect(presentacionesDisponibles(5, 4.7)).toBe(1);
    expect(presentacionesDisponibles(9.4, 4.7)).toBe(2);
    expect(presentacionesDisponibles(9, 10)).toBe(0);
    expect(presentacionesDisponibles(50, 10)).toBe(5);
  });

  it("nunca negativo ni con factor inválido", () => {
    expect(presentacionesDisponibles(-3, 10)).toBe(0);
    expect(presentacionesDisponibles(10, 0)).toBe(0);
    expect(presentacionesDisponibles(Number.NaN, 2)).toBe(0);
  });
});

describe("normalizarCantidadEnForma", () => {
  it("sin presentación aplica la regla de la unidad base", () => {
    expect(normalizarCantidadEnForma(0.75, "KG", null)).toBe(0.75);
    expect(normalizarCantidadEnForma(0.75, "UNIDAD", null)).toBeNull();
    expect(normalizarCantidadEnForma(2, "UNIDAD", null)).toBe(2);
  });

  it("con presentación exige entero aunque el producto sea fraccionable", () => {
    // Medio balde no es una presentación: es 2,35 kg sueltos.
    expect(normalizarCantidadEnForma(0.5, "KG", { factor: 4.7 })).toBeNull();
    expect(normalizarCantidadEnForma(2, "KG", { factor: 4.7 })).toBe(2);
    expect(normalizarCantidadEnForma("3", "UNIDAD", { factor: 10 })).toBe(3);
  });

  it("rechaza cero y negativos igual que la venta", () => {
    expect(normalizarCantidadEnForma(0, "KG", { factor: 4.7 })).toBeNull();
    expect(normalizarCantidadEnForma(-1, "UNIDAD", { factor: 10 })).toBeNull();
  });
});

describe("precioDePresentacion", () => {
  it("FIJO ignora el factor y el precio base: el balde vale lo que dice", () => {
    expect(precioDePresentacion(balde, 12000)).toBe(45000);
    expect(precioDePresentacion(balde, 0)).toBe(45000);
  });

  it("HEREDADO es base × factor, explícito", () => {
    expect(
      precioDePresentacion({ ...packx10, regla_precio: "HEREDADO" }, 1000),
    ).toBe(10000);
    expect(
      precioDePresentacion({ ...balde, regla_precio: "HEREDADO" }, 12000),
    ).toBe(56400);
  });

  it("no inventa un precio cuando falta", () => {
    expect(precioDePresentacion({ ...balde, precio: null }, 12000)).toBeNull();
    expect(precioDePresentacion({ ...balde, precio: 0 }, 12000)).toBeNull();
    expect(
      precioDePresentacion({ ...balde, regla_precio: "HEREDADO" }, 0),
    ).toBeNull();
  });

  it("una regla desconocida cae a FIJO (fail-closed)", () => {
    expect(
      precioDePresentacion({ ...balde, regla_precio: "PROMO" }, 12000),
    ).toBe(45000);
  });
});

describe("costoBaseDePresentacion", () => {
  it("el costo propio se prorratea por factor a la unidad base", () => {
    expect(costoBaseDePresentacion({ costo: 30000, factor: 4.7 }, 5000)).toBe(
      6382.9787,
    );
  });

  it("sin costo propio usa el costo base tal cual", () => {
    expect(costoBaseDePresentacion({ costo: null, factor: 4.7 }, 5000)).toBe(
      5000,
    );
    expect(costoBaseDePresentacion({ costo: 0, factor: 10 }, 700)).toBe(700);
  });
});

describe("validarPresentaciones", () => {
  it("un conjunto sano no da errores", () => {
    expect(
      validarPresentaciones(
        [
          input({ nombre: "Kg envasado", factor: 1, precio: 13000 }),
          input({ nombre: "Balde 4,7 kg", factor: 4.7, precio: 45000 }),
        ],
        "KG",
      ),
    ).toEqual([]);
  });

  it("factor decimal sobre unidad no fraccionable", () => {
    expect(
      validarPresentaciones([input({ factor: 2.5 })], "UNIDAD"),
    ).toEqual([{ indice: 0, error: "FACTOR_ENTERO" }]);
  });

  it("factor cero o negativo", () => {
    expect(validarPresentaciones([input({ factor: 0 })], "KG")).toEqual([
      { indice: 0, error: "FACTOR_INVALIDO" },
    ]);
  });

  it("precio fijo sin precio", () => {
    expect(
      validarPresentaciones([input({ precio: null })], "UNIDAD"),
    ).toEqual([{ indice: 0, error: "PRECIO_FIJO_INVALIDO" }]);
    // Con HEREDADO el precio no hace falta.
    expect(
      validarPresentaciones(
        [input({ regla_precio: "HEREDADO", precio: null })],
        "UNIDAD",
      ),
    ).toEqual([]);
  });

  it("nombres duplicados dentro del mismo alcance, no entre alcances", () => {
    expect(
      validarPresentaciones(
        [input({ nombre: "Pack x10" }), input({ nombre: " pack X10 " })],
        "UNIDAD",
      ),
    ).toEqual([{ indice: 1, error: "NOMBRE_DUPLICADO" }]);
    expect(
      validarPresentaciones(
        [
          input({ nombre: "Pack x10" }),
          input({ nombre: "Pack x10", variante_id: "rojo" }),
        ],
        "UNIDAD",
      ),
    ).toEqual([]);
  });

  it("dos default activas en el mismo alcance", () => {
    expect(
      validarPresentaciones(
        [
          input({ nombre: "A", es_default: true }),
          input({ nombre: "B", es_default: true }),
          // Inactiva no compite.
          input({ nombre: "C", es_default: true, activa: false }),
        ],
        "UNIDAD",
      ),
    ).toEqual([{ indice: 1, error: "DEFAULT_DUPLICADA" }]);
  });

  it("sku repetido", () => {
    expect(
      validarPresentaciones(
        [input({ nombre: "A", sku: "123" }), input({ nombre: "B", sku: "123" })],
        "UNIDAD",
      ),
    ).toEqual([{ indice: 1, error: "SKU_DUPLICADO" }]);
  });
});

describe("presentacionesDeVariante", () => {
  const generica = packx10;
  const rojoX10: Presentacion = {
    ...packx10,
    id: "rojo-x10",
    variante_id: "rojo",
    precio: 9500,
    es_default: false,
  };
  const inactiva: Presentacion = {
    ...balde,
    id: "vieja",
    activa: false,
  };

  it("la específica de la variante gana sobre la genérica del mismo nombre", () => {
    const rojo = presentacionesDeVariante([generica, rojoX10, inactiva], "rojo");
    expect(rojo.map((p) => p.id)).toEqual(["rojo-x10"]);

    const azul = presentacionesDeVariante([generica, rojoX10, inactiva], "azul");
    expect(azul.map((p) => p.id)).toEqual(["x10"]);
  });

  it("descarta inactivas y ordena por orden y factor", () => {
    const lista = presentacionesDeVariante(
      [{ ...balde, orden: 1 }, { ...packx10, orden: 0 }, inactiva],
      null,
    );
    expect(lista.map((p) => p.id)).toEqual(["x10", "balde"]);
  });

  it("sin filas no hay presentaciones ni default: se vende la unidad base", () => {
    expect(presentacionesDeVariante([], "x")).toEqual([]);
    expect(presentacionDefault(undefined, "x")).toBeNull();
  });

  it("la default sale del conjunto resuelto", () => {
    expect(presentacionDefault([generica, rojoX10], "azul")?.id).toBe("x10");
    // Para rojo la específica pisa a la genérica y no es default.
    expect(presentacionDefault([generica, rojoX10], "rojo")).toBeNull();
  });
});
