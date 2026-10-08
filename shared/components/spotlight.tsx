"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Popover } from "radix-ui";
import { motion, useReducedMotion } from "motion/react";

interface Medida {
  x: number;
  y: number;
  width: number;
  height: number;
  container: HTMLElement;
}
/** No captura eventos: el control real sigue recibiendo el toque. */
export function Spotlight({
  selector,
  texto,
  onSalir,
}: Readonly<{ selector: string; texto: string; onSalir: () => void }>) {
  const [rect, setRect] = useState<Medida | null>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    let frame = 0;
    let observado: HTMLElement | null = null;
    const resize = new ResizeObserver(() => programar());
    const medir = () => {
      frame = 0;
      const modal = [
        ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ].some(
        (el) =>
          !el.hasAttribute("data-wizard-popover") &&
          el.dataset.slot !== "drawer-content" &&
          el.getBoundingClientRect().width > 0,
      );
      const elemento = [
        ...document.querySelectorAll<HTMLElement>(selector),
      ].find((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(el).visibility !== "hidden" &&
          !el.closest('[aria-hidden="true"]')
        );
      });
      if (!elemento || modal) {
        setRect((actual) => (actual === null ? actual : null));
        return;
      }
      if (elemento !== observado) {
        resize.disconnect();
        resize.observe(elemento);
        observado = elemento;
      }
      const r = elemento.getBoundingClientRect();
      const container =
        elemento.closest<HTMLElement>('[data-slot="drawer-content"]') ??
        document.body;
      // Vaul transforma el drawer: fixed queda relativo a ese contenedor.
      const origen =
        container === document.body
          ? { left: 0, top: 0 }
          : container.getBoundingClientRect();
      const nuevo = {
        x: r.left - origen.left - 6,
        y: r.top - origen.top - 6,
        width: r.width + 12,
        height: r.height + 12,
        container,
      };
      setRect((actual) =>
        actual &&
        Object.keys(nuevo).every(
          (key) => actual[key as keyof Medida] === nuevo[key as keyof Medida],
        )
          ? actual
          : nuevo,
      );
    };
    function programar() {
      if (!frame) frame = requestAnimationFrame(medir);
    }
    const mutation = new MutationObserver(programar);
    mutation.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "aria-hidden", "data-state"],
    });
    window.addEventListener("resize", programar);
    window.addEventListener("scroll", programar, true);
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSalir();
    };
    window.addEventListener("keydown", escape);
    programar();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", programar);
      window.removeEventListener("scroll", programar, true);
      window.removeEventListener("keydown", escape);
    };
  }, [selector, onSalir]);
  if (!rect) return null;
  return createPortal(
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] rounded-lg"
        style={{
          transform: `translate(${rect.x}px, ${rect.y}px)`,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
          transition: reduce
            ? "none"
            : "transform 250ms cubic-bezier(0.23,1,0.32,1), width 250ms cubic-bezier(0.23,1,0.32,1), height 250ms cubic-bezier(0.23,1,0.32,1)",
        }}
      />
      <Popover.Root open modal={false}>
        <Popover.Anchor asChild>
          <div
            aria-hidden
            className="pointer-events-none fixed"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            }}
          />
        </Popover.Anchor>
        <Popover.Portal container={rect.container}>
          <Popover.Content
            asChild
            side="bottom"
            sideOffset={12}
            collisionPadding={16}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={onSalir}
          >
            <motion.div
              data-wizard-popover
              className="pointer-events-auto z-[61] w-[min(320px,calc(100vw-32px))] rounded-xl border border-border bg-popover p-4 text-sm text-popover-foreground shadow-xl"
              initial={{
                opacity: 0,
                transform: reduce ? "none" : "scale(0.97)",
              }}
              animate={{ opacity: 1, transform: "scale(1)" }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            >
              <p>{texto}</p>
              <button
                type="button"
                onClick={onSalir}
                className="mt-2 min-h-11 text-sm font-medium text-primary underline underline-offset-4"
              >
                Lo hago después
              </button>
            </motion.div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>,
    rect.container,
  );
}
