import { NextResponse } from "next/server";
import type { EventoErrorCliente } from "@/shared/lib/reportar-error-cliente";

/**
 * Recibe errores del navegador y los escribe en el log de la función, que es
 * lo que se ve en Vercel. Existe porque los crasheos de la carga de productos
 * no dejaban absolutamente ningún rastro del lado del servidor.
 *
 * Sin auth a propósito: un error puede pasar en la pantalla de login o con la
 * sesión ya rota, que son justo los casos que interesa ver. A cambio, el
 * handler no escribe en la base ni lee nada — solo loguea, con el payload
 * acotado y truncado.
 */
export async function POST(request: Request) {
  try {
    const evento = (await request.json()) as Partial<EventoErrorCliente>;

    const truncar = (valor: unknown, max: number) =>
      typeof valor === "string" ? valor.slice(0, max) : undefined;

    // `detalle` es un objeto libre y el endpoint no tiene auth: sin tope,
    // cualquiera llena el log de Vercel con un payload enorme.
    let detalle: string | undefined;
    try {
      detalle =
        evento.detalle === undefined ? undefined : JSON.stringify(evento.detalle).slice(0, 2000);
    } catch {
      detalle = "[detalle ilegible]";
    }

    console.error("[CLIENT ERROR]", {
      tipo: truncar(evento.tipo, 40) ?? "desconocido",
      mensaje: truncar(evento.mensaje, 500),
      stack: truncar(evento.stack, 2000),
      url: truncar(evento.url, 300),
      standalone: evento.standalone === true,
      userAgent: truncar(evento.userAgent, 300),
      memoriaGb:
        typeof evento.memoriaGb === "number" ? evento.memoriaGb : undefined,
      detalle,
    });
  } catch {
    console.error("[CLIENT ERROR] payload ilegible");
  }

  // 204 siempre: al cliente no le sirve saber si el reporte entró, y no
  // queremos que un fallo acá genere ruido encima del error original.
  return new NextResponse(null, { status: 204 });
}
