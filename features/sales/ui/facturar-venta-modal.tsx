"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { formatearMoneda } from "@/shared/utils/formatters";
import type { ComprobanteFiscalTicket } from "@/shared/lib/comprobante-fiscal-ticket";
import {
  numeroComprobanteFiscal,
  tituloComprobante,
} from "@/shared/lib/comprobante-fiscal-ticket";
import { facturarVentaAction } from "../actions/facturar-venta";

interface Props {
  ventaId: string;
  total: number;
  clienteNombre: string | null;
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
  /** Con la factura emitida: el que llama abre el ticket ya como factura. */
  onFacturada: (fiscal: ComprobanteFiscalTicket) => void;
}

/**
 * Confirmación antes de pedir el CAE de una venta que salió con ticket.
 * Es irreversible del lado de ARCA (deshacer es una nota de crédito), así
 * que no va directo desde el menú.
 */
export function FacturarVentaModal({
  ventaId,
  total,
  clienteNombre,
  open,
  onOpenChange,
  onFacturada,
}: Readonly<Props>) {
  const [pendiente, startTransition] = useTransition();
  const router = useRouter();

  const confirmar = () => {
    startTransition(async () => {
      const r = await facturarVentaAction(ventaId);
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `${tituloComprobante(r.fiscal.tipo)} ${numeroComprobanteFiscal(r.fiscal)} emitida (CAE ${r.fiscal.cae}).`,
      );
      onOpenChange(false);
      onFacturada(r.fiscal);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !pendiente && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-primary" />
            Facturar esta venta
          </DialogTitle>
          <DialogDescription>
            Se le pide el CAE a ARCA por {formatearMoneda(total)}
            {clienteNombre ? ` a nombre de ${clienteNombre}` : " a consumidor final"}
            , con fecha de hoy. La letra la decide el sistema según el
            cliente. Deshacerlo después es una nota de crédito.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            disabled={pendiente}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="button" disabled={pendiente} onClick={confirmar}>
            {pendiente ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Pidiendo CAE…
              </>
            ) : (
              "Emitir factura"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
