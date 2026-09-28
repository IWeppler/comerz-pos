import { describe, expect, it } from "vitest";
import { opcionesOrigenEgreso, superaCajaChica, type CuentaOrigen } from "./origen-egreso";

const cuentas: CuentaOrigen[] = [
  { id: "mp", codigo: "MP_1", nombre: "Mercado Pago", tipo: "BILLETERA", requiere_arqueo: false },
  { id: "puente", codigo: "POR_ACREDITAR", nombre: "Dinero por acreditar", tipo: "PUENTE_ACREDITACION", requiere_arqueo: false },
  { id: "cg", codigo: "CAJA_GENERAL", nombre: "Caja Grande", tipo: "CAJA_GENERAL", requiere_arqueo: false },
  { id: "cd", codigo: "CAJA_DIARIA", nombre: "Caja diaria", tipo: "CAJA", requiere_arqueo: true },
  { id: "banco", codigo: "TRANSF_1", nombre: "Transferencia", tipo: "BANCO", requiere_arqueo: false },
];

describe("opcionesOrigenEgreso", () => {
  it("caja chica primero, después la Caja Grande, sin el puente", () => {
    const opciones = opcionesOrigenEgreso(cuentas, { abierta: true, deOtroDia: false, disponible: 375799.3 });
    expect(opciones.map((o) => o.id)).toEqual(["cd", "cg", "mp", "banco"]);
    expect(opciones[0]).toMatchObject({ nombre: "Caja chica", deshabilitada: false, disponible: 375799.3 });
  });

  it("sin caja abierta, la caja chica no se puede elegir", () => {
    const [cajaChica] = opcionesOrigenEgreso(cuentas, { abierta: false, deOtroDia: false, disponible: null });
    expect(cajaChica.deshabilitada).toBe(true);
    expect(cajaChica.detalle).toContain("Abrí la caja");
  });

  it("con un turno de otro día, tampoco", () => {
    const [cajaChica] = opcionesOrigenEgreso(cuentas, { abierta: true, deOtroDia: true, disponible: 99200 });
    expect(cajaChica.deshabilitada).toBe(true);
    expect(cajaChica.disponible).toBeNull();
  });
});

describe("superaCajaChica", () => {
  const [cajaChica, cajaGrande] = opcionesOrigenEgreso(cuentas, {
    abierta: true,
    deOtroDia: false,
    disponible: 375799.3,
  });

  it("el caso del 26/9: 400.000 de sueldos contra 375.799 en el cajón", () => {
    expect(superaCajaChica(cajaChica, 400000)).toBe(true);
    expect(superaCajaChica(cajaChica, 150000)).toBe(false);
  });

  it("no aplica a otras cuentas", () => {
    expect(superaCajaChica(cajaGrande, 400000)).toBe(false);
  });
});
