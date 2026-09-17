import { esNegocioDemo } from "@/shared/lib/estado-negocio";
import { etiquetaRubro as etiquetaRubroComercial } from "@/shared/lib/rubros";

/**
 * Las métricas globales del SaaS, calculadas sobre los HECHOS que devuelve
 * `metricas_globales_comerz()`.
 *
 * Acá se decide qué cuenta y qué no. La regla que atraviesa todo: **cliente
 * es el negocio HABILITADO** (activo o en prueba). Los DEMO no son clientes
 * —los arma Comerz para mostrar el producto— y los cancelados o suspendidos
 * DEJARON de serlo: ninguno entra en los porcentajes ni en los totales de
 * uso. La RPC los manda igual, con su estado, para que el panel pueda decir
 * cuántos hay y por qué la lista de comercios tiene más filas que las
 * métricas.
 *
 * El rubro es el COMERCIAL (`negocios.rubro_comercial`), no el operativo:
 * Librería Colores opera con la plantilla de indumentaria pero ES una
 * librería, y para segmentar clientes importa lo segundo.
 *
 * Puro y sin IO: recibe el JSON de la RPC y un "ahora", y se testea sin base.
 */

export interface NegocioGlobal {
  id: string;
  nombre: string;
  estado: string;
  created_at: string;
  plan_id: string | null;
  plan_nombre: string | null;
  plan_precio: number;
  rubro: string | null;
  usuarios: number;
  productos: number;
  ventas: number;
  facturado: number;
  ventas_30d: number;
  facturado_30d: number;
  ultima_venta: string | null;
}

export interface PlanGlobal {
  id: string;
  nombre: string;
  precio_mensual: number;
}

export interface MetricasGlobalesCrudas {
  negocios: NegocioGlobal[];
  planes: PlanGlobal[];
  usuarios: {
    total: number;
    activos_7d: number;
    activos_30d: number;
    por_rol: Record<string, number>;
  };
  catalogo: {
    productos: number;
    variantes: number;
    clientes: number;
    deuda_cc_viva: number;
  };
  ventas_por_mes: { mes: string; ventas: number; facturado: number }[];
  generado_en: string;
}

export interface Reparto {
  clave: string;
  etiqueta: string;
  cantidad: number;
  /** 0–100 sobre el total del reparto. 0 si el total es 0. */
  porcentaje: number;
}

export interface ResumenGlobal {
  locales: {
    total: number;
    activos: number;
    enPrueba: number;
    demos: number;
    /** Suspendidos + cancelados: los que dejaron de trabajar. */
    inactivos: number;
    /** Habilitados (activo + prueba): la base de clientes de todos los
     * porcentajes. Sin demo y sin inactivos. */
    clientes: number;
  };
  /** Cómo se reparten los CLIENTES (habilitados) entre los planes. Incluye
   * los planes con cero y una fila "Sin plan" si hace falta. */
  planes: Reparto[];
  /** MRR de los que pagan (estado activo), a precio de lista. */
  mrr: number;
  /** Rubros COMERCIALES de los clientes (habilitados). */
  rubros: Reparto[];
  ventas: {
    cantidad: number;
    monto: number;
    cantidad30d: number;
    monto30d: number;
    /** Monto / cantidad histórico. null sin ventas. */
    ticketPromedio: number | null;
    /** Clientes con al menos una venta en los últimos 30 días. */
    negociosVendiendo30d: number;
    /** Negocios habilitados (activo o prueba) que NO vendieron en 30 días:
     * pagan o prueban, pero no usan. Es la lista para llamar. */
    negociosSinVender30d: { id: string; nombre: string; estado: string }[];
  };
  usuarios: MetricasGlobalesCrudas["usuarios"] & {
    /** activos_30d / total, 0–100. */
    porcentajeActivos30d: number;
  };
  catalogo: MetricasGlobalesCrudas["catalogo"] & {
    /** Promedio de productos por cliente, null sin clientes. */
    productosPorNegocio: number | null;
  };
  ventasPorMes: MetricasGlobalesCrudas["ventas_por_mes"];
  /** Por cliente (habilitados), ordenado por facturado histórico descendente. */
  ranking: NegocioGlobal[];
}

