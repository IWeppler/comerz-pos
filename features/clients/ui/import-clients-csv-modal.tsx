"use client";

import { FormEvent, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  FileSpreadsheet,
  UploadCloud,
  CheckCircle2,
  Loader2,
  Download,
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
import { importarClientesCSVAction } from "../actions/manage-clients";
import { queryKeys } from "@/shared/lib/query-keys";
import { decodeCsvBuffer } from "../lib/decode-csv-file";

interface ImportClientsCsvModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportClientsCsvModal({
  open,
  onOpenChange,
}: Readonly<ImportClientsCsvModalProps>) {
  const [isPending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
    } else {
      setFileName(null);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput?.files?.[0];

    if (!fileName || !file) {
      toast.error("Por favor, selecciona un archivo CSV primero.");
      return;
    }

    try {
      // Leemos como bytes crudos (no file.text(), que fuerza UTF-8 y
      // convierte silenciosamente cualquier Ñ/tilde en un CSV
      // windows-1252 en el caracter de reemplazo U+FFFD, irrecuperable).
      const buffer = await file.arrayBuffer();
      const text = decodeCsvBuffer(buffer);

      const formData = new FormData();
      formData.append("csv_text", text);

      startTransition(async () => {
        const result = await importarClientesCSVAction(formData);
        if (result.success) {
          toast.success(`Se importaron ${result.count} clientes exitosamente.`);
          queryClient.invalidateQueries({
            queryKey: queryKeys.clientes.listado,
          });
          setFileName(null); // Reseteamos el archivo
          onOpenChange(false);
        } else {
          toast.error(result.error);
        }
      });
    } catch (error) {
      toast.error("Error al leer el archivo. Intenta nuevamente.");
    }
  };

  const handleClose = () => {
    setFileName(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[450px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-success" />
            Importar Clientes
          </DialogTitle>
          <DialogDescription>
            Sube un archivo <strong className="text-foreground">.CSV</strong>{" "}
            con tu base de datos actual para migrarlos al sistema de forma
            masiva.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-4">
          <a
            href="/plantilla-clientes.csv"
            download
            className="inline-flex items-center gap-1.5 text-xs font-medium text-success hover:text-success/90 hover:underline w-fit"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar plantilla
          </a>

          <div className="bg-muted/30 border border-border p-4 rounded-xl">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 block">
              Formato esperado (Columnas)
            </Label>
            <code className="text-xs bg-background border border-border px-2 py-1 rounded block mb-1">
              nombre, telefono, dni, deuda_inicial, vencimiento
            </code>
            <p className="text-[10px] text-muted-foreground mt-2">
              Nota: Si incluyes la columna &quot;deuda_inicial&quot;, el sistema
              creará automáticamente un registro de deuda en la cuenta corriente
              del cliente. La columna &quot;vencimiento&quot; (formato
              DD/MM/AAAA) es opcional.
            </p>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="csv-upload"
              className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                fileName
                  ? "border-success bg-background"
                  : "border-border bg-muted/30 hover:bg-success  hover:border-success/20"
              }`}
            >
              <div className="flex flex-col items-center justify-center text-center px-4">
                {isPending ? (
                  <Loader2 className="w-8 h-8 mb-3 text-success animate-spin" />
                ) : fileName ? (
                  <CheckCircle2 className="w-8 h-8 mb-3 text-success" />
                ) : (
                  <UploadCloud className="w-8 h-8 mb-3 text-muted-foreground" />
                )}

                <p className="mb-1 text-sm text-foreground font-medium">
                  {fileName ? (
                    <span className="text-success font-bold">{fileName}</span>
                  ) : (
                    <>
                      <span className="font-semibold text-success">
                        Haz clic para subir
                      </span>{" "}
                      tu archivo CSV
                    </>
                  )}
                </p>
                {fileName && !isPending && (
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Clic para cambiar de archivo
                  </p>
                )}
              </div>
              <Input
                id="csv-upload"
                name="file"
                type="file"
                accept=".csv"
                required
                className="hidden"
                onChange={handleFileChange}
                disabled={isPending}
              />
            </Label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isPending}
              className="shadow-none"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-success text-white hover:bg-success/90"
              disabled={isPending || !fileName}
            >
              {isPending ? "Importando..." : "Comenzar Importación"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
