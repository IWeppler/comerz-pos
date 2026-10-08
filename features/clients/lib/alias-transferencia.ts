/**
 * Alias o CBU/CVU para que los clientes transfieran
 * (`configuracion_pos.alias_transferencia`).
 *
 * Espejo del CHECK de la base (20261008200000): alias de 6 a 20 letras,
 * números, punto o guion, o CBU/CVU de 22 dígitos. La base lo rechaza igual;
 * acá se avisa con un mensaje que se entiende y se limpia lo que se pega con
 * espacios.
 */
export type ResultadoAlias =
  | { ok: true; valor: string | null }
  | { ok: false; error: string };

const PATRON_ALIAS = /^[A-Za-z0-9.-]{6,20}$/;
const PATRON_CBU = /^[0-9]{22}$/;

export function validarAliasTransferencia(entrada: string): ResultadoAlias {
  // Se pega desde el home banking con espacios ("0000 0031 ..."): se sacan.
  const valor = entrada.replace(/\s+/g, "");
  if (valor === "") return { ok: true, valor: null };
  if (PATRON_ALIAS.test(valor) || PATRON_CBU.test(valor)) {
    return { ok: true, valor };
  }
  return {
    ok: false,
    error:
      "El alias tiene que tener de 6 a 20 letras, números, puntos o guiones (o un CBU/CVU de 22 números).",
  };
}
