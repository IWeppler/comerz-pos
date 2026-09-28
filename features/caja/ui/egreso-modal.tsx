"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { registrarEgresoAction } from "../actions/caja-action";
import {
  getOrdenesParaEgresoAction,
  type OrdenParaEgreso,
} from "@/features/purchases/actions/get-ordenes-para-egreso";
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
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ArrowLeft, Loader2, TrendingDown } from "lucide-react";
import { CajaActionState } from "@/entities/caja/types";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import { esTurnoDeOtroDia } from "@/entities/caja/lib/turno-de-otro-dia";
import { formatearMoneda } from "@/shared/utils/formatters";
import {
  getCuentasFinancierasAction,
  type CuentaFinanciera,
} from "../actions/cuentas-financieras";
import {
  DEFINICION_TIPO_EGRESO,
  TIPOS_EGRESO_MANUALES,
  type TipoEgreso,
} from "../lib/tipo-egreso";
import { opcionesOrigenEgreso, superaCajaChica } from "../lib/origen-egreso";
import { SelectorCategoriaEgreso } from "./selector-categoria-egreso";

interface EgresoModalProps {
  /** Controlado desde afuera (el modal de caja lo abre sin trigger propio).
   * Sin esta prop el modal se maneja solo, como siempre. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** false cuando quien abre el modal es otro control (ver CajaStatusButton). */
  mostrarTrigger?: boolean;
  /** Estilo del trigger propio, para que el mismo modal sirva como acción
   * suelta de una barra o como botón ancho del panel en mobile. */
  triggerClassName?: string;
  triggerVariant?: "ghost" | "outline" | "secondary";
}

const SIN_REMITO = "sin-remito";

/**
 * Registrar un gasto, en dos pasos:
 *   1. De qué caja sale la plata. Obligatorio y SIN opción preseleccionada
 *      (ver `origen-egreso.ts`: el default a la caja chica fue la causa de
 *      los sobrantes falsos de El Nono Cacho).
 *   2. Qué tipo de gasto es, y el resto de los datos.
 */
