"use client";

import { useState, useMemo, useEffect } from "react";
import {
  TicketData,
  TicketItemData,
  Venta,
  VentaItem,
  getSupabaseRelation,
} from "@/entities/ventas/types";
import { ConfiguracionPOS } from "@/entities/config/types";
import { createClient } from "@/shared/config/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Badge } from "@/shared/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  MoreVertical,
  Receipt,
  RotateCcw,
  Undo2,
  Wallet,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { AnularVentaModal } from "./cancel-sale-modal";
import { FacturarVentaModal } from "./facturar-venta-modal";
import { CorregirPagoModal } from "./corregir-pago-modal";
import { DevolucionModal } from "./devolucion-modal";
import { Button } from "@/shared/ui/button";
import { TicketSheet } from "./ticket-sheet";
import { formatearFechaHora, formatearMoneda } from "@/shared/utils/formatters";
import { fiscalDesdeComprobante } from "../lib/comprobante-fiscal-desde-venta";
import { letraComprobante } from "@/shared/lib/comprobante-fiscal-ticket";
import { numeroTicketVenta } from "@/features/sales/lib/numero-ticket";
import { SaleTableHeader } from "./sale-table-header";
import {
  ESTADO_TODOS,
  METODO_TODOS,
  COMPROBANTE_TODOS,
  type EstadoVentaFiltro,
} from "./sale-table-filtros";

const ITEMS_POR_PAGINA = 10;

/** Lo devuelto de una venta, debajo del total. No se dibuja nada si no hubo
 * devolución: un renglón vacío en cada fila del historial es ruido permanente
 * a cambio de una alineación que nadie mira. */
/** "FC" al lado del número cuando la venta salió con factura. Una letra
 * chica y no el título entero: la columna es angosta y lo que importa es
 * distinguir de un vistazo qué tiene CAE y qué no. */
function BadgeComprobante({ venta }: Readonly<{ venta: Venta }>) {
  const fiscal = fiscalDesdeComprobante(venta.comprobantes);
  if (!fiscal) return null;
  return (
    <Badge
      variant={fiscal.ambiente === "HOMOLOGACION" ? "outline" : "secondary"}
      className="ml-1.5 px-1 py-0 text-[9px] font-bold tracking-wider align-middle"
      title={fiscal.ambiente === "HOMOLOGACION" ? "Factura de prueba (homologación)" : "Factura con CAE"}
    >
      F{letraComprobante(fiscal.tipo)}
    </Badge>
  );
}

function MontoDevuelto({ venta }: Readonly<{ venta: Venta }>) {
  const devuelto = Number(venta.monto_devuelto || 0);
  if (devuelto <= 0) return null;

  const neto = Number(venta.total) - devuelto;

  return (
    <div className="mt-0.5 text-xs text-warning">
      − {formatearMoneda(devuelto)} devuelto
      <span className="ml-1 text-muted-foreground">
        (neto {formatearMoneda(neto)})
      </span>
    </div>
  );
}

interface VentasTableProps {
  ventas: Venta[];
  userRole: string;
  puedeAnular: boolean;
  /** Permiso `ventas.corregir_pago`. Separado de `puedeAnular` a propósito:
   * corregir el medio de cobro de la venta propia en el turno abierto no
   * cancela nada, y es lo que hoy obliga a llamar a la dueña. */
  puedeCorregirPago?: boolean;
  /** Permiso `ventas.devolver`, separado de `ventas.anular`: devolver un
   * renglón con el ticket adelante es la operación del mostrador; anular la
   * venta entera es otra cosa. */
  puedeDevolver?: boolean;
  /** Permiso `ventas.elegir_comprobante`. Junto con el modo ARCA del
   * comercio, decide si el menú ofrece "Facturar esta venta". */
  puedeFacturar?: boolean;
}

