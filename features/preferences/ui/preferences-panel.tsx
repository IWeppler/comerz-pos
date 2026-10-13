"use client";

import { useState, useEffect } from "react";
import { Button } from "@/shared/ui/button";
import {
  Moon,
  Sun,
  Download,
  MonitorSmartphone,
  CheckCircle2,
} from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { useTheme } from "next-themes";
import { useInstalacionPwa } from "@/shared/lib/use-instalacion-pwa";
import { InstruccionesInstalacion } from "@/shared/components/instrucciones-instalacion";

export function PreferencesPanel() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* TEMA VISUAL */}
        <div className="bg-card p-6 rounded-xl border border-border flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center mb-4">
              {theme === "dark" ? (
                <Moon className="w-5 h-5" />
              ) : (
                <Sun className="w-5 h-5" />
              )}
            </div>
            <h3 className="text-lg font-bold text-foreground mb-2">
              Tema Visual
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Elige entre el modo claro para el día o el modo oscuro para
              ambientes con poca luz.
            </p>
          </div>

          <div className="flex bg-muted/50 p-1 rounded-xl border border-border/50">
            <button
              onClick={() => setTheme("light")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                theme === "light"
                  ? "bg-background text-foreground ring-1 ring-black/5 dark:ring-white/10"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sun className="w-4 h-4" /> Claro
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                theme === "dark"
                  ? "bg-background text-foreground ring-1 ring-black/5 dark:ring-white/10"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Moon className="w-4 h-4" /> Oscuro
            </button>
            <button
              onClick={() => setTheme("system")}
              className={`flex-1 items-center justify-center gap-2 py-2.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all hidden sm:flex ${
                theme === "system"
                  ? "bg-background text-foreground ring-1 ring-black/5 dark:ring-white/10"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MonitorSmartphone className="w-4 h-4" /> Auto
            </button>
          </div>
        </div>

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
