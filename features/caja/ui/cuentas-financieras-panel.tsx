"use client";

import { useActionState, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, Repeat2, Settings2 } from "lucide-react";
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
import { IngresoModal } from "./ingreso-modal";
import { DetalleCuentaSheet } from "./detalle-cuenta-sheet";
import { CabeceraDisponible } from "./cabecera-disponible";
import { TiraCuentas } from "./tira-cuentas";
import { GestionarCuentasSheet } from "./gestionar-cuentas-sheet";
import { EgresosProgramadosSheet } from "./egresos-programados-sheet";
import {
  totalProgramado,
} from "../lib/egreso-programado";
import type { EgresoProgramado } from "../actions/egresos-programados";
import {
  registrarSaldoInicialCuentaAction,
  registrarTransferenciaFinancieraAction,
  type CuentaFinanciera,
} from "../actions/cuentas-financieras";
import type { SaldoCuenta } from "@/entities/caja/types";

type Estado = { error: string | null; success: boolean };

const CLASE_ACCION =
  "h-12 w-12 p-0 md:h-9 md:w-auto md:px-4 " +
  "[&>span]:hidden md:[&>span]:inline " +
  "[&>svg]:h-6 [&>svg]:w-6 md:[&>svg]:h-4 md:[&>svg]:w-4";

const CLASE_CONTENEDOR_ACCION =
  "flex min-w-0 flex-1 flex-col items-center gap-1.5 md:block md:flex-none";

