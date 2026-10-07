export type AlcancePrecio = "TODOS" | "CATEGORIA" | "SELECCION" | "MARCA" | "REMITO";
export type OperacionPrecio = "AUMENTAR_PORCENTAJE" | "REDUCIR_PORCENTAJE" | "FIJAR_MARGEN" | "REMITO";
export type CampoObjetivo = "PRECIO" | "COSTO" | "AMBOS";
export type TipoRedondeo = "SIN_REDONDEO" | "10" | "50" | "100" | "90" | "99";
export interface ReglaPrecio {
  alcance: AlcancePrecio; campo: CampoObjetivo; operacion: OperacionPrecio;
  valor: number; redondeo: TipoRedondeo; valorAlcance?: string;
}

type Decimal = { numerador: bigint; denominador: bigint };
const CERO = BigInt(0);
const UNO = BigInt(1);
const DOS = BigInt(2);
const CIEN = BigInt(100);

/** Trabaja con el decimal escrito, sin los errores binarios de 1.005 * 100. */
function decimal(valor: number): Decimal {
  const [mantisa, exponente = "0"] = String(valor).toLowerCase().split("e");
  const decimales = mantisa.split(".")[1]?.length ?? 0;
  const escala = decimales - Number(exponente);
  const digitos = BigInt(mantisa.replace(".", ""));
  return escala >= 0
    ? { numerador: digitos, denominador: BigInt(10) ** BigInt(escala) }
    : { numerador: digitos * BigInt(10) ** BigInt(-escala), denominador: UNO };
}

function multiplicar(a: Decimal, b: Decimal): Decimal {
  return { numerador: a.numerador * b.numerador, denominador: a.denominador * b.denominador };
}

function piso(numerador: bigint, denominador: bigint): bigint {
  const entero = numerador / denominador;
  return numerador % denominador < CERO ? entero - UNO : entero;
}

function centavos(valor: Decimal): number {
  const signo = valor.numerador < CERO ? -UNO : UNO;
  const n = valor.numerador * signo * CIEN;
  // NUMERIC de Postgres redondea los empates alejándose del cero.
  return Number(signo * ((n * DOS + valor.denominador) / (valor.denominador * DOS))) / 100;
}

function redondearDecimal(valor: Decimal, tipo: TipoRedondeo): number {
  if (tipo === "SIN_REDONDEO") return centavos(valor);
  if (tipo === "90" || tipo === "99") {
    return Number(piso(valor.numerador, valor.denominador * CIEN) * CIEN) + Number(tipo);
  }
  const multiplo = BigInt(tipo);
  return Number(-piso(-valor.numerador, valor.denominador * multiplo) * multiplo);
}

/** Espejo de calcular_ajuste_precio en SQL; los casos viven en ajuste-precios-casos.json. */
export function aplicarRedondeo(valor: number, tipo: TipoRedondeo): number {
  return redondearDecimal(decimal(valor), tipo);
}

export function calcularAjuste(costo: number | null, precio: number | null, regla: ReglaPrecio) {
  const porcentaje = decimal(regla.valor);
  const denominador = porcentaje.denominador * CIEN;
  const factor: Decimal = {
    numerador: denominador + (regla.operacion === "AUMENTAR_PORCENTAJE" ? porcentaje.numerador
      : regla.operacion === "REDUCIR_PORCENTAJE" ? -porcentaje.numerador : CERO),
    denominador,
  };
  // La base guarda centavos. Redondear costo antes de usarlo evita diferencias con SQL.
  const nuevoCosto = costo === null || regla.campo === "PRECIO" ? costo
    : centavos(multiplicar(decimal(costo), factor));
  const base = regla.operacion === "FIJAR_MARGEN" ? decimal(nuevoCosto ?? 0) : decimal(precio ?? 0);
  const factorPrecio = regla.operacion === "FIJAR_MARGEN"
    ? { numerador: denominador + porcentaje.numerador, denominador } : factor;
  const nuevoPrecio = regla.campo === "COSTO" ? precio
    : redondearDecimal(multiplicar(base, factorPrecio), regla.redondeo);
  return { costo: nuevoCosto, precio: nuevoPrecio };
}

/**
 * "Recargo sobre costo" sobre un producto sin costo deja el precio en $0, y el
 * POS y el catálogo lo venderían a $0 (Librería Colores tiene 795 productos sin
 * costo, 7/10/2026). Devuelve el mensaje para frenar la simulación, o null.
 * Espejo de SIN_COSTO_PARA_RECARGO en `aplicar_ajuste_precios`.
 */
export function productosSinCostoParaRecargo(
  regla: Pick<ReglaPrecio, "operacion">,
  productos: { nombre: string | null; precio_costo: number | string | null }[],
): string | null {
  if (regla.operacion !== "FIJAR_MARGEN") return null;
  const sinCosto = productos.filter((p) => !(Number(p.precio_costo) > 0));
  if (sinCosto.length === 0) return null;
  const nombres = sinCosto
    .map((p) => p.nombre?.trim() || "Sin nombre")
    .sort((a, b) => a.localeCompare(b, "es"))
    .slice(0, 5)
    .join(", ");
  const resto = sinCosto.length > 5 ? ` y ${sinCosto.length - 5} más` : "";
  return `${sinCosto.length} producto${sinCosto.length === 1 ? "" : "s"} no ${sinCosto.length === 1 ? "tiene" : "tienen"} costo cargado y ${sinCosto.length === 1 ? "quedaría" : "quedarían"} en $0 (${nombres}${resto}). Cargales el costo o sacalos del alcance.`;
}

export function validarReglaPrecio(regla: ReglaPrecio): string | null {
  if (!["TODOS", "CATEGORIA", "SELECCION", "MARCA"].includes(regla.alcance)
    || !["PRECIO", "COSTO", "AMBOS"].includes(regla.campo)
    || !["AUMENTAR_PORCENTAJE", "REDUCIR_PORCENTAJE", "FIJAR_MARGEN"].includes(regla.operacion)
    || !["SIN_REDONDEO", "10", "50", "100", "90", "99"].includes(regla.redondeo)
    || !Number.isFinite(regla.valor) || regla.valor < 0 || regla.valor >= 1e10
    || Math.abs(regla.valor * 100 - Math.round(regla.valor * 100)) > 1e-6) {
    return "Revisá la regla y el porcentaje (hasta dos decimales).";
  }
  if (regla.operacion === "REDUCIR_PORCENTAJE" && regla.valor > 100) return "La reducción no puede superar el 100%.";
  if (regla.operacion === "FIJAR_MARGEN" && regla.campo === "COSTO") return "El recargo sobre costo se aplica al precio de venta.";
  if (["MARCA", "CATEGORIA"].includes(regla.alcance) && (!regla.valorAlcance?.trim() || regla.valorAlcance === "todos"))
    return "Elegí la marca o categoría para actualizar.";
  return null;
}
