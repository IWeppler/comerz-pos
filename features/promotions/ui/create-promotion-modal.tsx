"use client";

import { useActionState, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Loader2, Plus, Tag } from "lucide-react";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Switch } from "@/shared/ui/switch";
import { createPromotionAction } from "../actions/create-promotion";
import { toast } from "sonner";
import { useActiveCategories } from "@/features/stock/hooks/use-active-categories";

type PromotionActionState = {
  error: string | null;
  success: boolean;
};

const initialState: PromotionActionState = {
  error: null,
  success: false,
};

export function CreatePromotionModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [tipoRegla, setTipoRegla] = useState("SIN_CONDICION");
  const [tipoDescuento, setTipoDescuento] = useState("PORCENTAJE");
  const [metodoPago, setMetodoPago] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [mostrarEnCatalogo, setMostrarEnCatalogo] = useState(false);
  // Default acumulable=false y prioridad=0: igual al default de la columna
  // en la base, para que el form no sugiera algo distinto de lo que se
  // guardaría si estos campos se omitieran.
  const [acumulable, setAcumulable] = useState(false);
  const [prioridad, setPrioridad] = useState("");
  const categorias = useActiveCategories();

  const resetForm = () => {
    setTipoRegla("SIN_CONDICION");
    setTipoDescuento("PORCENTAJE");
    setMetodoPago("");
    setCategoriaId("");
    setMostrarEnCatalogo(false);
    setAcumulable(false);
    setPrioridad("");
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) resetForm();
  };

  const [, formAction, isPending] = useActionState(
    async (previousState: PromotionActionState, formData: FormData) => {
      formData.append("tipo_regla", tipoRegla);
      formData.append("tipo_descuento", tipoDescuento);
      formData.append("mostrar_en_catalogo", String(mostrarEnCatalogo));
      formData.append("acumulable", String(acumulable));
      formData.append("prioridad", prioridad || "0");

      if (tipoRegla === "METODO_PAGO") {
        formData.append("metodo_pago", metodoPago);
      }

      if (tipoRegla === "CATEGORIA") {
        const categoriaSeleccionada = categorias.find(
          (cat) => cat.id === categoriaId,
        );
        formData.append(
          "categoria_nombre",
          categoriaSeleccionada?.nombre || "",
        );
      }

      const result = await createPromotionAction(previousState, formData);

      if (result.success) {
        toast.success("Promoción creada correctamente");
        setIsOpen(false);
        resetForm();
      } else if (result.error) {
        toast.error(result.error);
      }

      return result;
    },
    initialState,
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Nueva Promoción
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md w-[95vw] rounded-xl p-0 overflow-hidden bg-card border-border">
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Tag className="w-5 h-5 text-primary" />
            Crear Regla de Descuento
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[75vh]">
          <form action={formAction} className="p-6 space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="codigo">Código (opcional)</Label>
                <Input id="codigo" name="codigo" maxLength={20} autoCapitalize="characters" placeholder="Ej: VERANO10" className="h-11 uppercase" />
                <p className="text-xs text-muted-foreground">Sin código se aplica automáticamente. Con código, la clienta debe ingresarlo en el catálogo.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre de la promo</Label>
                <Input
                  id="nombre"
                  name="nombre"
                  placeholder="Ej: Especial 10% Efectivo"
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
                <Select value={tipoRegla} onValueChange={setTipoRegla} required>
                  <SelectTrigger className="w-full bg-background border-border">
                    <SelectValue placeholder="Selecciona la condición..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="METODO_PAGO">
                      Por Método de Pago
                    </SelectItem>
                    <SelectItem value="CATEGORIA">
                      Por Categoría de Producto
                    </SelectItem>
                    <SelectItem value="MONTO_MINIMO">
                      Por Monto Mínimo de Compra
                    </SelectItem>
                    <SelectItem value="SIN_CONDICION">
                      Sin condición (aplica siempre)
                    </SelectItem>
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
                      <SelectValue placeholder="Ej: EFECTIVO" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                      <SelectItem value="TRANSFERENCIA">
                        Transferencia
                      </SelectItem>
                      <SelectItem value="TARJETA">Tarjeta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {tipoRegla === "CATEGORIA" && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label>¿A qué categoría aplica?</Label>
                  <Select
                    value={categoriaId}
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
                    placeholder="Ej: 50000"
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
                    Habilita esta promoción en el catálogo. También se puede elegir en el POS.
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
                    onValueChange={setTipoDescuento}
                  >
                    <SelectTrigger className="w-full bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PORCENTAJE">Porcentaje (%)</SelectItem>
                      <SelectItem value="MONTO_FIJO">Monto fijo ($)</SelectItem>
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
                    placeholder={
                      tipoDescuento === "PORCENTAJE" ? "Ej: 15" : "Ej: 2000"
                    }
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
                <DatePickerAR id="fecha_inicio" name="fecha_inicio" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fecha_fin">Válido hasta (Opcional)</Label>
                <DatePickerAR id="fecha_fin" name="fecha_fin" />
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
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
                Guardar Regla
              </Button>
            </div>
          </form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
