"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FaWhatsapp } from "react-icons/fa";
import { queryKeys } from "@/shared/lib/query-keys";
import { Textarea } from "@/shared/ui/textarea";
import {
  construirMensajeDeuda,
  PLANTILLA_DEUDA_EJEMPLO,
  VARIABLES_MENSAJE_DEUDA,
  variablesDesconocidas,
} from "../lib/mensaje-deuda";
import {
  CcVencimientoModo,
  ConfiguracionPOS,
  RecargoMoraBase,
  RecargoMoraTipo,
} from "@/entities/config/types";
import { calcularVencimientoCc } from "../lib/calcular-fecha-vencimiento";

/** "2026-10-15" → "15/10". */
function diaMes(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${Number(dia)}/${Number(mes)}`;
}

/**
 * El ejemplo que se lee debajo de los días: "lo comprado del 5/9 al 4/10
 * cierra el 5/10 y vence el 15/10". Sale de la MISMA regla que el resto
 * (`calcularVencimientoCc`, espejo de `cc_vence_el`): un ejemplo armado a
 * mano podría decir otra cosa que lo que después pasa.
 */
function ejemploCierre(diaCierre: number, diaVencimiento: number): string {
  if (!Number.isInteger(diaCierre) || diaCierre < 1 || diaCierre > 28) {
    return "Elegí el día del mes en que cerrás las cuentas (1 a 28).";
  }
  const regla = {
    modo: "CIERRE_MENSUAL" as const,
    plazoDias: null,
    diaCierre,
    diaVencimiento:
      diaVencimiento >= 1 && diaVencimiento <= 28 ? diaVencimiento : null,
  };
  // El período que cierra en octubre de 2026: arranca el día de cierre de
  // septiembre y termina el día anterior al de octubre.
  const desde = `2026-09-${String(diaCierre).padStart(2, "0")}`;
  const hasta = new Date(Date.UTC(2026, 9, diaCierre - 1))
    .toISOString()
    .slice(0, 10);
  const cierre = `2026-10-${String(diaCierre).padStart(2, "0")}`;
  const vence = calcularVencimientoCc(desde, regla);
  return `Ejemplo: lo comprado del ${diaMes(desde)} al ${diaMes(hasta)} cierra el ${diaMes(cierre)} y vence el ${diaMes(vence)}.`;
}
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Loader2,
  Wallet,
  TrendingUp,
  ShieldAlert,
  Percent,
  Clock,
  UserX,
  UserCog,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/shared/config/supabase/client";
import { validarAliasTransferencia } from "../lib/alias-transferencia";

interface ClientsPanelProps {
  config: ConfiguracionPOS;
}

/** Espejo del CHECK de configuracion_pos.mensaje_recordatorio_cc. */
const LARGO_MAXIMO_PLANTILLA = 1000;

export function ClientsPanel({ config }: Readonly<ClientsPanelProps>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const plantillaRef = useRef<HTMLTextAreaElement>(null);

  const [formData, setFormData] = useState({
    cc_activas: config.cc_activas ?? true,
    cc_recargo_default: config.cc_recargo_default ?? 0,
    cc_anticipo_default: config.cc_anticipo_default ?? 0,
    entrega_minima_bloqueante: config.entrega_minima_bloqueante ?? false,
    cc_limite_default: config.cc_limite_default ?? 0,
    cc_plazo_mora: config.cc_plazo_mora ?? 30,
    cc_vencimiento_modo: config.cc_vencimiento_modo ?? "DIAS",
    // 0 = sin elegir en el formulario; se guarda NULL.
    cc_dia_cierre: config.cc_dia_cierre ?? 0,
    cc_dia_vencimiento: config.cc_dia_vencimiento ?? 0,
    crm_dias_inactivo: config.crm_dias_inactivo ?? 60,
    recargo_mora_tipo: config.recargo_mora_tipo ?? "NINGUNO",
    recargo_mora_valor: config.recargo_mora_valor ?? 0,
    recargo_mora_base: config.recargo_mora_base ?? "SALDO_COMPLETO",
  });
  // Vacío = mensaje por defecto (se guarda NULL, no "").
  const [plantilla, setPlantilla] = useState(
    config.mensaje_recordatorio_cc ?? "",
  );
  // Vacío = no se muestra en el resumen (se guarda NULL).
  const [aliasTransferencia, setAliasTransferencia] = useState(
    config.alias_transferencia ?? "",
  );

  const handleChange = (field: string, value: string | number | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // La variable entra donde está el cursor, no al final: escribir "{total}" a
  // mano en el celular es donde nacen los "{totla}".
  const insertarVariable = (clave: string) => {
    const texto = `{${clave}}`;
    const area = plantillaRef.current;
    const inicio = area?.selectionStart ?? plantilla.length;
    const fin = area?.selectionEnd ?? plantilla.length;
    setPlantilla(plantilla.slice(0, inicio) + texto + plantilla.slice(fin));
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(inicio + texto.length, inicio + texto.length);
    });
  };

  const desconocidasPlantilla = useMemo(
    () => variablesDesconocidas(plantilla),
    [plantilla],
  );

  // Vista previa con un caso que muestra todo: recargo, vencido y link.
  const vistaPrevia = useMemo(
    () =>
      construirMensajeDeuda(
        {
          nombreCliente: "María López",
          saldo: 50000,
          montoRecargo: formData.recargo_mora_tipo === "NINGUNO" ? 0 : 5000,
          saldoConRecargo:
            formData.recargo_mora_tipo === "NINGUNO" ? 50000 : 55000,
          fechaVencimiento: null,
          diasVencido: 12,
          urlResumen: "https://comerz.app/r/ejemplo",
          nombreComercio: config.posName,
        },
        plantilla,
      ),
    [plantilla, formData.recargo_mora_tipo, config.posName],
  );

  const handleSave = async () => {
    const plantillaLimpia = plantilla.trim();
    const desconocidas = variablesDesconocidas(plantillaLimpia);
    if (desconocidas.length > 0) {
      toast.error(
        `El mensaje de recordatorio usa variables que no existen: ${desconocidas
          .map((v) => `{${v}}`)
          .join(", ")}.`,
      );
      return;
    }
    if (plantillaLimpia.length > LARGO_MAXIMO_PLANTILLA) {
      toast.error(
        `El mensaje de recordatorio no puede pasar de ${LARGO_MAXIMO_PLANTILLA} caracteres.`,
      );
      return;
    }

    const alias = validarAliasTransferencia(aliasTransferencia);
    if (!alias.ok) {
      toast.error(alias.error);
      return;
    }

    // Con 0 una compra vence el mismo día y al siguiente toda la cuenta está
    // en mora. La base lo rechaza igual (CHECK `cc_plazo_mora >= 1`); acá se
    // avisa con un mensaje que se entiende.
    if (
      !Number.isInteger(formData.cc_plazo_mora) ||
      formData.cc_plazo_mora < 1
    ) {
      toast.error("El vencimiento de deuda tiene que ser de al menos 1 día.");
      return;
    }
    // Hasta el 28 para que el día exista en todos los meses. La base tiene el
    // mismo CHECK.
    const diaValido = (d: number) => Number.isInteger(d) && d >= 1 && d <= 28;
    if (formData.cc_vencimiento_modo === "CIERRE_MENSUAL") {
      if (!diaValido(formData.cc_dia_cierre)) {
        toast.error("El día de cierre tiene que ser entre 1 y 28.");
        return;
      }
      if (
        formData.cc_dia_vencimiento !== 0 &&
        !diaValido(formData.cc_dia_vencimiento)
      ) {
        toast.error("El día de vencimiento tiene que ser entre 1 y 28.");
        return;
      }
    }

    setIsSaving(true);
    const supabase = createClient();

    // Con `.select("id")`: escribir configuracion_pos pide ADMIN, y un UPDATE
    // filtrado por RLS devuelve 0 filas con `error: null`.
    const { data: filas, error } = await supabase
      .from("configuracion_pos")
      .update({
        ...formData,
        cc_dia_cierre: formData.cc_dia_cierre || null,
        cc_dia_vencimiento: formData.cc_dia_vencimiento || null,
        mensaje_recordatorio_cc:
          plantillaLimpia === "" ? null : plantillaLimpia,
        alias_transferencia: alias.valor,
      })
      .eq("id", config.id)
      .select("id");

    setIsSaving(false);

    if (error) {
      toast.error("Error al guardar la configuración de clientes.");
      console.error(error);
    } else if (!filas || filas.length === 0) {
      toast.error(
        "Solo un administrador puede cambiar la configuración del comercio.",
      );
    } else {
      toast.success("Reglas de Cuentas Corrientes actualizadas.");
      // El listado de clientes trae la plantilla y la cachea 3 minutos.
      queryClient.invalidateQueries({ queryKey: queryKeys.clientes.listado });
      router.refresh();
    }
  };

  return (
    <>
      {/* HEADER */}
      <div className="space-y-6 animate-in fade-in-50 duration-300">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <UserCog className="w-6 h-6 text-primary" />
              <h2 className="text-2xl font-bold text-foreground">
                Clientes y Cuentas Corrientes
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Establece las reglas generales de crédito y financiación para tu
              negocio.
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full sm:w-auto"
            >
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Guardar Cambios
            </Button>
          </div>
        </div>

        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* COLUMNA IZQ: Habilitación y Limites */}
            <div className="space-y-6">
              <div className="bg-card border border-border rounded-2xl p-5 space-y-6">
                <h3 className="font-bold text-foreground flex items-center gap-2 border-b border-border/50 pb-3">
                  <Wallet className="w-4 h-4 text-muted-foreground" />{" "}
                  Habilitación de Crédito
                </h3>

                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold">
                      Cuentas Corrientes Activas
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Permite a los cajeros registrar ventas a crédito (fiado).
                    </p>
                  </div>
                  <Switch
                    checked={formData.cc_activas}
                    onCheckedChange={(v) => handleChange("cc_activas", v)}
                  />
                </div>

                <div
                  className={`space-y-6 transition-opacity ${!formData.cc_activas ? "opacity-50 pointer-events-none" : ""}`}
                >
                  <div className="space-y-3">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-semibold flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Límite de Crédito Base
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Límite global sugerido. Déjalo en 0 si no deseas límite
                        estricto.
                      </p>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                        $
                      </span>
                      <Input
                        type="number"
                        min="0"
                        value={
                          formData.cc_limite_default === 0
                            ? ""
                            : formData.cc_limite_default
                        }
                        onChange={(e) =>
                          handleChange(
                            "cc_limite_default",
                            Number(e.target.value),
                          )
                        }
                        placeholder="0 (Sin límite)"
                        className="pl-8 bg-muted/50 border-border"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-border/50">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-semibold flex items-center gap-1.5">
                        <UserX className="w-3.5 h-3.5 text-slate-500" />
                        Días de Inactividad (CRM)
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Días sin comprar para considerar a un cliente como
                        &quot;Inactivo&quot; en los reportes.
                      </p>
                    </div>
                    <div className="relative">
                      <Input
                        type="number"
                        min="1"
                        value={formData.crm_dias_inactivo}
                        onChange={(e) =>
                          handleChange(
                            "crm_dias_inactivo",
                            Number(e.target.value),
                          )
                        }
                        className="pr-12 bg-muted/50 border-border"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-xs">
                        días
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* COLUMNA DER: Reglas Financieras */}
            <div className="space-y-6">
              <div
                className={`bg-card border border-border rounded-2xl p-5 space-y-6 transition-opacity ${!formData.cc_activas ? "opacity-50 pointer-events-none" : ""}`}
              >
                <h3 className="font-bold text-foreground flex items-center gap-2 border-b border-border/50 pb-3">
                  <TrendingUp className="w-4 h-4 text-success" /> Reglas
                  Financieras
                </h3>

                <div className="space-y-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold flex items-center gap-1.5">
                      <Percent className="w-3.5 h-3.5 text-danger" /> Recargo
                      por Financiación (%)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Se sumará este porcentaje al total de la venta cuando el
                      pago no sea al contado.
                    </p>
                  </div>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={
                        formData.cc_recargo_default === 0
                          ? ""
                          : formData.cc_recargo_default
                      }
                      onChange={(e) =>
                        handleChange(
                          "cc_recargo_default",
                          Number(e.target.value),
                        )
                      }
                      placeholder="Ej: 15"
                      className="pr-8 bg-muted/50 border-border"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                      %
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-info" /> Entrega
                      Mínima (%)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Obliga al cliente a pagar este porcentaje por adelantado
                      para habilitar la deuda.
                    </p>
                  </div>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={
                        formData.cc_anticipo_default === 0
                          ? ""
                          : formData.cc_anticipo_default
                      }
                      onChange={(e) =>
                        handleChange(
                          "cc_anticipo_default",
                          Number(e.target.value),
                        )
                      }
                      placeholder="Ej: 50"
                      className="pr-8 bg-muted/50 border-border"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                      %
                    </span>
                  </div>
                </div>

                {formData.cc_anticipo_default > 0 && (
                  <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-semibold">
                        Bloquear si no se cumple
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Activado: la venta no se puede confirmar sin la entrega
                        mínima. Apagado: solo se muestra una advertencia y el
                        vendedor puede continuar igual.
                      </p>
                    </div>
                    <Switch
                      checked={formData.entrega_minima_bloqueante}
                      onCheckedChange={(v) =>
                        handleChange("entrega_minima_bloqueante", v)
                      }
                    />
                  </div>
                )}

                <div className="space-y-3 pt-2 border-t border-border/50">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-warning" /> Plazo de
                      Vencimiento de Deuda
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Cuándo se considera vencida una compra fiada (desde el día
                      siguiente corre la mora).
                    </p>
                  </div>
                  <Select
                    value={formData.cc_vencimiento_modo}
                    onValueChange={(val) =>
                      handleChange(
                        "cc_vencimiento_modo",
                        val as CcVencimientoModo,
                      )
                    }
                  >
                    <SelectTrigger className="w-full bg-muted/50 border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DIAS">
                        Días desde cada compra
                      </SelectItem>
                      <SelectItem value="CIERRE_MENSUAL">
                        Cierre mensual
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  {formData.cc_vencimiento_modo === "DIAS" ? (
                    <div className="relative">
                      <Input
                        type="number"
                        min="1"
                        value={formData.cc_plazo_mora}
                        onChange={(e) =>
                          handleChange("cc_plazo_mora", Number(e.target.value))
                        }
                        className="pr-12 bg-muted/50 border-border"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-xs">
                        días
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Día de cierre
                          </Label>
                          <Input
                            type="number"
                            min="1"
                            max="28"
                            inputMode="numeric"
                            value={formData.cc_dia_cierre || ""}
                            onChange={(e) =>
                              handleChange(
                                "cc_dia_cierre",
                                Number(e.target.value),
                              )
                            }
                            placeholder="Ej: 5"
                            className="bg-muted/50 border-border"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Vence el día (opcional)
                          </Label>
                          <Input
                            type="number"
                            min="1"
                            max="28"
                            inputMode="numeric"
                            value={formData.cc_dia_vencimiento || ""}
                            onChange={(e) =>
                              handleChange(
                                "cc_dia_vencimiento",
                                Number(e.target.value),
                              )
                            }
                            placeholder="El del cierre"
                            className="bg-muted/50 border-border"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {ejemploCierre(
                          formData.cc_dia_cierre,
                          formData.cc_dia_vencimiento,
                        )}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-2 border-t border-border/50">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-danger" />{" "}
                      Recargo por Mora
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Se suma una única vez al saldo de un ticket cuando entra
                      en estado Vencido (no se acumula día a día).
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Select
                      value={formData.recargo_mora_tipo}
                      onValueChange={(val) =>
                        handleChange(
                          "recargo_mora_tipo",
                          val as RecargoMoraTipo,
                        )
                      }
                    >
                      <SelectTrigger className="w-44 bg-muted/50 border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NINGUNO">Ninguno</SelectItem>
                        <SelectItem value="MONTO_FIJO">Monto fijo $</SelectItem>
                        <SelectItem value="PORCENTAJE">Porcentaje %</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        min="0"
                        step={
                          formData.recargo_mora_tipo === "PORCENTAJE"
                            ? "0.1"
                            : "1"
                        }
                        disabled={formData.recargo_mora_tipo === "NINGUNO"}
                        value={
                          formData.recargo_mora_valor === 0
                            ? ""
                            : formData.recargo_mora_valor
                        }
                        onChange={(e) =>
                          handleChange(
                            "recargo_mora_valor",
                            Number(e.target.value),
                          )
                        }
                        placeholder="0"
                        className="pr-8 bg-muted/50 border-border disabled:opacity-50"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                        {formData.recargo_mora_tipo === "PORCENTAJE"
                          ? "%"
                          : "$"}
                      </span>
                    </div>
                  </div>
                  {formData.recargo_mora_tipo === "PORCENTAJE" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground">
                        El porcentaje se calcula sobre
                      </Label>
                      <Select
                        value={formData.recargo_mora_base}
                        onValueChange={(val) =>
                          handleChange(
                            "recargo_mora_base",
                            val as RecargoMoraBase,
                          )
                        }
                      >
                        <SelectTrigger className="w-full bg-muted/50 border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PORCION_VENCIDA">
                            Solo lo vencido
                          </SelectItem>
                          <SelectItem value="SALDO_COMPLETO">
                            Todo el saldo de la cuenta
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {formData.recargo_mora_base === "PORCION_VENCIDA"
                          ? "Las compras que todavía no vencieron no pagan recargo."
                          : "Si una compra vence, el recargo se aplica a toda la cuenta, incluidas las compras recientes."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ALIAS PARA TRANSFERIR — sale en el resumen que abre la clienta */}
          <div className="mt-8 bg-card border border-border rounded-2xl p-5 space-y-3">
            <div className="space-y-0.5 border-b border-border/50 pb-3">
              <h3 className="font-bold text-foreground">
                Alias para transferencias
              </h3>
              <p className="text-xs text-muted-foreground">
                Se muestra en el resumen de cuenta que le llega al cliente por
                WhatsApp, con un botón para copiarlo junto con el monto. Vacío =
                no se muestra.
              </p>
            </div>
            <div className="space-y-1.5 max-w-sm">
              <Label htmlFor="alias-transferencia" className="text-sm font-semibold">
                Alias o CBU/CVU
              </Label>
              <Input
                id="alias-transferencia"
                value={aliasTransferencia}
                onChange={(e) => setAliasTransferencia(e.target.value)}
                placeholder="mi.comercio.mp"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={30}
                className="bg-muted/50 border-border font-mono"
              />
            </div>
          </div>

          {/* RECORDATORIO POR WHATSAPP */}
          <div className="mt-8 bg-card border border-border rounded-2xl p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-border/50 pb-3">
              <div className="space-y-0.5">
                <h3 className="font-bold text-foreground flex items-center gap-2">
                  <FaWhatsapp className="w-4 h-4 text-success" /> Mensaje del
                  resumen de cuenta
                </h3>
                <p className="text-xs text-muted-foreground">
                  Es el texto que sale al tocar el ícono de WhatsApp en la
                  lista de clientes o &quot;Resumen&quot; en el detalle. Vacío
                  = mensaje por defecto.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {plantilla.trim() === "" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-8 text-xs"
                    onClick={() => setPlantilla(PLANTILLA_DEUDA_EJEMPLO)}
                  >
                    Personalizar
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-8 text-xs"
                    onClick={() => setPlantilla("")}
                  >
                    Volver al mensaje por defecto
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <Textarea
                  ref={plantillaRef}
                  value={plantilla}
                  onChange={(e) => setPlantilla(e.target.value)}
                  placeholder={PLANTILLA_DEUDA_EJEMPLO}
                  rows={11}
                  maxLength={LARGO_MAXIMO_PLANTILLA}
                  className="bg-muted/50 border-border font-mono text-sm"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>
                    Si un dato no está (sin vencimiento, sin link), la línea
                    que lo usa no se envía. *texto* = negrita en WhatsApp.
                  </span>
                  <span className="shrink-0 ml-2">
                    {plantilla.length}/{LARGO_MAXIMO_PLANTILLA}
                  </span>
                </div>
                {desconocidasPlantilla.length > 0 && (
                  <p className="text-xs text-danger">
                    No existen:{" "}
                    {desconocidasPlantilla.map((v) => `{${v}}`).join(", ")}
                  </p>
                )}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-foreground">
                    Tocá para insertar:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {VARIABLES_MENSAJE_DEUDA.map((v) => (
                      <button
                        key={v.clave}
                        type="button"
                        title={v.ayuda}
                        onClick={() => insertarVariable(v.clave)}
                        className="min-h-11 sm:min-h-0 px-2 py-1 rounded-md border border-border bg-muted/50 text-xs font-mono hover:bg-primary/10 hover:border-primary transition-colors"
                      >
                        {`{${v.clave}}`}
                      </button>
                    ))}
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5 pt-1">
                    {VARIABLES_MENSAJE_DEUDA.map((v) => (
                      <li key={v.clave}>
                        <span className="font-mono">{`{${v.clave}}`}</span>:{" "}
                        {v.ayuda}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-foreground">
                  Vista previa (cliente de ejemplo)
                </p>
                <div className="rounded-xl bg-success/10 border border-success/20 p-4 text-sm whitespace-pre-wrap break-words text-foreground">
                  {vistaPrevia}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
