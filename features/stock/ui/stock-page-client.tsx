"use client";

import Link from "next/link";
import { Camera } from "lucide-react";
import { useCatalogoPanel } from "@/shared/hooks/use-catalogo-panel";
import { StockView } from "@/features/stock/ui/stock-view";
// El MISMO esqueleto que dibuja `stock/loading.tsx`. Ver ahí por qué se
// comparte: son dos cargas seguidas (la ruta y después el catálogo) y con dos
// dibujos distintos la pantalla parpadearía dos veces antes de mostrar datos.
import { StockSkeleton } from "@/features/stock/ui/stock-skeleton";
import { AvisoDatosGuardados } from "@/shared/components/aviso-datos-guardados";
import { RUBRO_DEFAULT } from "@/entities/config/types";
import type { UsoDelPlan } from "@/features/planes/actions/uso-del-plan";

/** Sin foto = null, cadena vacía o el array vacío serializado. Son las tres
 * formas reales que tiene `imagen_url` en esta base. */
function sinFoto(imagenUrl: unknown): boolean {
  if (imagenUrl === null || imagenUrl === undefined) return true;
  if (Array.isArray(imagenUrl)) return imagenUrl.length === 0;
  const texto = String(imagenUrl).trim();
  return texto === "" || texto === "[]";
}

/**
 * El pendiente de fotos.
 *
 * La foto salió del camino crítico del alta —cargar un remito de 94 productos
 * no puede depender de tener 94 fotos sacadas— y este aviso es lo que evita
 * que "después" signifique nunca. Cuenta sobre el catálogo que la pantalla ya
 * tiene en memoria: no cuesta una consulta más.
 */
function AvisoFotosPendientes({
  productos,
}: Readonly<{ productos: { imagen_url?: unknown }[] }>) {
  const cuantos = productos.filter((p) => sinFoto(p.imagen_url)).length;
  if (cuantos === 0) return null;

  return (
    <div>
      <Link
        href="/stock/fotos-pendientes"
        className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 m-4 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <Camera className="h-4 w-4 shrink-0" />
        <span>
          <strong className="font-semibold text-foreground">
            {cuantos} producto{cuantos === 1 ? "" : "s"}
          </strong>{" "}
          sin foto. Cargalas cuando tengas un rato.
        </span>
      </Link>
    </div>
  );
}

export function StockPageClient({
  userRole,
  uso,
}: {
  userRole: string;
  uso?: UsoDelPlan | null;
}) {
  // La MISMA entrada que usa /pos: una sola consulta para las dos pantallas.
  // Acá el catálogo se usa TAL CUAL viene —sin filtrar— porque Inventario
  // tiene que mostrar también lo despublicado: un producto que se sacó de la
  // vidriera hay que poder verlo para corregirlo.
  const { data, isLoading, error, dataUpdatedAt } = useCatalogoPanel();

  if (isLoading) {
    return (
      <div className="space-y-1 mx-auto px-2">
        <StockSkeleton />
      </div>
    );
  }

  if (error || data?.error) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20 p-6 text-center m-4">
        <p className="font-medium">
          {data?.error || "No se pudo cargar el stock."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 mx-auto">
      {/* Mismo criterio que en Vender: el inventario puede estar saliendo
          del celular, y hay que decirlo. */}
      <div className="px-2 pt-2 empty:hidden md:px-4">
        <AvisoDatosGuardados actualizadoEn={dataUpdatedAt} que="Inventario" />
      </div>

      <AvisoFotosPendientes productos={data?.data?.productos ?? []} />

      {/* El medidor del tope de productos vive SOLO en Perfil > Suscripción:
          acá se comía una banda arriba del inventario todos los días para un
          dato que se mira una vez por mes. El aviso donde sí importa sigue
          estando: al llegar al tope, las puertas de alta de mercadería se
          apagan y explican por qué (ver stock-filters-toolbar). */}
      <StockView
        productosIndice={data?.data?.productos ?? []}
        userRole={userRole}
        nombreComercio={data?.data?.nombreComercio ?? "Tienda Online"}
        mostrarSinStock={data?.data?.mostrarSinStock ?? true}
        rubro={data?.data?.rubro ?? RUBRO_DEFAULT}
        productosDelNegocio={uso?.productos}
      />
    </div>
  );
}
