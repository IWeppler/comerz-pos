import { cookies } from "next/headers";
import {
  getVentasAction,
  getPagosCuentaCorrienteAction,
} from "@/features/sales/actions/get-sales";
import { getStockAction } from "@/features/stock/actions/get-product";
import { createClient } from "@/shared/config/supabase/server";
import {
  getDashboardMetrics,
  PeriodoDashboard,
} from "@/features/dashboard/lib/get-dashboard-metrics";
import { ReportesFilterbar } from "@/features/reports/ui/reportes-filterbar";
import { contarDiasConVentas } from "@/features/dashboard/lib/contar-dias-con-ventas";
import { getAdvisorInsights } from "@/features/reports/actions/get-advisor-insights";
import { AdvisorBanner } from "@/features/reports/ui/advisor-banner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ExportacionesTab } from "@/features/exportaciones/ui/exportaciones-tab";
import { puedeVerVistaGerencialAction } from "@/features/caja/actions/permisos-caja";
import { getResumenFinancieroAction } from "@/features/caja/actions/get-resumen-financiero";
import { ResumenFinancieroPeriodo } from "@/features/caja/ui/resumen-financiero-periodo";
import { getVentasFacturadasAction } from "@/features/caja/actions/get-ventas-facturadas";
import { VentasFacturadas } from "@/features/caja/ui/ventas-facturadas";
import { ScrollArea, ScrollBar } from "@/shared/ui/scroll-area";
import {
  Activity,
  DollarSign,
  DropletOff,
  Package,
  PiggyBank,
  ShoppingCart,
  TrendingUp,
  FileSpreadsheet,
  Users,
} from "lucide-react";
import { BajasTab } from "@/features/reports/ui/bajas-tab";
import { InventarioTab } from "@/features/reports/ui/inventario-tab";
import { RentabilidadTab } from "@/features/reports/ui/rentabilidad-tab";
import { ResumenTab } from "@/features/reports/ui/resumen-tab";
import { BajaAprobadaReporte } from "@/entities/reportes/types";
import { VentasTab } from "@/features/reports/ui/ventas-tab";
import { CrmTab } from "@/features/reports/ui/crm-tab";
import { VendedoresTab } from "@/features/reports/ui/vendedores-tab";
import { Venta, VentaPago } from "@/entities/ventas/types";
import { ConfiguracionPOS } from "@/entities/config/types";
import { PaywallModulo } from "@/features/planes/ui/paywall-modulo";
import { ReportesMaqueta } from "@/features/reports/ui/reportes-maqueta";
import {
  FEATURES,
  tieneFeatureServer,
} from "@/features/planes/lib/tiene-feature-server";

export const dynamic = "force-dynamic";

/** Con qué período abre la pestaña Finanzas. El mes es la unidad en la que la
 * dueña piensa los gastos fijos, y es el mismo valor con el que abría en
 * /caja: mover la pantalla no puede cambiarle el número a nadie. */
const PERIODO_INICIAL_FINANZAS = "mes" as const;

interface PageProps {
  searchParams: Promise<{ periodo?: string; desde?: string; hasta?: string }>;
}

