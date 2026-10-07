"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  Check,
  Loader2,
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
import { useAvisosCc } from "./use-avisos-cc";
import { FiltroCicloCobro } from "./filtro-ciclo-cobro";
import { useRecordatorioCc } from "./use-recordatorio-cc";
import { FaWhatsapp } from "react-icons/fa";
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
  BasesMora,
  calcularSaldoConRecargo,
  RecargoMoraConfig,
} from "../lib/calcular-saldo-con-recargo";
import type { ScoringCliente } from "../lib/scoring-cliente";
import { saldoAFavorDe } from "../lib/saldo-a-favor";
import {
  calcularReferencia,
  scoringDesdeCliente,
} from "../lib/scoring-desde-cliente";
import { ScoringBadges } from "./scoring-badges";
import { normalizarBusqueda } from "@/shared/lib/normalizar-busqueda";
import {
  ClienteEstadoBadge,
  ESTADO_CLIENTE_CONFIG,
} from "@/shared/components/cliente-estado-badge";

type SortConfig = {
  key: "nombre" | "deuda" | "ltv" | "vencimiento" | "scoring";
  direction: "asc" | "desc";
};
const CLIENTS_PER_PAGE = 25;

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
  /** Capital vencido (base con PORCION_VENCIDA) y lo que ya pagó su recargo,
   * por cliente. Ver `BasesMora`. */
  basesMoraPorCliente: Record<string, BasesMora>;
  nombreComercio?: string | null;
  /** `configuracion_pos.mensaje_recordatorio_cc`; null = mensaje por defecto. */
  plantillaRecordatorio?: string | null;
  isAdmin?: boolean;
  puedeCorregirCobro?: boolean;
  /** Permiso `clientes.crear`: alta e importación. Solo decide si se muestran
   * los botones; la base lo exige igual (policy de INSERT en `clientes`). */
  puedeCrearCliente?: boolean;
  /** Permiso `clientes.cargar_saldo`: el botón "Cargar saldo" de la ficha.
   * La base lo exige igual (policy de INSERT del débito manual). */
  puedeCargarSaldo?: boolean;
}

