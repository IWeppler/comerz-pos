"use client";

import { useActionState, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { DatePickerAR } from "@/shared/components/date-picker-ar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Loader2, Tag } from "lucide-react";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Switch } from "@/shared/ui/switch";
import { editPromotionAction } from "../actions/manage-promotions";
import { Promotion } from "./promotions-panel";
import { toast } from "sonner";
import { useActiveCategories } from "@/features/stock/hooks/use-active-categories";

// --- CONSTANTES PARA LOS SELECTS ---
const TIPO_REGLA_OPTIONS = [
  { value: "METODO_PAGO", label: "Por Método de Pago" },
  { value: "CATEGORIA", label: "Por Categoría de Producto" },
  { value: "MONTO_MINIMO", label: "Por Monto Mínimo de Compra" },
  { value: "SIN_CONDICION", label: "Sin condición (aplica siempre)" },
] as const;

const METODO_PAGO_OPTIONS = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "TARJETA", label: "Tarjeta" },
] as const;

const TIPO_DESCUENTO_OPTIONS = [
  { value: "PORCENTAJE", label: "Porcentaje (%)" },
  { value: "MONTO_FIJO", label: "Monto fijo ($)" },
] as const;

type TipoRegla = (typeof TIPO_REGLA_OPTIONS)[number]["value"];
type TipoDescuento = (typeof TIPO_DESCUENTO_OPTIONS)[number]["value"];
type PromotionActionState = {
  error: string | null;
  success: boolean;
};

