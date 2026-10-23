"use client";

import { FormEvent, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Edit2, Loader2, Building2 } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { CuitInput } from "@/shared/components/cuit-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { Switch } from "@/shared/ui/switch";
import { SelectorListaCliente } from "./selector-lista-cliente";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { DatePickerAR } from "@/shared/components/date-picker-ar";
import { Cliente } from "@/entities/clientes/type";
import { editClienteAction } from "../actions/manage-clients";
import { queryKeys } from "@/shared/lib/query-keys";

interface EditClientModalProps {
  cliente: Cliente | null;
  onClose: () => void;
  entregaMinimaActiva?: boolean;
  /**
   * La lista de precios es un descuento permanente: solo la asigna un ADMIN
   * (la base lo exige, `trg_proteger_campos_cliente`). Sin el selector el form
   * no manda el centinela y la action no toca la lista.
   */
  puedeAsignarLista?: boolean;
}

export function EditClientModal({
  cliente,
  onClose,
  entregaMinimaActiva = false,
  puedeAsignarLista = false,
}: Readonly<EditClientModalProps>) {
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  // Estados para datos fiscales
  const [isFiscal, setIsFiscal] = useState(false);

  // El switch se siembra desde el cliente que se abre. Es importante que salga
  // de `cliente.cuit`: si arrancara en false, guardar sin tocar el toggle
  // mandaría es_fiscal=false y la action le borraría al cliente TODOS sus
  // datos fiscales sin avisar.
  //
  // Se hace durante el render y no en un useEffect (patrón "adjusting state
  // when props change" de React): con el efecto había un render intermedio en
  // el que el modal ya mostraba al cliente nuevo con el CUIT del anterior.
  const [clienteSembrado, setClienteSembrado] = useState<string | undefined>();
  if (cliente && cliente.id !== clienteSembrado) {
    setClienteSembrado(cliente.id);
    setIsFiscal(!!cliente.cuit);
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!cliente) return;

    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await editClienteAction(cliente.id, formData);
      if (result.success) {
        toast.success("Cliente actualizado correctamente.");
        queryClient.invalidateQueries({ queryKey: queryKeys.clientes.listado });
        queryClient.invalidateQueries({
          queryKey: queryKeys.clientes.detalle(cliente.id),
        });
        onClose();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={!!cliente} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl border-border bg-card max-h-[90vh] overflow-y-auto p-0">
        <div className="p-6 pb-2">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Edit2 className="w-5 h-5 text-info" /> 
              Editar Cliente
            </DialogTitle>
          </DialogHeader>
        </div>

        {cliente ? (
          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-5">
            
            {/* ==========================================
                DATOS COMERCIALES (Siempre visibles)
            ========================================== */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-nombre" className="text-sm font-medium">
                  Nombre Completo <span className="text-danger">*</span>
                </Label>
                <Input
                  id="edit-nombre"
                  name="nombre"
                  defaultValue={cliente.nombre}
                  required
                  className="h-10 shadow-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-telefono" className="text-sm font-medium">
                  WhatsApp
                </Label>
                <Input
                  id="edit-telefono"
                  name="telefono"
                  defaultValue={cliente.telefono}
                  className="h-10 shadow-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-email" className="text-sm font-medium">
                  Correo (Opcional)
                </Label>
                <Input
                  id="edit-email"
                  name="email"
                  type="email"
                  defaultValue={cliente.email || ""}
                  className="h-10 shadow-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-dni" className="text-sm font-medium">
                  DNI (Consumidor Final)
                </Label>
                <Input
                  id="edit-dni"
                  name="dni"
                  defaultValue={cliente.dni || ""}
                  className="h-10 shadow-none"
                />
              </div>

              {/* Dirección de contacto/entrega, independiente del toggle
                  fiscal. El domicilio fiscal es otro campo, más abajo. */}
              <div className="space-y-2 sm:col-span-2">
                <Label
                  htmlFor="edit-direccion-comercial"
                  className="text-sm font-medium"
                >
                  Dirección (Opcional)
                </Label>
                <Input
                  id="edit-direccion-comercial"
                  name="direccion_comercial"
                  defaultValue={cliente.direccion_comercial || ""}
                  placeholder="Ej: Belgrano 450, Tostado"
                  className="h-10 shadow-none"
                />
              </div>
            </div>

            {/* ==========================================
                TOGGLE FISCAL
            ========================================== */}
            <div className={`flex items-center justify-between p-4 border rounded-xl transition-colors ${isFiscal ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border'}`}>
              <div className="space-y-0.5">
                <Label htmlFor="edit-is-fiscal" className="text-sm font-bold flex items-center gap-2 cursor-pointer">
                  <Building2 className="w-4 h-4 text-primary" />
                  Cliente Fiscal (Factura A / B)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Habilitá esta opción para cargar CUIT y datos de facturación.
                </p>
              </div>
              <Switch 
                id="edit-is-fiscal" 
                checked={isFiscal} 
                onCheckedChange={setIsFiscal} 
              />
              {/* Input oculto para que el Server Action sepa si procesar los datos fiscales */}
              <input type="hidden" name="es_fiscal" value={isFiscal ? "true" : "false"} />
            </div>

            {/* ==========================================
                DATOS FISCALES (Revelación Progresiva)
            ========================================== */}
            {isFiscal && (
              <div className="space-y-4 p-5 border border-border/50 bg-muted/10 rounded-xl animate-in slide-in-from-top-2 fade-in duration-200">
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    {/* `key` por cliente: el campo tiene estado propio, y sin
                        remount abrir otro cliente mostraría el CUIT del
                        anterior. Es el mismo problema que resuelve el sembrado
                        del switch de acá arriba. */}
                    <CuitInput
                      key={cliente?.id}
                      id="edit-cuit"
                      defaultValue={cliente?.cuit}
                      required={isFiscal}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-razon-social" className="text-sm font-medium">
                      Razón Social <span className="text-danger">*</span>
                    </Label>
                    <Input
                      id="edit-razon-social"
                      name="razon_social"
                      defaultValue={cliente.razon_social || ""}
                      required={isFiscal}
                      className="h-10 shadow-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="edit-condicion-iva" className="text-sm font-medium">
                      Condición de IVA <span className="text-danger">*</span>
                    </Label>
                    <Select name="condicion_iva" defaultValue={cliente.condicion_iva || undefined} required={isFiscal}>
                      <SelectTrigger className="h-10 shadow-none bg-background">
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Responsable Inscripto">Responsable Inscripto</SelectItem>
                        <SelectItem value="Monotributo">Monotributo</SelectItem>
                        <SelectItem value="Exento">Exento</SelectItem>
                        <SelectItem value="Consumidor Final">Consumidor Final</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-6 gap-4 pt-2">
                  <div className="space-y-2 sm:col-span-6">
                    <Label htmlFor="edit-direccion" className="text-sm font-medium">Domicilio Fiscal</Label>
                    <Input id="edit-direccion" name="direccion" defaultValue={cliente.direccion || ""} className="h-10 shadow-none" />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit-localidad" className="text-sm font-medium">Localidad</Label>
                    <Input id="edit-localidad" name="localidad" defaultValue={cliente.localidad || ""} className="h-10 shadow-none" />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit-provincia" className="text-sm font-medium">Provincia</Label>
                    <Input id="edit-provincia" name="provincia" defaultValue={cliente.provincia || ""} className="h-10 shadow-none" />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit-codigo-postal" className="text-sm font-medium">C.P.</Label>
                    <Input id="edit-codigo-postal" name="codigo_postal" defaultValue={cliente.codigo_postal || ""} className="h-10 shadow-none" />
                  </div>
                </div>
              </div>
            )}

            {/* ==========================================
                DATOS OPERATIVOS Y OPCIONALES
            ========================================== */}
            <div className="pt-2 space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="edit-fecha-vencimiento-deuda"
                  className="text-sm font-medium"
                >
                  Fecha de vencimiento de deuda (Opcional)
                </Label>
                <DatePickerAR
                  id="edit-fecha-vencimiento-deuda"
                  name="fecha_vencimiento_deuda"
                  defaultValue={cliente.fecha_vencimiento_deuda}
                />
              </div>

              {puedeAsignarLista && (
                <SelectorListaCliente listaPrecioId={cliente.lista_precio_id} />
              )}

              <div className="space-y-2">
                <Label htmlFor="edit-notas" className="text-sm font-medium">
                  Notas internas
                </Label>
                <Textarea
                  id="edit-notas"
                  name="notas"
                  defaultValue={cliente.notas || ""}
                  className="shadow-none resize-none h-20"
                />
              </div>

              {entregaMinimaActiva ? (
                <div className="flex items-start gap-2 pt-2">
                  <input
                    type="hidden"
                    name="exceptuado_entrega_minima_editable"
                    value="1"
                  />
                  <input
                    type="checkbox"
                    id="edit-exceptuado-entrega-minima"
                    name="exceptuado_entrega_minima"
                    defaultChecked={cliente.exceptuado_entrega_minima}
                    className="w-4 h-4 mt-0.5 rounded border-border text-primary focus:ring-primary cursor-pointer accent-primary"
                  />
                  <Label
                    htmlFor="edit-exceptuado-entrega-minima"
                    className="text-sm font-normal text-muted-foreground cursor-pointer"
                  >
                    Exceptuado de entrega mínima en cuenta corriente
                  </Label>
                </div>
              ) : null}
            </div>

            {/* ==========================================
                ACTIONS
            ========================================== */}
            <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Guardar Cambios
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}