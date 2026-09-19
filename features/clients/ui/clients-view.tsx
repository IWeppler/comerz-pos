"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Search,
  UploadCloud,
  Users,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Cliente } from "@/entities/clientes/type";
import { MetodoPago } from "@/entities/payments/types";
import { formatearMoneda } from "@/shared/utils/formatters";
import { CreateClientModal } from "./add-client-modal";
import { ClientDetailSheet } from "./client-detail-sheet";
import {
  ClientStatusFilterControl,
  type ClientStatusFilter,
} from "./client-status-filter";
import { ImportClientsCsvModal } from "./import-clients-csv-modal";
import { calcularDiasVencido } from "../lib/calcular-dias-vencido";
import {
  clasificarEstadoCliente,
  type EstadoCliente,
} from "../lib/clasificar-estado-cliente";
import {
  calcularSaldoConRecargo,
  RecargoMoraConfig,
} from "../lib/calcular-saldo-con-recargo";
import type { ScoringCliente } from "../lib/scoring-cliente";
import {
  calcularReferencia,
  scoringDesdeCliente,
} from "../lib/scoring-desde-cliente";
import { ScoringBadges } from "./scoring-badges";
import {
  ClienteEstadoBadge,
  ESTADO_CLIENTE_CONFIG,
} from "@/shared/components/cliente-estado-badge";

type SortConfig = {
  key: "nombre" | "deuda" | "ltv" | "vencimiento" | "scoring";
  direction: "asc" | "desc";
};
const CLIENTS_PER_PAGE = 10;

type ClienteVentaResumen = {
  total?: number | string | null;
};

type ClienteConVentas = Cliente & {
  ventas?: ClienteVentaResumen[] | null;
};

type ClienteMapeado = ClienteConVentas & {
  cantidadVentas: number;
  totalComprado: number;
  scoring: ScoringCliente;
  /** Recargo por mora de HOY, 0 si no está vencido o si el comercio no lo
   * configuró. Derivado, nunca guardado: el saldo con recargo cambia solo con
   * el paso del tiempo. */
  montoRecargoMora: number;
  saldoConRecargo: number;
  fechaVencimientoFormateada: string | null;
  diasVencido: number | null;
  estado: EstadoCliente;
};

interface ClientsViewProps {
  clientes: ClienteConVentas[];
  metodosPago: MetodoPago[];
  entregaMinimaActiva?: boolean;
  recargoMoraConfig: RecargoMoraConfig;
  /** Porción VENCIDA por cliente (FIFO), base del recargo por mora. Sale de
   * `deuda_cc_vencida`; un cliente ausente no tiene deuda viva. */
  vencidoPorCliente: Record<string, number>;
  /** Recargos anteriores impagos por cliente. Salen de la base del próximo
   * recargo: la mora no se calcula sobre mora. */
  moraPreviaPorCliente: Record<string, number>;
  isAdmin?: boolean;
  puedeCorregirCobro?: boolean;
}

