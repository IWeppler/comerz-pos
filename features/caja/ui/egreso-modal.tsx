"use client";

import { useEffect, useState, useActionState } from "react";
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
import { TrendingDown, Loader2 } from "lucide-react";
import { CajaActionState } from "@/entities/caja/types";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import {
  getCuentasFinancierasAction,
  type CuentaFinanciera,
} from "../actions/cuentas-financieras";
import {
  DEFINICION_TIPO_EGRESO,
  TIPOS_EGRESO_MANUALES,
  type TipoEgreso,
} from "../lib/tipo-egreso";
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
/** Sentinel del Select: "no elegí cuenta, que decida la base". Mapea a "" en
 * el hidden input, que es lo que `registrarEgresoAction` espera para dejar
 * que `asignar_cuenta_financiera_actual` resuelva (con turno → Caja diaria,
 * sin turno → Caja general). Nunca se manda literal al form. */
const CUENTA_POR_DEFECTO = "__default__";

export function EgresoModal({
  open,
  onOpenChange,
  mostrarTrigger = true,
  triggerClassName,
  triggerVariant = "ghost",
}: Readonly<EgresoModalProps> = {}) {
  const [isOpenInterno, setIsOpenInterno] = useState(false);
  const [tipo, setTipo] = useState<TipoEgreso>("OPERATIVO");
  const [ordenId, setOrdenId] = useState<string>(SIN_REMITO);
  const [ordenes, setOrdenes] = useState<OrdenParaEgreso[] | null>(null);
  const [cuentas, setCuentas] = useState<CuentaFinanciera[] | null>(null);
  // "" = cuenta por defecto (la decide la base). Solo se llena con un id
  // cuando la persona elige explícitamente otra cuenta.
  const [cuentaId, setCuentaId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");

  // Para mostrar QUÉ cuenta va a usar el default, sin obligar a elegirla:
  // el mismo store que ya alimenta el botón de caja del navbar (Sidebar lo
  // mantiene actualizado con polling). Si todavía no llegó (isCajaAbierta
  // === null), el texto no se aventura a adivinar.
  const isCajaAbierta = useCajaStatusStore((state) => state.isCajaAbierta);

  const esControlado = open !== undefined;
  const isOpen = esControlado ? open : isOpenInterno;
  const setIsOpen = (valor: boolean) => {
    if (!esControlado) setIsOpenInterno(valor);
    onOpenChange?.(valor);
  };

  useEffect(() => {
    if (!isOpen || cuentas !== null) return;
    let cancelado = false;
    getCuentasFinancierasAction().then((data) => {
      if (cancelado) return;
      setCuentas(data.filter((cuenta) => cuenta.codigo !== "POR_ACREDITAR"));
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

  const [, formAction, isPending] = useActionState(
    async (prevState: CajaActionState, formData: FormData) => {
      const result = await registrarEgresoAction(prevState, formData);
      if (result.success) {
        toast.success("Egreso registrado correctamente");
        setTipo("OPERATIVO");
        setOrdenId(SIN_REMITO);
        setCuentaId("");
        setCategoriaId("");
        setIsOpen(false);
      } else {
        toast.error(result.error || "Ocurrió un error");
      }
      return result;
    },
    { error: null, success: false },
  );

  const definicion = DEFINICION_TIPO_EGRESO[tipo];
  const nombreCuentaPorDefecto =
    isCajaAbierta === null
      ? null
      : isCajaAbierta
        ? "Caja diaria (tu turno abierto)"
        : "Caja general (sin turno abierto)";

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
          <DialogTitle>Registrar Egreso</DialogTitle>
          <DialogDescription>
            Indicá para qué salió el dinero. 
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="cuenta-origen">Sale de (opcional)</Label>
            <input type="hidden" name="cuenta_origen_id" value={cuentaId} />
            <Select
              value={cuentaId || CUENTA_POR_DEFECTO}
              onValueChange={(v) =>
                setCuentaId(v === CUENTA_POR_DEFECTO ? "" : v)
              }
              disabled={!cuentas?.length}
            >
              <SelectTrigger id="cuenta-origen" className="w-full">
                <SelectValue placeholder="Cargando cuentas..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUENTA_POR_DEFECTO}>
                  {nombreCuentaPorDefecto ?? "La que corresponda (por defecto)"}
                </SelectItem>
                {(cuentas ?? []).map((cuenta) => (
                  <SelectItem key={cuenta.id} value={cuenta.id}>
                    {cuenta.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Podés crear caja general, banco o billetera desde Caja → Dinero.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tipo-egreso">Tipo de egreso</Label>
            {/* El name va en un input oculto: el Select de Radix no es un
                control nativo y no participa del FormData por su cuenta. */}
            <input type="hidden" name="tipo" value={tipo} />
            <Select
              value={tipo}
              onValueChange={(v) => {
                setTipo(v as TipoEgreso);
                if (v !== "COMPRA_MERCADERIA") setOrdenId(SIN_REMITO);
                if (v !== "OPERATIVO") setCategoriaId("");
              }}
            >
              <SelectTrigger id="tipo-egreso" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_EGRESO_MANUALES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DEFINICION_TIPO_EGRESO[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {definicion.descripcion}
            </p>
          </div>

          {tipo === "OPERATIVO" && (
            <>
              <input type="hidden" name="categoria_id" value={categoriaId} />
              <SelectorCategoriaEgreso
                valor={categoriaId}
                onChange={setCategoriaId}
              />
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
                    placeholder={
                      ordenes === null ? "Buscando remitos..." : "Sin remito"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_REMITO}>Sin remito asociado</SelectItem>
                  {(ordenes ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.proveedor} ·{" "}
                      {formatearFecha(o.fecha_remito ?? o.creado_en)} · $
                      {Math.round(Number(o.saldo_pendiente)).toLocaleString(
                        "es-AR",
                      )}{" "}
                      pendiente
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {ordenes !== null && ordenes.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  No hay remitos cargados. El egreso se guarda igual.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="concepto">Concepto / Motivo</Label>
            <Input
              id="concepto"
              name="concepto"
              placeholder={
                tipo === "RETIRO_SOCIO"
                  ? "Ej: Retiro semanal"
                  : tipo === "COMPRA_MERCADERIA"
                    ? "Ej: Pago a proveedor"
                    : "Ej: Flete de mercadería, Bolsas..."
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
              required
            />
          </div>

          {!definicion.afectaResultado && (
            <p className="text-[11px] text-warning">
              Mueve dinero de la cuenta elegida, pero NO resta de la ganancia
              del panel.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Guardar Egreso
            </Button>
          </div>
        </form>
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