export function EditPromotionModal({
  promo,
  open,
  onOpenChange,
}: {
  promo: Promotion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tipoRegla, setTipoRegla] = useState<TipoRegla>(
    promo.tipo_regla ?? "SIN_CONDICION",
  );
  const [tipoDescuento, setTipoDescuento] = useState<TipoDescuento>(
    promo.tipo_descuento,
  );
  const [metodoPago, setMetodoPago] = useState(
    promo.promociones_metodos_pago?.[0]?.metodo_pago || "",
  );
  const [categoriaId, setCategoriaId] = useState("");
  const [mostrarEnCatalogo, setMostrarEnCatalogo] = useState(
    promo.mostrar_en_catalogo ?? false,
  );
  const [acumulable, setAcumulable] = useState(promo.acumulable ?? false);
  const [prioridad, setPrioridad] = useState(
    promo.prioridad != null ? String(promo.prioridad) : "",
  );
  const categorias = useActiveCategories();
  const categoriaInicialNombre =
    promo.promociones_categorias?.[0]?.categoria_nombre || "";
  const categoriaSeleccionada =
    categorias.find((cat) => cat.id === categoriaId) ||
    categorias.find((cat) => cat.nombre === categoriaInicialNombre);

  const [, formAction, isPending] = useActionState(
    async (previousState: PromotionActionState, formData: FormData) => {
      formData.append("id", promo.id);
      formData.append("tipo_regla", tipoRegla);
      formData.append("tipo_descuento", tipoDescuento);
      formData.append("mostrar_en_catalogo", String(mostrarEnCatalogo));
      formData.append("acumulable", String(acumulable));
      formData.append("prioridad", prioridad || "0");

      if (tipoRegla === "METODO_PAGO")
        formData.append("metodo_pago", metodoPago);
      if (tipoRegla === "CATEGORIA")
        formData.append(
          "categoria_nombre",
          categoriaSeleccionada?.nombre || categoriaInicialNombre,
        );

      const result = await editPromotionAction(previousState, formData);

      if (result.success) {
        toast.success("Promoción actualizada correctamente");
        onOpenChange(false);
      } else if (result.error) {
        toast.error(result.error);
      }
      return result;
    },
    { error: null, success: false },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md w-[95vw] rounded-xl p-0 overflow-hidden bg-card border-border">
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Tag className="w-5 h-5 text-primary" />
            Editar Regla de Descuento
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[75vh]">
          <form action={formAction} className="p-6 space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="codigo">Código (opcional)</Label>
                <Input id="codigo" name="codigo" defaultValue={promo.codigo ?? ""} maxLength={20} autoCapitalize="characters" placeholder="Ej: VERANO10" className="h-11 uppercase" />
                <p className="text-xs text-muted-foreground">Vacío: promoción automática. Con código: se aplica al ingresarlo en el catálogo.</p>
                <Label htmlFor="nombre">Nombre de la promo</Label>
                <Input
                  id="nombre"
                  name="nombre"
                  defaultValue={promo.nombre}
                  required
                />
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <h4 className="text-sm font-bold text-foreground">
                ¿Cuándo aplica este descuento?
              </h4>

              <div className="space-y-2">
                <Label>Tipo de condición</Label>
                <Select
                  value={tipoRegla}
                  onValueChange={(val) => setTipoRegla(val as TipoRegla)}
                  required
                >
                  <SelectTrigger className="w-full bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPO_REGLA_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {tipoRegla === "METODO_PAGO" && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label>¿Con qué método pagan?</Label>
                  <Select
                    value={metodoPago}
                    onValueChange={setMetodoPago}
                    required
                  >
                    <SelectTrigger className="w-full bg-background border-border">
                      <SelectValue placeholder="Selecciona el método" />
                    </SelectTrigger>
                    <SelectContent>
                      {METODO_PAGO_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {tipoRegla === "CATEGORIA" && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label>¿A qué categoría aplica?</Label>
                  <Select
                    value={categoriaSeleccionada?.id || ""}
                    onValueChange={setCategoriaId}
                    required
                  >
                    <SelectTrigger className="w-full bg-background border-border">
                      <SelectValue placeholder="Selecciona categoría..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categorias.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {tipoRegla === "MONTO_MINIMO" && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label htmlFor="monto_minimo">Monto mínimo del carrito</Label>
                  <Input
                    id="monto_minimo"
                    name="monto_minimo"
                    type="number"
                    min="0"
                    defaultValue={promo.monto_minimo}
                    required
                  />
                </div>
              )}

              <div className="flex items-start justify-between gap-4 pt-2">
                <div className="space-y-1">
                  <Label htmlFor="mostrar_en_catalogo">
                    Mostrar en catálogo público (/store)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Se muestra como aviso informativo en el carrito. No aplica
                    en el POS presencial.
                  </p>
                </div>
                <Switch
                  id="mostrar_en_catalogo"
                  checked={mostrarEnCatalogo}
                  onCheckedChange={setMostrarEnCatalogo}
                />
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <h4 className="text-sm font-bold text-foreground">
                ¿Qué beneficio le damos?
              </h4>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de rebaja</Label>
                  <Select
                    value={tipoDescuento}
                    onValueChange={(val) =>
                      setTipoDescuento(val as TipoDescuento)
                    }
                  >
                    <SelectTrigger className="w-full bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPO_DESCUENTO_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>
                    Valor ({tipoDescuento === "PORCENTAJE" ? "%" : "$"})
                  </Label>
                  <Input
                    name="valor_descuento"
                    type="number"
                    min="1"
                    step="any"
                    defaultValue={promo.valor_descuento}
                    required
                  />
                </div>
              </div>

              <div className="flex items-start justify-between gap-4 pt-2">
                <div className="space-y-1">
                  <Label htmlFor="acumulable">
                    Acumulable con otras promociones
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Si está activado, su descuento se suma al de otras promos
                    acumulables. Si no, compite por aplicarse ella sola.
                  </p>
                </div>
                <Switch
                  id="acumulable"
                  checked={acumulable}
                  onCheckedChange={setAcumulable}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="prioridad">Prioridad (opcional)</Label>
                <Input
                  id="prioridad"
                  type="number"
                  step="1"
                  placeholder="0"
                  value={prioridad}
                  onChange={(e) => setPrioridad(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Si dos promociones no acumulables compiten con el mismo
                  descuento en pesos, gana la de mayor prioridad.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
              <div className="space-y-2">
                <Label htmlFor="fecha_inicio">Válido desde (Opcional)</Label>
                <DatePickerAR
                  id="fecha_inicio"
                  name="fecha_inicio"
                  defaultValue={
                    promo.fecha_inicio ? promo.fecha_inicio.split("T")[0] : ""
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fecha_fin">Válido hasta (Opcional)</Label>
                <DatePickerAR
                  id="fecha_fin"
                  name="fecha_fin"
                  defaultValue={
                    promo.fecha_fin ? promo.fecha_fin.split("T")[0] : ""
                  }
                />
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="bg-primary text-white hover:bg-primary/90 cursor-pointer"
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                Actualizar
              </Button>
            </div>
          </form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
