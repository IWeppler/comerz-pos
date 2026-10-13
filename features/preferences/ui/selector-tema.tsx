"use client";

import type { MouseEvent } from "react";
import { Check } from "lucide-react";
import { useTheme } from "next-themes";
import { useReducedMotion } from "motion/react";
import { cambiarTemaConTransicion } from "@/shared/ui/theme-toggle";

type Tema = "light" | "dark";

/**
 * Tema de la app (Configuración › Preferencias): dos tarjetas con una
 * miniatura de la interfaz en cada modo, como en la referencia de Nacho
 * (13/10/2026). Al elegir, la página se repinta con el círculo difuminado de
 * beui ("circle blur") saliendo desde la tarjeta tocada.
 *
 * Si alguien tenía elegido "system" (lo ofrecía el selector anterior), se marca
 * la tarjeta del tema que está viendo; tocar una lo fija.
 *
 * Las miniaturas tienen colores FIJOS a propósito: muestran cómo se ve cada
 * modo, no el modo actual.
 */
export function SelectorTema() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const reducirMovimiento = useReducedMotion() ?? false;
  const delDispositivo = theme === "system";
  const actual: Tema = resolvedTheme === "dark" ? "dark" : "light";

  function elegir(tema: Tema, evento: MouseEvent<HTMLButtonElement>) {
    if (tema === actual && !delDispositivo) return;
    const caja = evento.currentTarget.getBoundingClientRect();
    const origen = { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 };
    // Si el tema que se ve ya es ese (venía del dispositivo), solo se fija: no
    // hay nada que repintar.
    if (tema === actual) {
      setTheme(tema);
      return;
    }
    cambiarTemaConTransicion(tema, setTheme, { variant: "circle-blur", origen, reducirMovimiento });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        <TarjetaTema tema="light" nombre="Claro" elegido={actual === "light"} onElegir={elegir} />
        <TarjetaTema tema="dark" nombre="Oscuro" elegido={actual === "dark"} onElegir={elegir} />
      </div>
    </div>
  );
}

const PALETA: Record<Tema, { fondo: string; panel: string; lateral: string; linea: string; punto: string }> = {
  light: { fondo: "#ffffff", panel: "#ffffff", lateral: "#f4f4f5", linea: "#d4d4d8", punto: "#a1a1aa" },
  dark: { fondo: "#18181b", panel: "#1f1f23", lateral: "#27272a", linea: "#3f3f46", punto: "#52525b" },
};

function TarjetaTema({
  tema,
  nombre,
  elegido,
  onElegir,
}: Readonly<{
  tema: Tema;
  nombre: string;
  elegido: boolean;
  onElegir: (tema: Tema, evento: MouseEvent<HTMLButtonElement>) => void;
}>) {
  const p = PALETA[tema];
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-pressed={elegido}
        aria-label={`Tema ${nombre.toLowerCase()}`}
        onClick={(e) => onElegir(tema, e)}
        className={`relative block w-full overflow-hidden rounded-2xl p-3 outline-none transition-[box-shadow,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] sm:p-4 ${
          elegido ? "ring-2 ring-primary" : "ring-1 ring-border hover:ring-foreground/20"
        }`}
        style={{ background: tema === "dark" ? "#0f0f11" : "#fafafa" }}
      >
        <Miniatura p={p} />
        {elegido && (
          <span className="absolute bottom-2.5 right-2.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm sm:bottom-3 sm:right-3 sm:size-7">
            <Check className="size-3.5 sm:size-4" strokeWidth={3} />
          </span>
        )}
      </button>
      <p className="text-sm font-medium text-foreground">{nombre}</p>
    </div>
  );
}

/** Una ventana chiquita: barra lateral, encabezado y renglones. */
function Miniatura({ p }: Readonly<{ p: (typeof PALETA)[Tema] }>) {
  const linea = (ancho: string) => <span className="block h-1.5 rounded-full" style={{ width: ancho, background: p.linea }} />;
  return (
    <span
      aria-hidden
      className="flex aspect-[16/10] overflow-hidden rounded-lg shadow-sm"
      style={{ background: p.panel, boxShadow: `0 0 0 1px ${p.linea}55` }}
    >
      <span className="flex w-[32%] flex-col gap-1.5 p-2" style={{ background: p.lateral }}>
        <span className="flex gap-1">
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} className="size-1.5 rounded-full" style={{ background: c }} />
          ))}
        </span>
        <span className="mt-1 flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: p.punto }} />
          {linea("60%")}
        </span>
        {linea("80%")}
        {linea("65%")}
        {linea("75%")}
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-2.5" style={{ background: p.fondo }}>
        <span className="size-3 rounded-full" style={{ background: p.punto }} />
        {linea("45%")}
        <span className="mt-1 flex flex-col gap-1.5">
          {linea("90%")}
          {linea("75%")}
          {linea("85%")}
          {linea("60%")}
        </span>
      </span>
    </span>
  );
}
