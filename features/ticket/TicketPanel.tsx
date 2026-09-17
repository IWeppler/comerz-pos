"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Receipt,
  ReceiptText,
  Printer,
  Settings2,
  Save,
  Loader2,
  AlertCircle,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import type { ConfiguracionPOS } from "@/entities/config/types";
import {
  DEFINICION_MODO,
  formatearPuntoVenta,
  MODOS_FACTURACION,
  type ModoFacturacion,
  normalizarModoFacturacion,
} from "@/shared/lib/facturacion";
import {
  ANCHOS_TICKET,
  ETIQUETA_ANCHO_TICKET,
  normalizarAnchoTicket,
} from "@/shared/lib/ancho-ticket";
import { updateFacturacionAction } from "./actions/update-facturacion";
import {
  DEFINICION_TRATAMIENTO_IVA,
  TRATAMIENTOS_IVA,
} from "@/shared/lib/fiscal-producto";
import { TOPE_CONSUMIDOR_FINAL_SIN_IDENTIFICAR } from "@/features/arca/lib/codigos-arca";
import { ArcaConexion } from "@/features/arca/ui/arca-conexion";

interface TicketPanelProps {
  config: ConfiguracionPOS;
  /** Gate de UI solamente. El control real es `configuracion.facturacion`,
   * que chequea la action: un server action es un endpoint. */
  puedeEditar: boolean;
}

