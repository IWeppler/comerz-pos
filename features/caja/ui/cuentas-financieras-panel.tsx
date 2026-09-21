"use client";

import { useActionState, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Landmark,
  Loader2,
  Plus,
  Repeat2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { formatearMoneda } from "@/shared/utils/formatters";
import { EgresoModal } from "./egreso-modal";
import { DetalleCuentaSheet } from "./detalle-cuenta-sheet";
import {
  crearCuentaFinancieraAction,
  registrarSaldoInicialCuentaAction,
  registrarTransferenciaFinancieraAction,
  type CuentaFinanciera,
  type TransferenciaFinanciera,
} from "../actions/cuentas-financieras";
import type { SaldoCuenta } from "@/entities/caja/types";

type Estado = { error: string | null; success: boolean };

/**
 * "¿Cuánta plata tengo y dónde está?"
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE BLOQUE ABSORBIÓ LA LISTA DE SALDOS
 *
 * Había DOS bloques diciendo lo mismo: "Fondos y cuentas" mostraba la
 * estructura (nombre y tipo, sin un peso) y más abajo "Saldo registrado por
 * cuenta" repetía la misma lista con los números. No era un descuido de
 * diseño: venían de dos RPC distintas — `estado_cuentas_financieras` no
 * devuelve saldo y `posicion_dinero_ledger.cuentas` sí. Ahora el saldo entra
 * por prop y la lista es una sola.
 *
 * Y recién ahora se puede fusionar: hasta `20260920180000`, "efectivo en caja"
 * salía del cálculo legacy (turnos abiertos) y el saldo de la cuenta del
 * ledger, y eran dos números de dos modelos. Desde esa migración el saldo de
 * CAJA_DIARIA ES la suma del esperado de los turnos abiertos, verificado como
 * invariante. Juntarlos antes habría sido juntar dos cifras que discrepaban.
 *
 * El total suma SOLO cuentas que tienen plata AHORA. "Por acreditar" queda
 * afuera y vive en su propio bloque: mezclar plata disponible con plata futura
 * es el error que hace que un comercio gaste lo que todavía no entró.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function CuentasFinancierasPanel({
  cuentas,
  transferencias,
  saldos,
}: Readonly<{
  cuentas: CuentaFinanciera[];
  transferencias: TransferenciaFinanciera[];
  /** Saldo por cuenta, del ledger. Llega por prop porque lo calcula
   * `posicion_dinero`, que es la única fuente de saldos de esta pantalla. */
  saldos: SaldoCuenta[];
}>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [transferirAbierto, setTransferirAbierto] = useState(
    searchParams.get("accion") === "transferir",
  );
  const [crearAbierto, setCrearAbierto] = useState(false);
  const [saldoInicialCuenta, setSaldoInicialCuenta] =
    useState<SaldoCuenta | null>(null);
  const [detalleCuenta, setDetalleCuenta] = useState<SaldoCuenta | null>(null);
  const [origen, setOrigen] = useState(cuentas[0]?.id ?? "");
  const [destino, setDestino] = useState(cuentas[1]?.id ?? "");
  const [tipo, setTipo] = useState("CAJA_GENERAL");

  const [, transferir, transfiriendo] = useActionState(
    async (prev: Estado, data: FormData) => {
      const res = await registrarTransferenciaFinancieraAction(prev, data);
      if (res.success) {
        toast.success("Dinero movido entre cuentas");
        setTransferirAbierto(false);
        router.refresh();
      } else toast.error(res.error);
      return res;
    },
    { error: null, success: false },
  );

  const [, crear, creando] = useActionState(
    async (prev: Estado, data: FormData) => {
      const res = await crearCuentaFinancieraAction(prev, data);
      if (res.success) {
        toast.success("Cuenta creada");
        setCrearAbierto(false);
        router.refresh();
      } else toast.error(res.error);
      return res;
    },
    { error: null, success: false },
  );

  const [, declararSaldo, declarando] = useActionState(
    async (prev: Estado, data: FormData) => {
      const res = await registrarSaldoInicialCuentaAction(prev, data);
      if (res.success) {
        toast.success("Saldo inicial declarado");
        setSaldoInicialCuenta(null);
        router.refresh();
      } else toast.error(res.error);
      return res;
    },
    { error: null, success: false },
  );

  // Caja diaria primero —es la que se arquea— y después por saldo. Las cuentas
  // en CERO se muestran igual: una cuenta que desaparece es una cuenta que la
  // dueña cree que no existe, y la próxima vez crea una duplicada.
  const lista = [...saldos].sort((a, b) => {
    if (a.es_efectivo !== b.es_efectivo) return a.es_efectivo ? -1 : 1;
    return Number(b.saldo) - Number(a.saldo);
  });

  const disponible = lista.reduce((acc, c) => acc + Number(c.saldo), 0);
  const negativas = lista.filter((c) => Number(c.saldo) < 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Controlá dónde está el dinero de tu negocio
          </h2>
          <p className="text-xs text-muted-foreground">
            Mové dinero entre caja, banco y billeteras sin alterar tus ingresos
            ni gastos.
          </p>
        </div>
        {/* El orden es el de la frecuencia de uso: un egreso se carga todos los
            días, una transferencia cada tanto, una cuenta tres veces en la
            vida del comercio. */}
        <div className="flex flex-wrap gap-2">
          <EgresoModal triggerVariant="secondary" />

          <Dialog open={transferirAbierto} onOpenChange={setTransferirAbierto}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={cuentas.length < 2}>
                <Repeat2 className="h-4 w-4" />
                Transferir
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Mover dinero</DialogTitle>
                <DialogDescription>
                  Esto no se registra como ingreso ni como gasto: solo cambia
                  dónde está la plata.
                </DialogDescription>
              </DialogHeader>
              <form action={transferir} className="space-y-4">
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                  <div className="space-y-2">
                    <Label>De</Label>
                    <input type="hidden" name="cuenta_origen_id" value={origen} />
                    <Select value={origen} onValueChange={setOrigen}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {cuentas
                          .filter((c) => c.id !== destino)
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.nombre}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <ArrowRight className="mb-2.5 h-4 w-4 text-muted-foreground" />
                  <div className="space-y-2">
                    <Label>A</Label>
                    <input
                      type="hidden"
                      name="cuenta_destino_id"
                      value={destino}
                    />
                    <Select value={destino} onValueChange={setDestino}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {cuentas
                          .filter((c) => c.id !== origen)
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.nombre}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transferencia-monto">Monto</Label>
                  <Input
                    id="transferencia-monto"
                    name="monto"
                    type="number"
                    min="0.01"
                    step="any"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transferencia-concepto">Concepto</Label>
                  <Input
                    id="transferencia-concepto"
                    name="concepto"
                    placeholder="Ej: Retiro al cierre"
                    required
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={
                    transfiriendo || !origen || !destino || origen === destino
                  }
                >
                  {transfiriendo && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Mover el dinero
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={crearAbierto} onOpenChange={setCrearAbierto}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="h-4 w-4" />
                Cuenta
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Nueva cuenta</DialogTitle>
                <DialogDescription>
                  Creá una caja general, banco o billetera del negocio.
                </DialogDescription>
              </DialogHeader>
              <form action={crear} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cuenta-nombre">Nombre</Label>
                  <Input
                    id="cuenta-nombre"
                    name="nombre"
                    placeholder="Ej: Banco Nación"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <input type="hidden" name="tipo" value={tipo} />
                  <Select value={tipo} onValueChange={setTipo}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CAJA_GENERAL">Caja general</SelectItem>
                      <SelectItem value="BANCO">Cuenta bancaria</SelectItem>
                      <SelectItem value="BILLETERA">Billetera virtual</SelectItem>
                      <SelectItem value="OTRA">Otra</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" disabled={creando}>
                  {creando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Crear cuenta
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Disponible ahora
          </p>
          <p
            className={`mt-0.5 text-3xl font-mono font-medium tabular-nums ${
              disponible < 0 ? "text-danger" : "text-foreground"
            }`}
          >
            {formatearMoneda(disponible)}
          </p>
          {/* El aviso va pegado a la cifra y no al pie de la pantalla: es la
              diferencia entre un número que se usa para decidir una compra y
              uno que se sabe que hay que contrastar con el homebanking. */}
          <p className="mt-1 text-xs text-muted-foreground">
            Sale de lo registrado en Comerz: <strong>no es el saldo del
            banco</strong>. No incluye lo que todavía está por acreditar.
          </p>
        </div>

        {lista.length === 0 ? (
          <p className="px-4 py-4 text-xs text-muted-foreground sm:px-5">
            Todavía no hay cuentas con movimientos.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {lista.map((cuenta) => {
              const saldo = Number(cuenta.saldo);
              const Icono = cuenta.es_efectivo
                ? Banknote
                : cuenta.tipo === "BILLETERA"
                  ? Wallet
                  : Landmark;
              return (
                <li key={cuenta.cuenta_id}>
                  <button
                    type="button"
                    onClick={() => setDetalleCuenta(cuenta)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 sm:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {cuenta.nombre}
                        </p>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {etiquetaTipo(cuenta.tipo)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
                        saldo < 0 ? "text-danger" : ""
                      }`}
                    >
                      {formatearMoneda(saldo)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Un saldo negativo no se esconde: es un hecho del registro. Lo que se
          agrega es POR QUÉ puede pasar y qué hacer, que es lo que lo separa de
          "Comerz dice que debo plata". */}
      {negativas.map((cuenta) => (
        <div
          key={cuenta.cuenta_id}
          className="flex flex-wrap items-start gap-2.5 rounded-lg border border-info/20 bg-info/10 px-3 py-2.5 text-xs"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-info">
              {cuenta.nombre} tiene un saldo registrado de{" "}
              {formatearMoneda(Number(cuenta.saldo))}.
            </p>
            <p className="mt-0.5 text-info/90">
              Puede faltar declarar la plata que ya había en esa cuenta, o una
              transferencia que la alimentó.
            </p>
          </div>
          {!cuenta.es_efectivo && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSaldoInicialCuenta(cuenta)}
            >
              Declarar saldo inicial
            </Button>
          )}
        </div>
      ))}

      <Dialog
        open={saldoInicialCuenta !== null}
        onOpenChange={(abierto) => !abierto && setSaldoInicialCuenta(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Saldo inicial de {saldoInicialCuenta?.nombre}</DialogTitle>
            <DialogDescription>
              ¿Cuánta plata había en esta cuenta cuando empezaste a usarla en
              Comerz? No se cuenta como ingreso: no es plata que ganaste ahora,
              es plata que ya estaba.
            </DialogDescription>
          </DialogHeader>
          <form action={declararSaldo} className="space-y-4">
            <input
              type="hidden"
              name="cuenta_id"
              value={saldoInicialCuenta?.cuenta_id ?? ""}
            />
            <div className="space-y-2">
              <Label htmlFor="saldo-inicial-monto">Monto</Label>
              <Input
                id="saldo-inicial-monto"
                name="monto"
                type="number"
                min="0.01"
                step="any"
                required
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Se declara una sola vez por cuenta. Después, para mover plata,
                usá una transferencia.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="saldo-inicial-detalle">Detalle (opcional)</Label>
              <Input
                id="saldo-inicial-detalle"
                name="detalle"
                placeholder="Ej: efectivo que ya estaba en la caja grande"
              />
            </div>
            <Button className="w-full" disabled={declarando}>
              {declarando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Declarar saldo
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <DetalleCuentaSheet
        cuenta={detalleCuenta}
        onOpenChange={(abierto) => !abierto && setDetalleCuenta(null)}
      />

      {transferencias.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Últimos movimientos entre cuentas
          </div>
          <div className="divide-y divide-border">
            {transferencias.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {t.origen_nombre} → {t.destino_nombre}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.concepto} ·{" "}
                    {new Date(t.fecha).toLocaleString("es-AR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                <span className="shrink-0 font-mono font-semibold">
                  {formatearMoneda(Number(t.monto))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function etiquetaTipo(tipo: string) {
  return (
    (
      {
        CAJA_DIARIA: "Caja diaria",
        CAJA_GENERAL: "Caja general",
        BANCO: "Banco",
        BILLETERA: "Billetera",
        OTRA: "Otra",
      } as Record<string, string>
    )[tipo] ?? tipo
  );
}
