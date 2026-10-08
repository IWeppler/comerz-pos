import { describe, expect, it } from "vitest";
import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import { calcularDiasVencido } from "./calcular-dias-vencido";
import {
  calcularSaldoConRecargo,
  type RecargoMoraConfig,
} from "./calcular-saldo-con-recargo";

const PORCENTAJE: RecargoMoraConfig = {
  recargo_mora_tipo: "PORCENTAJE",
  recargo_mora_valor: 15,
};
const FIJO: RecargoMoraConfig = {
  recargo_mora_tipo: "MONTO_FIJO",
  recargo_mora_valor: 5000,
};
const NINGUNO: RecargoMoraConfig = {
  recargo_mora_tipo: "NINGUNO",
  recargo_mora_valor: 0,
};

/**
 * Fechas relativas a hoy, en ISO — es lo que guarda fecha_vencimiento_deuda.
 *
 * "Hoy" es el día comercial argentino, igual que en `calcularDiasVencido`: si
 * el helper usara otro calendario (el local o `toISOString()`), de noche
 * `haceDias(1)` caería en HOY y el test fallaría solo a esa hora.
 */
function haceDias(dias: number): string {
  const [a, m, d] = diaComercial(new Date()).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
}

describe("calcularSaldoConRecargo", () => {
  it("aplica el porcentaje sobre el saldo vencido", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 100000,
        fecha_vencimiento: haceDias(10),
        monto_vencido: 100000,
      },
      PORCENTAJE,
    );
    expect(r.estaVencido).toBe(true);
    expect(r.montoRecargo).toBe(15000);
    expect(r.saldoConRecargo).toBe(115000);
  });

  it("el monto fijo no depende del saldo", () => {
    const chico = calcularSaldoConRecargo(
      {
        monto_pendiente: 8000,
        fecha_vencimiento: haceDias(1),
        monto_vencido: 8000,
      },
      FIJO,
    );
    const grande = calcularSaldoConRecargo(
      {
        monto_pendiente: 900000,
        fecha_vencimiento: haceDias(1),
        monto_vencido: 900000,
      },
      FIJO,
    );
    expect(chico.montoRecargo).toBe(5000);
    expect(grande.montoRecargo).toBe(5000);
  });

  it("no cobra recargo antes del vencimiento", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 100000,
        fecha_vencimiento: haceDias(-5),
        monto_vencido: 0,
      },
      PORCENTAJE,
    );
    expect(r.estaVencido).toBe(false);
    expect(r.montoRecargo).toBe(0);
    expect(r.saldoConRecargo).toBe(100000);
  });

  it("sin fecha de vencimiento no hay mora", () => {
    // El caso de la deuda importada por CSV sin columna de vencimiento: se
    // debe la plata, pero no hay desde cuándo contar el atraso.
    const r = calcularSaldoConRecargo(
      { monto_pendiente: 100000, fecha_vencimiento: null, monto_vencido: 0 },
      PORCENTAJE,
    );
    expect(r.montoRecargo).toBe(0);
  });

  it("con la mora en NINGUNO no suma nada aunque esté vencido", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 100000,
        fecha_vencimiento: haceDias(90),
        monto_vencido: 100000,
      },
      NINGUNO,
    );
    expect(r.estaVencido).toBe(true);
    expect(r.montoRecargo).toBe(0);
  });

  it("saldo cero no genera recargo", () => {
    const r = calcularSaldoConRecargo(
      { monto_pendiente: 0, fecha_vencimiento: haceDias(30), monto_vencido: 0 },
      FIJO,
    );
    expect(r.estaVencido).toBe(false);
    expect(r.montoRecargo).toBe(0);
  });

  it("es idempotente: recalcular sobre el resultado da lo mismo", () => {
    // La razón de que reciba el saldo BASE y no uno que ya tenga recargo: la
    // mora es única, no compuesta. Si el saldo con recargo se reinyectara,
    // cada refresh de la pantalla la haría crecer sola.
    const primera = calcularSaldoConRecargo(
      {
        monto_pendiente: 100000,
        fecha_vencimiento: haceDias(10),
        monto_vencido: 100000,
      },
      PORCENTAJE,
    );
    const segunda = calcularSaldoConRecargo(
      {
        monto_pendiente: 100000,
        fecha_vencimiento: haceDias(10),
        monto_vencido: 100000,
      },
      PORCENTAJE,
    );
    expect(segunda.saldoConRecargo).toBe(primera.saldoConRecargo);
  });

  it("un saldo negativo (cliente a favor) no genera recargo", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: -3000,
        fecha_vencimiento: haceDias(10),
        monto_vencido: 0,
      },
      PORCENTAJE,
    );
    expect(r.saldoBase).toBe(0);
    expect(r.montoRecargo).toBe(0);
  });

  it("cobra la mora sobre el SALDO COMPLETO, no sobre la parte vencida", () => {
    // Es el mismo caso real de antes (Evens, CELESTE SCHOFER: $104.825 de
    // saldo con $175 vencidos), con la respuesta dada vuelta el 5/9/2026 por
    // decisión de la dueña: si la clienta se atrasó, toda su cuenta entra en
    // mora. Entre el 30/8 y el 5/9 esto devolvía $26,25.
    //
    // El test se deja con estos números justamente porque son los que hacen
    // visible lo que la decisión cuesta: $15.723,75 contra $26,25.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 104825,
        fecha_vencimiento: haceDias(5),
        monto_vencido: 175,
      },
      PORCENTAJE,
    );
    expect(r.estaVencido).toBe(true);
    expect(r.montoRecargo).toBe(15723.75);
    expect(r.saldoConRecargo).toBe(120548.75);
    // Se sigue informando, aunque ya no sea la base del cobro.
    expect(r.montoVencido).toBe(175);
  });

  it("con todo el saldo vencido cobra lo mismo que antes", () => {
    // La contracara: para quien está atrasado con todo —11 de los 19 cobros
    // de mora ya hechos— el número no cambia en un peso.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 150200,
        fecha_vencimiento: haceDias(22),
        monto_vencido: 150200,
      },
      PORCENTAJE,
    );
    expect(r.montoRecargo).toBe(22530);
  });

  it("con la fecha pasada cobra mora aunque el FIFO diga que no hay nada vencido", () => {
    // Con el vencimiento anclado al CICLO de deuda (20260905190000), el FIFO y
    // la fecha del cliente ya no responden lo mismo: pagar una parte cancela lo
    // más viejo pero NO saca a la clienta de mora. Eran 5 clientas reales el
    // 5/9/2026, que antes de este cambio no pagaban un peso de recargo.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 60050,
        fecha_vencimiento: haceDias(3),
        monto_vencido: 0,
      },
      PORCENTAJE,
    );
    expect(r.estaVencido).toBe(true);
    expect(r.montoRecargo).toBe(9007.5);
  });

  it("sin saldo no hay mora, aunque la fecha haya pasado", () => {
    // El único caso que apaga el recargo: la cuenta saldada. Es lo que cierra
    // el ciclo — "la mora se quita cuando paga todo".
    const r = calcularSaldoConRecargo(
      { monto_pendiente: 0, fecha_vencimiento: haceDias(30), monto_vencido: 0 },
      PORCENTAJE,
    );
    expect(r.estaVencido).toBe(false);
    expect(r.montoRecargo).toBe(0);
  });

  it("el vencido nunca puede superar al saldo", () => {
    // Defensa contra un libro descuadrado: si `deuda_cc_vencida` devolviera
    // más de lo que dice `saldo_pendiente`, la mora se calcularía sobre plata
    // que el cliente no debe.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 10000,
        fecha_vencimiento: haceDias(10),
        monto_vencido: 999999,
      },
      PORCENTAJE,
    );
    expect(r.montoVencido).toBe(10000);
    expect(r.montoRecargo).toBe(1500);
  });

  it("un vencido ausente ya no cambia el cobro", () => {
    // `monto_vencido` dejó de ser la base el 5/9/2026: que llegue null desde la
    // base ya no puede apagar el recargo, porque no participa del cálculo. Se
    // deja el caso escrito para que quede claro que el null no rompe.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 100000,
        fecha_vencimiento: haceDias(10),
        monto_vencido: null,
      },
      PORCENTAJE,
    );
    expect(r.montoRecargo).toBe(15000);
    expect(r.montoVencido).toBe(0);
  });

  it("acepta el saldo como string, que es como lo devuelve numeric de Postgres", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: "100000.00",
        fecha_vencimiento: haceDias(10),
        monto_vencido: "100000.00",
      },
      PORCENTAJE,
    );
    expect(r.montoRecargo).toBe(15000);
  });
});

