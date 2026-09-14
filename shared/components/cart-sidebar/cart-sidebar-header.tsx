import type { ReactNode } from "react";
import { ArrowLeft, ShoppingBag, X } from "lucide-react";

interface CartSidebarHeaderProps {
  isPOSMode: boolean;
  onClose: () => void;
  /**
   * Vuelve al paso anterior del ticket.
   *
   * Opcional a propósito: el header lo comparten el POS y el carrito público,
   * y solo el POS tiene un paso al que volver. Sin esta prop no se dibuja
   * ninguna flecha, así que el carrito público no cambia.
   */
  onBack?: () => void;
  /** Un control extra a la derecha del título (el POS pone "Por cobrar"). */
  accion?: ReactNode;
}

export function CartSidebarHeader({
  isPOSMode,
  onClose,
  onBack,
  accion,
}: Readonly<CartSidebarHeaderProps>) {
  return (
    <div className="shrink-0 flex items-center justify-between p-4 border-b border-border">
      <h2 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 min-w-0">
        {/* La flecha REEMPLAZA a la bolsa en vez de sumarse: son las dos el
            elemento que abre el título, y dos íconos pegados se leen como
            decoración en vez de como el control que uno de los dos es. */}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            // `-my-2` es lo que mantiene la altura del header CONSTANTE entre
            // el paso de ticket y el de pago. El botón mide 36px (`h-9`) y el
            // título 20px, así que sin esto entrar al pago estiraba el header
            // de 52px a 68px y todo el panel daba un salto. Los -8px de arriba
            // y abajo le descuentan al layout justo esos 16px: el botón sigue
            // ocupando 36px de área táctil —que en un POS que se usa con el
            // dedo no se negocia— pero aporta 20px de alto, los mismos que el
            // texto que tiene al lado.
            className="-my-2 -ml-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            aria-label="Volver al ticket"
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </button>
        ) : (
          <ShoppingBag className="w-4 h-4 shrink-0" />
        )}
        <span className="truncate">{isPOSMode ? "Ticket" : "Tu Carrito"}</span>
      </h2>
      {accion}
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        aria-label={isPOSMode ? "Cerrar Ticket" : "Cerrar carrito"}
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
