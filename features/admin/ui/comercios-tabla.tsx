"use client";

import { useMemo, useState } from "react";
import { Archive, ExternalLink, Search, X } from "lucide-react";
import {
  AccionesComercioMenu,
  type PlanOpcion,
} from "./acciones-comercio-menu";
import { formatearMoneda } from "@/shared/utils/formatters";
import type { ComercioConUso } from "@/features/admin/actions/comercios-con-uso";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { CLASE_PORTAL_OSCURO } from "@/features/admin/lib/tema-portal";
import { ETIQUETA_RUBRO } from "@/features/stock/lib/columnas-por-rubro";
import { normalizarRubro } from "@/entities/config/types";
import {
  BotonWhatsapp,
  CeldaAcceso,
  CeldaOnboarding,
} from "./celda-onboarding";

const ESTADO_COLOR: Record<string, string> = {
  activo: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  // Azul y no verde: en prueba todavía no pagó, y un verde lo haría pasar
  // por cliente cuando es un candidato.
  prueba: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  // Violeta: ni verde (no paga) ni azul (no es candidato). Un color propio es
  // lo que evita confundir el comercio de muestra con uno real de un vistazo.
  demo: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  suspendido: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  // 'cancelado' es el nombre real del estado de baja en la base. La clave acá
  // decía 'baja', que no existe, así que el único estado apagado caía al
  // fallback — funcionaba de casualidad, con el color correcto por accidente.
  cancelado: "bg-white/5 text-white/40 border-white/10",
};

/** Para un estado que todavía no tenga color propio. Apagado a propósito: un
 * estado desconocido no se pinta como si fuera bueno. */
const ESTADO_COLOR_DEFECTO = "bg-white/5 text-white/40 border-white/10";

/**
 * La actividad de la última semana.
 *
 * Cero ventas se marca en ámbar y no en gris: un comercio que no vendió en
 * siete días es lo que hay que mirar en esta columna, no el ruido de fondo.
 * Un comercio recién dado de alta también cae ahí, y también hay que mirarlo.
 */
function Actividad({
  ventas,
  monto,
}: Readonly<{ ventas: number; monto: number }>) {
  if (ventas === 0) {
    return <span className="text-xs text-amber-400/80">sin ventas</span>;
  }

  return (
    <div>
      <span className="font-mono text-xs tabular-nums text-white/70">
        {ventas} {ventas === 1 ? "venta" : "ventas"}
      </span>
      <p className="font-mono text-[11px] tabular-nums text-white/35">
        {formatearMoneda(monto)}
      </p>
    </div>
  );
}

const TODOS = "todos";
/** Valor del filtro de plan para los comercios sin plan asignado. */
const SIN_PLAN = "sin_plan";
/** El estado de baja en la base. No se borra: va a "Descartados". */
const CANCELADO = "cancelado";

/**
 * Los comercios, con su plan y su actividad a la vista. La actividad de 7 días
 * es la señal de baja.
 *
 * Los cancelados NO están en la tabla principal: son ruido para el día a día,
 * pero no se borran (tienen historia, pagos y pueden volver). Se ven con el
 * botón "Descartados", que muestra solo esos.
 *
 * El filtrado es todo en el cliente: son decenas de comercios, no miles, y
 * hacerlo en la base sería un viaje de red por cada letra tipeada.
 */
