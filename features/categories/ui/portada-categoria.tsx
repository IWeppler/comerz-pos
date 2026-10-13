"use client";

import { useRef, useState } from "react";
import { toast } from "@/shared/ui/toast";
import { ImagePlus, Loader2, X } from "lucide-react";
import {
  ImagenError,
  optimizarImagen,
} from "@/shared/utils/image-optimizer";
import { subirImagenCategoriaAction } from "../actions/manage-categories";

/**
 * Portada de una categoría, la imagen que se ve en la home del catálogo
 * público.
 *
 * Sólo tiene sentido en categorías raíz: la portada del catálogo muestra
 * padres y categorías sueltas, no subcategorías.
 *
 * La imagen se comprime en el navegador con el MISMO optimizador que las
 * fotos de producto y se sube ni bien se elige — no espera al "Guardar
 * cambios" del panel. Lo que sí queda pendiente de guardado es la URL en la
 * fila de la categoría, igual que el nombre: así el botón de guardar sigue
 * siendo el único que escribe en `categorias`.
 */
export function PortadaCategoria({
  imagenUrl,
  nombreCategoria,
  onChange,
}: Readonly<{
  imagenUrl: string | null | undefined;
  nombreCategoria: string;
  onChange: (url: string | null) => void;
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);

  const elegirArchivo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0];
    // Se limpia el input para que volver a elegir el MISMO archivo después de
    // un error dispare el change de nuevo.
    event.target.value = "";
    if (!archivo) return;
    void subir(archivo);
  };

  const subir = async (archivo: File) => {
    setSubiendo(true);
    try {
      // "grid" y no "main": esta imagen se ve en una tarjeta chica, no a
      // tamaño de detalle. No hay motivo para guardar 1100px.
      const optimizada = await optimizarImagen(archivo, "grid");

      const formData = new FormData();
      formData.append("imagen", optimizada);

      const { url, error } = await subirImagenCategoriaAction(formData);
      if (error || !url) {
        toast.error(error ?? "No se pudo subir la imagen.");
        return;
      }

      onChange(url);
      toast.success("Portada lista. Acordate de guardar los cambios.");
    } catch (error) {
      toast.error(
        error instanceof ImagenError
          ? error.message
          : "No se pudo procesar la imagen.",
      );
    } finally {
      setSubiendo(false);
    }
  };

  const etiqueta = imagenUrl
    ? `Cambiar la portada de ${nombreCategoria}`
    : `Elegir una portada para ${nombreCategoria}`;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={subiendo}
        title={etiqueta}
        aria-label={etiqueta}
        className="group relative h-11 w-11 overflow-hidden rounded-md border border-border bg-muted/40 transition-colors hover:border-primary disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      >
        {subiendo ? (
          <span className="flex h-full w-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </span>
        ) : imagenUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imagenUrl}
              alt=""
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <ImagePlus className="h-4 w-4 text-white" />
            </span>
          </>
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <ImagePlus className="h-4 w-4 text-muted-foreground" />
          </span>
        )}
      </button>

      {imagenUrl && !subiendo && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title={`Quitar la portada de ${nombreCategoria}`}
          aria-label={`Quitar la portada de ${nombreCategoria}`}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png, image/jpeg, image/webp"
        className="hidden"
        onChange={elegirArchivo}
      />
    </div>
  );
}
