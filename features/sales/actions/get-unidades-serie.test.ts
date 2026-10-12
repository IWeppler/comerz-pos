import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  unidades: vi.fn(),
  marcadas: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock("@/shared/config/supabase/server", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ in: () => ({ eq: mocks.unidades }) }),
    }),
    rpc: mocks.marcadas,
  }),
}));

import { getDisponibilidadUnidadesAction } from "./get-unidades-serie";

describe("verificación de IMEI antes de cobrar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.unidades.mockResolvedValue({ data: [], error: null });
    mocks.marcadas.mockResolvedValue({ data: [{ variante_id: "a26" }], error: null });
  });

  it("un celular sin números disponibles sigue requiriendo IMEI o motivo", async () => {
    expect(await getDisponibilidadUnidadesAction(["a26"])).toEqual({
      error: null, disponibilidad: {}, llevaSerie: ["a26"],
    });
  });

  it("no convierte un fallo de la RPC en un producto que no requiere IMEI", async () => {
    mocks.marcadas.mockResolvedValue({ data: null, error: { message: "sin permiso" } });
    const resultado = await getDisponibilidadUnidadesAction(["a26"]);
    expect(resultado.error).toBeTruthy();
    expect(resultado.disponibilidad).toEqual({});
  });

  it("aborta también si falla la disponibilidad", async () => {
    mocks.unidades.mockResolvedValue({ data: null, error: { message: "sin conexión" } });
    expect((await getDisponibilidadUnidadesAction(["a26"])).error).toBeTruthy();
  });

  it("permite un accesorio sin serie y no lo confunde con una consulta fallida", async () => {
    mocks.marcadas.mockResolvedValue({ data: [], error: null });
    expect(await getDisponibilidadUnidadesAction(["funda"])).toEqual({
      error: null, disponibilidad: {}, llevaSerie: [],
    });
  });
});
