import { describe, expect, it } from "vitest";
import {
  leerOrigen,
  origenDesdeQuery,
  queryAltaDesdeTienda,
  serializarOrigen,
} from "./origen-alta";

describe("origenDesdeQuery", () => {
  it("toma ref y utm, en minúscula", () => {
    const params = new URLSearchParams(
      "ref=Evens&utm_source=instagram&utm_medium=bio&utm_campaign=lanzamiento&otro=x",
    );
    expect(origenDesdeQuery(params)).toEqual({
      ref: "evens",
      utm_source: "instagram",
      utm_medium: "bio",
      utm_campaign: "lanzamiento",
    });
  });

  it("sin nada válido es null, no un origen vacío", () => {
    // "Sin origen" no es "orgánico": no se guarda nada.
    expect(origenDesdeQuery(new URLSearchParams(""))).toBeNull();
    expect(origenDesdeQuery(new URLSearchParams("ref=&utm_source=%20"))).toBeNull();
  });

  it("descarta campo por campo lo que no es un identificador corto", () => {
    const params = new URLSearchParams({
      ref: "<script>",
      utm_source: "instagram",
      utm_campaign: "x".repeat(65),
    });
    expect(origenDesdeQuery(params)).toEqual({ utm_source: "instagram" });
  });
});

describe("leerOrigen", () => {
  it("ida y vuelta por la cookie", () => {
    const origen = { ref: "evens", utm_source: "tienda" };
    expect(leerOrigen(serializarOrigen(origen))).toEqual(origen);
  });

  it("una cookie rota o manipulada es sin origen", () => {
    expect(leerOrigen(undefined)).toBeNull();
    expect(leerOrigen("no es json")).toBeNull();
    expect(leerOrigen("[]")).toBeNull();
    expect(leerOrigen('{"ref":"a b","utm_source":5}')).toBeNull();
    expect(leerOrigen('{"ref":"evens","extra":"x"}')).toEqual({ ref: "evens" });
  });
});

describe("queryAltaDesdeTienda", () => {
  it("el slug de la tienda es el código de referido", () => {
    const query = queryAltaDesdeTienda("evens", "boton");
    expect(query).toBe("?ref=evens&utm_source=tienda&utm_medium=boton");
    expect(origenDesdeQuery(new URLSearchParams(query))).toEqual({
      ref: "evens",
      utm_source: "tienda",
      utm_medium: "boton",
    });
  });
});
