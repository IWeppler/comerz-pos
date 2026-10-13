"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ImagePlus, X } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  MAX_IMAGENES_PRODUCTO,
  filtrarArchivosImagen,
} from "@/shared/utils/image-optimizer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";

type ProductMediaSectionProps = {
  archivos: File[];
  onArchivosChange: (archivos: File[]) => void;
  existingImages?: string[];
  /**
   * Si no se pasa, las imágenes existentes se muestran sin botón de quitar:
   * removerlas implica borrar algo ya guardado en Storage/la base, y eso
   * solo tiene sentido cuando quien usa el componente sabe cómo persistir
   * esa baja (hoy ningún flujo lo hace).
   */
  onRemoveExistingImage?: (url: string) => void;
  inputId?: string;
};

export function ProductMediaSection({
  archivos,
  onArchivosChange,
  existingImages = [],
  onRemoveExistingImage,
  inputId = "imagenes",
}: ProductMediaSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [imagenExistenteAQuitar, setImagenExistenteAQuitar] = useState<
    string | null
  >(null);

  const totalImagenes = existingImages.length + archivos.length;
  // >= y no ===: hay productos viejos que ya tienen 4 o 5 fotos. El tope no
  // es retroactivo — esas se siguen mostrando, solo no se pueden sumar más.
  const yaEnElTope = totalImagenes >= MAX_IMAGENES_PRODUCTO;

  const handlePickImages = () => {
    if (yaEnElTope) {
      toast.warning(
        `Este producto ya tiene ${totalImagenes} ${totalImagenes === 1 ? "foto" : "fotos"} — el máximo es ${MAX_IMAGENES_PRODUCTO}.`,
        { description: "Quitá alguna para poder agregar otra." },
      );
      return;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  // Único punto de entrada de archivos nuevos (input, drop y pegado): la
  // galería del celular deja elegir decenas de fotos de una y hasta acá no
  // había ningún freno — cada una se decodificaba entera para comprimirla y
  // para el preview. Rechazar en silencio sería peor que el bug, así que
  // avisamos qué quedó afuera y por qué.
  const agregarArchivos = (nuevos: File[]) => {
    if (nuevos.length === 0) return;

    const { aceptados, rechazados, excedeMaximo } = filtrarArchivosImagen(
      nuevos,
      // Cuentan las ya guardadas Y las elegidas sin guardar: si no, un
      // producto que ya tiene fotos podría sumar el tope entero en cada
      // edición.
      existingImages.length + archivos.length,
    );

    if (rechazados.length > 0) {
      const detalle = rechazados
        .slice(0, 3)
        .map((r) => `${r.file.name}: ${r.motivo}`)
        .join(" · ");
      toast.error(
        rechazados.length === 1
          ? `No se agregó ${detalle}`
          : `No se agregaron ${rechazados.length} archivos — ${detalle}`,
      );
    }

    if (excedeMaximo > 0) {
      toast.warning(
        `Máximo ${MAX_IMAGENES_PRODUCTO} fotos por producto — ${
          excedeMaximo === 1
            ? "quedó 1 afuera"
            : `quedaron ${excedeMaximo} afuera`
        }.`,
        {
          description:
            yaEnElTope && aceptados.length === 0
              ? "Quitá alguna de las que ya están para poder agregar otra."
              : undefined,
        },
      );
    }

    if (aceptados.length > 0) onArchivosChange([...archivos, ...aceptados]);
  };

  const handleFilesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      agregarArchivos(Array.from(event.target.files));
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);

    agregarArchivos(Array.from(event.dataTransfer.files ?? []));
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
  };

  // Captura Ctrl+V mientras este componente está montado (o sea, mientras
  // el modal/form que lo contiene está abierto).
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      const pegadas: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) pegadas.push(file);
        }
      }
      agregarArchivos(pegadas);
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivos, onArchivosChange]);

  // Antes el src del preview era `URL.createObjectURL(file)` llamado DENTRO
  // del render y nunca revocado. Cada re-render del form (una tecla en la
  // grilla de variantes, un cambio de precio) creaba un blob URL nuevo por
  // archivo, y cada uno retiene el File entero hasta que se revoca. Sumado a
  // que el navegador decodifica la foto de 12MP completa para pintarla a
  // 80×80, en mobile la memoria solo subía hasta que el navegador mataba la
  // pestaña — el crash que se veía como "This page couldn't load", sin
  // excepción de JS ni log de servidor.
  //
  // Ahora se crea una sola URL por archivo y se revoca cuando cambia la
  // selección o se desmonta el componente.
  const previews = useMemo(
    () => archivos.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [archivos],
  );

  useEffect(() => {
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [previews]);

  const handleRemoveArchivo = (file: File) => {
    onArchivosChange(archivos.filter((f) => f !== file));
  };

  const confirmarRemoverExistente = () => {
    if (imagenExistenteAQuitar && onRemoveExistingImage) {
      onRemoveExistingImage(imagenExistenteAQuitar);
    }
    setImagenExistenteAQuitar(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold text-foreground">Media</Label>
        <span
          className={`text-xs tabular-nums ${
            yaEnElTope ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"
          }`}
        >
          {totalImagenes}/{MAX_IMAGENES_PRODUCTO}
        </span>
      </div>
      <button
        type="button"
        onClick={handlePickImages}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        aria-disabled={yaEnElTope}
        className={`flex w-full items-center justify-between p-4 text-left rounded-xl transition-colors border border-dashed group ${
          yaEnElTope
            ? "cursor-not-allowed opacity-60 border-border/60"
            : "cursor-pointer hover:bg-muted/50"
        } ${
          isDraggingOver && !yaEnElTope
            ? "border-primary bg-primary/5"
            : "border-border/80"
        }`}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-muted/50 rounded-lg flex items-center justify-center group-hover:bg-muted transition-colors">
            <ImagePlus className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-sm text-foreground">
              Agregar media
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {yaEnElTope
                ? `Llegaste al máximo de ${MAX_IMAGENES_PRODUCTO} fotos — quitá alguna para agregar otra`
                : "Click, arrastrá una imagen o pegala con Ctrl+V"}
            </p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground" />
      </button>
      <Input
        ref={fileInputRef}
        id={inputId}
        name="imagenes"
        type="file"
        multiple
        // Sin image/heic a propósito: con ese tipo en la lista iOS entrega el
        // HEIC crudo, que ningún navegador Android sabe decodificar por
        // canvas. Dejándolo afuera, iOS convierte a JPEG antes de entregarlo.
        accept="image/png, image/jpeg, image/webp"
        className="hidden"
        onChange={handleFilesChange}
      />

      {(existingImages.length > 0 || archivos.length > 0) && (
        <div className="flex flex-wrap gap-3 mt-4">
          {existingImages.map((image) => (
            <div
              key={image}
              className="relative w-20 h-20 rounded-lg overflow-hidden border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt="Producto"
                className="object-cover w-full h-full"
              />
              {onRemoveExistingImage && (
                <button
                  type="button"
                  onClick={() => setImagenExistenteAQuitar(image)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 cursor-pointer"
                  title="Quitar imagen"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {previews.map(({ file, url }, idx) => (
            <div
              key={`${file.name}-${idx}`}
              className="relative w-20 h-20 rounded-lg overflow-hidden border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="Preview"
                loading="lazy"
                decoding="async"
                className="object-cover w-full h-full"
              />
              <button
                type="button"
                onClick={() => handleRemoveArchivo(file)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 cursor-pointer"
                title="Quitar de la selección"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={imagenExistenteAQuitar !== null}
        onOpenChange={(open) => !open && setImagenExistenteAQuitar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar esta imagen del producto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta imagen ya está guardada en el producto. Se va a quitar de
              la galería al guardar los cambios.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setImagenExistenteAQuitar(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarRemoverExistente}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              Quitar imagen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
