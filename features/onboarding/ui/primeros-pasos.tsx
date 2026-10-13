"use client";

import { useEffect, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, Globe, Loader2, Lock, SlidersHorizontal, Users } from "lucide-react";
import { registrarHitoActivacionAction } from "../actions/registrar-hito";
import type { EstadoActivacion } from "../lib/pasos-activacion";
import { pantallaPrimerosPasos, type TarjetaInicio } from "../lib/primeros-pasos";
import { useCajaModalStore } from "@/shared/store/caja-modal-store";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useElegirCaminoStore } from "@/shared/store/elegir-camino-store";
import { ElegirCaminoDialog } from "./elegir-camino-dialog";

/**
 * "Primeros pasos": lo que ve el dueño de un comercio nuevo EN LUGAR del panel
 * de números, hasta que se activa. Un panel lleno de ceros el primer día no
 * dice qué hacer; esto dice una cosa por vez, con objetos grandes que llevan a
 * la tarea, y la tarea vuelve tildada.
 *
 * El estado sale de la base (`estado_activacion`), igual que la guía: no hay
 * flags guardados. Cuando el comercio vende o completa lo obligatorio, el
 * panel vuelve solo.
 *
 * Movimiento (criterio Emil Kowalski): esta pantalla se ve pocas veces en la
 * vida del comercio, así que el tilde de una tarea hecha puede aparecer con
 * un pequeño gesto. Todo lo que se toca responde al apretar. Nada se mueve con
 * `prefers-reduced-motion`.
 */
