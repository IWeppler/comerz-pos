"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CreditCard,
  Megaphone,
  Package,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  getMisNotificacionesAction,
  limpiarNotificacionesLeidasAction,
  marcarNotificacionesLeidasAction,
} from "@/features/notificaciones/actions/notificaciones";
import {
  etiquetaContador,
  tiempoRelativo,
  type CategoriaNotificacion,
  type ListaNotificaciones,
  type Notificacion,
  type Novedad,
} from "@/features/notificaciones/lib/notificaciones";
import { useNotificacionesStore } from "@/features/notificaciones/store/notificaciones-store";
import { CuerpoNovedad, ICONO_NOVEDAD } from "@/features/notificaciones/ui/cuerpo-novedad";
import { IconoCampana } from "@/features/notificaciones/ui/icono-campana";

const ICONO_POR_CATEGORIA: Record<CategoriaNotificacion, LucideIcon> = {
  STOCK: Package,
  TIENDA: ShoppingBag,
  PLAN: CreditCard,
  PLATA: Wallet,
};

type Pestana = "negocio" | "novedades";

/**
 * La campana (N4 + N5, docs/notificaciones.md): ícono con contador y, al
 * tocarlo, las pestañas "Tu negocio" / "Novedades".
 *
 * La lista se pide AL ABRIR (no se tiene cargada): el contador alcanza para
 * saber si hay algo, y así navegar cuesta una consulta liviana y no la lista
 * entera.
 *
 * Leído POR PESTAÑA: se marca lo que se ve. Al abrir se muestra la pestaña que
 * tiene algo nuevo (si solo hay una novedad de Comerz, abre en "Novedades");
 * lo de la otra queda sin leer hasta que se la mira. Lo nuevo conserva su
 * punto azul hasta cerrar: si se apagara al instante, no se sabría qué era.
 */
