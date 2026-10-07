"use client";

import { useState, useTransition } from "react";
import {
  Tag,
  CheckCircle2,
  XCircle,
  Percent,
  DollarSign,
  MoreVertical,
  Edit2,
  Trash2,
  Power,
  CalendarDays,
  Layers,
  ArrowUpNarrowWide,
} from "lucide-react";
import { CreatePromotionModal } from "./create-promotion-modal";
import { EditPromotionModal } from "./edit-promotion-modal";
import { DeletePromotionModal } from "./delete-promotion-modal";
import { togglePromotionAction } from "../actions/manage-promotions";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

export interface Promotion {
  codigo?: string | null;
  id: string;
  nombre: string;
  tipo_regla: "METODO_PAGO" | "CATEGORIA" | "MONTO_MINIMO" | null;
  tipo_descuento: "PORCENTAJE" | "MONTO_FIJO";
  valor_descuento: number;
  activa: boolean;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  monto_minimo?: number;
  mostrar_en_catalogo?: boolean;
  acumulable?: boolean;
  prioridad?: number;
  promociones_metodos_pago?: { metodo_pago: string }[];
  promociones_categorias?: { categoria_nombre: string }[];
}

interface PromotionsPanelProps {
  promociones: Promotion[];
}

export function PromotionsPanel({
  promociones,
}: Readonly<PromotionsPanelProps>) {
  const [editingPromo, setEditingPromo] = useState<Promotion | null>(null);
  const [deletingPromo, setDeletingPromo] = useState<Promotion | null>(null);
  const [, startTransition] = useTransition();

  const handleToggle = (promo: Promotion) => {
    startTransition(async () => {
      const res = await togglePromotionAction(promo.id, promo.activa);
      if (res.success) {
        toast.success(
          `Promoción ${promo.activa ? "desactivada" : "activada"} correctamente.`,
        );
      } else {
        toast.error(res.error || "Ocurrió un error.");
      }
    });
  };

  // Helper para formatear fechas de manera compacta
  const formatDate = (dateString?: string | null) => {
    if (!dateString) return null;
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(new Date(dateString));
  };

  const renderDetalleCondicion = (promo: Promotion) => {
    if (promo.tipo_regla === "METODO_PAGO") {
      const metodo = promo.promociones_metodos_pago?.[0]?.metodo_pago;
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{metodo}</span>
        </div>
      );
    }

    if (promo.tipo_regla === "CATEGORIA") {
      const categoria = promo.promociones_categorias?.[0]?.categoria_nombre;
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{categoria}</span>
        </div>
      );
    }

    if (promo.tipo_regla === "MONTO_MINIMO") {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>
            Comprando más de <strong>${promo.monto_minimo}</strong>
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>Sin condición (aplica siempre)</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            Reglas de Descuento
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Automatiza promociones en el mostrador estableciendo condiciones y
            fechas de vigencia.
          </p>
        </div>
        <CreatePromotionModal />
      </div>

      {promociones.length === 0 ? (
        <div className="bg-card text-card-foreground p-12 rounded-2xl border border-border flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Tag className="w-8 h-8 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-bold">No hay promociones configuradas</h3>
          <p className="text-muted-foreground mt-2 max-w-sm text-sm">
            Crea tu primera regla para aplicar descuentos automáticos por pago
            en efectivo, montos mínimos o categorías específicas.
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-muted/30 text-muted-foreground text-xs uppercase font-bold tracking-widest border-b border-border/50">
                <tr>
                  <th className="px-5 py-4">Promoción</th>
                  <th className="px-5 py-4">Condición</th>
                  <th className="px-5 py-4">Beneficio</th>
                  <th className="px-5 py-4 text-center">Estado</th>
                  <th className="px-5 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {promociones.map((promo) => {
                  const inicio = formatDate(promo.fecha_inicio);
                  const fin = formatDate(promo.fecha_fin);

                  return (
                    <tr
                      key={promo.id}
                      className={`hover:bg-muted/30 transition-colors group ${!promo.activa ? "opacity-60" : ""}`}
                    >
                      {/* NOMBRE Y VIGENCIA */}
                      <td className="px-5 py-4 font-semibold text-foreground">
                        <div className="flex flex-col">
                          <span>{promo.codigo ? `${promo.codigo} · ` : ""}{promo.nombre}</span>
                          {inicio || fin ? (
                            <span className="text-[10px] text-muted-foreground font-normal mt-1 flex items-center gap-1.5">
                              <CalendarDays className="w-3 h-3" />
                              {inicio ?? "Siempre"} a {fin ?? "Siempre"}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground font-normal mt-1">
                              Vigencia permanente
                            </span>
                          )}
                        </div>
                      </td>

                      {/* CONDICIÓN DE ACTIVACIÓN */}
                      <td className="px-5 py-4 text-sm font-medium">
                        <div className="flex flex-col gap-1">
                          {renderDetalleCondicion(promo)}
                          {promo.mostrar_en_catalogo && (
                            <Badge
                              variant="outline"
                              className="w-fit text-[10px] font-normal text-muted-foreground"
                            >
                              Catálogo público (/store)
                            </Badge>
                          )}
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge
                              variant="outline"
                              className="w-fit text-[10px] font-normal text-muted-foreground"
                            >
                              <Layers className="w-2.5 h-2.5 mr-1 inline-block" />
                              {promo.acumulable ? "Acumulable" : "Exclusiva"}
                            </Badge>
                            {!!promo.prioridad && (
                              <Badge
                                variant="outline"
                                className="w-fit text-[10px] font-normal text-muted-foreground"
                              >
                                <ArrowUpNarrowWide className="w-2.5 h-2.5 mr-1 inline-block" />
                                Prioridad {promo.prioridad}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* BENEFICIO (El Descuento) */}
                      <td className="px-5 py-4">
                        {promo.tipo_descuento === "PORCENTAJE" ? (
                          <Badge
                            variant="info"
                          >
                            <Percent className="w-3 h-3 mr-0.5 inline-block" />
                            {promo.valor_descuento} OFF
                          </Badge>
                        ) : (
                          <Badge
                            variant="success"
                          >
                            <DollarSign className="w-3 h-3 inline-block" />
                            {promo.valor_descuento}
                          </Badge>
                        )}
                      </td>

                      {/* ESTADO */}
                      <td className="px-5 py-4 text-center">
                        {promo.activa ? (
                          <div className="flex items-center justify-center gap-1.5 text-success font-semibold text-xs">
                            <CheckCircle2 className="w-4 h-4" /> Activa
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5 text-muted-foreground font-semibold text-xs">
                            <XCircle className="w-4 h-4" /> Inactiva
                          </div>
                        )}
                      </td>

                      {/* ACCIONES (Dropdown) */}
                      <td className="px-5 py-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground rounded-md hover:bg-muted"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-48 p-1.5 rounded-xl border-border/60 shadow-md bg-card"
                          >
                            <DropdownMenuItem
                              className="cursor-pointer text-sm font-medium rounded-lg h-9"
                              onClick={() => handleToggle(promo)}
                            >
                              <Power className="w-4 h-4 mr-2" />
                              {promo.activa
                                ? "Desactivar promo"
                                : "Activar promo"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="cursor-pointer text-sm font-medium rounded-lg h-9"
                              onClick={() => setEditingPromo(promo)}
                            >
                              <Edit2 className="w-4 h-4 mr-2 text-success" />
                              Editar promo
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="my-1 bg-border/60" />
                            <DropdownMenuItem
                              className="cursor-pointer text-sm font-medium text-destructive focus:text-destructive focus:bg-destructive/10 rounded-lg h-9"
                              onClick={() => setDeletingPromo(promo)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Eliminar promo
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODALES INDEPENDIENTES */}
      {editingPromo && (
        <EditPromotionModal
          promo={editingPromo}
          open={!!editingPromo}
          onOpenChange={(open) => !open && setEditingPromo(null)}
        />
      )}

      {deletingPromo && (
        <DeletePromotionModal
          promo={deletingPromo}
          open={!!deletingPromo}
          onOpenChange={(open) => !open && setDeletingPromo(null)}
        />
      )}
    </div>
  );
}
