"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Check,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Power,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { formatearMoneda } from "@/shared/utils/formatters";
import {
  crearCuentaFinancieraAction,
  desactivarCuentaFinancieraAction,
  getMetodosPorCuentaAction,
  renombrarCuentaFinancieraAction,
  type CuentaFinanciera,
  type MetodoDeCuenta,
} from "../actions/cuentas-financieras";
import type { SaldoCuenta } from "@/entities/caja/types";

/**
 * Gestionar cuentas: crear, renombrar, dar de baja y ver qué se cobra en cada
 * una.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO EXISTÍA Y POR QUÉ HACE FALTA
 *
 * Hasta acá solo se podían CREAR cuentas. No había forma de corregir un
 * nombre ni de dar de baja una que sobró — así que el único camino frente a
 * un error era crear otra, que es exactamente cómo se fabrica el catálogo de
 * cuentas duplicadas.
 *
 * El caso real: El Nono Cacho tiene "Mercado Pago" y "Mercado Pago Posnet"
 * como dos cuentas, cuando el comercio tiene UNA billetera con dos formas de
 * cobrar. Los dos métodos ya apuntan a la misma cuenta —eso el modelo lo
 * soporta desde siempre, porque la comisión y los días de acreditación viven
 * en el MÉTODO y no en la cuenta— pero la segunda quedó huérfana con $110.112
 * de cobros viejos adentro.
 *
 * Por eso esta pantalla muestra los métodos de cada cuenta: sin ese dato,
 * decidir cuál sobra es adivinar.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function GestionarCuentasSheet({
  abierto,
  onOpenChange,
  cuentas,
  saldos,
}: Readonly<{
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  cuentas: CuentaFinanciera[];
  /** Saldo por cuenta, del ledger. Es el dato que decide si una cuenta se
   * puede dar de baja sin dejar plata sin forma de moverse. */
  saldos: SaldoCuenta[];
}>) {
  return (
    <Sheet open={abierto} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border px-4 py-4 sm:px-5">
          <SheetTitle>Gestionar cuentas</SheetTitle>
          <SheetDescription>
            Dónde va la plata de tu negocio.
          </SheetDescription>
        </SheetHeader>

        {abierto && <Contenido cuentas={cuentas} saldos={saldos} />}
      </SheetContent>
    </Sheet>
  );
}

