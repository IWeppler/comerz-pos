"use client";

import { useCartStore } from "@/shared/store/cart-store";
import { createClient } from "@/shared/config/supabase/client";
import { useShallow } from "zustand/react/shallow";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/query-keys";
import { toast } from "sonner";
import { registrarVentaAction } from "@/features/sales/actions/create-sale";
import {
  crearPedidoAction,
  type PedidoPorCobrar,
} from "@/features/pedidos/actions/pedidos";
import {
  PedidosPorCobrar,
  usePedidosPorCobrar,
} from "@/features/pedidos/ui/pedidos-por-cobrar";
import { encolarVenta } from "@/features/sales/lib/outbox-ventas";
import { useVentasPendientesStore } from "@/shared/store/ventas-pendientes-store";
import { esErrorDeRed } from "@/shared/lib/error-de-red";
import { getDisponibilidadUnidadesAction } from "@/features/sales/actions/get-unidades-serie";
import { SeleccionarUnidadesModal } from "./seleccionar-unidades-modal";
import type {
  DisponibilidadPorVariante,
  UnidadSeleccionada,
} from "@/entities/ventas/unidades-serie-types";
import { crearReservaAction } from "@/features/reservations/actions/manage-reservations";
import { TicketData, CreateSalePaymentInput } from "@/entities/ventas/types";
import { ConfiguracionPOS } from "@/entities/config/types";
import { formatearNumeroComprobante } from "@/shared/lib/facturacion";
import { MetodoPago } from "@/entities/payments/types";
import { CartSidebarFooter } from "../../../shared/components/cart-sidebar/cart-sidebar-footer";
import { CartSidebarHeader } from "../../../shared/components/cart-sidebar/cart-sidebar-header";
import { CartStepCheckout } from "../../../shared/components/cart-sidebar/cart-step-checkout";
import { CartStepItems } from "../../../shared/components/cart-sidebar/cart-step-items";
import { SelectorComprobante } from "../../../shared/components/cart-sidebar/selector-comprobante";
import { determinarComprobanteFiscal } from "@/shared/lib/determinar-comprobante";
import { ETIQUETA_COMPROBANTE } from "@/shared/lib/facturacion";
import { posSinImagenes } from "@/features/pos/lib/vista-por-rubro";
import type { Rubro } from "@/entities/config/types";
import { Sheet, SheetContent } from "@/shared/ui/sheet";
import { Drawer, DrawerContent } from "@/shared/ui/drawer";
import { MobileCartBar } from "../../../shared/components/cart-sidebar/mobile-cart-bar";
import { PromocionDB } from "../../../shared/components/cart-sidebar/types";
import { useListasPrecios } from "@/shared/hooks/use-listas-precios";
import { admitePromociones } from "@/shared/lib/precio-de-lista";
import { precioEnForma } from "@/shared/lib/presentaciones";
import { claveLinea } from "@/shared/store/cart-store";
import type { CartItemStore } from "@/entities/cart/types";
import { SelectorListaPrecio } from "./selector-lista-precio";
import { decidirSugerenciaDeLista } from "../lib/sugerencia-lista-cliente";
import {
  generarLinkWhatsApp,
  getDescuentoDetalle,
  getPromocionActivaId,
  getPromocionesElegibles,
} from "../../../shared/components/cart-sidebar/cart-sidebar-utils";
import { ClienteBasico } from "../../../shared/components/cart-sidebar/client-selector";
import { AtajosCarrito } from "./atajos-carrito";
import { VentaExitosa } from "./venta-exitosa";
import type { TipoVenta } from "./atajos-carrito";
import { esFraccionable } from "@/shared/lib/unidad-venta";
import { rubroUsaReservas } from "@/features/pos/lib/reservas-por-rubro";
import {
  calcularPagosConRecargo,
  etiquetaRecargo,
} from "@/shared/lib/recargo-metodo";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useVentaLibreStore } from "@/shared/store/venta-libre-store";
import { VentaLibreInline } from "./venta-libre-inline";
import { ClipboardList, Plus, X } from "lucide-react";
import {
  crearVentaEnColaVacia,
  useVentasEnColaStore,
  type VentaEnCola,
} from "@/features/pos/store/ventas-en-cola-store";

const subscribeToClientMount = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
type CheckoutStep = "CART" | "PAYMENT";
type VistaTicket = "POR_COBRAR" | "VENTA_ACTUAL";

