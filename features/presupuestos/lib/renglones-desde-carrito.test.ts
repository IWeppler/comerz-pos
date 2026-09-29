import { describe, expect, it } from "vitest";
import { payloadRpc, renglonesDesdeCarrito } from "./renglones-desde-carrito";

const agua = {
  productoId: "p-agua",
  varianteId: "v-agua",
  variante: "Única",
  nombre: "Agua 500ml",
  cantidad: 2,
  precio: 1,
};

describe("renglonesDesdeCarrito", () => {
  it("de un renglón de catálogo toma producto, variante y cantidad", () => {
    const r = renglonesDesdeCarrito([agua]);
    expect(r).toEqual({
      ok: true,
      renglones: [
        {
          tipo: "CATALOGO",
          productoId: "p-agua",
          varianteId: "v-agua",
          varianteNombre: "Única",
          nombre: "Agua 500ml",
          cantidad: 2,
        },
      ],
    });
  });

  it("el precio del carrito no viaja en un renglón de catálogo", () => {
    const r = renglonesDesdeCarrito([agua]);
    if (!r.ok) throw new Error(r.error);
    const payload = payloadRpc(r.renglones, (x) => x.varianteId!);
    expect(payload[0]).toEqual({
      producto_id: "p-agua",
      variante_id: "v-agua",
      cantidad: 2,
    });
    expect(payload[0]).not.toHaveProperty("precio");
  });

  it("sin varianteId queda para resolver por nombre en el server", () => {
    const r = renglonesDesdeCarrito([{ ...agua, varianteId: undefined }]);
    expect(r.ok && r.renglones[0]).toMatchObject({ varianteId: null, varianteNombre: "Única" });
  });

  it("la venta libre lleva su precio, validado como en el POS", () => {
    const r = renglonesDesdeCarrito([
      { productoId: "libre:1500", nombre: "  Armado  canasta ", precio: 1500, cantidad: 1, ventaLibre: true },
    ]);
    expect(r).toEqual({
      ok: true,
      renglones: [{ tipo: "LIBRE", descripcion: "Armado canasta", precio: 1500, cantidad: 1 }],
    });
    expect(
      renglonesDesdeCarrito([{ productoId: "libre:0", nombre: "x", precio: 0, cantidad: 1, ventaLibre: true }]).ok,
    ).toBe(false);
  });

  it("rechaza las presentaciones nombrándolas, sin sacarlas en silencio", () => {
    const r = renglonesDesdeCarrito([
      agua,
      { ...agua, nombre: "Crema", presentacionId: "pr-1", presentacionNombre: "Balde 4,7 kg" },
    ]);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Crema (Balde 4,7 kg)") });
  });

  it("rechaza carrito vacío y cantidades inválidas", () => {
    expect(renglonesDesdeCarrito([]).ok).toBe(false);
    expect(renglonesDesdeCarrito(null).ok).toBe(false);
    expect(renglonesDesdeCarrito([{ ...agua, cantidad: 0 }]).ok).toBe(false);
    expect(renglonesDesdeCarrito([{ ...agua, cantidad: "x" }]).ok).toBe(false);
  });
});
