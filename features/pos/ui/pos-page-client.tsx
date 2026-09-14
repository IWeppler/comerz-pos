"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { soloVendibles } from "@/features/pos/lib/solo-vendibles";
import { useCatalogoPanel } from "@/shared/hooks/use-catalogo-panel";
import { PosTerminal } from "@/features/pos/ui/pos-terminal";
import { CartPanelAdmin } from "@/features/pos/ui/cart-panel-admin";
import { AvisoDatosGuardados } from "@/shared/components/aviso-datos-guardados";
import { RUBRO_DEFAULT, type Rubro } from "@/entities/config/types";

interface PosPageClientProps {
  /** Permiso `clientes.cobrar_cc`, resuelto en la página (server). Decide si
   * la barra del POS ofrece "Cobrar deuda". */
  puedeCobrarCuentaCorriente?: boolean;
  /** Permiso `ventas.elegir_comprobante`: si el ticket muestra el selector
   * Factura / Ticket interno (solo con modo ARCA). */
  puedeElegirComprobante?: boolean;
  /** Permiso `ventas.cobrar` (solo importa con "Enviar pedidos a la caja"). */
  puedeCobrar?: boolean;
  /**
   * El rubro, resuelto en el SERVER y sin costo (ver la página: sale de
   * `leerConfigPos`, que los layouts de este mismo request ya cachearon).
   *
   * Viene por acá y no del catálogo porque era la ÚNICA cosa que
   * `CartPanelAdmin` necesitaba de esos 2,06 MB: un string. El ticket entero
   * —métodos de pago, promociones, config, el carrito del store— no depende
   * del catálogo, y sin embargo esperaba a que llegara.
   */
  rubroInicial?: Rubro;
}

export function PosPageClient({
  puedeCobrarCuentaCorriente = false,
  puedeElegirComprobante = false,
  puedeCobrar = true,
  rubroInicial = RUBRO_DEFAULT,
}: Readonly<PosPageClientProps> = {}) {
  // `?q=` es cómo entra un producto elegido en la paleta (Ctrl+K): en vez de
  // agregarlo al ticket a ciegas —con talles y colores, elegir la variante es
  // una decisión— deja el POS con esa búsqueda hecha.
  const busquedaInicial = useSearchParams().get("q") ?? "";
  // La MISMA entrada que usa /stock, y con la misma sincronización
  // incremental: ir de una pantalla a la otra no vuelve a bajar nada, y
  // volver a abrir la app baja solo lo que cambió. Ver
  // `shared/hooks/use-catalogo-panel.ts`.
  const { data, isLoading, error, dataUpdatedAt } = useCatalogoPanel();

  // El catálogo canónico viene sin filtrar (/stock necesita ver también lo
  // despublicado). Acá se queda lo vendible, que es el filtro que antes hacía
  // PostgREST. `useMemo` porque el array del cache es estable entre renders y
  // recorrer 1.226 productos en cada uno sería trabajo regalado.
  const vendibles = useMemo(
    () => soloVendibles(data?.data?.productos ?? []),
    [data?.data?.productos],
  );

  // ACÁ VIVÍA `if (isLoading) return <PosSkeleton />`, que reemplazaba la
  // PANTALLA ENTERA hasta que llegaba el catálogo. Con 2,06 MB en Slow 4G eso
  // eran 7,3 s de LCP contra una pantalla en la que no existía nada: ni el
  // buscador (era un `<Skeleton>`, no un `<input>`), ni el ticket, ni los
  // botones. Un escaneo antes de que cargara perdía las teclas, porque no
  // había input al que fueran.
  //
  // Ahora el shell se monta siempre y el catálogo llega después. Lo que
  // depende de él es solo la grilla y las pills de categoría; el resto ya
  // podía funcionar.
  //
  // El ERROR sí sigue reemplazando la pantalla: sin catálogo no se puede
  // vender, y un shell que parece usable pero no encuentra nada es peor que
  // decirlo. Va con `!isLoading` para no pisar el estado de carga.
  if (!isLoading && (error || data?.error)) {
    return (
      <div className="flex h-48 w-full items-center justify-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20 p-6 text-center">
        <p className="font-medium">
          {data?.error || "No se pudo cargar el catálogo."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      {/* El catálogo puede estar viniendo del celular y no del server. Sin
          la fecha a la vista, un precio viejo se lee igual que uno actual
          y se cobra con él. */}
      <div className="px-2 pt-2 empty:hidden">
        <AvisoDatosGuardados
          actualizadoEn={dataUpdatedAt}
          que="Precios y stock"
        />
      </div>

      <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {/* La `key` remonta el terminal cuando llega otra búsqueda desde la
            paleta. Es lo que hace que elegir un segundo producto sin salir
            de /pos vuelva a filtrar: sin ella, `busquedaInicial` solo se
            leería en el primer render. Remontar no toca el carrito, que
            vive en el store. */}
        {/* Se monta SIEMPRE, con el catálogo vacío mientras viene en camino.
            `cargandoCatalogo` es lo que le permite distinguir "todavía no
            llegó" de "no hay": sin eso la grilla diría "No se encontraron
            productos" y ofrecería CREAR lo que la vendedora acaba de escanear.

            La `key` es `busquedaInicial`, que no cambia cuando llegan los
            datos, así que el terminal NO se remonta: lo tipeado antes de que
            cargara el catálogo sobrevive en `searchQuery` y el filtro se
            re-corre solo. */}
        <PosTerminal
          key={busquedaInicial}
          busquedaInicial={busquedaInicial}
          productos={vendibles}
          categorias={data?.data?.categorias ?? []}
          permitirVentaSinStock={data?.data?.permitirVentaSinStock}
          nombreComercio={data?.data?.nombreComercio}
          mostrarSinStock={data?.data?.mostrarSinStock}
          rubro={data?.data?.rubro ?? rubroInicial}
          puedeCobrarCuentaCorriente={puedeCobrarCuentaCorriente}
          cargandoCatalogo={isLoading}
        />
        {/* El rubro del server, no `RUBRO_DEFAULT`: el ticket ya se dibuja
            bien desde el primer pintado, sin esperar al catálogo y sin
            cambiar de layout cuando llega (`posSinImagenes` decide si el
            ticket muestra miniaturas). */}
        <CartPanelAdmin
          rubro={data?.data?.rubro ?? rubroInicial}
          puedeElegirComprobante={puedeElegirComprobante}
          puedeCobrar={puedeCobrar}
        />
      </div>
    </div>
  );
}

// Acá vivía `PosSkeleton`, el placeholder de PANTALLA COMPLETA. Se fue con el
// early return que lo usaba: ahora el shell es real desde el primer pintado y
// lo único que se dibuja en falso es la grilla, con `GrillaSkeleton` adentro
// de `PosTerminal` — donde puede usar la misma grilla y la misma altura que
// las tarjetas de verdad, que es lo que evita el salto de layout.
