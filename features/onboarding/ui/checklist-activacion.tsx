"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  calcularProgresoActivacion,
  type EstadoActivacion,
} from "../lib/pasos-activacion";
import { useCajaModalStore } from "@/shared/store/caja-modal-store";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useElegirCaminoStore } from "@/shared/store/elegir-camino-store";
import { ElegirCaminoDialog } from "./elegir-camino-dialog";
export function ChecklistActivacion({
  estado,
}: Readonly<{ estado: EstadoActivacion }>) {
  const [abierta, setAbierta] = useState(true);
  const { abierto: elegir, setAbierto: setElegir } = useElegirCaminoStore();
  const [ocultoPara, setOcultoPara] = useState<string | null>(null);
  const negocio = useNegocioActivo();
  const negocioId = negocio?.id;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const abrirCaja = useCajaModalStore((s) => s.abrir);
  const { pasos, completados, total, activado, siguiente } =
    calcularProgresoActivacion(estado);
  const clave = negocio ? "comerz:preparacion-oculta:" + negocio.id : null;
  useEffect(() => {
    // Al volver a montar el panel, no al elegir y navegar desde esta misma card.
    if (!negocioId || useElegirCaminoStore.getState().refrescarNegocioId !== negocioId) return;
    useElegirCaminoStore.getState().consumirRefresco();
    router.refresh();
  }, [negocioId, router]);
  const ocultoPersistido = useSyncExternalStore(
    (avisar) => {
      window.addEventListener("storage", avisar);
      return () => window.removeEventListener("storage", avisar);
    },
    () => {
      try {
        return clave ? localStorage.getItem(clave) === "1" : false;
      } catch {
        return false;
      }
    },
    () => false,
  );
  useEffect(() => {
    if (params.get("empezar") !== "1" || activado) return;
    setElegir(true);
    const q = new URLSearchParams(params.toString());
    q.delete("empezar");
    router.replace(pathname + (q.size ? "?" + q : ""), { scroll: false });
  }, [params, pathname, router, activado, setElegir]);
  const visibles = activado
    ? pasos.filter((p) => p.opcional && !p.hecho)
    : pasos.filter((p) => !p.opcional);
  if (
    !visibles.length ||
    (activado && clave && (ocultoPara === clave || ocultoPersistido))
  )
    return null;
  return (
    <section
      aria-label={activado ? "Preparación del negocio" : "Guía de inicio"}
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            {activado ? "Seguí preparando tu negocio" : "Poné Comerz en marcha"}
          </h2>
          {!activado && (
            <p className="mt-1 text-sm text-muted-foreground">
              {completados} de {total} listos.
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          className="h-11 shrink-0"
          onClick={() => {
            if (activado && clave) {
              try {
                localStorage.setItem(clave, "1");
              } catch {}
              setOcultoPara(clave);
            } else setAbierta((v) => !v);
          }}
        >
          {activado || abierta ? "Ocultar" : "Ver pasos"}
          <ChevronDown aria-hidden className="size-4" />
        </Button>
      </div>
      {!activado && (
        <div
          role="progressbar"
          aria-label="Progreso de la puesta en marcha"
          aria-valuenow={completados}
          aria-valuemin={0}
          aria-valuemax={total}
          className="mt-3 h-1 rounded-full bg-border"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: (completados / total) * 100 + "%" }}
          />
        </div>
      )}
      {abierta && (
        <ol className="mt-3 space-y-2">
          {visibles.map((paso) => (
            <li
              key={paso.clave}
              className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg py-2 sm:grid-cols-[20px_minmax(0,1fr)_auto]"
            >
              <span
                aria-hidden
                className={
                  "flex size-5 shrink-0 items-center justify-center rounded-full " +
                  (paso.hecho
                    ? "bg-primary text-primary-foreground"
                    : "border border-border")
                }
              >
                {paso.hecho && <Check className="size-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{paso.titulo}</p>
                {!paso.hecho && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {paso.detalle}
                  </p>
                )}
              </div>
              {!paso.hecho &&
                (paso.accion ? (
                  <Button
                    className="col-start-2 h-11 justify-self-start sm:col-start-3 sm:row-start-1 sm:self-center"
                    variant={
                      paso.clave === siguiente?.clave && !activado
                        ? "default"
                        : "ghost"
                    }
                    onClick={
                      paso.accion === "elegir-camino"
                        ? () => setElegir(true)
                        : abrirCaja
                    }
                  >
                    {paso.cta}
                  </Button>
                ) : (
                  <Button
                    asChild
                    className="col-start-2 h-11 justify-self-start sm:col-start-3 sm:row-start-1 sm:self-center"
                    variant={
                      paso.clave === siguiente?.clave && !activado
                        ? "default"
                        : "ghost"
                    }
                  >
                    <Link href={paso.href}>{paso.cta}</Link>
                  </Button>
                ))}
            </li>
          ))}
        </ol>
      )}
      <ElegirCaminoDialog
        rubro={estado.rubro}
        open={elegir}
        onOpenChange={setElegir}
      />
    </section>
  );
}
