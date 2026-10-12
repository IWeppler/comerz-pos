import { NextResponse, type NextRequest } from "next/server";
import { leerAvisoMp, verificarFirmaMp } from "@/features/cobros-online/lib/webhook-mp";
import { procesarAvisoMp } from "@/features/cobros-online/lib/webhook-servidor";

/**
 * Webhook de Mercado Pago: https://app.comerz.app/api/mercadopago/webhook
 *
 * Lo apunta cada preference (`notification_url` con `?n=<negocio>`) y,
 * para las transferencias al alias, la configuración de Webhooks de la app
 * (tópico "Pagos"). `/api/*` no pasa por el middleware: ni sesión ni tienda.
 *
 * El aviso nunca se cree: dice "cambió el pago X" y el pago se lee de la API
 * con el token del comercio. Firma inválida → 401. Sin firma → solo dispara la
 * conciliación (ver `webhook-mp.ts`). El trabajo se hace dentro del request
 * (MP espera respuesta en 22 s; un GET + una RPC entran holgados).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const cuerpo = await request.json().catch(() => null);
  const aviso = leerAvisoMp(query, cuerpo);

  const firma = verificarFirmaMp({
    secreto: process.env.MP_WEBHOOK_SECRET,
    xSignature: request.headers.get("x-signature"),
    xRequestId: request.headers.get("x-request-id"),
    dataId: query.get("data.id"),
  });
  if (firma === "INVALIDA") {
    console.warn("[WEBHOOK MP] firma inválida", { tipo: aviso.tipo });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const status = await procesarAvisoMp(aviso, firma);
    return NextResponse.json({ ok: status === 200 }, { status });
  } catch (e) {
    console.error("[WEBHOOK MP]", (e as Error).message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