export function ClientsView({
  clientes,
  metodosPago,
  entregaMinimaActiva = false,
  recargoMoraConfig,
  vencidoPorCliente,
  moraPreviaPorCliente,
  isAdmin = false,
  puedeCorregirCobro = false,
}: Readonly<ClientsViewProps>) {
  // El "ahora" se congela en el primer render: si saliera de `new Date()`
  // dentro del useMemo, cada recálculo daría puntajes microscópicamente
  // distintos y el memo dejaría de servir.
  const [ahora] = useState(() => new Date());
  // La referencia del valor es el mejor cliente de ESTE comercio: "$200.000 de
  // margen" no dice si es mucho hasta saber contra qué.
  const referenciaScoring = useMemo(
    () => calcularReferencia(clientes),
    [clientes],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<ClientStatusFilter>("todos");
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "ltv",
    direction: "desc",
  });
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const totalClientes = clientes.length;
  const morosos = clientes.filter(
    (cliente) => Number(cliente.saldo_pendiente || 0) > 0,
  );
  const dineroEnCalle = morosos.reduce(
    (total, cliente) => total + Number(cliente.saldo_pendiente || 0),
    0,
  );

  const clientesMapeados = useMemo<ClienteMapeado[]>(() => {
    return clientes.map((cliente) => {
      const ventas = cliente.ventas || [];
      const totalComprado = ventas.reduce(
        (total, venta) => total + Number(venta.total || 0),
        0,
      );
      const fechaVencimiento = cliente.fecha_vencimiento_deuda ?? null;
      const diasVencido = calcularDiasVencido(fechaVencimiento);
      const saldo = Number(cliente.saldo_pendiente || 0);
      const fechaVencimientoFormateada = fechaVencimiento
        ? new Intl.DateTimeFormat("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(fechaVencimiento))
        : null;
      const estado = clasificarEstadoCliente(saldo, diasVencido);
      const scoring = scoringDesdeCliente(cliente, referenciaScoring, ahora);
      // Misma función que usa el server al cobrar y el detalle del cliente:
      // si la tabla dijera un número y el cobro imputara otro, el vendedor no
      // tendría forma de saber cuál es el bueno.
      const { montoRecargo, saldoConRecargo } = calcularSaldoConRecargo(
        {
          monto_pendiente: cliente.saldo_pendiente,
          fecha_vencimiento: cliente.fecha_vencimiento_deuda,
          monto_vencido: vencidoPorCliente[cliente.id] ?? 0,
          mora_previa: moraPreviaPorCliente[cliente.id] ?? 0,
        },
        recargoMoraConfig,
      );

      return {
        ...cliente,
        cantidadVentas: ventas.length,
        totalComprado,
        montoRecargoMora: montoRecargo,
        saldoConRecargo,
        fechaVencimientoFormateada,
        diasVencido,
        estado,
        scoring,
      };
    });
  }, [
    clientes,
    recargoMoraConfig,
    vencidoPorCliente,
    moraPreviaPorCliente,
    referenciaScoring,
    ahora,
  ]);

  // El KPI sigue siendo CAPITAL: la mora no es plata prestada, es una
  // penalidad que recién existe si el cliente paga tarde. Sumarla al "dinero
  // en la calle" inflaría el número que el comercio usa para saber cuánto le
  // deben. Va como línea aparte, que es el mismo criterio que la posición de
  // dinero usa con lo cobrado-sin-acreditar.
  const recargoMoraEnCalle = useMemo(
    () => clientesMapeados.reduce((total, c) => total + c.montoRecargoMora, 0),
    [clientesMapeados],
  );

  // Deriva del array vivo por id (en vez de guardar la fila clickeada como
  // snapshot) para que el sheet abierto refleje el saldo apenas se
  // refetchea la lista tras una mutación de cuenta corriente.
  const selectedClient = useMemo(
    () => clientesMapeados.find((c) => c.id === selectedClientId) ?? null,
    [clientesMapeados, selectedClientId],
  );

  const clientesFiltrados = useMemo(() => {
    let result = clientesMapeados.filter(
      (cliente) =>
        cliente.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (cliente.telefono && cliente.telefono.includes(searchQuery)),
    );

    if (filterStatus !== "todos") {
      result = result.filter((cliente) => cliente.estado === filterStatus);
    }

    result.sort((a, b) => {
      if (sortConfig.key === "nombre") {
        return sortConfig.direction === "asc"
          ? a.nombre.localeCompare(b.nombre)
          : b.nombre.localeCompare(a.nombre);
      }

      if (sortConfig.key === "ltv") {
        return sortConfig.direction === "asc"
          ? a.totalComprado - b.totalComprado
          : b.totalComprado - a.totalComprado;
      }

      if (sortConfig.key === "scoring") {
        return sortConfig.direction === "asc"
          ? a.scoring.puntaje - b.scoring.puntaje
          : b.scoring.puntaje - a.scoring.puntaje;
      }

      if (sortConfig.key === "vencimiento") {
        // Clientes sin fecha_vencimiento_deuda (diasVencido null) van
        // siempre al final, sin importar la dirección — no hay "antes" o
        // "después" que asignarles frente a una fecha real.
        if (a.diasVencido === null && b.diasVencido === null) return 0;
        if (a.diasVencido === null) return 1;
        if (b.diasVencido === null) return -1;
        return sortConfig.direction === "asc"
          ? a.diasVencido - b.diasVencido
          : b.diasVencido - a.diasVencido;
      }

      // Ordena por el saldo CON recargo, que es la columna que se ve: ordenar
      // por el capital dejaría filas fuera de orden a la vista.
      const deudaA = a.saldoConRecargo;
      const deudaB = b.saldoConRecargo;
      return sortConfig.direction === "asc" ? deudaA - deudaB : deudaB - deudaA;
    });

    return result;
  }, [clientesMapeados, searchQuery, filterStatus, sortConfig]);

  const totalPages = Math.max(
    1,
    Math.ceil(clientesFiltrados.length / CLIENTS_PER_PAGE),
  );
  const effectiveCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (effectiveCurrentPage - 1) * CLIENTS_PER_PAGE;
  const pageEnd = pageStart + CLIENTS_PER_PAGE;
  const clientesPaginados = clientesFiltrados.slice(pageStart, pageEnd);
  const visibleStart = clientesFiltrados.length === 0 ? 0 : pageStart + 1;
  const visibleEnd = Math.min(pageEnd, clientesFiltrados.length);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleFilterChange = (status: ClientStatusFilter) => {
    setFilterStatus(status);
    setCurrentPage(1);
  };

  const handleSort = (columna: SortConfig["key"]) => {
    setSortConfig((current) => {
      if (current.key === columna) {
        return {
          key: columna,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }

      return { key: columna, direction: "asc" };
    });
    setCurrentPage(1);
  };

  const renderSortIcon = (columna: SortConfig["key"]) => {
    if (sortConfig.key !== columna) {
      return (
        <ArrowUpDown className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />
      );
    }

    return sortConfig.direction === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 shrink-0 text-foreground" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 shrink-0 text-foreground" />
    );
  };

  return (
    <div className="flex flex-col gap-4 py-2 px-2 md:px-4">
      {/* El medidor del cupo de cuenta corriente vive SOLO en Perfil >
          Suscripción, que es donde se mira el plan. Acá ocupaba una banda
          entera arriba de la tabla todos los días para un dato que cambia una
          vez por mes. El freno real sigue estando donde importa: la base
          rechaza el alta manual de deuda al llegar al tope, y la venta fiada
          nunca se frena. */}

      {/* ── KPIs SUPERIORES ── */}
      <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
        <Card className="min-w-[82vw] border-border shadow-none snap-start sm:min-w-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Dinero en la Calle
            </CardTitle>
            <Wallet className="w-4 h-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-mono font-medium text-foreground">
              {formatearMoneda(dineroEnCalle)}
            </div>
            <p className="text-xs font-mono uppercase text-muted-foreground mt-1">
              Capital a cobrar
            </p>
            {recargoMoraEnCalle > 0 && (
              <p className="text-xs font-mono uppercase text-danger mt-0.5">
                + {formatearMoneda(recargoMoraEnCalle)} de mora
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-[82vw] border-border shadow-none bg-card snap-start sm:min-w-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cuentas con Deuda
            </CardTitle>
            <AlertTriangle className="w-4 h-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-mono font-medium text-foreground">
              {morosos.length}{" "}
              <span className="text-sm font-sans font-normal">clientes</span>
            </div>
            <p className="text-xs font-mono uppercase text-muted-foreground mt-1">
              Con saldo pendiente
            </p>
          </CardContent>
        </Card>

        <Card className="min-w-[82vw] border-border shadow-none bg-card snap-start sm:min-w-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Clientes activos
            </CardTitle>
            <Users className="w-4 h-4 text-info" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-mono font-medium text-foreground">
              {totalClientes}
            </div>
            <p className="font-mono uppercase text-xs text-muted-foreground mt-1">
              En tu base de datos
            </p>
          </CardContent>
        </Card>
      </div>

      {/* SEARCHBAR Y FILTERBAR */}
      <div className="flex flex-col gap-3 px-2 pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="relative w-full sm:w-80 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o telefono..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 h-10 bg-muted border border-border rounded-xl"
          />
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-4">
          <ClientStatusFilterControl
            value={filterStatus}
            onChange={handleFilterChange}
          />

          <div className="hidden sm:flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsImportOpen(true)}
              className="h-10 shadow-none border-border"
            >
              <UploadCloud className="w-5 h-5 mr-2" /> Importar CSV
            </Button>
            <CreateClientModal entregaMinimaActiva={entregaMinimaActiva} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:hidden">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsImportOpen(true)}
              className="h-10 w-full justify-center"
            >
              <UploadCloud className="w-4 h-4 mr-2" /> Importar
            </Button>
            <CreateClientModal
              buttonClassName="h-10 w-full justify-center"
              labelClassName="flex whitespace-nowrap"
              entregaMinimaActiva={entregaMinimaActiva}
            />
          </div>
        </div>
      </div>

      {/* TABLA */}
      <div className="bg-card rounded-xl border border-border shadow-none overflow-hidden mt-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-muted text-muted-foreground text-[10px] md:text-xs uppercase font-medium tracking-wide border-b border-border/60">
              <tr>
                <th
                  className="px-3 py-3 md:px-5 md:py-4 text-left"
                  onClick={() => handleSort("nombre")}
                >
                  <div className="flex items-center gap-1.5">
                    Cliente {renderSortIcon("nombre")}
                  </div>
                </th>
                <th className="py-3 md:px-2 md:py-4">Estado</th>
                <th className="px-3 py-3 md:px-5 md:py-4 hidden sm:table-cell">
                  Contacto
                </th>
                <th
                  className="px-3 py-3 md:px-5 md:py-4 hidden md:table-cell text-right"
                  onClick={() => handleSort("ltv")}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    Total comprado {renderSortIcon("ltv")}
                  </div>
                </th>
                <th
                  className="px-3 py-3 md:px-5 md:py-4 text-center"
                  onClick={() => handleSort("scoring")}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    Scoring {renderSortIcon("scoring")}
                  </div>
                </th>
                <th
                  className="px-3 py-3 md:px-5 md:py-4 text-right"
                  onClick={() => handleSort("deuda")}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    Deuda Actual {renderSortIcon("deuda")}
                  </div>
                </th>
                <th
                  className="px-3 py-3 md:px-5 md:py-4 hidden lg:table-cell text-right"
                  onClick={() => handleSort("vencimiento")}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    Fecha de vencimiento {renderSortIcon("vencimiento")}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {clientesFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <Users className="w-8 h-8 opacity-20 mb-2" />
                      <p className="font-medium">No se encontraron clientes.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                clientesPaginados.map((cliente) => {
                  const saldo = Number(cliente.saldo_pendiente || 0);
                  const estadoLabel =
                    ESTADO_CLIENTE_CONFIG[cliente.estado].label;

                  return (
                    <tr
                      key={cliente.id}
                      onClick={() => setSelectedClientId(cliente.id)}
                      className="hover:bg-muted/30 transition-colors group cursor-pointer"
                    >
                      <td className="px-3 py-3 md:px-5 md:py-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">
                            {cliente.nombre}
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-0.5">
                            {cliente.dni
                              ? `DNI: ${cliente.dni}`
                              : "Sin DNI registrado"}
                          </span>
                        </div>
                      </td>

                      <td className="px-2 py-3 md:py-4 text-center">
                        <div className="flex min-h-10 flex-col justify-center gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toast(estadoLabel);
                              }}
                              className="flex items-center gap-1.5 -m-1 p-1"
                            >
                              <ClienteEstadoBadge
                                estado={cliente.estado}
                                iconClassName="h-4 w-4 md:h-3.5 md:w-3.5 shrink-0"
                                labelClassName="hidden sm:inline"
                              />
                            </button>
                          </div>
                          {cliente.estado === "vencido" &&
                            cliente.diasVencido !== null && (
                              <span className="text-left text-[11px] text-foreground">
                                {cliente.diasVencido} día
                                {cliente.diasVencido === 1 ? "" : "s"}
                              </span>
                            )}
                        </div>
                      </td>

                      <td className="px-3 py-3 md:px-5 md:py-4 hidden sm:table-cell">
                        <div className="flex flex-col text-xs md:font-sm font-mono font-medium text-muted-foreground">
                          <span>{cliente.telefono || "-"}</span>
                          {cliente.email ? (
                            <span className="text-[10px] opacity-80">
                              {cliente.email}
                            </span>
                          ) : null}
                        </div>
                      </td>

                      <td className="px-3 py-3 md:px-5 md:py-4 hidden md:table-cell text-right">
                        <div className="flex flex-col">
                          <span className="font-mono text-muted-foreground">
                            {formatearMoneda(cliente.totalComprado)}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-3 md:px-5 md:py-4">
                        <ScoringBadges scoring={cliente.scoring} />
                      </td>

                      <td className="px-2 py-3 md:px-5 md:py-4 text-right">
                        {/* Solo el total. El desglose de la mora quedó en el
                            detalle del cliente: en la tabla era una segunda
                            línea en cada fila para explicar un número que ya
                            se entiende. */}
                        {saldo > 0 ? (
                          <span className="font-mono font-medium text-foreground px-2 py-0.5 shadow-none text-sm">
                            {formatearMoneda(cliente.saldoConRecargo)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50 font-bold text-lg">
                            -
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-3 md:px-5 md:py-4 text-right hidden lg:table-cell">
                        <span className="text-xs font-medium text-muted-foreground">
                          {cliente.fechaVencimientoFormateada ?? "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {clientesFiltrados.length > 0 ? (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2">
          <p className="text-xs font-medium text-muted-foreground">
            Mostrando {visibleStart}-{visibleEnd} de {clientesFiltrados.length}{" "}
            clientes
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={effectiveCurrentPage === 1}
              className="h-9 text-xs font-bold shadow-none border-border"
            >
              Anterior
            </Button>
            <span className="min-w-20 text-center text-xs font-bold text-muted-foreground">
              {effectiveCurrentPage} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((page) => Math.min(totalPages, page + 1))
              }
              disabled={effectiveCurrentPage === totalPages}
              className="h-9 text-xs font-bold shadow-none border-border"
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}

      <ClientDetailSheet
        cliente={selectedClient}
        metodosPago={metodosPago}
        entregaMinimaActiva={entregaMinimaActiva}
        recargoMoraConfig={recargoMoraConfig}
        montoVencido={
          selectedClient ? (vencidoPorCliente[selectedClient.id] ?? 0) : 0
        }
        moraPrevia={
          selectedClient ? (moraPreviaPorCliente[selectedClient.id] ?? 0) : 0
        }
        isAdmin={isAdmin}
        puedeCorregirCobro={puedeCorregirCobro}
        onClose={() => setSelectedClientId(null)}
      />
      <ImportClientsCsvModal
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
      />
    </div>
  );
}
