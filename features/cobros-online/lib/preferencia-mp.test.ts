import { describe, expect, it } from "vitest";
import { armarPreferencia, armarPreferenciaCobroCc, fechaParaMp, type DatosPreferencia } from "./preferencia-mp";

const datos = (over: Partial<DatosPreferencia> = {}): DatosPreferencia => ({
  ordenId: "11111111-1111-1111-1111-111111111111",
  negocioId: "22222222-2222-2222-2222-222222222222",
  numero: 12,
  total: 45300,
  medio: "MP_CHECKOUT",
  nombreComercio: "Evens",
  clienteNombre: "María",
  venceEn: new Date("2026-10-12T19:00:00Z"),
  urlRetorno: "https://evens.comerz.app/orden/abc",
  urlNotificacion: "https://app.comerz.app/api/mercadopago/webhook",
  ...over,
});

describe("preference de Checkout Pro", () => {
  it("un solo ítem con el total exacto y la orden como referencia", () => {
    const p = armarPreferencia(datos(), new Date("2026-10-12T18:00:00Z"));
    expect(p.items).toEqual([
      { id: datos().ordenId, title: "Orden #00012 · Evens", quantity: 1, unit_price: 45300, currency_id: "ARS" },
    ]);
    expect(p.external_reference).toBe(datos().ordenId);
    expect(p.notification_url).toBe("https://app.comerz.app/api/mercadopago/webhook");
    expect(p.back_urls).toEqual({
      success: "https://evens.comerz.app/orden/abc",
      pending: "https://evens.comerz.app/orden/abc",
      failure: "https://evens.comerz.app/orden/abc",
    });
    expect(p.auto_return).toBe("approved");
  });

  it("vence con la orden, en hora argentina", () => {
    const p = armarPreferencia(datos(), new Date("2026-10-12T18:00:00Z"));
    expect(p.expires).toBe(true);
    expect(p.expiration_date_from).toBe("2026-10-12T15:00:00.000-03:00");
    expect(p.expiration_date_to).toBe("2026-10-12T16:00:00.000-03:00");
  });

  it("excluye Rapipago/Pago Fácil y cajeros", () => {
    expect(armarPreferencia(datos()).payment_methods).toEqual({
      excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
    });
  });

  it("cuotas sin tarjeta = misma preference con purpose onboarding_credits", () => {
    expect(armarPreferencia(datos({ medio: "MP_CREDITO" })).purpose).toBe("onboarding_credits");
    expect(armarPreferencia(datos({ medio: "MP_CHECKOUT" }))).not.toHaveProperty("purpose");
  });

  it("en local (http) no manda auto_return ni webhook", () => {
    const p = armarPreferencia(datos({ urlRetorno: "http://localhost:3000/store/evens/orden/abc", urlNotificacion: null }));
    expect(p).not.toHaveProperty("auto_return");
    expect(p).not.toHaveProperty("notification_url");
  });

  it("fechaParaMp", () => {
    expect(fechaParaMp(new Date("2026-10-12T03:00:00Z"))).toBe("2026-10-12T00:00:00.000-03:00");
  });
});

describe("armarPreferenciaCobroCc", () => {
  it("referencia con prefijo cc:, total exacto y vuelve al resumen", () => {
    const p = armarPreferenciaCobroCc(
      {
        cobroId: "11111111-1111-1111-1111-111111111111",
        negocioId: "n",
        total: 34500,
        nombreComercio: "Evens",
        clienteNombre: "María",
        venceEn: new Date("2026-10-22T16:00:00Z"),
        urlRetorno: "https://comerz.app/r/abc?pago=1",
        urlNotificacion: "https://app.comerz.app/api/mercadopago/webhook?n=n",
      },
      new Date("2026-10-22T15:00:00Z"),
    );
    expect(p.external_reference).toBe("cc:11111111-1111-1111-1111-111111111111");
    expect(p.items).toEqual([
      expect.objectContaining({ unit_price: 34500, quantity: 1, title: "Cuenta corriente · Evens" }),
    ]);
    expect(p.back_urls.success).toBe("https://comerz.app/r/abc?pago=1");
    expect(p.auto_return).toBe("approved");
    expect(p.expiration_date_to).toBe("2026-10-22T13:00:00.000-03:00");
  });
});
