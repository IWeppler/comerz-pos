"use client";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui/dialog";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useWizardInicioStore } from "@/shared/store/wizard-inicio-store";
import { useElegirCaminoStore } from "@/shared/store/elegir-camino-store";
import { registrarHitoActivacionAction } from "../actions/registrar-hito";
import { caminosInicio } from "../lib/caminos-inicio";

export function ElegirCaminoDialog({
  open,
  onOpenChange,
  rubro,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rubro: string;
}>) {
  const router = useRouter();
  const negocio = useNegocioActivo();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>¿Cómo querés empezar?</DialogTitle>
          <DialogDescription>
            Elegí el camino que te quede más cómodo. Podés cargar el resto
            después.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {caminosInicio(rubro).map((camino) => (
            <button
              key={camino.hito}
              type="button"
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border p-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => {
                if (negocio) useElegirCaminoStore.getState().pedirRefresco(negocio.id);
                void registrarHitoActivacionAction(camino.hito).catch((error) => console.error("[HITO ACTIVACION] transporte", error));
                if (camino.hito === "CAMINO_VENTA_LIBRE" && negocio)
                  useWizardInicioStore.getState().iniciar(negocio.id);
                onOpenChange(false);
                router.push(camino.href);
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {camino.titulo}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {camino.detalle}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
