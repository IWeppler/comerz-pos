"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/shared/ui/toast";
import { CheckCircle2, ChevronRight, Loader2, MapPin, PackageCheck, Search, ShoppingBag, Store } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Drawer, DrawerContent, DrawerTitle } from "@/shared/ui/drawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { linkWhatsapp } from "@/shared/lib/telefono-whatsapp";
import {
  aparatosAEntregarAction,
  cancelarOrdenAction,
  confirmarTransferenciaAction,
  marcarEntregadaAction,
  type AparatoAEntregar,
} from "../actions/ordenes";
import { EntregarImeiDialog } from "./entregar-imei-dialog";

export interface OrdenPanel {
  id: string;
  numero: number;
  estado: string;
  medio: "TRANSFERENCIA" | "MP_CHECKOUT" | "MP_CREDITO";
  cliente_nombre: string;
  cliente_telefono: string;
  modalidad_entrega: "RETIRO" | "ENVIO";
  localidad: string | null;
  direccion: string | null;
  nota: string | null;
  total: number;
  vence_en: string;
  creado_en: string;
  pagada_en: string | null;
  entregada_en?: string | null;
  venta_id: string | null;
  ordenes_tienda_items: { nombre: string; variante: string | null; cantidad: number; subtotal: number }[];
}

// ─── Formato ─────────────────────────────────────────────────────────────

const ZONA = "America/Argentina/Buenos_Aires";
const pesos = (monto: number) => Number(monto).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: ZONA });
const numeroDeOrden = (numero: number) => `#${String(numero).padStart(5, "0")}`;