export function TicketPanel({
  config,
  puedeEditar,
}: Readonly<TicketPanelProps>) {
  const router = useRouter();

  const [modo, setModo] = useState<ModoFacturacion>(
    normalizarModoFacturacion(config?.modo_facturacion),
  );
  const [facturarPorDefecto, setFacturarPorDefecto] = useState(
    config?.facturar_por_defecto ?? true,
  );
  const [recargosIva, setRecargosIva] = useState(
    config?.arca_recargos_iva ?? "GRAVADO_21",
  );
  const [riAMonotributo, setRiAMonotributo] = useState<string>(
    config?.arca_ri_a_monotributo ?? "FACTURA_B",
  );

  const [, formAction, isPending] = useActionState(
    async (
      prevState: { error: string | null; success: boolean },
      formData: FormData,
    ) => {
      const result = await updateFacturacionAction(prevState, formData);
      if (result.success) {
        toast.success("Configuración fiscal guardada.");
        router.refresh();
      } else if (result.error) {
        toast.error(result.error);
      }
      return result;
    },
    { error: null, success: false },
  );

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div className="border-b border-border pb-4">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Receipt className="w-5 h-5 text-primary" />
          Configuración Fiscal y Facturación
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Formato del ticket impreso y cómo se emitirán los comprobantes al
          finalizar una venta en la caja.
        </p>
      </div>

      <form action={formAction} className="space-y-8">
        <input type="hidden" name="id" value={config?.id ?? ""} />

        {!puedeEditar && (
          <div className="flex items-start gap-2 text-sm text-warning bg-warning/10 p-3 rounded-lg border border-warning/20">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            Solo un administrador puede cambiar la configuración fiscal.
          </div>
        )}

        {/* === 0. MENSAJE Y FORMATO DEL RECIBO === */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ReceiptText className="w-4 h-4 text-muted-foreground" />
              Mensaje y Formato del Recibo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mensaje_ticket">
                Mensaje personalizado en el Ticket
              </Label>
              <Textarea
                id="mensaje_ticket"
                name="mensaje_ticket"
                rows={3}
                disabled={!puedeEditar}
                defaultValue={config?.mensaje_ticket || ""}
                placeholder="¡Gracias por elegirnos! Vuelva pronto."
                className="resize-y"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="ancho_ticket_mm"
                className="flex items-center gap-2"
              >
                <Printer className="w-4 h-4 text-muted-foreground" />
                Ancho del ticket impreso
              </Label>
              <select
                id="ancho_ticket_mm"
                name="ancho_ticket_mm"
                disabled={!puedeEditar}
                defaultValue={String(
                  normalizarAnchoTicket(config?.ancho_ticket_mm),
                )}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {ANCHOS_TICKET.map((ancho) => (
                  <option key={ancho} value={ancho}>
                    {ETIQUETA_ANCHO_TICKET[ancho]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Solo afecta la impresión térmica. Si no sabés cuál tenés, dejá
                80: es la medida más común y la que se venía usando.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* === 1. MODO DE OPERACIÓN === */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-muted-foreground" />
              Modo de Operación
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <input type="hidden" name="modo_facturacion" value={modo} />
            <RadioGroup
              value={modo}
              onValueChange={(v) => setModo(normalizarModoFacturacion(v))}
              disabled={!puedeEditar}
              className="grid grid-cols-1 md:grid-cols-3 gap-4"
            >
              {MODOS_FACTURACION.map((valor) => {
                const def = DEFINICION_MODO[valor];
                const activo = modo === valor;

                return (
                  <Label
                    key={valor}
                    htmlFor={`modo-${valor}`}
                    className={`flex flex-col border rounded-xl p-4 transition-all ${
                      puedeEditar ? "cursor-pointer" : "opacity-60"
                    } ${
                      activo
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-foreground mr-2">
                        {def.label}
                      </span>
                      <RadioGroupItem value={valor} id={`modo-${valor}`} />
                    </div>
                    <span className="text-xs text-muted-foreground font-normal leading-relaxed">
                      {def.descripcion}
                    </span>
                  </Label>
                );
              })}
            </RadioGroup>

            {/* === 1bis. PUNTO DE VENTA === */}
            <div className="space-y-2 pt-4 border-t border-border/50">
              <Label htmlFor="punto_venta">Punto de venta (ARCA)</Label>
              <Input
                id="punto_venta"
                name="punto_venta"
                inputMode="numeric"
                placeholder="Ej: 1"
                disabled={!puedeEditar}
                defaultValue={config?.punto_venta ?? ""}
                className="font-mono max-w-40"
              />
              <p className="text-xs text-muted-foreground">
                El que diste de alta en ARCA. Se imprime como{" "}
                {formatearPuntoVenta(config?.punto_venta ?? 1)}.
              </p>
            </div>

            {/* === 1ter. FACTURAR POR DEFECTO === */}
            {modo === "ARCA" && (
              <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
                <div className="space-y-1">
                  <Label
                    htmlFor="facturar_por_defecto"
                    className="text-sm font-semibold"
                  >
                    Facturar por defecto
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Con qué arranca el selector Factura / Ticket interno en la
                    caja.
                  </p>
                </div>
                {/* El valor viaja en un hidden: un Switch apagado no manda
                    nada y la action no podría distinguir "no" de "no vino". */}
                <input
                  type="hidden"
                  name="facturar_por_defecto"
                  value={facturarPorDefecto ? "true" : "false"}
                />
                <Switch
                  id="facturar_por_defecto"
                  checked={facturarPorDefecto}
                  onCheckedChange={setFacturarPorDefecto}
                  disabled={!puedeEditar}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* === 2ter. CRITERIOS DEL CONTADOR === */}
        {modo === "ARCA" && (
          <div className="rounded-xl border border-border p-4 space-y-4">
            <div>
              <Label className="text-sm font-semibold">
                Criterios fiscales
              </Label>
              <p className="text-xs text-muted-foreground">
                Tres decisiones que dependen de cada contador o de la resolución
                vigente de ARCA.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="arca_recargos_iva">
                  IVA de los recargos (tarjeta, cuenta corriente)
                </Label>
                <input
                  type="hidden"
                  name="arca_recargos_iva"
                  value={recargosIva}
                />
                <Select
                  value={recargosIva}
                  onValueChange={setRecargosIva}
                  disabled={!puedeEditar}
                >
                  <SelectTrigger id="arca_recargos_iva">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRATAMIENTOS_IVA.map((t) => (
                      <SelectItem key={t} value={t}>
                        {DEFINICION_TRATAMIENTO_IVA[t].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Cómo se declara en la factura A/B el recargo que se le cobra
                  al cliente.
                </p>
              </div>

              {config?.condicion_iva === "Responsable Inscripto" && (
                <div className="space-y-2">
                  <Label htmlFor="arca_ri_a_monotributo">
                    Cuando le vendés a un monotributista
                  </Label>
                  <input
                    type="hidden"
                    name="arca_ri_a_monotributo"
                    value={riAMonotributo}
                  />
                  <Select
                    value={riAMonotributo}
                    onValueChange={setRiAMonotributo}
                    disabled={!puedeEditar}
                  >
                    <SelectTrigger id="arca_ri_a_monotributo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FACTURA_B">Factura B</SelectItem>
                      <SelectItem value="FACTURA_A">Factura A</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    El monotributista no computa crédito fiscal, por eso el
                    default es B. Algunos contadores piden A.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="arca_tope_consumidor_final">
                  Tope a consumidor final sin DNI
                </Label>
                <Input
                  id="arca_tope_consumidor_final"
                  name="arca_tope_consumidor_final"
                  inputMode="numeric"
                  placeholder={TOPE_CONSUMIDOR_FINAL_SIN_IDENTIFICAR.toLocaleString(
                    "es-AR",
                  )}
                  defaultValue={config?.arca_tope_consumidor_final ?? ""}
                  disabled={!puedeEditar}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Por encima de este importe ARCA exige DNI o CUIT del cliente.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* === 3. ESTADO DE LA CONEXIÓN CON ARCA === */}
        {modo === "ARCA" && (
          <div className="pt-6 border-t border-border/50 animate-in fade-in slide-in-from-top-2">
            <div className="flex flex-col border border-border rounded-xl overflow-hidden bg-muted/20">
              <div className="flex items-center justify-between p-4 border-b border-border bg-background gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-sm bg-[#242c4f] flex items-center justify-center shrink-0">
                    <Image src="/arca.svg" alt="ARCA" width={36} height={36} />
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground">
                      Conexión con ARCA
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Certificado, ticket de acceso y prueba contra ARCA.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-4">
                <div className="flex items-start gap-2 text-sm text-muted-foreground bg-background border border-border rounded-lg p-3">
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
                  <p className="text-xs leading-relaxed">
                    La caja emite factura con CAE solo cuando el ambiente activo
                    tiene un certificado vigente. Mientras tanto, o si ARCA no
                    responde, sigue saliendo ticket interno y el motivo queda en
                    el registro de la venta.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-sm">
                  <EstadoFila
                    label="CUIT"
                    valor={config?.cuit || "Sin cargar"}
                  />
                  <EstadoFila
                    label="Condición"
                    valor={config?.condicion_iva || "Sin cargar"}
                  />
                  <EstadoFila
                    label="Punto de venta"
                    valor={formatearPuntoVenta(config?.punto_venta)}
                  />
                </div>

                {/* Vive FUERA del <form> de arriba en cuanto a envío: sus
                      botones son type="button" y llaman a sus propias actions.
                      Guardar el form no toca las credenciales. */}
                <ArcaConexion puedeEditar={puedeEditar} />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-6 border-t border-border">
          <Button
            type="submit"
            disabled={isPending || !puedeEditar}
            className="w-full sm:w-auto min-w-[150px]"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" /> Guardar Configuración
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

function EstadoFila({
  label,
  valor,
}: Readonly<{ label: string; valor: string }>) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/50 gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right truncate">
        {valor}
      </span>
    </div>
  );
}
