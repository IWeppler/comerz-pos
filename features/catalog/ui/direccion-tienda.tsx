"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Check, Copy, ExternalLink, Link2, Loader2, Save } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { partesDeUrlDeCatalogo } from "@/shared/lib/dominios";
import { SLUG_MAX, validarSlugNegocio } from "@/shared/lib/slug-negocio";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { cambiarSlugTiendaAction } from "@/features/config/actions/config-actions";

/**
 * La dirección web del catálogo, editable.
 *
 * Va SEPARADA del botón "Guardar Cambios" del resto del panel, y no es
 * prolijidad: lo demás son preferencias de cómo se ve la tienda y esto es la
 * URL que la clienta ya tiene guardada. Cambiarla rompe todos los links
 * compartidos —WhatsApp, la bio de Instagram, un QR impreso— y NO hay
 * redirección desde la dirección vieja: el slug es la clave con la que la RLS
 * resuelve el catálogo (`security.negocio_publico()`), así que la anterior
 * simplemente deja de existir. Por eso el aviso aparece recién cuando la
 * persona toca el campo, que es cuando importa.
 *
 * Solo se muestra la parte editable: el dominio (o `/store/`) no es del
 * comercio y un input que lo deje borrar invita a pegar una URL entera.
 */
export function DireccionTienda() {
  const router = useRouter();
  const negocio = useNegocioActivo();
  const slugActual = negocio?.slug ?? "";

  const [slug, setSlug] = useState(slugActual);
  const [guardando, setGuardando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // Las partes salen SIEMPRE del slug guardado, no del que se está tipeando:
  // el link de "Abrir" y el de "Copiar" tienen que ser el que hoy funciona.
  const { prefijo, sufijo, url } = partesDeUrlDeCatalogo(slugActual || "tienda");

  const limpio = slug.trim().toLowerCase();
  const cambio = limpio !== slugActual;
  const validacion = validarSlugNegocio(limpio);
  const errorFormato = cambio && !validacion.valido ? validacion.error : null;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      toast.success("Link copiado");
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("No se pudo copiar el link");
    }
  };

  const guardar = async () => {
    setGuardando(true);
    const { error, slug: nuevo } = await cambiarSlugTiendaAction(limpio);
    setGuardando(false);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success("Dirección actualizada");
    if (nuevo) setSlug(nuevo);
    // El slug viaja en el layout: sin esto el panel sigue armando links a la
    // dirección vieja hasta la próxima navegación completa.
    router.refresh();
  };

  if (!negocio) return null;

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="border-b border-border/50 pb-3">
        <h3 className="font-bold text-foreground flex items-center gap-2">
          <Link2 className="w-4 h-4 text-muted-foreground" /> Dirección de tu
          tienda
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Es el link que les pasás a tus clientas para que vean el catálogo.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug-tienda" className="text-sm font-semibold">
          Link del catálogo
        </Label>

        {/* El prefijo y el sufijo se ven pero no se editan: el dominio no es
            del comercio. En mobile se apilan para no comerse el input. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-muted/30 focus-within:ring-2 focus-within:ring-primary/40 w-full overflow-hidden">
            <span className="pl-3 text-sm text-muted-foreground shrink-0 max-sm:hidden">
              {prefijo}
            </span>
            <Input
              id="slug-tienda"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              maxLength={SLUG_MAX}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="border-0 bg-transparent font-semibold focus-visible:ring-0 px-1 min-w-0"
            />
            {sufijo && (
              <span className="pr-3 text-sm text-muted-foreground shrink-0">
                {sufijo}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copiar}
              title="Copiar link"
              aria-label="Copiar link"
            >
              {copiado ? (
                <Check className="w-4 h-4 text-primary" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
            <Button
              asChild
              variant="outline"
              size="icon"
              title="Abrir la tienda"
              aria-label="Abrir la tienda"
            >
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>

        {/* En mobile el prefijo no entra al lado del input, así que el link
            completo se muestra abajo: sin él no se sabe qué se está copiando. */}
        <p className="text-xs text-muted-foreground break-all sm:hidden">
          {url}
        </p>

        {errorFormato && (
          <p className="text-xs font-medium text-destructive">{errorFormato}</p>
        )}

        {cambio && !errorFormato && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            Al guardar, la dirección anterior deja de funcionar: los links que
            ya compartiste y los códigos QR impresos van a dar error.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={guardar}
          disabled={!cambio || Boolean(errorFormato) || guardando}
          variant={cambio ? "default" : "outline"}
        >
          {guardando ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Guardar dirección
        </Button>
      </div>
    </div>
  );
}
