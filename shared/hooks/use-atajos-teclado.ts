"use client";

import { useEffect, useRef } from "react";

export type Atajo = {
  /** Combinación, en el formato "F4", "ctrl+Enter", "alt+1",
   * "ctrl+shift+Backspace", "/" — modificadores primero, tecla al final. */
  teclas: string;
  correr: () => void;
  /** Con false el atajo no se escucha. Sirve para los que dependen del estado
   * de la pantalla (ej. Esc solo cuando hay algo que cancelar). */
  activo?: boolean;
  /** Fuerza que ande —o que no ande— con el foco dentro de un campo de texto.
   * Sin declarar manda la regla de abajo. */
  enCampoDeTexto?: boolean;
};

const ETIQUETAS_CAMPO = ["INPUT", "TEXTAREA", "SELECT"];

/**
 * ¿El foco está en algo donde la persona está ESCRIBIENDO?
 *
 * En el POS esto es la regla, no la excepción: el buscador se lleva el foco
 * apenas se entra, y el lector de código de barras escribe ahí como si fuera
 * un teclado muy rápido.
 */
function enCampoDeTexto(objetivo: EventTarget | null): boolean {
  if (!(objetivo instanceof HTMLElement)) return false;
  if (objetivo.isContentEditable) return true;
  return ETIQUETAS_CAMPO.includes(objetivo.tagName);
}

/**
 * ¿Hay un diálogo, sheet o popover abierto encima?
 *
 * Cuando lo hay, el teclado es de esa capa: un Esc tiene que cerrarla, y un F4
 * no puede seguir avanzando el checkout que quedó atrás. Se mira el DOM y no
 * un estado propio porque las capas las abren diez componentes distintos y
 * ninguno le avisa a este hook.
 */
function hayCapaAbierta(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-slot="popover-content"][data-state="open"]',
    ),
  );
}

/** La barra espaciadora se escribe "Space" y no " ": el separador de este
 * formato es "+", así que un espacio literal al final de "ctrl+ " es
 * invisible en el código y lo borra el primer formateo. */
function normalizarTecla(tecla: string): string {
  return tecla.toLowerCase() === "space" ? " " : tecla;
}

function coincide(evento: KeyboardEvent, teclas: string): boolean {
  const partes = teclas.split("+");
  const tecla = normalizarTecla(partes[partes.length - 1]);
  const modificadores = partes.slice(0, -1).map((m) => m.toLowerCase());

  const esperaCtrl = modificadores.includes("ctrl");
  const esperaShift = modificadores.includes("shift");
  const esperaAlt = modificadores.includes("alt");

  // Ctrl y Cmd se aceptan indistinto: la misma app corre en la PC del local y
  // en una Mac, y nadie va a recordar dos combinaciones.
  if (esperaCtrl !== (evento.ctrlKey || evento.metaKey)) return false;
  if (esperaShift !== evento.shiftKey) return false;
  if (esperaAlt !== evento.altKey) return false;

  // `key` undefined en keydown sintéticos (autocompletado de Chrome,
  // extensiones); ver paleta-comandos.tsx.
  return evento.key?.toLowerCase() === tecla.toLowerCase();
}

/** Una tecla F o cualquier combinación con modificador no se confunde con
 * escribir; una letra o un símbolo suelto, sí. */
function seguroEnCampoDeTexto(teclas: string): boolean {
  if (teclas.includes("+")) return true;
  return /^F\d{1,2}$/i.test(teclas) || teclas === "Escape";
}

/**
 * Atajos de teclado de una pantalla, con las dos reglas que los hacen usables
 * en un mostrador:
 *
 * 1. **Nada de teclas sueltas mientras se escribe.** El lector de códigos
 *    escribe en el buscador a cientos de caracteres por minuto; un atajo de
 *    una letra se dispararía a mitad de un código escaneado. Por eso una tecla
 *    suelta se ignora si el foco está en un campo, salvo que el atajo diga lo
 *    contrario, y las F y las combinaciones con Ctrl/Alt sí pasan siempre.
 * 2. **La capa de arriba manda.** Con un modal o un popover abierto no corre
 *    ningún atajo de la pantalla de atrás.
 *
 * Los handlers viven en una ref: así se pueden pasar funciones nuevas en cada
 * render (que es lo normal) sin volver a suscribir el listener en cada uno.
 */
export function useAtajosTeclado(atajos: Atajo[]) {
  const atajosRef = useRef(atajos);

  // La ref se actualiza DESPUÉS del render, no durante: escribirla en el
  // cuerpo del componente es leer y escribir estado mutable mientras React
  // renderiza, que es justo lo que rompe con render concurrente.
  useEffect(() => {
    atajosRef.current = atajos;
  });

  useEffect(() => {
    const alPresionar = (evento: KeyboardEvent) => {
      if (evento.repeat) return;
      if (hayCapaAbierta()) return;

      const escribiendo = enCampoDeTexto(evento.target);

      for (const atajo of atajosRef.current) {
        if (atajo.activo === false) continue;
        if (!coincide(evento, atajo.teclas)) continue;

        const permitido =
          atajo.enCampoDeTexto ?? seguroEnCampoDeTexto(atajo.teclas);
        if (escribiendo && !permitido) continue;

        evento.preventDefault();
        atajo.correr();
        return;
      }
    };

    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, []);
}
