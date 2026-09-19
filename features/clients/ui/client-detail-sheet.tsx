"use client";

import { useMemo, useState, useTransition } from "react";
import { nombreRenglon } from "@/features/sales/lib/nombre-renglon";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Button } from "@/shared/ui/button";
import { ClienteEstadoBadge } from "@/shared/components/cliente-estado-badge";
import {
  Wallet,
  History,
  Info,
  Loader2,
  Phone,
  TrendingUp,
  Tags,
  Star,
  Edit2,
  PlusCircle,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { toast } from "sonner";
import {
  getClienteDetalleAction,
  obtenerLinkResumenAction,
} from "../actions/manage-clients";
import { queryKeys } from "@/shared/lib/query-keys";
import { calcularDiasVencido } from "../lib/calcular-dias-vencido";
import { clasificarEstadoCliente } from "../lib/clasificar-estado-cliente";
import { AdjustClientBalanceModal } from "./adjust-client-balance-modal";
import { EditClientModal } from "./edit-client-modal";
import { RegisterPaymentModal } from "./register-payment-modal";
import { MovimientoCCCard } from "./movimiento-cc-card";
import { Cliente, CuentaCorrienteMovimiento } from "@/entities/clientes/type";
import { MetodoPagoPOS } from "@/shared/components/cart-sidebar/types";
import { formatearFechaHora, formatearMoneda } from "@/shared/utils/formatters";
import { getSupabaseRelation, SupabaseRelation } from "@/entities/ventas/types";
import {
  calcularSaldoConRecargo,
  RecargoMoraConfig,
} from "../lib/calcular-saldo-con-recargo";
import { PerdonarDeudaModal } from "./perdonar-deuda-modal";
import { construirMensajeDeuda } from "../lib/mensaje-deuda";
import {
  linkWhatsapp,
  telefonoAWhatsapp,
} from "@/shared/lib/telefono-whatsapp";

interface VentaResumen {
  id: string;
  total: number | string;
  estado_pago?: string | null;
  fecha_venta: string;
  ventas_items?: {
    cantidad: number | string;
    variante?: string | null;
    es_venta_libre?: boolean | null;
    producto?: SupabaseRelation<{
      nombre?: string | null;
      tipo?: string | null;
    }>;
  }[];
}

interface ClientDetailSheetProps {
  cliente: Cliente | null;
  metodosPago: MetodoPagoPOS[];
  entregaMinimaActiva?: boolean;
  recargoMoraConfig: RecargoMoraConfig;
  /** Porción vencida por FIFO, base del recargo. Ver `deuda_cc_vencida`. */
  montoVencido: number;
  /** Recargos anteriores impagos. Se restan de la base del recargo nuevo. */
  moraPrevia: number;
  isAdmin?: boolean;
  puedeCorregirCobro?: boolean;
  onClose: () => void;
}

export function ClientDetailSheet({
  cliente,
  metodosPago,
  entregaMinimaActiva = false,
  recargoMoraConfig,
  montoVencido,
  moraPrevia,
  isAdmin = false,
  puedeCorregirCobro = false,
  onClose,
}: Readonly<ClientDetailSheetProps>) {
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPerdonOpen, setIsPerdonOpen] = useState(false);
  const [enviandoRecordatorio, startRecordatorio] = useTransition();

  const { data: queryData, isLoading } = useQuery({
    queryKey: queryKeys.clientes.detalle(cliente?.id ?? ""),
    queryFn: () => getClienteDetalleAction(cliente!.id),
    enabled: !!cliente,
  });

  const data: {
    movimientos: CuentaCorrienteMovimiento[];
    ventas: VentaResumen[];
  } = queryData ?? { movimientos: [], ventas: [] };

  const stats = useMemo(() => {
    const totalComprado = data.ventas.reduce(
      (total, venta) => total + Number(venta.total || 0),
      0,
    );
    const totalTickets = data.ventas.length;
    const ticketPromedio = totalTickets > 0 ? totalComprado / totalTickets : 0;
    const categorias = new Map<string, number>();

    for (const venta of data.ventas) {
      for (const item of venta.ventas_items ?? []) {
        const producto = getSupabaseRelation(item.producto);
        const tipo = producto?.tipo?.trim();

        if (tipo) {
          categorias.set(tipo, (categorias.get(tipo) ?? 0) + 1);
        }
      }
    }

    const favCategory =
      [...categorias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";

    return {
      totalComprado,
      totalTickets,
      ticketPromedio,
      favCategory,
    };
  }, [data.ventas]);

  if (!cliente) return null;
  const saldo = Number(cliente.saldo_pendiente || 0);

  // Mismo cálculo que hace el server al cobrar (registrarPagoDeudaAction):
  // misma función, mismas dos entradas. Mostrar acá un número que el cobro
  // después no respete es peor que no mostrarlo.
  const { montoRecargo, saldoConRecargo } = calcularSaldoConRecargo(
    {
      monto_pendiente: cliente.saldo_pendiente,
      fecha_vencimiento: cliente.fecha_vencimiento_deuda,
      monto_vencido: montoVencido,
      mora_previa: moraPrevia,
    },
    recargoMoraConfig,
  );

  const fechaVencimiento = cliente.fecha_vencimiento_deuda ?? null;
  const diasVencido = calcularDiasVencido(fechaVencimiento);
  const estado = clasificarEstadoCliente(saldo, diasVencido);
  const mostrarAlertaVencimiento =
    diasVencido !== null && diasVencido > 0 && saldo > 0;
  const fechaVencimientoFormateada = fechaVencimiento
    ? new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(fechaVencimiento))
    : null;
  // Línea fusionada de vencimiento: "Venció el [fecha] · hace N días" si ya
  // pasó, "Vence el [fecha]" si todavía no — mismo dato que antes mostraban
  // "Vence: fecha" y "Hace N días" por separado, compitiendo por el mismo
  // renglón angosto en mobile.
  const lineaVencimiento = fechaVencimientoFormateada
    ? mostrarAlertaVencimiento
      ? `Venció el ${fechaVencimientoFormateada} · hace ${diasVencido} día${diasVencido === 1 ? "" : "s"}`
      : `Vence el ${fechaVencimientoFormateada}`
    : null;
  // El mensaje se arma con el LIBRO de cuenta corriente y con el mismo total
  // que va a cobrar el sistema (saldo + recargo de mora). Ver
  // construirMensajeDeuda.
  const tieneWhatsappDirecto = telefonoAWhatsapp(cliente.telefono) !== null;
  const enviarRecordatorio = () => {
    startRecordatorio(async () => {
      // El link se pide ANTES de abrir WhatsApp: si el token no existe todavía
      // se genera acá. Si falla, el mensaje sale igual pero sin detalle — un
      // recordatorio sin link es peor que ninguno, pero mucho mejor que un
      // botón que no hace nada.
      const { url, error } = await obtenerLinkResumenAction(cliente.id);
      if (error) toast.error("No se pudo generar el link del resumen.");

      const mensaje = construirMensajeDeuda({
        nombreCliente: cliente.nombre,
        saldo,
        montoRecargo,
        saldoConRecargo,
        fechaVencimiento,
        diasVencido,
        urlResumen: url,
      });
      window.open(linkWhatsapp(cliente.telefono, mensaje), "_blank");
    });
  };

  const favCategoryLabel =
    stats.favCategory === "-"
      ? "-"
      : `${stats.favCategory.charAt(0).toUpperCase()}${stats.favCategory.slice(1)}`;

  return (
    <Sheet open={cliente !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:w-4xl! p-0 flex flex-col h-dvh bg-card border-l border-border"
      >
        {/* CABECERA (Fija) */}
        <SheetHeader className="p-6 border-b border-border shrink-0 bg-muted/10">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div>
                <SheetTitle className="text-xl font-bold text-foreground">
                  {cliente.nombre}
                </SheetTitle>
                <div className="flex items-center gap-2 mt-1">
                  <ClienteEstadoBadge estado={estado} labelClassName="inline" />
                  {cliente.telefono && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {cliente.telefono}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAdjustOpen(true)}
              className="h-8 text-xs font-medium shadow-none border-border"
            >
              <PlusCircle className="w-3.5 h-3.5 mr-1.5 text-warning" />
              Cargar saldo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditOpen(true)}
              className="h-8 text-xs font-medium border-border"
            >
              <Edit2 className="w-3.5 h-3.5 mr-1.5 text-primary" />
              Editar
            </Button>
            {/* Solo con deuda: un recordatorio de cobranza a alguien que no
                debe nada es una molestia, no una gestión. */}
            {saldo > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={enviarRecordatorio}
                disabled={enviandoRecordatorio}
                title={
                  tieneWhatsappDirecto
                    ? `Abre el chat de ${cliente.telefono}`
                    : "Sin un celular reconocible: abre WhatsApp con el mensaje listo para que elijas el contacto"
                }
                className="h-8 text-xs font-medium border-border"
              >
                <FaWhatsapp className="w-3.5 h-3.5 mr-1.5 text-success" />
                Recordar
              </Button>
            )}
          </div>
        </SheetHeader>

        {/* CONTENIDO SCROLLEABLE */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <Tabs
            defaultValue="historial"
            className="w-full h-full flex flex-col"
          >
            <div className="px-4 pt-4 shrink-0">
              <TabsList className="grid w-full grid-cols-3 bg-muted/50 border border-border">
                <TabsTrigger
                  value="historial"
                  className="text-xs font-bold uppercase tracking-wide sm:tracking-widest"
                >
                  <Wallet className="w-3.5 h-3.5 mr-0.2 hidden sm:block" />{" "}
                  Historial
                </TabsTrigger>
                <TabsTrigger
                  value="ventas"
                  className="text-xs font-bold uppercase tracking-wide sm:tracking-widest"
                >
                  <History className="w-3.5 h-3.5 mr-0.2 hidden sm:block" />{" "}
                  Ventas
                </TabsTrigger>
                <TabsTrigger
                  value="info"
                  className="text-xs font-bold uppercase tracking-wide sm:tracking-widest"
                >
                  <Info className="w-3.5 h-3.5 mr-0.2 hidden sm:block" /> Info
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6 md:p-4 flex-1">
              {isLoading ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <>
                  {/* PESTAÑA: historial (CUENTA CORRIENTE) */}
                  <TabsContent
                    value="historial"
                    className="m-0 space-y-6 animate-in fade-in-50"
                  >
                    <div className="bg-card border border-border rounded-xl p-3 flex flex-col md:flex-row md:flex-wrap md:items-start md:justify-between gap-3">
                      <div className="order-1">
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          {montoRecargo > 0
                            ? "Saldo con recargo"
                            : "Saldo Actual"}
                        </p>
                        <p className="text-2xl font-mono font-medium text-foreground">
                          {formatearMoneda(
                            montoRecargo > 0 ? saldoConRecargo : saldo,
                          )}
                        </p>
                        {/* El desglose solo aparece cuando hay mora: si el
                            número grande ya incluye el recargo, hay que poder
                            explicarle al cliente de dónde salió. */}
                        {montoRecargo > 0 && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {formatearMoneda(saldo)} de deuda{" "}
                            <span className="text-danger font-medium">
                              + {formatearMoneda(montoRecargo)} por mora
                            </span>
                          </p>
                        )}
                      </div>
                      {saldo > 0 && (
                        <RegisterPaymentModal
                          cliente={cliente}
                          metodosPago={metodosPago}
                          recargoMoraEstimado={montoRecargo}
                          className="w-full md:w-auto order-3 md:order-2"
                        />
                      )}
                      {lineaVencimiento && (
                        <p
                          className={`text-xs order-2 md:order-3 md:basis-full ${
                            mostrarAlertaVencimiento
                              ? "font-medium text-danger"
                              : "text-muted-foreground"
                          }`}
                        >
                          {lineaVencimiento}
                        </p>
                      )}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold uppercase text-muted-foreground mb-3 border-b border-border/50 pb-2">
                        Libro Mayor
                      </h3>
                      {data.movimientos.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic text-center py-8">
                          No hay movimientos registrados.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {data.movimientos.map((mov) => (
                            <MovimientoCCCard
                              key={mov.id}
                              mov={mov}
                              isAdmin={isAdmin}
                              puedeCorregirCobro={puedeCorregirCobro}
                              metodosPago={metodosPago}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  {/* PESTAÑA: VENTAS */}
                  <TabsContent
                    value="ventas"
                    className="m-0 animate-in fade-in-50"
                  >
                    <h3 className="text-sm font-semibold uppercase text-muted-foreground mb-3 border-b border-border/50 pb-2">
                      Historial de Tickets
                    </h3>
                    {data.ventas.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic text-center py-8">
                        No hay compras registradas.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {data.ventas.map((venta) => {
                          const idCorto = venta.id.split("-")[0].toUpperCase();
                          return (
                            <div
                              key={venta.id}
                              className="flex flex-col p-4 bg-background border border-border rounded-lg gap-2"
                            >
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-mono font-medium uppercase text-sm text-foreground">
                                    Ticket #{idCorto}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {formatearFechaHora(venta.fecha_venta)}
                                  </p>
                                </div>
                                <span className="font-mono font-medium text-success">
                                  {formatearMoneda(Number(venta.total))}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground line-clamp-1 mt-1">
                                {venta.ventas_items
                                  ?.map(
                                    (item) =>
                                      `${item.cantidad}x ${nombreRenglon(
                                        getSupabaseRelation(item.producto)
                                          ?.nombre,
                                        item,
                                      )}`,
                                  )
                                  .join(", ")}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </TabsContent>

                  {/* PESTAÑA: INFO */}
                  <TabsContent
                    value="info"
                    className="m-0 animate-in fade-in-50 space-y-4"
                  >
                    <div className="bg-muted/30 p-4 rounded-xl border border-border space-y-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Documento / DNI
                        </p>
                        <p className="font-medium text-sm mt-0.5">
                          {cliente.dni || "No registrado"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Email
                        </p>
                        <p className="font-medium text-sm mt-0.5">
                          {cliente.email || "No registrado"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Notas internas
                        </p>
                        <p className="font-medium text-sm mt-0.5 whitespace-pre-wrap">
                          {cliente.notas || "Sin notas"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 mt-5 pt-5 border-t border-border/50">
                      <div className="min-w-0 rounded-lg bg-background/70 border border-border/60 p-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          <TrendingUp className="h-3.5 w-3.5" />
                          Total Gasto
                        </div>
                        <p className="mt-1 text-base font-semibold text-foreground truncate">
                          {formatearMoneda(stats.totalComprado)}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-lg bg-background/70 border border-border/60 p-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          <Tags className="h-3.5 w-3.5" />
                          Tickets
                        </div>
                        <p className="mt-1 text-base font-semibold text-foreground truncate">
                          {stats.totalTickets}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-lg bg-background/70 border border-border/60 p-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          <Star className="h-3.5 w-3.5 text-warning fill-warning/20" />
                          Favorito
                        </div>
                        <p className="mt-1 text-base font-semibold text-foreground truncate">
                          {favCategoryLabel}
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                </>
              )}
            </div>
          </Tabs>
        </div>
      </SheetContent>

      <AdjustClientBalanceModal
        cliente={isAdjustOpen ? cliente : null}
        onClose={() => setIsAdjustOpen(false)}
      />
      <EditClientModal
        cliente={isEditOpen ? cliente : null}
        onClose={() => setIsEditOpen(false)}
        entregaMinimaActiva={entregaMinimaActiva}
      />
      <PerdonarDeudaModal
        cliente={isPerdonOpen ? cliente : null}
        onClose={() => setIsPerdonOpen(false)}
      />
    </Sheet>
  );
}
