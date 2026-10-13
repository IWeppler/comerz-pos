"use client";

import { useState } from "react";
import { toast } from "@/shared/ui/toast";
import { Download, Loader2, Lock, FileSpreadsheet } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  exportacionesPorGrupo,
  GRUPOS_EXPORTACION,
  type ClaveExportacion,
  type DefinicionExportacion,
} from "../lib/catalogo-exportaciones";
import {
  normalizarPeriodoExportacion,
  PERIODO_EXPORTACION_DEFAULT,
  PERIODOS_EXPORTACION,
  type PeriodoExportacion,
} from "../lib/periodo-exportacion";
import { exportarAction } from "../actions/exportar";

/**
 * "Exportaciones", no "Contabilidad".
 *
 * Comerz no lleva la contabilidad del negocio: prepara la información para que
 * la lleve el contador. Prometer lo primero es prometer algo que el sistema no
 * hace y que nadie debería creerle a un POS.
 */
export function ExportacionesTab() {
  const [descargando, setDescargando] = useState<ClaveExportacion | null>(null);
  const [periodo, setPeriodo] = useState<PeriodoExportacion>(
    PERIODO_EXPORTACION_DEFAULT,
  );

  const descargar = async (definicion: DefinicionExportacion) => {
    setDescargando(definicion.clave);
    try {
      const res = await exportarAction(definicion.clave, periodo);

      if (res.error || !res.archivoBase64) {
        toast.error(res.error ?? "No se pudo generar la exportación.");
        return;
      }

      // El server manda el .xlsx en base64; acá solo se dispara la descarga.
      const binario = atob(res.archivoBase64);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);

      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = res.nombreArchivo ?? "exportacion.xlsx";
      link.click();
      URL.revokeObjectURL(url);

      toast.success(`${definicion.titulo}: ${res.filas} filas exportadas.`);
    } catch (err) {
      console.error("[EXPORTACION]", err);
      toast.error("No se pudo descargar el archivo.");
    } finally {
      setDescargando(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Exportaciones
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Prepará la información de tu negocio para tu contador. Los archivos
            salen en Excel.
          </p>
        </div>

        {/* Selector propio y no el de Reportes: un contador cierra por mes, y
            "últimos 7 días" no es un período que le sirva para presentar. */}
        <Select
          value={periodo}
          onValueChange={(v) => setPeriodo(normalizarPeriodoExportacion(v))}
        >
          <SelectTrigger className="w-full sm:w-52 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODOS_EXPORTACION.map((p) => (
              <SelectItem key={p.valor} value={p.valor}>
                {p.etiqueta}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {GRUPOS_EXPORTACION.map((grupo) => (
        <section key={grupo} className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {grupo}
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {exportacionesPorGrupo(grupo).map((def) => (
              <article
                key={def.clave}
                className={`border rounded-xl p-4 flex flex-col gap-3 ${
                  def.disponible
                    ? "border-border bg-card"
                    : "border-border/60 bg-muted/20"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm flex items-center gap-2">
                      {def.titulo}
                      {!def.disponible && (
                        <Badge variant="secondary" className="text-[10px]">
                          Todavía no
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {def.descripcion}
                    </p>
                  </div>
                </div>

                {/* El motivo se muestra SIEMPRE que falte, no detrás de un
                    tooltip: es la información que le dice al comerciante qué
                    tiene que hacer para habilitarla. */}
                {!def.disponible && def.motivoNoDisponible && (
                  <p className="text-[11px] text-muted-foreground bg-background border border-border/60 rounded-lg p-2.5 flex gap-2">
                    <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {def.motivoNoDisponible}
                  </p>
                )}

                <div className="mt-auto">
                  <Button
                    type="button"
                    variant={def.disponible ? "default" : "outline"}
                    disabled={!def.disponible || descargando !== null}
                    onClick={() => descargar(def)}
                    className="w-full sm:w-auto"
                  >
                    {descargando === def.clave ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Generando...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-2" />
                        Descargar Excel
                      </>
                    )}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
