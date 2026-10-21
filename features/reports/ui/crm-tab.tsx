"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { TabsContent } from "@/shared/ui/tabs";
import {
  Users,
  TrendingUp,
  Activity,
  ShieldAlert,
  CreditCard,
  ChevronRight,
  ChevronLeft,
  Search,
  Filter,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { formatearMoneda } from "@/shared/utils/formatters";
import { deudaDe } from "@/features/clients/lib/saldo-a-favor";
import type { DeudaCcCrm } from "../actions/get-deuda-cc-crm";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

interface CrmTabProps {
  ventas: any[];
  ventasDelPeriodo: any[];
  clientes: any[];
  plazoMora: number;
  diasInactivo: number;
  /** Antigüedad y vencido desde la cuenta corriente (FIFO). Null si el rol no puede verlos. */
  deudaCc: DeudaCcCrm | null;
  deudaCcError: "SIN_PERMISO" | "ERROR" | null;
}

const ITEMS_POR_PAGINA = 10;

type SortConfig = {
  key:
    | "nombre"
    | "comprado"
    | "ganancia"
    | "saldo_actual"
    | "saldo_vencido"
    | "ultima_compra";
  direction: "asc" | "desc";
};

export function CrmTab({
  ventas,
  ventasDelPeriodo,
  clientes,
  plazoMora,
  diasInactivo,
  deudaCc,
  deudaCcError,
}: Readonly<CrmTabProps>) {
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("TODOS");
  const [sortConfig, setSortConfig] = useState({
    key: "comprado",
    direction: "desc",
  });
  const [currentPage, setCurrentPage] = useState(1);

  // 1. EL CEREBRO ANALÍTICO (Calculamos todas tus métricas aquí de forma súper rápida)
  const crmMetrics = useMemo(() => {
    let ventasAClientes = 0;
    let gananciaAClientes = 0;
    let totalVentasPeriodo = 0;

    // --- A. Métricas del Período ---
    ventasDelPeriodo.forEach((v) => {
      const total = Number(v.total || 0);
      totalVentasPeriodo += total;

      if (v.cliente_id) {
        ventasAClientes += total;
        // Costo base o calculado
        let costo = 0;
        if (v.ventas_items) {
          costo = v.ventas_items.reduce(
            (acc: number, item: any) =>
              acc + Number(item.precio_costo || 0) * Number(item.cantidad || 1),
            0,
          );
        } else {
          // `ventas.precio_costo` YA es el costo total de la venta: cada
          // renglon entra multiplicado por su cantidad. Multiplicarlo otra vez
          // por `cantidad` lo inflaba tantas veces como renglones tuviera el
          // ticket. Sobre las 226 ventas de mas de un renglon daba $25.386.500
          // de costo contra $6.323.000 real, o sea una ganancia mucho menor a
          // la verdadera en todo el CRM.
          costo = Number(v.precio_costo || 0);
        }
        gananciaAClientes += total - costo;
      }
    });

    // --- B. Antigüedad y vencido: fuente ÚNICA = cuenta corriente (FIFO) ---
    // Sale de `antiguedad_saldo_cc` y `deuda_cc_vencida` (ver get-deuda-cc-crm.ts).
    // Antes se calculaba sobre ventas.monto_pendiente, un campo congelado que no
    // baja con los cobros ni con los reintegros parciales.
    const vencidoPorCliente = deudaCc?.vencidoPorCliente ?? {};
    const antiguedad: Record<"0_30" | "31_60" | "61_90" | "MAS_90", number> = {
      "0_30": 0,
      "31_60": 0,
      "61_90": 0,
      MAS_90: 0,
    };
    deudaCc?.tramos.forEach((t) => {
      antiguedad[t.tramo] = t.saldo;
    });
    const saldoVencidoTotal = deudaCc?.vencidoTotal ?? 0;
    const clientesConVencido = Object.keys(vencidoPorCliente).length;
    const now = new Date();

    // DEUDA, no saldo crudo: con saldo con signo, sumar el crudo restaría los
    // saldos a favor de la deuda de los demás.
    const saldoPendienteTotal = clientes.reduce(
      (acc, c) => acc + deudaDe(c.saldo_pendiente),
      0,
    );

    // --- C. Ranking de Calidad Comercial ---
    const clientsMap = new Map();
    clientes.forEach((c) => {
      clientsMap.set(c.id, {
        id: c.id,
        nombre: c.nombre,
        comprado: 0,
        ganancia: 0,
        saldo_actual: Number(c.saldo_pendiente || 0),
        saldo_vencido: vencidoPorCliente[c.id] ?? 0,
        ultima_compra: null as Date | null,
      });
    });

    ventas.forEach((v) => {
      if (v.cliente_id && clientsMap.has(v.cliente_id)) {
        const c = clientsMap.get(v.cliente_id);
        const total = Number(v.total || 0);
        let costo = 0;
        if (v.ventas_items) {
          costo = v.ventas_items.reduce(
            (acc: number, item: any) =>
              acc + Number(item.precio_costo || 0) * Number(item.cantidad || 1),
            0,
          );
        } else {
          // `ventas.precio_costo` YA es el costo total de la venta: cada
          // renglon entra multiplicado por su cantidad. Multiplicarlo otra vez
          // por `cantidad` lo inflaba tantas veces como renglones tuviera el
          // ticket. Sobre las 226 ventas de mas de un renglon daba $25.386.500
          // de costo contra $6.323.000 real, o sea una ganancia mucho menor a
          // la verdadera en todo el CRM.
          costo = Number(v.precio_costo || 0);
        }

        const fecha = new Date(v.fecha_venta);

        c.comprado += total;
        c.ganancia += total - costo;

        if (!c.ultima_compra || fecha > c.ultima_compra) {
          c.ultima_compra = fecha;
        }
      }
    });

    const clientList = Array.from(clientsMap.values())
      .filter((c) => c.comprado > 0 || c.saldo_actual > 0)
      .map((c) => {
        const margen = c.comprado > 0 ? (c.ganancia / c.comprado) * 100 : 0;
        const diasDesdeUltimaCompra = c.ultima_compra
          ? Math.floor(
              (now.getTime() - c.ultima_compra.getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : 999;

        // 🧠 Motor de Segmentación (Reglas Claras)
        let estado = "Regular";
        let colorClass = "bg-muted text-muted-foreground border-border";

        if (c.saldo_vencido > 0) {
          estado = "Riesgo Alto";
          colorClass = "bg-danger/10 text-danger border-danger/20";
        } else if (
          diasDesdeUltimaCompra > diasInactivo &&
          c.saldo_actual === 0
        ) {
          estado = "Inactivo";
          colorClass = "bg-muted text-muted-foreground border-border";
        } else if (margen < 15) {
          estado = "Poco Rentable";
          colorClass = "bg-warning/10 text-warning border-warning/20";
        } else if (
          c.comprado > 20000 &&
          margen >= 25 &&
          c.saldo_vencido === 0
        ) {
          estado = "Excelente";
          colorClass = "bg-success/10 text-success border-success/20";
        }

        return {
          ...c,
          margen,
          estado,
          colorClass,
          diasDesdeUltimaCompra,
        };
      });

    return {
      ventasAClientes,
      porcentajeVentasAClientes:
        totalVentasPeriodo > 0
          ? (ventasAClientes / totalVentasPeriodo) * 100
          : 0,
      gananciaAClientes,
      saldoPendienteTotal,
      saldoVencidoTotal,
      clientesConVencido,
      antiguedad,
      deudaDisponible: deudaCc !== null,
      clientList,
    };
  }, [ventas, ventasDelPeriodo, clientes, diasInactivo, deudaCc]);

  const { filteredAndSortedClients, totalPages } = useMemo(() => {
    let result = [...crmMetrics.clientList];

    // Búsqueda
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.nombre.toLowerCase().includes(q));
    }

    // Filtro por segmento
    if (segmentFilter !== "TODOS") {
      result = result.filter((c) => c.estado === segmentFilter);
    }

    // Ordenamiento
    result.sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];

      if (sortConfig.key === "ultima_compra") {
        aValue = a.ultima_compra ? a.ultima_compra.getTime() : 0;
        bValue = b.ultima_compra ? b.ultima_compra.getTime() : 0;
      }

      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });

    return {
      filteredAndSortedClients: result,
      totalPages: Math.ceil(result.length / ITEMS_POR_PAGINA) || 1,
    };
  }, [crmMetrics.clientList, search, segmentFilter, sortConfig]);

  if (currentPage > totalPages) setCurrentPage(1);

  const currentClients = filteredAndSortedClients.slice(
    (currentPage - 1) * ITEMS_POR_PAGINA,
    currentPage * ITEMS_POR_PAGINA,
  );

  const handleSort = (key: SortConfig["key"]) => {
    setSortConfig((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };

  const renderSortIcon = (columnKey: SortConfig["key"]) => {
    if (sortConfig.key !== columnKey) return null;
    return sortConfig.direction === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 shrink-0" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 shrink-0" />
    );
  };

  // Helper para anchos de barra de progreso
  const maxAntiguedad = Math.max(...Object.values(crmMetrics.antiguedad), 1);
  const getWidth = (val: number) =>
    `${Math.max(2, (val / maxAntiguedad) * 100)}%`;

  return (
    <TabsContent
      value="crm"
      className="space-y-6 outline-none animate-in fade-in-50 pt-2"
    >
      {!crmMetrics.deudaDisponible && (
        <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {deudaCcError === "SIN_PERMISO"
            ? "Tu rol no puede ver la antigüedad ni el vencido de la deuda. Pedile a un administrador."
            : "No pudimos calcular la antigüedad de la deuda. Recargá la página."}
        </p>
      )}

      {/* ── KPIs (izquierda) y antigüedad (derecha) ── */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="sm:col-span-2 border-border shadow-none bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Ventas a Clientes
            </CardTitle>
            <Users className="w-4 h-4 text-chart-3" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-foreground">
              {formatearMoneda(crmMetrics.ventasAClientes)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {crmMetrics.porcentajeVentasAClientes.toFixed(0)}% del total
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Ganancia
            </CardTitle>
            <TrendingUp className="w-4 h-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-foreground">
              +{formatearMoneda(crmMetrics.gananciaAClientes)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Rentabilidad generada
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Saldo Pendiente
            </CardTitle>
            <CreditCard className="w-4 h-4 text-chart-1" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-foreground">
              {formatearMoneda(crmMetrics.saldoPendienteTotal)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Capital en la calle
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Vencido
            </CardTitle>
            <ShieldAlert className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-foreground">
              {crmMetrics.deudaDisponible
                ? formatearMoneda(crmMetrics.saldoVencidoTotal)
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground font-medium mt-1">
              Pasó el plazo de {plazoMora} días
            </p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Clientes con vencido
            </CardTitle>
            <Users className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-foreground">
              {crmMetrics.deudaDisponible ? crmMetrics.clientesConVencido : "—"}
            </div>
            <p className="text-xs text-muted-foreground font-medium mt-1">
              Con deuda que pasó el plazo
            </p>
          </CardContent>
        </Card>
        </div>

        {/* Antigüedad de Deuda */}
        <Card className="border-border shadow-none bg-card">
          <CardHeader className="border-b border-border/40 pb-4">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" /> Antigüedad
              de la Deuda
            </CardTitle>
            <p className="text-xs font-normal text-muted-foreground">
              Desde la fecha de cada deuda pendiente, cobrando primero la más vieja.
            </p>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-muted-foreground">
                  0 a 30 días{" "}
                  <span className="text-xs ml-1 opacity-70">(Sana)</span>
                </span>
                <span className="font-medium text-foreground">
                  {formatearMoneda(crmMetrics.antiguedad["0_30"])}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-success h-full rounded-full transition-all"
                  style={{ width: getWidth(crmMetrics.antiguedad["0_30"]) }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-muted-foreground">
                  31 a 60 días
                </span>
                <span className="font-medium text-foreground">
                  {formatearMoneda(crmMetrics.antiguedad["31_60"])}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-amber-400 h-full rounded-full transition-all"
                  style={{ width: getWidth(crmMetrics.antiguedad["31_60"]) }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-muted-foreground">
                  61 a 90 días{" "}
                  <span className="text-xs ml-1 opacity-70">(Riesgo)</span>
                </span>
                <span className="font-medium text-foreground">
                  {formatearMoneda(crmMetrics.antiguedad["61_90"])}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-warning h-full rounded-full transition-all"
                  style={{ width: getWidth(crmMetrics.antiguedad["61_90"]) }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-danger">
                  Más de 90 días{" "}
                  <span className="text-xs ml-1 opacity-70">(Mora)</span>
                </span>
                <span className="font-bold text-danger">
                  {formatearMoneda(crmMetrics.antiguedad["MAS_90"])}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-danger h-full rounded-full transition-all"
                  style={{ width: getWidth(crmMetrics.antiguedad["MAS_90"]) }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* ── 3. RANKING DE CALIDAD COMERCIAL ── */}
      <Card className="border-border shadow-none bg-card">
        <CardHeader className="border-b border-border/40 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              Calidad Comercial
            </CardTitle>

            {/* Controles de Tabla */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-60">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar cliente..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-10 pl-9 shadow-none text-xs"
                />
              </div>
              <Select
                value={segmentFilter}
                onValueChange={(v) => {
                  setSegmentFilter(v);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[140px] h-9 shadow-none text-xs font-medium">
                  <Filter className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Segmento" />
                </SelectTrigger>
                <SelectContent className="text-xs">
                  <SelectItem value="TODOS">Todos</SelectItem>
                  <SelectItem value="Excelente">Excelente</SelectItem>
                  <SelectItem value="Regular">Regular</SelectItem>
                  <SelectItem value="Riesgo Alto">Riesgo Alto</SelectItem>
                  <SelectItem value="Poco Rentable">Poco Rentable</SelectItem>
                  <SelectItem value="Inactivo">Inactivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          {currentClients.length > 0 ? (
            <>
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-card text-muted-foreground text-[10px] uppercase font-bold tracking-widest border-b border-border/60">
                  <tr>
                    <th
                      className="px-5 py-4 cursor-pointer hover:bg-muted/50 group"
                      onClick={() => handleSort("nombre")}
                    >
                      <div className="flex items-center">
                        Cliente {renderSortIcon("nombre")}
                      </div>
                    </th>
                    <th
                      className="px-5 py-4 cursor-pointer hover:bg-muted/50 group text-right"
                      onClick={() => handleSort("comprado")}
                    >
                      <div className="flex items-center justify-end">
                        Comprado {renderSortIcon("comprado")}
                      </div>
                    </th>
                    <th
                      className="px-5 py-4 cursor-pointer hover:bg-muted/50 group text-right"
                      onClick={() => handleSort("ganancia")}
                    >
                      <div className="flex items-center justify-end">
                        Ganancia (M) {renderSortIcon("ganancia")}
                      </div>
                    </th>
                    <th
                      className="px-5 py-4 cursor-pointer hover:bg-muted/50 group text-right"
                      onClick={() => handleSort("saldo_actual")}
                    >
                      <div className="flex items-center justify-end">
                        Saldo Actual {renderSortIcon("saldo_actual")}
                      </div>
                    </th>
                    <th className="px-5 py-4 text-right text-destructive">
                      Vencido
                    </th>
                    <th
                      className="px-5 py-4 cursor-pointer hover:bg-muted/50 group text-center"
                      onClick={() => handleSort("ultima_compra")}
                    >
                      <div className="flex items-center justify-center">
                        Última Compra {renderSortIcon("ultima_compra")}
                      </div>
                    </th>
                    <th className="px-5 py-4 text-center">Segmento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {currentClients.map((c) => (
                    <tr
                      key={c.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3 font-medium text-foreground">
                        {c.nombre}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-foreground">
                        {formatearMoneda(c.comprado)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="font-medium text-success">
                          {formatearMoneda(c.ganancia)}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-warning">
                        {c.saldo_actual > 0
                          ? formatearMoneda(c.saldo_actual)
                          : "-"}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-danger">
                        {c.saldo_vencido > 0
                          ? formatearMoneda(c.saldo_vencido)
                          : "-"}
                      </td>
                      <td className="px-5 py-3 text-center text-xs text-muted-foreground">
                        {c.ultima_compra
                          ? c.ultima_compra.toLocaleDateString("es-AR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "2-digit",
                            })
                          : "-"}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <Badge
                          variant="outline"
                          className={`shadow-none font-semibold text-[10px] uppercase tracking-wider ${c.colorClass}`}
                        >
                          {c.estado}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Paginación */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-border/60 bg-card">
                  <span className="text-xs text-muted-foreground">
                    Mostrando {(currentPage - 1) * ITEMS_POR_PAGINA + 1} -{" "}
                    {Math.min(
                      currentPage * ITEMS_POR_PAGINA,
                      filteredAndSortedClients.length,
                    )}{" "}
                    de {filteredAndSortedClients.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="h-8 shadow-none"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs font-medium px-2">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={currentPage === totalPages}
                      className="h-8 shadow-none"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center text-muted-foreground text-sm py-12 bg-card">
              No se encontraron clientes con esos filtros.
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
