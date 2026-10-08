"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import { useCajaModalStore } from "@/shared/store/caja-modal-store";
import { CajaQuickModal } from "./caja-quick-modal";
import { EgresoModal } from "./egreso-modal";
import { IngresoModal } from "./ingreso-modal";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { formatearMoneda } from "@/shared/utils/formatters";
import { esTurnoDeOtroDia } from "@/entities/caja/lib/turno-de-otro-dia";

interface CajaStatusButtonProps {
  modoCaja: string;
  userId: string;
  className?: string;
  /** `caja.registrar_ingreso`: habilita "Anotar ingreso" en el modal. */
  puedeRegistrarIngreso?: boolean;
  /**
   * Monta el modal de caja (y los de gasto e ingreso). Va en UNA sola de las
   * instancias: el chip está en el navbar y en el header del celular, las dos
   * montadas siempre (el CSS esconde una), y cada una traía su modal atado al
   * mismo `abierto` del store — o sea dos modales iguales abriéndose uno
   * encima del otro. El modal se portalea al body, así que funciona desde la
   * instancia que sea aunque esté escondida.
   */
  montarModal?: boolean;
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
  puedeRegistrarIngreso = false,
  montarModal = true,
}: Readonly<CajaStatusButtonProps>) {
  const isCajaAbierta = useCajaStatusStore((state) => state.isCajaAbierta);
  const turno = useCajaStatusStore((state) => state.turno);
  // En el store y no en un useState local: la guía de inicio abre este mismo
  // modal desde el panel (ver caja-modal-store).
  const isModalOpen = useCajaModalStore((state) => state.abierto);
  const setIsModalOpen = useCajaModalStore((state) => state.setAbierto);
  const setDisponible = useCajaModalStore((state) => state.setDisponible);
  // Avisa que el modal existe: el POS lo consulta antes de ofrecer "abrí la
  // caja" (ver `disponible` en caja-modal-store).
  useEffect(() => {
    if (!montarModal) return;
    setDisponible(true);
    return () => setDisponible(false);
  }, [montarModal, setDisponible]);
  // El egreso se dispara desde el modal de caja, pero se monta acá como
  // hermano: anidar un Dialog dentro de otro rompe foco y scroll-lock.
  const [isEgresoOpen, setIsEgresoOpen] = useState(false);
  const [isIngresoOpen, setIsIngresoOpen] = useState(false);
  // Quedó abierta de noche: no se puede vender hasta cerrarla (ver
  // turno-de-otro-dia.ts). El chip lo dice en ámbar para que se vea antes
  // de que el POS rebote la primera venta.
  const deOtroDia = Boolean(
    isCajaAbierta && esTurnoDeOtroDia(turno?.fecha_apertura),
  );

  const boton = (
    <button
      data-wizard="caja"
      type="button"
      onClick={() => setIsModalOpen(true)}
      aria-label={
        deOtroDia
          ? "La caja quedó abierta desde otro día: cerrala"
          : isCajaAbierta
            ? `Caja abierta — efectivo esperado ${formatearMoneda(turno?.montoActual ?? 0)}`
            : "Abrir turno"
      }
      className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
        deOtroDia
          ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
          : isCajaAbierta
            ? "border-success/20 bg-success/10 text-success hover:bg-success/20"
            : "border-border bg-muted text-muted-foreground hover:bg-muted/70"
      } ${className}`}
    >
      <Wallet className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">
        {isCajaAbierta === null
          ? "Caja"
          : deOtroDia
            ? "Caja de otro día: cerrala"
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

      {montarModal && (
        <>
          <CajaQuickModal
            open={isModalOpen}
            onOpenChange={setIsModalOpen}
            modoCaja={modoCaja}
            userId={userId}
            onAnotarGasto={() => setIsEgresoOpen(true)}
            onAnotarIngreso={
              puedeRegistrarIngreso ? () => setIsIngresoOpen(true) : undefined
            }
          />

          <EgresoModal
            open={isEgresoOpen}
            onOpenChange={setIsEgresoOpen}
            mostrarTrigger={false}
          />

          {puedeRegistrarIngreso && (
            <IngresoModal
              open={isIngresoOpen}
              onOpenChange={setIsIngresoOpen}
              mostrarTrigger={false}
            />
          )}
        </>
      )}
    </>
  );
}