/** El nombre del rubro comercial, el mismo que ve quien se da de alta. */
export function etiquetaRubro(rubro: string | null): string {
  return etiquetaRubroComercial(rubro);
}

function porcentaje(parte: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((parte / total) * 1000) / 10;
}

/** Agrupa y devuelve el reparto ordenado por cantidad descendente. */
function repartir<T>(
  items: T[],
  clave: (item: T) => string,
  etiqueta: (clave: string) => string,
  clavesFijas: string[] = [],
): Reparto[] {
  const conteo = new Map<string, number>();
  for (const k of clavesFijas) conteo.set(k, 0);
  for (const item of items) {
    const k = clave(item);
    conteo.set(k, (conteo.get(k) ?? 0) + 1);
  }
  const total = items.length;
  return [...conteo.entries()]
    .map(([k, cantidad]) => ({
      clave: k,
      etiqueta: etiqueta(k),
      cantidad,
      porcentaje: porcentaje(cantidad, total),
    }))
    .sort((a, b) => b.cantidad - a.cantidad || a.etiqueta.localeCompare(b.etiqueta));
}

export function resumirMetricasGlobales(
  crudas: MetricasGlobalesCrudas,
): ResumenGlobal {
  const todos = crudas.negocios;
  const activos = todos.filter((n) => n.estado === "activo");
  const enPrueba = todos.filter((n) => n.estado === "prueba");
  const demos = todos.filter((n) => esNegocioDemo(n.estado));
  const inactivos = todos.filter(
    (n) =>
      !esNegocioDemo(n.estado) &&
      n.estado !== "activo" &&
      n.estado !== "prueba",
  );
  const clientes = [...activos, ...enPrueba];

  const nombrePlan = new Map(crudas.planes.map((p) => [p.id, p.nombre]));
  const planes = repartir(
    clientes,
    (n) => n.plan_id ?? "sin-plan",
    (k) => (k === "sin-plan" ? "Sin plan" : (nombrePlan.get(k) ?? "Plan borrado")),
    crudas.planes.map((p) => p.id),
  ).filter((r) => r.clave !== "sin-plan" || r.cantidad > 0);

  const rubros = repartir(
    clientes,
    (n) => n.rubro ?? "sin-rubro",
    (k) => (k === "sin-rubro" ? "Sin rubro" : etiquetaRubro(k)),
  );

  const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const cantidad = suma(clientes.map((n) => n.ventas));
  const monto = suma(clientes.map((n) => n.facturado));

  return {
    locales: {
      total: todos.length,
      activos: activos.length,
      enPrueba: enPrueba.length,
      demos: demos.length,
      inactivos: inactivos.length,
      clientes: clientes.length,
    },
    planes,
    mrr: suma(activos.map((n) => n.plan_precio)),
    rubros,
    ventas: {
      cantidad,
      monto,
      cantidad30d: suma(clientes.map((n) => n.ventas_30d)),
      monto30d: suma(clientes.map((n) => n.facturado_30d)),
      ticketPromedio: cantidad > 0 ? monto / cantidad : null,
      negociosVendiendo30d: clientes.filter((n) => n.ventas_30d > 0).length,
      negociosSinVender30d: clientes
        .filter((n) => n.ventas_30d === 0)
        .map((n) => ({ id: n.id, nombre: n.nombre, estado: n.estado })),
    },
    usuarios: {
      ...crudas.usuarios,
      porcentajeActivos30d: porcentaje(
        crudas.usuarios.activos_30d,
        crudas.usuarios.total,
      ),
    },
    catalogo: {
      ...crudas.catalogo,
      productosPorNegocio:
        clientes.length > 0
          ? Math.round(crudas.catalogo.productos / clientes.length)
          : null,
    },
    ventasPorMes: crudas.ventas_por_mes,
    ranking: [...clientes].sort((a, b) => b.facturado - a.facturado),
  };
}
