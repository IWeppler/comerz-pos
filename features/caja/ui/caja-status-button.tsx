"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import { useCajaModalStore } from "@/shared/store/caja-modal-store";
import { CajaQuickModal } from "./caja-quick-modal";
import { EgresoModal } from "./egreso-modal";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { formatearMoneda } from "@/shared/utils/formatters";

interface CajaStatusButtonProps {
  modoCaja: string;
  userId: string;
  className?: string;
}

/**
 * Estado de caja + acceso rápido a abrir/cerrar turno sin navegar a /caja.
 * Lee `isCajaAbierta` del store compartido (ver caja-status-store.ts) —
 * no dispara su propio fetch, Sidebar ya lo mantiene actualizado con el
 * polling de 60s + refetch inmediato al abrir/cerrar.
 */
export function CajaStatusButton({
  modoCaja,
  userId,
  className = "",
}: Readonly<CajaStatusButtonProps>) {
  const isCajaAbierta = useCajaStatusStore((state) => state.isCajaAbierta);
  const turno = useCajaStatusStore((state) => state.turno);
  // En el store y no en un useState local: la guía de inicio abre este mismo
  // modal desde el panel (ver caja-modal-store).
  const isModalOpen = useCajaModalStore((state) => state.abierto);
  const setIsModalOpen = useCajaModalStore((state) => state.setAbierto);
  // El egreso se dispara desde el modal de caja, pero se monta acá como
  // hermano: anidar un Dialog dentro de otro rompe foco y scroll-lock.
  const [isEgresoOpen, setIsEgresoOpen] = useState(false);

  const boton = (
    <button
      type="button"
      onClick={() => setIsModalOpen(true)}
      aria-label={
        isCajaAbierta
          ? `Caja abierta — efectivo esperado ${formatearMoneda(turno?.montoActual ?? 0)}`
          : "Abrir turno"
      }
      className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
        isCajaAbierta
          ? "border-success/20 bg-success/10 text-success hover:bg-success/20"
          : "border-border bg-muted text-muted-foreground hover:bg-muted/70"
      } ${className}`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          isCajaAbierta ? "bg-success" : "bg-muted-foreground/40"
        }`}
      />
      <Wallet className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">
        {isCajaAbierta === null
          ? "Caja"
          : isCajaAbierta
            ? "Caja abierta"
            : "Caja cerrada"}
      </span>
    </button>
  );

  return (
    <>
      {isCajaAbierta && turno ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{boton}</TooltipTrigger>
            <TooltipContent side="bottom">
              Efectivo esperado: {formatearMoneda(turno.montoActual)}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        boton
      )}

      <CajaQuickModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        modoCaja={modoCaja}
        userId={userId}
        onAnotarGasto={() => setIsEgresoOpen(true)}
      />

      <EgresoModal
        open={isEgresoOpen}
        onOpenChange={setIsEgresoOpen}
        mostrarTrigger={false}
      />
    </>
  );
}
