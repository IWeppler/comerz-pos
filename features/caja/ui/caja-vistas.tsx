"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { History, PiggyBank, Wallet } from "lucide-react";

type Vista = "hoy" | "dinero" | "historial";

interface CajaVistasProps {
  /** Flujo de cajera: apertura, movimientos del turno y cierre. */
  miTurno: ReactNode;
  /** Cómo viene el día: cobrado, fiado, medios de pago y arqueo.
   * Ausente = el usuario no tiene caja.ver_gerencial. */
  resumenHoy?: ReactNode;
  /** Dónde está la plata: efectivo, por acreditar, acreditado. Misma
   * condición de permiso que `resumenHoy`. */
  dinero?: ReactNode;
  /** Turnos pasados. Lo ve cualquiera: son los turnos que ya podía ver. */
  historial: ReactNode;
  /** false para la dueña que nunca abre caja: no se le muestra el bloque de
   * turno. Siempre puede abrir uno desde el botón de caja del navbar. */
  esCajera: boolean;
  vistaInicial: Vista;
}

/**
 * Las vistas de /caja, separadas por PREGUNTA y no por de dónde sale el dato:
 *
 *   Hoy        ¿qué tengo que hacer ahora y cómo viene el día?
 *   Dinero     ¿cuánto tengo y dónde?
 *   Historial  ¿qué pasó?
 *
 * "Mi turno" y el resumen del día son la misma pregunta con dos niveles de
 * zoom —lo que estoy operando y cómo va la jornada—, así que van juntos en
 * Hoy: el turno arriba, que es lo accionable, y el resumen abajo. Lo que sí
 * es otra pregunta es "cuánto tengo", que es una foto del momento y no del
 * día; mezclarlas fue el problema original.
 *
 * Cada vista se monta sola: traen tablas, formularios y fetch propios, y
 * tenerlas ocultas con CSS duplicaría estado sin motivo.
 */
export function CajaVistas({
  miTurno,
  resumenHoy,
  dinero,
  historial,
  esCajera,
  vistaInicial,
}: Readonly<CajaVistasProps>) {
  const searchParams = useSearchParams();
  const opciones: { valor: Vista; label: string; Icono: typeof Wallet }[] = [
    // Hoy existe si hay ALGO que mostrar: el turno propio, el resumen, o los
    // dos. Una cajera sin permiso gerencial ve solo su turno; una dueña que
    // no opera caja ve solo el resumen.
    ...(esCajera || resumenHoy
      ? [{ valor: "hoy" as const, label: "Hoy", Icono: Wallet }]
      : []),
    ...(dinero
      ? [{ valor: "dinero" as const, label: "Dinero", Icono: PiggyBank }]
      : []),
    { valor: "historial" as const, label: "Historial", Icono: History },
  ];

  // Si la vista inicial no está disponible (sin permiso, o no es cajera), cae
  // en la primera que sí lo esté en vez de renderizar una pestaña vacía.
  const vistaPedida = searchParams.get("vista") as Vista | null;
  const inicial = opciones.some((o) => o.valor === vistaPedida)
    ? vistaPedida!
    : opciones.some((o) => o.valor === vistaInicial)
      ? vistaInicial
    : opciones[0].valor;

  const [vista, setVista] = useState<Vista>(inicial);
  const activa = opciones.some((o) => o.valor === vista) ? vista : inicial;

  const contenido: Record<Vista, ReactNode> = {
    hoy: (
      <div className="space-y-8">
        {esCajera && miTurno}
        {resumenHoy}
      </div>
    ),
    dinero,
    historial,
  };

  return (
    <div className="space-y-6">
      {/* Scroll horizontal en vez de wrap: con 4 pestañas y un celular
          angosto, envolver a dos líneas empuja el contenido hacia abajo. */}
      <div
        role="tablist"
        aria-label="Vista de caja"
        className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1"
      >
        {opciones.map(({ valor, label, Icono }) => {
          const esActiva = activa === valor;
          return (
            <button
              key={valor}
              type="button"
              role="tab"
              aria-selected={esActiva}
              onClick={() => setVista(valor)}
              className={`inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors sm:h-9 ${
                esActiva
                  ? "border-border bg-card text-foreground"
                  : "border-transparent bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icono className="h-3.5 w-3.5 shrink-0" />
              {label}
            </button>
          );
        })}
      </div>

      {contenido[activa]}
    </div>
  );
}
