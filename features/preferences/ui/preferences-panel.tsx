"use client";

import { useState, useEffect } from "react";
import { Button } from "@/shared/ui/button";
import { Download, CheckCircle2 } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { useInstalacionPwa } from "@/shared/lib/use-instalacion-pwa";
import { InstruccionesInstalacion } from "@/shared/components/instrucciones-instalacion";
import { SelectorTema } from "./selector-tema";

export function PreferencesPanel() {
  const [mounted, setMounted] = useState(false);
  const { metodo, instalar } = useInstalacionPwa();
  const [instruccionesAbiertas, setInstruccionesAbiertas] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  const estaInstalada = metodo?.tipo === "instalada";
  const hayPromptNativo = metodo?.tipo === "prompt";

  const handleInstallClick = async () => {
    if (!metodo || estaInstalada) return;

    // Sin prompt nativo el botón no puede instalar nada por su cuenta. En vez
    // del toast viejo —que mandaba al "menú de tres puntos", inexistente en
    // Safari— se abre el instructivo que corresponde a este navegador.
    if (metodo.tipo === "ios-manual" || metodo.tipo === "abrir-en-navegador") {
      setInstruccionesAbiertas(true);
      return;
    }

    // Queda el caso sin instructivo propio: escritorio, o Chromium que todavía
    // no ofreció el prompt. Ahí el menú del navegador sí es la respuesta.
    if (!hayPromptNativo) {
      toast.info("Instalación manual", {
        description:
          "Abrí el menú de tu navegador y elegí 'Instalar aplicación' o 'Agregar a pantalla de inicio'.",
      });
      return;
    }

    const resultado = await instalar();
    if (resultado === "accepted") {
      toast.success("¡Aplicación instalada con éxito!");
    }
  };

  if (!mounted) return null;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-1">
          Preferencias
        </h2>
        <p className="text-muted-foreground text-sm">
          Personaliza la apariencia de la plataforma y gestiona la aplicación
          instalable.
        </p>
      </div>

      {/* TEMA — dos tarjetas con la miniatura de cada modo; al elegir, la
          página se repinta con el círculo difuminado. Ver selector-tema.tsx. */}
      <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h3 className="text-lg font-bold text-foreground">Tema</h3>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">Elegí cómo se ve Comerz en este dispositivo.</p>
        <div className="max-w-2xl">
          <SelectorTema />
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* INSTALACIÓN PWA */}
        <div className="bg-card p-6 rounded-lg border border-border flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 bg-success/10 text-success rounded-xl flex items-center justify-center mb-4">
              <Download className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-foreground mb-2">
              Instalar Aplicación (PWA)
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Instala el sistema POS en tu dispositivo para acceder rápidamente
              desde tu pantalla de inicio, sin distracciones del navegador.
            </p>
          </div>

          <Button
            onClick={handleInstallClick}
            disabled={estaInstalada}
            className={`w-full font-semibold h-12 uppercase transition-all ${
              estaInstalada
                ? "bg-success/10 text-success"
                : hayPromptNativo
                  ? "bg-primary hover:bg-primary/90 text-white"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {estaInstalada ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" /> App ya instalada
              </>
            ) : hayPromptNativo ? (
              "Instalar App ahora"
            ) : (
              "Cómo instalar en este dispositivo"
            )}
          </Button>
        </div>
      </div>

      {metodo && (
        <InstruccionesInstalacion
          metodo={metodo}
          abierto={instruccionesAbiertas}
          onAbiertoChange={setInstruccionesAbiertas}
        />
      )}
    </div>
  );
}
