import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { emitirComprobante } from "./emitir-comprobante";

/**
 * Supabase mínimo: solo la RPC, que es lo único que toca `emitirComprobante`.
 *
 * Antes esto mockeaba `rpc` + `from().insert()`, porque numerar y grabar eran
 * dos viajes. Ahora los hace `emitir_comprobante_venta` en uno solo, así que
 * los casos se afirman sobre los ARGUMENTOS de la RPC en vez de sobre la fila
 * insertada: es el mismo contrato, visto desde el otro lado.
 */
function fakeSupabase(opts: { numero?: number | null; error?: unknown }) {
  const rpcLlamadas: { fn: string; args: Record<string, unknown> }[] = [];

  const supabase = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcLlamadas.push({ fn, args });
      // `"numero" in opts` y no `?? 1`: hay un caso que necesita distinguir
      // "no me pasaron número" de "la RPC devolvió null", y el `??` los
      // colapsaba en 1.
      return {
        data: opts.error ? null : "numero" in opts ? opts.numero : 1,
        error: opts.error ?? null,
      };
    }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, rpcLlamadas };
}

const BASE = {
  ventaId: "venta-1",
  receptor: null,
  total: 15000,
  emitidoPor: "user-1",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emitirComprobante", () => {
  it("emite TICKET en UNA sola llamada, y el número lo pone la base", async () => {
    const { supabase, rpcLlamadas } = fakeSupabase({ numero: 7 });

    const r = await emitirComprobante(supabase, { ...BASE, config: {} });

    expect(r).toMatchObject({
      ok: true,
      tipo: "TICKET",
      numero: 7,
      puntoVenta: 1,
    });
    // El motivo viaja para poder explicar después por qué salió esto.
    expect(r.motivo).toBeTruthy();

    // UN viaje, no dos: es el punto del cambio.
    expect(rpcLlamadas).toHaveLength(1);
    expect(rpcLlamadas[0].fn).toBe("emitir_comprobante_venta");
    expect(rpcLlamadas[0].args).toMatchObject({
      p_venta_id: "venta-1",
      p_tipo: "TICKET",
      p_punto_venta: 1,
      p_total: 15000,
      p_emitido_por: "user-1",
    });
    // El número NO lo manda el cliente: lo devuelve la RPC.
    expect(rpcLlamadas[0].args).not.toHaveProperty("p_numero");
  });

  it("el ticket interno NO toma el punto de venta de ARCA: siempre serie 1", async () => {
    const { supabase, rpcLlamadas } = fakeSupabase({ numero: 1 });

    // Estilo Bonito con su punto 5 dado de alta para facturar: el recibo
    // interno no puede decir "punto de venta 5".
    await emitirComprobante(supabase, {
      ...BASE,
      config: { punto_venta: 5 },
    });

    expect(rpcLlamadas[0].args).toMatchObject({
      p_tipo: "TICKET",
      p_punto_venta: 1,
    });
  });

  it("cae a la serie interna 1 si el punto de venta guardado es inválido", async () => {
    const { supabase, rpcLlamadas } = fakeSupabase({ numero: 1 });

    await emitirComprobante(supabase, {
      ...BASE,
      // 0 no es un punto de venta válido de ARCA. No puede reventar la
      // emisión: la venta ya ocurrió.
      config: { punto_venta: 0 },
    });

    expect(rpcLlamadas[0].args).toMatchObject({ p_punto_venta: 1 });
  });

  it("congela los datos del receptor en la fila", async () => {
    const { supabase, rpcLlamadas } = fakeSupabase({ numero: 1 });

    await emitirComprobante(supabase, {
      ...BASE,
      config: {},
      receptor: {
        cliente_id: "cli-1",
        receptor_razon_social: "Comercio SA",
        receptor_cuit: "30111111118",
        receptor_condicion_iva: "Responsable Inscripto",
      },
    });

    expect(rpcLlamadas[0].args).toMatchObject({
      p_cliente_id: "cli-1",
      p_receptor_razon_social: "Comercio SA",
      p_receptor_cuit: "30111111118",
      p_receptor_condicion_iva: "Responsable Inscripto",
    });
  });

  it("emite TICKET aunque el comercio haya elegido facturar con ARCA", async () => {
    const { supabase, rpcLlamadas } = fakeSupabase({ numero: 1 });

    const r = await emitirComprobante(supabase, {
      ...BASE,
      config: {
        modo_facturacion: "ARCA",
        comprobante_defecto: "FACTURA_A",
        condicion_iva: "Responsable Inscripto",
      },
    });

    // Sin conexión real a ARCA no hay CAE, y una FACTURA_A sin CAE es un
    // comprobante inválido. La base además lo rechazaría por CHECK.
    expect(r.tipo).toBe("TICKET");
    expect(rpcLlamadas[0].args).toMatchObject({ p_tipo: "TICKET" });
    // El CAE no se manda nunca desde acá.
    expect(rpcLlamadas[0].args).not.toHaveProperty("p_cae");
  });

  it("NO lanza si falla la emisión, y deja rastro en los logs", async () => {
    const { supabase } = fakeSupabase({ error: { message: "rls" } });

    const r = await emitirComprobante(supabase, { ...BASE, config: {} });

    // La venta ya se cobró y el stock ya se descontó: hacerla rebotar acá
    // sería el incidente, no la protección.
    expect(r.ok).toBe(false);
    expect(r.numero).toBeNull();
    // Una venta sin comprobante es un hueco contable: tiene que poder
    // encontrarse después buscando en los logs.
    expect(console.error).toHaveBeenCalledWith(
      "[COMPROBANTE] No se pudo emitir",
      expect.objectContaining({ etapa: "emision", ventaId: "venta-1" }),
    );
  });

  it("NO lanza si la RPC no devuelve número", async () => {
    const { supabase } = fakeSupabase({ numero: null });

    const r = await emitirComprobante(supabase, { ...BASE, config: {} });

    expect(r.ok).toBe(false);
    expect(r.numero).toBeNull();
  });

  it("tolera config nula sin romper la venta", async () => {
    const { supabase, rpcLlamadas } = fakeSupabase({ numero: 1 });

    const r = await emitirComprobante(supabase, { ...BASE, config: null });

    expect(r.ok).toBe(true);
    expect(rpcLlamadas[0].args).toMatchObject({
      p_tipo: "TICKET",
      p_punto_venta: 1,
    });
  });
});
