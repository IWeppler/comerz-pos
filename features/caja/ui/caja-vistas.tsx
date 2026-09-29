"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { History, List, PiggyBank, Wallet } from "lucide-react";

type Vista = "hoy" | "dinero" | "movimientos" | "cierres";

/** A dónde se puede navegar desde adentro del contenido de una vista. */
export type DestinoCaja = Vista;

const NavegacionCaja = createContext<((destino: DestinoCaja) => void) | null>(
  null,
);

/**
 * Para que un componente de adentro de una vista mande a otra: el saldo de
 * "Cajas abiertas" salta a Hoy.
 *
 * Fuera del shell devuelve null en vez de explotar — así un bloque de Dinero
 * se puede montar suelto (en un test, o en otra pantalla) y simplemente no
 * ofrece el salto.
 */
export function useNavegacionCaja(): ((destino: DestinoCaja) => void) | null {
  return useContext(NavegacionCaja);
}

interface CajaVistasProps {
  /** Flujo de cajera: apertura, movimientos del turno y cierre. */
  miTurno: ReactNode;
  /** Cómo viene el día: cobrado, fiado, medios de pago y arqueo.
   * Ausente = el usuario no tiene caja.ver_gerencial. */
  resumenHoy?: ReactNode;
  /** Dónde está la plata: cuentas, saldos y lo que está por caer. Misma
   * condición de permiso que `resumenHoy`. */
  dinero?: ReactNode;
  /** Qué pasó con la plata, una fila por movimiento y sin separar por turno.
   * Ausente = el usuario no tiene `caja.ver_movimientos`. Dinero es la foto;
   * esto es cada paso que llevó a esa foto. */
  movimientos?: ReactNode;
  /** Turnos pasados y cierres firmados. Lo ve cualquiera: son los turnos que
   * esa persona ya podía ver. */
  historial: ReactNode;
  /** false para la dueña que nunca abre caja: no se le muestra el bloque de
   * turno. Siempre puede abrir uno desde el botón de caja del navbar. */
  esCajera: boolean;
  vistaInicial: Vista;
}

/**
 * Las vistas de /caja, separadas por PREGUNTA y no por de dónde sale el dato:
 *
 *   Hoy          ¿qué tengo que hacer ahora y cómo viene el día?
 *   Dinero       ¿cuánto tengo y dónde?
 *   Movimientos  ¿qué pasó, uno por uno, entre tal día y tal otro?
 *   Cierres      ¿qué turnos se cerraron y con qué diferencia?
 *
 * "Mi turno" y el resumen del día son la misma pregunta con dos niveles de
 * zoom —lo que estoy operando y cómo va la jornada—, así que van juntos en
 * Hoy: el turno arriba, que es lo accionable, y el resumen abajo. Lo que sí
 * es otra pregunta es "cuánto tengo", que es una foto del momento y no del
 * día; mezclarlas fue el problema original.
 *
 * Movimientos es pestaña propia (29/9/2026). Estuvo escondida detrás de un
 * botón de Dinero para ahorrar lugar en la barra, el botón se perdió en un
 * rediseño y la tabla quedó sin puerta. Mientras tanto la pregunta real de
 * los dueños era de trazabilidad —"todas las transferencias del sábado"—, y
 * sin esta tabla había que abrir el detalle de cada turno y buscarlas a mano.
 * Dinero y Cierres no la reemplazan: Dinero suma los cobros por cuenta y día,
 * y Cierres los separa por turno.
 *
 * Cada vista se monta sola: traen tablas, formularios y fetch propios, y
 * tenerlas ocultas con CSS duplicaría estado sin motivo.
 */
export function CajaVistas({
  miTurno,
  resumenHoy,
  dinero,
  movimientos,
  historial,
  esCajera,
  vistaInicial,
}: Readonly<CajaVistasProps>) {
  const searchParams = useSearchParams();

  const opciones: { valor: DestinoCaja; label: string; Icono: typeof Wallet }[] = [
    // Hoy existe si hay ALGO que mostrar: el turno propio, el resumen, o los
    // dos. Una cajera sin permiso gerencial ve solo su turno; una dueña que
    // no opera caja ve solo el resumen.
    ...(esCajera || resumenHoy
      ? [{ valor: "hoy" as const, label: "Hoy", Icono: Wallet }]
      : []),
    ...(dinero
      ? [{ valor: "dinero" as const, label: "Dinero", Icono: PiggyBank }]
      : []),
    ...(movimientos
      ? [{ valor: "movimientos" as const, label: "Movimientos", Icono: List }]
      : []),
    { valor: "cierres" as const, label: "Cierres", Icono: History },
  ];

  // `?vista=` sigue aceptando `historial`, que es como se llamaba Cierres:
  // un link viejo —o un bookmark de la dueña— tiene que seguir abriendo la
  // misma pantalla.
  const pedida = searchParams.get("vista");
  const vistaPedida = (pedida === "historial" ? "cierres" : pedida) as
    | DestinoCaja
    | null;

  const inicial = opciones.some((o) => o.valor === vistaPedida)
    ? vistaPedida!
    : opciones.some((o) => o.valor === vistaInicial)
      ? vistaInicial
      : opciones[0].valor;

  const [vista, setVista] = useState<DestinoCaja>(inicial);

  // Las pestañas disponibles como clave primitiva: `opciones` se rearma en
  // cada render, así que no sirve como dependencia de un memo.
  const disponibles = opciones.map((o) => o.valor).join(",");

  const navegar = useMemo(
    () => (destino: DestinoCaja) => {
      // Un salto a una pestaña que esta persona no tiene se ignora, en vez
      // de dejar `vista` apuntando a algo que no está en la barra.
      if (!disponibles.split(",").includes(destino)) return;
      setVista(destino);
      // Volver a la vista anterior dejaría el scroll donde estaba la tabla,
      // que en una pantalla larga es el medio de la nada.
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [disponibles],
  );

  const activa = opciones.some((o) => o.valor === vista) ? vista : inicial;

  const contenido: Record<string, ReactNode> = {
    hoy: (
      <div className="space-y-8">
        {esCajera && miTurno}
        {resumenHoy}
      </div>
    ),
    dinero,
    movimientos,
    cierres: historial,
  };

  return (
    <NavegacionCaja.Provider value={navegar}>
      <div className="space-y-6">
        {/* Scroll horizontal en vez de wrap: envolver a dos líneas empuja el
            contenido hacia abajo en un celular angosto. */}
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
                onClick={() => navegar(valor)}
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
    </NavegacionCaja.Provider>
  );
}
