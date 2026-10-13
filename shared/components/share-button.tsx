"use client";

import { useState, type MouseEvent } from "react";
import { Copy, MessageCircle, Share2 } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  compartirNativo,
  construirLinkWhatsApp,
  puedeCompartirNativo,
} from "@/shared/utils/compartir-catalogo";

interface ShareButtonProps {
  url: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Si se pasa, el botón muestra ícono + texto. Sin esto, es solo ícono. */
  label?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "icon" | "icon-xs" | "icon-sm" | "sm" | "default";
  className?: string;
}

/**
 * Botón "Compartir" reutilizable: si el navegador soporta Web Share API la
 * usa directo (hoja nativa, deja elegir WhatsApp o lo que sea). Si no,
 * cae a un popover chico con "Copiar link" y "Enviar por WhatsApp".
 * Detecta por capability (typeof navigator.share), no por user-agent.
 *
 * Comparte SOLO el link, sin nombre ni precio adelante: el preview del
 * link (og:title / og:image) ya muestra eso, y el texto suelto quedaba
 * duplicado y viejo si el precio cambiaba después de mandarlo.
 */
export function ShareButton({
  url,
  disabled = false,
  disabledReason,
  label,
  variant = "outline",
  size = "icon-sm",
  className,
}: Readonly<ShareButtonProps>) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const nativo = puedeCompartirNativo();
  const iconClassName = label ? "h-4 w-4 mr-1.5" : "h-4 w-4";

  const handleNativeClick = async (event: MouseEvent) => {
    event.stopPropagation();
    await compartirNativo({ url });
  };

  const handleCopiar = async (event: MouseEvent) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado al portapapeles");
    setIsPopoverOpen(false);
  };

  const handleWhatsApp = (event: MouseEvent) => {
    event.stopPropagation();
    window.open(construirLinkWhatsApp(url), "_blank");
    setIsPopoverOpen(false);
  };

  if (nativo) {
    return (
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        onClick={handleNativeClick}
        title={disabled ? disabledReason : "Compartir"}
        aria-label="Compartir"
      >
        <Share2 className={iconClassName} />
        {label}
      </Button>
    );
  }

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant={variant}
          size={size}
          className={className}
          disabled={disabled}
          onClick={(event: MouseEvent) => event.stopPropagation()}
          title={disabled ? disabledReason : "Compartir"}
          aria-label="Compartir"
        >
          <Share2 className={iconClassName} />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-56 p-1.5"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleCopiar}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-foreground hover:bg-muted cursor-pointer"
        >
          <Copy className="h-4 w-4 text-muted-foreground" />
          Copiar link
        </button>
        <button
          type="button"
          onClick={handleWhatsApp}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-foreground hover:bg-muted cursor-pointer"
        >
          <MessageCircle className="h-4 w-4 text-success" />
          Enviar por WhatsApp
        </button>
      </PopoverContent>
    </Popover>
  );
}
