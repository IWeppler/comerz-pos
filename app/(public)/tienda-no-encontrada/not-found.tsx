import Link from "next/link";
import { Store } from "lucide-react";
import { urlDelPanel } from "@/shared/lib/ruteo-host";

/**
 * El 404 de "esta tienda no existe". Es una página propia y no el error genérico
 * porque acá el visitante no se equivocó de link dentro de una app: llegó a un
 * subdominio que no es de nadie, probablemente desde un WhatsApp reenviado, y no
 * tiene idea de qué es Comerz. El mensaje explica eso, no "404".
 */
export default function NoEncontrada() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <Store className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Esta tienda no está disponible</h1>
        <p className="text-muted-foreground">
          La dirección no corresponde a ninguna tienda activa. Puede que el link
          esté mal escrito o que el comercio haya cambiado su dirección web.
        </p>
        <p className="text-sm text-muted-foreground">
          Si es tu comercio,{" "}
          <Link href={urlDelPanel("/ingresar")} className="underline">
            ingresá a tu panel
          </Link>{" "}
          para revisar la configuración.
        </p>
      </div>
    </main>
  );
}
