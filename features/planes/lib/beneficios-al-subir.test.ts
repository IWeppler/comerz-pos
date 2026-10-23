import { describe, expect, it } from "vitest";
import { beneficiosAlSubir, planQueSubeElLimite } from "./beneficios-al-subir";
import type { ReglasPlan } from "@/shared/lib/planes";

// Las reglas reales de producción al 14/8/2026. Si alguien cambia un plan en
// la base, estos tests no lo detectan — pero sí protegen la forma en que se
// traduce a texto, que es donde estuvo el error.
const EMPRENDEDOR: ReglasPlan = {
  max_usuarios: 1,
  max_sucursales: 1,
  max_clientes_cuenta_corriente: 50,
  max_productos: 1000,
  max_ventas_mensuales: 500,
  features: [
    "pos",
    "caja",
    "ventas",
    "stock",
    "catalogo_publico",
    "clientes",
    "cuenta_corriente",
    "tickets",
    "historial_ventas",
    "insights_basico",
    "resumen_semanal",
  ],
};

const GESTION: ReglasPlan = {
  max_usuarios: 5,
  max_sucursales: 1,
  max_clientes_cuenta_corriente: 250,
  max_productos: 5000,
  max_ventas_mensuales: 5000,
  features: [
    ...(EMPRENDEDOR.features ?? []),
    "reportes",
    "reportes_exportar",
    "multicaja",
    "roles",
    "auditoria",
    "facturacion_electronica",
    "catalogo_sin_marca",
  ],
};

const EMPRESA: ReglasPlan = {
  max_usuarios: 99,
  max_sucursales: 10,
  max_clientes_cuenta_corriente: null,
  max_productos: null,
  max_ventas_mensuales: null,
  features: [...(GESTION.features ?? []), "cuenta_corriente_ilimitada", "api"],
};

describe("beneficiosAlSubir", () => {
  it("dice el número real de clientes de cuenta corriente, no 'sin límites'", () => {
    // EL bug que motivó el módulo: Gestión tiene tope de 250, no ilimitado.
    const titulos = beneficiosAlSubir(GESTION, EMPRENDEDOR).map((b) => b.titulo);

    expect(titulos).toContain("Hasta 250 clientes con cuenta corriente");
    expect(titulos).not.toContain("Clientes con cuenta corriente sin límite");
  });

  it("el tope de productos sube en Gestión y desaparece en Empresa, y se dice así", () => {
    // Un límite que sube y otro que desaparece de verdad: que convivan es lo que
    // obliga a que el texto salga de las reglas y no de una redacción única.
    const aGestion = beneficiosAlSubir(GESTION, EMPRENDEDOR).find((x) =>
      x.titulo.includes("roductos"),
    );
    expect(aGestion?.titulo).toBe("Hasta 5000 productos");
    expect(aGestion?.detalle).toBe("Hoy tu plan permite 1000.");

    const aEmpresa = beneficiosAlSubir(EMPRESA, GESTION).find((x) =>
      x.titulo.includes("roductos"),
    );
    expect(aEmpresa?.titulo).toBe("Productos sin límite");
    expect(aEmpresa?.detalle).toBe("Hoy tenés hasta 5000.");
  });

  it("compara contra el plan de hoy", () => {
    const usuarios = beneficiosAlSubir(GESTION, EMPRENDEDOR).find((b) =>
      b.titulo.includes("usuarios"),
    );
    expect(usuarios?.titulo).toBe("Hasta 5 usuarios");
    expect(usuarios?.detalle).toBe("Hoy tu plan permite 1.");
  });

  it("lista las features que suma y ninguna de las que ya tiene", () => {
    const titulos = beneficiosAlSubir(GESTION, EMPRENDEDOR).map((b) => b.titulo);

    expect(titulos).toContain("Reportes de ventas y productos");
    expect(titulos).toContain("Múltiples cajas");
    expect(titulos).toContain("Roles de usuarios");
    // Ya las tiene: repetirlas haría parecer que se pagan dos veces.
    expect(titulos).not.toContain("Punto de venta");
    expect(titulos).not.toContain("Control de stock");
  });

  it("un límite que no sube no ocupa un renglón", () => {
    // Las dos tienen 1 sucursal: ofrecerlo como mejora sería mentir por omisión.
    const titulos = beneficiosAlSubir(GESTION, EMPRENDEDOR).map((b) => b.titulo);
    expect(titulos.some((t) => t.includes("sucursal"))).toBe(false);
  });

  it("'sin límite' aparece solo donde de verdad no hay tope", () => {
    const beneficios = beneficiosAlSubir(EMPRESA, GESTION);
    const cc = beneficios.find((b) => b.titulo.includes("cuenta corriente"));

    expect(cc?.titulo).toBe("Clientes con cuenta corriente sin límite");
    expect(cc?.detalle).toBe("Hoy tenés hasta 250.");
  });

  it("sin plan actual muestra el destino sin comparar", () => {
    const beneficios = beneficiosAlSubir(GESTION, {});
    const usuarios = beneficios.find((b) => b.titulo.includes("usuarios"));

    expect(usuarios?.titulo).toBe("Hasta 5 usuarios");
    expect(usuarios?.detalle).toBeUndefined();
  });
});