export function CartPanelAdmin({
  numeroWhatsApp,
  rubro,
  puedeElegirComprobante = false,
  puedeCobrar = true,
}: Readonly<{
  numeroWhatsApp?: string;
  /** Permiso `ventas.cobrar`. Solo importa con `pedidos_a_caja`: sin él,
   * el único botón del ticket es "Enviar a caja". */
  puedeCobrar?: boolean;
  /** Permiso `ventas.elegir_comprobante`. Solo decide si se muestra el
   * selector Factura / Ticket; el server vuelve a chequearlo. */
  puedeElegirComprobante?: boolean;
  /** Decide si el ticket muestra miniaturas. Ausente = las muestra: es el
   * default seguro para cualquier consumidor que todavía no lo pase. */
  rubro?: Rubro;
}>) {
  const {
    items,
    isOpen,
    setIsOpen,
    removeItem,
    updateQuantity,
    cambiarForma,
    getTotalPrice,
    getTotalItems,
    clearCart,
    sincronizarNegocio,
    pedidoActivo,
    setPedidoActivo,
    addItem,
    reemplazarCarrito,
  } = useCartStore(
    useShallow((state) => ({
      items: state.items,
      isOpen: state.isOpen,
      setIsOpen: state.setIsOpen,
      removeItem: state.removeItem,
      updateQuantity: state.updateQuantity,
      cambiarForma: state.cambiarForma,
      getTotalPrice: state.getTotalPrice,
      getTotalItems: state.getTotalItems,
      clearCart: state.clearCart,
      sincronizarNegocio: state.sincronizarNegocio,
      pedidoActivo: state.pedidoActivo,
      setPedidoActivo: state.setPedidoActivo,
      addItem: state.addItem,
      reemplazarCarrito: state.reemplazarCarrito,
    })),
  );

  const router = useRouter();
  const queryClient = useQueryClient();

  // Negocio activo, resuelto por el layout en el server desde la membresía —
  // no desde la cookie leída acá. Todo lo que este panel consulta (config,
  // métodos de pago, promociones) es POR NEGOCIO, y el cambio de comercio es
  // una navegación blanda: sin esta dependencia los datos del comercio
  // anterior sobreviven al cambio. Ver el comentario del efecto de abajo.
  const negocioId = useNegocioActivo()?.id ?? null;
  const refrescarPendientes = useVentasPendientesStore((s) => s.refrescar);

  useEffect(() => {
    sincronizarNegocio(negocioId);
  }, [negocioId, sincronizarNegocio]);

  // --- UNIDADES SERIALIZADAS (IMEI / número de serie) ---
  // `variantesSerializadas` son las variantes del carrito que tienen al
  // menos una unidad libre en unidades_serie: esas líneas no se pueden
  // cobrar sin elegir el aparato. Se recalcula cuando cambia el carrito.
  // Para un catálogo sin unidades_serie (toda la indumentaria) esto queda
  // vacío y no cambia absolutamente nada del flujo.
  // Resultado crudo de la última consulta. `variantesSerializadas` se deriva
  // de acá cruzándolo con el carrito actual, en vez de resetearse por efecto:
  // si el carrito se vacía, el memo ya da un Set vacío sin escribir estado.
  const [disponibilidadUnidades, setDisponibilidadUnidades] =
    useState<DisponibilidadPorVariante>({});
  const [unidadesElegidasRaw, setUnidadesElegidasRaw] = useState<
    UnidadSeleccionada[]
  >([]);
  // Dos formas de llegar al selector, y no hacen lo mismo: desde el carrito
  // se elige y se vuelve al carrito; desde "Confirmar venta" se elige y se
  // retoma el cobro donde había quedado. Por eso es modo y no un booleano.
  const [modalUnidades, setModalUnidades] = useState<
    "SOLO_ELEGIR" | "CONFIRMAR" | null
  >(null);
  /** El anticipo tipeado en el modal de CC se guarda mientras el vendedor
   * elige los aparatos, para retomar la confirmación con el mismo monto. */
  const [anticipoPendiente, setAnticipoPendiente] = useState<
    number | undefined
  >(undefined);

  const varianteIdsCarrito = useMemo(
    () =>
      items
        .map((i) => i.varianteId)
        .filter((id): id is string => Boolean(id))
        .sort()
        .join(","),
    [items],
  );

  useEffect(() => {
    const ids = varianteIdsCarrito ? varianteIdsCarrito.split(",") : [];
    if (ids.length === 0) return;

    let cancelado = false;
    getDisponibilidadUnidadesAction(ids).then((res) => {
      // Guard de carrera: si el carrito cambió mientras volvía la consulta,
      // esta respuesta ya no corresponde y se descarta.
      if (cancelado) return;
      setDisponibilidadUnidades(res.disponibilidad);
    });

    return () => {
      cancelado = true;
    };
  }, [varianteIdsCarrito]);

  const variantesSerializadas = useMemo(() => {
    const enCarrito = new Set(
      varianteIdsCarrito ? varianteIdsCarrito.split(",") : [],
    );
    return new Set(
      Object.entries(disponibilidadUnidades)
        .filter(
          ([varianteId, cantidad]) => cantidad > 0 && enCarrito.has(varianteId),
        )
        .map(([varianteId]) => varianteId),
    );
  }, [disponibilidadUnidades, varianteIdsCarrito]);

  // Una unidad elegida deja de valer si esa línea salió del carrito. Se
  // filtra al leer en vez de limpiarse por efecto, para no encadenar un
  // render extra cada vez que cambia el carrito.
  const unidadesElegidas = useMemo(
    () =>
      unidadesElegidasRaw.filter((u) =>
        variantesSerializadas.has(u.varianteId),
      ),
    [unidadesElegidasRaw, variantesSerializadas],
  );

  const lineasSerializadas = useMemo(
    () =>
      items
        .filter((i) => i.varianteId && variantesSerializadas.has(i.varianteId))
        .map((i) => ({
          varianteId: i.varianteId as string,
          nombre: i.nombre,
          variante: i.variante,
        })),
    [items, variantesSerializadas],
  );

  const imeiPorVariante = useMemo(
    () =>
      Object.fromEntries(unidadesElegidas.map((u) => [u.varianteId, u.imei])),
    [unidadesElegidas],
  );

  const mounted = useSyncExternalStore(
    subscribeToClientMount,
    getClientSnapshot,
    getServerSnapshot,
  );
  const [isPending, startTransition] = useTransition();

  // Los datos por negocio se guardan JUNTO AL negocio del que salieron, y se
  // leen solo si coinciden con el activo. Un `setBranding(null)` al cambiar de
  // comercio no alcanzaría: entre que arranca el efecto y vuelve la consulta
  // hay renders en los que el estado viejo todavía está montado, y en esos
  // renders se calcula el recargo. Acá el dato ajeno directamente no se puede
  // leer, no importa en qué momento del ciclo estemos.
  const [configCargada, setConfigCargada] = useState<{
    negocioId: string | null;
    config: ConfiguracionPOS;
  } | null>(null);
  const branding =
    configCargada && configCargada.negocioId === negocioId
      ? configCargada.config
      : null;
  const pedidosACaja = Boolean(branding?.pedidos_a_caja);
  const esCajaCentral = pedidosACaja && puedeCobrar;

  const [vendedorNombre, setVendedorNombre] = useState("Tú");
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [metodosCargados, setMetodosCargados] = useState<{
    negocioId: string | null;
    metodos: MetodoPago[];
  } | null>(null);
  const metodosPagoDB = useMemo(
    () =>
      metodosCargados && metodosCargados.negocioId === negocioId
        ? metodosCargados.metodos
        : [],
    [metodosCargados, negocioId],
  );
  const [pagos, setPagos] = useState<CreateSalePaymentInput[]>([]);
  const [modoMixto, setModoMixto] = useState(false);
  const [isCuentaCorriente, setIsCuentaCorriente] = useState(false);

  // FACTURA O TICKET, por venta. `null` = todavía no se tocó: vale el
  // default del comercio. Solo tiene sentido con modo ARCA; en los otros
  // modos no se muestra ni se manda, y el server emite ticket como siempre.
  // Vuelve al default después de cada venta: la elección es de ESA venta.
  const [facturarElegido, setFacturarElegido] = useState<boolean | null>(null);
  const facturacionActiva = branding?.modo_facturacion === "ARCA";
  const facturar = facturarElegido ?? branding?.facturar_por_defecto ?? true;
  /** La vendedora anuló el recargo CC para ESTE ticket. No persiste entre
   * ventas: se resetea al cerrar la venta y al apagar Cuenta Corriente. */
  const [ccSinRecargo, setCcSinRecargo] = useState(false);
  const [isReserva, setIsReserva] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  // Corte propio para celular (<640px, Tailwind `sm`) — distinto del corte
  // mobile/desktop de arriba (1024px). Tablet (640-1023px) sigue exactamente
  // igual que hoy: sheet lateral + auto-apertura vía `isOpen` del store.
  // Celular usa su propia barra fija + Drawer inferior, con apertura
  // controlada solo por el tap del usuario (nunca por agregar un producto).
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const [phoneCartOpen, setPhoneCartOpen] = useState(false);

  const [promosCargadas, setPromosCargadas] = useState<{
    negocioId: string | null;
    promociones: PromocionDB[];
  } | null>(null);
  const promocionesDB = useMemo(
    () =>
      promosCargadas && promosCargadas.negocioId === negocioId
        ? promosCargadas.promociones
        : [],
    [promosCargadas, negocioId],
  );
  const [promocionId, setPromocionId] = useState("ninguna");

  // ── LISTA DE PRECIOS ─────────────────────────────────────────────────
  const { listas, listaPorId, resolver: resolverPrecio } = useListasPrecios();
  const listaPrecioId = useCartStore((state) => state.listaPrecioId);
  const setListaPrecio = useCartStore((state) => state.setListaPrecio);

  /**
   * La lista efectiva: la elegida, SOLO si sigue existiendo y activa.
   *
   * El id vive en localStorage, así que sobrevive a que la dueña apague o
   * borre la lista desde Configuración. Sin este corte, el ticket seguiría
   * diciendo "Precios de Mayorista" contra una lista que el server ya no
   * aplica, y la venta se caería recién al confirmar.
   */
  const listaActiva = listaPrecioId
    ? (listaPorId.get(listaPrecioId) ?? null)
    : null;

  /**
   * Cambia la lista y RE-PRECIA el ticket en la misma escritura.
   *
   * Los precios salen de `precioDeLista`, la misma función que revalida el
   * server: lo que se muestra acá es lo que se va a cobrar. Se re-precia
   * desde `precioBase` de cada línea y no desde su precio actual, que ya
   * podría venir de otra lista — aplicar un descuento sobre un descuento es
   * el error que este cálculo tiene que hacer imposible.
   */
  /** La presentación en la que se vende la línea, si la hay. */
  const presentacionDeLinea = (item: CartItemStore) =>
    item.presentacionId
      ? (item.presentaciones?.find((p) => p.id === item.presentacionId) ?? null)
      : null;

  const preciosPara = (nuevaListaId: string | null) => {
    const precios: Record<
      string,
      { precio: number; precioBase: number; precioBaseEfectivo: number }
    > = {};
    let algunoCambia = false;

    for (const item of items) {
      // La venta libre no tiene lista: el precio es el que tipeó la
      // vendedora y una regla de −20% sobre eso sería descontar lo que ella
      // ya decidió. Se deja como está (el server tampoco la re-precia).
      if (item.ventaLibre) continue;

      // Una línea que entró desde otra pantalla (Inventario, la ficha de un
      // producto) no trae `precioBase`: ahí el precio con el que entró ES el
      // base, porque esas pantallas no conocen la lista.
      const precioBase = item.precioBase ?? item.precio;
      const { precio: precioBaseConLista } = resolverPrecio({
        listaPrecioId: nuevaListaId,
        productoId: item.productoId,
        precioBase,
        precioCosto: item.costoBase,
      });
      // La lista se resuelve sobre la unidad base; la línea cobra en su
      // forma (por balde si es balde). Con precio FIJO la lista no toca.
      const precio = precioEnForma(
        precioBaseConLista,
        presentacionDeLinea(item),
      );

      precios[claveLinea(item)] = {
        precio,
        precioBase,
        precioBaseEfectivo: precioBaseConLista,
      };
      if (
        precio !== item.precio ||
        item.precioBase == null ||
        item.precioBaseEfectivo !== precioBaseConLista
      ) {
        algunoCambia = true;
      }
    }

    return { precios, algunoCambia };
  };

  /** Lo que saldría el ticket con otra lista, para poder mostrar los DOS
   *  números antes de cambiar nada. */
  const totalConLista = (listaId: string | null) =>
    items.reduce((acc, item) => {
      if (item.ventaLibre) return acc + item.precio * item.cantidad;
      const base = item.precioBase ?? item.precio;
      const { precio: precioBaseConLista } = resolverPrecio({
        listaPrecioId: listaId,
        productoId: item.productoId,
        precioBase: base,
        precioCosto: item.costoBase,
      });
      const precio = precioEnForma(precioBaseConLista, presentacionDeLinea(item));
      return acc + precio * item.cantidad;
    }, 0);

  const cambiarListaPrecio = (nuevaListaId: string | null) => {
    setListaPrecio(nuevaListaId, preciosPara(nuevaListaId).precios);
  };

  /**
   * La vendedora tocó el selector a mano. Desde ahí, su elección gana: el
   * cliente no vuelve a proponer nada.
   */
  const listaElegidaAMano = useRef(false);
  const cambiarListaDesdeElChip = (nuevaListaId: string | null) => {
    listaElegidaAMano.current = true;
    cambiarListaPrecio(nuevaListaId);
  };

  /** Al vaciar el ticket también se vacía la decisión: el próximo cliente
   *  vuelve a poder proponer su lista. */
  const olvidarEleccionDeLista = () => {
    listaElegidaAMano.current = false;
  };


  /**
   * Una lista que ya no está no puede quedar elegida.
   *
   * Va en un efecto —y no durante el render, que escribiría en el store
   * mientras otro componente se pinta— porque es sincronización con estado
   * EXTERNO: la lista se apagó desde Configuración, quizás en otra máquina.
   *
   * Sin esto el ticket se queda con los precios de la lista vieja y el chip
   * diciendo "Base". El server no cobra de menos (resuelve al precio base y la
   * venta rebota porque el pago no cubre el total), pero el mensaje que se ve
   * es "El pago no cubre el total del ticket", que no explica nada.
   */
  useEffect(() => {
    if (listaPrecioId && listas.length > 0 && !listaActiva) {
      cambiarListaPrecio(null);
      toast.warning(
        "La lista de precios ya no está disponible: volvimos a los precios de siempre.",
      );
    }
    // `cambiarListaPrecio` se rearma en cada render (depende de `items`);
    // incluirla dispararía el efecto en cada cambio del carrito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaPrecioId, listaActiva, listas.length]);

  /**
   * TODA línea del ticket queda al precio de la lista activa, entró por donde
   * entró.
   *
   * Un producto puede llegar al carrito desde la grilla del POS, desde el
   * modal de variantes, desde Inventario o desde la ficha de un producto. Solo
   * las dos primeras conocen la lista; las otras agregan al precio base. Sin
   * este guard, un ticket en Mayorista podía tener una línea a precio de
   * mostrador — y el server, que aplica la lista a TODAS, devolvería "Los
   * cobros asignados superan el total del ticket", que no explica nada.
   *
   * Es el mismo criterio que el trigger de `movimientos_stock`: un guard que
   * cubre todos los caminos, incluido el que todavía no existe, en vez de
   * acordarse de tocar cada punto de entrada.
   *
   * No se cicla: después de escribir, los precios ya coinciden y `algunoCambia`
   * da false.
   */
  useEffect(() => {
    if (!listaActiva) return;
    const { precios, algunoCambia } = preciosPara(listaActiva.id);
    if (algunoCambia) setListaPrecio(listaActiva.id, precios);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, listaActiva]);

  /**
   * Una lista de precios YA ES el descuento: salvo que el comercio lo haya
   * decidido, una promoción no se suma encima. El server lo rechaza; acá se
   * apaga antes para que no llegue a ofrecerse.
   */
  const promocionesPermitidas = admitePromociones(listaActiva);
  /**
   * La venta que ACABA de cerrarse. Mientras está, el panel del ticket deja
   * de mostrar el carrito (vacío, recién cobrado) y muestra "venta
   * realizada" en su lugar: mismo panel, mismo sheet en tablet, mismo drawer
   * en celular. El catálogo sigue a la vista y usable.
   */
  const [ventaExitosa, setVentaExitosa] = useState<TicketData | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>("CART");
  const [vistaTicket, setVistaTicket] = useState<VistaTicket>(() =>
    items.length > 0 || pedidoActivo ? "VENTA_ACTUAL" : "POR_COBRAR",
  );
  const colaPedidos = usePedidosPorCobrar(esCajaCentral ? negocioId : null);
  const [clienteSeleccionado, setClienteSeleccionado] =
    useState<ClienteBasico | null>(null);

  const alcanceVentas =
    negocioId && usuarioId ? `${negocioId}:${usuarioId}` : null;
  const sesionVentas = useVentasEnColaStore((state) =>
    alcanceVentas ? state.sesiones[alcanceVentas] : undefined,
  );
  const inicializarVentas = useVentasEnColaStore((state) => state.inicializar);
  const guardarVenta = useVentasEnColaStore((state) => state.guardar);
  const agregarVenta = useVentasEnColaStore((state) => state.agregar);
  const activarVenta = useVentasEnColaStore((state) => state.activar);
  const quitarVenta = useVentasEnColaStore((state) => state.quitar);
  const alcanceVentasCargado = useRef<string | null>(null);

  // Agregar desde la grilla, un atajo o cualquier consumidor del store lleva
  // a la venta actual. La suscripción observa el EVENTO carrito vacío → con
  // líneas, no cada render; un pedido nuevo en la cola jamás toca esta vista.
  useEffect(
    () =>
      useCartStore.subscribe((state, anterior) => {
        if (anterior.items.length === 0 && state.items.length > 0) {
          setVistaTicket("VENTA_ACTUAL");
        }
      }),
    [],
  );

  // ── VENTA LIBRE ──────────────────────────────────────────────────────
  // El formulario vive adentro del ticket (`VentaLibreInline`, en el paso de
  // líneas). Quien lo abre desde AFUERA —la tecla V, o la grilla con "Vender 'X' sin
  // cargarlo"— necesita que el ticket esté a la vista y en ese paso: en
  // tablet el sheet, en celular el drawer, y si estaba en el pago, volver.
  // Sin esto, en un celular con el carrito vacío el botón de la grilla
  // abriría un formulario que no se ve.
  // Se suscribe al store en vez de leerlo con el hook: reacciona a la
  // APERTURA (un evento), no al estado, y los flags de layout se leen en ese
  // momento desde una ref sin volver a suscribir.
  const layoutRef = useRef({ isPhoneLayout, isMobileLayout });
  useEffect(() => {
    layoutRef.current = { isPhoneLayout, isMobileLayout };
  }, [isPhoneLayout, isMobileLayout]);
  useEffect(
    () =>
      useVentaLibreStore.subscribe((s, prev) => {
        if (s.apertura === prev.apertura) return;
        setVistaTicket("VENTA_ACTUAL");
        setCheckoutStep("CART");
        if (layoutRef.current.isPhoneLayout) setPhoneCartOpen(true);
        else if (layoutRef.current.isMobileLayout) setIsOpen(true);
      }),
    [setIsOpen],
  );
  // Qué letra saldría si se factura, con la MISMA matriz que aplica el
  // server al cobrar: emisor + cliente elegido + preferencias. Sin el corte
  // por conexión con ARCA, que acá no se conoce; si al cobrar ARCA no está,
  // create-sale lo dice y ofrece cobrar con ticket. Se recalcula al cambiar
  // el cliente: a un RI le corresponde A y a consumidor final B.
  const comprobanteFiscal = facturacionActiva
    ? determinarComprobanteFiscal({
        operacion: "VENTA",
        modoFacturacion: branding?.modo_facturacion,
        condicionIvaEmisor: branding?.condicion_iva,
        condicionIvaReceptor: clienteSeleccionado?.condicion_iva,
        comprobanteDefecto: branding?.comprobante_defecto,
        riAMonotributo: branding?.arca_ri_a_monotributo,
      })
    : null;
  // Controlado desde acá solo para que F7 pueda abrirlo sin un click. Cuando
  // se maneja con el mouse, el selector sigue haciendo lo suyo.
  const [selectorClienteAbierto, setSelectorClienteAbierto] = useState(false);

  const isPOSMode = true;
  const totalCarrito = getTotalPrice();
  const effectiveCheckoutStep: CheckoutStep =
    items.length === 0 ? "CART" : checkoutStep;

  // Se vuelve a pedir cada vez que cambia el negocio activo. Antes las deps
  // eran `[]` y esta consulta corría UNA sola vez por montaje: al cambiar de
  // comercio con router.refresh() (navegación blanda, el componente no se
  // desmonta) el POS seguía cobrando con la configuración del comercio
  // anterior. Incidente 15/8 en Evens: el recargo de cuenta corriente se
  // mostró al 5% (el de ClickTostado) sobre una venta que la base cobra al
  // 15%, y el pago viajó con un metodo_pago_id de otro negocio, así que la
  // venta terminó rebotando con "Método de pago inválido".
  useEffect(() => {
    let cancelado = false;

    const fetchConfig = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("configuracion_pos")
        .select("*")
        .single();

      if (cancelado || !data) return;
      setConfigCargada({ negocioId, config: data as ConfiguracionPOS });
    };

    fetchConfig();

    return () => {
      cancelado = true;
    };
  }, [negocioId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateLayout = () => setIsMobileLayout(mediaQuery.matches);

    updateLayout();
    mediaQuery.addEventListener("change", updateLayout);

    return () => {
      mediaQuery.removeEventListener("change", updateLayout);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const updateLayout = () => setIsPhoneLayout(mediaQuery.matches);

    updateLayout();
    mediaQuery.addEventListener("change", updateLayout);

    return () => {
      mediaQuery.removeEventListener("change", updateLayout);
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    const checkUserAndFetchData = async () => {
      // `getSession()` lee la sesión guardada localmente, no sale a la red.
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (session) {
        setUsuarioId(session.user.id);
        const metadata = session.user.user_metadata;

        // Las tres consultas EN PARALELO. Iban una atrás de otra, esperando la
        // anterior para nada: no dependen entre sí. Desde el navegador cada
        // una es un viaje a Supabase (~30 ms desde Argentina), así que
        // encadenarlas era triplicar la espera de la pantalla donde se cobra.
        //
        // Van desde el navegador y no por una server action a propósito: la
        // función de Vercel está en otro continente que el usuario, así que
        // meterla en el medio agregaría un salto en vez de sacarlo. Cuando el
        // cómputo pase a San Pablo se puede reconsiderar.
        const [{ data: perfil }, { data: promos }, { data: metodos }] =
          await Promise.all([
            supabase
              .from("perfiles")
              .select("nombre")
              .eq("id", session.user.id)
              .maybeSingle(),
            supabase
              .from("promociones")
              .select(
                `
              *,
              promociones_metodos_pago ( metodo_pago ),
              promociones_categorias ( categoria_nombre )
            `,
              )
              .eq("activa", true),
            supabase
              .from("metodos_pago")
              .select("id, nombre, tipo, comision, recargo_porcentaje")
              .eq("activo", true)
              .order("comision", { ascending: true }),
          ]);

        if (!isMounted) return;

        setVendedorNombre(
          perfil?.nombre ||
            metadata?.nombre ||
            metadata?.name ||
            metadata?.full_name ||
            session.user.email?.split("@")[0] ||
            "Tú",
        );

        if (promos) {
          setPromosCargadas({
            negocioId,
            promociones: promos as unknown as PromocionDB[],
          });
        }

        if (metodos) {
          setMetodosCargados({
            negocioId,
            metodos: metodos as unknown as MetodoPago[],
          });
        }
      }
    };

    checkUserAndFetchData();

    return () => {
      isMounted = false;
    };
    // Promociones y métodos de pago son por negocio, igual que la config de
    // arriba: sin `negocioId` en las deps el POS ofrece los métodos del
    // comercio anterior y el server rechaza la venta.
  }, [negocioId]);

  const promocionesElegibles = useMemo(() => {
    if (!promocionesPermitidas) return [];
    return getPromocionesElegibles({
      promociones: promocionesDB,
      pagos,
      items,
      metodosPago: metodosPagoDB,
      canal: "POS",
    });
  }, [promocionesDB, pagos, items, metodosPagoDB, promocionesPermitidas]);

  const promocionActivaId = useMemo(() => {
    return getPromocionActivaId(promocionId, promocionesElegibles);
  }, [promocionesElegibles, promocionId]);

  const descuentoDetalle = useMemo(() => {
    return getDescuentoDetalle({
      promocionActivaId,
      promocionesElegibles,
      items,
    });
  }, [promocionActivaId, promocionesElegibles, items]);

  const subtotalConDescuento = totalCarrito - descuentoDetalle.monto;
  // Lo que el recargo CC sería si se aplicara. Se calcula igual esté anulado
  // o no: es lo que el footer necesita para poder ofrecer "restaurar".
  const recargoCuentaCorrientePotencial = isCuentaCorriente
    ? (subtotalConDescuento * (branding?.cc_recargo_default || 0)) / 100
    : 0;
  const recargoCuentaCorriente = ccSinRecargo
    ? 0
    : recargoCuentaCorrientePotencial;

  const totalFinal = subtotalConDescuento + recargoCuentaCorriente;
  const clienteExceptuadoEntregaMinima =
    clienteSeleccionado?.exceptuado_entrega_minima ?? false;

  /**
   * LA LISTA DEL CLIENTE SE SUGIERE, NO SE IMPONE.
   *
   * El cliente se elige en el paso de PAGO (ver el atajo F7), o sea después
   * de que la clienta ya vio el ticket armado. Re-preciar en silencio ahí es
   * cambiarle todos los números delante, así que:
   *
   *   - con el ticket VACÍO se aplica sola: no hay nada que cambiar de atrás
   *     para adelante, y es el camino normal cuando se elige al cliente
   *     primero.
   *   - con renglones cargados se PREGUNTA, mostrando los dos totales. Sin el
   *     número de antes y el de después no hay forma de decidir.
   *
   * Camino real esperado: al mayorista se lo reconoce al entrar y la
   * vendedora toca el chip antes de cargar. Este aviso es para el olvido.
   */
  const clienteYaOfrecido = useRef<string | null>(null);
  useEffect(() => {
    if (!clienteSeleccionado) return;
    const listaDelCliente = clienteSeleccionado.lista_precio_id ?? null;
    const clave = `${clienteSeleccionado.id}|${listaDelCliente}`;

    // La decisión vive en `sugerencia-lista-cliente.ts`, que es pura y tiene
    // sus cinco ramas probadas. Acá solo se la ejecuta.
    const decision = decidirSugerenciaDeLista({
      listaDelCliente,
      listaActivaId: listaPrecioId,
      listaExiste: Boolean(listaDelCliente && listaPorId.has(listaDelCliente)),
      elegidaAMano: listaElegidaAMano.current,
      ticketVacio: items.length === 0,
      yaOfrecida: clienteYaOfrecido.current === clave,
    });

    if (decision.accion === "NADA") return;
    clienteYaOfrecido.current = clave;

    const nombreLista =
      listaPorId.get(decision.listaId)?.nombre ?? "otra lista";

    if (decision.accion === "APLICAR") {
      cambiarListaPrecio(decision.listaId);
      toast.info(
        `Precios de ${nombreLista} para ${clienteSeleccionado.nombre}.`,
      );
      return;
    }

    const antes = totalConLista(listaPrecioId);
    const despues = totalConLista(decision.listaId);
    // Sin diferencia en pesos no hay nada que preguntar.
    if (Math.round(antes) === Math.round(despues)) return;

    toast(`${clienteSeleccionado.nombre} tiene precios de ${nombreLista}.`, {
      description: `El ticket pasa de ${Math.round(antes).toLocaleString("es-AR")} a ${Math.round(despues).toLocaleString("es-AR")}.`,
      duration: Infinity,
      action: {
        label: "Aplicar",
        onClick: () => cambiarListaPrecio(decision.listaId),
      },
      cancel: { label: "Dejar así", onClick: () => {} },
    });
    // Las funciones se rearman en cada render (dependen de `items`);
    // incluirlas dispararía el aviso con cada cambio del carrito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteSeleccionado, listaPrecioId, listaPorId, items.length]);

  const capturarVentaEnPantalla = (base: {
    id: string;
    numero: number;
    creadaEn: string;
  }): VentaEnCola => ({
    ...base,
    items,
    listaPrecioId,
    pedidoActivo,
    cliente: clienteSeleccionado,
    pagos,
    modoMixto,
    cuentaCorriente: isCuentaCorriente,
    ccSinRecargo,
    reserva: isReserva,
    promocionId,
    facturarElegido,
    paso: effectiveCheckoutStep,
    unidadesElegidas: unidadesElegidasRaw,
    listaElegidaAMano: listaElegidaAMano.current,
  });

  const cargarVentaEnPantalla = (venta: VentaEnCola) => {
    reemplazarCarrito({
      items: venta.items,
      listaPrecioId: venta.listaPrecioId,
      pedidoActivo: venta.pedidoActivo,
    });
    setClienteSeleccionado(venta.cliente);
    setPagos(venta.pagos);
    setModoMixto(venta.modoMixto);
    setIsCuentaCorriente(venta.cuentaCorriente);
    setCcSinRecargo(venta.ccSinRecargo);
    setIsReserva(venta.reserva);
    setPromocionId(venta.promocionId);
    setFacturarElegido(venta.facturarElegido);
    setCheckoutStep(venta.items.length > 0 ? venta.paso : "CART");
    setUnidadesElegidasRaw(venta.unidadesElegidas);
    listaElegidaAMano.current = venta.listaElegidaAMano;
    clienteYaOfrecido.current = null;
    setSelectorClienteAbierto(false);
    setVistaTicket("VENTA_ACTUAL");
  };

  const ventaActualTieneContenido = () =>
    items.length > 0 ||
    pedidoActivo !== null ||
    clienteSeleccionado !== null ||
    listaPrecioId !== null;

  const guardarVentaActualAhora = () => {
    if (!alcanceVentas) return;
    const sesion =
      useVentasEnColaStore.getState().sesiones[alcanceVentas];
    const activa = sesion?.ventas.find(
      (venta) => venta.id === sesion.ventaActivaId,
    );
    if (activa) guardarVenta(alcanceVentas, capturarVentaEnPantalla(activa));
  };

  const crearNuevaVenta = (forzar = false): VentaEnCola | null => {
    if (!alcanceVentas) return null;
    const sesion =
      useVentasEnColaStore.getState().sesiones[alcanceVentas];
    if (!sesion) return null;
    if (!forzar && !ventaActualTieneContenido()) {
      setVistaTicket("VENTA_ACTUAL");
      return (
        sesion.ventas.find((venta) => venta.id === sesion.ventaActivaId) ??
        null
      );
    }

    guardarVentaActualAhora();
    const nueva = crearVentaEnColaVacia(sesion.proximoNumero);
    agregarVenta(alcanceVentas, nueva);
    cargarVentaEnPantalla(nueva);
    return nueva;
  };

  const cambiarVentaActiva = (ventaId: string) => {
    if (!alcanceVentas) return;
    guardarVentaActualAhora();
    activarVenta(alcanceVentas, ventaId);
    const sesion =
      useVentasEnColaStore.getState().sesiones[alcanceVentas];
    const venta = sesion?.ventas.find((actual) => actual.id === ventaId);
    if (venta) cargarVentaEnPantalla(venta);
  };

  const retirarVentaActiva = () => {
    if (!alcanceVentas) return;
    const sesion =
      useVentasEnColaStore.getState().sesiones[alcanceVentas];
    if (!sesion) return;
    // Cuando se termina la última, la numeración vuelve a V1. Los números
    // identifican lo que está abierto ahora; no son un correlativo fiscal.
    const reemplazo = crearVentaEnColaVacia(
      sesion.ventas.length === 1 ? 1 : sesion.proximoNumero,
    );
    quitarVenta(alcanceVentas, sesion.ventaActivaId, reemplazo);
    const siguiente =
      useVentasEnColaStore.getState().sesiones[alcanceVentas];
    const venta = siguiente?.ventas.find(
      (actual) => actual.id === siguiente.ventaActivaId,
    );
    if (venta) cargarVentaEnPantalla(venta);
  };

  const quitarVentaPorId = (ventaId: string) => {
    if (!alcanceVentas) return;
    const sesion =
      useVentasEnColaStore.getState().sesiones[alcanceVentas];
    if (!sesion || sesion.ventas.length < 2) return;
    const eraActiva = sesion.ventaActivaId === ventaId;
    const reemplazo = crearVentaEnColaVacia(sesion.proximoNumero);
    quitarVenta(alcanceVentas, ventaId, reemplazo);
    if (!eraActiva) return;
    const siguiente =
      useVentasEnColaStore.getState().sesiones[alcanceVentas];
    const venta = siguiente?.ventas.find(
      (actual) => actual.id === siguiente.ventaActivaId,
    );
    if (venta) cargarVentaEnPantalla(venta);
  };

  const solicitarCerrarVentaActiva = () => {
    const ventaId = alcanceVentas
      ? useVentasEnColaStore.getState().sesiones[alcanceVentas]?.ventaActivaId
      : null;
    if (!ventaId) return;
    if (!ventaActualTieneContenido()) {
      quitarVentaPorId(ventaId);
      return;
    }
    // Congela el contenido antes de mostrar la confirmación: si durante esos
    // segundos cambia de pestaña, la acción sigue cerrando ESTA venta.
    guardarVentaActualAhora();
    toast.warning("¿Cerrar esta venta?", {
      description: "Se van a descartar los productos y datos de este ticket.",
      duration: 10000,
      action: { label: "Cerrar", onClick: () => quitarVentaPorId(ventaId) },
    });
  };

  // Cuando conocemos negocio + usuario, restaura SU conjunto de tickets. El
  // primer uso migra el carrito único anterior; un usuario nuevo en el mismo
  // navegador arranca vacío y nunca hereda el ticket de otra persona.
  useEffect(() => {
    if (!alcanceVentas) return;
    alcanceVentasCargado.current = null;
    queueMicrotask(() => {
      const store = useVentasEnColaStore.getState();
      let sesion = store.sesiones[alcanceVentas];
      if (!sesion) {
        const base = crearVentaEnColaVacia(1);
        const esPrimeraMigracion = Object.keys(store.sesiones).length === 0;
        const carritoLegado = useCartStore.getState();
        const inicial = esPrimeraMigracion
          ? {
              ...base,
              items: carritoLegado.items,
              listaPrecioId: carritoLegado.listaPrecioId,
              pedidoActivo: carritoLegado.pedidoActivo,
            }
          : base;
        inicializarVentas(alcanceVentas, inicial);
        sesion = useVentasEnColaStore.getState().sesiones[alcanceVentas];
      }
      const activa = sesion?.ventas.find(
        (venta) => venta.id === sesion.ventaActivaId,
      );
      alcanceVentasCargado.current = alcanceVentas;
      if (activa) cargarVentaEnPantalla(activa);
    });
    // La carga debe ocurrir únicamente al cambiar de usuario o negocio. Las
    // funciones capturan la pantalla de ese render, pero no gobiernan cuándo
    // se cambia de alcance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alcanceVentas]);

  // Guarda el ticket activo completo ante cada cambio. Es una escritura al
  // store persistido, no estado derivado de React: permite recuperar cliente,
  // pagos y promoción después de una recarga, no solo los renglones.
  useEffect(() => {
    if (
      !alcanceVentas ||
      alcanceVentasCargado.current !== alcanceVentas
    ) {
      return;
    }
    const sesion =
      useVentasEnColaStore.getState().sesiones[alcanceVentas];
    const activa = sesion?.ventas.find(
      (venta) => venta.id === sesion.ventaActivaId,
    );
    if (activa) guardarVenta(alcanceVentas, capturarVentaEnPantalla(activa));
    // `capturarVentaEnPantalla` se rearma porque representa justamente todos
    // los campos listados abajo. Incluir la función duplicaría cada guardado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    alcanceVentas,
    items,
    listaPrecioId,
    pedidoActivo,
    clienteSeleccionado,
    pagos,
    modoMixto,
    isCuentaCorriente,
    ccSinRecargo,
    isReserva,
    promocionId,
    facturarElegido,
    effectiveCheckoutStep,
    unidadesElegidasRaw,
    guardarVenta,
  ]);

  const anticipoMinimo =
    isCuentaCorriente && !clienteExceptuadoEntregaMinima
      ? (totalFinal * (branding?.cc_anticipo_default || 0)) / 100
      : 0;
  const firstPagoId = pagos[0]?.metodoPagoId;

  // En Cuenta Corriente no caemos al primer método de la lista si el
  // usuario todavía no eligió ninguno — este es el valor que efectivamente
  // se manda al backend (ver pagosToSubmit más abajo), así que sin este
  // guard el fix de "no autocompletar" en CartStepCheckout sería solo
  // cosmético: la venta igual se registraría con un método que nadie
  // eligió.
  const metodoPagoRapidoId =
    firstPagoId || (isCuentaCorriente ? "" : metodosPagoDB[0]?.id || "");
  const pagosSincronizados = useMemo<CreateSalePaymentInput[]>(() => {
    if (modoMixto) return pagos;
    if (!metodoPagoRapidoId) return [];
    return [
      {
        metodoPagoId: metodoPagoRapidoId,
        montoAsignado: isCuentaCorriente ? anticipoMinimo : totalFinal,
      },
    ];
  }, [
    anticipoMinimo,
    isCuentaCorriente,
    metodoPagoRapidoId,
    modoMixto,
    pagos,
    totalFinal,
  ]);

  const sumaPagos = useMemo(
    () =>
      pagosSincronizados.reduce(
        (acc, p) => acc + Number(p.montoAsignado || 0),
        0,
      ),
    [pagosSincronizados],
  );

  // Recargo por método: se recalcula cada vez que cambia el método elegido o
  // el reparto del pago mixto, porque el total a cobrar depende de CÓMO se
  // paga. `sumaPagos` sigue siendo la suma de bases (lo que cubre el ticket);
  // el recargo va aparte y se suma recién en `totalACobrar`. El server
  // recalcula lo mismo con los % de la base — este número es solo para que la
  // vendedora vea antes de cobrar lo que se va a persistir.
  const recargoMetodo = useMemo(
    () => calcularPagosConRecargo(pagosSincronizados, metodosPagoDB),
    [pagosSincronizados, metodosPagoDB],
  );
  const recargoMetodoEtiqueta = useMemo(
    () => etiquetaRecargo(recargoMetodo.pagos, metodosPagoDB),
    [recargoMetodo, metodosPagoDB],
  );
  const totalACobrar = totalFinal + recargoMetodo.totalRecargo;

  // 🚀 FIX: AUTO-SYNC DE PAGOS (Garantiza que el cajero nunca vea "$4.248 de $4.720")
  if (!mounted) return null;

  const closeSidebar = () => {
    setCheckoutStep("CART");
    setIsOpen(false);
    setPhoneCartOpen(false);
  };

  const clearCartAndResetStep = () => {
    clearCart();
    setCheckoutStep("CART");
    if (esCajaCentral) setVistaTicket("POR_COBRAR");
    // Vaciar el ticket vacía también la decisión de lista: el próximo cliente
    // vuelve a poder proponer la suya. Sin esto, un "Dejar así" de hace tres
    // ventas seguiría silenciando el aviso toda la tarde.
    olvidarEleccionDeLista();
    cambiarListaPrecio(null);
  };

  const soltarPedidoActivo = () => {
    const cantidadVentas = alcanceVentas
      ? (useVentasEnColaStore.getState().sesiones[alcanceVentas]?.ventas
          .length ?? 1)
      : 1;
    clearCartAndResetStep();
    if (cantidadVentas > 1) retirarVentaActiva();
    setVistaTicket("POR_COBRAR");
  };

  const handleCuentaCorrienteChange = (value: boolean) => {
    setIsCuentaCorriente(value);
    // Apagar CC descarta la exención: si se vuelve a prender, arranca con el
    // recargo puesto. Anularlo tiene que ser siempre un acto explícito.
    if (!value) setCcSinRecargo(false);
    if (value) {
      setIsReserva(false);
      setPromocionId("ninguna");
    }
  };

  const handleReservaChange = (value: boolean) => {
    setIsReserva(value);
    if (value) {
      setIsCuentaCorriente(false);
      setPromocionId("ninguna");
    }
  };

  const handleConfirmarReserva = () => {
    if (!clienteSeleccionado) {
      toast.error("Selecciona un cliente para reservar.");
      return;
    }
    if (items.some((item) => !item.varianteId)) {
      toast.error(
        "Alguno de los productos no tiene variante registrada y no se puede reservar.",
      );
      return;
    }

    startTransition(async () => {
      const result = await crearReservaAction(
        clienteSeleccionado.id,
        items.map((item) => ({
          productoId: item.productoId,
          varianteId: item.varianteId,
          cantidad: item.cantidad,
        })),
      );

      if (!result.success) {
        toast.error("No se pudo registrar la reserva.", {
          description: result.error ?? "Intenta nuevamente.",
        });
        return;
      }

      toast.success("Reserva registrada.");
      clearCartAndResetStep();
      setPromocionId("ninguna");
      setModoMixto(false);
      setIsReserva(false);
      setClienteSeleccionado(null);
      closeSidebar();
      retirarVentaActiva();
    });
  };

  const handleContinueToPayment = () => {
    if (pagos.length === 0 && metodosPagoDB.length > 0) {
      setPagos([
        {
          metodoPagoId: metodosPagoDB[0].id,
          montoAsignado: totalFinal,
        },
      ]);
    }
    setCheckoutStep("PAYMENT");
  };

  const handleEnviarPedidoWhatsApp = () => {
    setTimeout(() => {
      clearCartAndResetStep();
      closeSidebar();
      retirarVentaActiva();
    }, 1000);
  };

  /**
   * Varios puestos, una caja: el carrito se guarda como pedido con un número
   * corto y se vacía. La caja lo ve en "Por cobrar". No toca stock ni caja:
   * eso pasa recién al cobrar.
   */
  const handleEnviarACaja = () => {
    if (!items.length) {
      toast.error("El carrito está vacío.");
      return;
    }
    startTransition(async () => {
      const r = await crearPedidoAction({
        items,
        clienteId: clienteSeleccionado?.id ?? null,
        // Todo lo que ya se le preguntó al cliente viaja con el pedido: la
        // caja no vuelve a preguntar nada, solo cobra.
        contexto: {
          isCuentaCorriente,
          ccSinRecargo,
          cliente: clienteSeleccionado
            ? {
                id: clienteSeleccionado.id,
                nombre: clienteSeleccionado.nombre,
                telefono: clienteSeleccionado.telefono ?? null,
                exceptuado_entrega_minima:
                  clienteSeleccionado.exceptuado_entrega_minima,
                lista_precio_id: clienteSeleccionado.lista_precio_id ?? null,
              }
            : null,
          pagos: pagosSincronizados,
          modoMixto,
          promocionId: promocionActivaId,
          listaPrecioId: listaActiva?.id ?? null,
          facturar: facturacionActiva ? facturar : null,
        },
      });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      clearCartAndResetStep();
      setClienteSeleccionado(null);
      retirarVentaActiva();
      toast.success(`Pedido #${r.numero} enviado a la caja`, {
        description: "Decile el número al cliente: con eso lo cobran en caja.",
        duration: 10000,
      });
    });
  };

  /**
   * La caja carga un pedido: renglones + el paso de cobro tal como lo dejó
   * la vendedora, y se abre directo en PAYMENT. Lo que el pedido no trae
   * (pedido viejo, o mandado sin pasar por el cobro) queda en el default.
   */
  const cargarPedido = (p: PedidoPorCobrar) => {
    // Un pedido nunca pisa la venta que la cajera estaba armando: si tiene
    // contenido, se conserva en su pestaña y el pedido ocupa una nueva.
    if (ventaActualTieneContenido() && !crearNuevaVenta(true)) {
      toast.error("Todavía se están preparando las ventas en cola.", {
        description: "Esperá un instante y volvé a cargar el pedido.",
      });
      return;
    }
    const ctx = p.contexto ?? {};
    clearCart();
    for (const i of p.items) {
      addItem({
        productoId: i.productoId,
        nombre: i.nombre,
        tipo: i.tipo,
        variante: i.variante,
        varianteId: i.varianteId,
        precio: i.precio,
        precioBase: i.precioBase,
        precioBaseEfectivo: i.precioBaseEfectivo,
        cantidad: i.cantidad,
        unidadMedida: i.unidadMedida ?? null,
        imagenUrl: i.imagenUrl ?? null,
        // El stock real lo valida el server al cobrar (UPDATE atómico); acá
        // no hay catálogo a mano y un tope inventado bloquearía la línea.
        stockMaximo: Number.MAX_SAFE_INTEGER,
        ventaLibre: i.ventaLibre,
        presentacionId: i.presentacionId ?? null,
        presentacionNombre: i.presentacionNombre ?? null,
        factor: i.factor ?? 1,
        presentaciones: i.presentaciones,
      });
    }
    // La lista con la que se precio el pedido, sin re-preciar: los renglones
    // ya traen el precio de esa lista y su base.
    const preciosDelPedido: Record<
      string,
      { precio: number; precioBase: number; precioBaseEfectivo: number }
    > = {};
    for (const i of p.items) {
      preciosDelPedido[claveLinea(i)] = {
        precio: i.precio,
        precioBase: i.precioBase ?? i.precio,
        precioBaseEfectivo:
          i.precioBaseEfectivo ?? i.precioBase ?? i.precio,
      };
    }
    setListaPrecio(ctx.listaPrecioId ?? null, preciosDelPedido);

    setClienteSeleccionado(
      ctx.cliente ??
        (p.cliente_id ? { id: p.cliente_id, nombre: p.cliente_nombre ?? "Cliente" } : null),
    );
    setIsCuentaCorriente(Boolean(ctx.isCuentaCorriente));
    setCcSinRecargo(Boolean(ctx.isCuentaCorriente && ctx.ccSinRecargo));
    setIsReserva(false);
    setModoMixto(Boolean(ctx.modoMixto));
    // Solo métodos que existen en este comercio HOY; uno borrado se cae y
    // el paso de cobro vuelve a su default.
    const pagosValidos = (ctx.pagos ?? []).filter((pg) =>
      metodosPagoDB.some((m) => m.id === pg.metodoPagoId),
    );
    setPagos(pagosValidos);
    setPromocionId(ctx.promocionId ?? "ninguna");
    setFacturarElegido(ctx.facturar ?? null);
    setPedidoActivo({ id: p.id, numero: p.numero, vendedor: p.vendedor_nombre });
    setCheckoutStep("PAYMENT");
    setVistaTicket("VENTA_ACTUAL");
    // Abre el ticket en el layout que sea: sheet en tablet, drawer en celular.
    setIsOpen(true);
    setPhoneCartOpen(true);
  };

  const handleConfirmarVentaPOS = (
    montoAnticipoModal?: number,
    // La selección del modal llega por argumento y no por estado: al salir
    // del modal, este closure todavía vería `unidadesElegidas` vacío y la
    // venta saldría sin aparatos.
    unidadesOverride?: UnidadSeleccionada[],
    /** Reintento tras "ARCA no responde": cobrar con ticket interno. */
    opciones?: { sinFacturaPorArcaCaido?: boolean },
  ) => {
    const montoRealAsignado =
      montoAnticipoModal !== undefined ? montoAnticipoModal : sumaPagos;

    const unidadesParaVenta = unidadesOverride ?? unidadesElegidas;
    const imeisParaVenta = Object.fromEntries(
      unidadesParaVenta.map((u) => [u.varianteId, u.imei]),
    );

    // Antes que cualquier otra validación: si hay líneas serializadas sin
    // aparato elegido, se abre el modal y no se cobra nada. El server hace
    // el mismo chequeo (esto es solo la UX; la regla vive en create-sale).
    if (lineasSerializadas.some((l) => !imeisParaVenta[l.varianteId])) {
      setAnticipoPendiente(montoAnticipoModal);
      setModalUnidades("CONFIRMAR");
      return;
    }

    // Sin la configuración del negocio activo no se cobra. Con `branding` en
    // null el recargo de cuenta corriente se calcula en 0 y los métodos de
    // pago vienen vacíos: la vendedora vería un total que no es el que la base
    // va a cobrar. Pasa en la ventana entre cambiar de comercio y que vuelvan
    // las consultas — corta, pero es plata.
    if (!branding || metodosPagoDB.length === 0) {
      toast.error("Todavía se está cargando la configuración del comercio.", {
        description: "Esperá un segundo y volvé a confirmar.",
      });
      return;
    }

    if (isCuentaCorriente && !clienteSeleccionado) {
      toast.error("Selecciona un cliente para Cuenta Corriente.");
      return;
    }

    if (
      isCuentaCorriente &&
      montoRealAsignado + 0.05 < anticipoMinimo &&
      branding?.entrega_minima_bloqueante
    ) {
      toast.error("Este cliente requiere al menos una entrega mínima.", {
        description: `Mínimo: $${anticipoMinimo.toLocaleString("es-AR")}`,
      });
      return;
    }

    if (!isCuentaCorriente && Math.abs(montoRealAsignado - totalFinal) > 0.05) {
      toast.error("La suma de los pagos no coincide con el total.", {
        description:
          "Asegúrate de asignar el dinero exacto para poder cerrar la caja correctamente.",
      });
      return;
    }

    startTransition(async () => {
      try {
        if (!items.length) {
          toast.error("El carrito está vacío.");
          return;
        }

        // 🚀 ARMAMOS LOS PAGOS DEFINITIVOS PARA EL BACKEND
        let pagosToSubmit = [...pagosSincronizados];
        if (isCuentaCorriente && montoAnticipoModal !== undefined) {
          // Tomamos el método de pago seleccionado y le asignamos el anticipo tipeado
          pagosToSubmit = [
            { ...pagosSincronizados[0], montoAsignado: montoAnticipoModal },
          ];
        }

        // El anticipo tipeado en el modal cambia la base, así que el recargo
        // del ticket se recalcula sobre los pagos DEFINITIVOS, no sobre los
        // que se estaban mostrando en el panel.
        const recargoSubmit = calcularPagosConRecargo(
          pagosToSubmit,
          metodosPagoDB,
        );

        // El id de la venta se genera ACÁ, antes de saber si hay señal, y
        // es lo que hace que una venta encolada se pueda reintentar sin
        // riesgo: es la PK, así que el server reconoce el reenvío y no la
        // cobra dos veces. La hora también es de acá — es cuando la clienta
        // pagó, no cuando el registro logró subir.
        const ventaId = crypto.randomUUID();
        const vendidaEn = new Date().toISOString();

        const formData = new FormData();
        formData.append("venta_id", ventaId);
        formData.append("vendida_en", vendidaEn);
        formData.append("cart_items", JSON.stringify(items));
        formData.append("pagos", JSON.stringify(pagosToSubmit));
        formData.append("metodo_pago_id", pagosToSubmit[0]?.metodoPagoId || "");
        formData.append("is_cuenta_corriente", String(isCuentaCorriente));
        // El pedido que se está cobrando: queda COBRADO y la venta a nombre
        // de quien lo armó.
        if (pedidoActivo) {
          formData.append("pedido_id", pedidoActivo.id);
        }
        if (facturacionActiva) {
          formData.append("facturar", String(facturar));
          if (opciones?.sinFacturaPorArcaCaido) {
            formData.append("sin_factura_por_arca_caido", "true");
          }
        }
        formData.append("recargo_cc", String(recargoCuentaCorriente));
        formData.append("cc_sin_recargo", String(ccSinRecargo));

        if (clienteSeleccionado) {
          formData.append("cliente_id", clienteSeleccionado.id);
        }

        // Solo las unidades de líneas que siguen en el carrito. El server
        // vuelve a validar cuáles corresponden y rechaza las que no.
        if (unidadesParaVenta.length > 0) {
          formData.append(
            "unidades_serie",
            JSON.stringify(
              unidadesParaVenta.map((u) => ({
                varianteId: u.varianteId,
                unidadId: u.unidadId,
              })),
            ),
          );
        }

        const reservaIds = items.flatMap((item) => item.reservaIds ?? []);
        if (reservaIds.length > 0) {
          formData.append("reserva_ids", JSON.stringify(reservaIds));
        }

        // Solo el ID: el precio lo resuelve el server contra la base, igual
        // que el de cada renglón. Un id de otro negocio no lo devuelve ni la
        // RLS, así que la venta cae al precio base en vez de fallar.
        if (listaActiva) {
          formData.append("lista_precio_id", listaActiva.id);
        }

        if (promocionActivaId !== "ninguna" && descuentoDetalle.monto > 0) {
          formData.append("promocion_id", promocionActivaId);
          formData.append("descuento_monto", descuentoDetalle.monto.toString());
        }

        /**
         * Guarda la venta en el celular para subirla después. Se usa cuando
         * no hay señal y cuando el intento se muere en la red.
         *
         * Devuelve si se pudo guardar. Cuando NO se puede —el celular sin
         * lugar, o el navegador sin IndexedDB— la venta NO se da por hecha:
         * es preferible que la vendedora lo sepa antes de entregar la
         * mercadería y no que la venta desaparezca en silencio.
         */
        const guardarParaDespues = async () => {
          if (!negocioId) return false;

          const campos: Record<string, string> = {};
          formData.forEach((valor, clave) => {
            if (typeof valor === "string") campos[clave] = valor;
          });
          campos["offline"] = "true";

          const guardada = await encolarVenta({
            ventaId,
            negocioId,
            campos,
            vendidaEn,
            total: totalFinal,
            intentos: 0,
          });

          if (guardada) {
            void refrescarPendientes(negocioId);
          }
          return guardada;
        };

        // Sin señal ni se intenta: el POST tarda en morirse y son segundos
        // de la clienta esperando frente al mostrador para llegar al mismo
        // lugar. `navigator.onLine` en false es confiable (no hay interfaz
        // de red); en true no garantiza nada, y para eso está el catch.
        const sinSenal =
        typeof navigator !== "undefined" && navigator.onLine === false;

        let result: Awaited<ReturnType<typeof registrarVentaAction>>;

        if (sinSenal) {
          if (!(await guardarParaDespues())) {
            toast.error("No se pudo guardar la venta en este dispositivo", {
              description:
                "No la cobres todavía: no hay conexión y el celular no pudo anotarla.",
            });
            return;
          }
          result = { error: null, success: true, ventaId } as typeof result;
        } else {
          try {
            result = await registrarVentaAction(
              { error: null, success: false },
              formData,
            );
          } catch (error) {
            // La venta se murió en la red. NO se sabe si el server la llegó
            // a registrar, y por eso encolarla es seguro: si ya estaba, el
            // reintento la reconoce por su id y no la duplica.
            if (!esErrorDeRed(error)) throw error;

            if (!(await guardarParaDespues())) {
              toast.error("Se cortó la conexión y no se pudo guardar la venta", {
              description:
                  "Revisá la señal y volvé a cobrar: no quedó registrada.",
              });
              return;
            }
            result = { error: null, success: true, ventaId } as typeof result;
          }
        }

        if (!result.success) {
          if (result.error === "CAJA_CERRADA") {
            toast.error("La caja está cerrada", {
              description:
                "Debes abrir un turno en el módulo de Caja para poder cobrar.",
              action: {
                label: "Ir a Caja",
                onClick: () => {
                  closeSidebar();
                  router.push("/caja");
                },
              },
            });
          } else if ("arcaCaido" in result && result.arcaCaido) {
            // ARCA no respondió. La clienta está en el mostrador: se ofrece
            // cobrar igual con ticket interno y facturar después desde el
            // historial. No se decide solo — es una elección del comercio.
            toast.error("ARCA no responde", {
              description:
                "Podés cobrar con ticket interno y facturar esta venta después desde el historial.",
              duration: 15000,
              action: {
                label: "Cobrar con ticket",
                onClick: () =>
                  handleConfirmarVentaPOS(montoAnticipoModal, unidadesOverride, {
                    sinFacturaPorArcaCaido: true,
                  }),
              },
            });
          } else {
            toast.error("No se pudo registrar la venta.", {
              description: result.error ?? "Intenta nuevamente.",
            });
          }
          return;
        }

        // Sin toast de éxito: lo que sigue es la pantalla de "venta realizada"
        // (`VentaExitosa`, en el lugar del catálogo), que es la confirmación
        // de verdad y no se puede perder de vista. Un cartel encima diciendo
        // lo mismo es ruido.
        const nombreMetodoMostrar =
          pagosToSubmit.length > 1
            ? `Pago mixto (${pagosToSubmit
                .map(
                  (p) =>
                    metodosPagoDB.find((m) => m.id === p.metodoPagoId)?.nombre,
                )
                .join(" + ")})`
            : metodosPagoDB.find((m) => m.id === pagosToSubmit[0]?.metodoPagoId)
                ?.nombre || "Efectivo";

        // El correlativo emitido es el número real del comprobante. Si la
        // emisión falló, el ticket cae al identificador de la venta — que es
        // lo que se imprimía antes de que existieran los comprobantes, así
        // que la vendedora nunca se queda sin nada que decirle al cliente.
        const idReal =
          formatearNumeroComprobante(
            result.comprobante?.puntoVenta,
            result.comprobante?.numero,
          ) ?? (result.ventaId ?? "").split("-")[0].toUpperCase();
        const montoPendiente = isCuentaCorriente
          ? Math.max(0, totalFinal - montoRealAsignado)
          : 0;
        const estadoVenta = isCuentaCorriente
          ? montoRealAsignado > 0
            ? "PARCIAL"
            : "PENDIENTE"
          : "PAGADA";

        setVentaExitosa({
          // El IMEI viaja al ticket recién impreso: es el comprobante de
          // garantía del aparato que el cliente se acaba de llevar.
          items: items.map((item) => ({
            ...item,
            // La descripción de una venta libre ya es el nombre; repetirla
            // entre paréntesis en el papel no agrega nada.
            variante: item.ventaLibre ? "" : item.variante,
            imei: item.varianteId
              ? (imeisParaVenta[item.varianteId] ?? null)
              : null,
          })),
          total: totalFinal + recargoSubmit.totalRecargo,
          metodoPago: nombreMetodoMostrar,
          nroRecibo: idReal,
          fiscal: result.fiscal ?? null,
          descuentoMonto: descuentoDetalle.monto,
          promocionNombre: descuentoDetalle.nombre,
          recargoMetodoMonto: recargoSubmit.totalRecargo,
          recargoMetodoEtiqueta: etiquetaRecargo(
            recargoSubmit.pagos,
            metodosPagoDB,
          ),
          // Null sin lista, que es cuando el ticket no lo imprime.
          listaPrecioNombre: listaActiva?.nombre ?? null,
          vendedor: vendedorNombre || "Tú",
          clienteNombre: clienteSeleccionado?.nombre || "Consumidor final",
          estadoPago: estadoVenta,
          montoPendiente,
          montoCobrado: montoRealAsignado + recargoSubmit.totalRecargo,
          esFiadoDirecto: isCuentaCorriente,
        });

        /**
         * EL CATÁLOGO ACABA DE QUEDAR VIEJO: la venta descontó stock.
         *
         * Sin esto, la grilla sigue mostrando el stock de ANTES de la venta y
         * no se corrige sola: `useCatalogoPanel` tiene `staleTime` de 3
         * minutos y el provider va con `refetchOnWindowFocus: false`, así que
         * mientras /pos siga montado —o sea, toda la jornada— nada dispara un
         * refetch. La única invalidación que existía en el POS era la de Carga
         * rápida (`pos-terminal.tsx:373`).
         *
         * El síntoma es feo y confunde: se vende la última unidad, la tarjeta
         * sigue diciendo "1 disponible", alguien la vuelve a cargar y el server
         * la rechaza con "Sin stock suficiente para la variante X". La venta
         * anterior estaba perfecta; lo que mentía era la pantalla.
         *
         * Es barato: la query resincroniza por DELTA, así que trae solo los
         * productos que cambiaron —los de este ticket— y no los ~2 MB del
         * catálogo.
         */
        queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });

        clearCart();
        setCheckoutStep("CART");
        if (esCajaCentral) setVistaTicket("POR_COBRAR");
        setPromocionId("ninguna");
        setFacturarElegido(null);
        // La lista vuelve a Base después de cada venta, igual que la
        // promoción. Es fail-closed y a propósito: dejarla puesta arriesga
        // cobrarle mayorista a la clienta siguiente, que es un error del que
        // nadie se entera hasta el arqueo. Volver a tocar el chip cuesta un
        // click.
        cambiarListaPrecio(null);
        olvidarEleccionDeLista();
        setModoMixto(false);
        setIsCuentaCorriente(false);
        setCcSinRecargo(false);
        setClienteSeleccionado(null);
        // La pestaña cobrada desaparece. Si había otra venta estacionada se
        // restaura; si era la única queda un Ticket nuevo y vacío.
        closeSidebar();
        retirarVentaActiva();
        if (esCajaCentral) setVistaTicket("POR_COBRAR");
      } catch (error) {
        console.error("Error al registrar la venta POS:", error);
        toast.error("Ocurrió un error inesperado al registrar la venta.");
      }
    });
  };

  // El último renglón cargado: es sobre el que actúa Alt+↑/↓, porque es el
  // que se acaba de tocar y el que se está por corregir.
  const ultimoItem = items.length > 0 ? items[items.length - 1] : null;

  // Reservar es de indumentaria. Ver `rubroUsaReservas` para el porqué; el
  // freno de verdad está en `crearReservaAction`, que vuelve a preguntarle el
  // rubro a la base.
  const usaReservas = rubroUsaReservas(rubro);

  const ventasAbiertas = sesionVentas?.ventas ?? [];
  const ventaActivaId = sesionVentas?.ventaActivaId ?? null;
  const pedidosAbiertosIds = Array.from(
    new Set([
      ...ventasAbiertas.flatMap((venta) =>
        venta.pedidoActivo ? [venta.pedidoActivo.id] : [],
      ),
      ...(pedidoActivo ? [pedidoActivo.id] : []),
    ]),
  );

  const resumenPestana = (venta: VentaEnCola) => {
    const esActiva = venta.id === ventaActivaId;
    const lineas = esActiva ? items : venta.items;
    const cliente = esActiva ? clienteSeleccionado : venta.cliente;
    const total = lineas.reduce(
      (acumulado, item) => acumulado + item.precio * item.cantidad,
      0,
    );
    const nombre = cliente?.nombre.trim().split(/\s+/)[0] || `V${venta.numero}`;
    return `${nombre} · ${formatearMontoPestana(total)}`;
  };

  const CartContent = (
    <>
      {(!esCajaCentral || vistaTicket === "VENTA_ACTUAL") && (
        <AtajosCarrito
        paso={effectiveCheckoutStep}
        hayItems={items.length > 0}
        ocupado={isPending}
        irAPagar={handleContinueToPayment}
        volverAlCarrito={() => setCheckoutStep("CART")}
        confirmar={() =>
          usaReservas && isReserva
            ? handleConfirmarReserva()
            : handleConfirmarVentaPOS()
        }
        // El selector de cliente vive en el paso de pago: F7 desde el ticket
        // avanza primero y lo abre después, en vez de no hacer nada.
        abrirSelectorCliente={() => {
          if (effectiveCheckoutStep === "CART") handleContinueToPayment();
          setSelectorClienteAbierto(true);
        }}
        vaciarTicket={clearCartAndResetStep}
        abrirVentaLibre={() => useVentaLibreStore.getState().abrir()}
        // Pasa por los MISMOS handlers que los botones: apagar cuenta
        // corriente descarta la exención de recargo, y prender una apaga la
        // otra. Un atajo que seteara los estados por su cuenta se saltearía
        // esas reglas y quedaría desincronizado del ticket.
        elegirTipoVenta={(tipo: TipoVenta) => {
          if (tipo === "CUENTA_CORRIENTE") {
            handleCuentaCorrienteChange(true);
            return;
          }
          if (tipo === "RESERVA") {
            handleReservaChange(true);
            return;
          }
          handleCuentaCorrienteChange(false);
          handleReservaChange(false);
        }}
        puedeReservar={usaReservas}
        // Solo para lo que se vende por unidad. En un producto por peso el
        // paso mínimo es un gramo: "+1" ahí sería un kilo de más, y "+1 g" un
        // atajo que no cambia nada visible. Esa cantidad se tipea.
        ajustarUltimo={
          ultimoItem &&
          (ultimoItem.presentacionId || !esFraccionable(ultimoItem.unidadMedida))
            ? (delta: number) =>
                updateQuantity(
                  ultimoItem.productoId,
                  ultimoItem.variante,
                  ultimoItem.cantidad + delta,
                  ultimoItem.presentacionId ?? null,
                )
            : null
        }
        />
      )}

      {/* La flecha de volver vive ACÁ, al lado del título, y no adentro del
          paso de pago: es navegación entre pasos del ticket, no un control
          del formulario de cobro. Adentro empujaba el contenido hacia abajo y
          quedaba a media pantalla; en el header está siempre en el mismo
          lugar, como el de cerrar. */}
      <CartSidebarHeader
        isPOSMode={isPOSMode}
        onClose={closeSidebar}
        onTitleClick={() => setVistaTicket("VENTA_ACTUAL")}
        tituloAccion={
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => crearNuevaVenta()}
              disabled={!ventaActualTieneContenido()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
              aria-label="Nueva venta"
              title={
                ventaActualTieneContenido()
                  ? "Nueva venta"
                  : "El Ticket actual ya está vacío"
              }
            >
              <Plus className="h-4 w-4" />
            </button>
            {esCajaCentral && (
              <button
                type="button"
                onClick={() => setVistaTicket("POR_COBRAR")}
                className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold transition-colors cursor-pointer ${
                  vistaTicket === "POR_COBRAR"
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                aria-pressed={vistaTicket === "POR_COBRAR"}
                aria-label={`${colaPedidos.pedidos.length} pedidos por cobrar`}
              >
                <ClipboardList className="h-3.5 w-3.5" />
                <span className="hidden min-[360px]:inline">Por cobrar</span>
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                    vistaTicket === "POR_COBRAR"
                      ? "bg-white text-primary"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  {colaPedidos.pedidos.length}
                </span>
              </button>
            )}
          </div>
        }
        onBack={
          (!esCajaCentral || vistaTicket === "VENTA_ACTUAL") &&
          effectiveCheckoutStep === "PAYMENT"
            ? () => setCheckoutStep("CART")
            : undefined
        }
        comprobante={
          (!esCajaCentral || vistaTicket === "VENTA_ACTUAL") &&
          effectiveCheckoutStep === "PAYMENT" &&
          comprobanteFiscal &&
          comprobanteFiscal.tipo !== "TICKET" &&
          !comprobanteFiscal.tipo.startsWith("NOTA_") ? (
            <SelectorComprobante
              facturar={facturar}
              etiquetaFactura={
                ETIQUETA_COMPROBANTE[
                  comprobanteFiscal.tipo as keyof typeof ETIQUETA_COMPROBANTE
                ]
              }
              onChange={puedeElegirComprobante ? setFacturarElegido : undefined}
              motivoBloqueo="No tenés permiso para elegir el comprobante."
            />
          ) : undefined
        }
      />

      {ventasAbiertas.length > 1 && (
        <div
          role="tablist"
          aria-label="Ventas en cola"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/40 px-2 py-1.5"
        >
          {ventasAbiertas.map((venta) => {
            const activa = venta.id === ventaActivaId;
            return (
              <div
                key={venta.id}
                className={`flex h-8 max-w-40 shrink-0 items-center rounded-md text-xs font-semibold transition-colors ${
                  activa && vistaTicket === "VENTA_ACTUAL"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={
                    activa && vistaTicket === "VENTA_ACTUAL"
                  }
                  onClick={() => cambiarVentaActiva(venta.id)}
                  className="min-w-0 flex-1 truncate py-2 pl-2 text-left cursor-pointer"
                  title={`Venta ${venta.numero}`}
                >
                  {resumenPestana(venta)}
                </button>
                {activa && (
                  <button
                    type="button"
                    onClick={solicitarCerrarVentaActiva}
                    className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Cerrar venta ${venta.numero}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {esCajaCentral && vistaTicket === "POR_COBRAR" ? (
        <PedidosPorCobrar
          pedidos={colaPedidos.pedidos}
          isLoading={colaPedidos.isLoading}
          isError={colaPedidos.isError}
          pedidosAbiertosIds={pedidosAbiertosIds}
          onCargar={cargarPedido}
          onVerAbierto={(pedidoId) => {
            if (pedidoActivo?.id === pedidoId) {
              setVistaTicket("VENTA_ACTUAL");
              return;
            }
            const venta = ventasAbiertas.find(
              (actual) => actual.pedidoActivo?.id === pedidoId,
            );
            if (venta) cambiarVentaActiva(venta.id);
          }}
        />
      ) : (
        <>
      {pedidoActivo && (
        <div className="shrink-0 flex items-center justify-between gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2 text-xs">
          <span>
            Cobrando el <span className="font-bold">pedido #{pedidoActivo.numero}</span>
            {pedidoActivo.vendedor ? ` de ${pedidoActivo.vendedor}` : ""}
          </span>
          <button
            type="button"
            onClick={soltarPedidoActivo}
            className="font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Soltar
          </button>
        </div>
      )}

      {effectiveCheckoutStep === "CART" ? (
        <CartStepItems
          items={items}
          onUpdateQuantity={updateQuantity}
          onRemoveItem={removeItem}
          onCambiarForma={cambiarForma}
          totalCarrito={totalCarrito}
          onContinueToPayment={handleContinueToPayment}
          variantesSerializadas={variantesSerializadas}
          imeiPorVariante={imeiPorVariante}
          onElegirUnidad={() => setModalUnidades("SOLO_ELEGIR")}
          // Mismo criterio que la grilla: en kiosco y almacén el ticket va sin
          // miniaturas para que entren más renglones en pantalla.
          mostrarImagenes={!rubro || !posSinImagenes(rubro)}
          encabezado={
            <SelectorListaPrecio
              listas={listas}
              listaPrecioId={listaActiva?.id ?? null}
              onCambiar={cambiarListaDesdeElChip}
              deshabilitado={isPending}
            />
          }
          pieDeLineas={<VentaLibreInline />}
        />
      ) : (
        <CartStepCheckout
          isPOSMode={isPOSMode}
          metodosPagoDB={metodosPagoDB}
          pagos={pagos}
          onPagosChange={setPagos}
          totalFinal={totalFinal}
          isCuentaCorriente={isCuentaCorriente}
          onCuentaCorrienteChange={handleCuentaCorrienteChange}
          isReserva={usaReservas && isReserva}
          // Sin `onReservaChange` el paso de pago no dibuja el botón
          // "Reservado" y la fila queda en dos columnas. Es el mismo mecanismo
          // que ya usaba el carrito público, donde reservar tampoco existe.
          onReservaChange={usaReservas ? handleReservaChange : undefined}
          modoMixto={modoMixto}
          onModoMixtoChange={setModoMixto}
          anticipoMinimo={anticipoMinimo}
          clienteSeleccionado={clienteSeleccionado}
          onClienteChange={setClienteSeleccionado}
          selectorClienteAbierto={selectorClienteAbierto}
          onSelectorClienteAbiertoChange={setSelectorClienteAbierto}
          promocionesElegibles={promocionesElegibles}
          promocionActivaId={promocionActivaId}
          onPromocionChange={setPromocionId}
        >
          {items.length > 0 ? (
            <CartSidebarFooter
              isPOSMode={isPOSMode}
              isPending={isPending}
              totalCarrito={totalCarrito}
              recargoCuentaCorriente={recargoCuentaCorriente}
              recargoCuentaCorrientePotencial={recargoCuentaCorrientePotencial}
              ccSinRecargo={ccSinRecargo}
              onCcSinRecargoChange={setCcSinRecargo}
              recargoMetodoMonto={recargoMetodo.totalRecargo}
              recargoMetodoEtiqueta={recargoMetodoEtiqueta}
              totalFinal={totalFinal}
              totalACobrar={totalACobrar}
              sumaPagos={sumaPagos}
              isCuentaCorriente={isCuentaCorriente}
              isReserva={usaReservas && isReserva}
              onConfirmarReserva={
                usaReservas ? handleConfirmarReserva : undefined
              }
              anticipoMinimo={anticipoMinimo}
              clienteSeleccionado={clienteSeleccionado}
              descuentoDetalle={descuentoDetalle}
              whatsappHref={generarLinkWhatsApp({
                numeroWhatsApp,
                nombreComercio: branding?.posName,
                items,
                total: totalCarrito,
              })}
              metodosPagoDB={metodosPagoDB}
              pagos={pagosSincronizados}
              modoMixto={modoMixto}
              onConfirmarVentaPOS={handleConfirmarVentaPOS}
              onEnviarPedidoWhatsApp={handleEnviarPedidoWhatsApp}
              onClearCart={clearCartAndResetStep}
              onEnviarACaja={
                pedidosACaja && !puedeCobrar ? handleEnviarACaja : undefined
              }
              puedeCobrar={puedeCobrar}
            />
          ) : null}
        </CartStepCheckout>
      )}
        </>
      )}
    </>
  );

  /**
   * Lo que va adentro del panel del ticket, sea cual sea el envase (columna
   * fija, sheet o drawer): el carrito, o la confirmación de la venta que
   * recién se cobró. "Nueva venta" vuelve al carrito, que ya está vacío.
   */
  const PanelContent = ventaExitosa ? (
    <VentaExitosa
      ticket={ventaExitosa}
      config={branding}
      onNuevaVenta={() => {
        setVentaExitosa(null);
        if (esCajaCentral) setVistaTicket("POR_COBRAR");
        closeSidebar();
      }}
    />
  ) : (
    CartContent
  );

  return (
    <>
      {/* El panel fijo de escritorio. `hidden lg:flex` lo ESCONDE pero no lo
          desmonta, así que abajo de 1024px el ticket quedaba montado DOS
          veces: acá y adentro del sheet/drawer. Dos árboles iguales atados al
          mismo estado, y por lo tanto dos Popover controlados por el mismo
          `open`: al tocar el selector de cliente, la capa de descarte del que
          está oculto leía el toque como "afuera" y lo cerraba en el mismo
          tick. Desde el celular el desplegable no se abría NUNCA; en
          escritorio ancho —donde esta es la única instancia— funcionaba.

          Medido en producción antes de arreglarlo: dos
          `[data-slot="popover-trigger"]` en la página, el click llegaba al
          botón sin `defaultPrevented` y `aria-expanded` seguía en `false`.

          Renderizar UNA sola instancia además saca del DOM un ticket entero
          duplicado: los mismos `name` de formulario y los mismos ids, dos
          veces. */}
      <div className="hidden lg:flex flex-col w-100 shrink-0 border-l border-border bg-background h-full z-20">
        {!isMobileLayout && PanelContent}
      </div>

      {/* Tablet (640-1023px): sin cambios — sheet lateral derecho, se sigue
          abriendo solo por `isOpen` del store (auto-apertura al agregar). */}
      <Sheet
        open={isMobileLayout && !isPhoneLayout && (isOpen || ventaExitosa !== null)}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) setVentaExitosa(null);
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="lg:hidden w-full sm:max-w-sm gap-0 p-0"
        >
          {PanelContent}
        </SheetContent>
      </Sheet>

      {/* En tablet/celular el Ticket no está fijo. Este botón abre ESE MISMO
          panel en la pestaña Por cobrar; ya no existe un sheet paralelo con
          otra instancia de la cola. Se mantiene aun con cero pedidos para que
          la cajera siempre pueda entrar a su pantalla principal. */}
      {isMobileLayout &&
        esCajaCentral &&
        (isPhoneLayout ? !phoneCartOpen : !isOpen) && (
        <button
          type="button"
          onClick={() => {
            setVistaTicket("POR_COBRAR");
            if (isPhoneLayout) setPhoneCartOpen(true);
            else setIsOpen(true);
          }}
          className={`fixed right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold shadow-lg transition-colors cursor-pointer ${
            colaPedidos.pedidos.length > 0
              ? "bg-primary text-white hover:bg-primary/90"
              : "bg-sidebar text-muted-foreground hover:text-foreground"
          } bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6`}
          aria-label={`Abrir Ticket: ${colaPedidos.pedidos.length} pedidos por cobrar`}
        >
          <ClipboardList className="h-5 w-5" />
          Por cobrar
          {colaPedidos.pedidos.length > 0 && (
            <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-bold text-primary">
              {colaPedidos.pedidos.length}
            </span>
          )}
        </button>
      )}

      {/* Celular (<640px): barra fija inferior con total + contador —
          agregar un producto solo actualiza esta barra, nunca abre el
          Drawer. Solo se muestra con el carrito no vacío. */}
      {isPhoneLayout && items.length > 0 && !phoneCartOpen && (
        <MobileCartBar
          totalItems={getTotalItems()}
          totalPrice={totalCarrito}
          onOpen={() => {
            setVistaTicket("VENTA_ACTUAL");
            setPhoneCartOpen(true);
          }}
        />
      )}

      <Drawer
        direction="bottom"
        // Solo la agarradera arrastra. Sin esto, vaul toma el toque sobre
        // CUALQUIER parte del ticket como el comienzo de un arrastre y se
        // come el click: el selector de cliente no abría nunca desde el
        // celular (medido: el click llegaba al botón, sin
        // `defaultPrevented`, y `aria-expanded` seguía en false).
        //
        // Un ticket es una pantalla llena de controles —métodos de pago,
        // montos, cliente, promociones—, así que el gesto de arrastrar
        // sobre el contenido no solo estorba: no hay forma de distinguirlo
        // de tocar un control. Cerrar sigue estando a mano: la agarradera,
        // tocar afuera y Esc.
        handleOnly
        open={isPhoneLayout && (phoneCartOpen || ventaExitosa !== null)}
        onOpenChange={(open) => {
          if (open) setPhoneCartOpen(true);
          else {
            setVentaExitosa(null);
            closeSidebar();
          }
        }}
      >
        <DrawerContent>{PanelContent}</DrawerContent>
      </Drawer>

      {/* Montado solo cuando está abierto: así arranca con estado limpio y
          la carga de unidades ocurre en el montaje, sin resets por efecto. */}
      {modalUnidades && (
        <SeleccionarUnidadesModal
          onCerrar={() => setModalUnidades(null)}
          lineas={lineasSerializadas}
          onConfirmar={(seleccion) => {
            const modo = modalUnidades;
            setUnidadesElegidasRaw(seleccion);
            setModalUnidades(null);
            // Abierto desde el carrito: se guarda el aparato y listo, nadie
            // pidió cobrar todavía.
            if (modo !== "CONFIRMAR") return;
            // La selección va por argumento: el estado de arriba todavía no
            // se aplicó en este closure.
            handleConfirmarVentaPOS(anticipoPendiente, seleccion);
          }}
        />
      )}

    </>
  );
}

function formatearMontoPestana(monto: number): string {
  if (monto >= 1_000_000) {
    return `$${(monto / 1_000_000).toLocaleString("es-AR", {
      maximumFractionDigits: 1,
    })}M`;
  }
  if (monto >= 1_000) {
    return `$${(monto / 1_000).toLocaleString("es-AR", {
      maximumFractionDigits: 1,
    })}k`;
  }
  return `$${Math.round(monto).toLocaleString("es-AR")}`;
}
