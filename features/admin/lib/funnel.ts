/**
 * El funnel de Comerz: registro → activación → pago.
 *
 * Las cuentas viven acá y no en la RPC porque tienen criterios discutibles que
 * conviene poder leer y probar: qué cuenta como "activado", a quién se excluye
 * del promedio, cuándo un comercio está en riesgo. La base devuelve fechas
 * crudas; el significado se decide en este archivo.
 */

import { esNegocioDemo } from "@/shared/lib/estado-negocio";
import type { OrigenAlta } from "@/shared/lib/origen-alta";

export interface FilaFunnel {
  id: string;
  nombre: string;
  estado: string;
  /** Alta del negocio en Comerz. */
  alta: string;
  primeraVenta: string | null;
  ultimaVenta: string | null;
  ventasTotal: number;
  pagos: number;
  primerPago: string | null;
  /** De dónde vino (`negocios.origen_alta`). `null` = no se sabe: los
   * anteriores al 23/10/2026 y los que llegaron sin link con origen. */
  origen: OrigenAlta | null;
  /** A quién corresponde el `ref`: el nombre del comercio o del socio. `null`
   * si no vino ref o el código no es de nadie. Lo resuelve la RPC. */
  referidoPor: string | null;
}

export interface ComercioEnFunnel extends FilaFunnel {
  /**
   * Su primera venta es ANTERIOR al alta: venía usando otra cosa y se migró.
   *
   * Importa separarlos porque su "activación" ya había ocurrido antes de
   * existir en Comerz. Meterlos en el promedio de días hasta la primera venta
   * daría números negativos y un promedio que no describe a nadie.
   */
  migrado: boolean;
  /** Vendió alguna vez. Es la definición de activado en un POS: el producto
   * sirve para vender, y quien nunca vendió nunca lo usó de verdad. */
  activado: boolean;
  /** Días entre el alta y la primera venta. `null` si nunca vendió o si es
   * migrado (ahí la cuenta no significa nada). */
  diasHastaActivacion: number | null;
  /** Días desde la última venta. `null` si nunca vendió. Es el indicador
   * ADELANTADO de baja: el churn avisa cuando ya perdiste al cliente. */
  diasSinVender: number | null;
  pago: boolean;
}

const DIA = 86_400_000;

const dias = (desde: string, hasta: number): number =>
  Math.floor((hasta - new Date(desde).getTime()) / DIA);

export function analizarFunnel(
  filas: FilaFunnel[],
  ahora: Date = new Date(),
): ComercioEnFunnel[] {
  const t = ahora.getTime();

  return filas.map((f) => {
    const migrado =
      f.primeraVenta !== null &&
      new Date(f.primeraVenta).getTime() < new Date(f.alta).getTime();

    return {
      ...f,
      migrado,
      activado: f.primeraVenta !== null,
      diasHastaActivacion:
        f.primeraVenta === null || migrado
          ? null
          : Math.max(0, dias(f.alta, new Date(f.primeraVenta).getTime())),
      diasSinVender: f.ultimaVenta === null ? null : dias(f.ultimaVenta, t),
      pago: f.pagos > 0,
    };
  });
}

export interface ResumenFunnel {
  registrados: number;
  activados: number;
  pagaron: number;
  /** Sobre los registrados. `null` sin registrados: dividir por cero. */
  tasaActivacion: number | null;
  /** Sobre los ACTIVADOS, no sobre los registrados: la pregunta es "de los que
   * lo usaron, cuántos pagaron". Mezclar a los que nunca lo probaron esconde
   * si el problema es el producto o el precio. */
  tasaPago: number | null;
  /** MEDIANA y no promedio: con pocos comercios, uno que tardó 40 días mueve
   * el promedio a un valor que no le pasó a nadie. `null` si nadie activó
   * desde el alta (todos migrados, o ninguno vendió). */
  medianaDiasActivacion: number | null;
  /** Cuántos vienen de otro sistema. Se informan aparte porque distorsionan
   * cualquier cohorte de activación. */
  migrados: number;
}

/** Mediana de una lista de números. Devuelve `null` si está vacía. */
function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 === 0
    ? (orden[medio - 1] + orden[medio]) / 2
    : orden[medio];
}

