import { validarAliasTransferencia } from "@/features/clients/lib/alias-transferencia";
import { esCuitValido, normalizarCuit } from "@/shared/lib/cuit";

/**
 * Validación de la pantalla Cobros (configuración de la tienda online).
 *
 * Espeja los CHECK de `configuracion_pos` (20261012133049): la base los
 * rechaza igual, acá se avisa con un mensaje que se entiende. El alias usa el
 * MISMO validador que el alias del resumen de CC (6 a 20 letras, números, punto
 * o guion, o un CVU de 22 dígitos): un criterio, un módulo.
 *
 * Reglas de negocio (docs/pagos-auditoria.md §11):
 *   - los dos medios dependen de la cuenta de Mercado Pago CONECTADA: la
 *     transferencia va a su alias y el checkout cobra con su token;
 *   - la transferencia necesita el alias cargado, si no la clienta no tiene a
 *     dónde transferir.
 */

export const OPCIONES_VENCE_TRANSFERENCIA = [60, 90, 120, 180, 240] as const;
export const OPCIONES_VENCE_MP = [30, 60, 120] as const;

export interface EntradaCobros {
  cobroTransferencia: boolean;
  cobroMercadoPago: boolean;
  aliasMercadoPago: string;
  titular: string;
  /** CVU de 22 dígitos; vacío = no se muestra. */
  cvu: string;
  /** CUIT del titular; vacío = no se muestra. */
  cuitTitular: string;
  minutosVenceTransferencia: number;
  minutosVenceMp: number;
}

export interface CobrosValidados {
  cobro_online_transferencia: boolean;
  cobro_online_mp: boolean;
  alias_mercadopago_tienda: string | null;
  transferencia_titular: string | null;
  transferencia_cvu: string | null;
  transferencia_cuit: string | null;
  minutos_vence_transferencia: number;
  minutos_vence_mp: number;
}

export type ResultadoValidacion =
  | { ok: true; valores: CobrosValidados }
  | { ok: false; error: string };

export function validarCobros(
  entrada: EntradaCobros,
  { mercadoPagoConectado }: { mercadoPagoConectado: boolean },
): ResultadoValidacion {
  const alias = validarAliasTransferencia(entrada.aliasMercadoPago ?? "");
  if (!alias.ok) return { ok: false, error: alias.error };

  const titular = (entrada.titular ?? "").trim().replace(/\s+/g, " ");
  if (titular !== "" && (titular.length < 2 || titular.length > 80)) {
    return { ok: false, error: "El titular tiene que tener entre 2 y 80 caracteres." };
  }

  const cvu = (entrada.cvu ?? "").replace(/\D/g, "");
  if (cvu !== "" && cvu.length !== 22) {
    return { ok: false, error: "El CVU tiene 22 números. Copialo de tu Mercado Pago (Tu dinero › Datos de la cuenta)." };
  }
  const cuit = normalizarCuit(entrada.cuitTitular);
  if (cuit !== "" && !esCuitValido(cuit)) {
    return { ok: false, error: "El CUIT del titular no es válido: revisá los 11 números." };
  }

  const venceTransf = Number(entrada.minutosVenceTransferencia);
  if (!(OPCIONES_VENCE_TRANSFERENCIA as readonly number[]).includes(venceTransf)) {
    return { ok: false, error: "Elegí cuánto espera una transferencia antes de vencer." };
  }
  const venceMp = Number(entrada.minutosVenceMp);
  if (!(OPCIONES_VENCE_MP as readonly number[]).includes(venceMp)) {
    return { ok: false, error: "Elegí cuánto espera un pago con Mercado Pago antes de vencer." };
  }

  const algunMedio = entrada.cobroTransferencia || entrada.cobroMercadoPago;
  if (algunMedio && !mercadoPagoConectado) {
    return {
      ok: false,
      error: "Primero conectá tu Mercado Pago: los dos medios cobran en esa cuenta.",
    };
  }
  if (entrada.cobroTransferencia && !alias.valor) {
    return {
      ok: false,
      error: "Para cobrar por transferencia cargá el alias o CVU de tu Mercado Pago.",
    };
  }

  return {
    ok: true,
    valores: {
      cobro_online_transferencia: entrada.cobroTransferencia,
      cobro_online_mp: entrada.cobroMercadoPago,
      alias_mercadopago_tienda: alias.valor,
      transferencia_titular: titular === "" ? null : titular,
      transferencia_cvu: cvu === "" ? null : cvu,
      transferencia_cuit: cuit === "" ? null : cuit,
      minutos_vence_transferencia: venceTransf,
      minutos_vence_mp: venceMp,
    },
  };
}

/** "2 h", "1 h 30 min", "30 min": para los selects. */
export function etiquetaMinutos(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
