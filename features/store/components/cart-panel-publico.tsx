"use client";

import { useCartStore } from "@/shared/store/cart-store";
import { createPublicBrowserClient } from "@/shared/config/supabase/client";
import { useSlugNegocio } from "@/shared/lib/use-negocio";
import { useShallow } from "zustand/react/shallow";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import { Dialog } from "radix-ui";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { BOTON_CATALOGO } from "../lib/estilos-catalogo";
import { useLinkCatalogo } from "@/shared/lib/use-negocio";
import { ProgresoEnvioGratis } from "./progreso-envio-gratis";
import { CuponCatalogo } from "./cupon-catalogo";
import type { PromocionDB } from "@/shared/components/cart-sidebar/types";
import { formatearPromoPublica } from "@/shared/components/cart-sidebar/cart-sidebar-utils";
import { SugerenciasCarrito } from "./sugerencias-carrito";
import { ConfiguracionPOS } from "@/entities/config/types";
import { CartSidebarHeader } from "@/shared/components/cart-sidebar/cart-sidebar-header";
import { COLUMNAS_CONFIG_PUBLICA } from "@/shared/lib/columnas-publicas";
import { calcularTotalesPedido } from "@/shared/lib/totales-pedido-publico";
import { useDescuentosPago } from "./descuentos-pago-provider";
import { CartPasoProductos } from "./cart-paso-productos";

const subscribeToClientMount = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * El carrito del catálogo público: los productos, el cupón y "Finalizar
 * compra", que lleva a `<tienda>/checkout` (contacto, entrega y pago en una
 * página propia, ver `checkout/checkout-publico.tsx`). Hasta el 12/10/2026 el
 * checkout era un segundo paso de este panel; quedaba angosto y sin resumen.
 *
 * El total del botón es el de hoy sin medio de pago: el descuento o recargo
 * por medio se ve en el checkout, renglón por renglón.
 */
