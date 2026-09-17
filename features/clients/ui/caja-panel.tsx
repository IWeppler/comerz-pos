"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfiguracionPOS } from "@/entities/config/types";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Calculator, Loader2, Lock, Users, Store } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/shared/config/supabase/client";
import { PaywallGate } from "@/features/planes/ui/paywall-gate";
import { CobroCentralizado } from "@/features/pedidos/ui/cobro-centralizado";

interface CajaConfigPanelProps {
  config: ConfiguracionPOS;
}

export function CajaConfigPanel({ config }: Readonly<CajaConfigPanelProps>) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    modo_caja: config.modo_caja || "UNICA",
    requiere_caja_abierta: config.requiere_caja_abierta ?? true,
    permitir_venta_sin_stock: config.permitir_venta_sin_stock ?? false,
  });

  const handleChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    const supabase = createClient();

    const { error } = await supabase
      .from("configuracion_pos")
      .update(formData)
      .eq("id", config.id);

    setIsSaving(false);

    if (error) {
      toast.error("Error al guardar la configuración de caja.");
      console.error(error);
    } else {
      toast.success("Reglas de Caja actualizadas correctamente.");
      router.refresh();
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Calculator className="w-5 h-5 text-success" /> Caja y Turnos
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configura cómo se maneja el flujo de efectivo y la apertura de
            turnos en tu local.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full sm:w-auto"
        >
          {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Guardar Cambios
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* COLUMNA IZQ: Modo de Caja */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-2xl p-5 space-y-6">
            <h3 className="font-bold text-foreground flex items-center gap-2 border-b border-border/50 pb-3">
              <Store className="w-4 h-4 text-muted-foreground" />
              Modelo Operativo
            </h3>

            <div className="space-y-3">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Modo de Caja</Label>
                <p className="text-xs text-muted-foreground">
                  Define si todo el negocio usa una misma caja (física) o si
                  cada vendedor rinde su propio dinero.
                </p>
              </div>

              {/* Multicaja es del plan Gestión para arriba: acá el dueño se
                  entera antes de intentarlo, no cuando le rebota. */}
              <PaywallGate feature="multicaja" className="w-full">
                <Select
                  value={formData.modo_caja}
                  onValueChange={(val) => handleChange("modo_caja", val)}
                >
                  <SelectTrigger className="h-14 rounded-xl border-border bg-muted/20 font-semibold">
                    <SelectValue placeholder="Selecciona el modo..." />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border">
                    <SelectItem value="UNICA" className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-info/10 text-info rounded-md">
                          <Store className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col text-left">
                          <span className="font-bold text-foreground text-sm">
                            Caja Única (General)
                          </span>
                          <span className="text-xs text-muted-foreground font-normal">
                            Todas las ventas van al mismo turno de caja.
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                    <SelectItem value="POR_USUARIO" className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-emerald-50 text-success rounded-md">
                          <Users className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col text-left">
                          <span className="font-bold text-foreground text-sm">
                            Caja por Usuario (Multicaja)
                          </span>
                          <span className="text-xs text-muted-foreground font-normal">
                            Cada vendedor abre y cierra su propio turno.
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </PaywallGate>
            </div>
          </div>
        </div>

        {/* COLUMNA DER: Seguridad y Restricciones */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-2xl p-5 space-y-6">
            <h3 className="font-bold text-foreground flex items-center gap-2 border-b border-border/50 pb-3">
              <Lock className="w-4 h-4 text-muted-foreground" />
              Seguridad y Restricciones
            </h3>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label className="text-sm font-semibold">
                  Exigir Turno Abierto para Vender
                </Label>
                <p className="text-xs text-muted-foreground">
                  Si está activo, el sistema bloqueará el botón de
                  &quot;Cobrar&quot; si el usuario o el local no tienen una caja
                  abierta.{" "}
                  <strong className="text-foreground">Recomendado.</strong>
                </p>
              </div>
              <Switch
                checked={formData.requiere_caja_abierta}
                onCheckedChange={(v) =>
                  handleChange("requiere_caja_abierta", v)
                }
                className="mt-1"
              />
            </div>

            <div className="flex items-start justify-between gap-4 border-t border-border/50 pt-6">
              <div className="space-y-1">
                <Label className="text-sm font-semibold">
                  Permitir Venta Sin Stock
                </Label>
                <p className="text-xs text-muted-foreground">
                  Si está activo, se puede vender una variante aunque su stock
                  disponible sea 0, dejando el stock en negativo. Si está
                  apagado (recomendado), la venta se bloquea.
                </p>
              </div>
              <Switch
                checked={formData.permitir_venta_sin_stock}
                onCheckedChange={(v) =>
                  handleChange("permitir_venta_sin_stock", v)
                }
                className="mt-1"
              />
            </div>
          </div>
        </div>
      </div>

      <CobroCentralizado activo={config.pedidos_a_caja ?? false} />
    </div>
  );
}