export function ClientsView({
  clientes,
  metodosPago,
  entregaMinimaActiva = false,
  recargoMoraConfig,
  vencidoPorCliente,
  moraPreviaPorCliente,
  basesMoraPorCliente,
  nombreComercio = null,
  plantillaRecordatorio = null,
  isAdmin = false,
  puedeCorregirCobro = false,
  puedeCrearCliente = false,
  puedeCargarSaldo = false,
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
    key: "nombre",
    direction: "asc",
  });
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  // El ciclo de cobro (solo cierre mensual): el filtro "A abonar" y la marca
  // de resumen enviado. Sin cierre mensual no cambia nada de la tabla.
  const { aviso, enCiclo, marcar, etiquetaFiltro } = useAvisosCc();
  const recordar = useRecordatorioCc({
    nombreComercio,
    plantilla: plantillaRecordatorio,
  });
  const [enviandoResumen, setEnviandoResumen] = useState<string | null>(null);
  // El toggle del ciclo. Sin ciclo (no hay cierre mensual) queda apagado
  // aunque haya quedado prendido: la tabla nunca filtra por algo invisible.
  const [cicloPedido, setCicloPedido] = useState(false);
  const cicloActivo = cicloPedido && aviso !== null;

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
          ...basesMoraPorCliente[cliente.id],
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
    basesMoraPorCliente,
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
    // Nombre sin tildes ("maria" encuentra "María") y teléfono solo por
    // dígitos: "1145678901" tiene que encontrar "11 4567-8901".
    const query = normalizarBusqueda(searchQuery);
    const queryDigitos = searchQuery.replace(/\D/g, "");
    let result = clientesMapeados.filter(
      (cliente) =>
        normalizarBusqueda(cliente.nombre).includes(query) ||
        (queryDigitos.length > 0 &&
          (cliente.telefono ?? "").replace(/\D/g, "").includes(queryDigitos)),
    );

    if (filterStatus !== "todos") {
      result = result.filter((cliente) => cliente.estado === filterStatus);
    }
    if (cicloActivo) {
      result = result.filter((cliente) => enCiclo.has(cliente.id));
    }

    result.sort((a, b) => {
      if (sortConfig.key === "nombre") {
        return sortConfig.direction === "asc"
          ? a.nombre.trim().localeCompare(b.nombre.trim(), "es", { sensitivity: "base" })
          : b.nombre.trim().localeCompare(a.nombre.trim(), "es", { sensitivity: "base" });
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
  }, [
    clientesMapeados,
    searchQuery,
    filterStatus,
    sortConfig,
    cicloActivo,
    enCiclo,
  ]);

  // Los KPI del ciclo: los clientes del ciclo con el filtro de estado
  // aplicado (no la búsqueda, que es para encontrar a uno, no para contar).
  // Plata = lo que tienen que abonar hasta el vencimiento, capital; la mora
  // va aparte, como en el KPI de siempre.
  const kpiCiclo = useMemo(() => {
    if (!cicloActivo) return null;
    const delCiclo = clientesMapeados.filter(
      (c) =>
        enCiclo.has(c.id) &&
        (filterStatus === "todos" || c.estado === filterStatus),
    );
    return {
      cuentas: delCiclo.length,
      monto: delCiclo.reduce((t, c) => t + (enCiclo.get(c.id)?.monto ?? 0), 0),
      mora: delCiclo.reduce((t, c) => t + c.montoRecargoMora, 0),
      avisados: delCiclo.filter((c) => enCiclo.get(c.id)?.enviado).length,
    };
  }, [cicloActivo, clientesMapeados, enCiclo, filterStatus]);

  const fechaCorta = (iso: string) => {
    const [, mes, dia] = iso.split("-");
    return `${Number(dia)}/${Number(mes)}`;
  };

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

  const hayFiltros =
    searchQuery.trim() !== "" || filterStatus !== "todos" || cicloActivo;

  const limpiarFiltros = () => {
    setSearchQuery("");
    setFilterStatus("todos");
    setCicloPedido(false);
    setCurrentPage(1);
  };

  // El mismo envío que el botón "Resumen" del detalle (useRecordatorioCc),
  // con el total que muestra la fila. Si el cliente está en el ciclo, queda
  // registrado como avisado.
  const enviarResumen = async (cliente: ClienteMapeado) => {
    setEnviandoResumen(cliente.id);
    try {
      await recordar({
        clienteId: cliente.id,
        telefono: cliente.telefono,
        nombreCliente: cliente.nombre,
        saldo: Number(cliente.saldo_pendiente || 0),
        montoRecargo: cliente.montoRecargoMora,
        saldoConRecargo: cliente.saldoConRecargo,
        fechaVencimiento: cliente.fecha_vencimiento_deuda ?? null,
        diasVencido: cliente.diasVencido,
        montoCiclo: enCiclo.get(cliente.id)?.monto,
      });
      await marcar(cliente.id);
    } finally {
      setEnviandoResumen(null);
    }
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

  // El ícono de las columnas sin orden activo queda SIEMPRE visible (tenue):
  // escondido detrás de un hover, nadie sabía que se podía ordenar, y en el
  // celular no hay hover.
  const ariaSort = (columna: SortConfig["key"]) =>
    sortConfig.key !== columna
      ? undefined
      : sortConfig.direction === "asc"
        ? ("ascending" as const)
        : ("descending" as const);

  const renderSortButton = (
    columna: SortConfig["key"],
    etiqueta: string,
    align: "start" | "center" | "end" = "start",
  ) => {
    const activa = sortConfig.key === columna;
    const Icono = !activa
      ? ArrowUpDown
      : sortConfig.direction === "asc"
        ? ArrowUp
        : ArrowDown;

    return (
      <button
        type="button"
        onClick={() => handleSort(columna)}
        className={`inline-flex min-h-11 w-full cursor-pointer items-center gap-1.5 uppercase tracking-wide transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md ${
          align === "end"
            ? "justify-end"
            : align === "center"
              ? "justify-center"
              : "justify-start"
        } ${activa ? "text-foreground" : ""}`}
      >
        {etiqueta}
        <Icono
          className={`h-3.5 w-3.5 shrink-0 ${activa ? "" : "opacity-40"}`}
          aria-hidden
        />
      </button>
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

      {/* ── KPIs SUPERIORES ──
          Con el ciclo de cobro prendido cuentan el ciclo (cuántas cuentas,
          cuánta plata, a cuántas ya se les mandó el resumen); apagado, la
          cartera entera como siempre. */}
      {kpiCiclo && aviso ? (
        <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
          <Card className="min-w-[82vw] border-primary/30 shadow-none snap-start sm:min-w-0">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {etiquetaFiltro}
              </CardTitle>
              <Wallet className="w-4 h-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-mono font-medium text-foreground">
                {formatearMoneda(kpiCiclo.monto)}
              </div>
              <p className="text-xs font-mono uppercase text-muted-foreground mt-1">
                {aviso.tipo === "MORA" ? "Venció" : "Vence"} el{" "}
                {fechaCorta(aviso.venceEl)}
              </p>
              {kpiCiclo.mora > 0 && (
                <p className="text-xs font-mono uppercase text-danger mt-0.5">
                  + {formatearMoneda(kpiCiclo.mora)} de mora
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-[82vw] border-primary/30 shadow-none bg-card snap-start sm:min-w-0">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Cuentas a abonar
              </CardTitle>
              <CalendarClock className="w-4 h-4 text-warning" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-mono font-medium text-foreground">
                {kpiCiclo.cuentas}{" "}
                <span className="text-sm font-sans font-normal">clientes</span>
              </div>
              <p className="text-xs font-mono uppercase text-muted-foreground mt-1">
                Cierre del {fechaCorta(aviso.cierre)}
              </p>
            </CardContent>
          </Card>

          <Card className="min-w-[82vw] border-primary/30 shadow-none bg-card snap-start sm:min-w-0">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Resumen enviado
              </CardTitle>
              <Check className="w-4 h-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-mono font-medium text-foreground">
                {kpiCiclo.avisados}{" "}
                <span className="text-sm font-sans font-normal">
                  de {kpiCiclo.cuentas}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full w-full origin-left rounded-full bg-success transition-transform duration-300 ease-out"
                  style={{
                    transform: `scaleX(${kpiCiclo.cuentas ? kpiCiclo.avisados / kpiCiclo.cuentas : 0})`,
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
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
                Clientes
              </CardTitle>
              <Users className="w-4 h-4 text-info" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-mono font-medium text-foreground">
                {totalClientes}
              </div>
              <p className="font-mono uppercase text-xs text-muted-foreground mt-1">
                Total registrados
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* SEARCHBAR Y FILTERBAR */}
      <div className="flex flex-col gap-3 px-2 pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="relative w-full sm:w-80 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o teléfono"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 h-11 bg-muted border border-border rounded-xl"
          />
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-4">
          <ClientStatusFilterControl
            value={filterStatus}
            onChange={handleFilterChange}
          />
          {aviso && etiquetaFiltro && (
            <FiltroCicloCobro
              etiqueta={etiquetaFiltro}
              cantidad={enCiclo.size}
              activo={cicloActivo}
              onCambiar={(activo) => {
                setCicloPedido(activo);
                setCurrentPage(1);
              }}
            />
          )}

          {/* Alta e importación crean clientes: piden `clientes.crear`. */}
          {puedeCrearCliente ? (
            <>
              <div className="hidden sm:flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsImportOpen(true)}
                  className="h-11 rounded-xl px-3 shadow-none border-border"
                >
                  <UploadCloud className="w-5 h-5 mr-2" /> Importar CSV
                </Button>
                <CreateClientModal
                  buttonClassName="h-11 rounded-xl px-3"
                  entregaMinimaActiva={entregaMinimaActiva}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 sm:hidden">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsImportOpen(true)}
                  className="h-11 w-full justify-center rounded-xl"
                >
                  <UploadCloud className="w-4 h-4 mr-2" /> Importar
                </Button>
                <CreateClientModal
                  buttonClassName="h-11 w-full justify-center rounded-xl"
                  labelClassName="flex whitespace-nowrap"
                  entregaMinimaActiva={entregaMinimaActiva}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* TABLA */}
      <div className="bg-card rounded-xl border border-border shadow-none overflow-hidden mt-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-muted text-muted-foreground text-[10px] md:text-xs uppercase font-medium tracking-wide border-b border-border/60">
              <tr>
                <th
                  className="px-3 py-0.5 md:px-5 md:py-1.5 text-left"
                  aria-sort={ariaSort("nombre")}
                >
                  {renderSortButton("nombre", "Cliente")}
                </th>
                <th className="py-3 md:px-2 md:py-4">Estado</th>
                <th className="px-3 py-3 md:px-5 md:py-4 hidden sm:table-cell">
                  Contacto
                </th>
                <th
                  className="px-3 py-0.5 md:px-5 md:py-1.5 hidden md:table-cell text-right"
                  aria-sort={ariaSort("ltv")}
                >
                  {renderSortButton("ltv", "Total comprado", "end")}
                </th>
                <th
                  className="px-3 py-0.5 md:px-5 md:py-1.5 text-center"
                  aria-sort={ariaSort("scoring")}
                >
                  {renderSortButton("scoring", "Scoring", "center")}
                </th>
                <th
                  className="px-3 py-0.5 md:px-5 md:py-1.5 text-right"
                  aria-sort={ariaSort("deuda")}
                >
                  {renderSortButton("deuda", "Deuda Actual", "end")}
                </th>
                <th
                  className="px-3 py-0.5 md:px-5 md:py-1.5 hidden lg:table-cell text-right"
                  aria-sort={ariaSort("vencimiento")}
                >
                  {renderSortButton("vencimiento", "Fecha de vencimiento", "end")}
                </th>
                <th className="px-2 py-3 md:px-4 md:py-4 text-center">
                  Resumen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {clientesFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <Users className="w-8 h-8 opacity-20 mb-2" />
                      {hayFiltros ? (
                        <>
                          <p className="font-medium whitespace-normal">
                            {searchQuery.trim()
                              ? `Sin resultados para «${searchQuery.trim()}».`
                              : "Ningún cliente coincide con los filtros."}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={limpiarFiltros}
                            className="mt-3 h-10 shadow-none border-border"
                          >
                            Limpiar filtros
                          </Button>
                        </>
                      ) : (
                        <p className="font-medium">
                          Todavía no hay clientes cargados.
                        </p>
                      )}
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
                      onKeyDown={(e) => {
                        // Solo la fila: Enter sobre el botón de WhatsApp o el
                        // badge no tiene que abrir además el detalle.
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedClientId(cliente.id);
                        }
                      }}
                      tabIndex={0}
                      aria-label={`Ver detalle de ${cliente.nombre}`}
                      className="hover:bg-muted/30 transition-colors group cursor-pointer focus-visible:outline-none focus-visible:bg-muted/50"
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
                        ) : saldo < 0 ? (
                          // Saldo con signo: negativo es plata del cliente
                          // (seña, pago de más, vale). Nunca se muestra como
                          // un número negativo, que se lee como deuda.
                          <span className="font-mono font-medium text-success px-2 py-0.5 text-sm whitespace-nowrap">
                            {formatearMoneda(saldoAFavorDe(saldo))} a favor
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

                      <td className="px-1 py-1 md:px-4 text-center">
                        {/* Solo con deuda: un resumen de cobranza a quien no
                            debe nada es una molestia. Verde = ya se le mandó
                            en este ciclo. */}
                        {saldo > 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void enviarResumen(cliente);
                            }}
                            disabled={enviandoResumen !== null}
                            aria-label={`Enviar resumen de cuenta a ${cliente.nombre} por WhatsApp`}
                            title={
                              enCiclo.get(cliente.id)?.enviado
                                ? "Resumen ya enviado en este ciclo. Tocá para mandarlo de nuevo."
                                : "Enviar resumen de cuenta por WhatsApp"
                            }
                            className="relative inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] hover:bg-muted hover:text-success disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {enviandoResumen === cliente.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FaWhatsapp
                                className={`h-[18px] w-[18px] ${
                                  enCiclo.get(cliente.id)?.enviado
                                    ? "text-success"
                                    : ""
                                }`}
                              />
                            )}
                            {enCiclo.get(cliente.id)?.enviado && (
                              <Check className="absolute right-1.5 top-1.5 h-3 w-3 rounded-full bg-card text-success" />
                            )}
                          </button>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
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
        basesMora={
          selectedClient ? basesMoraPorCliente[selectedClient.id] : undefined
        }
        nombreComercio={nombreComercio}
        plantillaRecordatorio={plantillaRecordatorio}
        isAdmin={isAdmin}
        puedeCorregirCobro={puedeCorregirCobro}
        puedeCargarSaldo={puedeCargarSaldo}
        onClose={() => setSelectedClientId(null)}
        onResumenEnviado={marcar}
        montoCiclo={
          selectedClient ? enCiclo.get(selectedClient.id)?.monto : undefined
        }
      />
      <ImportClientsCsvModal
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
      />
    </div>
  );
}
