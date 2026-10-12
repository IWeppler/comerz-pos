import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createPublicClient } from "@/shared/config/supabase/server";
import { resolveTenant } from "@/shared/lib/tenant";
import { conciliarPagosNegocio } from "@/features/cobros-online/lib/conciliar-servidor";
import { OrdenPublica, type OrdenPublicaDatos } from "@/features/store/components/orden-publica";

export const dynamic = "force-dynamic";

/** Es la orden de una persona, no una vidriera. */
export const metadata: Metadata = {
  title: "Tu orden",
  robots: { index: false, follow: false },
};

/**
 * La orden del catálogo para la clienta: `<tienda>/orden/<token>`.
 *
 * El token (48 hex, no adivinable) es la única llave: no hace falta cuenta.
 * La lectura (`orden_tienda_publica`) vence las órdenes del negocio antes de
 * mirar (STOPGAP sin pg_cron). Antes se concilian los pagos del negocio contra
 * su Mercado Pago (checkout y transferencias): si la plata ya entró, la clienta
 * ve "pagada" sin que nadie toque nada.
 */
export default async function OrdenPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ negocio: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { negocio, token } = await params;
  // MP vuelve con `?payment_id=…&status=…`. Solo sirve para decir "estamos
  // confirmando": el estado real lo deciden la conciliación y el webhook.
  const query = await searchParams;
  const volvioDeMp = Boolean(query.payment_id || query.collection_id || query.preference_id);
  if (!/^[0-9a-f]{48}$/.test(token)) notFound();

  const headersList = await headers();
  const tenant = await resolveTenant({ hostname: headersList.get("host"), slug: negocio });
  const supabase = await createPublicClient();

  const leer = async () => {
    const { data } = await supabase.rpc("orden_tienda_publica", { p_token: token });
    return (data ?? null) as OrdenPublicaDatos | null;
  };

  // Conciliar ANTES de leer: la lectura vence las órdenes del negocio, y un
  // pago del último minuto tiene que registrarse antes. Nunca se mira el
  // `?status=` con el que vuelve MP: el pago se lee de la API.
  await conciliarPagosNegocio(tenant.negocio_id);
  const orden = await leer();
  if (!orden) notFound();

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">
      <OrdenPublica orden={orden} token={token} volvioDeMp={volvioDeMp} />
    </main>
  );
}