function Contenido({
  cuentas,
  saldos,
}: Readonly<{ cuentas: CuentaFinanciera[]; saldos: SaldoCuenta[] }>) {
  const router = useRouter();
  const [metodos, setMetodos] = useState<MetodoDeCuenta[] | null>(null);
  const [creando, setCreando] = useState(false);

  // Se pide al abrir y no en la página: es un dato que solo hace falta acá, y
  // traerlo siempre le costaría una consulta a cada carga de /caja.
  useEffect(() => {
    let vigente = true;
    getMetodosPorCuentaAction().then((filas) => {
      if (vigente) setMetodos(filas);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const saldoDe = (cuentaId: string) =>
    saldos.find((s) => s.cuenta_id === cuentaId)?.saldo ?? null;

  const [, crear, guardandoNueva] = useActionState(
    async (prev: { error: string | null; success: boolean }, data: FormData) => {
      const res = await crearCuentaFinancieraAction(prev, data);
      if (res.success) {
        toast.success("Cuenta creada");
        setCreando(false);
        router.refresh();
      } else toast.error(res.error);
      return res;
    },
    { error: null, success: false },
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
      <ul className="divide-y divide-border">
        {cuentas.map((cuenta) => (
          <FilaCuenta
            key={cuenta.id}
            cuenta={cuenta}
            saldo={saldoDe(cuenta.id)}
            metodos={metodos?.filter((m) => m.cuentaId === cuenta.id) ?? []}
            cargandoMetodos={metodos === null}
          />
        ))}
      </ul>

      <div className="mt-5 border-t border-border pt-4">
        {creando ? (
          <form action={crear} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nueva-cuenta-nombre">Nombre</Label>
              <Input
                id="nueva-cuenta-nombre"
                name="nombre"
                placeholder="Ej: Banco Nación"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nueva-cuenta-tipo">Tipo</Label>
              <Select name="tipo" defaultValue="CAJA_GENERAL">
                <SelectTrigger id="nueva-cuenta-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAJA_GENERAL">Caja general</SelectItem>
                  <SelectItem value="BANCO">Cuenta bancaria</SelectItem>
                  <SelectItem value="BILLETERA">Billetera virtual</SelectItem>
                  <SelectItem value="OTRA">Otra</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                El tipo no se puede cambiar después: define si la cuenta se
                arquea y cómo recibe la plata.
              </p>
            </div>
            <div className="flex gap-2">
              <Button disabled={guardandoNueva} className="flex-1">
                {guardandoNueva && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Crear cuenta
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreando(false)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setCreando(true)}
          >
            <Plus className="h-4 w-4" />
            Nueva cuenta
          </Button>
        )}
      </div>
    </div>
  );
}

function FilaCuenta({
  cuenta,
  saldo,
  metodos,
  cargandoMetodos,
}: Readonly<{
  cuenta: CuentaFinanciera;
  saldo: number | null;
  metodos: MetodoDeCuenta[];
  cargandoMetodos: boolean;
}>) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(cuenta.nombre);
  const [guardando, setGuardando] = useState(false);
  const [dandoBaja, setDandoBaja] = useState(false);

  const guardar = async () => {
    if (nombre.trim() === cuenta.nombre) {
      setEditando(false);
      return;
    }
    setGuardando(true);
    const { error } = await renombrarCuentaFinancieraAction(cuenta.id, nombre);
    setGuardando(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Nombre actualizado");
    setEditando(false);
    router.refresh();
  };

  const darDeBaja = async () => {
    setDandoBaja(true);
    const { error } = await desactivarCuentaFinancieraAction(cuenta.id);
    setDandoBaja(false);
    if (error) {
      // El error explica QUÉ falta hacer primero (transferir el saldo,
      // reapuntar los métodos), así que se muestra entero y sin recortar.
      toast.error(error, { duration: 8000 });
      return;
    }
    toast.success(`${cuenta.nombre} quedó dada de baja`);
    router.refresh();
  };

  const Icono = cuenta.es_efectivo
    ? Banknote
    : cuenta.tipo === "BILLETERA"
      ? Wallet
      : Landmark;

  return (
    <li className="py-3.5 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icono className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            {editando ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="h-8 text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") guardar();
                    if (e.key === "Escape") {
                      setNombre(cuenta.nombre);
                      setEditando(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={guardar}
                  disabled={guardando}
                  aria-label="Guardar nombre"
                >
                  {guardando ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Cancelar"
                  onClick={() => {
                    setNombre(cuenta.nombre);
                    setEditando(false);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <p className="truncate text-sm font-medium">{cuenta.nombre}</p>
            )}

            <p className="text-[11px] text-muted-foreground">
              {etiquetaTipo(cuenta.tipo)}
              {cuenta.es_sistema && " · del sistema"}
            </p>

            {/* Qué se cobra en esta cuenta. Es lo que permite decidir cuál
                sobra sin adivinar — y hace visible que dos métodos con
                comisiones distintas pueden compartir una cuenta, que es lo
                correcto. */}
            {!cargandoMetodos && metodos.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {metodos.map((m) => (
                  <span
                    key={m.nombre}
                    className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {m.nombre}
                  </span>
                ))}
              </div>
            )}
            {!cargandoMetodos && metodos.length === 0 && !cuenta.es_sistema && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Ningún método cobra en esta cuenta.
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={`font-mono text-sm font-semibold tabular-nums ${
              (saldo ?? 0) < 0 ? "text-danger" : ""
            }`}
          >
            {saldo === null ? "—" : formatearMoneda(Number(saldo))}
          </span>
          <div className="flex gap-0.5">
            {!editando && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-1.5"
                onClick={() => setEditando(true)}
                aria-label={`Renombrar ${cuenta.nombre}`}
                title="Renombrar"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {/* Las de sistema no ofrecen baja: el turno y los cobros las
                necesitan, y la action las rechaza igual. */}
            {!cuenta.es_sistema && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-1.5 text-muted-foreground hover:text-danger"
                onClick={darDeBaja}
                disabled={dandoBaja}
                aria-label={`Dar de baja ${cuenta.nombre}`}
                title="Dar de baja"
              >
                {dandoBaja ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Power className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function etiquetaTipo(tipo: string) {
  return (
    (
      {
        CAJA_DIARIA: "Caja diaria",
        CAJA_GENERAL: "Caja general",
        BANCO: "Cuenta bancaria",
        BILLETERA: "Billetera virtual",
        PUENTE_ACREDITACION: "Cuenta técnica",
        OTRA: "Otra",
      } as Record<string, string>
    )[tipo] ?? tipo
  );
}