describe("la mora nunca se calcula sobre mora", () => {
  it("resta los recargos anteriores impagos de la base", () => {
    // Saldo de 115.000 del que 15.000 son un recargo ya cobrado y todavía
    // impago. La base tiene que ser el capital: 100.000.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 115000,
        fecha_vencimiento: haceDias(40),
        monto_vencido: 115000,
        mora_previa: 15000,
      },
      PORCENTAJE,
    );
    expect(r.baseRecargo).toBe(100000);
    expect(r.montoRecargo).toBe(15000);
    // Y lo que debe sigue siendo el saldo entero más el recargo nuevo.
    expect(r.saldoConRecargo).toBe(130000);
  });

  it("sin el campo, la base es el saldo entero — el caso normal", () => {
    // 39 de 39 recargos del SaaS son primeros, así que omitirlo dice la verdad.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 100000,
        fecha_vencimiento: haceDias(40),
        monto_vencido: 100000,
      },
      PORCENTAJE,
    );
    expect(r.baseRecargo).toBe(100000);
    expect(r.montoRecargo).toBe(15000);
  });

  it("no compone: dos recargos seguidos dan el mismo monto", () => {
    // Es la promesa de Configuración > Clientes: "se suma una única vez ... no
    // se acumula día a día". El segundo recargo se calcula sobre el mismo
    // capital que el primero, no sobre capital + primer recargo.
    const capital = 100000;
    const primera = calcularSaldoConRecargo(
      {
        monto_pendiente: capital,
        fecha_vencimiento: haceDias(40),
        monto_vencido: capital,
      },
      PORCENTAJE,
    );
    const segunda = calcularSaldoConRecargo(
      {
        monto_pendiente: capital + primera.montoRecargo,
        fecha_vencimiento: haceDias(80),
        monto_vencido: capital + primera.montoRecargo,
        mora_previa: primera.montoRecargo,
      },
      PORCENTAJE,
    );
    expect(segunda.montoRecargo).toBe(primera.montoRecargo);
  });

  it("una cuenta que solo debe recargo no genera recargo nuevo", () => {
    // Pagó todo el capital y le quedan los 15.000 de mora: no hay capital
    // sobre el cual cobrar, así que el recargo es 0. Que la cuenta siga
    // vencida es otra cosa, y la decide el vencimiento.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 15000,
        fecha_vencimiento: haceDias(40),
        monto_vencido: 15000,
        mora_previa: 15000,
      },
      PORCENTAJE,
    );
    expect(r.baseRecargo).toBe(0);
    expect(r.montoRecargo).toBe(0);
    expect(r.estaVencido).toBe(true);
  });

  it("el monto FIJO no se cobra si lo único que debe es mora previa", () => {
    // Hasta el 5/10/2026 acá se sumaba otro fijo: mora sobre mora. Desde que
    // la mora es una vez por venta, sin capital por recargar no hay recargo.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 15000,
        fecha_vencimiento: haceDias(40),
        monto_vencido: 15000,
        mora_previa: 15000,
      },
      FIJO,
    );
    expect(r.montoRecargo).toBe(0);
  });

  it("una mora previa mayor al saldo no vuelve negativa la base", () => {
    // Defensa contra libro descuadrado, misma que `montoVencido`.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 10000,
        fecha_vencimiento: haceDias(40),
        monto_vencido: 10000,
        mora_previa: 999999,
      },
      PORCENTAJE,
    );
    expect(r.baseRecargo).toBe(0);
    expect(r.montoRecargo).toBe(0);
  });

  it("acepta la mora previa como string, que es como llega de numeric", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: "115000.00",
        fecha_vencimiento: haceDias(40),
        monto_vencido: "115000.00",
        mora_previa: "15000.00",
      },
      PORCENTAJE,
    );
    expect(r.montoRecargo).toBe(15000);
  });
});

