import {
  etiquetaRubro,
  type Reparto,
  type ResumenGlobal,
} from "@/features/admin/lib/metricas-globales";
import { ETIQUETA_ESTADO } from "@/shared/lib/estado-negocio";
import { formatearMoneda } from "@/shared/utils/formatters";

const numero = (n: number) => n.toLocaleString("es-AR");

function Tarjeta({
  titulo,
  valor,
  detalle,
  destacada = false,
}: Readonly<{
  titulo: string;
  valor: string;
  detalle?: string;
  destacada?: boolean;
}>) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-white/35">
        {titulo}
      </p>
      <p
        className={`mt-1 font-semibold tracking-tight text-white ${
          destacada ? "text-3xl" : "text-xl"
        }`}
      >
        {valor}
      </p>
      {detalle && (
        <p className="mt-1 text-[11px] leading-snug text-white/35">{detalle}</p>
      )}
    </div>
  );
}

function Seccion({
  titulo,
  detalle,
  children,
}: Readonly<{ titulo: string; detalle?: string; children: React.ReactNode }>) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-white/90">{titulo}</h2>
        {detalle && <p className="text-xs text-white/40">{detalle}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Un reparto como barras apiladas horizontales + lista con porcentaje. Sin
 * torta: con 4 o 5 categorías, dos porciones parecidas no se distinguen y el
 * número hay que leerlo igual.
 */
function BarrasReparto({
  reparto,
  colores,
}: Readonly<{ reparto: Reparto[]; colores: string[] }>) {
  const conAlgo = reparto.filter((r) => r.cantidad > 0);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      {conAlgo.length > 0 ? (
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/5">
          {conAlgo.map((r, i) => (
            <div
              key={r.clave}
              title={`${r.etiqueta}: ${r.cantidad} (${r.porcentaje}%)`}
              className={colores[i % colores.length]}
              style={{ width: `${r.porcentaje}%` }}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-white/30">Sin datos.</p>
      )}
      <ul className="mt-3 space-y-1.5">
        {reparto.map((r) => (
          <li
            key={r.clave}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="flex items-center gap-2 text-white/80">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  r.cantidad > 0
                    ? colores[conAlgo.indexOf(r) % colores.length]
                    : "bg-white/15"
                }`}
              />
              {r.etiqueta}
            </span>
            <span className="font-mono text-xs text-white/60">
              {r.cantidad}
              <span className="ml-2 inline-block w-12 text-right text-white/35">
                {r.porcentaje}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const COLORES_PLAN = [
  "bg-emerald-400",
  "bg-sky-400",
  "bg-violet-400",
  "bg-amber-400",
  "bg-rose-400",
];
const COLORES_RUBRO = [
  "bg-sky-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-violet-400",
  "bg-rose-400",
  "bg-teal-400",
  "bg-orange-400",
];

/** Barras de ventas por mes, SVG a mano: son 12 meses. Mismo criterio que
 * `MrrChart`. */
function VentasPorMes({
  serie,
}: Readonly<{ serie: ResumenGlobal["ventasPorMes"] }>) {
  if (serie.length === 0) {
    return <p className="text-xs text-white/30">Todavía no hay ventas.</p>;
  }
  const maximo = Math.max(...serie.map((p) => p.ventas), 1);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="flex h-36 items-end gap-2">
        {serie.map((p) => (
          <div
            key={p.mes}
            className="group relative flex flex-1 flex-col items-center justify-end"
            title={`${p.mes}: ${numero(p.ventas)} ventas · ${formatearMoneda(p.facturado)}`}
          >
            <span className="mb-1 font-mono text-[10px] text-white/50">
              {numero(p.ventas)}
            </span>
            <div
              className="w-full rounded-t bg-sky-400/80 transition-colors group-hover:bg-sky-300"
              style={{ height: `${Math.max(2, (p.ventas / maximo) * 100)}%` }}
            />
            <span className="mt-1 font-mono text-[10px] text-white/35">
              {p.mes.slice(5)}/{p.mes.slice(2, 4)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MetricasGlobalesPanel({
  resumen,
}: Readonly<{ resumen: ResumenGlobal }>) {
  const { locales, ventas, usuarios, catalogo } = resumen;

  return (
    <div className="space-y-8">
      <Seccion
        titulo="Locales"
        detalle="Cliente = activo o en prueba. Los cancelados y los demo se cuentan aparte y no entran en ningún porcentaje ni total."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tarjeta
            titulo="Total"
            valor={numero(locales.total)}
            detalle={`${locales.clientes} clientes · ${locales.inactivos} inactivos · ${locales.demos} demo`}
            destacada
          />
          <Tarjeta
            titulo="Activos"
            valor={numero(locales.activos)}
            detalle={`MRR ${formatearMoneda(resumen.mrr)} a precio de lista`}
            destacada
          />
          <Tarjeta
            titulo="En prueba"
            valor={numero(locales.enPrueba)}
            detalle="dentro de sus 14 días"
            destacada
          />
          <Tarjeta
            titulo="Inactivos"
            valor={numero(locales.inactivos)}
            detalle="suspendidos o cancelados"
          />
          <Tarjeta titulo="Demo" valor={numero(locales.demos)} detalle="fuera de las métricas" />
        </div>
      </Seccion>

      <div className="grid gap-6 lg:grid-cols-2">
        <Seccion
          titulo="Planes"
          detalle={`Sobre los ${locales.clientes} clientes (activos y en prueba).`}
        >
          <BarrasReparto reparto={resumen.planes} colores={COLORES_PLAN} />
        </Seccion>
        <Seccion titulo="Rubros" detalle="Rubro comercial de los clientes: a quién le vendemos.">
          <BarrasReparto reparto={resumen.rubros} colores={COLORES_RUBRO} />
        </Seccion>
      </div>

      <Seccion
        titulo="Ventas"
        detalle="Ventas de los clientes, sin anuladas. No cuentan las de cancelados ni demo."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta
            titulo="Ventas históricas"
            valor={numero(ventas.cantidad)}
            detalle={`${formatearMoneda(ventas.monto)} facturados`}
            destacada
          />
          <Tarjeta
            titulo="Últimos 30 días"
            valor={numero(ventas.cantidad30d)}
            detalle={`${formatearMoneda(ventas.monto30d)}`}
            destacada
          />
          <Tarjeta
            titulo="Ticket promedio"
            valor={
              ventas.ticketPromedio === null
                ? "—"
                : formatearMoneda(Math.round(ventas.ticketPromedio))
            }
            detalle="histórico, todos los rubros juntos"
          />
          <Tarjeta
            titulo="Locales vendiendo"
            valor={`${ventas.negociosVendiendo30d} / ${locales.clientes}`}
            detalle="con al menos una venta en 30 días"
          />
        </div>
        <VentasPorMes serie={resumen.ventasPorMes} />
        {ventas.negociosSinVender30d.length > 0 && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4">
            <p className="text-xs font-semibold text-amber-300">
              {ventas.negociosSinVender30d.length} habilitado
              {ventas.negociosSinVender30d.length > 1 ? "s" : ""} sin vender en
              30 días
            </p>
            <p className="mt-1 text-xs text-white/50">
              {ventas.negociosSinVender30d
                .map((n) => `${n.nombre} (${ETIQUETA_ESTADO[n.estado] ?? n.estado})`)
                .join(" · ")}
            </p>
          </div>
        )}
      </Seccion>

      <div className="grid gap-6 lg:grid-cols-2">
        <Seccion
          titulo="Usuarios"
          detalle="Personas con acceso a algún cliente. Activo = inició sesión o refrescó el token."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Tarjeta titulo="Total" valor={numero(usuarios.total)} destacada />
            <Tarjeta
              titulo="Activos 7 días"
              valor={numero(usuarios.activos_7d)}
              destacada
            />
            <Tarjeta
              titulo="Activos 30 días"
              valor={numero(usuarios.activos_30d)}
              detalle={`${usuarios.porcentajeActivos30d}% del total`}
              destacada
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(usuarios.por_rol)
              .sort((a, b) => b[1] - a[1])
              .map(([rol, n]) => (
                <span
                  key={rol}
                  className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60"
                >
                  {rol.toLowerCase()}: <span className="text-white/90">{n}</span>
                </span>
              ))}
          </div>
        </Seccion>

        <Seccion titulo="Catálogo y clientes" detalle="Volumen cargado por los clientes.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Tarjeta
              titulo="Productos"
              valor={numero(catalogo.productos)}
              detalle={
                catalogo.productosPorNegocio === null
                  ? undefined
                  : `~${numero(catalogo.productosPorNegocio)} por local · ${numero(catalogo.variantes)} variantes`
              }
              destacada
            />
            <Tarjeta
              titulo="Clientes de los locales"
              valor={numero(catalogo.clientes)}
              detalle={`${formatearMoneda(catalogo.deuda_cc_viva)} de cuenta corriente viva`}
              destacada
            />
          </div>
        </Seccion>
      </div>

      <Seccion
        titulo="Por local"
        detalle="Solo clientes, ordenados por lo facturado desde que existen."
      >
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-white/35">
              <tr>
                <th className="px-3 py-2 font-medium">Local</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Rubro</th>
                <th className="px-3 py-2 text-right font-medium">Usuarios</th>
                <th className="px-3 py-2 text-right font-medium">Productos</th>
                <th className="px-3 py-2 text-right font-medium">Ventas</th>
                <th className="px-3 py-2 text-right font-medium">Facturado</th>
                <th className="px-3 py-2 text-right font-medium">30 días</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {resumen.ranking.map((n) => (
                <tr key={n.id} className="text-white/80">
                  <td className="px-3 py-2 font-medium text-white">{n.nombre}</td>
                  <td className="px-3 py-2 text-white/60">
                    {ETIQUETA_ESTADO[n.estado] ?? n.estado}
                  </td>
                  <td className="px-3 py-2 text-white/60">{n.plan_nombre ?? "—"}</td>
                  <td className="px-3 py-2 text-white/60">{etiquetaRubro(n.rubro)}</td>
                  <td className="px-3 py-2 text-right font-mono">{numero(n.usuarios)}</td>
                  <td className="px-3 py-2 text-right font-mono">{numero(n.productos)}</td>
                  <td className="px-3 py-2 text-right font-mono">{numero(n.ventas)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatearMoneda(n.facturado)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-white/60">
                    {numero(n.ventas_30d)} · {formatearMoneda(n.facturado_30d)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Seccion>
    </div>
  );
}
