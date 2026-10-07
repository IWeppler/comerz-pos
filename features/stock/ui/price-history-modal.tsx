"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Label } from "@/shared/ui/label";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { History, Loader2, ArrowLeft, AlertTriangle, Undo2 } from "lucide-react";
import {
  listarHistorialPreciosAction,
  previsualizarRevertirPreciosAction,
  revertirPreciosAction,
  AjustePrecioHistorialItem,
  RevertirPreviewItem,
  OperacionPrecio,
  AlcancePrecio,
} from "../actions/update-prices";
import { formatearMoneda, formatearFechaHora } from "@/shared/utils/formatters";

const LABEL_OPERACION: Record<OperacionPrecio, string> = {
  AUMENTAR_PORCENTAJE: "Aumentar precio actual",
  REDUCIR_PORCENTAJE: "Reducir precio actual",
  FIJAR_MARGEN: "Fijar Recargo",
  REMITO: "Ingreso de mercadería",
};

const LABEL_ALCANCE: Record<AlcancePrecio, string> = {
  MARCA: "Marca",
  TODOS: "Todos los productos",
  CATEGORIA: "Categoría",
  SELECCION: "Productos seleccionados",
  REMITO: "Los del remito",
};

/**
 * El título de un lote.
 *
 * Un ajuste masivo se describe con su operación y su porcentaje. Un lote de
 * remito no tiene porcentaje —cada producto trae su precio— así que mostrarlo
 * como "... — 0%" sería decir algo falso: se muestra el nombre, que ya trae el
 * proveedor. Ver 20260908190000.
 */
/**
 * `null` no es cero: es "esta variante no tiene precio propio, sigue al del
 * producto". Mostrarlo como "$0" le prometería a la persona que confirma que
 * va a quedar un precio en cero, que es lo contrario de lo que pasa.
 */
function precioODerivado(valor: number | null): string {
  return valor === null ? "Hereda del producto" : formatearMoneda(valor);
}

function tituloLote(lote: AjustePrecioHistorialItem): string {
  if (lote.tipo_operacion === "REMITO") {
    return lote.nombre || LABEL_OPERACION.REMITO;
  }
  return `${LABEL_OPERACION[lote.tipo_operacion] ?? lote.tipo_operacion} — ${lote.valor}%`;
}