export function ComerciosTabla({
  comercios,
  planes,
}: Readonly<{ comercios: ComercioConUso[]; planes: PlanOpcion[] }>) {
  const [busqueda, setBusqueda] = useState("");
  // El dato que llega es el rubro OPERATIVO crudo de `configuracion_pos`
  // ("cotillon", "quioscos"), que es cómo lo guarda la base. Acá se muestra
  // con su nombre: la tabla la lee una persona, no el parser.
  const etiquetaDeRubro = (valor: string | null) =>
    valor ? ETIQUETA_RUBRO[normalizarRubro(valor)] : "";
  const [estado, setEstado] = useState(TODOS);
  const [rubro, setRubro] = useState(TODOS);
  const [actividad, setActividad] = useState(TODOS);
  const [plan, setPlan] = useState(TODOS);
  const [verDescartados, setVerDescartados] = useState(false);

  const cantidadDescartados = useMemo(
    () => comercios.filter((c) => c.estado === CANCELADO).length,
    [comercios],
  );
  // La vista elegida: los vigentes o solo los cancelados. Los filtros y sus
  // opciones salen de acá, así no se ofrece filtrar por algo que la vista no
  // tiene.
  const enVista = useMemo(
    () =>
      comercios.filter((c) =>
        verDescartados ? c.estado === CANCELADO : c.estado !== CANCELADO,
      ),
    [comercios, verDescartados],
  );

  // Las opciones salen de los datos y no de una lista fija: si mañana hay un
  // rubro nuevo aparece solo, y no se ofrece filtrar por uno que no tiene
  // ningún comercio.
  const rubros = useMemo(
    () =>
      [
        ...new Set(enVista.map((c) => c.rubro).filter(Boolean)),
      ].sort() as string[],
    [enVista],
  );
  const estados = useMemo(
    () => [...new Set(enVista.map((c) => c.estado))].sort(),
    [enVista],
  );
  // Los planes que tiene algún comercio de la vista, por id (dos planes
  // pueden llamarse parecido), más "Sin plan" si hay alguno sin asignar.
  const planesEnUso = useMemo(() => {
    const porId = new Map<string, string>();
    let haySinPlan = false;
    for (const c of enVista) {
      if (c.plan_id) porId.set(c.plan_id, c.plan_nombre ?? c.plan_id);
      else haySinPlan = true;
    }
    const opciones = [...porId]
      .map(([valor, texto]) => ({ valor, texto }))
      .sort((a, b) => a.texto.localeCompare(b.texto, "es"));
    if (haySinPlan) opciones.push({ valor: SIN_PLAN, texto: "Sin plan" });
    return opciones;
  }, [enVista]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return enVista.filter((c) => {
      // Nombre, slug y mail del dueño: los tres son formas legítimas de buscar
      // un comercio, y cuál recordás depende de por dónde llegaste.
      const coincide =
        q === "" ||
        c.nombre.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        (c.duenio ?? "").toLowerCase().includes(q);

      if (!coincide) return false;
      if (estado !== TODOS && c.estado !== estado) return false;
      if (rubro !== TODOS && c.rubro !== rubro) return false;
      if (plan === SIN_PLAN && c.plan_id) return false;
      if (plan !== TODOS && plan !== SIN_PLAN && c.plan_id !== plan)
        return false;
      if (actividad === "activos" && c.ventas7d === 0) return false;
      if (actividad === "sin_ventas" && c.ventas7d > 0) return false;
      if (actividad === "vencidos" && !c.vencido) return false;

      return true;
    });
  }, [enVista, busqueda, estado, rubro, plan, actividad]);

  const hayFiltros =
    busqueda !== "" ||
    estado !== TODOS ||
    rubro !== TODOS ||
    plan !== TODOS ||
    actividad !== TODOS;

  const limpiar = () => {
    setBusqueda("");
    setEstado(TODOS);
    setRubro(TODOS);
    setPlan(TODOS);
    setActividad(TODOS);
  };

  // Cambiar de vista limpia los filtros: un estado o un plan elegido en una
  // puede no existir en la otra y dejaría la tabla vacía sin motivo visible.
  const alternarDescartados = () => {
    limpiar();
    setVerDescartados((v) => !v);
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, slug o dueño…"
            aria-label="Buscar comercio"
            className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] pl-8 pr-3 text-sm text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none"
          />
        </div>

        <Filtro
          etiqueta="Estado"
          valor={estado}
          onChange={setEstado}
          opciones={estados.map((e) => ({ valor: e, texto: e }))}
        />
        <Filtro
          etiqueta="Plan"
          valor={plan}
          onChange={setPlan}
          opciones={planesEnUso}
        />
        <Filtro
          etiqueta="Rubro"
          valor={rubro}
          onChange={setRubro}
          opciones={rubros.map((r) => ({
            valor: r,
            texto: etiquetaDeRubro(r),
          }))}
        />
        <Filtro
          etiqueta="Actividad"
          valor={actividad}
          onChange={setActividad}
          opciones={[
            { valor: "activos", texto: "Con ventas (7 días)" },
            { valor: "sin_ventas", texto: "Sin ventas (7 días)" },
            { valor: "vencidos", texto: "Plan vencido" },
          ]}
        />

        {hayFiltros && (
          <button
            type="button"
            onClick={limpiar}
            className="flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs text-white/50 hover:text-white"
          >
            <X className="size-3" />
            Limpiar
          </button>
        )}

        <span className="ml-auto shrink-0 text-xs text-white/35">
          {filtrados.length}
          {filtrados.length !== enVista.length && ` de ${enVista.length}`}
        </span>

        {(cantidadDescartados > 0 || verDescartados) && (
          <button
            type="button"
            onClick={alternarDescartados}
            aria-pressed={verDescartados}
            className={`flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs ${
              verDescartados
                ? "border-primary/40 text-white"
                : "border-white/10 text-white/50 hover:text-white"
            }`}
          >
            {verDescartados ? (
              <>
                <X className="size-3" />
                Volver a vigentes
              </>
            ) : (
              <>
                <Archive className="size-3" />
                Descartados ({cantidadDescartados})
              </>
            )}
          </button>
        )}
      </div>

      {/* MOBILE: una tarjeta por comercio.
          La tabla tiene 8 columnas y en un celular solo se veían las dos
          primeras; el resto había que arrastrarlo. En tarjeta entra todo sin
          scroll lateral. */}
      <div className="space-y-2 md:hidden">
        {filtrados.map((c) => (
          <div
            key={c.id}
            className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white/90">{c.nombre}</span>
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                      ESTADO_COLOR[c.estado] ?? ESTADO_COLOR_DEFECTO
                    }`}
                  >
                    {c.estado}
                  </span>
                  {c.rubro && (
                    <span className="text-[10px] uppercase tracking-wider text-white/30">
                      {etiquetaDeRubro(c.rubro)}
                    </span>
                  )}
                </div>
                <a
                  href={`https://${c.slug}.comerz.app`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-xs text-white/35 hover:text-white/60"
                >
                  {c.slug}
                  <ExternalLink className="size-2.5" />
                </a>
                {c.duenio && (
                  <p className="text-[11px] text-white/25">{c.duenio}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <BotonWhatsapp whatsapp={c.whatsapp} nombre={c.nombre} />
                <AccionesComercioMenu
                  negocioId={c.id}
                  nombre={c.nombre}
                  slug={c.slug}
                  estado={c.estado}
                  planId={c.plan_id}
                  planVencimiento={c.plan_vencimiento}
                  planes={planes}
                  moduloPresupuestos={c.moduloPresupuestos}
                />
              </div>
            </div>

            <div className="mt-2">
              <CeldaAcceso
                acceso={c.acceso}
                ultimaActividad={c.ultimaActividad}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-white/[0.06] pt-3 text-xs">
              <span className="text-white/80">
                {c.plan_nombre ?? "Sin plan"}
                {c.plan_precio > 0 && (
                  <span className="ml-1 font-mono text-white/35 tabular-nums">
                    {formatearMoneda(c.plan_precio)}
                  </span>
                )}
              </span>
              {c.plan_vencimiento && (
                <span
                  className={`font-mono tabular-nums ${
                    c.vencido ? "text-rose-400" : "text-white/40"
                  }`}
                >
                  vence{" "}
                  {new Date(c.plan_vencimiento).toLocaleDateString("es-AR", {
                    timeZone: "UTC",
                  })}
                </span>
              )}
              <span className="ml-auto flex items-center gap-3">
                <CeldaOnboarding onboarding={c.onboarding} />
                <Actividad ventas={c.ventas7d} monto={c.monto7d} />
              </span>
            </div>
          </div>
        ))}

        {filtrados.length === 0 && (
          <Vacio hayFiltros={hayFiltros} verDescartados={verDescartados} />
        )}
      </div>

      {/* DESKTOP: la tabla. */}
      <div className="hidden overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-[10px] uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3 font-semibold">Comercio</th>
                <th className="px-4 py-3 font-semibold">Rubro</th>
                <th className="px-4 py-3 font-semibold">Plan</th>
                <th className="px-4 py-3 font-semibold">Vence</th>
                <th className="px-4 py-3 font-semibold">Acceso</th>
                <th className="px-4 py-3 font-semibold">Onboarding</th>
                <th className="px-4 py-3 font-semibold">7 días</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filtrados.map((c) => (
                <tr key={c.id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white/90">
                        {c.nombre}
                      </span>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                          ESTADO_COLOR[c.estado] ?? ESTADO_COLOR_DEFECTO
                        }`}
                      >
                        {c.estado}
                      </span>
                    </div>
                    <a
                      href={`https://${c.slug}.comerz.app`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-xs text-white/35 hover:text-white/60"
                    >
                      {c.slug}
                      <ExternalLink className="size-2.5" />
                    </a>
                    {c.duenio && (
                      <p className="text-[11px] text-white/25">{c.duenio}</p>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <span className="text-xs capitalize text-white/60">
                      {c.rubro ?? "—"}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <p className="text-white/80">
                      {c.plan_nombre ?? "Sin plan"}
                    </p>
                    {c.plan_precio > 0 && (
                      <p className="font-mono text-[11px] text-white/35 tabular-nums">
                        {formatearMoneda(c.plan_precio)}
                      </p>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {c.plan_vencimiento ? (
                      <span
                        className={`font-mono text-xs tabular-nums ${
                          c.vencido ? "text-rose-400" : "text-white/60"
                        }`}
                      >
                        {new Date(c.plan_vencimiento).toLocaleDateString(
                          "es-AR",
                          { timeZone: "UTC" },
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-white/25">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <CeldaAcceso
                      acceso={c.acceso}
                      ultimaActividad={c.ultimaActividad}
                    />
                  </td>

                  <td className="px-4 py-3">
                    <CeldaOnboarding onboarding={c.onboarding} />
                  </td>

                  <td className="px-4 py-3">
                    <Actividad ventas={c.ventas7d} monto={c.monto7d} />
                  </td>

                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <BotonWhatsapp whatsapp={c.whatsapp} nombre={c.nombre} />
                      <AccionesComercioMenu
                        negocioId={c.id}
                        nombre={c.nombre}
                        slug={c.slug}
                        estado={c.estado}
                        planId={c.plan_id}
                        planVencimiento={c.plan_vencimiento}
                        planes={planes}
                        moduloPresupuestos={c.moduloPresupuestos}
                      />
                    </div>
                  </td>
                </tr>
              ))}

              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center">
                    <Vacio
                      hayFiltros={hayFiltros}
                      verDescartados={verDescartados}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/**
 * Un filtro de la barra. Usa el Select de shadcn y no un `<select>` nativo: el
 * nativo se ve distinto en cada sistema y su lista desplegable no toma el
 * tema, así que en el panel oscuro aparecía blanca.
 *
 * El trigger lleva estilos propios y no los del Select por defecto porque acá
 * es un chip de barra, no un campo de formulario: más bajo, sin etiqueta
 * arriba y con el borde marcado cuando está aplicado.
 */
function Filtro({
  etiqueta,
  valor,
  onChange,
  opciones,
}: Readonly<{
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  opciones: { valor: string; texto: string }[];
}>) {
  if (opciones.length === 0) return null;

  const aplicado = valor !== TODOS;

  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger
        aria-label={etiqueta}
        className={`h-9 w-auto shrink-0 gap-1.5 border bg-white/[0.03] px-2.5 text-xs capitalize ${
          aplicado
            ? "border-primary/40 text-white"
            : "border-white/10 text-white/50"
        }`}
      >
        {/* Con un filtro puesto muestra el valor; sin filtro, el nombre de la
            columna. Así la barra dice qué se PUEDE filtrar cuando está limpia
            y qué está filtrado cuando no. */}
        <SelectValue placeholder={etiqueta}>
          {aplicado ? textoDe(opciones, valor) : etiqueta}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className={CLASE_PORTAL_OSCURO}>
        <SelectItem value={TODOS}>{etiqueta}: todos</SelectItem>
        {opciones.map((o) => (
          <SelectItem key={o.valor} value={o.valor} className="capitalize">
            {o.texto}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const textoDe = (opciones: { valor: string; texto: string }[], valor: string) =>
  opciones.find((o) => o.valor === valor)?.texto ?? valor;

/** Distingue "no hay comercios" de "no hay resultados": son dos situaciones
 * distintas y la segunda tiene solución. */
function Vacio({
  hayFiltros,
  verDescartados,
}: Readonly<{ hayFiltros: boolean; verDescartados: boolean }>) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center text-sm text-white/40 md:border-0 md:bg-transparent md:p-0">
      {hayFiltros
        ? "Ningún comercio coincide con la búsqueda."
        : verDescartados
          ? "No hay comercios descartados."
          : "Todavía no hay comercios."}
    </div>
  );
}
