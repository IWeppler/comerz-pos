/**
 * SPIKE de T5 (pagos): ¿una transferencia recibida en el CVU/alias de Mercado
 * Pago se puede ver por API para conciliarla sola con una orden?
 *
 * Lo que se quiere contestar con datos, no con foros (ver
 * docs/pagos-auditoria.md §10 y §11):
 *   1. ¿Aparece en `GET /v1/payments/search` con el token de la cuenta que la
 *      recibió? ¿Con qué `operation_type`, `payment_type_id` y `status`?
 *   2. ¿Trae monto y fecha exactos? (es con lo que se concilia)
 *   3. ¿Trae algo que identifique a quien transfirió o un concepto?
 *
 * Solo LEE. No crea, no modifica, no reembolsa nada. El token nunca se
 * imprime, y de la persona que pagó solo se muestra si el dato viene y sus
 * últimos 3 caracteres.
 *
 * Uso:
 *   npm run spike:mp-transferencias            (token de la app vía client_credentials)
 *   MP_SPIKE_ACCESS_TOKEN=APP_USR-... npm run spike:mp-transferencias   (otra cuenta)
 *   npm run spike:mp-transferencias -- --horas 6
 *   npm run spike:mp-transferencias -- --id 123456789   (forma completa de un pago)
 *
 * El token sale de Mercado Pago Developers › Tus integraciones › la app ›
 * Credenciales de PRODUCCIÓN de la cuenta que recibe la transferencia (el
 * sandbox no simula transferencias a CVU). También se puede poner en
 * .env.local como MP_SPIKE_ACCESS_TOKEN; no va a Vercel.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const API = "https://api.mercadopago.com";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, ".env.local"));

/**
 * El token de la cuenta a mirar. Si no viene MP_SPIKE_ACCESS_TOKEN, se pide uno
 * con `client_credentials` de la app de Comerz (MP_CLIENT_ID + MP_CLIENT_SECRET):
 * es un token de producción de la cuenta DUEÑA de la app, dura 6 h y alcanza
 * para leer sus pagos. No se imprime.
 */
async function conseguirToken(): Promise<string> {
  if (process.env.MP_SPIKE_ACCESS_TOKEN) return process.env.MP_SPIKE_ACCESS_TOKEN;
  const clientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Falta MP_SPIKE_ACCESS_TOKEN, o MP_CLIENT_ID + MP_CLIENT_SECRET de la app.");
    process.exit(1);
  }
  const respuesta = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const json = (await respuesta.json().catch(() => null)) as { access_token?: string } | null;
  if (!respuesta.ok || !json?.access_token) {
    console.error(`No se pudo pedir el token de la app (${respuesta.status}).`);
    process.exit(1);
  }
  return json.access_token;
}

let TOKEN = "";

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

async function mp(ruta: string): Promise<unknown> {
  const respuesta = await fetch(`${API}${ruta}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    // El cuerpo de error de MP no trae el token; igual se recorta.
    throw new Error(
      `${respuesta.status} en ${ruta.split("?")[0]}: ${JSON.stringify(cuerpo).slice(0, 300)}`,
    );
  }
  return cuerpo;
}

type Pago = Record<string, unknown>;

/** "viene, termina en 123" o "no viene". Nunca el dato entero. */
function presencia(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "no viene";
  const texto = String(valor);
  return `viene (…${texto.slice(-3)})`;
}

function leer(objeto: unknown, ruta: string): unknown {
  return ruta.split(".").reduce<unknown>((acc, clave) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[clave];
    return undefined;
  }, objeto);
}

function resumen(pago: Pago) {
  const fees = Array.isArray(pago.fee_details)
    ? (pago.fee_details as { amount?: number }[]).reduce((s, f) => s + (Number(f.amount) || 0), 0)
    : null;
  return {
    id: pago.id,
    creado: pago.date_created,
    aprobado: pago.date_approved,
    status: pago.status,
    status_detail: pago.status_detail,
    operation_type: pago.operation_type,
    payment_type_id: pago.payment_type_id,
    payment_method_id: pago.payment_method_id,
    monto: pago.transaction_amount,
    neto: leer(pago, "transaction_details.net_received_amount"),
    comision: fees,
    moneda: pago.currency_id,
    descripcion: pago.description ?? null,
    external_reference: pago.external_reference ?? null,
    collector_id: pago.collector_id,
    liberacion: pago.money_release_date,
    pagador_email: presencia(leer(pago, "payer.email")),
    pagador_documento: presencia(leer(pago, "payer.identification.number")),
    pagador_nombre: presencia(leer(pago, "payer.first_name")),
    punto_interaccion: leer(pago, "point_of_interaction.type") ?? null,
  };
}

/** Las claves (no los valores) de un objeto, hasta 2 niveles: la FORMA del pago. */
function forma(objeto: unknown, nivel = 0): unknown {
  if (!objeto || typeof objeto !== "object" || Array.isArray(objeto) || nivel > 1) {
    return Array.isArray(objeto) ? `array(${objeto.length})` : typeof objeto;
  }
  return Object.fromEntries(
    Object.entries(objeto as Record<string, unknown>).map(([k, v]) => [k, forma(v, nivel + 1)]),
  );
}

async function main() {
  TOKEN = await conseguirToken();
  const yo =(await mp("/users/me")) as Record<string, unknown>;
  console.log(`Cuenta: user_id ${yo.id} · sitio ${yo.site_id}\n`);

  const id = argumento("id");
  if (id) {
    const pago = (await mp(`/v1/payments/${encodeURIComponent(id)}`)) as Pago;
    console.log("Resumen:", resumen(pago));
    console.log("\nForma (claves, sin valores):", JSON.stringify(forma(pago), null, 2));
    return;
  }

  const horas = Math.max(1, Math.min(24 * 30, Number(argumento("horas")) || 24));
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - horas * 3600_000);
  const query = new URLSearchParams({
    sort: "date_created",
    criteria: "desc",
    range: "date_created",
    begin_date: desde.toISOString(),
    end_date: hasta.toISOString(),
    limit: "50",
  });
  const resultado = (await mp(`/v1/payments/search?${query}`)) as {
    results?: Pago[];
    paging?: { total?: number };
  };
  const pagos = resultado.results ?? [];
  console.log(`Pagos de las últimas ${horas} h: ${resultado.paging?.total ?? pagos.length}\n`);

  const porTipo = new Map<string, number>();
  for (const pago of pagos) {
    const clave = `${pago.operation_type} / ${pago.payment_type_id} / ${pago.payment_method_id}`;
    porTipo.set(clave, (porTipo.get(clave) ?? 0) + 1);
  }
  console.log("Por operation_type / payment_type_id / payment_method_id:");
  for (const [clave, n] of porTipo) console.log(`  ${clave}: ${n}`);

  console.log("\nDetalle:");
  for (const pago of pagos) console.log(resumen(pago));

  const transferencias = pagos.filter((p) => p.operation_type === "money_transfer");
  console.log(
    `\n¿Aparecen transferencias (operation_type = money_transfer)? ${transferencias.length > 0 ? `SÍ, ${transferencias.length}` : "NO en esta ventana"}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