export function PriceHistoryModal({
  open,
  onOpenChange,
}: Readonly<{
  /** Controlado desde afuera: lo abre un ítem de menú que vive afuera del
   * modal (si el modal viviera adentro del menú, cerrar el menú lo
   * desmontaría). Sin esto maneja su estado y muestra su trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}> = {}) {
  const [abiertoInterno, setAbiertoInterno] = useState(false);
  const esControlado = open !== undefined;
  const isOpen = esControlado ? open : abiertoInterno;
  // Abierto de entrada (controlado) arranca cargando: el efecto de abajo trae
  // el historial.
  const [loading, setLoading] = useState(open === true);
  const [historial, setHistorial] = useState<AjustePrecioHistorialItem[]>([]);

  const [loteSeleccionado, setLoteSeleccionado] =
    useState<AjustePrecioHistorialItem | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<RevertirPreviewItem[]>([]);
  const [reverting, setReverting] = useState(false);
  const [confirmadoRevertir, setConfirmadoRevertir] = useState(false);

  /** Quien la llama prende `loading` antes (o arranca prendido). */
  const cargarHistorial = async () => {
    const res = await listarHistorialPreciosAction();
    setLoading(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setHistorial(res.data);
  };

  const resetSeleccion = () => {
    setLoteSeleccionado(null);
    setPreview([]);
    setConfirmadoRevertir(false);
  };

  const handleOpenChange = (v: boolean) => {
    if (!esControlado) setAbiertoInterno(v);
    onOpenChange?.(v);
    if (v) setLoading(true);
    else resetSeleccion();
  };

  // Al abrir carga el historial. En un efecto porque, abierto desde un menú
  // (controlado), handleOpenChange(true) no se dispara.
  useEffect(() => {
    if (!isOpen) return;
    let vigente = true;
    listarHistorialPreciosAction().then((res) => {
      if (!vigente) return;
      setLoading(false);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setHistorial(res.data);
    });
    return () => {
      vigente = false;
    };
  }, [isOpen]);

  const handleSeleccionarLote = async (lote: AjustePrecioHistorialItem) => {
    setLoteSeleccionado(lote);
    setConfirmadoRevertir(false);
    setPreviewLoading(true);
    const res = await previsualizarRevertirPreciosAction(lote.id);
    setPreviewLoading(false);
    if ("error" in res) {
      toast.error(res.error);
      setLoteSeleccionado(null);
      return;
    }
    setPreview(res.preview);
  };

  const handleConfirmarRevertir = async () => {
    if (!loteSeleccionado) return;
    setReverting(true);
    const res = await revertirPreciosAction(loteSeleccionado.id);
    setReverting(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Ajuste revertido con éxito.");
    resetSeleccion();
    setLoading(true);
    void cargarHistorial();
  };

  const itemsQueCambian = preview.filter((p) => p.cambia);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!esControlado && (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            title="Historial de Precios"
          >
            <History className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
            <span>Historial de Precios</span>
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-[650px] max-h-[90dvh] p-0 overflow-y-auto bg-card border-border">
        <DialogHeader className="p-6 pb-4 border-b border-border bg-muted/20">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <History className="w-5 h-5 text-primary" />
            {loteSeleccionado
              ? "Revertir Ajuste"
              : "Historial de Ajustes de Precio"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Consultá y revertí ajustes masivos de precio aplicados
            anteriormente.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6">
          {!loteSeleccionado ? (
            // ---- LISTA DE AJUSTES ----
            <>
              {loading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : historial.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">
                  Todavía no se aplicó ningún ajuste masivo de precios.
                </p>
              ) : (
                <ScrollArea className="h-96">
                  <div className="space-y-2 pr-2">
                    {historial.map((lote) => {
                      const yaRevertido = lote.estado === "REVERTIDO";
                      return (
                        <div
                          key={lote.id}
                          className="border border-border rounded-xl p-3 flex flex-col gap-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-sm">
                                {tituloLote(lote)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatearFechaHora(lote.creado_en)} ·{" "}
                                {LABEL_ALCANCE[lote.tipo_alcance] ??
                                  lote.tipo_alcance}{lote.alcance_valor ? ` · ${lote.alcance_valor}` : ""}{" "}
                                · {lote.campo_objetivo}
                              </p>
                            </div>
                            {yaRevertido ? (
                              <Badge
                                variant="outline"
                                className="text-muted-foreground border-border shrink-0"
                              >
                                Revertido el{" "}
                                {formatearFechaHora(lote.revertido_en)}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="shrink-0">
                                Aplicado
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <p className="text-xs text-muted-foreground">
                              {lote.productosAfectados} producto
                              {lote.productosAfectados === 1 ? "" : "s"}
                              {" · "}
                              {lote.tieneAuditoriaVariantes
                                ? `${lote.variantesAfectadas} variante${lote.variantesAfectadas === 1 ? "" : "s"}`
                                : "variantes no registradas individualmente (ajuste anterior a esta mejora)"}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={yaRevertido}
                              onClick={() => handleSeleccionarLote(lote)}
                              className="h-11 text-xs shrink-0"
                            >
                              <Undo2 className="w-3.5 h-3.5 mr-1.5" />
                              Revertir este ajuste
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </>
          ) : (
            // ---- CONFIRMACIÓN DE REVERSIÓN ----
            <div className="space-y-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={resetSeleccion}
                className="h-11 -ml-2"
              >
                <ArrowLeft className="w-4 h-4 mr-1.5" /> Volver al historial
              </Button>

              {previewLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Se van a modificar{" "}
                    <strong className="text-foreground">
                      {itemsQueCambian.length}
                    </strong>{" "}
                    de {preview.length} filas afectadas por este ajuste.
                  </p>

                  <ScrollArea className="h-50 border border-border rounded-xl bg-muted/20">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted text-muted-foreground font-bold sticky top-0">
                        <tr>
                          <th className="px-3 py-2">Producto</th>
                          <th className="px-3 py-2 text-right">
                            Precio actual
                          </th>
                          <th className="px-3 py-2 text-right">Vuelve a</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {preview.slice(0, 50).map((item, idx) => (
                          <tr
                            key={`${item.producto_id}-${item.variante_id ?? "p"}-${idx}`}
                            className={!item.cambia ? "opacity-40" : ""}
                          >
                            <td className="px-3 py-2 font-medium truncate max-w-40">
                              {item.nombre}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {precioODerivado(item.precio_actual)}
                            </td>
                            <td className="px-3 py-2 text-right font-bold">
                              {precioODerivado(item.precio_al_revertir)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.length > 50 && (
                      <div className="text-center py-2 text-xs text-muted-foreground bg-muted/30">
                        Mostrando las primeras 50 de {preview.length} filas...
                      </div>
                    )}
                  </ScrollArea>

                  <div className="flex items-start gap-2 bg-warning/10 p-3 rounded-lg border border-warning/20">
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-warning leading-tight font-medium text-xs mb-2">
                        Esto va a sobreescribir el precio y costo actuales de{" "}
                        {itemsQueCambian.length} fila
                        {itemsQueCambian.length === 1 ? "" : "s"} con los
                        valores de la columna &quot;Vuelve a&quot;. Si hubo
                        cambios manuales de precio después de este ajuste, se
                        pierden.
                      </p>
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="confirm_revert"
                          checked={confirmadoRevertir}
                          onChange={(e) =>
                            setConfirmadoRevertir(e.target.checked)
                          }
                          className="w-4 h-4 rounded border-warning/20 text-warning focus:ring-warning accent-warning cursor-pointer"
                        />
                        <Label
                          htmlFor="confirm_revert"
                          className="text-warning cursor-pointer leading-tight font-medium text-xs"
                        >
                          Entiendo, revertir de todas formas.
                        </Label>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={handleConfirmarRevertir}
                      disabled={!confirmadoRevertir || reverting}
                      className="bg-destructive hover:bg-destructive/90 text-white rounded-xl shadow-none h-11 px-6"
                    >
                      {reverting && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      Confirmar Reversión
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
