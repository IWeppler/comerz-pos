"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
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
import { leerPlanillaProductos } from "@/features/stock/lib/leer-planilla-productos";
import {
  parseProductosSheet,
  type FilaImport,
  type FilaInvalida,
} from "@/features/stock/lib/parse-productos-csv";
import type { PlanImport } from "@/features/stock/lib/import-productos-plan";
import type { FirmaPlanImport } from "@/features/stock/lib/firma-plan-import";
import type { Rubro } from "@/entities/config/types";
import {
  nombreArchivoPlantilla,
  plantillaImportProductos,
} from "@/features/stock/lib/plantilla-import-productos";
import { ImportPreview } from "./import-preview";
import { previewImportProductosAction } from "@/features/stock/actions/preview-import-productos";
import {
  confirmarImportProductosAction,
  type ImportacionPrevia,
  type ResultadoFilaImport,
} from "@/features/stock/actions/confirmar-import-productos";

interface ImportProductosModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Solo cambia los ejemplos de la plantilla descargable: las columnas que
   * entiende el parser son las mismas para todos. */
  rubro: Rubro;
  /** Se llama después de un import con al menos una fila escrita. */
  onImportado?: () => void;
}

type Paso = "archivo" | "preview" | "resultado";

/** Etapa de la lectura del archivo. Son las dos que de verdad existen: leer
 * y parsear en el navegador, y analizar contra el catálogo en el server. */
type Etapa = "leyendo" | "analizando" | null;

const EXTENSIONES = [".csv", ".tsv", ".xlsx", ".xls"];

