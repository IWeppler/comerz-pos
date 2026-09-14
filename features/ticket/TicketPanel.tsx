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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Receipt, Save, Loader2, AlertCircle, Info } from "lucide-react";
import type { ConfiguracionPOS } from "@/entities/config/types";
import {
  comprobantesPermitidos,
  DEFINICION_MODO,
  ETIQUETA_COMPROBANTE,
  formatearPuntoVenta,
  MODOS_FACTURACION,
  type ModoFacturacion,
  normalizarModoFacturacion,
  normalizarTipoComprobante,
} from "@/shared/lib/facturacion";
import { updateFacturacionAction } from "./actions/update-facturacion";
import { ArcaConexion } from "@/features/arca/ui/arca-conexion";

interface TicketPanelProps {
  config: ConfiguracionPOS;
  /** Gate de UI solamente. El control real es `configuracion.facturacion`,
   * que chequea la action: un server action es un endpoint. */
  puedeEditar: boolean;
}

export function TicketPanel({ config, puedeEditar }: Readonly<TicketPanelProps>) {
  const router = useRouter();

  const [modo, setModo] = useState<ModoFacturacion>(
    normalizarModoFacturacion(config?.modo_facturacion),
  );
  const [comprobante, setComprobante] = useState(
    normalizarTipoComprobante(config?.comprobante_defecto),
  );
  const [facturarPorDefecto, setFacturarPorDefecto] = useState(
    config?.facturar_por_defecto ?? true,
  );

  const permitidos = comprobantesPermitidos(modo, config?.condicion_iva);

  // Cambiar el modo puede dejar huérfano al comprobante elegido (pasar de ARCA
  // a Interno con "Factura B" seleccionada). La base rechaza esa combinación
  // con un CHECK, así que sin corregirlo el guardado falla por algo que el
  // usuario nunca tocó.
  //
  // Derivado y no sincronizado con un efecto a propósito: lo que se manda es
  // esto, así que no hay ni un render intermedio en el que el input oculto
  // lleve el valor viejo. Un submit rápido justo después de cambiar el modo
  // mandaría la combinación inválida.
  const comprobanteElegido = permitidos.includes(comprobante)
    ? comprobante
    : "TICKET";

  const [, formAction, isPending] = useActionState(
    async (prevState: { error: string | null; success: boolean }, formData: FormData) => {
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

  const sinCondicionIva = !config?.condicion_iva;

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <Receipt className="w-5 h-5 text-primary" />
          Configuración Fiscal y Facturación
        </CardTitle>
        <CardDescription>
          Define cómo se emitirán los comprobantes al finalizar una venta en la
          caja.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-8">
          <input type="hidden" name="id" value={config?.id ?? ""} />

          {!puedeEditar && (
            <div className="flex items-start gap-2 text-sm text-warning bg-warning/10 p-3 rounded-lg border border-warning/20">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              Solo un administrador puede cambiar la configuración fiscal.
            </div>
          )}

          {/* === 1. MODO DE OPERACIÓN === */}
          <div className="space-y-4">
            <Label className="text-base font-semibold">Modo de Operación</Label>
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
          </div>

          {/* === 2. COMPROBANTE POR DEFECTO Y PUNTO DE VENTA === */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6 border-t border-border/50">
            <div className="space-y-2">
              <Label htmlFor="comprobante_defecto">
                Comprobante por defecto en la Caja
              </Label>
              <input
                type="hidden"
                name="comprobante_defecto"
                value={comprobanteElegido}
              />
              <Select
                value={comprobanteElegido}
                onValueChange={(v) => setComprobante(normalizarTipoComprobante(v))}
                disabled={!puedeEditar || permitidos.length === 1}
              >
                <SelectTrigger id="comprobante_defecto">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {permitidos.map((tipo) => (
                    <SelectItem key={tipo} value={tipo}>
                      {ETIQUETA_COMPROBANTE[tipo]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* La letra del comprobante la decide la condición de IVA del
                  comercio: sin ese dato no hay factura válida que ofrecer. */}
              {modo === "ARCA" && sinCondicionIva && (
                <p className="text-xs text-warning flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Cargá tu condición frente al IVA en la pestaña{" "}
                  <strong>Comercio</strong> para poder elegir el tipo de
                  factura.
                </p>
              )}
              {modo === "ARCA" && !sinCondicionIva && (
                <p className="text-xs text-muted-foreground">
                  Como {config.condicion_iva}, tu comercio emite{" "}
                  {permitidos
                    .filter((t) => t !== "TICKET")
                    .map((t) => ETIQUETA_COMPROBANTE[t])
                    .join(" y ") || "solo tickets internos"}
                  .
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="punto_venta">Punto de venta (ARCA)</Label>
              <Input
                id="punto_venta"
                name="punto_venta"
                inputMode="numeric"
                placeholder="Ej: 1"
                disabled={!puedeEditar}
                defaultValue={config?.punto_venta ?? ""}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                El que diste de alta en ARCA. Se imprime como{" "}
                {formatearPuntoVenta(config?.punto_venta ?? 1)}.
              </p>
            </div>
          </div>

          {/* === 2bis. FACTURAR POR DEFECTO === */}
          {modo === "ARCA" && (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
              <div className="space-y-1">
                <Label htmlFor="facturar_por_defecto" className="text-sm font-semibold">
                  Facturar por defecto
                </Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Con qué arranca el selector Factura / Ticket interno en la
                  caja. Quien tenga el permiso &quot;Elegir comprobante&quot;
                  lo cambia en cada venta; quien no, vende siempre con esto.
                </p>
              </div>
              {/* El valor viaja en un hidden: un Switch apagado no manda nada
                  y la action no podría distinguir "no" de "no vino". */}
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

          {/* === 3. ESTADO DE LA CONEXIÓN CON ARCA === */}
          {modo === "ARCA" && (
            <div className="pt-6 border-t border-border/50 animate-in fade-in slide-in-from-top-2">
              <div className="flex flex-col border border-border rounded-xl overflow-hidden bg-muted/20">
                <div className="flex items-center justify-between p-4 border-b border-border bg-background gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-sm bg-[#242c4f] flex items-center justify-center shrink-0">
                      <Image
                        src="/arca.svg"
                        alt="ARCA"
                        width={36}
                        height={36}
                      />
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
                      La caja emite factura con CAE solo cuando el ambiente
                      activo tiene un certificado vigente. Mientras tanto, o
                      si ARCA no responde, sigue saliendo ticket interno y el
                      motivo queda en el registro de la venta.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-sm">
                    <EstadoFila label="CUIT" valor={config?.cuit || "Sin cargar"} />
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
      </CardContent>
    </Card>
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
