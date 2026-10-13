import { Suspense } from "react";
import { ComplementosCatalogoSeccion } from "@/features/reports/ui/complementos-catalogo-seccion";
import {
  getVentasAction,
  getPagosCuentaCorrienteAction,
} from "@/features/sales/actions/get-sales";
import { getProductosPanelAction } from "@/features/stock/actions/get-product";
import {
  DIAS_INSIGHTS,
  resolverDesdeHistorialPanel,
} from "@/features/dashboard/lib/ventana-historial-panel";
import { leerConfigPos } from "@/entities/config/lib/leer-config-pos";
import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { getDashboardMetrics } from "@/features/dashboard/lib/get-dashboard-metrics";
import {
  resolverRangoActual,
  resolverRangoAnterior,
  resolverRangoRanking,
  formatearFechaISO,
  calcularCrecimiento,
  crecimientoDeTotal,
  crecimientoDeMedia,
  resolverRangoRolling,
  ETIQUETA_PERIODO,
  ETIQUETA_PERIODO_ANTERIOR,
  type PeriodoPanel,
} from "@/shared/lib/periodo-ranges";
import { construirSerieComparada } from "@/features/dashboard/lib/build-chart-series";
import { contarDiasConVentas } from "@/features/dashboard/lib/contar-dias-con-ventas";
import {
  compararConDiaTipico,
  muestraDeTickets,
} from "@/features/dashboard/lib/dia-tipico";
import {
  detectarQuiebresRotacion,
  VENTANA_ROTACION_DIAS,
} from "@/features/dashboard/lib/detectar-quiebres";
import { detectarCategoriasEnRiesgo } from "@/features/dashboard/lib/detectar-riesgo-categoria";
import {
  detectarFinDeTemporada,
  detectarProximaTemporada,
} from "@/features/dashboard/lib/detectar-estacionalidad";
import { resolverCategoriaDisplayLabel } from "@/shared/utils/category-tree";
import {
  PeriodoSelector,
  OPCIONES_PANEL,
} from "@/shared/components/periodo-selector";
import { VentasPeriodoChart } from "@/features/dashboard/ui/ventas-periodo-chart";
import { KpiFranja, KpiMiniCard } from "@/features/dashboard/ui/kpi-mini-card";
import { GrowthBadge } from "@/features/dashboard/ui/growth-badge";
import { AdvisorMiniList } from "@/features/dashboard/ui/advisor-mini-list";
import { VentasPorCategoria } from "@/features/dashboard/ui/ventas-por-categoria";
import { getUsuarioActual } from "@/shared/config/supabase/usuario-actual";
import { AtencionRequeridaCard } from "@/features/dashboard/ui/atencion-requerida-card";
import { RendimientoCard } from "@/features/dashboard/ui/rendimiento-card";
import { getAdvisorInsights } from "@/features/reports/actions/get-advisor-insights";
import { getDeudaVencidaAction } from "@/features/clients/actions/get-deuda-vencida";
import { getRemitosPendientesAction } from "@/features/purchases/actions/get-remitos-pendientes";
import { getSenalesInsightsAction } from "@/features/reports/actions/get-senales-insights";
import { listarReservasActivasAction } from "@/features/reservations/actions/manage-reservations";
import { normalizarRubro } from "@/entities/config/types";
import { rubroUsaReservas } from "@/features/pos/lib/reservas-por-rubro";
import {
  getSupabaseRelation,
  SupabaseRelation,
  Venta,
  VentaPago,
} from "@/entities/ventas/types";
import { formatearMoneda } from "@/shared/utils/formatters";
import { EgresoModal } from "@/features/caja/ui/egreso-modal";
import { getEstadoActivacionAction } from "@/features/onboarding/actions/get-estado-activacion";
import { ChecklistActivacion } from "@/features/onboarding/ui/checklist-activacion";
import { PrimerosPasos } from "@/features/onboarding/ui/primeros-pasos";
import { calcularProgresoActivacion } from "@/features/onboarding/lib/pasos-activacion";
import { Button } from "@/shared/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react";
import { bloquearVendedor } from "@/shared/config/supabase/guard-rol";
import {
  aRelojComercial,
  conFechasComerciales,
  desfaseRelojComercial,
} from "@/features/dashboard/lib/reloj-comercial";

export const dynamic = "force-dynamic";

