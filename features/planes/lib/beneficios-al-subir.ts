import { NOMBRE_FEATURE, type ReglasPlan } from "@/shared/lib/planes";

/**
 * Qué se gana al pasar del plan actual al plan destino.
 *
 * Se DERIVA de las reglas de los dos planes, nunca de una lista escrita a
 * mano, y ese es todo el punto del módulo. El texto suelto se despega de la
 * realidad sin que nadie se entere: el paywall llegó a ofrecer "cuenta
 * corriente sin límites" para el plan Gestión, que tiene 250 clientes — la
 * ilimitada es de Empresa. Un comerciante que paga por eso y después descubre
 * el tope tiene razón en estar enojado.
 *
 * Por eso los límites se dicen con el NÚMERO y contra el de hoy ("de 75 a 250
 * clientes"), no con adjetivos. "Más clientes" es exactamente la clase de
 * promesa que después no se puede sostener.
 *
 * Puro y sin IO: la matriz de planes se testea sin base.
 */

export interface BeneficioPlan {
  titulo: string;
  /** El "de X a Y" cuando el beneficio es un límite que sube. */
  detalle?: string;
}

/** Límite sin tope. En la base es `null`, que hay que distinguir de "no
 * declarado": los dos llegan como null, pero solo el declarado es ilimitado.
 * Se resuelve mirando si la clave existe en el objeto. */
function esIlimitado(reglas: ReglasPlan, clave: keyof ReglasPlan): boolean {
  return clave in reglas && reglas[clave] === null;
}

function describirLimite(
  actual: number | null | undefined,
  destino: number | null | undefined,
  reglasDestino: ReglasPlan,
  clave: keyof ReglasPlan,
  singular: string,
  plural: string,
): BeneficioPlan | null {
  if (esIlimitado(reglasDestino, clave)) {
    return {
      titulo: `${plural.charAt(0).toUpperCase()}${plural.slice(1)} sin límite`,
      detalle: typeof actual === "number" ? `Hoy tenés hasta ${actual}.` : undefined,
    };
  }

  if (typeof destino !== "number") return null;
  // Solo es un beneficio si sube. Un plan que no mueve el número no tiene por
  // qué ocupar un renglón de la lista.
  if (typeof actual === "number" && destino <= actual) return null;

  return {
    titulo: `Hasta ${destino} ${destino === 1 ? singular : plural}`,
    detalle:
      typeof actual === "number"
        ? `Hoy tu plan permite ${actual}.`
        : undefined,
  };
}

/**
 * El plan más barato que sube UN límite puntual por encima del actual.
 *
 * Es lo que hace que el CTA de "llegaste al tope de usuarios" ofrezca el plan
 * que da más usuarios, y no simplemente el siguiente de la lista: a quien se
 * le llenó el cupo de gente no le sirve que le ofrezcan reportes.
 *
 * Recorre `planMinimoPorFeature` porque es el único lugar donde ya viajan las
 * reglas de todos los planes; el mismo plan aparece repetido bajo varias
 * features y por eso se deduplica por nombre. Devuelve null cuando ninguno
 * mejora el límite — el caso del que ya está en el plan más alto, que necesita
 * una respuesta distinta ("escribinos") y no un botón de upgrade que no
 * cambiaría nada.
 */
export function planQueSubeElLimite(
  contexto: {
    planMinimoPorFeature: Record<
      string,
      { nombre: string; precio_mensual: number; reglas: ReglasPlan }
    >;
  } | null,
  clave: keyof ReglasPlan,
  limiteActual: number,
): { nombre: string; limite: number | null } | null {
  if (!contexto) return null;

  const candidatos = new Map<
    string,
    { nombre: string; precio: number; limite: number | null }
  >();

  for (const plan of Object.values(contexto.planMinimoPorFeature)) {
    if (candidatos.has(plan.nombre)) continue;

    const valor = plan.reglas[clave];
    const ilimitado = esIlimitado(plan.reglas, clave);
    if (!ilimitado && (typeof valor !== "number" || valor <= limiteActual)) {
      continue;
    }

    candidatos.set(plan.nombre, {
      nombre: plan.nombre,
      precio: plan.precio_mensual,
      limite: ilimitado ? null : (valor as number),
    });
  }

  // El más barato de los que sirven: subir un escalón, no el más caro.
  const ordenados = [...candidatos.values()].sort((a, b) => a.precio - b.precio);
  const elegido = ordenados[0];
  return elegido ? { nombre: elegido.nombre, limite: elegido.limite } : null;
}

export function beneficiosAlSubir(
  reglasDestino: ReglasPlan,
  reglasActuales: ReglasPlan,
): BeneficioPlan[] {
  const beneficios: BeneficioPlan[] = [];

  const usuarios = describirLimite(
    reglasActuales.max_usuarios,
    reglasDestino.max_usuarios,
    reglasDestino,
    "max_usuarios",
    "usuario",
    "usuarios",
  );
  if (usuarios) beneficios.push(usuarios);

  const clientesCc = describirLimite(
    reglasActuales.max_clientes_cuenta_corriente,
    reglasDestino.max_clientes_cuenta_corriente,
    reglasDestino,
    "max_clientes_cuenta_corriente",
    "cliente con cuenta corriente",
    "clientes con cuenta corriente",
  );
  if (clientesCc) beneficios.push(clientesCc);

  const productos = describirLimite(
    reglasActuales.max_productos,
    reglasDestino.max_productos,
    reglasDestino,
    "max_productos",
    "producto",
    "productos",
  );
  if (productos) beneficios.push(productos);

  const ventas = describirLimite(
    reglasActuales.max_ventas_mensuales,
    reglasDestino.max_ventas_mensuales,
    reglasDestino,
    "max_ventas_mensuales",
    "venta por mes",
    "ventas por mes",
  );
  if (ventas) beneficios.push(ventas);

  const sucursales = describirLimite(
    reglasActuales.max_sucursales,
    reglasDestino.max_sucursales,
    reglasDestino,
    "max_sucursales",
    "sucursal",
    "sucursales",
  );
  if (sucursales) beneficios.push(sucursales);

  // Las features que el plan destino suma y el actual no tiene. Se listan con
  // el nombre del catálogo (NOMBRE_FEATURE) y en el orden en que vienen del
  // plan, que es el orden en que están pensadas para leerse.
  const actuales = new Set(reglasActuales.features ?? []);
  for (const feature of reglasDestino.features ?? []) {
    if (actuales.has(feature)) continue;
    beneficios.push({ titulo: NOMBRE_FEATURE[feature] ?? feature });
  }

  return beneficios;
}