export function resumirFunnel(comercios: ComercioEnFunnel[]): ResumenFunnel {
  const registrados = comercios.length;
  const activados = comercios.filter((c) => c.activado).length;
  const pagaron = comercios.filter((c) => c.pago).length;

  const tiempos = comercios
    .map((c) => c.diasHastaActivacion)
    .filter((d): d is number => d !== null);

  return {
    registrados,
    activados,
    pagaron,
    tasaActivacion: registrados > 0 ? (activados / registrados) * 100 : null,
    tasaPago: activados > 0 ? (pagaron / activados) * 100 : null,
    medianaDiasActivacion: mediana(tiempos),
    migrados: comercios.filter((c) => c.migrado).length,
  };
}

/**
 * Los que hay que mirar, ordenados por urgencia.
 *
 * Un comercio que se registró y nunca vendió es el caso más grave: probó y se
 * fue sin llegar a usar el producto. Después van los que vendían y dejaron de
 * hacerlo, del que hace más que no vende al que menos.
 *
 * El umbral por defecto son 14 días: dos semanas sin una sola venta en un
 * comercio que abre todos los días no es una racha floja, es que dejó de usarlo.
 */
export function enRiesgo(
  comercios: ComercioEnFunnel[],
  umbralDias = 14,
): ComercioEnFunnel[] {
  return comercios
    .filter(
      (c) =>
        // Cancelado no: la baja ya pasó, no hay nada que salvar. El que
        // está en prueba SÍ es riesgo, y del más urgente.
        c.estado !== "cancelado" &&
        // Demo tampoco: un comercio de muestra que no vende hace 30 días no
        // es un cliente que se está yendo, es una demo entre visita y visita.
        // Y por construcción encabezaría la lista, tapando a los reales.
        !esNegocioDemo(c.estado) &&
        (!c.activado || (c.diasSinVender ?? 0) >= umbralDias),
    )
    .sort((a, b) => {
      // Nunca activado primero: es peor que dejar de vender.
      if (a.activado !== b.activado) return a.activado ? 1 : -1;
      return (b.diasSinVender ?? 0) - (a.diasSinVender ?? 0);
    });
}

export interface FilaPorOrigen {
  etiqueta: string;
  registrados: number;
  activados: number;
  pagaron: number;
}

export const SIN_ORIGEN = "Sin dato";

/**
 * De dónde vino cada comercio. El referido manda sobre la campaña: si llegó
 * con `ref`, lo trajo alguien, aunque el link también dijera `utm_source`.
 * Un `ref` que no es de nadie se muestra igual, con el código: esconderlo
 * sería perder a quien llegó por un link mal copiado.
 */
export function etiquetaOrigen(c: Pick<FilaFunnel, "origen" | "referidoPor">): string {
  const ref = c.origen?.ref;
  if (ref) return `Referido: ${c.referidoPor ?? `${ref} (código sin dueño)`}`;
  const fuente = c.origen?.utm_source;
  if (fuente) return c.origen?.utm_medium ? `${fuente} / ${c.origen.utm_medium}` : fuente;
  return SIN_ORIGEN;
}

/**
 * Registrados, activados y pagos por origen, del que más trae al que menos.
 * "Sin dato" va último siempre: son los anteriores a medir y los que llegaron
 * sin link, no un canal.
 */
export function porOrigen(comercios: ComercioEnFunnel[]): FilaPorOrigen[] {
  const grupos = new Map<string, FilaPorOrigen>();
  for (const c of comercios) {
    const etiqueta = etiquetaOrigen(c);
    const g = grupos.get(etiqueta) ?? { etiqueta, registrados: 0, activados: 0, pagaron: 0 };
    g.registrados += 1;
    if (c.activado) g.activados += 1;
    if (c.pago) g.pagaron += 1;
    grupos.set(etiqueta, g);
  }
  return [...grupos.values()].sort((a, b) => {
    if ((a.etiqueta === SIN_ORIGEN) !== (b.etiqueta === SIN_ORIGEN)) {
      return a.etiqueta === SIN_ORIGEN ? 1 : -1;
    }
    return b.registrados - a.registrados || a.etiqueta.localeCompare(b.etiqueta);
  });
}