function EtiquetaAccionMobile({ children }: Readonly<{ children: string }>) {
  return (
    <span className="text-center text-[11px] font-medium leading-tight text-muted-foreground md:hidden">
      {children}
    </span>
  );
}

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
  saldos,
  turnosAbiertos,
  ingresosPorAcreditar,
  cantidadPorAcreditar,
  programados,
  esAdmin = false,
  puedeRegistrarIngreso = false,
  puedeRegistrarEgreso = false,
  puedeTransferir = false,
}: Readonly<{
  cuentas: CuentaFinanciera[];
  /** Cuántos turnos están abiertos ahora. Es el subtítulo de la tarjeta
   * "Cajas abiertas": el saldo solo dice cuánto, no entre cuántas manos. */
  turnosAbiertos: number;
  ingresosPorAcreditar: number;
  cantidadPorAcreditar: number;
  /** La agenda de gastos fijos. No es plata que salió: vive en "Próximos
   * movimientos" y no toca ningún saldo. */
  programados: EgresoProgramado[];
  /** Cargar y editar la agenda es de ADMIN: define lo que la dueña ve como
   * comprometido, y una cifra inflada le dice que no compre mercadería que sí
   * podía comprar. */
  esAdmin?: boolean;
  /** Saldo por cuenta, del ledger. Llega por prop porque lo calcula
   * `posicion_dinero`, que es la única fuente de saldos de esta pantalla. */
  saldos: SaldoCuenta[];
  /** `caja.registrar_ingreso` (solo ADMIN por defecto): muestra "Anotar
   * Ingreso". Misma lógica que arriba: la RPC es el freno. */
  puedeRegistrarIngreso?: boolean;
  /** `caja.registrar_egreso`: muestra "Gasto". */
  puedeRegistrarEgreso?: boolean;
  /** `caja.transferir`: muestra "Transferir". */
  puedeTransferir?: boolean;
}>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [transferirAbierto, setTransferirAbierto] = useState(
    searchParams.get("accion") === "transferir",
  );
  const [gestionAbierta, setGestionAbierta] = useState(false);
  const [programadosAbierto, setProgramadosAbierto] = useState(false);
  const [saldoInicialCuenta, setSaldoInicialCuenta] =
    useState<SaldoCuenta | null>(null);
  const [detalleCuenta, setDetalleCuenta] = useState<SaldoCuenta | null>(null);
  const [origen, setOrigen] = useState(cuentas[0]?.id ?? "");
  const [destino, setDestino] = useState(cuentas[1]?.id ?? "");
  const [monto, setMonto] = useState("");

  const [, transferir, transfiriendo] = useActionState(
    async (prev: Estado, data: FormData) => {
      const res = await registrarTransferenciaFinancieraAction(prev, data);
      if (res.success) {
        toast.success("Dinero movido entre cuentas");
        setTransferirAbierto(false);
        // El monto se limpia al cerrar: si no, reabrir el modal para mover
        // otra cosa arranca con el número de la transferencia anterior ya
        // puesto, y un Enter de más lo manda dos veces.
        setMonto("");
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

  // Caja chica y caja grande son la MISMA lista partida en dos, no dos
  // fuentes: las divide quién la cuenta, no cuánta plata tiene.
  //
  //  - Caja diaria: la arquea quien vende, turno por turno. Va PRIMERA en la
  //    tira y agrupada en una sola tarjeta ("Cajas abiertas"); el desglose
  //    por persona vive en Hoy, que es donde alguien la va a cerrar.
  //  - Caja grande: el resto — la caja consolidada (CAJA_GENERAL) y las
  //    cuentas digitales (banco, billetera). Es donde cae el cierre de cada
  //    turno y de donde sale un egreso sin cajón que arquear.
  //
  // Dentro de cada bloque, las cuentas en CERO se muestran igual: una cuenta
  // que desaparece es una que la dueña cree que no existe, y la próxima vez
  // crea una duplicada.
  const porSaldo = (a: SaldoCuenta, b: SaldoCuenta) =>
    Number(b.saldo) - Number(a.saldo);
  const cajaDiaria = saldos
    .filter((c) => c.tipo === "CAJA_DIARIA")
    .sort(porSaldo);
  const cajaGrande = saldos
    .filter((c) => c.tipo !== "CAJA_DIARIA")
    .sort(porSaldo);
  const lista = [...cajaDiaria, ...cajaGrande];

  // Los VENCIDOS entran en el total: si quedaran afuera, el número bajaría
  // justo cuando alguien se atrasa. La ventana de 30 días es la misma que usa
  // el texto de abajo ("N pagos en 30 días").
  const totalProgramados = totalProgramado(
    programados,
    new Date().toISOString().slice(0, 10),
  );

  const disponible = lista.reduce((acc, c) => acc + Number(c.saldo), 0);

  // Cuánto hay registrado en la cuenta desde la que se va a transferir. Sale
  // de `lista` (o sea de `posicion_dinero`), que es la única fuente de saldos
  // de esta pantalla: pedirlo aparte sería una segunda verdad.
  const saldoOrigen = origen
    ? (lista.find((c) => c.cuenta_id === origen)?.saldo ?? null)
    : null;
  const montoNumero = Number(monto);
  const excedeSaldo =
    Number.isFinite(montoNumero) &&
    montoNumero > 0 &&
    saldoOrigen !== null &&
    montoNumero > Number(saldoOrigen);

  // Los dos formularios que viven detrás de un botón de la cabecera. Salen
  // como constantes y no como componentes sueltos porque cierran sobre el
  // estado y las actions de acá: extraerlos de verdad pediría pasar seis
  // props para no ganar nada.
  const contenidoTransferir = (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Mover dinero</DialogTitle>
        <DialogDescription>Movimiento entre cuentas propias.</DialogDescription>
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
            <input type="hidden" name="cuenta_destino_id" value={destino} />
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
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="transferencia-monto">Monto</Label>
            {saldoOrigen !== null && saldoOrigen > 0 && (
              <button
                type="button"
                onClick={() => setMonto(String(saldoOrigen))}
                className="cursor-pointer text-xs font-medium text-primary hover:underline"
              >
                Usar todo ({formatearMoneda(saldoOrigen)})
              </button>
            )}
          </div>
          <Input
            id="transferencia-monto"
            name="monto"
            type="number"
            min="0.01"
            step="any"
            required
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            // El tope sale del saldo REGISTRADO de la cuenta origen. Es lo
            // que atrapa el error de tipeo, que es el caso común: hoy el
            // input aceptaba cualquier número y la RPC tampoco mira el
            // saldo, así que se podía dejar una cuenta en negativo sin que
            // nada avisara.
            max={
              saldoOrigen !== null && saldoOrigen > 0 ? saldoOrigen : undefined
            }
          />
          {/* NO es un bloqueo duro, y eso importa: el saldo registrado puede
                ser MENOR que la plata real cuando nunca se declaró el saldo
                inicial de la cuenta. Con un tope duro, la "Caja Grande" de un
                comercio en esa situación quedaría trabada en cero y no podría
                transferir nunca. Así que se avisa, se explica y se ofrece el
                arreglo de verdad. */}
          {excedeSaldo && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {saldoOrigen !== null && saldoOrigen <= 0
                ? "Esta cuenta tiene saldo registrado en cero o negativo. Si de verdad tiene plata, declarale el saldo inicial desde la tarjeta de la cuenta."
                : `Estás moviendo más de los ${formatearMoneda(saldoOrigen ?? 0)} registrados en esa cuenta. Va a quedar en negativo.`}
            </p>
          )}
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
          disabled={transfiriendo || !origen || !destino || origen === destino}
        >
          {transfiriendo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Mover el dinero
        </Button>
      </form>
    </DialogContent>
  );

  return (
    <section className="space-y-6">
      {/* La cifra primero y las acciones pegadas abajo: es lo que se viene a
          ver y lo que se viene a hacer. El resto de la pestaña explica de
          dónde sale ese número. */}
      <CabeceraDisponible
        disponible={disponible}
        ingresosPorAcreditar={ingresosPorAcreditar}
        cantidadPorAcreditar={cantidadPorAcreditar}
        egresosProgramados={totalProgramados.monto}
        cantidadProgramados={totalProgramados.cantidad}
        vencidosProgramados={totalProgramados.vencidos}
        onAbrirProgramados={() => setProgramadosAbierto(true)}
        acciones={
          <>
            {/* El orden es el de la frecuencia de uso: un gasto se carga todos
                los días, un ingreso libre y una transferencia cada tanto. */}
            {puedeRegistrarEgreso && (
              <div className={CLASE_CONTENEDOR_ACCION}>
                <EgresoModal
                  triggerVariant="outline"
                  triggerClassName={CLASE_ACCION}
                />
                <EtiquetaAccionMobile>Anotar gasto</EtiquetaAccionMobile>
              </div>
            )}
            {puedeRegistrarIngreso && (
              <div className={CLASE_CONTENEDOR_ACCION}>
                <IngresoModal
                  triggerVariant="outline"
                  triggerClassName={CLASE_ACCION}
                />
                <EtiquetaAccionMobile>Anotar ingreso</EtiquetaAccionMobile>
              </div>
            )}

            {puedeTransferir && (
              <div className={CLASE_CONTENEDOR_ACCION}>
                <Dialog
                  open={transferirAbierto}
                  onOpenChange={setTransferirAbierto}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      className={CLASE_ACCION}
                      disabled={cuentas.length < 2}
                      aria-label="Transferir entre cuentas"
                    >
                      <Repeat2 className="h-4 w-4" />
                      <span>Transferir</span>
                    </Button>
                  </DialogTrigger>
                  {contenidoTransferir}
                </Dialog>
                <EtiquetaAccionMobile>Transferir</EtiquetaAccionMobile>
              </div>
            )}

            {/* "Gestionar cuentas" reemplaza a "+ Nueva cuenta": crear era lo
                único que se podía hacer, así que ante un nombre mal escrito o
                una cuenta de más el único camino era crear otra — que es cómo
                se fabrica el catálogo duplicado que esta pantalla ahora
                permite limpiar. */}
            <div className={CLASE_CONTENEDOR_ACCION}>
              <Button
                variant="outline"
                className={CLASE_ACCION}
                onClick={() => setGestionAbierta(true)}
                aria-label="Gestionar cuentas"
              >
                <Settings2 className="h-4 w-4" />
                <span>Gestionar cuentas</span>
              </Button>
              <EtiquetaAccionMobile>Gestionar</EtiquetaAccionMobile>
            </div>
          </>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Tus cuentas</h2>
        </div>
      </div>

      <TiraCuentas
        saldos={lista}
        turnosAbiertos={turnosAbiertos}
        onAbrirCuenta={setDetalleCuenta}
        onDeclararSaldoInicial={(cuenta) => {
          const ficha = cuentas.find((c) => c.id === cuenta.cuenta_id);
          if (ficha && !ficha.requiere_arqueo) {
            setSaldoInicialCuenta(cuenta);
          }
        }}
        puedeDeclararSaldoInicial={(cuenta) => {
          const ficha = cuentas.find((c) => c.id === cuenta.cuenta_id);
          return ficha ? !ficha.requiere_arqueo : false;
        }}
      />

      <Dialog
        open={saldoInicialCuenta !== null}
        onOpenChange={(abierto) => !abierto && setSaldoInicialCuenta(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Saldo inicial de {saldoInicialCuenta?.nombre}
            </DialogTitle>
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

      <EgresosProgramadosSheet
        abierto={programadosAbierto}
        onOpenChange={setProgramadosAbierto}
        puedeAdministrar={esAdmin}
        puedeConfirmar={puedeRegistrarEgreso}
      />

      <GestionarCuentasSheet
        abierto={gestionAbierta}
        onOpenChange={setGestionAbierta}
        cuentas={cuentas}
        saldos={lista}
      />

      <DetalleCuentaSheet
        cuenta={detalleCuenta}
        onOpenChange={(abierto) => !abierto && setDetalleCuenta(null)}
      />
    </section>
  );
}
