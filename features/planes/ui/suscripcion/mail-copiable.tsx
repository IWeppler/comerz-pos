"use client";

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";

/**
 * La dirección de contacto, que se copia al tocarla.
 *
 * No es un `mailto:` a propósito: ese abre el cliente de correo del sistema, y
 * en una PC de comercio con Outlook instalado y sin cuenta configurada lo que
 * aparece es un asistente de configuración. La vendedora lo cierra y el mail
 * nunca se manda. Copiar y pegar en el webmail que ya usa siempre funciona.
 *
 * La dirección se muestra completa: hay que poder leerla y anotarla aunque el
 * portapapeles falle (pasa en contextos sin HTTPS o sin permiso).
 */
export function MailCopiable({ email }: Readonly<{ email: string }>) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiado(true);
      toast.success("Mail copiado");
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin portapapeles el mail sigue a la vista para copiarlo a mano.
      toast.error("No se pudo copiar. El mail es " + email);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copiar}
      className="h-11 gap-2 sm:w-auto"
      aria-label={`Copiar el mail de contacto ${email}`}
    >
      <Mail className="size-4 shrink-0" aria-hidden />
      <span className="font-mono text-xs sm:text-sm">{email}</span>
      {copiado ? (
        <Check className="size-3.5 shrink-0 text-success" aria-hidden />
      ) : (
        <Copy className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </Button>
  );
}
