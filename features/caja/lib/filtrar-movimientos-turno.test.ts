import { describe, expect, it } from "vitest";
import {
  TODOS_LOS_METODOS,
  etiquetaMetodoTipo,
  usuariosPresentes,
  metodosPresentes,
  pasaFiltroTurno,
  totalizarVisibles,
  type MovimientoFiltrable,
} from "./filtrar-movimientos-turno";

const venta: MovimientoFiltrable = {
  concepto: "Venta: Remera Lisa / M",
  metodo: "TRANSFERENCIA MERCADO PAGO",
  metodo_tipo: "TRANSFERENCIA",
  usuario: "Mara",
};

const gasto: MovimientoFiltrable = {
  concepto: "Gasto operativo: Bolsas y packaging",
  metodo: "CAJA FISICA",
  metodo_tipo: "EFECTIVO",
  usuario: "Evelyn",
};

const devolucion: MovimientoFiltrable = {
  concepto: "Devolución: Pantalón Sastrero",
  metodo: "CAJA FISICA",
  metodo_tipo: "EFECTIVO",
  usuario: "Evelyn",
};

describe("pasaFiltroTurno", () => {
  it("sin búsqueda y sin método, pasa todo", () => {
    for (const m of [venta, gasto, devolucion]) {
      expect(pasaFiltroTurno(m, "", TODOS_LOS_METODOS)).toBe(true);
    }
  });

  it("busca sin acentos: quien cuenta plata tipea rápido", () => {
    // Es el caso que motiva normalizar: "devolucion" tiene que encontrar
    // "Devolución", o la pantalla parece vacía y la fila se da por perdida.
    expect(pasaFiltroTurno(devolucion, "devolucion", TODOS_LOS_METODOS)).toBe(true);
    expect(pasaFiltroTurno(devolucion, "DEVOLUCIÓN", TODOS_LOS_METODOS)).toBe(true);
  });

  it("busca por concepto, por método y por usuario", () => {
    expect(pasaFiltroTurno(venta, "remera", TODOS_LOS_METODOS)).toBe(true);
    expect(pasaFiltroTurno(venta, "mercado pago", TODOS_LOS_METODOS)).toBe(true);
    expect(pasaFiltroTurno(venta, "mara", TODOS_LOS_METODOS)).toBe(true);
    expect(pasaFiltroTurno(venta, "zunilda", TODOS_LOS_METODOS)).toBe(false);
  });

  it("las palabras se buscan sueltas, en cualquier orden", () => {
    expect(pasaFiltroTurno(gasto, "bolsas evelyn", TODOS_LOS_METODOS)).toBe(true);
    expect(pasaFiltroTurno(gasto, "evelyn bolsas", TODOS_LOS_METODOS)).toBe(true);
    // Una palabra que no está tiene que romper el match entero, no alcanzar
    // con que matcheen las otras.
    expect(pasaFiltroTurno(gasto, "bolsas mara", TODOS_LOS_METODOS)).toBe(false);
  });

  it("los espacios sobrantes no filtran nada", () => {
    expect(pasaFiltroTurno(gasto, "   ", TODOS_LOS_METODOS)).toBe(true);
    expect(pasaFiltroTurno(gasto, "  bolsas  ", TODOS_LOS_METODOS)).toBe(true);
  });

  it("el método filtra por TIPO, no por el nombre del método", () => {
    // El nombre lo pone el comercio ("TRANSFERENCIA MERCADO PAGO"); el tipo es
    // lo que comparten todos los de su clase.
    expect(pasaFiltroTurno(venta, "", "TRANSFERENCIA")).toBe(true);
    expect(pasaFiltroTurno(venta, "", "EFECTIVO")).toBe(false);
    expect(pasaFiltroTurno(gasto, "", "EFECTIVO")).toBe(true);
  });

  it("búsqueda y método se aplican JUNTOS, no uno u otro", () => {
    expect(pasaFiltroTurno(gasto, "bolsas", "EFECTIVO")).toBe(true);
    expect(pasaFiltroTurno(gasto, "bolsas", "TARJETA")).toBe(false);
  });
});