export function CampanaNotificaciones({ className = "" }: Readonly<{ className?: string }>) {
  const sinLeer = useNotificacionesStore((s) => s.sinLeer);
  const setSinLeer = useNotificacionesStore((s) => s.setSinLeer);

  const [abierta, setAbierta] = useState(false);
  const [datos, setDatos] = useState<ListaNotificaciones | null>(null);
  const [pestana, setPestana] = useState<Pestana>("negocio");
  const [nuevas, setNuevas] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  // Lo ya marcado en esta apertura: cambiar de pestaña no lo vuelve a mandar.
  const marcadas = useRef<Set<string>>(new Set());

  function noLeidas(d: ListaNotificaciones, p: Pestana): string[] {
    const items = p === "negocio" ? d.tuNegocio : d.novedades;
    return items.filter((n) => !n.leida).map((n) => n.clave);
  }

  function marcar(d: ListaNotificaciones, p: Pestana) {
    const claves = noLeidas(d, p).filter((c) => !marcadas.current.has(c));
    claves.forEach((c) => marcadas.current.add(c));
    if (claves.length > 0) void marcarNotificacionesLeidasAction(claves);
    // El ícono muestra lo que queda sin mirar en la otra pestaña.
    const otra: Pestana = p === "negocio" ? "novedades" : "negocio";
    setSinLeer(noLeidas(d, otra).filter((c) => !marcadas.current.has(c)).length);
  }

  async function abrir() {
    setError(false);
    marcadas.current = new Set();
    const r = await getMisNotificacionesAction().catch(() => null);
    if (!r) {
      setError(true);
      return;
    }
    setDatos(r);
    setNuevas(new Set([...noLeidas(r, "negocio"), ...noLeidas(r, "novedades")]));
    const inicial: Pestana =
      noLeidas(r, "negocio").length === 0 && noLeidas(r, "novedades").length > 0 ? "novedades" : "negocio";
    setPestana(inicial);
    marcar(r, inicial);
  }

  function onOpenChange(siguiente: boolean) {
    setAbierta(siguiente);
    if (siguiente) void abrir();
    else setNuevas(new Set());
  }

  function cambiarPestana(valor: string) {
    const siguiente = valor as Pestana;
    setPestana(siguiente);
    if (datos) marcar(datos, siguiente);
  }

  async function limpiar() {
    // Lo de "Tu negocio" ya quedó leído al mirarlo: limpiar lo oculta entero.
    setDatos((d) => (d ? { ...d, tuNegocio: [] } : d));
    const ok = await limpiarNotificacionesLeidasAction();
    if (!ok) void abrir();
  }

  const contador = etiquetaContador(sinLeer);
  const lista = datos?.tuNegocio ?? null;
  const novedades = datos?.novedades ?? null;
  const nuevasNegocio = lista?.filter((n) => nuevas.has(n.clave)).length ?? 0;
  const nuevasNovedades = novedades?.filter((n) => nuevas.has(n.clave)).length ?? 0;

  return (
    <Popover open={abierta} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={sinLeer > 0 ? `Notificaciones: ${sinLeer} sin leer` : "Notificaciones"}
          className={`relative flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.96] ${className}`}
        >
          <IconoCampana className="size-5" />
          {contador && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none tabular-nums text-white ring-2 ring-background">
              {contador}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-[min(380px,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
          <p className="text-sm font-semibold text-foreground">Notificaciones</p>
          {pestana === "negocio" && lista && lista.length > 0 && (
            <button
              type="button"
              onClick={limpiar}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Limpiar leídas
            </button>
          )}
        </div>

        <Tabs value={pestana} onValueChange={cambiarPestana} className="gap-0">
          <div className="border-b border-border px-4">
            <TabsList variant="line" className="h-9 p-0">
              <TabsTrigger value="negocio" className="px-2">
                Tu negocio
                {nuevasNegocio > 0 && <Globito n={nuevasNegocio} />}
              </TabsTrigger>
              <TabsTrigger value="novedades" className="px-2">
                Novedades
                {nuevasNovedades > 0 && <Globito n={nuevasNovedades} />}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="negocio" className="mt-0">
            <div className="max-h-[min(420px,60vh)] overflow-y-auto">
              {error ? (
                <Vacio>No pudimos cargar las notificaciones. Probá de nuevo en un rato.</Vacio>
              ) : lista === null ? (
                <Esqueleto />
              ) : lista.length === 0 ? (
                <Vacio>Todo tranquilo. Acá te avisamos cuando algo de tu negocio necesite tu atención.</Vacio>
              ) : (
                <ul className="divide-y divide-border">
                  {lista.map((n) => (
                    <Fila key={n.clave} n={n} nueva={nuevas.has(n.clave)} onNavegar={() => setAbierta(false)} />
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="novedades" className="mt-0">
            <div className="max-h-[min(420px,60vh)] overflow-y-auto">
              {error ? (
                <Vacio>No pudimos cargar las novedades. Probá de nuevo en un rato.</Vacio>
              ) : novedades === null ? (
                <Esqueleto />
              ) : novedades.length === 0 ? (
                <Vacio icono={Megaphone}>Acá vas a ver lo nuevo de Comerz.</Vacio>
              ) : (
                <ul className="divide-y divide-border">
                  {novedades.map((n) => (
                    <FilaNovedad key={n.clave} n={n} nueva={nuevas.has(n.clave)} />
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function Globito({ n }: Readonly<{ n: number }>) {
  return <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-foreground">{n}</span>;
}

/** Una novedad de Comerz: entera, sin link (se lee ahí mismo). La usa también
 * la vista previa del editor de /admincomerz. */
export function FilaNovedad({
  n,
  nueva,
}: Readonly<{ n: Pick<Novedad, "icono" | "titulo" | "cuerpo" | "fecha">; nueva: boolean }>) {
  const Icono = ICONO_NOVEDAD[n.icono];
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icono className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-foreground">{n.titulo}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{tiempoRelativo(n.fecha)}</p>
        <CuerpoNovedad cuerpo={n.cuerpo} className="mt-2" />
      </div>
      {nueva && <span aria-label="Nueva" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
    </li>
  );
}

function Fila({ n, nueva, onNavegar }: Readonly<{ n: Notificacion; nueva: boolean; onNavegar: () => void }>) {
  const Icono = ICONO_POR_CATEGORIA[n.categoria];
  const contenido = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icono className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug text-foreground">{n.titulo}</p>
        {n.detalle && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.detalle}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">{tiempoRelativo(n.fecha)}</p>
      </div>
      {nueva && <span aria-label="Nueva" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
    </>
  );

  if (!n.href) return <li className="flex items-start gap-3 px-4 py-3">{contenido}</li>;
  return (
    <li>
      <Link
        href={n.href}
        prefetch={false}
        onClick={onNavegar}
        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
      >
        {contenido}
      </Link>
    </li>
  );
}

function Vacio({ children, icono: Icono = Bell }: Readonly<{ children: React.ReactNode; icono?: LucideIcon }>) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icono className="size-5" strokeWidth={1.75} />
      </span>
      <p className="max-w-[260px] text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function Esqueleto() {
  return (
    <ul aria-label="Cargando notificaciones" className="divide-y divide-border">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-3">
          <span className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2 pt-1">
            <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
            <span className="block h-3 w-full animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
