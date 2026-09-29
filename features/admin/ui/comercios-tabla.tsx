"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
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

/** Barra de consumo de un límite. El track es un paso más claro del mismo
 * color que el fill, no un gris: así el estado se lee a lo largo de toda la
 * barra y no solo en la parte llena. */
function Medidor({
  usado,
  limite,
}: Readonly<{ usado: number; limite: number | null }>) {
  if (limite === null) {
    return (
      <span className="font-mono text-xs tabular-nums text-white/50">
        {usado} <span className="text-white/25">/ ∞</span>
      </span>
    );
  }

  const proporcion = Math.min(1, usado / limite);
  const lleno = usado >= limite;
  const cerca = !lleno && proporcion >= 0.8;

  return (
    // `max-w-full` para que en la grilla de 3 de la tarjeta mobile se achique
    // en vez de desbordar; en la tabla sigue midiendo los mismos 96px.
    <div className="w-24 max-w-full">
      <span
        className={`font-mono text-xs tabular-nums ${
          lleno ? "text-amber-400" : "text-white/60"
        }`}
      >
        {usado} <span className="text-white/25">/ {limite}</span>
      </span>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-primary/15">
        <div
          className={`h-full rounded-full ${
            lleno ? "bg-amber-400" : cerca ? "bg-amber-400/70" : "bg-primary"
          }`}
          style={{ width: `${proporcion * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * El mismo medidor con su nombre encima. Solo lo usa la tarjeta de mobile: en
 * la tabla el rótulo lo pone el `<th>`, acá no hay encabezado del que colgarse.
 */
function MedidorRotulado({
  rotulo,
  usado,
  limite,
}: Readonly<{ rotulo: string; usado: number; limite: number | null }>) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] uppercase tracking-wider text-white/40">
        {rotulo}
      </p>
      <div className="mt-0.5">
        <Medidor usado={usado} limite={limite} />
      </div>
    </div>
  );
}

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

/**
 * Los comercios, con sus límites y su actividad a la vista.
 *
 * Los medidores están acá y no escondidos en un detalle porque son la señal de
 * upgrade: un comercio en 48 de 50 clientes es una conversación pendiente, y si
 * hay que abrir tres pantallas para verlo, no se ve nunca. La actividad de 7
 * días está por el motivo opuesto: es la señal de baja.
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

  // Las opciones salen de los datos y no de una lista fija: si mañana hay un
  // rubro nuevo aparece solo, y no se ofrece filtrar por uno que no tiene
  // ningún comercio.
  const rubros = useMemo(
    () =>
      [
        ...new Set(comercios.map((c) => c.rubro).filter(Boolean)),
      ].sort() as string[],
    [comercios],
  );
  const estados = useMemo(
    () => [...new Set(comercios.map((c) => c.estado))].sort(),
    [comercios],
  );

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return comercios.filter((c) => {
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
      if (actividad === "activos" && c.ventas7d === 0) return false;
      if (actividad === "sin_ventas" && c.ventas7d > 0) return false;
      if (actividad === "vencidos" && !c.vencido) return false;

      return true;
    });
  }, [comercios, busqueda, estado, rubro, actividad]);

  const hayFiltros =
    busqueda !== "" ||
    estado !== TODOS ||
    rubro !== TODOS ||
    actividad !== TODOS;

  const limpiar = () => {
    setBusqueda("");
    setEstado(TODOS);
    setRubro(TODOS);
    setActividad(TODOS);
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
          etiqueta="Rubro"
          valor={rubro}
          onChange={setRubro}
          opciones={rubros.map((r) => ({ valor: r, texto: etiquetaDeRubro(r) }))}
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
          {filtrados.length !== comercios.length && ` de ${comercios.length}`}
        </span>
      </div>

      {/* MOBILE: una tarjeta por comercio.
          La tabla tiene 9 columnas y en un celular solo se veían las dos
          primeras; el resto había que arrastrarlo, y los medidores —que son
          justamente la señal de upgrade— quedaban del lado invisible. En
          tarjeta entra todo sin scroll lateral. */}
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

            {/* Los tres medidores en fila: son el dato que decide si hay una
                conversación de upgrade pendiente. */}
            <div className="mt-3 grid grid-cols-3 gap-3">
              <MedidorRotulado
                rotulo="Usuarios"
                usado={c.usuarios}
                limite={c.maxUsuarios}
              />
              <MedidorRotulado
                rotulo="Cta. cte."
                usado={c.clientesCuentaCorriente}
                limite={c.maxClientesCuentaCorriente}
              />
              <MedidorRotulado
                rotulo="Productos"
                usado={c.productos}
                limite={c.maxProductos}
              />
            </div>
          </div>
        ))}

        {filtrados.length === 0 && <Vacio hayFiltros={hayFiltros} />}
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
                <th className="px-4 py-3 font-semibold">Usuarios</th>
                <th className="px-4 py-3 font-semibold">Cta. corriente</th>
                <th className="px-4 py-3 font-semibold">Productos</th>
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

                  <td className="px-4 py-3">
                    <Medidor usado={c.usuarios} limite={c.maxUsuarios} />
                  </td>
                  <td className="px-4 py-3">
                    <Medidor
                      usado={c.clientesCuentaCorriente}
                      limite={c.maxClientesCuentaCorriente}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Medidor usado={c.productos} limite={c.maxProductos} />
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
                  <td colSpan={11} className="px-4 py-10 text-center">
                    <Vacio hayFiltros={hayFiltros} />
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
function Vacio({ hayFiltros }: Readonly<{ hayFiltros: boolean }>) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center text-sm text-white/40 md:border-0 md:bg-transparent md:p-0">
      {hayFiltros
        ? "Ningún comercio coincide con la búsqueda."
        : "Todavía no hay comercios."}
    </div>
  );
}
