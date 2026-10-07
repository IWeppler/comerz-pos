"use client";

import { useState, FormEvent, useRef } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { useRouter } from "next/navigation";
import {
  procesarPedidoAction,
  type RemitoDuplicado,
} from "@/features/purchases/actions/create-purchase";
import {
  parseRemitoProveedor,
  type ResultadoParseRemito,
} from "@/features/purchases/lib/parse-remito-proveedor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  FileSpreadsheet,
  Loader2,
  UploadCloud,
  CheckCircle2,
  PackagePlus,
  Download,
} from "lucide-react";

type ExcelCell = string | number | boolean | Date | null | undefined;
type ImportarPedidoModalProps = {
  rubro?: import("@/entities/config/types").Rubro;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
};

export function ImportarPedidoModal({
  open,
  onOpenChange,
  hideTrigger = false,
  rubro,
}: Readonly<ImportarPedidoModalProps>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [proveedor, setProveedor] = useState("");

  const [file, setFile] = useState<File | null>(null);
  /** El remito que ya existe con este mismo contenido, si lo hay. */
  const [duplicado, setDuplicado] = useState<RemitoDuplicado | null>(null);
  /** Lo que el parser entendió del archivo, para revisarlo antes de crear la orden. */
  const [preview, setPreview] = useState<ResultadoParseRemito | null>(null);
  /** La persona decidió subirlo igual: es mercadería nueva, no un reintento. */
  const [forzarSubida, setForzarSubida] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    setFile(selectedFile ?? null);
    // Otro archivo, otra lectura: la preview anterior describe algo que ya no
    // es lo que se va a subir.
    setPreview(null);
    setDuplicado(null);
  };

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoading) {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
        fileInputRef.current.click();
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLoading) return;

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      setFile(droppedFile);
      setPreview(null);
      setDuplicado(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!file) {
      toast.error("Por favor, selecciona un archivo Excel o CSV.");
      return;
    }
    if (!proveedor.trim()) {
      toast.error("Por favor, ingresa el nombre del proveedor.");
      return;
    }

    setIsLoading(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const rawRows = XLSX.utils.sheet_to_json<ExcelCell[]>(worksheet, {
        header: 1,
        raw: false,
        defval: "",
      });

      // Todo el parseo vive en `parse-remito-proveedor.ts`: acá no queda ni
      // una regla. Estaba adentro de este componente, sin exportar, así que no
      // se le podía escribir un test — y por eso nadie vio que un membrete de
      // tres celdas o una fila de totales rompían el archivo entero.
      const analisis = parseRemitoProveedor(rawRows, rubro);

      if (analisis.error) {
        throw new Error(analisis.error);
      }

      // La preview es el punto: antes esto mandaba el archivo derecho y lo que
      // el parser no entendía se perdía sin decir una palabra. Ahora se
      // muestra qué entra, qué no y por qué, y la persona decide.
      if (!preview) {
        setPreview(analisis);
        setIsLoading(false);
        return;
      }

      const result = await procesarPedidoAction(
        proveedor,
        preview.filas,
        forzarSubida,
      );

      if (result.success) {
        toast.success("Pedido pre-cargado. Redirigiendo a Conciliación...");
        setOpen(false);
        setFile(null);
        setProveedor("");
        setPreview(null);
        setForzarSubida(false);
        router.push(`/compras/merge/${result.ordenId}`);
      } else if (result.duplicado) {
        // Este archivo ya se había subido. No es un error que haya que
        // reintentar: hay dos salidas y las dos son de la persona, así que la
        // pantalla las ofrece en vez de tirar un toast rojo y perder el
        // trabajo. Ver `hash-remito.ts`.
        setDuplicado(result.duplicado);
      } else {
        throw new Error(
          result.error || "Error en el servidor al guardar el pedido.",
        );
      }
    } catch (error: unknown) {
      console.error(error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Ocurrió un error al procesar el archivo.";
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setFile(null);
    setProveedor("");
    setDuplicado(null);
    setPreview(null);
    setForzarSubida(false);
    setOpen(false);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
        else setOpen(true);
      }}
    >
      {/* El DialogTrigger ha sido adaptado para que funcione perfectamente 
        dentro de tu DropdownMenu (o fuera de él) sin romperse. 
      */}
      {!hideTrigger && (
        <DialogTrigger asChild>
          <button className="w-full flex items-center justify-start h-9 px-2 text-sm font-medium cursor-pointer rounded-md hover:bg-muted transition-colors text-foreground">
            <PackagePlus className="w-4 h-4 mr-2 shrink-0 text-success" />
            Ingresar Remito
          </button>
        </DialogTrigger>
      )}

      <DialogContent
        className="sm:max-w-[450px] border-border bg-card"
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault();
        }}
        onFocusOutside={(event) => {
          event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isLoading) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="w-5 h-5 text-success" />
            Importar Remito / Pedido
          </DialogTitle>
          <DialogDescription>
            Sube el Excel o CSV enviado por tu proveedor.
          </DialogDescription>
        </DialogHeader>

        {preview && !duplicado && (
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3 max-h-[45vh] overflow-y-auto">
            <div>
              <p className="font-semibold text-foreground">
                {preview.filas.length}{" "}
                {preview.filas.length === 1 ? "renglón" : "renglones"} listos
                para conciliar
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Encabezados leídos en la fila {preview.filaEncabezado} del
                archivo.
              </p>
            </div>

            {/* Qué se entendió de cada columna. Es lo que permite darse cuenta
                de que "PRECIO" se tomó como costo antes de que el costo quede
                congelado en el producto. */}
            <div className="space-y-1 text-xs">
              {Object.entries(preview.columnasUsadas).map(([campo, columna]) => (
                <p key={campo} className="text-foreground/80">
                  <span className="text-muted-foreground">{campo}:</span>{" "}
                  {columna}
                </p>
              ))}
              {preview.columnasComoAtributo.length > 0 && (
                <p className="text-foreground/80">
                  <span className="text-muted-foreground">
                    como atributo de la variante:
                  </span>{" "}
                  {preview.columnasComoAtributo.join(", ")}
                </p>
              )}
            </div>

            {preview.avisos.length > 0 && (
              <div className="space-y-1 border-t border-border pt-2">
                <p className="text-xs font-semibold text-warning">
                  Para revisar ({preview.avisos.length})
                </p>
                <ul className="space-y-0.5 text-xs text-foreground/80">
                  {preview.avisos.slice(0, 8).map((aviso) => (
                    <li key={aviso.detalle}>· {aviso.detalle}</li>
                  ))}
                  {preview.avisos.length > 8 && (
                    <li className="text-muted-foreground">
                      y {preview.avisos.length - 8} más.
                    </li>
                  )}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Si algo no cuadra, cancelá y corregí el archivo: acá todavía no se
              creó nada.
            </p>
          </div>
        )}

        {duplicado && (
          <div className="rounded-xl border border-warning bg-warning/10 p-4 space-y-3">
            <div>
              <p className="font-semibold text-warning">
                Este archivo ya se subió
              </p>
              <p className="mt-1 text-sm text-foreground/80">
                Tiene el mismo contenido que el remito de{" "}
                <strong>{duplicado.proveedor}</strong> del{" "}
                {new Date(duplicado.creadoEn).toLocaleDateString("es-AR")}
                {duplicado.estado === "APROBADA"
                  ? ", que ya impactó el stock. Subirlo de nuevo lo sumaría dos veces."
                  : ", que quedó pendiente de conciliar."}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="flex-1"
                onClick={() => {
                  setOpen(false);
                  setDuplicado(null);
                  router.push(`/compras/merge/${duplicado.ordenId}`);
                }}
              >
                Abrir el remito que ya existe
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  // Es mercadería nueva que casualmente viene igual. Se marca
                  // la intención y se vuelve a mandar; ese remito queda sin
                  // huella y por lo tanto fuera del guard.
                  setForzarSubida(true);
                  setDuplicado(null);
                }}
              >
                Es otra entrega, subirlo igual
              </Button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 pt-2">
          {forzarSubida && (
            <p className="rounded-lg border border-warning/60 bg-warning/5 px-3 py-2 text-xs text-foreground/80">
              Se va a subir aunque el contenido repita un remito anterior.
            </p>
          )}
          <a
            href="/plantilla-productos.csv"
            download
            className="inline-flex items-center gap-1.5 text-xs font-medium text-success hover:text-success/80 hover:underline w-fit"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar plantilla
          </a>

          <div className="bg-muted/30 border border-border p-4 rounded-xl">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 block">
              Formato esperado (Columnas)
            </Label>
            <code className="text-xs bg-background border border-border px-2 py-1 rounded block mb-1">
              producto, cantidad, precio_costo, precio_venta, categoria, talle,
              color, genero, marca, sku
            </code>
            <p className="text-[10px] text-muted-foreground mt-2">
              Solo &quot;producto&quot; y &quot;cantidad&quot; son obligatorias.
              Cualquier otra columna (talle, color...) se guarda como atributo
              de la variante.
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Si la planilla trae <strong>precio_venta</strong>, se usa como
              precio al público sugerido en la conciliación — igual lo podés
              cambiar antes de aprobar. Sin esa columna,
              &quot;precio&quot; se toma como costo.
            </p>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="proveedor"
              className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
            >
              Nombre del Proveedor
            </Label>
            <Input
              id="proveedor"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              placeholder="Ej: Mayorista"
              disabled={isLoading}
              required
              className="h-11 shadow-none bg-muted/20"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Archivo a procesar (.xlsx, .csv)
            </Label>

            <button
              type="button"
              onClick={handleTriggerClick}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              disabled={isLoading}
              className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl transition-colors ${
                isLoading
                  ? "border-border bg-muted/50 cursor-not-allowed opacity-70"
                  : file
                    ? "border-success bg-success/10 cursor-pointer"
                    : "border-border bg-muted/20 hover:bg-success/10 hover:border-success cursor-pointer"
              }`}
            >
              <div className="flex flex-col items-center justify-center text-center px-4 pointer-events-none">
                {isLoading ? (
                  <Loader2 className="w-8 h-8 mb-3 text-success animate-spin" />
                ) : file ? (
                  <CheckCircle2 className="w-8 h-8 mb-3 text-success" />
                ) : (
                  <UploadCloud className="w-8 h-8 mb-3 text-muted-foreground" />
                )}

                <p className="mb-1 text-sm text-foreground font-medium">
                  {file ? (
                    <span className="text-success font-bold">
                      {file.name}
                    </span>
                  ) : (
                    <>
                      <span className="font-semibold text-success">
                        Haz clic para subir
                      </span>{" "}
                      o arrastra tu archivo
                    </>
                  )}
                </p>
                {!file && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Columnas requeridas: Descripción, Cantidad. (Opcional:
                    Precio Venta, Color, Talle, Género, SKU...)
                  </p>
                )}
              </div>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
              style={{ display: "none" }}
              onChange={handleFileChange}
              disabled={isLoading}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
              className="shadow-none"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="px-6"
              disabled={isLoading || !file || !proveedor.trim()}
            >
              {isLoading
                ? "Procesando Archivo..."
                : preview
                  ? `Crear remito con ${preview.filas.length} ${preview.filas.length === 1 ? "renglón" : "renglones"}`
                  : "Leer Archivo"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
