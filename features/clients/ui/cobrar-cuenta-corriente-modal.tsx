"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Search, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { formatearMoneda } from "@/shared/utils/formatters";
import { calcularRecargoMonto } from "@/shared/lib/recargo-metodo";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import { useCajaModalStore } from "@/shared/store/caja-modal-store";
import { useCobroCcStore } from "@/shared/store/cobro-cc-store";
import { registrarPagoDeudaAction } from "../actions/manage-clients";
import {
  getDatosCobroCuentaCorrienteAction,
  type ClienteConDeuda,
} from "../actions/datos-cobro-cc";
import type { MetodoPago } from "@/entities/payments/types";
import { useReciboCcStore } from "@/shared/store/recibo-cc-store";

/**
 * Cobrar un saldo de cuenta corriente, en dos pasos y sin salir de donde estés.
 *
 * Se monta UNA sola vez, en el layout del panel, y se abre desde el store
 * (ver `cobro-cc-store`): hoy desde la barra del POS y desde el modal de caja.
 *
 * NO toca el carrito, y es el punto entero: un cobro de deuda no es una venta.
 * No descuenta stock, no emite comprobante y no puede quedar mezclado con lo
 * que la vendedora tenga a medio cargar en el ticket.
 *
 * Escribe por `registrarPagoDeudaAction`, la misma que usa la ficha del
 * cliente: ahí vive el recargo por método, la mora materializada como DÉBITO y
 * la actualización del saldo. Este modal no reimplementa ninguna cuenta — los
 * números que muestra son un espejo de lo que el server va a recalcular.
 */