export default async function ReportesPage({
  searchParams,
}: Readonly<PageProps>) {
  const params = await searchParams;
  const periodoParam = (params.periodo as PeriodoDashboard) || "mes";
  const desdeParam = params.desde;
  const hastaParam = params.hasta;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // El corte va ANTES de cualquier consulta: el módulo no se protege
  // escondiendo el link del sidebar, porque la ruta sigue viva y tipearla a
  // mano mostraba la facturación entera del comercio. Además evita cargar
  // ventas, stock y CRM para después no mostrarlos.
  if (!(await tieneFeatureServer(supabase, FEATURES.REPORTES))) {
    // El fondo es una MAQUETA, no este módulo con los datos tapados: el blur
    // es CSS y se saca desde las DevTools. Los beneficios los arma el propio
    // modal desde las reglas del plan.
    return (
      <PaywallModulo
        feature={FEATURES.REPORTES}
        descripcion="Reportes te muestra de dónde sale la plata: qué se vende, qué deja margen y qué está quieto en el depósito."
      >
        <ReportesMaqueta />
      </PaywallModulo>
    );
  }

  const { data: puedeVerVendedoresRaw } = await supabase.rpc("tiene_permiso", {
    clave: "reportes.ver_todos_empleados",
  });
  const puedeVerVendedores = Boolean(puedeVerVendedoresRaw);

  const [
    ventasResponse,
    productosResponse,
    egresosResponse,
    bajasResponse,
    clientesResponse,
    configResponse,
    pagosCuentaCorrienteResponse,
  ] = await Promise.all([
    getVentasAction(),
    getStockAction(),
    supabase.from("egresos").select("id, concepto, monto, fecha, tipo, orden_compra_id"),
    supabase
      .from("bajas")
      .select(
        "id, producto_id, variante, cantidad, motivo, creado_en, estado, perfiles(nombre)",
      )
      .eq("estado", "APROBADA"),
    supabase.from("clientes").select("*").order("nombre", { ascending: true }),
    supabase
      .from("configuracion_pos")
      .select("cc_plazo_mora, crm_dias_inactivo, modo_facturacion")
      .single(),
    getPagosCuentaCorrienteAction(),
  ]);

  const ventas = (ventasResponse.data || []) as unknown as Venta[];
  const ventasOperativas = ventas.filter(
    (venta) =>
      venta.estado_operacion !== "ANULADA" && venta.estado_pago !== "ANULADA",
  );
  const productos = productosResponse.data || [];
  const egresos = egresosResponse.data || [];
  const bajasAprobadas = (bajasResponse.data || []) as BajaAprobadaReporte[];
  const clientes = clientesResponse.data || [];
  // Cobros de deuda: aportan comisión y recargo, no ingresos (el ticket
  // fiado ya computó su total el día de la venta).
  const pagosCuentaCorriente = (pagosCuentaCorrienteResponse.data ||
    []) as unknown as VentaPago[];

  const config: Partial<ConfiguracionPOS> = configResponse.data || {};
  const plazoMora = config.cc_plazo_mora ?? 30;
  const diasInactivo = config.crm_dias_inactivo ?? 60;

  // ───────────────────────────────────────────────────────────────────────
  // FINANZAS: qué PASÓ con la plata en el período.
  //
  // Vivía en /caja → Dinero y se mudó acá el 22/9/2026. Dinero contesta
  // "dónde está la plata AHORA" y es una pantalla de operación: se abre entre
  // dos clientas para ver si alcanza el efectivo. Esto otro es un reporte —
  // cobros por medio, gastos por categoría, arqueos del mes— y se mira una
  // vez por semana con tiempo. Tenerlos juntos hacía que la pregunta urgente
  // quedara arriba de tres bloques que nadie estaba leyendo en ese momento.
  //
  // Tiene su propio selector de período, igual que Exportaciones y por el
  // mismo motivo: `ReportesFilterbar` gobierna las métricas de venta y estos
  // dos hablan de flujo de dinero, que el comercio mira por mes calendario.
  // Dos controles en la misma pantalla es un riesgo conocido; el alternativo
  // —hacerlos seguir al filtro de arriba— cambiaría el significado de un
  // número que ya se lee de una forma.
  // ───────────────────────────────────────────────────────────────────────
  const puedeVerFinanzas = await puedeVerVistaGerencialAction();
  const facturaConArca = config.modo_facturacion === "ARCA";

  const [resumenFinanciero, facturadas] = puedeVerFinanzas
    ? await Promise.all([
        getResumenFinancieroAction(PERIODO_INICIAL_FINANZAS),
        // Facturado / sin facturar tiene sentido SOLO para quien factura con
        // ARCA: en un comercio de ticket interno "0% facturado" es ruido.
        facturaConArca
          ? getVentasFacturadasAction(PERIODO_INICIAL_FINANZAS)
          : Promise.resolve(null),
      ])
    : [null, null];

  const metrics = getDashboardMetrics(
    ventasOperativas,
    productos,
    egresos,
    bajasAprobadas,
    periodoParam,
    desdeParam,
    hastaParam,
    pagosCuentaCorriente,
  );

  const now = new Date();
  let startDate = new Date(0);
  let endDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );

  if (periodoParam === "hoy") {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (periodoParam === "7dias") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);
  } else if (periodoParam === "30dias") {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);
  } else if (periodoParam === "mes") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (periodoParam === "mes_anterior") {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  } else if (periodoParam === "anio") {
    startDate = new Date(now.getFullYear(), 0, 1);
  } else if (periodoParam === "personalizado" && desdeParam) {
    startDate = new Date(`${desdeParam}T00:00:00`);
    if (hastaParam) {
      endDate = new Date(`${hastaParam}T23:59:59`);
    }
  }

  const ventasDelPeriodo =
    periodoParam === "historico"
      ? ventasOperativas
      : ventasOperativas.filter((v) => {
          const fechaVenta = new Date(v.fecha_venta);
          return fechaVenta >= startDate && fechaVenta <= endDate;
        });

  const bajasDelPeriodo =
    periodoParam === "historico"
      ? bajasAprobadas
      : bajasAprobadas.filter((baja) => {
          const fechaBaja = new Date(baja.creado_en);
          return fechaBaja >= startDate && fechaBaja <= endDate;
        });

  const costoMercaderiaVendida = metrics.ingresos - metrics.gananciaBrutaVentas;
  // `diasDelPeriodo` habilita las reglas que hablan de RITMO (cobertura de
  // stock, día pico). Sin él no disparan, así que va también acá y no solo en
  // el panel: son las mismas ventas ya filtradas por el período de esta
  // pantalla, contadas por día local.
  const insights = getAdvisorInsights({
    ...metrics,
    diasDelPeriodo: contarDiasConVentas(ventasDelPeriodo, {
      inicio: startDate,
      fin: endDate,
    }),
  });

  // yyyy-mm-dd en horario local, mismo criterio que ReportesFilterbar usa
  // para no desfasar por UTC.
  const formatLocal = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const desdeVendedores = formatLocal(startDate);
  const hastaVendedores = formatLocal(endDate);

  return (
    <div className="flex flex-col gap-4 px-4 p-2">
      <AdvisorBanner insights={insights} />

      <Tabs defaultValue="resumen" className="w-full space-y-4 mt-2">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-border/50 pb-2">
          <ScrollArea className="w-full pb-2 lg:pb-0 lg:w-auto">
            <TabsList className="bg-sidebar border border-border h-10! inline-flex w-max min-w-full sm:min-w-0">
              <TabsTrigger
                value="resumen"
                className="rounded-sm px-2 data-[state=active]:bg-background data-[state=active]:border-border data-[state=active]:text-foreground cursor-pointer transition-color shadow-none"
              >
                <Activity className="w-4 h-4 mr-2" /> Resumen
              </TabsTrigger>
              <TabsTrigger
                value="ventas"
                className="rounded-sm px-2 data-[state=active]:bg-background data-[state=active]:border-border data-[state=active]:text-foreground  cursor-pointer transition-colors"
              >
                <ShoppingCart className="w-4 h-4 mr-2" /> Ventas
              </TabsTrigger>
              <TabsTrigger
                value="rentabilidad"
                className="rounded-sm px-2 data-[state=active]:bg-background data-[state=active]:border-border data-[state=active]:text-foreground  cursor-pointer transition-colors"
              >
                <DollarSign className="w-4 h-4 mr-2" /> Rentabilidad
              </TabsTrigger>
              <TabsTrigger
                value="inventario"
                className="rounded-sm px-2 data-[state=active]:bg-background data-[state=active]:border-border data-[state=active]:text-foreground  cursor-pointer transition-colors"
              >
                <Package className="w-4 h-4 mr-2" /> Inventario
              </TabsTrigger>
              <TabsTrigger
                value="bajas"
                className="rounded-sm px-2 data-[state=active]:bg-background data-[state=active]:border-border data-[state=active]:text-foreground  cursor-pointer transition-colors"
              >
                <DropletOff className="w-4 h-4 mr-2" /> Bajas
              </TabsTrigger>
              <TabsTrigger
                value="crm"
                className="rounded-sm px-2 data-[state=active]:bg-background data-[state=active]:border-border data-[state=active]:text-foreground  cursor-pointer transition-colors"
              >
                <Users className="w-4 h-4 mr-2" /> CRM & Cobranza
              </TabsTrigger>
              {puedeVerVendedores && (
                <TabsTrigger
                  value="vendedores"
                  className="rounded-sm px-2 data-[state=active]:bg-background data-[state=active]:border-border data-[state=active]:text-foreground  cursor-pointer transition-colors"
                >
                  <TrendingUp className="w-4 h-4 mr-2" /> Vendedores
                </TabsTrigger>
              )}
              {puedeVerFinanzas && (
                <TabsTrigger
                  value="finanzas"
                  className="rounded-sm px-2 data-[state=active]:bg-background data-[state=active]:border-border data-[state=active]:text-foreground  cursor-pointer transition-colors"
                >
                  <PiggyBank className="w-4 h-4 mr-2" /> Finanzas
                </TabsTrigger>
              )}
              <TabsTrigger
                value="exportaciones"
                className="rounded-sm px-2 data-[state=active]:bg-background data-[state=active]:border-border data-[state=active]:text-foreground  cursor-pointer transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Exportaciones
              </TabsTrigger>
            </TabsList>
            <ScrollBar orientation="horizontal" className="invisible" />
          </ScrollArea>

          <div className="w-full lg:w-auto flex lg:justify-end shrink-0 z-10 mb-2 lg:mb-0">
            <ReportesFilterbar />
          </div>
        </div>

        <ResumenTab
          metrics={metrics}
          ventasDelPeriodo={ventasDelPeriodo}
          periodo={periodoParam}
        />
        <VentasTab metrics={metrics} />
        <RentabilidadTab
          metrics={metrics}
          costoMercaderiaVendida={costoMercaderiaVendida}
        />
        <InventarioTab metrics={metrics} />
        <BajasTab
          metrics={metrics}
          bajasDelPeriodo={bajasDelPeriodo}
          productos={productos}
        />

        {/* 🚀 Pasamos los parámetros dinámicos al Tab del CRM */}
        <CrmTab
          ventas={ventas}
          ventasDelPeriodo={ventasDelPeriodo}
          clientes={clientes}
          plazoMora={plazoMora}
          diasInactivo={diasInactivo}
        />

        <VendedoresTab
          puedeVer={puedeVerVendedores}
          desde={desdeVendedores}
          hasta={hastaVendedores}
        />

        {/* Los dos traen su propio selector de período y se refrescan solos;
            por eso no reciben el filtro de arriba. Ver el comentario largo en
            el fetch. */}
        {resumenFinanciero?.data && (
          <TabsContent value="finanzas" className="mt-0 space-y-10">
            <ResumenFinancieroPeriodo
              resumenInicial={resumenFinanciero.data}
              periodoInicial={PERIODO_INICIAL_FINANZAS}
            />
            {facturadas?.data && (
              <VentasFacturadas
                inicial={facturadas.data}
                periodoInicial={PERIODO_INICIAL_FINANZAS}
              />
            )}
          </TabsContent>
        )}

        {/* Tiene su propio selector de período: el contador cierra por mes,
            no por el filtro con el que se miran los reportes del día. */}
        <TabsContent value="exportaciones" className="mt-0">
          <ExportacionesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