// El contexto real tiene un plan repetido por cada feature que incluye; se
// arma igual acá para que la deduplicación por nombre quede ejercitada.
function contextoCon(
  planes: { nombre: string; precio_mensual: number; reglas: typeof GESTION }[],
) {
  const planMinimoPorFeature: Record<string, (typeof planes)[number]> = {};
  for (const plan of planes) {
    for (const feature of plan.reglas.features ?? []) {
      planMinimoPorFeature[feature] ??= plan;
    }
  }
  return { planMinimoPorFeature };
}

const CONTEXTO = contextoCon([
  { nombre: "Emprendedor", precio_mensual: 30000, reglas: EMPRENDEDOR },
  { nombre: "Gestión", precio_mensual: 50000, reglas: GESTION },
  { nombre: "Empresa", precio_mensual: 70000, reglas: EMPRESA },
]);

describe("planQueSubeElLimite", () => {
  it("desde Emprendedor (1 usuario) ofrece Gestión, no Empresa", () => {
    // El más barato que sirve: subir un escalón, no venderle el tope.
    expect(planQueSubeElLimite(CONTEXTO, "max_usuarios", 1)).toEqual({
      nombre: "Gestión",
      limite: 5,
    });
  });

  it("desde Gestión (5 usuarios) ofrece Empresa", () => {
    // El caso de Evens hoy: 5 de 5 con plan Gestión.
    expect(planQueSubeElLimite(CONTEXTO, "max_usuarios", 5)).toEqual({
      nombre: "Empresa",
      limite: 99,
    });
  });

  it("ofrece el plan que sube ESE límite, no el siguiente de la lista", () => {
    // Sucursales: Gestión sigue en 1, así que el que sirve es Empresa aunque
    // Gestión sea el inmediato siguiente en precio.
    expect(planQueSubeElLimite(CONTEXTO, "max_sucursales", 1)).toEqual({
      nombre: "Empresa",
      limite: 10,
    });
  });

  it("reconoce el ilimitado como límite null, no como ausente", () => {
    expect(
      planQueSubeElLimite(CONTEXTO, "max_clientes_cuenta_corriente", 250),
    ).toEqual({ nombre: "Empresa", limite: null });
  });

  it("en el plan más alto no hay a dónde subir", () => {
    // Devuelve null y no un upgrade que no cambiaría nada: ese caso necesita
    // otra respuesta ("escribinos"), no un botón.
    expect(planQueSubeElLimite(CONTEXTO, "max_usuarios", 99)).toBeNull();
  });

  it("sin contexto no inventa un plan", () => {
    expect(planQueSubeElLimite(null, "max_usuarios", 1)).toBeNull();
  });
});

describe("ventas por mes (tope blando)", () => {
  it("al subir de Emprendedor a Gestión se dice con el número", () => {
    const b = beneficiosAlSubir(GESTION, EMPRENDEDOR);
    expect(b).toContainEqual({
      titulo: "Hasta 5000 ventas por mes",
      detalle: "Hoy tu plan permite 500.",
    });
  });

  it("de Gestión a Empresa pasa a sin tope", () => {
    const b = beneficiosAlSubir(EMPRESA, GESTION);
    expect(b).toContainEqual({
      titulo: "Ventas por mes sin límite",
      detalle: "Hoy tenés hasta 5000.",
    });
  });
});