// La base la elige cada comercio (5/10/2026). El caso real: NATI CORDOBA en
// Librería Colores, $14.800 vencidos y una compra de $302.150 de seis días.
describe("calcularSaldoConRecargo — base configurable", () => {
  const nati = {
    monto_pendiente: 316950,
    fecha_vencimiento: haceDias(1),
    monto_vencido: 14800,
    mora_previa: 0,
    capital_vencido: 14800,
  };

  it("SALDO_COMPLETO: 15% de toda la cuenta (lo que se mostraba a Colores)", () => {
    const r = calcularSaldoConRecargo(nati, {
      ...PORCENTAJE,
      recargo_mora_base: "SALDO_COMPLETO",
    });
    expect(r.montoRecargo).toBeCloseTo(47542.5, 2);
  });

  it("sin base configurada se comporta como SALDO_COMPLETO (el default)", () => {
    expect(calcularSaldoConRecargo(nati, PORCENTAJE).montoRecargo).toBeCloseTo(
      47542.5,
      2,
    );
  });

  it("PORCION_VENCIDA: 15% solo de lo vencido", () => {
    const r = calcularSaldoConRecargo(nati, {
      ...PORCENTAJE,
      recargo_mora_base: "PORCION_VENCIDA",
    });
    expect(r.baseRecargo).toBe(14800);
    expect(r.montoRecargo).toBeCloseTo(2220, 2);
    expect(r.saldoConRecargo).toBeCloseTo(319170, 2);
  });

  it("PORCION_VENCIDA sin capital vencido no cobra recargo", () => {
    const r = calcularSaldoConRecargo(
      { ...nati, capital_vencido: 0 },
      { ...PORCENTAJE, recargo_mora_base: "PORCION_VENCIDA" },
    );
    expect(r.montoRecargo).toBe(0);
  });

  it("PORCION_VENCIDA no pasa del capital aunque el dato venga inflado", () => {
    const r = calcularSaldoConRecargo(
      { ...nati, mora_previa: 16950, capital_vencido: 999999 },
      { ...PORCENTAJE, recargo_mora_base: "PORCION_VENCIDA" },
    );
    expect(r.baseRecargo).toBe(300000);
  });

  it("MONTO_FIJO no depende de la base", () => {
    const r = calcularSaldoConRecargo(nati, {
      ...FIJO,
      recargo_mora_base: "PORCION_VENCIDA",
    });
    expect(r.montoRecargo).toBe(5000);
  });
});