export function VentasTable({
  ventas = [],
  userRole,
  puedeAnular,
  puedeCorregirPago = false,
  puedeDevolver = false,
  puedeFacturar = false,
}: Readonly<VentasTableProps>) {
  const [filtroNombre, setFiltroNombre] = useState("");
  const [filtroEstado, setFiltroEstado] =
    useState<EstadoVentaFiltro>(ESTADO_TODOS);
  const [filtroMetodo, setFiltroMetodo] = useState<string>(METODO_TODOS);
  const [filtroComprobante, setFiltroComprobante] =
    useState<string>(COMPROBANTE_TODOS);
  const [orden, setOrden] = useState("recientes");
  const [paginaActual, setPaginaActual] = useState(1);

  const [ticketAbierto, setTicketAbierto] = useState<TicketData | null>(null);
  const [branding, setBranding] = useState<ConfiguracionPOS | null>(null);

  /**
   * Qué acción está abierta y sobre qué venta.
   *
   * UN estado para toda la tabla, y los tres modales se montan UNA vez abajo,
   * fuera del `map`. Antes cada fila traía sus propios modales: con diez filas
   * por página eran hasta treinta diálogos montados para usar ninguno o uno.
   *
   * Además es lo que permite que los disparadores vivan en el menú de tres
   * puntos: un `DialogTrigger` adentro de un `DropdownMenu` se desmonta junto
   * con el menú al cerrarse, y el diálogo no llega a abrirse nunca.
   */
  const [accionAbierta, setAccionAbierta] = useState<{
    venta: Venta;
    accion: "devolver" | "corregir" | "anular" | "facturar";
  } | null>(null);

  const cerrarAccion = () => setAccionAbierta(null);

  const isAdmin = userRole === "ADMIN";

  useEffect(() => {
    const fetchConfig = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("configuracion_pos")
        .select("*")
        .single();

      if (data) {
        setBranding(data as ConfiguracionPOS);
      }
    };

    fetchConfig();
  }, []);

  const ordenOptions = [
    { value: "recientes", label: "Más recientes" },
    { value: "antiguos", label: "Más antiguos" },
    { value: "mayor_total", label: "Mayor ingreso" },
    ...(isAdmin
      ? [{ value: "mayor_ganancia", label: "Mayor ganancia neta" }]
      : []),
    { value: "menor_total", label: "Menor ingreso" },
    { value: "mayor_cantidad", label: "Más unidades vendidas" },
  ];

  const getClienteNombre = (venta: Venta) =>
    getSupabaseRelation(venta.clientes)?.nombre || "Consumidor final";

  const getEstadoPago = (venta: Venta) => {
    if (
      venta.estado_operacion === "ANULADA" ||
      venta.estado_pago === "ANULADA"
    ) {
      return {
        estaPagado: false,
        label: "Anulada",
        variant: "anulada",
      };
    }

    const montoPendiente = Number(venta.monto_pendiente || 0);
    const estaPagado =
      venta.estado_pago === "PAGADA" ||
      (!venta.estado_pago && montoPendiente <= 0) ||
      montoPendiente <= 0;

    return {
      estaPagado,
      label: estaPagado ? "Pagado" : "Fiado",
      variant: estaPagado ? "pagada" : "fiado",
    };
  };

  /**
   * El cobro de una venta corregible, o null.
   *
   * Corregir el método solo tiene sentido —y solo lo permite la RPC— cuando hay
   * UN cobro y la venta no quedó con deuda: con pago mixto «cambiar el método»
   * no dice de cuál de los dos se habla, y con deuda el cambio toca el saldo
   * del cliente. Los dos casos se rechazan igual en el server; acá se usan para
   * no ofrecer un botón que va a fallar.
   *
   * El chequeo que NO se puede hacer acá es el del turno abierto, que es el más
   * frecuente. Ese lo contesta la RPC y el modal lo muestra como error.
   */
  const cobroCorregible = (venta: Venta) => {
    if (venta.estado_operacion === "ANULADA") return null;
    if (Number(venta.monto_pendiente || 0) > 0) return null;

    const cobros = (venta.venta_pagos || []).filter(
      (pago) => (pago.tipo_movimiento ?? "PAGO_VENTA") === "PAGO_VENTA",
    );

    return cobros.length === 1 ? cobros[0] : null;
  };

  /**
   * Si esta venta admite devolución parcial, con las MISMAS condiciones que la
   * RPC. No es duplicación por comodidad: la RPC igual rechaza lo que no
   * corresponde, pero ofrecer un botón que siempre falla enseña a ignorar
   * botones. Lo único que no se puede saber acá es lo que cambió desde que se
   * cargó la grilla, y para eso está el guard del server.
   */
  const esDevolvible = (venta: Venta) => {
    if (venta.estado_operacion === "ANULADA") return false;
    if (Number(venta.monto_devuelto || 0) >= Number(venta.total)) return false;

    // Cuenta corriente: la devolución baja la deuda, así que no importa con
    // qué se cobró el anticipo ni cuántos cobros haya. Solo hace falta que
    // exista el cliente al que acreditarle.
    if (Number(venta.monto_pendiente || 0) > 0) return !!venta.cliente_id;

    // Contado: un solo cobro, y de un medio que se pueda devolver.
    const cobro = cobroCorregible(venta);
    if (!cobro) return false;
    return ["EFECTIVO", "TRANSFERENCIA"].includes(cobro.metodo_tipo);
  };

  /**
   * El menú de la fila.
   *
   * Es una FUNCIÓN que devuelve JSX, no un componente definido acá adentro: un
   * componente declarado dentro del render es un tipo nuevo en cada pasada, así
   * que React lo desmonta y lo vuelve a montar — y el menú se cerraría solo
   * apenas cambie cualquier estado de la tabla.
   *
   * Si la venta no admite ninguna acción, no se dibuja: un menú de tres puntos
   * que se abre vacío es peor que no tenerlo.
   */
  const menuAcciones = (venta: Venta) => {
    const isAnulada =
      venta.estado_operacion === "ANULADA" || venta.estado_pago === "ANULADA";
    const puedeDevolverEsta = puedeDevolver && esDevolvible(venta);
    const puedeCorregirEsta = puedeCorregirPago && !!cobroCorregible(venta);
    const puedeAnularEsta = puedeAnular && !isAnulada;
    // La NC existe solo en una venta facturada y anulada. Imprimirla no
    // necesita permiso: es el papel que el cliente se lleva con la plata.
    const tieneNotaCredito =
      fiscalDesdeComprobante(venta.comprobantes, "NOTA_CREDITO") !== null;
    // Facturar después: venta viva, sin factura, comercio en modo ARCA y
    // permiso. Que ARCA esté conectado lo verifica la action.
    const puedeFacturarEsta =
      puedeFacturar &&
      !isAnulada &&
      branding?.modo_facturacion === "ARCA" &&
      fiscalDesdeComprobante(venta.comprobantes) === null;

    if (
      !puedeDevolverEsta &&
      !puedeCorregirEsta &&
      !puedeAnularEsta &&
      !tieneNotaCredito &&
      !puedeFacturarEsta
    ) {
      return null;
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 cursor-pointer rounded-md text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
            title="Más acciones"
            aria-label="Más acciones"
          >
            <MoreVertical className="h-4.5 w-4.5" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="rounded-xl">
          {puedeFacturarEsta && (
            <DropdownMenuItem
              onSelect={() => setAccionAbierta({ venta, accion: "facturar" })}
            >
              <Receipt className="mr-2 h-4 w-4 text-muted-foreground" />
              Facturar esta venta
            </DropdownMenuItem>
          )}
          {tieneNotaCredito && (
            <DropdownMenuItem onSelect={() => abrirTicket(venta, "NOTA_CREDITO")}>
              <Receipt className="mr-2 h-4 w-4 text-muted-foreground" />
              Ver nota de crédito
            </DropdownMenuItem>
          )}
          {puedeDevolverEsta && (
            <DropdownMenuItem
              onSelect={() => setAccionAbierta({ venta, accion: "devolver" })}
            >
              <Undo2 className="mr-2 h-4 w-4 text-muted-foreground" />
              Devolver parte
            </DropdownMenuItem>
          )}
          {puedeCorregirEsta && (
            <DropdownMenuItem
              onSelect={() => setAccionAbierta({ venta, accion: "corregir" })}
            >
              <Wallet className="mr-2 h-4 w-4 text-muted-foreground" />
              Corregir el cobro
            </DropdownMenuItem>
          )}
          {puedeAnularEsta && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setAccionAbierta({ venta, accion: "anular" })}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Anular la venta
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const getPagoLabel = (venta: Venta) => {
    const pagos = venta.venta_pagos || [];
    if (venta.es_pago_mixto || pagos.length > 1) return "Mixto";
    return pagos[0]?.metodo_nombre || venta.metodo_pago || "EFECTIVO";
  };

  /**
   * Los métodos de pago que REALMENTE aparecen en el historial cargado, no la
   * lista de `metodos_pago`.
   *
   * Es lo que hace que el filtro no ofrezca nunca una opción vacía: un método
   * configurado la semana pasada y todavía sin usar daría cero resultados, y un
   * método ya desactivado —pero presente en ventas viejas— no se podría filtrar
   * si la lista saliera de la configuración de hoy. Las etiquetas son las
   * mismas que muestra la columna, `getPagoLabel`, "Mixto" incluido.
   */
  const metodosPresentes = useMemo(() => {
    const vistos = new Set<string>();
    for (const venta of ventas) vistos.add(getPagoLabel(venta));
    return [...vistos].sort((a, b) => a.localeCompare(b, "es"));
  }, [ventas]);

  const ventasFiltradasYOrdenadas = useMemo(() => {
    const resultado = ventas.filter((venta) => {
      const items = venta.ventas_items || [];
      if (items.length === 0) return false;

      // Se busca por TICKET y por CLIENTE, ya no por producto. El producto
      // estaba de más: los nombres del catálogo se repiten en cientos de
      // ventas, así que buscar "remera" devolvía media pantalla y no ayudaba a
      // encontrar UNA venta. Lo que se busca en un historial es un ticket que
      // alguien tiene en la mano o las compras de una clienta que está
      // enfrente.
      //
      // El `#` se ignora para que se pueda pegar el número tal como está
      // impreso, y el match es por `includes`: tipear "417" encuentra
      // "00001-00000417" sin obligar a escribir los ceros.
      const busqueda = filtroNombre.toLowerCase().replace(/#/g, "").trim();
      const coincideBusqueda =
        busqueda === "" ||
        numeroTicketVenta(venta).toLowerCase().includes(busqueda) ||
        getClienteNombre(venta).toLowerCase().includes(busqueda);

      if (!coincideBusqueda) return false;

      if (filtroEstado !== ESTADO_TODOS) {
        if (getEstadoPago(venta).variant !== filtroEstado) return false;
      }

      if (filtroMetodo !== METODO_TODOS) {
        if (getPagoLabel(venta) !== filtroMetodo) return false;
      }

      if (filtroComprobante !== COMPROBANTE_TODOS) {
        const facturada = fiscalDesdeComprobante(venta.comprobantes) !== null;
        if (filtroComprobante === "facturadas" && !facturada) return false;
        if (filtroComprobante === "sin_facturar" && facturada) return false;
      }

      return true;
    });

    resultado.sort((a, b) => {
      const gananciaA = a.total - (a.precio_costo || 0);
      const gananciaB = b.total - (b.precio_costo || 0);

      const cantA = (a.ventas_items || []).reduce(
        (acc: number, item: VentaItem) => acc + item.cantidad,
        0,
      );
      const cantB = (b.ventas_items || []).reduce(
        (acc: number, item: VentaItem) => acc + item.cantidad,
        0,
      );

      switch (orden) {
        case "recientes":
          return (
            new Date(b.fecha_venta).getTime() -
            new Date(a.fecha_venta).getTime()
          );
        case "antiguos":
          return (
            new Date(a.fecha_venta).getTime() -
            new Date(b.fecha_venta).getTime()
          );
        case "mayor_total":
          return b.total - a.total;
        case "mayor_ganancia":
          return gananciaB - gananciaA;
        case "menor_total":
          return a.total - b.total;
        case "mayor_cantidad":
          return cantB - cantA;
        default:
          return 0;
      }
    });

    return resultado;
  }, [ventas, filtroNombre, filtroEstado, filtroMetodo, filtroComprobante, orden]);

  // El filtro de comprobante se ofrece solo si hay algo que filtrar.
  const hayFacturas = useMemo(
    () => ventas.some((v) => fiscalDesdeComprobante(v.comprobantes) !== null),
    [ventas],
  );

  const totalPaginas = Math.ceil(
    ventasFiltradasYOrdenadas.length / ITEMS_POR_PAGINA,
  );

  const ventasPagina = useMemo(
    () =>
      ventasFiltradasYOrdenadas.slice(
        (paginaActual - 1) * ITEMS_POR_PAGINA,
        paginaActual * ITEMS_POR_PAGINA,
      ),
    [ventasFiltradasYOrdenadas, paginaActual],
  );

  const handleSearchChange = (value: string) => {
    setFiltroNombre(value);
    setPaginaActual(1);
  };

  const handleOrderChange = (value: string) => {
    setOrden(value);
    setPaginaActual(1);
  };

  // Volver a la página 1 con cada filtro no es un detalle: filtrando desde la
  // página 4 el resultado puede tener 2 páginas, y la tabla se quedaría
  // mostrando una página vacía sobre un filtro que sí tiene resultados.
  const handleEstadoChange = (value: string) => {
    setFiltroEstado(value as EstadoVentaFiltro);
    setPaginaActual(1);
  };

  const handleMetodoChange = (value: string) => {
    setFiltroMetodo(value);
    setPaginaActual(1);
  };

  /**
   * Abre el ticket de la venta. Con `clase = "NOTA_CREDITO"` abre el mismo
   * papel pero como NC: mismos renglones y total, encabezado, número, CAE y
   * QR de la nota. Es el comprobante que el cliente se lleva al devolver.
   */
  const abrirTicket = (
    venta: Venta,
    clase: "FACTURA" | "NOTA_CREDITO" = "FACTURA",
  ) => {
    // Obtenemos el descuento de la cabecera si existe
    const descuento =
      venta.ventas_descuentos && venta.ventas_descuentos.length > 0
        ? venta.ventas_descuentos[0]
        : null;

    const clienteNombre = getClienteNombre(venta);
    const pagosDesglosados = (venta.venta_pagos || []).map((pago) => ({
      nombre: pago.metodo_nombre,
      monto: Number(pago.monto_bruto || 0),
      tipo: pago.metodo_tipo,
      comisionMonto: Number(pago.comision_monto || 0),
      montoNeto: Number(pago.monto_neto || 0),
      acreditacionDias: Number(pago.acreditacion_dias || 0),
      tipoMovimiento: pago.tipo_movimiento,
    }));

    // Totales del ticket sobre TODOS los pagos, no sobre el primero. Con un
    // pago mixto —11 ventas reales hoy, la última del 25/8— tomar
    // `venta_pagos[0]` mostraba la comisión y el neto de una sola de las dos
    // mitades: un ticket de $20.000 pagado 10 y 10 declaraba $10.000 de neto.
    // La acreditación es la PEOR de las dos: lo que el comercio quiere saber es
    // cuándo termina de entrar todo, no cuándo entra la primera parte.
    const pagos = venta.venta_pagos || [];
    const comisionMontoTotal = pagos.reduce(
      (acc, pago) => acc + Number(pago.comision_monto || 0),
      0,
    );
    const montoNetoTotal = pagos.reduce(
      (acc, pago) => acc + Number(pago.monto_neto || 0),
      0,
    );
    const acreditacionDiasMax = pagos.reduce(
      (acc, pago) => Math.max(acc, Number(pago.acreditacion_dias || 0)),
      0,
    );

    const pagosConRecargo = pagos.filter(
      (pago) => Number(pago.recargo_monto || 0) > 0,
    );
    const recargoMetodoMonto = pagosConRecargo.reduce(
      (acc, pago) => acc + Number(pago.recargo_monto || 0),
      0,
    );
    const recargoMetodoEtiqueta =
      pagosConRecargo.length === 1
        ? `Recargo ${pagosConRecargo[0].metodo_nombre} (${pagosConRecargo[0].recargo_porcentaje}%)`
        : "Recargo por método de pago";

    setTicketAbierto({
      items: (venta.ventas_items || []).map(
        (item: VentaItem): TicketItemData => ({
          nombre:
            getSupabaseRelation(item.producto)?.nombre || "Producto eliminado",
          variante: item.variante,
          cantidad: item.cantidad,
          precioUnitario: item.precio_unitario,
          imei: getSupabaseRelation(item.unidad_serie)?.imei ?? null,
          unidadMedida:
            getSupabaseRelation(item.producto)?.unidad_medida ?? null,
        }),
      ),
      total: venta.total,
      metodoPago: getPagoLabel(venta),
      // Las ventas anteriores a los comprobantes no tienen ninguno, y las que
      // fallaron al emitir tampoco: ahí se reimprime el identificador de la
      // venta, igual que siempre. Se toma el comprobante de emisión (el
      // primero), no una nota de crédito posterior.
      nroRecibo: numeroTicketVenta(venta),
      // Si la venta salió con factura, el papel reimpreso es LA factura: con
      // CAE, QR y letra. Sale de la fila congelada, no de la config de hoy.
      fiscal: fiscalDesdeComprobante(venta.comprobantes, clase),
      fecha: formatearFechaHora(venta.fecha_venta),
      vendedor: getSupabaseRelation(venta.perfiles)?.nombre || "Administrador",
      descuentoMonto: descuento
        ? Number(descuento.monto_descontado)
        : undefined,
      promocionNombre: descuento ? descuento.promocion_nombre : undefined,
      // Reimpresión: el recargo sale de lo que quedó congelado en cada pago,
      // no del % que el método tenga HOY.
      recargoMetodoMonto: recargoMetodoMonto || undefined,
      recargoMetodoEtiqueta: recargoMetodoEtiqueta || undefined,
      // El nombre CONGELADO en la venta, no el de la lista tal como se llama
      // hoy: reimprimir un ticket tiene que dar el mismo papel que salió.
      listaPrecioNombre: venta.lista_precio_nombre ?? null,
      comisionMonto: comisionMontoTotal,
      montoNeto: pagos.length > 0 ? montoNetoTotal : venta.total,
      acreditacionDias: acreditacionDiasMax,
      pagosDesglosados,
      clienteNombre:
        clienteNombre === "Consumidor final" ? undefined : clienteNombre,
      estadoPago: venta.estado_pago ?? undefined,
      montoCobrado: Number(venta.monto_cobrado || 0),
      montoPendiente: Number(venta.monto_pendiente || 0),
    });
  };

  return (
    <div className="space-y-6 px-4 p-2">
      <TicketSheet
        ticket={ticketAbierto}
        config={branding || ({} as ConfiguracionPOS)}
        onClose={() => setTicketAbierto(null)}
        // Reimpresión desde el historial, no el cierre de la venta. La
        // distinción es toda la gracia de la telemetría: dice si el
        // comprobante se entrega en el mostrador o se busca después.
        origen="HISTORIAL"
      />

      {/* Los tres diálogos se montan UNA vez para toda la tabla, no uno por
          fila. Ver `accionAbierta`. */}
      {accionAbierta?.accion === "devolver" && (
        <DevolucionModal
          ventaId={accionAbierta.venta.id}
          numeroTicket={numeroTicketVenta(accionAbierta.venta)}
          open
          onOpenChange={(abierto) => !abierto && cerrarAccion()}
        />
      )}

      {accionAbierta?.accion === "corregir" &&
        (() => {
          const cobro = cobroCorregible(accionAbierta.venta);
          if (!cobro) return null;
          return (
            <CorregirPagoModal
              ventaId={accionAbierta.venta.id}
              metodoActualId={cobro.metodo_pago_id}
              metodoActualNombre={cobro.metodo_nombre}
              montoBase={Number(cobro.monto_base ?? cobro.monto_bruto)}
              totalActual={Number(accionAbierta.venta.total)}
              recargoActual={Number(
                accionAbierta.venta.recargo_metodo_total || 0,
              )}
              open
              onOpenChange={(abierto) => !abierto && cerrarAccion()}
            />
          );
        })()}

      {accionAbierta?.accion === "facturar" && (
        <FacturarVentaModal
          ventaId={accionAbierta.venta.id}
          total={Number(accionAbierta.venta.total)}
          clienteNombre={
            getClienteNombre(accionAbierta.venta) === "Consumidor final"
              ? null
              : getClienteNombre(accionAbierta.venta)
          }
          open
          onOpenChange={(abierto) => !abierto && cerrarAccion()}
          onFacturada={(fiscal) => {
            // El ticket se abre YA como factura, con el dato recién emitido:
            // la fila de la tabla se actualiza con el refresh, pero el papel
            // no tiene por qué esperarlo.
            const venta = accionAbierta.venta;
            abrirTicket({
              ...venta,
              comprobantes: [
                ...(venta.comprobantes ?? []),
                {
                  tipo: fiscal.tipo,
                  punto_venta: fiscal.puntoVenta,
                  numero: fiscal.numero,
                  cae: fiscal.cae,
                  cae_vencimiento: fiscal.caeVencimiento,
                  fecha_comprobante: fiscal.fechaComprobante,
                  neto: fiscal.neto,
                  iva_monto: fiscal.ivaMonto,
                  exento: fiscal.exento,
                  no_gravado: fiscal.noGravado,
                  total: fiscal.total,
                  receptor_razon_social: fiscal.receptor.razonSocial,
                  receptor_doc_tipo: fiscal.receptor.docTipo,
                  receptor_doc_nro: fiscal.receptor.docNro,
                  receptor_condicion_iva: fiscal.receptor.condicionIva,
                  arca_ambiente: fiscal.ambiente,
                  comprobantes_iva: [],
                },
              ],
            });
          }}
        />
      )}

      {accionAbierta?.accion === "anular" &&
        (() => {
          const items = accionAbierta.venta.ventas_items || [];
          const primerItem = items[0];
          const producto = getSupabaseRelation(primerItem?.producto);
          const varios = items.length > 1;

          return (
            <AnularVentaModal
              id={accionAbierta.venta.id}
              productoNombre={
                varios
                  ? "Ticket Completo"
                  : producto?.nombre || "Varios artículos"
              }
              cantidad={
                varios
                  ? accionAbierta.venta.cantidad
                  : (primerItem?.cantidad ?? 0)
              }
              variante={
                varios ? "Varios artículos" : (primerItem?.variante ?? "")
              }
              isProductoEliminado={!producto}
              open
              onOpenChange={(abierto) => !abierto && cerrarAccion()}
            />
          );
        })()}

      <SaleTableHeader
        searchValue={filtroNombre}
        onSearchChange={handleSearchChange}
        orderValue={orden}
        onOrderChange={handleOrderChange}
        orderOptions={ordenOptions}
        estadoValue={filtroEstado}
        onEstadoChange={handleEstadoChange}
        metodoValue={filtroMetodo}
        onMetodoChange={handleMetodoChange}
        metodosOptions={metodosPresentes}
        comprobanteValue={hayFacturas ? filtroComprobante : undefined}
        onComprobanteChange={
          hayFacturas
            ? (v) => {
                setFiltroComprobante(v);
                setPaginaActual(1);
              }
            : undefined
        }
      />

      {/* TABLA O EMPTY STATE */}
      {ventas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-card rounded-2xl border border-border">
          <Receipt className="h-16 w-16 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium text-lg">
            Aún no hay ventas registradas en el sistema.
          </p>
        </div>
      ) : (
        <>
          {/* VISTA DESKTOP (Tabla tradicional, oculta en móviles) */}
          <div className="hidden md:block rounded-lg border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="w-full min-w-150">
                <TableHeader>
                  <TableRow className="bg-muted/30 border-b border-border/60 hover:bg-muted/30">
                    <TableHead className="w-28 pl-4 sm:pl-6">Ticket</TableHead>
                    <TableHead className="w-42">Fecha</TableHead>
                    <TableHead>Detalle</TableHead>
                    <TableHead className="w-52">Cliente / Estado</TableHead>
                    <TableHead className="w-28">Pago</TableHead>
                    <TableHead className="text-right font-bold">
                      Total
                    </TableHead>
                    <TableHead className="text-right w-32 pr-4 sm:pr-6">
                      Acciones
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ventasPagina.length > 0 ? (
                    ventasPagina.map((venta) => {
                      const items = venta.ventas_items || [];
                      const primerItem = items[0];

                      if (!primerItem) return null;

                      const producto = getSupabaseRelation(primerItem.producto);
                      const isEliminado = !producto;
                      const nombrePrincipal = isEliminado
                        ? "Producto eliminado"
                        : producto.nombre;
                      const itemsExtra = items.length - 1;

                      const clienteNombre = getClienteNombre(venta);
                      const estadoPago = getEstadoPago(venta);
                      const metodoPago = getPagoLabel(venta);

                      return (
                        <TableRow
                          key={venta.id}
                          className="hover:bg-muted/20 cursor-pointer transition-colors border-b border-border/40"
                          onClick={() => abrirTicket(venta)}
                        >
                          {/* EL MISMO número que sale impreso en el recibo.
                              Ver `numero-ticket.ts`: antes acá iba el prefijo
                              del UUID y en el papel el número del
                              comprobante, así que con el ticket en la mano no
                              había forma de encontrar la fila. */}
                          <TableCell className="font-mono font-medium tracking-wider text-muted-foreground text-xs pl-4 sm:pl-6">
                            #{numeroTicketVenta(venta)}
                            <BadgeComprobante venta={venta} />
                          </TableCell>

                          <TableCell
                            className="text-sm text-muted-foreground"
                            suppressHydrationWarning
                          >
                            {formatearFechaHora(venta.fecha_venta)}
                          </TableCell>

                          <TableCell className="font-semibold text-foreground py-4">
                            <div className="flex items-center gap-3">
                              <span className="truncate max-w-50 sm:max-w-xs">
                                {nombrePrincipal}
                                {itemsExtra > 0 ? (
                                  <span className="text-muted-foreground font-normal ml-1">
                                    y {itemsExtra} artículo
                                    {itemsExtra > 1 ? "s" : ""} más
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground font-normal ml-1">
                                    · Talle {primerItem.variante} · x
                                    {primerItem.cantidad}
                                  </span>
                                )}
                              </span>
                            </div>
                            {/* IMEI a la vista en el listado: es el dato por
                                el que se busca una venta cuando alguien
                                vuelve con el aparato. */}
                            {getSupabaseRelation(primerItem.unidad_serie)
                              ?.imei && (
                              <p className="mt-1 font-mono text-[10px] font-normal text-muted-foreground">
                                IMEI{" "}
                                {
                                  getSupabaseRelation(primerItem.unidad_serie)
                                    ?.imei
                                }
                              </p>
                            )}
                          </TableCell>

                          <TableCell>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {clienteNombre}
                              </p>
                              <span
                                className={`mt-1 text-xs uppercase font-semibold ${
                                  estadoPago.variant === "anulada"
                                    ? "text-danger"
                                    : estadoPago.estaPagado
                                      ? "text-success"
                                      : "text-warning"
                                }`}
                              >
                                {estadoPago.label}
                              </span>
                            </div>
                          </TableCell>

                          <TableCell>
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground">
                              {metodoPago}
                            </p>
                            {/* Con qué lista se cobró. Solo aparece cuando NO
                                fue el precio base: es la respuesta a "¿por qué
                                esta venta salió más barata?", que es la
                                pregunta que trae a alguien a esta tabla. El
                                nombre es el CONGELADO en la venta. */}
                            {venta.lista_precio_nombre && (
                              <p className="mt-1 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-400">
                                {venta.lista_precio_nombre}
                              </p>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="font-mono font-medium text-foreground">
                              {formatearMoneda(venta.total)}
                            </div>
                            {/* Una venta con devolución no puede verse igual
                                que una sin ella: la venta queda CONFIRMADA a
                                propósito (ver 20260903160000) y sin este
                                renglón el historial diría que entró el total.
                                El neto va abajo y no reemplaza al total, que
                                es lo que se vendió. */}
                            <MontoDevuelto venta={venta} />
                          </TableCell>

                          <TableCell
                            className="text-right pr-4 sm:pr-6"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground font-medium h-9 w-9 p-0 hover:bg-muted hover:text-foreground rounded-md transition-colors shadow-none"
                                onClick={() => abrirTicket(venta)}
                                title="Ver recibo detallado"
                              >
                                <Eye className="w-4.5 h-4.5" />
                              </Button>

                              {menuAcciones(venta)}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-32 text-center text-muted-foreground bg-card"
                      >
                        No se encontraron tickets que coincidan con la búsqueda.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* VISTA MOBILE (Tarjetas apiladas, ocultas en desktop) */}
          <div className="md:hidden flex flex-col gap-3">
            {ventasPagina.length > 0 ? (
              ventasPagina.map((venta) => {
                const items = venta.ventas_items || [];
                const primerItem = items[0];

                if (!primerItem) return null;

                const producto = getSupabaseRelation(primerItem.producto);
                const isEliminado = !producto;
                const nombrePrincipal = isEliminado
                  ? "Producto eliminado"
                  : producto.nombre;
                const itemsExtra = items.length - 1;

                const clienteNombre = getClienteNombre(venta);
                const estadoPago = getEstadoPago(venta);
                const metodoPago = getPagoLabel(venta);

                return (
                  <div
                    key={venta.id}
                    onClick={() => abrirTicket(venta)}
                    className="bg-card border border-border rounded-xl p-4 active:scale-[0.98] transition-transform cursor-pointer"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex flex-col pr-3">
                        <span className="font-bold text-foreground text-sm mt-1 leading-tight line-clamp-2">
                          {nombrePrincipal}
                        </span>
                        {itemsExtra > 0 ? (
                          <span className="text-muted-foreground text-xs mt-0.5">
                            y {itemsExtra} artículo{itemsExtra > 1 ? "s" : ""}{" "}
                            más
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs mt-0.5">
                            Talle {primerItem.variante} · x{primerItem.cantidad}
                          </span>
                        )}
                        {getSupabaseRelation(primerItem.unidad_serie)?.imei && (
                          <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            IMEI{" "}
                            {getSupabaseRelation(primerItem.unidad_serie)?.imei}
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold text-foreground text-lg">
                          {formatearMoneda(venta.total)}
                        </div>
                        <MontoDevuelto venta={venta} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 mb-3">
                      <p
                        className={`inline-flex items-center text-[11px] font-semibold text-muted-foreground`}
                      >
                        {metodoPago}
                      </p>
                      <Badge
                        variant="outline"
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-tight ${
                          estadoPago.variant === "anulada"
                            ? "border-destructive/20 bg-destructive/10 text-destructive"
                            : estadoPago.estaPagado
                              ? "border-success/20 bg-success/10 text-success"
                              : "border-warning/20 bg-warning/10 text-warning"
                        }`}
                      >
                        {estadoPago.label}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between gap-3 mb-3">
                      <span className="text-xs text-muted-foreground font-medium truncate">
                        {clienteNombre}
                      </span>
                      <span
                        className="text-xs text-muted-foreground font-medium shrink-0"
                        suppressHydrationWarning
                      >
                        {formatearFechaHora(venta.fecha_venta)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-border/50">
                      <span className="text-xs font-medium text-muted-foreground truncate pr-2">
                        Ticket #{numeroTicketVenta(venta)}
                        <BadgeComprobante venta={venta} />
                      </span>
                      <div
                        className="flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-lg shadow-none hover:bg-muted"
                          onClick={() => abrirTicket(venta)}
                          title="Ver recibo detallado"
                        >
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        {menuAcciones(venta)}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-12 text-center text-muted-foreground bg-card rounded-xl border border-border">
                No se encontraron tickets que coincidan con la búsqueda.
              </div>
            )}
          </div>

          {/* Paginación */}
          {totalPaginas > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-4 border-t border-border mt-4">
              <span className="text-xs font-medium text-muted-foreground">
                Mostrando{" "}
                {Math.min(
                  ventasFiltradasYOrdenadas.length,
                  (paginaActual - 1) * ITEMS_POR_PAGINA + 1,
                )}{" "}
                a{" "}
                {Math.min(
                  ventasFiltradasYOrdenadas.length,
                  paginaActual * ITEMS_POR_PAGINA,
                )}{" "}
                de {ventasFiltradasYOrdenadas.length} tickets
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shadow-none"
                  onClick={() => setPaginaActual((p) => Math.max(1, p - 1))}
                  disabled={paginaActual === 1}
                >
                  <ChevronLeft className="w-4 h-4 sm:mr-1" />{" "}
                  <span className="hidden sm:inline">Anterior</span>
                </Button>
                <div className="text-xs font-bold px-3">
                  {paginaActual} / {totalPaginas}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shadow-none"
                  onClick={() =>
                    setPaginaActual((p) => Math.min(totalPaginas, p + 1))
                  }
                  disabled={paginaActual === totalPaginas}
                >
                  <span className="hidden sm:inline">Siguiente</span>{" "}
                  <ChevronRight className="w-4 h-4 sm:ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