export function CartPanelPublico() {
  const { items, isOpen, setIsOpen, removeItem, updateQuantity } =
    // El carrito persiste al cerrar el panel.
    useCartStore(
      useShallow((state) => ({
        items: state.items,
        isOpen: state.isOpen,
        setIsOpen: state.setIsOpen,
        removeItem: state.removeItem,
        updateQuantity: state.updateQuantity,
      })),
    );

  const mounted = useSyncExternalStore(
    subscribeToClientMount,
    getClientSnapshot,
    getServerSnapshot,
  );
  const router = useRouter();
  const pathname = usePathname();
  const linkCatalogo = useLinkCatalogo();
  const cuponGuardado = useCartStore(s => s.cuponCatalogo);
  const setCupon = useCartStore(s => s.setCuponCatalogo);

  const [branding, setBranding] = useState<ConfiguracionPOS | null>(null);

  // El slug sale de la RUTA, que lo tiene en los dos modos (subdominio y
  // /store/[negocio]). Sacándolo del host, en modo path no había slug y estas
  // tres consultas volvían vacías: sin promos, sin branding y sin métodos.
  // Cliente siempre anónimo: el catálogo es igual para todos.
  const slugNegocio = useSlugNegocio();
  const supabase = useMemo(
    () => createPublicBrowserClient(slugNegocio),
    [slugNegocio],
  );

  useEffect(() => {
    const fetchConfig = async () => {
      const { data } = await supabase
        .from("configuracion_pos")
        .select(COLUMNAS_CONFIG_PUBLICA)
        .single();

      if (data) setBranding(data as ConfiguracionPOS);
    };

    fetchConfig();
  }, [supabase]);

  // Promociones y métodos NO se piden acá: bajan del layout por contexto, que
  // es la misma fuente que usa la anotación de precio de la grilla y de la
  // ficha. Dos lecturas distintas de las mismas tablas son dos momentos
  // distintos, y el síntoma sería una tarjeta prometiendo un descuento que el
  // desglose no da. Ver `descuentos-pago-provider.tsx`.
  const { promociones: promocionesDB } = useDescuentosPago();
  const cupon = cuponGuardado?.slug === slugNegocio ? cuponGuardado : null;
  const promocionesPedido = useMemo(() => cupon ? [...promocionesDB, cupon.promocion] : promocionesDB, [cupon, promocionesDB]);
  const codigoGuardado = cuponGuardado?.codigo;
  const slugCuponGuardado = cuponGuardado?.slug;
  // La promo persistida se revalida al abrir: no conserva usos/fechas obsoletos.
  useEffect(() => {
    if (!isOpen || !codigoGuardado || slugCuponGuardado !== slugNegocio || !slugNegocio) return;
    let vigente = true;
    void Promise.resolve(supabase.rpc("validar_cupon_catalogo", { p_codigo: codigoGuardado })).then(({ data, error }) => {
      if (!vigente) return;
      if (error || !data) setCupon(null);
      else setCupon({ slug: slugNegocio, codigo: codigoGuardado, promocion: { ...(data as PromocionDB), codigo: codigoGuardado } });
    }).catch(() => { if (vigente) setCupon(null); });
    return () => { vigente = false; };
    // Solo al abrir/cambiar código, no al actualizar el snapshot validado.
  }, [isOpen, slugNegocio, supabase, codigoGuardado, slugCuponGuardado, setCupon]);

  // UNA sola cuenta para la pantalla y para el mensaje. Ver
  // `shared/lib/totales-pedido-publico.ts`.
  const totales = useMemo(
    () =>
      calcularTotalesPedido({
        items,
        promociones: promocionesPedido,
        opcionPago: null,
        costoEnvio: 0,
        configEnvio: branding,
      }),
    [items, promocionesPedido, branding],
  );

  if (!mounted) return null;

  const cerrarPanel = () => setIsOpen(false);
  const verProductos = () => {
    cerrarPanel();
    const portada = linkCatalogo();
    if (pathname !== portada) router.push(portada);
  };
  const progreso = <ProgresoEnvioGratis items={items} base={totales.subtotal - (totales.descuento?.monto ?? 0)} config={branding} />;
  const cuponAplicado = cupon && totales.promosAplicadas.some(p => p.id === cupon.promocion.id);
  const descuentoCupon = cuponAplicado ? totales.descuentosPorPromocion?.find(d => d.id === cupon.promocion.id)?.monto ?? 0 : 0;
  const faltaCupon = cupon ? Math.max(0, cupon.promocion.monto_minimo - totales.subtotal) : 0;
  const avisoCupon = faltaCupon > 0 ? `Te faltan $${faltaCupon.toLocaleString("es-AR")} para usar ${cupon!.codigo}` : cupon && !cuponAplicado ? "El descuento se confirma al elegir cómo pagás; se aplica la mejor promoción elegible." : undefined;
  const aplicarCupon = async (codigo: string) => {
    const { data, error } = await supabase.rpc("validar_cupon_catalogo", { p_codigo: codigo });
    if (error) throw error;
    if (!data || !slugNegocio) return false;
    setCupon({ slug: slugNegocio, codigo, promocion: { ...(data as PromocionDB), codigo } });
    return true;
  };
  const campoCupon = <CuponCatalogo codigo={cupon?.codigo} monto={descuentoCupon} aviso={avisoCupon} onAplicar={aplicarCupon} onQuitar={() => setCupon(null)} />;

  const irAlCheckout = () => {
    cerrarPanel();
    router.push(linkCatalogo("checkout"));
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="carrito-publico-overlay fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        />

      <Dialog.Content aria-describedby={undefined}
        className="carrito-publico fixed top-0 right-0 z-50 flex h-dvh w-full flex-col overflow-x-hidden border-l border-border bg-card pb-[env(safe-area-inset-bottom)] sm:w-[440px] lg:w-[480px]"
      >
        <Dialog.Title className="sr-only">Tu carrito</Dialog.Title>
        <CartSidebarHeader
          isPOSMode={false}
          onClose={cerrarPanel}
        />

        {items.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6 text-center text-muted-foreground">
            {/* `alt=""` a propósito: la ilustración no agrega nada que el texto
                de abajo no diga. El PNG son 1230×1278 pero en pantalla nunca
                pasa de 160px, así que `sizes` es lo que hace que Next sirva una
                variante chica. `dark:opacity-50` porque la ilustración no se
                adapta al tema y en oscuro grita más que el texto. */}
            <Image
              src="/empty-cart.png"
              alt=""
              width={1230}
              height={1278}
              sizes="160px"
              className="mx-auto mb-2 h-32 w-auto dark:opacity-50"
            />
            <p className="text-base font-semibold text-foreground">Tu carrito está vacío</p>
            <p className="mt-2 text-sm">Mirá lo que hay y agregá lo que te guste</p>
            <Button className={`mt-5 h-11 w-full ${BOTON_CATALOGO}`} onClick={verProductos}>Ver productos</Button>
            {promocionesDB.filter(p => p.mostrar_en_catalogo && !p.codigo).slice(0, 1).map(p => <p key={p.id} className="mt-4 text-sm">{formatearPromoPublica(p)}</p>)}
            {isOpen && <div className="mt-6 text-left"><SugerenciasCarrito ids={[]} onVerFicha={cerrarPanel} /></div>}
          </div>
        ) : (
          <CartPasoProductos
            items={items}
            total={totales.total}
            onUpdateQuantity={updateQuantity}
            onRemoveItem={removeItem}
            onSeguirComprando={cerrarPanel}
            onContinuar={irAlCheckout}
            pie={campoCupon}
          >{progreso}{isOpen && <SugerenciasCarrito ids={items.map(i => i.productoId)} onVerFicha={cerrarPanel} contextoEnvio={{ promociones: promocionesPedido, opcionPago: null, config: branding }} />}</CartPasoProductos>
        )}
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