describe("metodosPresentes", () => {
  it("sale de los datos, sin repetidos y ordenado", () => {
    expect(metodosPresentes([venta, gasto, devolucion])).toEqual([
      "EFECTIVO",
      "TRANSFERENCIA",
    ]);
  });

  it("un turno sin movimientos no ofrece filtros", () => {
    // Un selector con opciones que siempre dan cero enseña a desconfiar.
    expect(metodosPresentes([])).toEqual([]);
  });
});

describe("etiquetaMetodoTipo", () => {
  it("traduce los conocidos y deja pasar los que no", () => {
    expect(etiquetaMetodoTipo("BILLETERA_VIRTUAL")).toBe("Billetera virtual");
    // Los métodos los crea cada comercio: un tipo nuevo se muestra tal cual,
    // que es como la vendedora lo reconoce, en vez de esconderse.
    expect(etiquetaMetodoTipo("CRIPTO")).toBe("CRIPTO");
  });
});

describe("filtro por empleado", () => {
  it("filtra por nombre exacto, no por coincidencia parcial", () => {
    // El selector ofrece nombres que salen de los datos, así que el match es
    // exacto: "Mar" no puede traer a Mara y a Marcela a la vez.
    expect(pasaFiltroTurno(venta, "", TODOS_LOS_METODOS, "Mara")).toBe(true);
    expect(pasaFiltroTurno(venta, "", TODOS_LOS_METODOS, "Evelyn")).toBe(false);
    expect(pasaFiltroTurno(gasto, "", TODOS_LOS_METODOS, "Evelyn")).toBe(true);
  });

  it("por defecto no filtra a nadie", () => {
    // El default importa: una vendedora tiene un solo nombre y el selector no
    // se muestra, así que este parámetro llega ausente.
    expect(pasaFiltroTurno(venta, "", TODOS_LOS_METODOS)).toBe(true);
  });

  it("se combina con los otros dos filtros", () => {
    expect(pasaFiltroTurno(gasto, "bolsas", "EFECTIVO", "Evelyn")).toBe(true);
    expect(pasaFiltroTurno(gasto, "bolsas", "EFECTIVO", "Mara")).toBe(false);
  });
});

describe("usuariosPresentes", () => {
  it("sale de los datos, sin repetidos y ordenado", () => {
    expect(usuariosPresentes([venta, gasto, devolucion])).toEqual([
      "Evelyn",
      "Mara",
    ]);
  });
});

describe("totalizarVisibles", () => {
  const mov = (tipo: "INGRESO" | "EGRESO", monto: number) => ({ tipo, monto });

  it("separa lo que entró de lo que salió y da el neto", () => {
    expect(totalizarVisibles([mov("INGRESO", 48500), mov("EGRESO", 25000)])).toEqual({
      cantidad: 2,
      ingresos: 48500,
      egresos: 25000,
      neto: 23500,
    });
  });

  it("cuenta TODAS las filas visibles, incluidas las anuladas", () => {
    // El total tiene que poder verificarse sumando lo que está en pantalla.
    // Si descartara filas que se ven, quien lo sume a mano va a creer que el
    // sistema está mal. Las reglas de "cuánto cobré" viven en el arqueo.
    const visibles = [
      { tipo: "INGRESO" as const, monto: 10000, anulada: true },
      { tipo: "INGRESO" as const, monto: 5000 },
    ];
    expect(totalizarVisibles(visibles).ingresos).toBe(15000);
  });

  it("sin filas, todo en cero y no NaN", () => {
    expect(totalizarVisibles([])).toEqual({
      cantidad: 0,
      ingresos: 0,
      egresos: 0,
      neto: 0,
    });
  });

  it("un neto negativo es un hecho, no se recorta a cero", () => {
    // Pasa de verdad: filtrar por Efectivo en un turno donde salió más de lo
    // que entró. Esconderlo con Math.max sería tapar justo la señal.
    expect(totalizarVisibles([mov("EGRESO", 30000), mov("INGRESO", 5000)]).neto).toBe(
      -25000,
    );
  });
});
