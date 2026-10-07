import { describe, it, expect } from "vitest";
import { construirPayloadCategorias } from "./build-categorias-payload";

describe("construirPayloadCategorias", () => {
  it("preserva el link padre/hijo cuando ambos se crean en la misma pasada (repro: Abrigos + Camperas/Buzos/Chalecos)", () => {
    const padreId = crypto.randomUUID();
    const hijoId1 = crypto.randomUUID();
    const hijoId2 = crypto.randomUUID();
    const hijoId3 = crypto.randomUUID();

    const payload = construirPayloadCategorias([
      { id: padreId, nombre: "Abrigos", activa: true, isNew: true, parent_id: null },
      { id: hijoId1, nombre: "Camperas", activa: true, isNew: true, parent_id: padreId },
      { id: hijoId2, nombre: "Buzos", activa: true, isNew: true, parent_id: padreId },
      { id: hijoId3, nombre: "Chalecos", activa: true, isNew: true, parent_id: padreId },
    ]);

    const abrigos = payload.find((p) => p.nombre === "Abrigos")!;
    const hijos = payload.filter((p) => p.nombre !== "Abrigos");

    // El padre conserva EXACTAMENTE el id que el cliente le asignó al crearlo.
    expect(abrigos.id).toBe(padreId);
    expect(abrigos.parent_id).toBeNull();

    // Cada hijo apunta al id REALMENTE PERSISTIDO del padre, no a uno
    // regenerado por separado — antes del fix, el id del padre se
    // regeneraba acá y quedaba distinto al que los hijos referenciaban.
    for (const hijo of hijos) {
      expect(hijo.parent_id).toBe(abrigos.id);
    }
  });

  it("genera un id nuevo solo cuando de verdad no vino ninguno (fallback defensivo)", () => {
    const payload = construirPayloadCategorias([
      { id: "", nombre: "Sin id", activa: true, isNew: true, parent_id: null },
    ]);

    expect(payload[0].id).toBeTruthy();
    expect(payload[0].id).not.toBe("");
  });

  it("no toca el id de una categoría existente (edición, no creación)", () => {
    const idExistente = crypto.randomUUID();

    const payload = construirPayloadCategorias([
      { id: idExistente, nombre: "Boxer", activa: true, isNew: false, parent_id: null },
    ]);

    expect(payload[0].id).toBe(idExistente);
  });

  it("conserva la portada elegida para cada categoría", () => {
    const payload = construirPayloadCategorias([
      { id: "a", nombre: "Ropa", activa: true, parent_id: null, imagen_url: "https://x/portada.webp" },
    ]);

    expect(payload[0].imagen_url).toBe("https://x/portada.webp");
  });

  it("incluye imagen_url en TODAS las filas del lote, aunque sea null", () => {
    // PostgREST arma el UPDATE del upsert con la unión de las claves del
    // lote: si una fila omitiera la columna, se completaría con null y le
    // borraría la portada al guardar cualquier otro cambio.
    const payload = construirPayloadCategorias([
      { id: "a", nombre: "Con portada", activa: true, parent_id: null, imagen_url: "https://x/a.webp" },
      { id: "b", nombre: "Sin portada", activa: true, parent_id: null },
    ]);

    expect(payload.every((f) => "imagen_url" in f)).toBe(true);
    expect(payload[1].imagen_url).toBeNull();
  });

  it("incluye lleva_serie en TODAS las filas (NOT NULL + upsert por unión de claves)", () => {
    const payload = construirPayloadCategorias([
      { id: "a", nombre: "Celulares", activa: true, parent_id: null, lleva_serie: true },
      { id: "b", nombre: "Fundas", activa: true, parent_id: null },
    ]);

    expect(payload[0].lleva_serie).toBe(true);
    expect(payload[1]).toHaveProperty("lleva_serie", false);
  });
});
