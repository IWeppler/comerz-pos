import { describe, expect, it } from "vitest";
import {
  clasificarColumnaIngreso,
  normalizarClaveColumna,
} from "./columnas-archivo-ingreso";
import { todasLasColumnasConocidas } from "@/features/stock/lib/columnas-por-rubro";

describe("clasificación de columnas del archivo de ingreso", () => {
  it("reconoce la misma columna escrita de cualquier forma", () => {
    expect(clasificarColumnaIngreso("precio_venta")).toBe("venta");
    expect(clasificarColumnaIngreso("Precio Venta")).toBe("venta");
    expect(clasificarColumnaIngreso("PRECIO-VENTA")).toBe("venta");
  });

  it("'PRECIO' a secas es costo, no venta", () => {
    // En un remito, el precio que manda el proveedor es lo que le cobra al
    // comercio. Confundirlos pone el costo como precio de vidriera.
    expect(clasificarColumnaIngreso("PRECIO")).toBe("costo");
    expect(clasificarColumnaIngreso("PRECIO UNITARIO")).toBe("costo");
    expect(clasificarColumnaIngreso("PRECIO DE VENTA")).toBe("venta");
  });

  it("reconoce IMEI y código de barras, que es lo que faltaba", () => {
    // El remito de ClickTostado los perdió: quedaron pegados al nombre de la
    // variante y el aparato entró sin serie y con costo 0.
    expect(clasificarColumnaIngreso("IMEI")).toBe("imei");
    expect(clasificarColumnaIngreso("N° SERIE")).toBe("imei");
    expect(clasificarColumnaIngreso("CODIGO_BARRAS")).toBe("sku");
    expect(clasificarColumnaIngreso("Código de Barras")).toBe("sku");
    expect(clasificarColumnaIngreso("EAN")).toBe("sku");
  });

  it("reconoce las seis formas de la columna de género", () => {
    for (const alias of ["GENERO", "Género", "SEXO", "PUBLICO", "Público", "AUDIENCIA"]) {
      expect(clasificarColumnaIngreso(alias)).toBe("genero");
    }
  });

  it("deja pasar como atributo lo que parte variantes", () => {
    // Talle, color, memoria y compañía NO tienen campo propio en la orden: su
    // lugar es el texto de la variante, que es donde la conciliación los lee.
    expect(clasificarColumnaIngreso("TALLE")).toBeNull();
    expect(clasificarColumnaIngreso("COLOR")).toBeNull();
    expect(clasificarColumnaIngreso("MEMORIA")).toBeNull();
    expect(clasificarColumnaIngreso("MATERIAL")).toBeNull();
    expect(clasificarColumnaIngreso("")).toBeNull();
  });

  it("normaliza tildes, mayúsculas y separadores", () => {
    expect(normalizarClaveColumna(" código_de-barras ")).toBe("CODIGODEBARRAS");
  });
});

/**
 * El guard contra que los dos caminos vuelvan a divergir.
 *
 * La plantilla propia declara sus columnas en `columnas-por-rubro.ts`. Si
 * aparece una nueva que NO parte variantes y este módulo no la conoce, el
 * remito de proveedor la va a mandar a los atributos de la variante — que es
 * exactamente cómo el IMEI terminó formando parte de la identidad de un
 * celular.
 */
describe("las dos puertas reconocen lo mismo", () => {
  // Columnas de la plantilla que SÍ son atributo de variante o que no tienen
  // campo propio en `ordenes_items`: su destino correcto es el texto de la
  // variante. Se listan a mano para que agregar una columna nueva obligue a
  // decidir a cuál de los dos grupos pertenece.
  const VAN_COMO_ATRIBUTO = new Set([
    "talle",
    "color",
    "memoria",
    "capacidad",
    "acabado",
    "peso",
    "medida",
    "material",
    "presentacion",
    "modelo",
    "unidad_medida",
  ]);

  it("toda columna de la plantilla tiene destino conocido", () => {
    const sinDestino = todasLasColumnasConocidas().filter(
      (clave) =>
        !VAN_COMO_ATRIBUTO.has(clave) && clasificarColumnaIngreso(clave) === null,
    );

    expect(
      sinDestino,
      `Estas columnas de la plantilla no las reconoce el parser del remito, ` +
        `así que ahí se van a pegar a la identidad de la variante. Agregalas ` +
        `a ALIAS_COLUMNAS_INGRESO o a VAN_COMO_ATRIBUTO:`,
    ).toEqual([]);
  });
});