export function ImportProductosModal({
  open,
  onOpenChange,
  rubro,
  onImportado,
}: Readonly<ImportProductosModalProps>) {
  const [paso, setPaso] = useState<Paso>("archivo");
  const [fileName, setFileName] = useState<string | null>(null);
  const [filas, setFilas] = useState<FilaImport[]>([]);
  const [invalidas, setInvalidas] = useState<FilaInvalida[]>([]);
  const [columnasIgnoradas, setColumnasIgnoradas] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanImport | null>(null);
  const [resultados, setResultados] = useState<ResultadoFilaImport[]>([]);
  const [etapa, setEtapa] = useState<Etapa>(null);
  const [arrastrando, setArrastrando] = useState(false);
  // Segundos que lleva la escritura. No hay progreso por fila para mostrar:
  // el import es UNA transacción en el server y no reporta avance. Mostrar
  // una barra que llega al 90% y espera sería inventarlo; el reloj corriendo
  // al menos dice la verdad — está trabajando y hace tanto que empezó.
  const [segundos, setSegundos] = useState(0);
  const [isPending, startTransition] = useTransition();
  // Import anterior del mismo archivo. Mientras esté seteado, el botón pide
  // confirmación explícita: reimportar vuelve a SUMAR stock, no lo reemplaza.
  const [importacionPrevia, setImportacionPrevia] =
    useState<ImportacionPrevia | null>(null);
  // Firma del plan que se está mostrando. Vuelve al server al confirmar: si
  // el catálogo cambió desde que se armó, el server no escribe nada.
  const [firma, setFirma] = useState<FirmaPlanImport | null>(null);
  const [filasCambiadas, setFilasCambiadas] = useState<number[]>([]);
  // Correcciones inline: cada cambio bumpea la revisión y, tras una pausa, se
  // recalcula el plan en el server. No se parchea el plan en el cliente
  // porque el plan y su firma tienen que salir del mismo lado; si no, el
  // confirmar lo rechazaría por desactualizado.
  const [revision, setRevision] = useState(0);
  const [recalculando, setRecalculando] = useState(false);
  const filasRef = useRef<FilaImport[]>([]);

  // Reloj de la escritura. El setState va dentro del callback del intervalo
  // (no en el cuerpo del efecto), que es sincronizar con algo externo.
  useEffect(() => {
    if (!isPending) return;
    const id = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isPending]);

  const descargarPlantilla = () => {
    // El BOM es para Excel: sin él abre el CSV en la codificación del sistema
    // y "algodón" llega roto.
    const blob = new Blob(["﻿", plantillaImportProductos(rubro)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivoPlantilla(rubro);
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setPaso("archivo");
    setFileName(null);
    setFilas([]);
    setInvalidas([]);
    setColumnasIgnoradas([]);
    setPlan(null);
    setResultados([]);
    setImportacionPrevia(null);
    setFirma(null);
    setFilasCambiadas([]);
    setRecalculando(false);
    setEtapa(null);
    setArrastrando(false);
    filasRef.current = [];
  };

  const corregirPrecio = (fila: number, precio: number | null) => {
    const actualizadas = filasRef.current.map((f) =>
      f.fila === fila ? { ...f, precioVenta: precio } : f,
    );
    filasRef.current = actualizadas;
    setFilas(actualizadas);
    setRecalculando(true);
    setRevision((r) => r + 1);
  };

  // Debounce: el usuario tipea "12500" de a un dígito y cada uno cambiaría el
  // plan. Se espera a que pare y se hace UNA llamada con todo lo corregido.
  useEffect(() => {
    if (revision === 0) return;

    let cancelado = false;
    const timer = setTimeout(async () => {
      const res = await previewImportProductosAction(filasRef.current);
      if (cancelado) return;

      if (res.error || !res.plan) {
        toast.error(res.error ?? "No se pudo recalcular el plan.");
      } else {
        setPlan(res.plan);
        setFirma(res.firma ?? null);
        // El diff contra el catálogo viejo dejó de aplicar: este plan se
        // acaba de armar contra el catálogo de ahora.
        setFilasCambiadas([]);
      }
      setRecalculando(false);
    }, 700);

    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [revision]);

  const cerrar = () => {
    if (isPending) return;
    reset();
    onOpenChange(false);
  };

  const procesarArchivo = async (file: File) => {
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!EXTENSIONES.includes(extension)) {
      toast.error(`"${file.name}" no es una planilla. Subí un CSV o un Excel.`);
      return;
    }

    setFileName(file.name);
    setEtapa("leyendo");

    try {
      const rows = await leerPlanillaProductos(file);
      const parsed = parseProductosSheet(rows, rubro);

      if (parsed.error) {
        toast.error(parsed.error);
        setEtapa(null);
        return;
      }
      if (parsed.filas.length === 0) {
        toast.error("El archivo no tiene ninguna fila con producto.");
        setEtapa(null);
        return;
      }

      setFilas(parsed.filas);
      filasRef.current = parsed.filas;
      setInvalidas(parsed.invalidas);
      setColumnasIgnoradas(parsed.columnasIgnoradas);
      setEtapa("analizando");

      const res = await previewImportProductosAction(parsed.filas);
      if (res.error || !res.plan) {
        toast.error(res.error ?? "No se pudo analizar el archivo.");
        setEtapa(null);
        return;
      }

      setPlan(res.plan);
      setImportacionPrevia(res.importacionPrevia ?? null);
      setFirma(res.firma ?? null);
      setFilasCambiadas([]);
      setPaso("preview");
    } catch (err) {
      console.error("[IMPORT PRODUCTOS] Error leyendo el archivo:", err);
      toast.error("No se pudo leer el archivo. ¿Es un CSV o XLSX válido?");
    } finally {
      setEtapa(null);
    }
  };

  const handleArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await procesarArchivo(file);
    // Se limpia para que elegir DOS VECES el mismo archivo vuelva a disparar
    // el change (si no, el input lo considera el mismo valor y no pasa nada).
    e.target.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setArrastrando(false);
    if (etapa) return;
    const file = e.dataTransfer.files?.[0];
    if (file) await procesarArchivo(file);
  };

  const handleConfirmar = (forzar = false) => {
    setSegundos(0);
    // Sin withTimeout a propósito: esta acción escribe stock y el timeout
    // del cliente no cancela el server. Ver comentario en la action.
    startTransition(async () => {
      const res = await confirmarImportProductosAction(filas, {
        nombreArchivo: fileName ?? undefined,
        forzar,
        firmaPlan: firma,
      });

      if (res.error) {
        toast.error(res.error);
        return;
      }

      // El catálogo cambió entre la preview y este click: no se escribió
      // nada. Se muestra el plan recalculado y hay que aprobarlo de nuevo.
      if (res.planDesactualizado && res.plan) {
        setPlan(res.plan);
        setFirma(res.firma ?? null);
        setFilasCambiadas(res.filasCambiadas ?? []);
        toast.warning(
          "El catálogo cambió mientras revisabas. No se importó nada: mirá el plan actualizado.",
        );
        return;
      }

      // El guard del server ganó: no se escribió nada. Puede pasar aunque la
      // preview no hubiera detectado nada (otra pestaña importó en el medio).
      if (res.yaImportada) {
        setImportacionPrevia(res.importacionPrevia ?? null);
        toast.warning("Este archivo ya se había importado. No se escribió nada.");
        return;
      }

      setResultados(res.resultados);
      setPaso("resultado");

      if (res.totalOk > 0) {
        toast.success(`${res.totalOk} filas importadas.`);
        onImportado?.();
      }
      if (res.totalError > 0) {
        toast.warning(`${res.totalError} filas no se importaron.`);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent className="sm:max-w-[720px] border-border bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-success" />
            Importar productos
          </DialogTitle>
          <DialogDescription>
            Subí un CSV o Excel. Se revisa todo antes de escribir nada.
          </DialogDescription>
        </DialogHeader>

        {paso === "archivo" && (
          <div className="space-y-5 pt-2">
            <div className="bg-muted/30 border border-border p-4 rounded-xl">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 block">
                Columnas reconocidas
              </Label>
              <code className="text-xs bg-background border border-border px-2 py-1 rounded block">
                categoria, codigo_barras, producto, color, memoria, stock, imei,
                precio_costo, precio_venta
              </code>
              <p className="text-[11px] text-muted-foreground mt-2">
                Solo <strong>producto</strong> es obligatoria. Las demás son
                opcionales: una planilla de indumentaria con
                categoria/producto/color/stock importa igual.
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Si una fila trae <strong>imei</strong>, vale 1 unidad y se
                ignora la columna stock: cada aparato va en su propia fila.
              </p>

              <Button
                type="button"
                variant="outline"
                onClick={descargarPlantilla}
                className="mt-3 h-11 sm:h-9 w-full sm:w-auto shadow-none"
              >
                <Download className="w-4 h-4 mr-2" />
                Descargar plantilla de ejemplo
              </Button>
            </div>

            <Label
              htmlFor="planilla-upload"
              onDragOver={(e) => {
                e.preventDefault();
                if (!etapa) setArrastrando(true);
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                arrastrando
                  ? "border-success bg-success/10"
                  : fileName
                    ? "border-success bg-background"
                    : "border-border bg-muted/30 hover:border-success/50"
              }`}
            >
              <div className="flex flex-col items-center justify-center text-center px-4">
                {etapa ? (
                  <Loader2 className="w-8 h-8 mb-3 text-success animate-spin" />
                ) : (
                  <UploadCloud className="w-8 h-8 mb-3 text-muted-foreground" />
                )}
                <p className="mb-1 text-sm text-foreground font-medium">
                  {etapa === "leyendo"
                    ? "Leyendo el archivo..."
                    : etapa === "analizando"
                      ? `Analizando ${filas.length} filas contra el catálogo...`
                      : arrastrando
                        ? "Soltá el archivo acá"
                        : "Arrastrá tu CSV o Excel, o hacé clic para elegirlo"}
                </p>
                {!etapa && fileName && (
                  <p className="text-[11px] text-muted-foreground">{fileName}</p>
                )}
              </div>
              <Input
                id="planilla-upload"
                type="file"
                accept=".csv,.tsv,.xlsx,.xls"
                className="hidden"
                onChange={handleArchivo}
                disabled={Boolean(etapa)}
              />
            </Label>
          </div>
        )}

        {paso === "preview" && plan && (
          <ImportPreview
            plan={plan}
            invalidas={invalidas.length}
            columnasIgnoradas={columnasIgnoradas}
            importacionPrevia={importacionPrevia}
            filasCambiadas={filasCambiadas}
            recalculando={recalculando}
            isPending={isPending}
            segundos={segundos}
            onCorregirPrecio={corregirPrecio}
            onReset={reset}
            onConfirmar={() => handleConfirmar(Boolean(importacionPrevia))}
          />
        )}

        {paso === "resultado" && (
          <div className="space-y-4 pt-2">
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-semibold">Fila</th>
                      <th className="px-3 py-2 font-semibold">Producto</th>
                      <th className="px-3 py-2 font-semibold">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultados.map((r) => (
                      <tr key={r.fila} className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.fila}
                        </td>
                        <td className="px-3 py-2 font-medium">{r.producto}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-start gap-1.5 ${
                              r.ok ? "text-success" : "text-danger"
                            }`}
                          >
                            {r.ok ? (
                              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            )}
                            {r.detalle}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={reset}
                className="shadow-none"
              >
                Importar otro archivo
              </Button>
              <Button
                type="button"
                onClick={cerrar}
                className="bg-success text-white hover:bg-success/90"
              >
                Listo
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
