"use client";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/shared/ui/button";
import { createClient } from "@/shared/config/supabase/client";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useElegirCaminoStore } from "@/shared/store/elegir-camino-store";
import { detectarPrimeraVenta } from "../lib/primera-venta";
import { registrarHitoActivacionAction } from "../actions/registrar-hito";

export function FestejoPrimeraVenta({
  onSeguir,
}: Readonly<{ onSeguir: () => void }>) {
  const negocio = useNegocioActivo();
  const reduce = useReducedMotion();
  const [festejar, setFestejar] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!negocio) return;
    useElegirCaminoStore.getState().pedirRefresco(negocio.id);
    let cancelado = false;
    let almacen: Storage | null = null;
    try {
      almacen = localStorage;
    } catch {}
    void detectarPrimeraVenta(negocio.id, almacen, async () => {
      const { count, error } = await createClient()
        .from("ventas")
        .select("id", { count: "exact", head: true })
        .eq("negocio_id", negocio.id)
        .eq("estado_operacion", "CONFIRMADA");
      return error ? null : count;
    }).then((primera) => {
      if (primera && !cancelado) {
        setFestejar(true);
        void registrarHitoActivacionAction("PRIMERA_VENTA_FESTEJADA").catch((error) => console.error("[HITO ACTIVACION] transporte", error));
      }
    });
    return () => {
      cancelado = true;
    };
  }, [negocio]);
  useEffect(() => {
    if (!festejar || reduce || !canvas.current) return;
    let cancelado = false;
    let limpiar: (() => void) | undefined;
    void import("canvas-confetti")
      .then(({ default: confetti }) => {
        if (cancelado || !canvas.current) return;
        const disparar = confetti.create(canvas.current, { resize: true });
        limpiar = () => disparar.reset();
        void disparar({
          particleCount: 120,
          spread: 70,
          origin: { y: 0.9 },
          disableForReducedMotion: true,
        });
      })
      .catch((error) => console.error("[FESTEJO]", error));
    return () => {
      cancelado = true;
      limpiar?.();
    };
  }, [festejar, reduce]);
  if (!festejar) return null;
  return (
    <>
      <canvas
        ref={canvas}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[60] h-full w-full"
      />
      <motion.section
        className="w-full rounded-xl border border-success/20 bg-success/10 p-4 text-left"
        initial={{
          opacity: 0,
          transform: reduce ? "none" : "translateY(8px) scale(0.96)",
        }}
        animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
        transition={
          reduce
            ? { duration: 0.2 }
            : { type: "spring", duration: 0.5, bounce: 0.2 }
        }
      >
        <h2 className="text-sm font-semibold">🎉 Primera venta registrada</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ya estás usando Comerz.
        </p>
        <Button onClick={onSeguir} className="mt-3 h-11 w-full">
          Seguir vendiendo
        </Button>
      </motion.section>
    </>
  );
}
