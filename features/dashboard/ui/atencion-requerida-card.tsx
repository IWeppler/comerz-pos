import Link from "next/link";
import { Package, Bookmark, ChevronRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { DevolverReservaButton } from "@/features/reservations/ui/devolver-reserva-button";
import { formatearFechaHora } from "@/shared/utils/formatters";
import type { QuiebreProducto } from "../lib/detectar-quiebres";

type StockCriticoItem = { nombre: string; variante: string; cantidad: number };

type ReservaActiva = {
  id: string;
  nombreProducto: string;
  varianteNombre: string | null;
  clienteNombre: string | null;
  vendedoraNombre: string | null;
  creadoEn: string;
  vencida: boolean;
};

/** A Inventario con el producto ya buscado: un aviso tiene que llevar a donde
 * se resuelve. El buscador encuentra por nombre y por SKU. */
function hrefStock(nombre: string): string {
  return `/stock?buscar=${encodeURIComponent(nombre)}`;
}

interface AtencionRequeridaCardProps {
  /** Días de la ventana de rotación, para decir "vendiste 12 en 14 días". */
  ventanaQuiebreDias?: number;
  quiebres: QuiebreProducto[];
  stockCritico: StockCriticoItem[];
  cantidadBajasPendientes: number;
  reservasActivas: ReservaActiva[];
  /** Reservar es de indumentaria (ver `rubroUsaReservas`). En los demás rubros
   * la pestaña no existe: una que nunca puede tener nada enseña a ignorar las
   * pestañas de esta card. Ausente = se muestra, para no esconderla en un
   * consumidor que todavía no pasa el dato. */
  mostrarReservas?: boolean;
}

/**
 * Tabs [Stock Crítico | Reservas] — antes eran 2 cards separadas
 * ("Alertas de stock" y "Reservas activas"), ahora conviven en una columna
 * fija sin crecer verticalmente (fila 2 del layout v2). Reservas sigue
 * siendo por ANTIGÜEDAD (hace cuánto está activa), nunca "por vencer": el
 * sistema no tiene un campo de vencimiento para reservas.
 *
 * Sin reservas —todo rubro que no sea indumentaria— la card deja de ser de
 * pestañas: queda el stock crítico con su título. Una sola pestaña es un
 * control que no controla nada.
 */
export function AtencionRequeridaCard({
  quiebres,
  stockCritico,
  cantidadBajasPendientes,
  reservasActivas,
  mostrarReservas = true,
  ventanaQuiebreDias,
}: Readonly<AtencionRequeridaCardProps>) {
  const reservasVencidas = reservasActivas.filter((r) => r.vencida).length;
  const sinNovedadesStock =
    quiebres.length === 0 &&
    stockCritico.length === 0 &&
    cantidadBajasPendientes === 0;

  const contenidoStock = (
    <>
      {sinNovedadesStock ? (
        <div className="h-full flex items-center justify-center">
          <p className="text-xs text-muted-foreground italic">
            Inventario saludable.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {quiebres.slice(0, 3).map((q) => (
            <Link
              key={q.productoId}
              href={hrefStock(q.nombre)}
              className="flex items-center justify-between gap-2 text-xs bg-danger-subtle border border-danger/20 rounded-lg px-2.5 py-2 transition-colors hover:border-danger/40"
            >
              <span
                className="truncate text-foreground font-medium"
                title={q.nombre}
              >
                {q.nombre}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-danger">
                {/* En palabras del mostrador: "quiebre" es palabra del sistema. */}
                Se agota · vendiste {q.unidadesVendidas}
                {ventanaQuiebreDias ? ` en ${ventanaQuiebreDias} días` : ""}
                <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              </span>
            </Link>
          ))}
          {stockCritico.slice(0, 3).map((s, idx) => (
            <Link
              key={`${s.nombre}-${s.variante}-${idx}`}
              href={hrefStock(s.nombre)}
              className="flex items-center justify-between gap-2 text-xs bg-muted/40 border border-border rounded-lg px-2.5 py-2 transition-colors hover:bg-muted"
            >
              <span
                className="truncate text-foreground"
                title={`${s.nombre} · ${s.variante}`}
              >
                {s.nombre} · {s.variante}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-warning font-medium">
                quedan {s.cantidad} u.
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-60" />
              </span>
            </Link>
          ))}
          {cantidadBajasPendientes > 0 && (
            <div className="flex items-center gap-2 text-xs bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" />
              {cantidadBajasPendientes} merma
              {cantidadBajasPendientes === 1 ? "" : "s"} pendiente
              {cantidadBajasPendientes === 1 ? "" : "s"} de revisión
            </div>
          )}
        </div>
      )}
    </>
  );

  // Sin la pestaña de reservas no hay pestañas: una sola no es un control.
  if (!mostrarReservas) {
    return (
      <div className="bg-card border border-border rounded-xl flex flex-col overflow-hidden h-full">
        <div className="flex items-center gap-1.5 px-4 pt-3.5 pb-1 shrink-0 text-sm font-semibold text-foreground">
          <Package className="w-3.5 h-3.5" /> Stock crítico
        </div>
        <div className="flex-1 overflow-y-auto p-3 pt-2">{contenidoStock}</div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col overflow-hidden h-full">
      <Tabs defaultValue="stock" className="flex flex-col h-full gap-0">
        <div className="px-3 pt-3 shrink-0">
          <TabsList className="w-full">
            <TabsTrigger value="stock" className="gap-1.5">
              <Package className="w-3.5 h-3.5" /> Stock Crítico
            </TabsTrigger>
            {/* El contador va en la pestaña: lo que está detrás de una
                pestaña sin número, en una mirada de 10 segundos, no existe. */}
            <TabsTrigger value="reservas" className="gap-1.5">
              <Bookmark className="w-3.5 h-3.5" /> Reservas
              {reservasActivas.length > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs tabular-nums ${
                    reservasVencidas > 0
                      ? "bg-warning-subtle text-warning"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {reservasActivas.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="stock"
          className="flex-1 overflow-y-auto p-3 pt-2 mt-0"
        >
          {contenidoStock}
        </TabsContent>

        <TabsContent
          value="reservas"
          className="flex-1 overflow-y-auto p-3 pt-2 mt-0"
        >
          {reservasActivas.length > 0 ? (
            <div className="space-y-1.5">
              {reservasActivas.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 border ${
                    r.vencida
                      ? "bg-warning-subtle border-warning/25"
                      : "bg-muted/40 border-border"
                  }`}
                >
                  <div className="min-w-0">
                    <p
                      className="font-medium text-foreground truncate"
                      title={r.nombreProducto}
                    >
                      {r.nombreProducto}
                      {r.varianteNombre ? ` · ${r.varianteNombre}` : ""}
                    </p>
                    <p className="text-muted-foreground truncate">
                      desde {formatearFechaHora(r.creadoEn)}
                      {r.vendedoraNombre ? ` · ${r.vendedoraNombre}` : ""}
                      {r.clienteNombre ? ` · para ${r.clienteNombre}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.vencida && (
                      <span className="text-warning font-medium">+24h</span>
                    )}
                    <DevolverReservaButton
                      reservaId={r.id}
                      nombreProducto={r.nombreProducto}
                      varianteNombre={r.varianteNombre}
                      clienteNombre={r.clienteNombre}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-xs text-muted-foreground italic">
                Sin reservas activas.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