const PERIODOS_VALIDOS: PeriodoPanel[] = [
  "hoy",
  "semana",
  "mes",
  "trimestre",
  "anio",
];

function parsearPeriodo(valor: string | undefined): PeriodoPanel {
  return PERIODOS_VALIDOS.includes(valor as PeriodoPanel)
    ? (valor as PeriodoPanel)
    : "semana";
}

// Los rankings nunca son de un solo día (mala muestra para "qué rota más"):
// con Hoy usan la ventana de 7. Ver resolverRangoRanking.
const ETIQUETA_RANKING: Record<PeriodoPanel, string> = {
  hoy: "últimos 7 días",
  semana: "últimos 7 días",
  mes: "últimos 28 días",
  trimestre: "últimos 3 meses",
  anio: "último año",
};

// Cuántos insights muestra la card del panel. Más que los 3 del banner de
// /reportes porque acá viven en una columna alta del bento: con 3 las filas
// quedan muy espaciadas y sobra aire.
const INSIGHTS_EN_PANEL = 5;

// Ventana de Comerz Intelligence (DIAS_INSIGHTS). NO es la del selector, y eso es
// el punto: lo que necesita tu atención no cambia porque alguien haya
// clickeado "Hoy".
//
// Alimentar el motor con el período elegido tenía dos efectos feos y reales:
// la regla de confianza corta con menos de 3 ventas, así que con "Hoy" la
// tarjeta entera decía "Recopilando datos…" cada mañana en un comercio con
// más de mil ventas; y "Alerta de Rentabilidad" (danger, primera de la lista)
// dispara con margen negativo, que en un día suelto es cuestión de a qué hora
// se cargó un gasto — pasó 1 de cada 36 días completos en Evens, y a media
// mañana es mucho más fácil.
//
// La constante vive en `ventana-historial-panel.ts`, junto con las demás
// ventanas que el panel mira: es lo que decide desde qué fecha se piden las
// ventas.

// Cómo se parte el gráfico de ventas en cada período (GRANULARIDAD_POR_PERIODO).
const ETIQUETA_TRAMO: Record<PeriodoPanel, string> = {
  hoy: "Por hora",
  semana: "Por día",
  mes: "Por día",
  trimestre: "Por semana",
  anio: "Por mes",
};

type ReservaActivaRow = {
  id: string;
  creado_en: string;
  producto: SupabaseRelation<{ nombre: string }>;
  variante: SupabaseRelation<{ nombre_display: string }>;
  cliente: SupabaseRelation<{ nombre: string }>;
  vendedora: SupabaseRelation<{ nombre: string }>;
};