export function CobrarCuentaCorrienteModal() {
  const router = useRouter();
  const abierto = useCobroCcStore((s) => s.abierto);
  const setAbierto = useCobroCcStore((s) => s.setAbierto);
  const clienteInicialId = useCobroCcStore((s) => s.clienteInicialId);

  const isCajaAbierta = useCajaStatusStore((s) => s.isCajaAbierta);
  const abrirModalCaja = useCajaModalStore((s) => s.abrir);

  const [cargando, setCargando] = useState(false);
  const [clientes, setClientes] = useState<ClienteConDeuda[]>([]);
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cliente, setCliente] = useState<ClienteConDeuda | null>(null);
  const [monto, setMonto] = useState("");
  const [metodoPagoId, setMetodoPagoId] = useState("");
  const [isPending, startTransition] = useTransition();

  const buscadorRef = useRef<HTMLInputElement>(null);
  const montoRef = useRef<HTMLInputElement>(null);

  const elegirCliente = (elegido: ClienteConDeuda) => {
    setCliente(elegido);
    // Prefill = todo lo que debe, mora incluida. Es lo más frecuente y deja
    // el caso "me paga una parte" a un solo borrado.
    setMonto(String(elegido.saldo + elegido.mora));
    // El foco al monto, que es el único dato que falta tipear.
    setTimeout(() => montoRef.current?.select(), 0);
  };

  // Al cerrar se limpia TODO: dejar el monto de la clienta anterior tipeado es
  // la forma de cobrarle a la siguiente lo que debía otra. Va en el cierre y
  // no en un efecto sobre `abierto` para que el reset sea parte del acto de
  // cerrar y no un render extra después.
  const cerrar = () => {
    setCliente(null);
    setBusqueda("");
    setMonto("");
    setClientes([]);
    setAbierto(false);
  };

  // Los datos se piden al ABRIR, no al montar: el modal vive en el layout, o
  // sea en todas las pantallas del panel, y la mayoría de las veces nadie lo
  // abre. Cada apertura relee — el saldo de un cliente cambia con cada venta
  // fiada, y cobrar sobre un saldo viejo es cobrar mal.
  useEffect(() => {
    if (!abierto) return;

    let vigente = true;

    const cargar = async () => {
      setCargando(true);
      try {
        const datos = await getDatosCobroCuentaCorrienteAction();
        if (!vigente) return;

        if (datos.error) {
          toast.error(datos.error);
          setAbierto(false);
          return;
        }

        setClientes(datos.clientes);
        setMetodosPago(datos.metodosPago);
        setMetodoPagoId((actual) => actual || datos.metodosPago[0]?.id || "");

        // Quien abre puede venir con la clienta ya elegida (el POS, si está
        // seleccionada en el ticket). Si no tiene deuda no está en la lista, y
        // entonces el modal arranca en el buscador como siempre.
        const inicial = clienteInicialId
          ? datos.clientes.find((c) => c.id === clienteInicialId)
          : undefined;
        if (inicial) elegirCliente(inicial);
      } finally {
        if (vigente) setCargando(false);
      }
    };

    cargar();

    return () => {
      vigente = false;
    };
    // `elegirCliente` no entra en las dependencias: se redefine en cada render
    // y volvería a disparar la carga en loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, clienteInicialId, setAbierto]);

  const filtrados = useMemo(() => {
    const query = busqueda.trim().toLowerCase();
    if (!query) return clientes;
    return clientes.filter(
      (c) =>
        c.nombre.toLowerCase().includes(query) ||
        (c.telefono ?? "").includes(query),
    );
  }, [busqueda, clientes]);

  const metodoElegido = metodosPago.find((m) => m.id === metodoPagoId);
  const montoNumero = Number(monto) || 0;
  const recargoMetodo = calcularRecargoMonto(
    montoNumero,
    Number(metodoElegido?.recargo_porcentaje ?? 0),
  );

  const cobrar = () => {
    if (!cliente) return;

    if (montoNumero <= 0) {
      toast.error("El monto tiene que ser mayor a cero.");
      return;
    }

    const formData = new FormData();
    formData.append("cliente_id", cliente.id);
    formData.append("metodo_pago_id", metodoPagoId);
    formData.append("monto", String(montoNumero));

    startTransition(async () => {
      const res = await registrarPagoDeudaAction(null, formData);

      if (!res.success) {
        toast.error(res.error || "No se pudo registrar el cobro.");
        return;
      }

      toast.success(
        `Cobro registrado: ${formatearMoneda(montoNumero)} de ${cliente.nombre}.`,
      );
      cerrar();
      // El recibo se abre con lo que el server ESCRIBIÓ, para imprimirlo.
      if (res.recibo) useReciboCcStore.getState().mostrar(res.recibo);
      // El cobro entra al turno abierto: el chip de caja y las pantallas que
      // muestren saldos tienen que reflejarlo sin recargar a mano.
      router.refresh();
    });
  };

  return (
    <Dialog
      open={abierto}
      onOpenChange={(siguiente) => (siguiente ? setAbierto(true) : cerrar())}
    >
      <DialogContent className="sm:max-w-105 bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Cobrar cuenta corriente
          </DialogTitle>
          <DialogDescription className="text-xs">
            {cliente
              ? "Entra al arqueo de tu turno de hoy. No es una venta: no toca el stock ni el ticket."
              : "Elegí a quién le cobrás. Solo aparecen los clientes con saldo."}
          </DialogDescription>
        </DialogHeader>

        {/* La caja cerrada se avisa ARRIBA y no al confirmar: la action lo
            rechaza igual, pero enterarse después de tipear el monto con la
            clienta esperando es la peor versión del mismo mensaje. */}
        {isCajaAbierta === false && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
            <p className="font-semibold text-warning">La caja está cerrada.</p>
            <p className="mt-0.5 text-muted-foreground">
              Este dinero entra al arqueo de un turno abierto.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 h-8"
              onClick={() => {
                cerrar();
                abrirModalCaja();
              }}
            >
              Abrir turno
            </Button>
          </div>
        )}

        {cargando ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando clientes con deuda…
          </div>
        ) : cliente ? (
          <div className="space-y-4 pt-1">
            <button
              type="button"
              onClick={() => setCliente(null)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Cambiar de cliente
            </button>

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="font-bold text-sm">{cliente.nombre}</p>
              <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                <p>Saldo: {formatearMoneda(cliente.saldo)}</p>
                {cliente.mora > 0 && (
                  <p className="font-semibold text-danger">
                    Recargo por mora: {formatearMoneda(cliente.mora)} (
                    {cliente.diasVencido} día
                    {cliente.diasVencido === 1 ? "" : "s"} de atraso)
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="cobro-cc-monto"
                className="text-xs font-semibold uppercase text-muted-foreground"
              >
                Monto que descuenta de la deuda
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-medium text-muted-foreground">
                  $
                </span>
                <Input
                  id="cobro-cc-monto"
                  ref={montoRef}
                  type="number"
                  min="1"
                  step="any"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      cobrar();
                    }
                  }}
                  className="pl-8 h-12 text-lg font-bold shadow-none border-border"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">
                ¿Cómo te paga?
              </Label>
              <Select value={metodoPagoId} onValueChange={setMetodoPagoId}>
                <SelectTrigger className="h-11 border-border bg-card shadow-none font-semibold">
                  <SelectValue placeholder="Seleccionar método…" />
                </SelectTrigger>
                <SelectContent>
                  {metodosPago.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="font-medium">
                      {m.nombre}
                      {Number(m.recargo_porcentaje) > 0
                        ? ` (+${m.recargo_porcentaje}%)`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* El recargo por método NO baja la deuda: se cobra encima. Se
                  muestra separado para que quede claro cuánto se pide de mano
                  y cuánto amortiza. */}
              {recargoMetodo > 0 && (
                <div className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
                  <div className="flex justify-between text-warning">
                    <span>
                      Recargo {metodoElegido?.nombre} (
                      {metodoElegido?.recargo_porcentaje}%)
                    </span>
                    <span className="font-mono font-bold">
                      +{formatearMoneda(recargoMetodo)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex justify-between border-t border-border pt-1.5 font-bold text-foreground">
                    <span>Cobrás</span>
                    <span className="font-mono">
                      {formatearMoneda(montoNumero + recargoMetodo)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={cerrar}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={cobrar}
                disabled={isPending || !metodoPagoId}
                className="bg-primary hover:bg-primary/80 text-white"
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar cobro
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={buscadorRef}
                autoFocus
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  // Enter elige al primero de la lista: con la búsqueda
                  // filtrando, ese es el que se está buscando.
                  if (e.key === "Enter" && filtrados.length > 0) {
                    e.preventDefault();
                    elegirCliente(filtrados[0]);
                  }
                }}
                placeholder="Buscar por nombre o teléfono…"
                className="h-11 pl-9 shadow-none"
                autoComplete="off"
              />
            </div>

            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filtrados.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {clientes.length === 0
                    ? "No hay clientes con saldo pendiente."
                    : "Ningún cliente con deuda coincide con la búsqueda."}
                </p>
              ) : (
                filtrados.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => elegirCliente(c)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-primary/5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {c.nombre}
                      </p>
                      {c.diasVencido > 0 && (
                        <p className="text-[10px] font-medium text-danger">
                          Vencida hace {c.diasVencido} día
                          {c.diasVencido === 1 ? "" : "s"}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 font-mono text-sm font-bold">
                      {formatearMoneda(c.saldo)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