describe("calcularDiasVencido — día comercial argentino", () => {
  it("a las 22:00 de Argentina sigue siendo hoy, aunque en UTC sea mañana", () => {
    // 5/10/2026 22:00 en Buenos Aires = 6/10 01:00 UTC.
    const noche = new Date("2026-10-06T01:00:00Z");
    expect(calcularDiasVencido("2026-10-05", noche)).toBe(0);
    expect(calcularDiasVencido("2026-10-04", noche)).toBe(1);
  });

  it("a la medianoche argentina pasa al día siguiente", () => {
    const medianoche = new Date("2026-10-06T03:00:00Z");
    expect(calcularDiasVencido("2026-10-05", medianoche)).toBe(1);
  });
});

// Una venta recarga UNA vez (5/10/2026). Antes cada cobro con la cuenta
// vencida volvía a recargar el mismo capital (MARA MANSILLA en Evens: 4/9,
// 14/9 y 26/9).
describe("calcularSaldoConRecargo — una vez por venta", () => {
  it("SALDO_COMPLETO: no recarga lo que ya pagó su recargo", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 100000,
        fecha_vencimiento: haceDias(10),
        mora_previa: 0,
        recargado_saldo: 80000,
      },
      PORCENTAJE,
    );
    // Solo la compra nueva, la de $20.000 que no existía en la mora anterior.
    expect(r.baseRecargo).toBe(20000);
    expect(r.montoRecargo).toBe(3000);
  });

  it("SALDO_COMPLETO: si todo ya pagó su recargo, no hay otro", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 50000,
        fecha_vencimiento: haceDias(10),
        recargado_saldo: 50000,
      },
      PORCENTAJE,
    );
    expect(r.montoRecargo).toBe(0);
    expect(r.saldoConRecargo).toBe(50000);
  });

  it("PORCION_VENCIDA: solo lo vencido que todavía no recargó", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 100000,
        fecha_vencimiento: haceDias(10),
        capital_vencido: 60000,
        recargado_vencido: 40000,
      },
      { ...PORCENTAJE, recargo_mora_base: "PORCION_VENCIDA" },
    );
    expect(r.baseRecargo).toBe(20000);
    expect(r.montoRecargo).toBe(3000);
  });

  it("PORCION_VENCIDA ignora lo recargado con la otra base", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 100000,
        fecha_vencimiento: haceDias(10),
        capital_vencido: 60000,
        recargado_saldo: 100000,
        recargado_vencido: 0,
      },
      { ...PORCENTAJE, recargo_mora_base: "PORCION_VENCIDA" },
    );
    expect(r.baseRecargo).toBe(60000);
  });

  it("MONTO_FIJO: tampoco se repite si no queda nada sin recargar", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 50000,
        fecha_vencimiento: haceDias(10),
        recargado_saldo: 50000,
      },
      FIJO,
    );
    expect(r.montoRecargo).toBe(0);
  });

  it("acepta los montos como string, que es como llegan de numeric", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: "100000.00",
        fecha_vencimiento: haceDias(10),
        recargado_saldo: "80000.00",
      },
      PORCENTAJE,
    );
    expect(r.montoRecargo).toBe(3000);
  });
});

