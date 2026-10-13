"use client";

import { useState } from "react";
import { ConfiguracionPOS } from "@/entities/config/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import {
  ImagePlus,
  Save,
  Loader2,
  Megaphone,
  Trash2,
  Crop,
  Link as LinkIcon,
} from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { createClient } from "@/shared/config/supabase/client";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { FORMATOS_IMAGEN_ACEPTADOS } from "@/shared/lib/formatos-imagen";
import {
  HERO_DESKTOP,
  HERO_MOBILE,
  objectPositionDeFoco,
  tieneFoco,
} from "@/shared/lib/foco-banner";
import { EncuadreBannerModal } from "./encuadre-banner-modal";

interface BannerManagerProps {
  config: ConfiguracionPOS;
}

/**
 * Las dos imágenes del banner, cada una con su encuadre.
 *
 * La de mobile es la obligatoria y la que se usa si no hay otra; la de desktop
 * es opcional y solo entra de 640px para arriba, donde el hero cambia de
 * forma. El vacío NO se rellena copiando la de mobile: vacío significa "usá la
 * misma en las dos", y copiar la URL haría que cambiar la de mobile dejara la
 * otra vieja, sin que nadie se entere. Mismo criterio que el precio heredado
 * de las variantes.
 *
 * EL ENCUADRE ES DEL PAR (imagen, forma), NO DE LA IMAGEN. Por eso la fila de
 * desktop tiene su propio foco incluso cuando no tiene imagen propia: ahí se
 * está encuadrando la foto de mobile contra el marco ancho de la computadora,
 * que es un recorte completamente distinto —de 16/20 a 4/1.5— y es justo el
 * caso donde `object-cover` se come más cosas.
 */
const FILAS_BANNER = [
  {
    campo: "banner_imagen" as const,
    campoFocoX: "banner_focal_x" as const,
    campoFocoY: "banner_focal_y" as const,
    titulo: "Imagen para celular",
    ayuda: "Vertical, ~1080×1350. Es la que se usa si no cargás la de abajo.",
    forma: HERO_MOBILE,
    etiquetaForma: "el celular",
  },
  {
    campo: "banner_imagen_desktop" as const,
    campoFocoX: "banner_focal_desktop_x" as const,
    campoFocoY: "banner_focal_desktop_y" as const,
    titulo: "Imagen para computadora (opcional)",
    ayuda: "Apaisada, ~1920×720. Se usa en pantallas grandes.",
    forma: HERO_DESKTOP,
    etiquetaForma: "la computadora",
  },
];

/**
 * El nombre del archivo en Storage.
 *
 * Vive fuera del componente porque `Math.random` y `Date.now` son impuras y
 * la regla de pureza de React las marca adentro de uno.
 *
 * Va bajo la carpeta del negocio: la policy de Storage no deja escribir
 * fuera de ella.
 */
function nombreDeArchivo(negocioId: string, nombreOriginal: string) {
  const ext = nombreOriginal.split(".").pop();
  const aleatorio = Math.random().toString(36).substring(2);
  return `${negocioId}/banners/${aleatorio}-${Date.now()}.${ext}`;
}