export function PrimerosPasos({ estado }: Readonly<{ estado: EstadoActivacion }>) {
  const { titulo, completados, total, grandes, chicas } = pantallaPrimerosPasos(estado);
  const { abierto: elegir, setAbierto: setElegir } = useElegirCaminoStore();
  const abrirCaja = useCajaModalStore((s) => s.abrir);
  const negocioId = useNegocioActivo()?.id;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Al volver de elegir un camino, el estado cambió en la base: se relee.
  useEffect(() => {
    if (!negocioId || useElegirCaminoStore.getState().refrescarNegocioId !== negocioId) return;
    useElegirCaminoStore.getState().consumirRefresco();
    router.refresh();
  }, [negocioId, router]);

  // `/?empezar=1` (barra de prueba, links viejos) abre directo el diálogo.
  useEffect(() => {
    if (params.get("empezar") !== "1") return;
    setElegir(true);
    const q = new URLSearchParams(params.toString());
    q.delete("empezar");
    router.replace(pathname + (q.size ? "?" + q : ""), { scroll: false });
  }, [params, pathname, router, setElegir]);

  // "Saltear tutorial": se guarda por negocio y vuelve el panel de siempre.
  const [salteando, startSaltear] = useTransition();
  const saltear = () =>
    startSaltear(async () => {
      await registrarHitoActivacionAction("PRIMEROS_PASOS_SALTEADOS");
      router.refresh();
    });

  const ejecutar = (t: TarjetaInicio) => {
    if (t.accion === "elegir-camino") setElegir(true);
    else if (t.accion === "abrir-caja") abrirCaja();
  };

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center px-4 py-8 md:py-12">
      <div className="flex w-full justify-end md:absolute md:top-4 md:right-4 md:w-auto">
        <button
          type="button"
          onClick={saltear}
          disabled={salteando}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          {salteando && <Loader2 className="size-4 animate-spin" />}
          Saltear tutorial
        </button>
      </div>

      <h1 className="text-center text-3xl font-bold tracking-tight text-balance md:text-4xl">{titulo}</h1>

      <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {completados} de {total} listos
        </span>
        <div
          role="progressbar"
          aria-label="Progreso de la puesta en marcha"
          aria-valuenow={completados}
          aria-valuemin={0}
          aria-valuemax={total}
          className="h-1.5 w-40 overflow-hidden rounded-full bg-border md:w-64"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${(completados / total) * 100}%` }} />
        </div>
      </div>

      <div className="mt-8 grid w-full gap-4 md:grid-cols-2">
        {grandes.map((t) => (
          <TarjetaGrande key={t.clave} tarjeta={t} onAccion={() => ejecutar(t)} />
        ))}
      </div>

      <div className="mt-4 grid w-full gap-3 sm:grid-cols-3">
        {chicas.map((t) => (
          <TarjetaChica key={t.clave} tarjeta={t} />
        ))}
      </div>

      <ElegirCaminoDialog rubro={estado.rubro} open={elegir} onOpenChange={setElegir} />
    </div>
  );
}

const CLASE_BOTON =
  "inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none";

function Tilde() {
  return (
    <span
      aria-label="Listo"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-white animate-in fade-in zoom-in-90 duration-300 motion-reduce:animate-none"
    >
      <Check className="size-4" strokeWidth={3} />
    </span>
  );
}

function TarjetaGrande({ tarjeta, onAccion }: Readonly<{ tarjeta: TarjetaInicio; onAccion: () => void }>) {
  // Render 3D con fondo transparente (1536×1024), objetos a la derecha y
  // abajo: el botón va encima del tercio izquierdo, que queda libre.
  const ilustracion = tarjeta.clave === "productos" ? "/asset-stock.png" : "/asset-sales.png";
  const claseBoton = `${CLASE_BOTON} ${
    // Sólido solo lo que sigue: dos botones sólidos a la vez no dicen por dónde empezar.
    tarjeta.siguiente
      ? "bg-primary text-white shadow-sm hover:bg-primary/90"
      : "border border-border bg-card text-foreground shadow-sm hover:bg-muted"
  }`;
  const contenidoBoton = (
    <>
      {tarjeta.cta} <ArrowRight className="size-4" />
    </>
  );

  return (
    <section
      aria-label={tarjeta.titulo}
      className={`relative flex min-h-64 flex-col overflow-hidden rounded-3xl border p-5 md:min-h-72 md:p-6 ${
        tarjeta.hecho
          ? "border-success/30 bg-success-subtle"
          : tarjeta.siguiente
            ? "border-primary/40 bg-card shadow-sm ring-1 ring-primary/15"
            : "border-border bg-card"
      }`}
    >
      <h2 className="relative z-10 flex items-center gap-2 text-xl font-bold tracking-tight md:text-2xl">
        {tarjeta.titulo}
        {tarjeta.hecho && <Tilde />}
      </h2>

      <Image
        src={ilustracion}
        alt=""
        width={1536}
        height={1024}
        sizes="(min-width: 768px) 460px, 85vw"
        priority={tarjeta.clave === "productos"}
        className="pointer-events-none absolute right-0 bottom-0 w-[88%] max-w-[460px] select-none"
      />

      <div className="absolute bottom-5 left-5 z-10 md:bottom-6 md:left-6">
        {tarjeta.bloqueado ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-card/90 px-4 text-sm text-muted-foreground">
            <Lock className="size-4" /> {tarjeta.bloqueado}
          </span>
        ) : tarjeta.accion ? (
          <button type="button" onClick={onAccion} className={claseBoton}>
            {contenidoBoton}
          </button>
        ) : (
          <Link href={tarjeta.href} prefetch={false} className={claseBoton}>
            {contenidoBoton}
          </Link>
        )}
      </div>
    </section>
  );
}

const ICONO_CHICA = {
  catalogo_publicado: Globe,
  marca: SlidersHorizontal,
  empleados: Users,
} as const;

function TarjetaChica({ tarjeta }: Readonly<{ tarjeta: TarjetaInicio }>) {
  const Icono = ICONO_CHICA[tarjeta.clave as keyof typeof ICONO_CHICA] ?? SlidersHorizontal;
  const contenido = (
    <>
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-xl border ${
          tarjeta.siguiente ? "border-primary/30 bg-primary text-white" : "border-border bg-background text-primary"
        }`}
      >
        {tarjeta.bloqueado ? <Lock className="size-4 text-muted-foreground" /> : <Icono className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug md:text-base">{tarjeta.titulo}</span>
        {tarjeta.bloqueado && <span className="block text-xs text-muted-foreground">{tarjeta.bloqueado}</span>}
        {tarjeta.opcional && !tarjeta.hecho && !tarjeta.bloqueado && (
          <span className="block text-xs text-muted-foreground">Opcional</span>
        )}
      </span>
      {tarjeta.hecho ? (
        <Tilde />
      ) : (
        !tarjeta.bloqueado && <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );
  const clase = `flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left ${
    tarjeta.bloqueado
      ? "border-border/60 bg-card/60 opacity-70"
      : tarjeta.siguiente
        ? "border-primary/40 bg-card shadow-sm ring-1 ring-primary/15 transition-transform duration-150 ease-out active:scale-[0.98]"
        : tarjeta.hecho
          ? "border-success/30 bg-success-subtle"
          : "border-border bg-card transition-[transform,background-color] duration-150 ease-out hover:bg-muted/50 active:scale-[0.98]"
  }`;

  if (tarjeta.bloqueado) {
    return (
      <div aria-disabled="true" className={clase}>
        {contenido}
      </div>
    );
  }
  return (
    <Link href={tarjeta.href} prefetch={false} className={clase}>
      {contenido}
    </Link>
  );
}