// Auditoría del 8/10/2026 (CELESTE SCHOFER, Evens): cada venta vence en su
// plazo y recarga una vez; el monto fijo es uno POR VENTA vencida.
describe("calcularSaldoConRecargo — monto fijo por venta vencida", () => {
  it("cobra un fijo por cada venta vencida que todavía no recargó", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 90000,
        fecha_vencimiento: haceDias(10),
        capital_vencido: 60000,
        ventas_vencidas_nuevas: 3,
      },
      { ...FIJO, recargo_mora_base: "PORCION_VENCIDA" },
    );
    expect(r.montoRecargo).toBe(15000);
  });

  it("sin ventas vencidas nuevas no hay fijo, aunque la cuenta esté vencida", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 90000,
        fecha_vencimiento: haceDias(10),
        capital_vencido: 60000,
        recargado_vencido: 60000,
        ventas_vencidas_nuevas: 0,
      },
      { ...FIJO, recargo_mora_base: "PORCION_VENCIDA" },
    );
    expect(r.montoRecargo).toBe(0);
  });

  it("acepta la cantidad como string", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 90000,
        fecha_vencimiento: haceDias(10),
        capital_vencido: 60000,
        ventas_vencidas_nuevas: "2",
      },
      { ...FIJO, recargo_mora_base: "PORCION_VENCIDA" },
    );
    expect(r.montoRecargo).toBe(10000);
  });

  it("sin el dato (base vieja) queda uno por cobro, como antes", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 90000,
        fecha_vencimiento: haceDias(10),
        capital_vencido: 60000,
      },
      { ...FIJO, recargo_mora_base: "PORCION_VENCIDA" },
    );
    expect(r.montoRecargo).toBe(5000);
  });

  it("antes del vencimiento no cobra aunque venga una cantidad", () => {
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 90000,
        fecha_vencimiento: haceDias(-5),
        ventas_vencidas_nuevas: 2,
      },
      FIJO,
    );
    expect(r.montoRecargo).toBe(0);
  });
});

describe("calcularSaldoConRecargo — PORCION_VENCIDA con la imputación por venta", () => {
  it("Vero duarte (Estilo Bonito, 10%): la base es lo vivo de su compra vencida", () => {
    // Con el FIFO viejo de `deuda_cc_vencida` la mora pagada aparecía viva
    // ($4.500) y la base daba $10.000. Imputando como `cc_deudas_vivas`: su
    // compra del 22/8 tiene $14.500 vivos, vencidos y sin recargar.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 14500,
        fecha_vencimiento: haceDias(16),
        mora_previa: 0,
        capital_vencido: 14500,
        recargado_vencido: 0,
        ventas_vencidas_nuevas: 1,
      },
      {
        recargo_mora_tipo: "PORCENTAJE",
        recargo_mora_valor: 10,
        recargo_mora_base: "PORCION_VENCIDA",
      },
    );
    expect(r.baseRecargo).toBe(14500);
    expect(r.montoRecargo).toBe(1450);
  });

  it("una compra que no venció no entra en la mora (CELESTE SCHOFER, 7/10)", () => {
    // Compró $43.700 y 40 segundos después pagó con la cuenta vencida por su
    // compra del 29/8. Lo vencido sin recargar era solo ese ticket.
    const r = calcularSaldoConRecargo(
      {
        monto_pendiente: 97911.44,
        fecha_vencimiento: haceDias(4),
        capital_vencido: 13831.44,
        recargado_vencido: 0,
      },
      { ...PORCENTAJE, recargo_mora_base: "PORCION_VENCIDA" },
    );
    expect(r.montoRecargo).toBeCloseTo(2074.72, 2);
  });
});