export function BannerManager({ config }: Readonly<BannerManagerProps>) {
  const negocioId = useNegocioActivo()?.id ?? null;
  const [isSaving, setIsSaving] = useState(false);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    banner_activo: config.banner_activo ?? false,
    banner_imagen: config.banner_imagen || "",
    banner_imagen_desktop: config.banner_imagen_desktop || "",
    banner_titulo: config.banner_titulo || "",
    banner_subtitulo: config.banner_subtitulo || "",
    banner_boton_texto: config.banner_boton_texto || "",
    banner_link: config.banner_link || "",
    // Los focos viven en el mismo estado que el resto: se guardan con el
    // mismo botón, y null (centrado) tiene que poder volver a ser null.
    banner_focal_x: config.banner_focal_x ?? null,
    banner_focal_y: config.banner_focal_y ?? null,
    banner_focal_desktop_x: config.banner_focal_desktop_x ?? null,
    banner_focal_desktop_y: config.banner_focal_desktop_y ?? null,
  });

  /** Qué fila se está encuadrando, o null si el modal está cerrado. */
  const [encuadrando, setEncuadrando] = useState<number | null>(null);

  const handleChange = (
    field: string,
    value: string | boolean | number | null,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    campo: string,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setSubiendo(campo);
      const supabase = createClient();

      // Bucket 'productos': aprovechamos el que ya existe.
      if (!negocioId) {
        toast.error("No hay un negocio activo en esta sesión");
        return;
      }

      const fileName = nombreDeArchivo(negocioId, file.name);

      const { error: uploadError } = await supabase.storage
        .from("productos")
        .upload(fileName, file, { cacheControl: "31536000" });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("productos").getPublicUrl(fileName);

      handleChange(campo, publicUrl);
      toast.success("Imagen subida correctamente");
    } catch (error) {
      console.error("Error uploading image:", error);
      toast.error("Ocurrió un error al subir la imagen");
    } finally {
      setSubiendo(null);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    const supabase = createClient();

    const { error } = await supabase
      .from("configuracion_pos")
      .update({
        ...formData,
        // La columna es nullable y el null tiene significado ("no hay imagen
        // de desktop, usá la de mobile"). Guardar "" haría que el catálogo
        // creyera que sí hay una y sirviera una URL vacía.
        banner_imagen_desktop: formData.banner_imagen_desktop || null,
      })
      .eq("id", config.id)
      .select("id");

    setIsSaving(false);

    if (error) {
      toast.error("Error al guardar la configuración del banner.");
    } else {
      toast.success("Banner actualizado correctamente.");
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/50 pb-4">
        <div>
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" />
            Banner Promocional
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Destaca una colección, promoción o producto estrella en la parte
            superior de tu tienda.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2 mr-2">
            <Label
              className="text-sm font-bold cursor-pointer"
              htmlFor="banner-toggle"
            >
              Activar
            </Label>
            <Switch
              id="banner-toggle"
              checked={formData.banner_activo}
              onCheckedChange={(v) => handleChange("banner_activo", v)}
            />
          </div>
          <Button onClick={handleSave} disabled={isSaving || subiendo !== null}>
            {isSaving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Guardar
          </Button>
        </div>
      </div>

      <div
        className={`grid grid-cols-1 lg:grid-cols-2 gap-8 transition-opacity ${!formData.banner_activo ? "opacity-50 pointer-events-none" : ""}`}
      >
        {/* Lado Izquierdo: Imágenes */}
        <div className="space-y-6">
          {FILAS_BANNER.map((fila, indice) => {
            const {
              campo,
              campoFocoX,
              campoFocoY,
              titulo,
              ayuda,
              forma,
              etiquetaForma,
            } = fila;
            const valor = formData[campo];
            const estaSubiendo = subiendo === campo;
            const foco = {
              x: formData[campoFocoX],
              y: formData[campoFocoY],
            };

            // La fila de desktop puede no tener imagen propia: ahí lo que se
            // encuadra —y lo que la clienta va a ver en una computadora— es la
            // foto de mobile. Sin esto, el caso más común (un solo banner) se
            // quedaría justo sin el encuadre que más falta hace, porque el
            // recorte ancho es el que más se come.
            const urlAEncuadrar = valor || formData.banner_imagen;

            return (
              <div key={campo} className="space-y-2">
                <Label className="text-sm font-semibold">{titulo}</Label>
                <p className="text-xs text-muted-foreground">{ayuda}</p>

                {/* La miniatura se dibuja con la FORMA REAL del hero y el foco
                    elegido: es una vista previa, no una decoración. Si acá se
                    ve bien, en la tienda se ve igual. */}
                {urlAEncuadrar ? (
                  <div
                    className="relative w-full rounded-xl overflow-hidden border border-border group"
                    style={{ aspectRatio: `${forma.ancho} / ${forma.alto}` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={urlAEncuadrar}
                      alt={titulo}
                      className="w-full h-full object-cover"
                      style={{ objectPosition: objectPositionDeFoco(foco) }}
                    />

                    {!valor && (
                      <span className="absolute top-2 left-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        Usa la foto del celular
                      </span>
                    )}
                    {tieneFoco(foco) && (
                      <span className="absolute top-2 right-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        Encuadrada
                      </span>
                    )}

                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setEncuadrando(indice)}
                      >
                        <Crop className="w-4 h-4 mr-2" /> Encuadrar
                      </Button>
                      {valor && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            handleChange(campo, "");
                            // El foco se va con la imagen: dejarlo puesto
                            // encuadraría la PRÓXIMA foto contra un punto
                            // elegido para otra.
                            handleChange(campoFocoX, null);
                            handleChange(campoFocoY, null);
                          }}
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Eliminar
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <Label
                    htmlFor={`upload-${campo}`}
                    className="flex flex-col items-center justify-center w-full aspect-4/3 border-2 border-dashed border-border rounded-xl cursor-pointer bg-muted/20 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                  >
                    <div className="flex flex-col items-center justify-center text-center px-4">
                      {estaSubiendo ? (
                        <Loader2 className="w-8 h-8 mb-3 text-primary animate-spin" />
                      ) : (
                        <ImagePlus className="w-8 h-8 mb-3 text-muted-foreground" />
                      )}
                      <p className="mb-1 text-sm text-muted-foreground">
                        <span className="font-semibold text-primary">
                          Haz clic para subir
                        </span>{" "}
                        o arrastra
                      </p>
                    </div>
                    <Input
                      id={`upload-${campo}`}
                      type="file"
                      accept={FORMATOS_IMAGEN_ACEPTADOS}
                      className="hidden"
                      onChange={(e) => handleImageUpload(e, campo)}
                      disabled={subiendo !== null}
                    />
                  </Label>
                )}

                {/* Subir una segunda foto cuando la fila ya muestra la de
                    mobile: sin esto no habría forma de llegar al input. */}
                {!valor && urlAEncuadrar && (
                  <Label
                    htmlFor={`upload-${campo}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary cursor-pointer hover:underline"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    Subir una foto distinta para computadora
                    <Input
                      id={`upload-${campo}`}
                      type="file"
                      accept={FORMATOS_IMAGEN_ACEPTADOS}
                      className="hidden"
                      onChange={(e) => handleImageUpload(e, campo)}
                      disabled={subiendo !== null}
                    />
                  </Label>
                )}

                {urlAEncuadrar && (
                  <EncuadreBannerModal
                    abierto={encuadrando === indice}
                    onOpenChange={(v) => setEncuadrando(v ? indice : null)}
                    url={urlAEncuadrar}
                    forma={forma}
                    etiquetaForma={etiquetaForma}
                    foco={foco}
                    onGuardar={({ x, y }) => {
                      handleChange(campoFocoX, x);
                      handleChange(campoFocoY, y);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Lado Derecho: Textos */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground uppercase tracking-widest flex items-center gap-1.5">
              Título Principal
            </Label>
            <Input
              value={formData.banner_titulo}
              onChange={(e) => handleChange("banner_titulo", e.target.value)}
              placeholder="Ej: Colección Primavera"
              className="font-bold text-lg h-12"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground uppercase tracking-widest flex items-center gap-1.5">
              Subtítulo / Bajada
            </Label>
            <Input
              value={formData.banner_subtitulo}
              onChange={(e) => handleChange("banner_subtitulo", e.target.value)}
              placeholder="Ej: 15% OFF en todos los productos de interior"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground uppercase tracking-widest flex items-center gap-1.5">
                Texto del Botón
              </Label>
              <Input
                value={formData.banner_boton_texto}
                onChange={(e) =>
                  handleChange("banner_boton_texto", e.target.value)
                }
                placeholder="Ej: Ver productos"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground uppercase tracking-widest flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5" /> Link de destino
              </Label>
              <Input
                value={formData.banner_link}
                onChange={(e) => handleChange("banner_link", e.target.value)}
                placeholder="Ej: /store?categoria=interior"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