/** "hace 5 min", "hace 3 h", o la fecha si pasó más de un día. */
function haceCuanto(iso: string, ahora: number): string {
  const min = Math.round((ahora - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return fechaHora(iso);
}

/** "vence en 12 min" / "vence en 1 h 20 min". Null si ya pasó. */
function venceEn(iso: string, ahora: number): string | null {
  const min = Math.ceil((new Date(iso).getTime() - ahora) / 60_000);
  if (min <= 0) return null;
  if (min < 60) return `vence en ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `vence en ${h} h${m ? ` ${m} min` : ""}`;
}

// ─── Estados ─────────────────────────────────────────────────────────────

type Tono = "espera" | "ok" | "apagado" | "alerta";

const ESTADOS: Record<string, { texto: string; tono: Tono }> = {
  PENDIENTE_PAGO: { texto: "Esperando pago", tono: "espera" },
  EN_PROCESO: { texto: "Pago en proceso", tono: "espera" },
  PAGADA: { texto: "Pagada", tono: "ok" },
  ENTREGADA: { texto: "Entregada", tono: "ok" },
  VENCIDA: { texto: "Vencida", tono: "apagado" },
  CANCELADA: { texto: "Cancelada", tono: "apagado" },
  REVISAR: { texto: "Revisar pago", tono: "alerta" },
  PAGADA_SIN_STOCK: { texto: "Pagada sin stock", tono: "alerta" },
  REEMBOLSADA: { texto: "Pago devuelto", tono: "apagado" },
  CONTRACARGO: { texto: "Contracargo", tono: "alerta" },
  EN_DISPUTA: { texto: "En reclamo", tono: "alerta" },
};

const CLASE_TONO: Record<Tono, string> = {
  espera: "bg-warning/15 text-warning",
  ok: "bg-success/15 text-success",
  apagado: "bg-muted text-muted-foreground",
  alerta: "bg-destructive/15 text-destructive",
};

/** Qué tiene que hacer el comercio con una orden que pide revisión. */
const QUE_HACER: Partial<Record<string, string>> = {
  REVISAR:
    "Mercado Pago aprobó un pago con un monto distinto al de la orden. Fijate el pago en tu Mercado Pago y escribile a la clienta antes de entregar.",
  PAGADA_SIN_STOCK:
    "El pago llegó después de que la orden venció y los productos volvieron a la venta. Fijate si todavía tenés stock: si no, devolvé el pago desde Mercado Pago.",
  CONTRACARGO: "La clienta desconoció el pago con su tarjeta. Mercado Pago te va a pedir pruebas de la entrega.",
  EN_DISPUTA: "La clienta abrió un reclamo en Mercado Pago. Respondelo desde tu cuenta de Mercado Pago.",
};

const MEDIOS: Record<OrdenPanel["medio"], string> = {
  TRANSFERENCIA: "Transferencia",
  MP_CHECKOUT: "Mercado Pago",
  MP_CREDITO: "Cuotas sin tarjeta",
};

type Filtro = "TODAS" | "ENTREGAR" | "ESPERANDO" | "REVISAR";

const EN_FILTRO: Record<Filtro, (estado: string) => boolean> = {
  TODAS: () => true,
  ENTREGAR: (e) => e === "PAGADA",
  ESPERANDO: (e) => e === "PENDIENTE_PAGO" || e === "EN_PROCESO",
  REVISAR: (e) => ESTADOS[e]?.tono === "alerta",
};

const ETIQUETA_FILTRO: Record<Filtro, string> = {
  TODAS: "Todas",
  ENTREGAR: "Para entregar",
  ESPERANDO: "Esperando pago",
  REVISAR: "Revisar",
};

// El detalle se monta UNA vez: a la derecha en compu, en un drawer en el celular.
const CONSULTA_COMPU = "(min-width: 1024px)";
const suscribirAncho = (avisar: () => void) => {
  const consulta = window.matchMedia(CONSULTA_COMPU);
  consulta.addEventListener("change", avisar);
  return () => consulta.removeEventListener("change", avisar);
};
// Reloj de la lista ("hace 5 min", "vence en 12 min"): un valor cacheado que
// avanza cada 30 s. En el server es 0 y las filas muestran la fecha.
let relojAhora = 0;
const suscribirReloj = (avisar: () => void) => {
  const id = setInterval(() => {
    relojAhora = Date.now();
    avisar();
  }, 30_000);
  return () => clearInterval(id);
};
const leerReloj = () => {
  if (relojAhora === 0) relojAhora = Date.now();
  return relojAhora;
};

/**
 * Las órdenes del catálogo: lista compacta + detalle.
 *
 * Lo que el comercio hace acá es poco y a propósito: la mayoría se confirma
 * sola (Mercado Pago por webhook, la transferencia al alias por conciliación).
 * La pantalla está para ESCANEAR (qué entró, qué espera, qué hay que mirar) y,
 * en el detalle, escribirle a la clienta, confirmar una transferencia que no
 * se emparejó sola o cancelar.
 *
 * Compu: lista a la izquierda y detalle fijo a la derecha. Celular: la lista y
 * el detalle en un drawer que se cierra deslizando.
 */
export function OrdenesPanel({
  ordenes,
  puedeCobrar,
  sinPermiso,
}: Readonly<{ ordenes: OrdenPanel[]; puedeCobrar: boolean; sinPermiso: boolean }>) {
  const router = useRouter();
  const esCompu = useSyncExternalStore(suscribirAncho, () => window.matchMedia(CONSULTA_COMPU).matches, () => false);
  const ahora = useSyncExternalStore(suscribirReloj, leerReloj, () => 0);

  const conteo = useMemo(() => {
    const c = { TODAS: ordenes.length, ENTREGAR: 0, ESPERANDO: 0, REVISAR: 0 } as Record<Filtro, number>;
    for (const o of ordenes) {
      if (EN_FILTRO.ENTREGAR(o.estado)) c.ENTREGAR++;
      if (EN_FILTRO.ESPERANDO(o.estado)) c.ESPERANDO++;
      if (EN_FILTRO.REVISAR(o.estado)) c.REVISAR++;
    }
    return c;
  }, [ordenes]);

  // Arranca donde hay trabajo: primero lo que hay que revisar, después lo que
  // hay que entregar.
  const [filtro, setFiltro] = useState<Filtro>(() =>
    conteo.REVISAR > 0 ? "REVISAR" : conteo.ENTREGAR > 0 ? "ENTREGAR" : "TODAS",
  );
  const [busqueda, setBusqueda] = useState("");
  const [elegidaId, setElegidaId] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const [confirmar, setConfirmar] = useState<{ tipo: "cobrar" | "cancelar"; orden: OrdenPanel } | null>(null);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase().replace(/^#/, "");
    return ordenes.filter(
      (o) =>
        EN_FILTRO[filtro](o.estado) &&
        (q === "" ||
          o.cliente_nombre.toLowerCase().includes(q) ||
          String(o.numero).includes(q.replace(/^0+/, "")) ||
          o.cliente_telefono.includes(q.replace(/\D/g, "") || "∅")),
    );
  }, [ordenes, filtro, busqueda]);

  // En compu siempre hay una elegida (la primera visible) para no dejar el
  // panel derecho vacío; en el celular, solo la que se tocó.
  const elegida =
    ordenes.find((o) => o.id === elegidaId) ?? (esCompu ? (visibles[0] ?? null) : null);

  const correr = (orden: OrdenPanel, tipo: "cobrar" | "cancelar") =>
    startTransition(async () => {
      const r = tipo === "cobrar" ? await confirmarTransferenciaAction(orden.id) : await cancelarOrdenAction(orden.id);
      setConfirmar(null);
      if (r.ok) toast.success(r.mensaje);
      else toast.error(r.error);
      router.refresh();
    });

  const [entregaImei, setEntregaImei] = useState<{ orden: OrdenPanel; aparatos: AparatoAEntregar[] } | null>(null);
  const [errorImei, setErrorImei] = useState<string | null>(null);

  const entregar = (orden: OrdenPanel, entregada: boolean, unidades: { itemId: string; imei: string }[] = []) =>
    startTransition(async () => {
      const r = await marcarEntregadaAction(orden.id, entregada, unidades);
      if (!r.ok) {
        // Con IMEI, el error queda en el diálogo, al lado de lo que hay que corregir.
        if (unidades.length) setErrorImei(r.error);
        else toast.error(r.error);
        return;
      }
      setEntregaImei(null);
      if (entregada) {
        // Sin diálogo: no mueve plata ni stock. El error se deshace desde acá.
        toast.success(`Orden ${numeroDeOrden(orden.numero)} entregada`, {
          action: { label: "Deshacer", onClick: () => entregar(orden, false) },
        });
      } else {
        toast.success(r.mensaje);
      }
      router.refresh();
    });

  /** Si la orden tiene celulares sin IMEI, primero se piden; si no, se entrega. */
  const iniciarEntrega = (orden: OrdenPanel) =>
    startTransition(async () => {
      const r = await aparatosAEntregarAction(orden.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.aparatos.length === 0) {
        entregar(orden, true);
        return;
      }
      setErrorImei(null);
      setEntregaImei({ orden, aparatos: r.aparatos });
    });

  const detalle = elegida ? (
    <DetalleOrden
      orden={elegida}
      ahora={ahora}
      puedeCobrar={puedeCobrar}
      ocupada={pendiente}
      onConfirmar={() => setConfirmar({ tipo: "cobrar", orden: elegida })}
      onCancelar={() => setConfirmar({ tipo: "cancelar", orden: elegida })}
      onEntregar={() => iniciarEntrega(elegida)}
    />
  ) : null;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <ShoppingBag className="h-5 w-5 text-primary" /> Órdenes de la tienda
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Los pagos con Mercado Pago y las transferencias que coinciden se confirman solos.
        </p>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Pestañas: con scroll horizontal en el celular, nunca en dos renglones. */}
        <div role="tablist" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0">
          {(["TODAS", "ENTREGAR", "ESPERANDO", "REVISAR"] as Filtro[])
            .filter((f) => f !== "REVISAR" || conteo.REVISAR > 0)
            .map((f) => {
              const activa = filtro === f;
              const alerta = f === "REVISAR";
              return (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={activa}
                  onClick={() => setFiltro(f)}
                  className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                    activa
                      ? alerta
                        ? "border-destructive bg-destructive text-white"
                        : "border-foreground bg-foreground text-background"
                      : alerta
                        ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {ETIQUETA_FILTRO[f]}
                  <span className={`tabular-nums ${activa ? "opacity-80" : "opacity-60"}`}>{conteo[f]}</span>
                </button>
              );
            })}
        </div>
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, número o celular"
            className="h-11 pl-9"
            aria-label="Buscar órdenes"
          />
        </div>
      </div>

      {sinPermiso && <p className="text-sm text-destructive">No pudimos cargar las órdenes. Recargá la página.</p>}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-6">
        {visibles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <ShoppingBag className="mx-auto h-9 w-9 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">
              {busqueda ? "No hay órdenes que coincidan." : VACIO[filtro]}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {visibles.map((orden) => (
              <FilaOrden
                key={orden.id}
                orden={orden}
                ahora={ahora}
                elegida={esCompu && elegida?.id === orden.id}
                onElegir={() => setElegidaId(orden.id)}
              />
            ))}
          </ul>
        )}

        {esCompu && (
          <aside className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-border bg-card">
            {detalle ?? <p className="p-8 text-center text-sm text-muted-foreground">Elegí una orden para ver el detalle.</p>}
          </aside>
        )}
      </div>

      {!esCompu && (
        <Drawer open={!!elegida} onOpenChange={(abierto) => !abierto && setElegidaId(null)}>
          <DrawerContent className="max-h-[92dvh]">
            <DrawerTitle className="sr-only">
              {elegida ? `Orden ${numeroDeOrden(elegida.numero)}` : "Orden"}
            </DrawerTitle>
            <div className="overflow-y-auto pb-[env(safe-area-inset-bottom)]">{detalle}</div>
          </DrawerContent>
        </Drawer>
      )}

      {entregaImei && (
        <EntregarImeiDialog
          key={entregaImei.orden.id}
          numero={numeroDeOrden(entregaImei.orden.numero)}
          aparatos={entregaImei.aparatos}
          abierto
          enviando={pendiente}
          error={errorImei}
          onCerrar={() => setEntregaImei(null)}
          onEntregar={(unidades) => {
            setErrorImei(null);
            entregar(entregaImei.orden, true, unidades);
          }}
        />
      )}

      <AlertDialog open={!!confirmar} onOpenChange={(abierto) => !abierto && setConfirmar(null)}>
        <AlertDialogContent>
          {confirmar && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmar.tipo === "cobrar"
                    ? `¿Ya te llegaron ${pesos(confirmar.orden.total)}?`
                    : `¿Cancelar la orden ${numeroDeOrden(confirmar.orden.numero)}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmar.tipo === "cobrar"
                    ? "Fijate en tu Mercado Pago que la transferencia esté acreditada. Al confirmar se registra la venta y la plata entra en la cuenta de la tienda online."
                    : "Los productos vuelven a la venta. Si la clienta ya transfirió, no la canceles: confirmala."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pendiente} autoFocus>
                  {confirmar.tipo === "cancelar" ? "No, dejarla" : "Volver"}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={pendiente}
                  className={confirmar.tipo === "cancelar" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    correr(confirmar.orden, confirmar.tipo);
                  }}
                >
                  {pendiente && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {confirmar.tipo === "cobrar" ? "Sí, confirmar" : "Sí, cancelar y liberar stock"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const VACIO: Record<Filtro, string> = {
  TODAS: "Todavía no entró ninguna orden de la tienda.",
  ENTREGAR: "No hay órdenes para entregar.",
  ESPERANDO: "No hay órdenes esperando pago.",
  REVISAR: "No hay nada para revisar.",
};

function EstadoBadge({ estado }: Readonly<{ estado: string }>) {
  const e = ESTADOS[estado] ?? { texto: estado, tono: "apagado" as Tono };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${CLASE_TONO[e.tono]}`}>
      {e.texto}
    </span>
  );
}

/** Una orden en la lista: lo que hace falta para decidir si abrirla. */
function FilaOrden({
  orden,
  ahora,
  elegida,
  onElegir,
}: Readonly<{ orden: OrdenPanel; ahora: number; elegida: boolean; onElegir: () => void }>) {
  const vence = orden.estado === "PENDIENTE_PAGO" && ahora ? venceEn(orden.vence_en, ahora) : null;
  const unidades = orden.ordenes_tienda_items.reduce((s, i) => s + Number(i.cantidad), 0);
  return (
    <li>
      <button
        type="button"
        onClick={onElegir}
        aria-current={elegida || undefined}
        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
          elegida ? "bg-muted" : "hover:bg-muted/50"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold">{orden.cliente_nombre}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{numeroDeOrden(orden.numero)}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {ahora ? haceCuanto(orden.creado_en, ahora) : fechaHora(orden.creado_en)} · {MEDIOS[orden.medio]} ·{" "}
            {unidades} {unidades === 1 ? "producto" : "productos"}
          </span>
          {vence && <span className="mt-0.5 block text-xs font-medium text-warning">{vence}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-semibold tabular-nums">{pesos(orden.total)}</span>
          <EstadoBadge estado={orden.estado} />
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 lg:hidden" />
      </button>
    </li>
  );
}

/** El detalle de una orden: quién, qué, cómo se entrega y qué se puede hacer. */
function DetalleOrden({
  orden,
  ahora,
  puedeCobrar,
  ocupada,
  onConfirmar,
  onCancelar,
  onEntregar,
}: Readonly<{
  orden: OrdenPanel;
  ahora: number;
  puedeCobrar: boolean;
  ocupada: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
  onEntregar: () => void;
}>) {
  const pendientePago = orden.estado === "PENDIENTE_PAGO";
  const vence = pendientePago && ahora ? venceEn(orden.vence_en, ahora) : null;
  const queHacer = QUE_HACER[orden.estado];
  const puedeConfirmar = pendientePago && puedeCobrar && orden.medio === "TRANSFERENCIA";
  const puedeEntregar = orden.estado === "PAGADA" && puedeCobrar;

  return (
    <div className="space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">Orden {numeroDeOrden(orden.numero)}</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">{pesos(orden.total)}</p>
          <p className="text-xs text-muted-foreground">
            {MEDIOS[orden.medio]} · {fechaHora(orden.creado_en)}
          </p>
        </div>
        <EstadoBadge estado={orden.estado} />
      </div>

      {queHacer && (
        <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{queHacer}</p>
      )}
      {vence && (
        <p className="rounded-xl bg-warning/10 p-3 text-sm">
          Esperando el pago: <span className="font-semibold">{vence}</span>. Si no paga, los productos vuelven a la
          venta solos.
        </p>
      )}

      {/* Acciones de todos los días, arriba y grandes. */}
      <div className="flex flex-col gap-2">
        {puedeEntregar && (
          <Button
            className="h-12 w-full text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.97]"
            disabled={ocupada}
            onClick={onEntregar}
          >
            <PackageCheck className="mr-2 h-4 w-4" />
            {orden.modalidad_entrega === "ENVIO" ? "Marcar enviada y entregada" : "Marcar entregada"}
          </Button>
        )}
        {puedeConfirmar && (
          <Button
            className="h-12 w-full text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.97]"
            disabled={ocupada}
            onClick={onConfirmar}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmar transferencia
          </Button>
        )}
        <Button
          asChild
          className="h-12 w-full gap-2 border-0 bg-[#25D366] text-sm font-semibold text-white transition-transform duration-150 ease-out hover:bg-[#1ebe5d] active:scale-[0.97]"
        >
          <a
            href={linkWhatsapp(
              orden.cliente_telefono,
              `¡Hola ${orden.cliente_nombre}! Te escribo por tu orden ${numeroDeOrden(orden.numero)}.`,
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FaWhatsapp className="h-5 w-5" /> Escribirle por WhatsApp
          </a>
        </Button>
      </div>

      <Bloque titulo="Cliente">
        <p className="text-sm font-medium">{orden.cliente_nombre}</p>
        <p className="text-sm text-muted-foreground tabular-nums">{orden.cliente_telefono}</p>
      </Bloque>

      <Bloque titulo="Entrega">
        <p className="flex items-start gap-2 text-sm">
          {orden.modalidad_entrega === "ENVIO" ? (
            <>
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                Envío a {orden.direccion}
                {orden.localidad ? `, ${orden.localidad}` : ""}
              </span>
            </>
          ) : (
            <>
              <Store className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              Retira en el local
            </>
          )}
        </p>
        {orden.nota && <p className="mt-2 rounded-lg bg-muted/60 p-2.5 text-sm italic">“{orden.nota}”</p>}
      </Bloque>

      <Bloque titulo="Productos">
        <ul className="space-y-2 text-sm">
          {orden.ordenes_tienda_items.map((item, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="font-medium tabular-nums">{Number(item.cantidad)} ×</span> {item.nombre}
                {item.variante && <span className="block text-xs text-muted-foreground">{item.variante}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{pesos(item.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-base font-bold tabular-nums">{pesos(orden.total)}</span>
        </div>
        {orden.pagada_en && (
          <p className="mt-1 text-xs text-muted-foreground">
            Pagada el {fechaHora(orden.pagada_en)}
            {orden.venta_id ? " · venta registrada en Ventas" : ""}
          </p>
        )}
        {orden.entregada_en && (
          <p className="text-xs text-muted-foreground">Entregada el {fechaHora(orden.entregada_en)}</p>
        )}
      </Bloque>

      {/* Cancelar devuelve el stock y no se deshace: al final, chico y lejos de
          los botones de todos los días. Igual pide confirmación. */}
      {pendientePago && puedeCobrar && (
        <div className="flex justify-center border-t border-border pt-3">
          <button
            type="button"
            disabled={ocupada}
            onClick={onCancelar}
            className="min-h-11 px-3 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-destructive disabled:opacity-50"
          >
            Cancelar orden
          </button>
        </div>
      )}
    </div>
  );
}

function Bloque({ titulo, children }: Readonly<{ titulo: string; children: React.ReactNode }>) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{titulo}</h3>
      {children}
    </section>
  );
}