export function EgresoModal({
  open,
  onOpenChange,
  mostrarTrigger = true,
  triggerClassName,
  triggerVariant = "ghost",
}: Readonly<EgresoModalProps> = {}) {
  const [isOpenInterno, setIsOpenInterno] = useState(false);
  const [paso, setPaso] = useState<1 | 2>(1);
  const [cuentaId, setCuentaId] = useState("");
  const [tipo, setTipo] = useState<TipoEgreso | null>(null);
  const [ordenId, setOrdenId] = useState<string>(SIN_REMITO);
  const [ordenes, setOrdenes] = useState<OrdenParaEgreso[] | null>(null);
  const [cuentas, setCuentas] = useState<CuentaFinanciera[] | null>(null);
  const [categoriaId, setCategoriaId] = useState("");
  const [monto, setMonto] = useState("");

  const isCajaAbierta = useCajaStatusStore((state) => state.isCajaAbierta);
  const turno = useCajaStatusStore((state) => state.turno);

  const esControlado = open !== undefined;
  const isOpen = esControlado ? open : isOpenInterno;

  const reiniciar = () => {
    setPaso(1);
    setCuentaId("");
    setTipo(null);
    setOrdenId(SIN_REMITO);
    setCategoriaId("");
    setMonto("");
  };

  const setIsOpen = (valor: boolean) => {
    if (!valor) reiniciar();
    if (!esControlado) setIsOpenInterno(valor);
    onOpenChange?.(valor);
  };

  useEffect(() => {
    if (!isOpen || cuentas !== null) return;
    let cancelado = false;
    getCuentasFinancierasAction().then((data) => {
      if (!cancelado) setCuentas(data);
    });
    return () => {
      cancelado = true;
    };
  }, [isOpen, cuentas]);

  // Los remitos se piden recién cuando hacen falta: la mayoría de los egresos
  // son gastos operativos y no necesitan la lista.
  useEffect(() => {
    if (tipo !== "COMPRA_MERCADERIA" || ordenes !== null) return;

    let cancelado = false;
    getOrdenesParaEgresoAction().then((data) => {
      if (!cancelado) setOrdenes(data);
    });
    return () => {
      cancelado = true;
    };
  }, [tipo, ordenes]);

  const opciones = useMemo(
    () =>
      opcionesOrigenEgreso(cuentas ?? [], {
        abierta: Boolean(isCajaAbierta && turno),
        deOtroDia: esTurnoDeOtroDia(turno?.fecha_apertura),
        disponible: turno?.montoActual ?? null,
      }),
    [cuentas, isCajaAbierta, turno],
  );
  const origen = opciones.find((o) => o.id === cuentaId);

  const [, formAction, isPending] = useActionState(
    async (prevState: CajaActionState, formData: FormData) => {
      const result = await registrarEgresoAction(prevState, formData);
      if (result.success) {
        toast.success("Gasto registrado");
        useCajaStatusStore.getState().notifyCajaChanged();
        setIsOpen(false);
      } else {
        toast.error(result.error || "Ocurrió un error");
      }
      return result;
    },
    { error: null, success: false },
  );

  const definicion = tipo ? DEFINICION_TIPO_EGRESO[tipo] : null;
  const montoNumero = Number(monto);
  const excedeCajon = superaCajaChica(origen, montoNumero);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {mostrarTrigger && (
        <DialogTrigger asChild>
          <Button
            variant={triggerVariant}
            className={triggerClassName}
            aria-label="Anotar gasto"
          >
            <TrendingDown className="h-4 w-4" />
            <span>Anotar Gasto</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar gasto</DialogTitle>
          <DialogDescription>
            {paso === 1
              ? "Paso 1 de 2 · ¿De dónde sale la plata?"
              : "Paso 2 de 2 · ¿Qué gasto es?"}
          </DialogDescription>
        </DialogHeader>

        {paso === 1 ? (
          <div className="space-y-3 pt-2">
            {cuentas === null ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando cajas...
              </div>
            ) : (
              <div role="radiogroup" aria-label="De dónde sale la plata" className="grid gap-2">
                {opciones.map((opcion) => {
                  const elegida = opcion.id === cuentaId;
                  return (
                    <button
                      key={opcion.id}
                      type="button"
                      role="radio"
                      aria-checked={elegida}
                      disabled={opcion.deshabilitada}
                      onClick={() => setCuentaId(opcion.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                        elegida
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/60"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">
                          {opcion.nombre}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {opcion.detalle}
                        </span>
                      </span>
                      {opcion.disponible !== null && (
                        <span className="shrink-0 text-right">
                          <span className="block text-[11px] text-muted-foreground">
                            En el cajón
                          </span>
                          <span className="block font-mono text-sm font-semibold text-foreground">
                            {formatearMoneda(opcion.disponible)}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              ¿Le diste efectivo a alguien que te transfirió? Eso es un cambio,
              no un gasto: registralo con Transferir en Caja → Dinero.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={!origen} onClick={() => setPaso(2)}>
                Siguiente
              </Button>
            </div>
          </div>
        ) : (
          <form action={formAction} className="space-y-4 pt-2">
            <input type="hidden" name="cuenta_origen_id" value={cuentaId} />
            <input type="hidden" name="tipo" value={tipo ?? ""} />

            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <span>
                <span className="text-muted-foreground">Sale de </span>
                <span className="font-medium text-foreground">{origen?.nombre}</span>
                {origen?.disponible != null && (
                  <span className="text-muted-foreground">
                    {" "}
                    · hay {formatearMoneda(origen.disponible)}
                  </span>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPaso(1)}
                disabled={isPending}
              >
                <ArrowLeft className="mr-1 h-3 w-3" /> Cambiar
              </Button>
            </div>

            <div className="space-y-2">
              <Label id="tipo-egreso-label">Tipo de gasto</Label>
              <div role="radiogroup" aria-labelledby="tipo-egreso-label" className="grid gap-2">
                {TIPOS_EGRESO_MANUALES.map((t) => {
                  const elegido = t === tipo;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={elegido}
                      onClick={() => {
                        setTipo(t);
                        if (t !== "COMPRA_MERCADERIA") setOrdenId(SIN_REMITO);
                        if (t !== "OPERATIVO") setCategoriaId("");
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        elegido ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"
                      }`}
                    >
                      <span className="block text-sm font-medium text-foreground">
                        {DEFINICION_TIPO_EGRESO[t].label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {DEFINICION_TIPO_EGRESO[t].descripcion}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {tipo === "OPERATIVO" && (
              <>
                <input type="hidden" name="categoria_id" value={categoriaId} />
                <SelectorCategoriaEgreso valor={categoriaId} onChange={setCategoriaId} />
              </>
            )}

            {tipo === "COMPRA_MERCADERIA" && (
              <div className="space-y-2">
                <Label htmlFor="orden-compra">Remito (opcional)</Label>
                <input
                  type="hidden"
                  name="orden_compra_id"
                  value={ordenId === SIN_REMITO ? "" : ordenId}
                />
                <Select value={ordenId} onValueChange={setOrdenId}>
                  <SelectTrigger id="orden-compra" className="w-full">
                    <SelectValue
                      placeholder={ordenes === null ? "Buscando remitos..." : "Sin remito"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_REMITO}>Sin remito asociado</SelectItem>
                    {(ordenes ?? []).map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.proveedor} · {formatearFecha(o.fecha_remito ?? o.creado_en)} · $
                        {Math.round(Number(o.saldo_pendiente)).toLocaleString("es-AR")} pendiente
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ordenes !== null && ordenes.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    No hay remitos cargados. El gasto se guarda igual.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="concepto">Concepto</Label>
              <Input
                id="concepto"
                name="concepto"
                placeholder={
                  tipo === "RETIRO_SOCIO"
                    ? "Ej: Retiro semanal"
                    : tipo === "COMPRA_MERCADERIA"
                      ? "Ej: Pago a proveedor"
                      : "Ej: Flete, bolsas, sueldo de Clau..."
                }
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="monto">Monto</Label>
              <Input
                id="monto"
                name="monto"
                type="number"
                min="1"
                step="any"
                placeholder="Ej: 2500"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                required
              />
              {excedeCajon && origen?.disponible != null && (
                <p role="alert" className="text-[11px] text-destructive">
                  En el cajón hay {formatearMoneda(origen.disponible)}. Si se pagó
                  con otra plata, volvé y elegí esa caja.
                </p>
              )}
            </div>

            {definicion && !definicion.afectaResultado && (
              <p className="text-[11px] text-warning">
                Saca plata de {origen?.nombre}, pero NO resta de la ganancia del panel.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending || !tipo || excedeCajon}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar gasto
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatearFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(iso));
}
