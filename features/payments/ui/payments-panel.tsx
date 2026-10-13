"use client";

import { useState, useTransition } from "react";
import {
  CreditCard,
  Banknote,
  Smartphone,
  Clock,
  CheckCircle2,
  XCircle,
  MoreVertical,
  Edit2,
  Trash2,
  Wallet,
  Power,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { toast } from "@/shared/ui/toast";
import { togglePaymentAction } from "../actions/manage-payment";
import { CreatePaymentModal } from "./create-payment-modal";
import { EditPaymentModal } from "./edit-payment-modal";
import { DeletePaymentModal } from "./delete-payment-modal";
import { MetodoPago, TipoMetodo } from "@/entities/payments/types";

export function PaymentsPanel({ pagos }: Readonly<{ pagos: MetodoPago[] }>) {
  const [editingPayment, setEditingPayment] = useState<MetodoPago | null>(null);
  const [deletingPayment, setDeletingPayment] = useState<MetodoPago | null>(
    null,
  );
  const [, startTransition] = useTransition();

  const getIconForType = (tipo: TipoMetodo) => {
    switch (tipo) {
      case "EFECTIVO":
        return <Banknote className="w-4 h-4 text-foreground" />;
      case "TRANSFERENCIA":
        return <Smartphone className="w-4 h-4 text-foreground" />;
      case "BILLETERA_VIRTUAL":
        return <Wallet className="w-4 h-4 text-foreground" />;
      case "TARJETA":
        return <CreditCard className="w-4 h-4 text-foreground" />;
      default:
        return <CreditCard className="w-4 h-4 text-foreground" />;
    }
  };

  const toggleStatus = (pago: MetodoPago) => {
    startTransition(async () => {
      const res = await togglePaymentAction(pago.id, pago.activo);
      if (res.success) {
        toast.info(`Método ${pago.activo ? "desactivado" : "activado"}`);
      } else {
        toast.error(res.error || "Ocurrió un error.");
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Métodos de Pago</h2>
          <p className="text-sm text-muted-foreground mt-1">
            El <strong>recargo</strong> se le suma al cliente en el ticket. La{" "}
            <strong>comisión</strong> es lo que te cobra el procesador y se
            descuenta de tu margen real.
          </p>
        </div>
        <CreatePaymentModal />
      </div>

      {pagos.length === 0 ? (
        <div className="bg-card text-card-foreground p-12 rounded-2xl border border-border flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <CreditCard className="w-8 h-8 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-bold">
            No hay métodos de pago configurados
          </h3>
          <p className="text-muted-foreground mt-2 max-w-sm text-sm">
            Agrega las opciones de pago que aceptas en el local para que
            aparezcan disponibles en la caja.
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/40 text-muted-foreground text-[10px] uppercase font-bold tracking-widest border-b border-border/50">
                <tr>
                  <th className="px-5 py-4">Método</th>
                  <th className="px-5 py-4 text-right">Recargo al cliente</th>
                  <th className="px-5 py-4 text-right">Comisión</th>
                  <th className="px-5 py-4">Acreditación</th>
                  <th className="px-5 py-4 text-center">Estado</th>
                  <th className="px-5 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {pagos.map((pago) => (
                  <tr
                    key={pago.id}
                    className={`transition-colors group ${
                      !pago.activo
                        ? "bg-muted/10 opacity-70"
                        : "hover:bg-muted/30"
                    }`}
                  >
                    {/* NOMBRE Y TIPO */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2 rounded-lg border text-muted-foreground`}
                        >
                          {getIconForType(pago.tipo)}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-foreground">
                            {pago.nombre}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mt-0.5">
                            {pago.tipo.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* RECARGO AL CLIENTE — lo que se le suma al ticket */}
                    <td className="px-5 py-4 text-right">
                      {Number(pago.recargo_porcentaje) > 0 ? (
                        <Badge className="font-bold rounded-lg border-warning/20 bg-warning/10 text-warning shadow-none px-2 py-1">
                          +{pago.recargo_porcentaje}%
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Sin recargo
                        </span>
                      )}
                    </td>

                    {/* COMISIÓN */}
                    <td className="px-5 py-4 text-right">
                      <Badge
                        variant="outline"
                        className={`font-medium rounded-lg border-border bg-muted/20 text-muted-foreground shadow-none px-2 py-1`}
                      >
                        {pago.comision}%
                      </Badge>
                    </td>

                    {/* PLAZO DE ACREDITACIÓN */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                        <Clock className="w-3.5 h-3.5" />
                        {pago.acreditacion_dias === 0 ? (
                          <span>Inmediata</span>
                        ) : (
                          <span>
                            En {pago.acreditacion_dias}{" "}
                            {pago.acreditacion_dias === 1 ? "día" : "días"}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* ESTADO */}
                    <td className="px-5 py-4 text-center">
                      {pago.activo ? (
                        <div className="flex items-center justify-center gap-1.5 text-success text-xs">
                          <CheckCircle2 className="w-4 h-4" /> Activo
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
                          <XCircle className="w-4 h-4" /> Inactivo
                        </div>
                      )}
                    </td>

                    {/* ACCIONES */}
                    <td className="px-5 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer rounded-md hover:bg-muted"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-48 p-1.5 rounded-xl border-border/60 shadow-md bg-card"
                        >
                          <DropdownMenuItem
                            onClick={() => toggleStatus(pago)}
                            className="cursor-pointer text-sm font-medium rounded-lg h-9"
                          >
                            <Power className="w-4 h-4 mr-2" />
                            {pago.activo ? "Desactivar" : "Activar"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setEditingPayment(pago)}
                            className="cursor-pointer text-sm font-medium rounded-lg h-9"
                          >
                            <Edit2 className="w-4 h-4 mr-2 text-info" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="my-1 bg-border/60" />
                          <DropdownMenuItem
                            onClick={() => setDeletingPayment(pago)}
                            className="cursor-pointer text-sm font-medium text-destructive focus:text-destructive focus:bg-destructive/10 rounded-lg h-9"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODALES INDEPENDIENTES */}
      {editingPayment && (
        <EditPaymentModal
          pago={editingPayment}
          open={!!editingPayment}
          onOpenChange={(open) => !open && setEditingPayment(null)}
        />
      )}

      {deletingPayment && (
        <DeletePaymentModal
          pago={deletingPayment}
          open={!!deletingPayment}
          onOpenChange={(open) => !open && setDeletingPayment(null)}
        />
      )}
    </div>
  );
}
