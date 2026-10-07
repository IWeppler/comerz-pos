"use client";

import { ShoppingCart } from "lucide-react";
import { useCartStore } from "@/shared/store/cart-store";
import { useEffect, useState } from "react";

/** `badgeClassName`: color del contador. Por defecto el azul del sistema (POS);
 * la tienda pública lo pasa en foreground, que es su color de acción. */
export function CartButton({
  badgeClassName = "bg-primary text-primary-foreground border-primary",
}: Readonly<{ badgeClassName?: string }> = {}) {
  const [mounted, setMounted] = useState(false);
  const getTotalItems = useCartStore((state) => state.getTotalItems);
  const toggleCart = useCartStore((state) => state.toggleCart);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <button
      onClick={toggleCart}
      className="relative p-2 text-foreground hover:bg-muted transition-colors cursor-pointer group"
      aria-label="Abrir carrito"
    >
      <ShoppingCart className="w-6 h-6" strokeWidth={1.5} />

      {mounted && getTotalItems() > 0 && (
        <span className={`absolute top-0 right-0 md:translate-x-1 md:-translate-y-1 ${badgeClassName} text-[10px] font-semibold md:font-bold w-4 h-4 md:w-5 md:h-5 flex items-center justify-center rounded-full border-2`}>
          {getTotalItems()}
        </span>
      )}
    </button>
  );
}
