"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  PackagePlus,
  Truck,
  UploadCloud,
} from "lucide-react";
import { toast } from "@/shared/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import type { Rubro } from "@/entities/config/types";
import { leerPlanillaProductos } from "@/features/stock/lib/leer-planilla-productos";
import {
  columnasDeRubro,
  ETIQUETA_RUBRO,
} from "@/features/stock/lib/columnas-por-rubro";
import {
  nombreArchivoPlantilla,
  plantillaImportProductos,
} from "@/features/stock/lib/plantilla-import-productos";
import { planillaAConciliacionAction } from "@/features/stock/actions/planilla-a-conciliacion";
import { BorradoresIngresoLista } from "@/features/stock/ui/borradores-ingreso-lista";

const EXTENSIONES = [".csv", ".tsv", ".xlsx", ".xls"];

/**
 * Ingresar mercadería: UN camino para todos los rubros.
 *
 * Antes eran dos botones distintos —"Ingresar Remito" y "Importar Planilla"—
 * elegidos por el rubro del comercio, como si una tienda de ropa no pudiera
 * cargar una planilla propia y una de electro no pudiera recibir un remito. La
 * diferencia real nunca fue el rubro: es quién escribió el archivo.
 *
 * Y las dos terminan en el mismo lugar, la conciliación. Que la planilla propia
 * también se verifique no es un paso de más: con 300 productos cargados nadie
 * se acuerda si "Remera blanca talle M Levis" ya existe o si la cargó escrita
 * distinto, y eso es lo que produce el catálogo duplicado.
 *
 * Lo que sí cambia por rubro es la PLANTILLA: una ferretería necesita medida y
 * material donde electro necesita IMEI y memoria.
 */
export function IngresarMercaderiaModal({
  open,
  onOpenChange,
  rubro,
  onAbrirRemitoProveedor,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rubro: Rubro;
  /** Abre el flujo del remito del proveedor, que ya tiene su propio modal con
   * el nombre del proveedor y el mapeo de columnas libres. */
  onAbrirRemitoProveedor: () => void;
}>) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [, startTransition] = useTransition();

  const columnas = columnasDeRubro(rubro);

  const descargarPlantilla = () => {
    const csv = plantillaImportProductos(rubro);
    // BOM: sin él, Excel en Windows abre los acentos rotos y el comercio cree
    // que el sistema exporta mal.
    const blob = new Blob([`﻿${csv}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivoPlantilla(rubro);
    a.click();
    URL.revokeObjectURL(url);
  };

  const subirPlanilla = async (file: File, forzar = false) => {
    setSubiendo(true);
    try {
      const matriz = await leerPlanillaProductos(file);
      const res = await planillaAConciliacionAction(matriz, file.name, forzar);

      if (res.error || !res.ordenId) {
        toast.error(res.error ?? "No se pudo leer la planilla.");
        return;
      }

      // El archivo ya se había subido. NO se crea otra orden: se ofrece ir a
      // la que ya existe. Crear una segunda y aprobar las dos duplicaría el
      // stock, que es el error que más caro salió en este sistema.
      if (res.yaSubida) {
        const ordenId = res.ordenId;
        toast.warning(
          res.yaAprobada
            ? "Esta planilla ya se ingresó y su stock ya está cargado."
            : "Esta planilla ya la subiste y está esperando revisión.",
          {
            duration: 10_000,
            action: {
              label: res.yaAprobada ? "Ver remito" : "Ir a revisar",
              onClick: () => router.push(`/compras/merge/${ordenId}`),
            },
            // Reingresar el mismo archivo a propósito existe (un segundo envío
            // idéntico), pero es explícito: sin esta puerta el guard sería una
            // pared.
            cancel: {
              label: "Subir igual",
              onClick: () => void subirPlanilla(file, true),
            },
          },
        );
        return;
      }

      const { resumen } = res;
      if (resumen && resumen.columnasIgnoradas.length > 0) {
        // Se avisa pero NO se frena: una columna de más es del comercio, no un
        // error del archivo, y frenar por eso lo deja sin poder importar.
        toast.warning(
          `Columnas que no se usan: ${resumen.columnasIgnoradas.join(", ")}`,
        );
      }
      if (resumen && resumen.invalidas > 0) {
        toast.warning(
          `${resumen.invalidas} fila${resumen.invalidas === 1 ? "" : "s"} sin nombre de producto se dejaron afuera.`,
        );
      }

      toast.success("Planilla lista para revisar");
      onOpenChange(false);
      // A conciliar: es donde se ve qué es nuevo, qué ya existe y qué puede
      // estar cargado con otro nombre.
      startTransition(() => router.push(`/compras/merge/${res.ordenId}`));
    } catch (error) {
      console.error("[INGRESAR MERCADERIA]", error);
      toast.error("No se pudo leer el archivo. ¿Es un CSV o Excel válido?");
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ingresar mercadería</DialogTitle>
          <DialogDescription>
            Los dos caminos terminan en la misma revisión, donde vas a ver qué
            es nuevo y qué ya tenías cargado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* LO EMPEZADO Y SIN TERMINAR, PRIMERO. Antes la única forma de
              enterarse de que un remito quedó a medias era volver a subir el
              mismo archivo y toparse con el guard de hash — y el remito de
              proveedor, que no tiene hash, no avisaba nunca. */}
          <BorradoresIngresoLista onIr={() => onOpenChange(false)} />

          {/* PROVEEDOR — primero porque es el caso más frecuente y el que más
              trabajo ahorra: sus nombres nunca coinciden con el catálogo. */}
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onAbrirRemitoProveedor();
            }}
            className="flex w-full items-start gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:bg-muted/50"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/10">
              <Truck className="size-5 text-success" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold">De un proveedor</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Su planilla, con sus nombres y su formato. El sistema propone
                contra qué producto tuyo va cada línea y aprende para la próxima.
              </p>
            </div>
          </button>

          {/* PLANILLA PROPIA */}
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <FileSpreadsheet className="size-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Planilla propia</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Con las columnas de Comerz para{" "}
                  {ETIQUETA_RUBRO[rubro].toLowerCase()}.
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-lg bg-muted/50 p-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">
                Columnas de tu rubro
              </p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-foreground">
                {columnas.map((c) => c.clave).join(" · ")}
              </p>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="flex-1 gap-2"
                onClick={descargarPlantilla}
              >
                <Download className="size-4" />
                Descargar plantilla
              </Button>

              <Button
                type="button"
                className="flex-1 gap-2"
                disabled={subiendo}
                onClick={() => inputRef.current?.click()}
              >
                {subiendo ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <UploadCloud className="size-4" />
                )}
                {subiendo ? "Leyendo..." : "Subir planilla"}
              </Button>
            </div>

            <Label htmlFor="planilla-mercaderia" className="sr-only">
              Archivo de la planilla
            </Label>
            <Input
              id="planilla-mercaderia"
              ref={inputRef}
              type="file"
              accept={EXTENSIONES.join(",")}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Se limpia el input para que elegir el MISMO archivo otra vez
                // vuelva a disparar onChange.
                e.target.value = "";
                if (file) void subirPlanilla(file);
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
