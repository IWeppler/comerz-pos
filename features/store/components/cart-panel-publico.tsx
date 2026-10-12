"use client";

import { useCartStore } from "@/shared/store/cart-store";
import { createPublicBrowserClient } from "@/shared/config/supabase/client";
import { useSlugNegocio } from "@/shared/lib/use-negocio";
import { useShallow } from "zustand/react/shallow";
import {
  useEffect,
  useMemo,
  useRef,
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
import { slugify } from "@/shared/utils/slugify";
import { CartSidebarHeader } from "@/shared/components/cart-sidebar/cart-sidebar-header";
import {
  generarLinkWhatsAppPublico,
  ModalidadEntregaPublica,
} from "@/shared/components/cart-sidebar/cart-sidebar-utils";
import { COLUMNAS_CONFIG_PUBLICA } from "@/shared/lib/columnas-publicas";
import type { OpcionPagoPublica } from "@/shared/lib/opciones-pago-publicas";
import { calcularTotalesPedido } from "@/shared/lib/totales-pedido-publico";
import { useDescuentosPago } from "./descuentos-pago-provider";
import { CartPasoProductos } from "./cart-paso-productos";
import {
  CartPasoDatos,
  type CampoPedido,
  type EnvioInfo,
  type ErroresPedido,
} from "./cart-paso-datos";
import { CartDesglosePublico } from "./cart-desglose-publico";
import { claveOpcionPago } from "./cart-paso-datos";
import { OrdenCreadaPublica } from "./orden-creada-publica";
import {
  MENSAJE_SIN_PAGO_ONLINE,
  motivoSinPagoOnline,
  normalizarCelular,
  opcionesConPagoOnline,
} from "../lib/orden-tienda";
import { CHECKOUT_MP_DISPONIBLE } from "../lib/checkout-mp-disponible";
import {
  crearOrdenTiendaAction,
  type OrdenCreada,
} from "../actions/crear-orden-tienda";

const subscribeToClientMount = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

type PasoCarrito = "PRODUCTOS" | "DATOS";

/**
 * El carrito del catálogo público: DOS pasos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ CAMBIÓ Y POR QUÉ
 *
 * El paso 2 existe para poder preguntar UNA cosa que antes se resolvía por
 * chat: cómo va a pagar. Sin ese dato, el total que la clienta veía no era el
 * precio —faltaban el descuento por efectivo y el recargo por tarjeta— y la
 * pantalla lo compensaba con un disclaimer de tres líneas que decía, en
 * palabras, que el número de abajo podía cambiar. Preguntando, el total es el
 * total, y el desglose lo muestra renglón por renglón.
 *
 * Sigue sin ser un checkout: no se cobra, no se reserva stock y el pedido se
 * cierra por WhatsApp. Lo único que se gana es que el número que la clienta
 * acepta y el que le llega al comercio son el mismo, calculados en un solo
 * lugar (`shared/lib/totales-pedido-publico.ts`).
 *
 * VOLVER AL PASO 1 NO PIERDE NADA: todo el estado del formulario vive acá, en
 * el panel, no adentro del paso. Cambiar de paso desmonta la vista, no los
 * datos.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function CartPanelPublico({
  numeroWhatsApp,
}: Readonly<{ numeroWhatsApp?: string }>) {
  const { items, isOpen, setIsOpen, removeItem, updateQuantity, clearCart } =
    // El carrito persiste al cerrar el panel.
    useCartStore(
      useShallow((state) => ({
        items: state.items,
        isOpen: state.isOpen,
        setIsOpen: state.setIsOpen,
        removeItem: state.removeItem,
        updateQuantity: state.updateQuantity,
        clearCart: state.clearCart,
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

  const [paso, setPaso] = useState<PasoCarrito>("PRODUCTOS");
  const [nombre, setNombre] = useState("");
  const [modalidad, setModalidad] = useState<ModalidadEntregaPublica>("RETIRO");
  const [localidad, setLocalidad] = useState("");
  const [direccion, setDireccion] = useState("");
  const [nota, setNota] = useState("");
  const [opcionPago, setOpcionPago] = useState<OpcionPagoPublica | null>(null);
  const [errores, setErrores] = useState<ErroresPedido>({});
  // Pago online (orden en Comerz). Ver `features/store/lib/orden-tienda.ts`.
  const [celular, setCelular] = useState("");
  const [sitio, setSitio] = useState(""); // campo trampa: una persona no lo ve
  const [creandoOrden, setCreandoOrden] = useState(false);
  const [errorOrden, setErrorOrden] = useState<string | null>(null);
  const [ordenCreada, setOrdenCreada] = useState<OrdenCreada | null>(null);
  // Un id por intento de orden: si la respuesta se pierde y se vuelve a tocar
  // "Confirmar", el server devuelve la misma orden en vez de apartar el stock
  // dos veces. Se renueva recién cuando la orden se creó.
  const [idOrden, setIdOrden] = useState(() => crypto.randomUUID());

  const refNombre = useRef<HTMLInputElement>(null);
  const refCelular = useRef<HTMLInputElement>(null);
  const refLocalidad = useRef<HTMLInputElement>(null);
  const refDireccion = useRef<HTMLInputElement>(null);
  const refPago = useRef<HTMLDivElement>(null);

  // Con el carrito vacío no hay pedido que completar: el paso 2 quedaría con un
  // formulario para nada.
  const pasoEfectivo: PasoCarrito = items.length === 0 ? "PRODUCTOS" : paso;

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
  const { promociones: promocionesDB, opcionesPago: opcionesPagoBase, opcionesOnline } = useDescuentosPago();
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

  // Compara la localidad tipeada contra la localidad del negocio con el mismo
  // criterio de normalización que ya usa normalizarAtributoKeyValor (slugify:
  // sin tildes, case-insensitive, tolera espacios/puntuación).
  const envioInfo: EnvioInfo | null = useMemo(() => {
    if (modalidad !== "ENVIO" || localidad.trim() === "") return null;

    const localidadNegocio = branding?.localidad_negocio?.trim() || "";
    const esLocal =
      localidadNegocio !== "" &&
      slugify(localidad) === slugify(localidadNegocio);

    if (esLocal) {
      return { tipo: "LOCAL", costo: Number(branding?.envio_costo_local) || 0 };
    }

    return {
      tipo: "LEJOS",
      mensaje:
        branding?.envio_mensaje_lejos ||
        "Envío a convenir — te contactamos por WhatsApp para coordinar",
    };
  }, [modalidad, localidad, branding]);

  const costoEnvio = envioInfo?.tipo === "LOCAL" ? envioInfo.costo || 0 : 0;

  // ─── Pago online ───
  // Los botones de pago con los medios online del comercio, si ESTE pedido se
  // puede pagar online (sin presentaciones, sin importe fijado, sin envío "a
  // convenir"). Si no, quedan los de siempre y se dice por qué.
  const motivoSinOnline = motivoSinPagoOnline({ items, destinoEnvio: envioInfo?.tipo });
  const hayPagoOnline =
    opcionesOnline.transferencia || (opcionesOnline.mercadopago && CHECKOUT_MP_DISPONIBLE);
  const opcionesPago = useMemo(
    () =>
      opcionesConPagoOnline(opcionesPagoBase, opcionesOnline, {
        disponible: motivoSinOnline === null,
        incluirMercadoPago: CHECKOUT_MP_DISPONIBLE,
      }),
    [opcionesPagoBase, opcionesOnline, motivoSinOnline],
  );
  // Si la opción elegida dejó de existir (cambió la entrega o el carrito), no
  // hay opción elegida: un total con un medio que ya no se ofrece mentiría.
  const opcionElegida =
    opcionPago && opcionesPago.some((o) => claveOpcionPago(o) === claveOpcionPago(opcionPago))
      ? opcionPago
      : null;
  const esPagoOnline = !!opcionElegida?.online;

  // UNA sola cuenta para la pantalla y para el mensaje. Ver
  // `shared/lib/totales-pedido-publico.ts`.
  const totales = useMemo(
    () =>
      calcularTotalesPedido({
        items,
        promociones: promocionesPedido,
        opcionPago: opcionElegida,
        costoEnvio,
        configEnvio: branding,
        destinoEnvio: envioInfo?.tipo,
      }),
    [items, promocionesPedido, opcionElegida, costoEnvio, branding, envioInfo],
  );

  if (!mounted) return null;

  const cerrarPanel = () => setIsOpen(false);
  const verProductos = () => {
    cerrarPanel();
    const portada = linkCatalogo();
    if (pathname !== portada) router.push(portada);
  };
  const progreso = <ProgresoEnvioGratis items={items} base={totales.subtotal - (totales.descuento?.monto ?? 0)} config={branding} destino={envioInfo?.tipo} />;
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

  const volverAProductos = () => {
    setErrores({});
    setPaso("PRODUCTOS");
  };

  /** El primer campo que falta, en el ORDEN EN QUE SE VEN: es al que va el
   * foco, y mandar el foco al segundo error salteándose el primero deja a la
   * clienta scrolleando para atrás. */
  const primerCampoFaltante = (): CampoPedido | null => {
    if (nombre.trim() === "") return "nombre";
    if (esPagoOnline && !normalizarCelular(celular)) return "celular";
    if (modalidad === "ENVIO" && localidad.trim() === "") return "localidad";
    if (modalidad === "ENVIO" && direccion.trim() === "") return "direccion";
    // El método solo es obligatorio si el negocio configuró alguno: sin
    // opciones no hay nada que elegir y bloquear el pedido sería castigar a la
    // clienta por la configuración del comercio.
    if (opcionesPago.length > 0 && !opcionElegida) return "pago";
    return null;
  };

  const enviarPedido = () => {
    const faltante = primerCampoFaltante();

    if (faltante) {
      setErrores({
        nombre: nombre.trim() === "" ? "Completá tu nombre." : undefined,
        celular:
          esPagoOnline && !normalizarCelular(celular)
            ? "Poné tu celular con código de área, sin 0 ni 15."
            : undefined,
        localidad:
          modalidad === "ENVIO" && localidad.trim() === ""
            ? "Completá tu localidad."
            : undefined,
        direccion:
          modalidad === "ENVIO" && direccion.trim() === ""
            ? "Completá la dirección de envío."
            : undefined,
        pago:
          opcionesPago.length > 0 && !opcionElegida
            ? "Elegí cómo vas a pagar."
            : undefined,
      });

      const destino = {
        nombre: refNombre,
        celular: refCelular,
        localidad: refLocalidad,
        direccion: refDireccion,
        pago: refPago,
      }[faltante].current;
      destino?.scrollIntoView({ block: "center", behavior: "smooth" });
      // El grupo de pago es un div: se enfoca su primer botón, que es lo que
      // de verdad se puede accionar con el teclado.
      if (faltante === "pago") {
        destino?.querySelector("button")?.focus({ preventScroll: true });
      } else {
        (destino as HTMLInputElement | null)?.focus({ preventScroll: true });
      }
      return;
    }

    if (esPagoOnline) {
      void confirmarOrden();
      return;
    }

    const href = generarLinkWhatsAppPublico({
      numeroWhatsApp,
      nombreComercio: branding?.posName,
      items,
      totales,
      etiquetaPago: opcionElegida?.etiqueta ?? "A coordinar",
      nombreCliente: nombre,
      modalidad,
      direccion,
      localidad,
      envioACoordinar: envioInfo?.tipo === "LEJOS" && totales.envio?.etiqueta !== "Envío gratis",
      nota,
    });

    if (href === "#") return;

    // Medición (Fase 0 de la tienda online, docs/tienda-online.md): cuenta el
    // pedido por comercio. SIN await y antes de abrir WhatsApp: el pedido sale
    // igual aunque esto falle, y esperar la respuesta convertiría el
    // `window.open` en un popup bloqueado. La RPC no guarda datos de la
    // clienta, solo montos y cantidades.
    void Promise.resolve(
      supabase.rpc("registrar_pedido_catalogo", {
        p_total: totales.total,
        p_renglones: items.length,
        p_unidades: items.reduce((suma, item) => suma + item.cantidad, 0),
        p_modalidad: modalidad,
        p_pago: opcionElegida?.etiqueta ?? "A coordinar",
        p_envio_a_coordinar: envioInfo?.tipo === "LEJOS" && totales.envio?.etiqueta !== "Envío gratis",
        p_cupon: cuponAplicado ? cupon?.codigo : null,
        p_envio_gratis: totales.envio?.etiqueta === "Envío gratis",
        p_items_sugeridos: items.filter(i => i.sugeridoCatalogo).length,
      }),
    ).catch(() => {});

    // Sincrónico dentro del click: abrirlo después de un await lo convierte en
    // un popup y el navegador lo bloquea.
    window.open(href, "_blank", "noopener,noreferrer");

    limpiarPedido();
    cerrarPanel();
  };

  const limpiarPedido = () => {
    setNombre("");
    setCelular("");
    setModalidad("RETIRO");
    setLocalidad("");
    setDireccion("");
    setNota("");
    setOpcionPago(null);
    setErrores({});
    setErrorOrden(null);
    setPaso("PRODUCTOS");
    clearCart();
  };

  /**
   * Pago online: la orden se crea en Comerz y el stock queda apartado. El
   * server recalcula todo desde la base; si el total cambió, no crea nada y
   * avisa con el número nuevo (la clienta vuelve a confirmar viéndolo).
   */
  const confirmarOrden = async () => {
    const medio = opcionElegida?.online;
    if (creandoOrden || !medio) return;
    setCreandoOrden(true);
    setErrorOrden(null);
    try {
      const resultado = await crearOrdenTiendaAction({
        idOrden,
        items,
        medio,
        nombre,
        celular,
        modalidad,
        localidad,
        direccion,
        nota,
        cupon: cupon?.codigo ?? null,
        totalVisto: totales.total,
        sitio,
      });
      if (!resultado.ok) {
        setErrorOrden(resultado.error);
        return;
      }
      // Misma medición que el pedido por WhatsApp (Fase 0), sin datos de la
      // clienta, para comparar los dos caminos.
      void Promise.resolve(
        supabase.rpc("registrar_pedido_catalogo", {
          p_total: resultado.orden.total,
          p_renglones: items.length,
          p_unidades: items.reduce((suma, item) => suma + item.cantidad, 0),
          p_modalidad: modalidad,
          p_pago: `${opcionElegida?.etiqueta ?? "Online"} (online)`,
          p_envio_a_coordinar: false,
          p_cupon: cuponAplicado ? cupon?.codigo : null,
          p_envio_gratis: totales.envio?.etiqueta === "Envío gratis",
          p_items_sugeridos: items.filter((i) => i.sugeridoCatalogo).length,
        }),
      ).catch(() => {});
      setIdOrden(crypto.randomUUID());
      limpiarPedido();
      if (resultado.orden.medio !== "TRANSFERENCIA") {
        // Checkout de MP: navegación de la MISMA pestaña (no es un popup, el
        // navegador no la bloquea después del await). Si no se pudo abrir MP,
        // la orden existe igual y su página tiene "Pagar con Mercado Pago".
        cerrarPanel();
        if (resultado.orden.initPoint) window.location.assign(resultado.orden.initPoint);
        else router.push(linkCatalogo(`orden/${resultado.orden.token}`));
        return;
      }
      setOrdenCreada(resultado.orden);
    } catch {
      setErrorOrden("No pudimos confirmar tu orden. Revisá tu conexión y tocá «Confirmar pedido» de nuevo.");
    } finally {
      setCreandoOrden(false);
    }
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
          onBack={pasoEfectivo === "DATOS" ? volverAProductos : undefined}
        />

        {ordenCreada ? (
          <OrdenCreadaPublica
            orden={ordenCreada}
            numeroWhatsApp={numeroWhatsApp}
            nombreComercio={branding?.posName}
            onSeguir={() => {
              setOrdenCreada(null);
              cerrarPanel();
            }}
          />
        ) : items.length === 0 ? (
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
        ) : pasoEfectivo === "PRODUCTOS" ? (
          <CartPasoProductos
            items={items}
            total={totales.total}
            onUpdateQuantity={updateQuantity}
            onRemoveItem={removeItem}
            onSeguirComprando={cerrarPanel}
            onContinuar={() => setPaso("DATOS")}
            pie={campoCupon}
          >{progreso}{isOpen && <SugerenciasCarrito ids={items.map(i => i.productoId)} onVerFicha={cerrarPanel} contextoEnvio={{ promociones: promocionesPedido, opcionPago: opcionElegida, config: branding, destino: envioInfo?.tipo }} />}</CartPasoProductos>
        ) : (
          <>
            <CartPasoDatos
              beneficio={<>{modalidad === "ENVIO" ? progreso : null}{campoCupon}</>}
              nombre={nombre}
              onNombreChange={setNombre}
              modalidad={modalidad}
              onModalidadChange={setModalidad}
              localidad={localidad}
              onLocalidadChange={setLocalidad}
              direccion={direccion}
              onDireccionChange={setDireccion}
              envioInfo={totales.envio?.etiqueta === "Envío gratis" ? null : envioInfo}
              opcionesPago={opcionesPago}
              opcionPago={opcionElegida}
              onOpcionPagoChange={(opcion) => {
                setOpcionPago(opcion);
                setErrorOrden(null);
                setErrores((previos) => ({ ...previos, pago: undefined }));
              }}
              nota={nota}
              onNotaChange={setNota}
              pedirCelular={esPagoOnline}
              celular={celular}
              onCelularChange={(valor) => {
                setCelular(valor);
                setErrores((previos) => ({ ...previos, celular: undefined }));
              }}
              refCelular={refCelular}
              avisoPagoOnline={
                hayPagoOnline && motivoSinOnline ? MENSAJE_SIN_PAGO_ONLINE[motivoSinOnline] : undefined
              }
              errores={errores}
              refNombre={refNombre}
              refLocalidad={refLocalidad}
              refDireccion={refDireccion}
              refPago={refPago}
            />

            {/* Campo trampa: fuera de la vista y del teclado. Una persona no lo
                completa; un bot que llena todo, sí, y la orden no se crea. */}
            <input
              type="text"
              name="sitio"
              value={sitio}
              onChange={(e) => setSitio(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute left-[-9999px] h-0 w-0 opacity-0"
            />

            <CartDesglosePublico
              totales={totales}
              onEnviarPedido={enviarPedido}
              pagoOnline={esPagoOnline}
              isPending={creandoOrden}
              error={errorOrden}
            />
          </>
        )}
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