export default async function DashboardPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ periodo?: string }>;
}>) {
  // El panel es la vista de gestión: un VENDEDOR va al POS. Hasta ahora eso
  // lo decidía solo el middleware. Ver `bloquearVendedor`.
  await bloquearVendedor();

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { periodo: periodoParam } = await searchParams;
  const periodo = parsearPeriodo(periodoParam);

  // La ventana de Insights se resuelve acá arriba porque una de sus señales se
  // pide a la base y entra en el mismo Promise.all que el resto.
  // Todo el panel calcula en el RELOJ COMERCIAL: "ahora" y cada fecha de los
  // datos corridos a la hora de Buenos Aires. Con el reloj del server (UTC en
  // Vercel) el día cortaba a las 21:00. Ver `reloj-comercial.ts`.
  const ahoraReal = new Date();
  const desfase = desfaseRelojComercial(ahoraReal);
  const ahora = aRelojComercial(ahoraReal, desfase);
  const rangoInsights = resolverRangoRolling(DIAS_INSIGHTS, ahora);

  // Desde cuándo se piden ventas, egresos, bajas y cobros de CC. Antes era
  // el historial ENTERO y cada cálculo recortaba lo suyo en memoria: el
  // payload crecía con cada venta y sin techo. La ventana la fija
  // `ventana-historial-panel.ts`, que enumera hasta dónde mira cada regla del
  // panel — cualquier regla nueva que necesite más historia se agrega AHÍ.
  const desdeHistorial = resolverDesdeHistorialPanel(periodo, ahora);
  const desdeIso = desdeHistorial.toISOString();

  const [
    ventasResponse,
    productosResponse,
    egresosResponse,
    bajasResponse,
    reservasResponse,
    deudaVencida,
    remitosPendientes,
    categoriasResponse,
    pagosCuentaCorrienteResponse,
    estadoActivacion,
    senales,
    configResponse,
    perfilResponse,
  ] = await Promise.all([
    getVentasAction({ desde: desdeIso }),
    // Sin variantes ni fotos: el panel no las lee. Ver `ProductoPanel`.
    getProductosPanelAction(),
    supabase
      .from("egresos")
      .select("id, concepto, monto, fecha, tipo, orden_compra_id")
      .gte("fecha", desdeIso),
    // Sin ventana a propósito: las PENDIENTES se cuentan todas (es un
    // pendiente, no un hecho del período) y la tabla está vacía en los cuatro
    // negocios — nada que crezca todavía.
    supabase
      .from("bajas")
      .select("id, producto_id, cantidad, creado_en, estado"),
    listarReservasActivasAction(),
    getDeudaVencidaAction(),
    getRemitosPendientesAction(),
    supabase.from("categorias").select("id, nombre, slug, parent_id"),
    getPagosCuentaCorrienteAction({ desde: desdeIso }),
    // Devuelve null si no es ADMIN: el gate vive en la RPC, así que acá no hay
    // que preguntar el rol por separado.
    getEstadoActivacionAction(),
    // Las seis señales gerenciales de Comerz Intelligence, en paralelo adentro.
    // Cada una viene en null si el usuario no tiene permiso gerencial.
    getSenalesInsightsAction(
      formatearFechaISO(rangoInsights.inicio),
      formatearFechaISO(rangoInsights.fin),
    ),
    // El rubro, para saber si este comercio reserva. Sale de `leerConfigPos`,
    // que los dos layouts de este mismo request YA llamaron: el `cache()` de
    // React devuelve la fila sin viajar de nuevo. Antes era una consulta
    // propia, o sea la segunda lectura de la misma fila en la misma request.
    leerConfigPos(),
    // La franja de plata (efectivo / por acreditar / deuda) se sacó del panel
    // el 12/10/2026 a pedido de Nacho: esos números viven en /caja.
    // El nombre para el saludo. El usuario ya lo resolvió el layout (cache de
    // React): esto es un viaje, en paralelo con el resto.
    getUsuarioActual().then(({ user }) =>
      user
        ? supabase.from("perfiles").select("nombre").eq("id", user.id).maybeSingle()
        : null,
    ),
  ]);

  // Comercio nuevo sin activar: en vez de un panel lleno de ceros, "Primeros
  // pasos" (una tarea por vez, con objetos grandes). Vuelve el panel solo
  // cuando vende o completa lo obligatorio. Solo ADMIN: para el resto la RPC
  // devuelve null. Ver docs/activacion-autonoma.md.
  // "Saltear tutorial" se guarda como hito del negocio: se consulta SOLO acá,
  // para los no activados (los demás no pagan el viaje extra).
  const sinActivar = !!estadoActivacion && !calcularProgresoActivacion(estadoActivacion).activado;
  const tutorialSalteado = sinActivar
    ? !!(
        await supabase
          .from("hitos_activacion")
          .select("hito")
          .eq("hito", "PRIMEROS_PASOS_SALTEADOS")
          .maybeSingle()
      ).data
    : false;
  if (estadoActivacion && sinActivar && !tutorialSalteado) {
    return <PrimerosPasos estado={estadoActivacion} />;
  }

  const ventasOriginales = (ventasResponse.data || []) as unknown as Venta[];
  const ventas = conFechasComerciales(ventasOriginales, ["fecha_venta"], desfase);
  // Cobros de deuda: aportan comisión y recargo a las métricas, no ingresos.
  const pagosCuentaCorriente = conFechasComerciales(
    (pagosCuentaCorrienteResponse.data || []) as unknown as VentaPago[],
    ["creado_en"],
    desfase,
  );
  const ventasOperativas = ventas.filter(
    (venta) =>
      venta.estado_operacion !== "ANULADA" && venta.estado_pago !== "ANULADA",
  );
  const productos = productosResponse.data || [];
  const egresos = conFechasComerciales(
    egresosResponse.data || [],
    ["fecha"],
    desfase,
  );
  const bajas = conFechasComerciales(
    bajasResponse.data || [],
    ["creado_en"],
    desfase,
  );

  const bajasAprobadas = bajas.filter((b) => b.estado === "APROBADA");
  const cantidadBajasPendientes = bajas.filter(
    (b) => b.estado === "PENDIENTE",
  ).length;

  const hoy = ahora;

  // Zona analítica (KPIs + chart + rankings): TODO lo de acá para abajo
  // depende de `periodo`. La zona de excepciones (Atención Requerida,
  // Comerz Insights) es fija y vive fuera de este bloque.
  const rangoActual = resolverRangoActual(periodo, hoy);
  const rangoAnterior = resolverRangoAnterior(periodo, hoy);
  const rangoRanking = resolverRangoRanking(periodo, hoy);

  const metricasActuales = getDashboardMetrics(
    ventasOperativas,
    productos,
    egresos,
    bajasAprobadas,
    "personalizado",
    formatearFechaISO(rangoActual.inicio),
    formatearFechaISO(rangoActual.fin),
    pagosCuentaCorriente,
    // Para que el donut separe subcategorías homónimas (Hombre › Remeras y
    // Mujer › Remeras).
    categoriasResponse.data || [],
  );
  const metricasAnteriores = getDashboardMetrics(
    ventasOperativas,
    productos,
    egresos,
    bajasAprobadas,
    "personalizado",
    formatearFechaISO(rangoAnterior.inicio),
    formatearFechaISO(rangoAnterior.fin),
    pagosCuentaCorriente,
  );
  // Comerz Insights corre sobre su propia ventana fija (resuelta arriba, junto
  // al fetch de su señal). Ver DIAS_INSIGHTS.
  const metricasInsights = getDashboardMetrics(
    ventasOperativas,
    productos,
    egresos,
    bajasAprobadas,
    "personalizado",
    formatearFechaISO(rangoInsights.inicio),
    formatearFechaISO(rangoInsights.fin),
    pagosCuentaCorriente,
  );

  // Rankings: SIEMPRE ventana semanal como mínimo (nunca diaria) — ventana
  // de mes si el selector está en "Mes".
  const metricasRanking = getDashboardMetrics(
    ventasOperativas,
    productos,
    egresos,
    bajasAprobadas,
    "personalizado",
    formatearFechaISO(rangoRanking.inicio),
    formatearFechaISO(rangoRanking.fin),
  );

  // Días ABIERTOS de cada tramo: dos días contra uno no es una comparación.
  // Ver `crecimientoDeTotal` y `contarDiasConVentas` (que explica por qué el
  // conteo no sale de turnos_caja, que sería el dato correcto).
  const diasActual = contarDiasConVentas(ventasOperativas, rangoActual);
  const diasAnterior = contarDiasConVentas(ventasOperativas, rangoAnterior);

  // "Hoy" no se compara contra una ventana anterior sino contra un día TÍPICO
  // de la misma semana, cortado a esta hora. Ver `compararConDiaTipico`: un
  // día suelto contra otro día suelto se movía ±60% por la suerte del día de
  // referencia, y comparar el día en curso contra uno completo mostraba ≈−67%
  // toda la mañana.
  const diaTipico =
    periodo === "hoy" ? compararConDiaTipico(ventasOperativas, hoy) : null;

  const crecimientoIngresos = diaTipico
    ? calcularCrecimiento(diaTipico.hoy.ingresos, diaTipico.tipico.ingresos)
    : crecimientoDeTotal(
        metricasActuales.ingresos,
        metricasAnteriores.ingresos,
        diasActual,
        diasAnterior,
      );
  const crecimientoUnidades = diaTipico
    ? calcularCrecimiento(diaTipico.hoy.unidades, diaTipico.tipico.unidades)
    : crecimientoDeTotal(
        metricasActuales.unidadesVendidas,
        metricasAnteriores.unidadesVendidas,
        diasActual,
        diasAnterior,
      );
  const crecimientoGanancia = diaTipico
    ? calcularCrecimiento(diaTipico.hoy.ganancia, diaTipico.tipico.ganancia)
    : crecimientoDeTotal(
        metricasActuales.gananciaBrutaVentas,
        metricasAnteriores.gananciaBrutaVentas,
        diasActual,
        diasAnterior,
      );
  // El ticket promedio es una MEDIA, no un total: se compara con el guard de
  // significancia, no con `calcularCrecimiento` pelado. Ver `crecimientoDeMedia`
  // — el −75% que mostraba este badge un martes era una media de 6 tickets con
  // un outlier de $204.700 contra una de 23, con un feriado adentro del tramo
  // de comparación. La cuenta estaba bien; la comparación no existía.
  // Con "hoy" la referencia son los tickets de esos mismos días típicos hasta
  // esta hora — juntos suman muestra suficiente, que es justo lo que un día
  // suelto no tenía.
  const crecimientoTicket = diaTipico
    ? crecimientoDeMedia(
        muestraDeTickets(diaTipico.hoy.tickets),
        muestraDeTickets(diaTipico.ticketsReferencia),
      )
    : crecimientoDeMedia(
        {
          media: metricasActuales.ticketPromedio,
          desvio: metricasActuales.ticketDesvio,
          n: metricasActuales.ordenes,
        },
        {
          media: metricasAnteriores.ticketPromedio,
          desvio: metricasAnteriores.ticketDesvio,
          n: metricasAnteriores.ordenes,
        },
      );

  // El gráfico SIGUE al selector desde el 13/10/2026 (pedido de Nacho): los
  // mismos dos rangos que las tarjetas, partidos en tramos (hora, día o
  // semana según el período). Antes era una ventana fija de 28 días porque
  // el selector usaba períodos de calendario ("esta semana" un martes = dos
  // puntos); hoy son ventanas móviles y cada período tiene siempre la misma
  // cantidad de barras. Ver `construirSerieComparada`.
  const serieChart = construirSerieComparada(ventasOperativas, periodo, hoy);
  // Con "hoy" la referencia es el día de la semana que sea hoy: "vs. martes
  // promedio". El nombre sale de la fecha, no de una tabla de strings.
  const nombreDelDia = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
  }).format(hoy);
  const etiquetaAnterior =
    periodo === "hoy"
      ? `${nombreDelDia} promedio`
      : ETIQUETA_PERIODO_ANTERIOR[periodo];
  const tituloComparacion = `vs. ${etiquetaAnterior}`;

  // Por qué un badge puede quedar sin número. Son dos casos distintos y el
  // tooltip los distingue: con "hoy", que todavía no haya otros días de esa
  // misma jornada; con el resto, que el tramo anterior tenga bastante menos
  // historia registrada (ver crecimientoDeTotal).
  const motivoSinComparacion = diaTipico
    ? `Todavía no hay otros ${nombreDelDia}s con qué comparar`
    : "El período anterior no tiene suficientes días con ventas para una comparación pareja";

  const quiebres = detectarQuiebresRotacion(
    ventasOperativas,
    productos,
    VENTANA_ROTACION_DIAS,
    hoy,
  );

  const categoriasFlat = categoriasResponse.data || [];
  const categoriasEnRiesgo = detectarCategoriasEnRiesgo(
    ventasOperativas,
    productos,
    VENTANA_ROTACION_DIAS,
    hoy,
  );
  const categoriaEnRiesgo = categoriasEnRiesgo[0];
  const categoriaEnRiesgoLabel = categoriaEnRiesgo
    ? resolverCategoriaDisplayLabel(
        categoriasFlat,
        categoriaEnRiesgo.categoriaId,
      )
    : "";

  const finDeTemporada = detectarFinDeTemporada(
    ventasOperativas,
    productos,
    categoriasFlat,
    metricasActuales.stockValorizadoCosto,
    VENTANA_ROTACION_DIAS,
    hoy,
  );
  const proximaTemporada = detectarProximaTemporada(
    productos,
    categoriasFlat,
    hoy,
  );

  // Advisor: mismo motor de siempre (getAdvisorInsights, sin tocar su
  // lógica de orden), extendido con las reglas nuevas — se activan solo si el
  // fetch correspondiente trajo datos. El CORTE ahora sí es de la superficie:
  // esta card pide 5 y el banner de /reportes se queda con 3.
  const insights = getAdvisorInsights(
    {
      ...metricasInsights,
      deudaVencida: deudaVencida ?? undefined,
      remitosPendientes:
        remitosPendientes && remitosPendientes.cantidad > 0
          ? remitosPendientes
          : undefined,
      categoriaEnRiesgo:
        categoriaEnRiesgo && categoriaEnRiesgoLabel
          ? {
              categoria: categoriaEnRiesgoLabel,
              unidadesVendidas: categoriaEnRiesgo.unidadesVendidas,
              diasCobertura: categoriaEnRiesgo.diasCobertura,
            }
          : undefined,
      finDeTemporada: finDeTemporada ?? undefined,
      proximaTemporada: proximaTemporada ?? undefined,
      // Días abiertos de la ventana de Insights (no la del selector): las
      // reglas de RITMO (cobertura de stock, día pico) lo necesitan para pasar
      // de un total a "por día".
      diasDelPeriodo: contarDiasConVentas(ventasOperativas, rangoInsights),
      metodoQuePierde: senales.metodoQuePierde ?? undefined,
      descuentosResignados: senales.descuentosResignados ?? undefined,
      renglonesSinCosto: senales.renglonesSinCosto ?? undefined,
      renglonAdicional: senales.renglonAdicional ?? undefined,
      momentoDelDia: senales.momentoDelDia ?? undefined,
      cuentaCorrienteDescuadrada:
        senales.cuentaCorrienteDescuadrada ?? undefined,
    },
    INSIGHTS_EN_PANEL,
  );

  const ventasDeHoy = ventasOperativas.filter((v) => {
    const f = new Date(v.fecha_venta);
    return (
      f.getDate() === hoy.getDate() &&
      f.getMonth() === hoy.getMonth() &&
      f.getFullYear() === hoy.getFullYear()
    );
  });
  // Elegidas en reloj comercial, pero se muestran las ORIGINALES: la hora que
  // se ve sale del formateador, que ya trabaja en hora argentina.
  const ventaOriginalPorId = new Map(ventasOriginales.map((v) => [v.id, v]));
  const ultimasVentas = ventasDeHoy
    .slice(0, 4)
    .map((v) => ventaOriginalPorId.get(v.id) ?? v);

  const reservasActivasRaw = (reservasResponse.data ||
    []) as unknown as ReservaActivaRow[];
  const reservasActivas = reservasActivasRaw.map((r) => {
    const producto = getSupabaseRelation(r.producto);
    const variante = getSupabaseRelation(r.variante);
    const cliente = getSupabaseRelation(r.cliente);
    const vendedora = getSupabaseRelation(r.vendedora);
    const horasActiva =
      (ahoraReal.getTime() - new Date(r.creado_en).getTime()) / (1000 * 3600);

    return {
      id: r.id,
      creadoEn: r.creado_en,
      nombreProducto: producto?.nombre || "Producto eliminado",
      varianteNombre: variante?.nombre_display || null,
      clienteNombre: cliente?.nombre || null,
      vendedoraNombre: vendedora?.nombre || null,
      vencida: horasActiva >= 24,
    };
  });

  const primerNombre =
    (perfilResponse?.data?.nombre as string | undefined)?.trim().split(/\s+/)[0] ?? null;

  return (
    // Acá había un <style> inyectado que pintaba la barra de scroll de gris
    // fijo con !important. Eso vivía en una página pero se aplicaba a toda la
    // app, y al ser un color fijo ignoraba el tema: en modo oscuro quedaba la
    // misma franja gris clara. Ahora sale de tokens en globals.css.
    <div className="flex flex-col gap-3 px-2 py-3 sm:px-3">
      {/* HEADER — saludo + fecha, y a la derecha el período. Vender, en
            compu, ya está siempre a la vista en el sidebar; en celular va en
            los botones de abajo. */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-1">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {primerNombre ? `Hola, ${primerNombre}` : "Hola"}
          </h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground first-letter:uppercase">
            {new Intl.DateTimeFormat("es-AR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(hoy)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodoSelector
            periodo={periodo}
            opciones={OPCIONES_PANEL}
            ariaLabel="Período del panel"
          />
        </div>
      </div>

      {/* GUÍA DE INICIO — arriba de todo mientras falte algo para vender, y
            se va sola cuando está completa (el estado es derivado, no un flag).
            Solo ADMIN: la RPC devuelve null para el resto. */}
      {/* Salteado: el panel de siempre, sin la guía encima. */}
      {estadoActivacion && !tutorialSalteado && <ChecklistActivacion estado={estadoActivacion} />}

      {/* ACCIONES — solo mobile: en desktop el POS está siempre a la vista en
            el sidebar, acá el menú está detrás de la hamburguesa y vender
            quedaba a dos toques. El gasto va al lado porque a este panel solo
            entra quien tiene permiso, y ese permiso implica poder anotarlo
            (sigue estando también en el modal de caja del navbar). */}
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        <Button asChild className="h-11 w-full">
          <Link href="/pos">
            <Plus className="mr-2 h-4 w-4" />
            Vender
          </Link>
        </Button>
        <EgresoModal triggerVariant="outline" triggerClassName="h-11 w-full" />
      </div>

      <Suspense fallback={<div className="h-32 animate-pulse rounded-xl bg-muted" aria-label="Cargando asociaciones del catálogo" />}>
        <ComplementosCatalogoSeccion compacto />
      </Suspense>

      {/* DOS COLUMNAS — contenido (números, ventas por día, stock y lo que
            rinde) y un aside con qué se vende (categorías) y qué atender
            (Comerz Intelligence). En celular se apilan: primero el contenido. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
          {/* NÚMEROS — cuatro tarjetas: título, variación arriba a la derecha
              y el número grande. */}
          <KpiFranja>
            <KpiMiniCard
              label="Vendiste"
              value={formatearMoneda(metricasActuales.ingresos)}
              variacion={
                <GrowthBadge
                  value={crecimientoIngresos}
                  titulo={tituloComparacion}
                  motivoSinDato={motivoSinComparacion}
                />
              }
            />
            <KpiMiniCard
              label="Ganancia"
              detalle={`${metricasActuales.margenPorcentaje.toFixed(0)}% de margen`}
              value={formatearMoneda(metricasActuales.gananciaBrutaVentas)}
              variacion={
                <GrowthBadge
                  value={crecimientoGanancia}
                  titulo={tituloComparacion}
                  motivoSinDato={motivoSinComparacion}
                />
              }
            />
            <KpiMiniCard
              label="Ticket promedio"
              detalle={`${metricasActuales.ordenes} ventas`}
              value={formatearMoneda(metricasActuales.ticketPromedio)}
              variacion={
                <GrowthBadge
                  value={crecimientoTicket}
                  titulo={tituloComparacion}
                  etiquetaSinValor="≈"
                  motivoSinDato="Sin cambio medible: con esta cantidad de tickets la diferencia no se distingue del ruido"
                />
              }
            />
            <KpiMiniCard
              label="Unidades vendidas"
              value={String(metricasActuales.unidadesVendidas)}
              variacion={
                <GrowthBadge
                  value={crecimientoUnidades}
                  titulo={tituloComparacion}
                  motivoSinDato={motivoSinComparacion}
                />
              }
            />
          </KpiFranja>

          <VentasPeriodoChart
            serie={serieChart}
            etiquetaTramo={ETIQUETA_TRAMO[periodo]}
            // "Año" grafica 12 meses enteros, no los 364 días de las tarjetas
            // (ver `resolverRangosChart`).
            etiquetaPeriodo={periodo === "anio" ? "últimos 12 meses" : ETIQUETA_PERIODO[periodo]}
            etiquetaAnterior={periodo === "hoy" ? `${nombreDelDia} pasado` : ETIQUETA_PERIODO_ANTERIOR[periodo]}
          />

          {/* Stock que pide algo y lo que más rinde / últimas ventas. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:h-[300px]">
            <div className="min-h-[280px] min-w-0 md:min-h-0">
              <AtencionRequeridaCard
                quiebres={quiebres}
                ventanaQuiebreDias={VENTANA_ROTACION_DIAS}
                stockCritico={metricasActuales.stockCriticoDetallado}
                cantidadBajasPendientes={cantidadBajasPendientes}
                reservasActivas={reservasActivas}
                mostrarReservas={rubroUsaReservas(
                  normalizarRubro(configResponse?.rubro),
                )}
              />
            </div>
            <div className="min-h-[280px] min-w-0 md:min-h-0">
              <RendimientoCard
                topProductos={metricasRanking.topProductos}
                topProductosRentables={metricasRanking.topProductosRentables}
                etiquetaRanking={ETIQUETA_RANKING[periodo]}
                ultimasVentas={ultimasVentas}
                cantidadVentasHoy={ventasDeHoy.length}
              />
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <VentasPorCategoria
            categorias={metricasActuales.ventasPorCategoria}
            etiquetaPeriodo={ETIQUETA_PERIODO[periodo]}
          />
          <div className="min-w-0 flex-1">
            <AdvisorMiniList insights={insights} />
          </div>
        </aside>
      </div>
    </div>
  );
}
