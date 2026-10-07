import type { ResumenPedidosCatalogo } from "@/features/admin/lib/pedidos-catalogo";
import { etiquetaRubro } from "@/features/admin/lib/metricas-globales";
import { ETIQUETA_ESTADO } from "@/shared/lib/estado-negocio";
import { formatearFechaHora, formatearMoneda } from "@/shared/utils/formatters";

const numero = (n: number) => n.toLocaleString("es-AR");

function Tarjeta({
  titulo,
  valor,
  detalle,
}: Readonly<{ titulo: string; valor: string; detalle?: string }>) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-white/35">
        {titulo}
      </p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-white">{valor}</p>
      {detalle && (
        <p className="mt-1 text-[11px] leading-snug text-white/35">{detalle}</p>
      )}
    </div>
  );
}

function Reparto({
  titulo,
  filas,
}: Readonly<{
  titulo: string;
  filas: { clave: string; etiqueta: string; cantidad: number }[];
}>) {
  const total = filas.reduce((s, f) => s + f.cantidad, 0);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-white/35">
        {titulo}
      </p>
      {filas.length === 0 ? (
        <p className="mt-2 text-xs text-white/30">Sin pedidos en 30 días.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {filas.map((f) => (
            <li key={f.clave} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-white/80">{f.etiqueta}</span>
              <span className="shrink-0 font-mono text-xs text-white/60">
                {f.cantidad}
                <span className="ml-2 inline-block w-12 text-right text-white/35">
                  {total > 0 ? Math.round((f.cantidad / total) * 100) : 0}%
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pedidos por día de los últimos 30 días. SVG a mano, igual que las otras
 * series del admin. */
function PorDia({ serie }: Readonly<{ serie: ResumenPedidosCatalogo["porDia"] }>) {
  if (serie.length === 0) return null;
  const maximo = Math.max(...serie.map((d) => d.pedidos), 1);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="flex h-28 items-end gap-1">
        {serie.map((d) => (
          <div
            key={d.dia}
            className="flex flex-1 flex-col items-center justify-end"
            title={`${d.dia}: ${d.pedidos} pedidos · ${formatearMoneda(d.monto)}`}
          >
            <div
              className="w-full rounded-t bg-emerald-400/80"
              style={{ height: `${Math.max(3, (d.pedidos / maximo) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] text-white/35">
        {serie[0].dia.slice(8, 10)}/{serie[0].dia.slice(5, 7)} →{" "}
        {serie[serie.length - 1].dia.slice(8, 10)}/{serie[serie.length - 1].dia.slice(5, 7)}
      </p>
    </div>
  );
}

/**
 * ¿Se pide por el catálogo? Fase 0 de la tienda online (docs/tienda-online.md):
 * con estos números se decide si vale la pena hacer órdenes, notificación de
 * venta y Mercado Pago.
 */
export function PedidosCatalogoPanel({
  resumen,
}: Readonly<{ resumen: ResumenPedidosCatalogo }>) {
  const { totales } = resumen;

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {resumen.marketing.map(m => <Tarjeta key={m.clave} titulo={m.etiqueta} valor={`${m.porcentaje}%`} detalle={`${m.cantidad} pedidos · Ticket con beneficio: ${m.ticketCon === null ? "—" : formatearMoneda(m.ticketCon)} · Resto: ${m.ticketSin === null ? "—" : formatearMoneda(m.ticketSin)}`} />)}
      </div>
      <div>
        <h2 className="text-sm font-semibold text-white/90">Pedidos del catálogo</h2>
        <p className="text-xs text-white/40">
          {resumen.medicionDesde
            ? `Medido desde el ${formatearFechaHora(resumen.medicionDesde)} (${resumen.diasDeMedicion} día${resumen.diasDeMedicion === 1 ? "" : "s"}).`
            : "Todavía no se midió ningún pedido."}{" "}
          Un pedido es alguien que tocó &quot;Enviar pedido&quot; y abrió WhatsApp: puede no
          concretarse, y las pruebas de la dueña también cuentan. Solo clientes (sin
          demo ni bajas).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tarjeta
          titulo="Últimos 7 días"
          valor={numero(totales.ultimos7d)}
          detalle={`${numero(totales.historico)} desde que se mide`}
        />
        <Tarjeta
          titulo="Últimos 30 días"
          valor={numero(totales.ultimos30d)}
          detalle={`${formatearMoneda(totales.monto30d)} pedidos`}
        />
        <Tarjeta
          titulo="Ticket promedio"
          valor={
            totales.ticketPromedio30d === null
              ? "—"
              : formatearMoneda(Math.round(totales.ticketPromedio30d))
          }
          detalle="de los pedidos de 30 días"
        />
        <Tarjeta
          titulo="Locales con pedidos"
          valor={`${totales.negociosConPedidos30d} / ${totales.negociosQuePuedenRecibir}`}
          detalle="en 30 días, sobre los que tienen catálogo con productos"
        />
      </div>

      <PorDia serie={resumen.porDia} />

      <div className="grid gap-3 lg:grid-cols-2">
        <Reparto titulo="Entrega (30 días)" filas={resumen.porModalidad} />
        <Reparto titulo="Cómo dicen que van a pagar (30 días)" filas={resumen.porPago} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-3 py-2 font-medium">Local</th>
              <th className="px-3 py-2 font-medium">Rubro</th>
              <th className="px-3 py-2 font-medium">Catálogo</th>
              <th className="px-3 py-2 text-right font-medium">7 días</th>
              <th className="px-3 py-2 text-right font-medium">30 días</th>
              <th className="px-3 py-2 text-right font-medium">Monto 30 días</th>
              <th className="px-3 py-2 text-right font-medium">Cada 100 ventas POS</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Último</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {resumen.porNegocio.map((n) => (
              <tr key={n.id} className="text-white/80">
                <td className="px-3 py-2 font-medium text-white">
                  {n.nombre}
                  {n.estado !== "activo" && (
                    <span className="ml-2 text-[11px] font-normal text-white/40">
                      {ETIQUETA_ESTADO[n.estado] ?? n.estado}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-white/60">{etiquetaRubro(n.rubro)}</td>
                <td className="px-3 py-2 text-white/60">
                  {n.puedeRecibir
                    ? `${numero(n.publicados)} productos`
                    : !n.catalogo_activo
                      ? "Apagado"
                      : !n.pedidos_whatsapp
                        ? "Sin botón de pedido"
                        : "Sin productos"}
                </td>
                <td className="px-3 py-2 text-right font-mono">{numero(n.pedidos_7d)}</td>
                <td className="px-3 py-2 text-right font-mono">{numero(n.pedidos_30d)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatearMoneda(n.monto_30d)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-white/60">
                  {n.pedidosCada100Ventas === null ? "—" : n.pedidosCada100Ventas}
                </td>
                <td className="px-3 py-2 text-right font-mono">{numero(n.pedidos)}</td>
                <td className="px-3 py-2 text-white/60">
                  {n.ultimo_pedido ? formatearFechaHora(n.ultimo_pedido) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
