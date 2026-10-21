import { RankingCategorias } from "@/features/reports/ui/ranking-categorias";
import { formatearMoneda } from "@/shared/utils/formatters";
import type {
  DesgloseMetodoVendedor,
  VendedorResumen,
  VentaPorDiaVendedor,
} from "@/entities/reportes/types";

/** Medios de pago con colores de la paleta fija (`--viz-*`). Efectivo naranja y
 * tarjeta azul: son los dos que más se cruzan, y tienen que contrastar entre sí.
 * Un medio que no esté acá se muestra gris, sin inventar un color. */
const METODOS: Record<string, { etiqueta: string; color: string }> = {
  EFECTIVO: { etiqueta: "Efectivo", color: "var(--viz-2)" },
  TARJETA: { etiqueta: "Tarjeta", color: "var(--viz-1)" },
  BILLETERA_VIRTUAL: { etiqueta: "Billetera virtual", color: "var(--viz-3)" },
  TRANSFERENCIA: { etiqueta: "Transferencia", color: "var(--viz-4)" },
  CUENTA_CORRIENTE: { etiqueta: "Cuenta corriente", color: "var(--viz-5)" },
};
const ORDEN_METODOS = Object.keys(METODOS);
const COLOR_OTRO = "var(--muted-foreground)";

function metodoInfo(clave: string) {
  return METODOS[clave] ?? { etiqueta: clave.replaceAll("_", " ").toLowerCase(), color: COLOR_OTRO };
}

/** Cuánto vendió cada uno, con sus ventas y su ticket en el detalle. */
export function VendedoresRanking({ resumen }: Readonly<{ resumen: VendedorResumen[] }>) {
  const ordenados = [...resumen].sort((a, b) => b.totalVendido - a.totalVendido);
  const total = ordenados.reduce((acc, r) => acc + r.totalVendido, 0);
  return (
    <RankingCategorias
      data={ordenados.map((r) => ({
        label: r.nombre,
        value: r.totalVendido,
        detalle: `${r.cantidadVentas} ventas · ticket ${formatearMoneda(r.ticketPromedio)}`,
      }))}
      total={total}
      formatearValor={formatearMoneda}
    />
  );
}

/** Cómo cobra cada uno: una barra 100% por vendedor, con el porcentaje escrito
 * debajo para no depender del color. */
export function VendedoresCobros({
  resumen,
  desglose,
}: Readonly<{ resumen: VendedorResumen[]; desglose: DesgloseMetodoVendedor[] }>) {
  const presentes = ORDEN_METODOS.filter((m) => desglose.some((d) => d.metodo === m));
  const otros = Array.from(new Set(desglose.map((d) => d.metodo))).filter((m) => !METODOS[m]);
  const medios = [...presentes, ...otros];

  if (medios.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Sin cobros en el período.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {medios.map((m) => (
          <li key={m} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: metodoInfo(m).color }} aria-hidden="true" />
            {metodoInfo(m).etiqueta}
          </li>
        ))}
      </ul>

      {resumen.map((v) => {
        const filas = medios
          .map((m) => ({ m, monto: desglose.find((d) => d.vendedorId === v.vendedorId && d.metodo === m)?.monto ?? 0 }))
          .filter((f) => f.monto > 0);
        const total = filas.reduce((acc, f) => acc + f.monto, 0);
        return (
          <div key={v.vendedorId} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words text-sm font-medium text-foreground">{v.nombre}</span>
              <span className="shrink-0 text-sm tabular-nums text-foreground">{formatearMoneda(total)}</span>
            </div>
            {total > 0 ? (
              <>
                <div
                  role="img"
                  aria-label={`${v.nombre}: ${filas.map((f) => `${metodoInfo(f.m).etiqueta} ${Math.round((f.monto / total) * 100)}%`).join(", ")}`}
                  className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
                >
                  {filas.map((f) => (
                    <div
                      key={f.m}
                      className="h-full"
                      style={{ width: `${(f.monto / total) * 100}%`, background: metodoInfo(f.m).color }}
                    />
                  ))}
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {filas.map((f) => `${metodoInfo(f.m).etiqueta} ${Math.round((f.monto / total) * 100)}%`).join(" · ")}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Sin cobros en el período.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Formato corto de fecha (yyyy-mm-dd → "12 oct") sin depender de la zona del navegador. */
function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

/** Ventas por día: una columna por día, por vendedor. Misma escala para todos,
 * así que una columna más alta siempre vendió más. Abajo, las fechas de
 * inicio y fin, y el mejor día de cada uno dicho en palabras. */
export function VendedoresDiario({
  resumen,
  ventasPorDia,
}: Readonly<{ resumen: VendedorResumen[]; ventasPorDia: VentaPorDiaVendedor[] }>) {
  const fechas = Array.from(new Set(ventasPorDia.map((v) => v.fecha))).sort();
  if (fechas.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Sin ventas en el período.</p>;
  }

  const totalDelDia = (vendedorId: string, fecha: string) =>
    ventasPorDia
      .filter((v) => v.vendedorId === vendedorId && v.fecha === fecha)
      .reduce((acc, v) => acc + v.total, 0);

  const maximo = Math.max(
    1,
    ...resumen.flatMap((r) => fechas.map((f) => totalDelDia(r.vendedorId, f))),
  );

  return (
    <div className="flex flex-col gap-5">
      {resumen.map((r) => {
        const valores = fechas.map((f) => totalDelDia(r.vendedorId, f));
        const total = valores.reduce((a, b) => a + b, 0);
        const mejorIdx = valores.indexOf(Math.max(...valores));
        return (
          <div key={r.vendedorId} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words text-sm font-medium text-foreground">{r.nombre}</span>
              <span className="shrink-0 text-sm tabular-nums text-foreground">{formatearMoneda(total)}</span>
            </div>
            <div
              role="img"
              aria-label={`${r.nombre}: ${formatearMoneda(total)} en el período. Mejor día ${fechaCorta(fechas[mejorIdx])} con ${formatearMoneda(valores[mejorIdx])}.`}
              className="flex h-14 items-end gap-px"
            >
              {valores.map((v, i) => (
                <div
                  key={fechas[i]}
                  title={`${fechaCorta(fechas[i])}: ${formatearMoneda(v)}`}
                  className="min-w-[2px] flex-1 rounded-t-sm bg-primary/80"
                  style={{ height: `${v > 0 ? Math.max((v / maximo) * 100, 4) : 0}%` }}
                />
              ))}
            </div>
            {total > 0 ? (
              <p className="text-xs text-muted-foreground">
                Mejor día: <span className="font-medium text-foreground">{fechaCorta(fechas[mejorIdx])}</span> con{" "}
                <span className="font-medium tabular-nums text-foreground">{formatearMoneda(valores[mejorIdx])}</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Sin ventas en el período.</p>
            )}
          </div>
        );
      })}
      <div className="flex justify-between border-t border-border/60 pt-2 text-xs tabular-nums text-muted-foreground">
        <span>{fechaCorta(fechas[0])}</span>
        <span>
          {fechas.length === 1 ? "Un solo día" : `${fechas.length} días con ventas · cada columna es un día`}
        </span>
        <span>{fechaCorta(fechas[fechas.length - 1])}</span>
      </div>
    </div>
  );
}
