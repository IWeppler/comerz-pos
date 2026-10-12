"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Landmark,
  Loader2,
  PlugZap,
  ShoppingBag,
  Tag,
  Unplug,
  Wallet,
} from "lucide-react";
import type { ConfiguracionPOS } from "@/entities/config/types";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { formatearFechaHora } from "@/shared/utils/formatters";
import {
  desconectarMercadoPagoAction,
  estadoCobrosOnlineAction,
  guardarCobrosOnlineAction,
  type EstadoCobrosOnline,
} from "../actions/cobros-online";
import { MENSAJES_OAUTH, esCodigoResultado } from "../lib/mensajes-oauth";
import {
  OPCIONES_VENCE_MP,
  OPCIONES_VENCE_TRANSFERENCIA,
  etiquetaMinutos,
} from "../lib/validar-cobros";

/**
 * Configuración › Cobros online. Lo que el comercio configura UNA vez para que
 * el catálogo cobre solo: la cuenta de Mercado Pago y qué medios ofrece.
 *
 * Los dos medios cobran en la cuenta de MP conectada (decisión del 12/10/2026,
 * docs/pagos-auditoria.md §11): el checkout con su token y la transferencia a
 * su alias. Por eso sin conexión los switches están apagados y deshabilitados;
 * la action lo vuelve a exigir contra la base.
 *
 * "Conectar Mercado Pago" es un link común a /api/mercadopago/oauth/iniciar:
 * un toque acá, iniciar sesión y autorizar en MP, y la vuelta trae `?mp=` con
 * el resultado, que se muestra una vez y se limpia de la URL.
 */

interface Props {
  config: ConfiguracionPOS;
  /** Para "Ir a Promociones" sin salir de Configuración. */
  onIrASeccion?: (seccion: string) => void;
}

const URL_CONECTAR = "/api/mercadopago/oauth/iniciar";

export function CobrosOnlinePanel({ config, onIrASeccion }: Readonly<Props>) {
  const router = useRouter();
  const pathname = usePathname();
  const resultadoOAuth = useSearchParams().get("mp");

  const [estado, setEstado] = useState<EstadoCobrosOnline | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [guardando, startGuardar] = useTransition();
  const [desconectando, startDesconectar] = useTransition();
  const [confirmarDesconexion, setConfirmarDesconexion] = useState(false);

  const [form, setForm] = useState({
    cobroMercadoPago: config.cobro_online_mp ?? false,
    cobroTransferencia: config.cobro_online_transferencia ?? false,
    aliasMercadoPago: config.alias_mercadopago_tienda ?? "",
    titular: config.transferencia_titular ?? "",
    minutosVenceTransferencia: config.minutos_vence_transferencia ?? 120,
    minutosVenceMp: config.minutos_vence_mp ?? 60,
  });
  const cambiar = <K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [campo]: valor }));

  const cargarEstado = () =>
    estadoCobrosOnlineAction().then((r) => {
      if (r.ok) {
        setEstado(r.data);
        setErrorEstado(null);
      } else {
        setErrorEstado(r.error);
      }
    });

  useEffect(() => {
    void cargarEstado();
  }, []);

  // El resultado de la vuelta de MP se avisa una vez y se saca de la URL: si
  // quedara, cada recarga repetiría el "¡Listo!".
  useEffect(() => {
    if (!esCodigoResultado(resultadoOAuth)) return;
    if (resultadoOAuth === "conectado") toast.success(MENSAJES_OAUTH.conectado);
    else toast.error(MENSAJES_OAUTH[resultadoOAuth]);
    router.replace(`${pathname}?seccion=cobrosOnline`);
  }, [resultadoOAuth, pathname, router]);

  const conectado = estado?.conexion.conectado === true;
  const requiereReconexion = estado?.conexion.estado === "REQUIERE_RECONEXION";

  const guardar = () =>
    startGuardar(async () => {
      const r = await guardarCobrosOnlineAction(form);
      if (r.ok) {
        toast.success("Cobros online guardados.");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });

  const desconectar = () =>
    startDesconectar(async () => {
      const r = await desconectarMercadoPagoAction();
      setConfirmarDesconexion(false);
      if (r.ok) {
        toast.success("Desconectaste tu Mercado Pago. El catálogo dejó de ofrecer los cobros online.");
        setForm((prev) => ({ ...prev, cobroMercadoPago: false, cobroTransferencia: false }));
        await cargarEstado();
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <ShoppingBag className="h-5 w-5 text-primary" /> Cobros online
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cobrá los pedidos del catálogo con Mercado Pago o por transferencia. La venta se
            registra sola cuando el pago entra.
          </p>
        </div>
        <Button onClick={guardar} disabled={guardando} className="h-11 w-full sm:w-auto">
          {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar cambios
        </Button>
      </div>

      {/* ─── Conexión con Mercado Pago ─── */}
      <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <h3 className="flex items-center gap-2 border-b border-border/50 pb-3 font-bold text-foreground">
          <Wallet className="h-4 w-4 text-muted-foreground" /> Tu cuenta de Mercado Pago
        </h3>

        {!estado && !errorEstado && (
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-11 w-full sm:w-56" />
          </div>
        )}

        {errorEstado && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="text-sm text-destructive">{errorEstado}</p>
            <Button variant="outline" className="h-11" onClick={() => void cargarEstado()}>
              Reintentar
            </Button>
          </div>
        )}

        {estado && !estado.appMpConfigurada && (
          <p className="text-sm text-muted-foreground">{MENSAJES_OAUTH.sin_configurar}</p>
        )}

        {estado && estado.appMpConfigurada && conectado && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <Badge className="gap-1 bg-success/15 text-success hover:bg-success/15">
                <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
              </Badge>
              <p className="text-sm text-muted-foreground">
                Cuenta de Mercado Pago n.º {estado.conexion.mpUserId}
                {estado.conexion.conectadoEn &&
                  ` · desde el ${formatearFechaHora(estado.conexion.conectadoEn)}`}
              </p>
            </div>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setConfirmarDesconexion(true)}
              disabled={desconectando}
            >
              <Unplug className="mr-2 h-4 w-4" /> Desconectar
            </Button>
          </div>
        )}

        {estado && estado.appMpConfigurada && requiereReconexion && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>
                Mercado Pago dejó de aceptar la conexión y el catálogo no puede cobrar con tu
                cuenta. Volvé a conectarla: tarda menos de un minuto.
              </p>
            </div>
            <Button asChild className="h-11 w-full sm:w-auto">
              <a href={URL_CONECTAR}>
                <PlugZap className="mr-2 h-4 w-4" /> Reconectar Mercado Pago
              </a>
            </Button>
          </div>
        )}

        {estado && estado.appMpConfigurada && !conectado && !requiereReconexion && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Vas a ir a Mercado Pago, iniciás sesión y tocás «Autorizar». La plata de cada venta
              entra directo a tu cuenta: Comerz no la toca.
            </p>
            <Button asChild className="h-11 w-full sm:w-auto">
              <a href={URL_CONECTAR}>
                <PlugZap className="mr-2 h-4 w-4" /> Conectar Mercado Pago
              </a>
            </Button>
          </div>
        )}
      </section>

      {/* ─── Medios ─── */}
      <section className="space-y-6 rounded-2xl border border-border bg-card p-5">
        <h3 className="flex items-center gap-2 border-b border-border/50 pb-3 font-bold text-foreground">
          <Landmark className="h-4 w-4 text-muted-foreground" /> Qué ofrece tu catálogo
        </h3>

        {!conectado && (
          <p className="text-sm text-muted-foreground">
            Conectá tu Mercado Pago para prender los medios: los dos cobran en esa cuenta.
          </p>
        )}

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="cobro-mp" className="text-sm font-semibold">
                Mercado Pago
              </Label>
              <p className="text-xs text-muted-foreground">
                Tarjeta, saldo en Mercado Pago o cuotas sin tarjeta. La clienta paga en Mercado
                Pago y la venta se registra sola cuando el pago se aprueba.
              </p>
            </div>
            <Switch
              id="cobro-mp"
              checked={form.cobroMercadoPago}
              onCheckedChange={(v) => cambiar("cobroMercadoPago", v)}
              disabled={!conectado}
              className="mt-1"
            />
          </div>
          <div className="space-y-1.5 sm:max-w-xs">
            <Label className="text-xs text-muted-foreground">Si no paga, la orden vence en</Label>
            <Select
              value={String(form.minutosVenceMp)}
              onValueChange={(v) => cambiar("minutosVenceMp", Number(v))}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPCIONES_VENCE_MP.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {etiquetaMinutos(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4 border-t border-border/50 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="cobro-transferencia" className="text-sm font-semibold">
                Transferencia a tu Mercado Pago
              </Label>
              <p className="text-xs text-muted-foreground">
                La clienta transfiere al alias de tu Mercado Pago. Cuando la plata entra, confirmás
                la orden con un toque y la venta queda registrada.
              </p>
            </div>
            <Switch
              id="cobro-transferencia"
              checked={form.cobroTransferencia}
              onCheckedChange={(v) => cambiar("cobroTransferencia", v)}
              disabled={!conectado}
              className="mt-1"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="alias-mp" className="text-xs text-muted-foreground">
                Alias o CVU de tu Mercado Pago
              </Label>
              <Input
                id="alias-mp"
                value={form.aliasMercadoPago}
                onChange={(e) => cambiar("aliasMercadoPago", e.target.value)}
                placeholder="mi.tienda.mp"
                autoComplete="off"
                autoCapitalize="none"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="titular" className="text-xs text-muted-foreground">
                Titular (lo ve la clienta para chequear)
              </Label>
              <Input
                id="titular"
                value={form.titular}
                onChange={(e) => cambiar("titular", e.target.value)}
                placeholder="Nombre y apellido o razón social"
                className="h-11"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Usá el alias de la MISMA cuenta que conectaste. Si es de otra cuenta, no vamos a poder
            confirmar las transferencias por vos.
          </p>

          <div className="space-y-1.5 sm:max-w-xs">
            <Label className="text-xs text-muted-foreground">
              Si no transfiere, la orden vence en
            </Label>
            <Select
              value={String(form.minutosVenceTransferencia)}
              onValueChange={(v) => cambiar("minutosVenceTransferencia", Number(v))}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPCIONES_VENCE_TRANSFERENCIA.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {etiquetaMinutos(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Mientras la orden espera, el stock queda apartado. Al vencer, vuelve solo.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Descuento ─── */}
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Tag className="h-4 w-4 text-muted-foreground" /> ¿Descuento por transferencia?
          </p>
          <p className="text-xs text-muted-foreground">
            Armalo en Promociones con la regla «Método de pago» y elegí Transferencia. Se aplica
            igual en el catálogo y en el mostrador.
          </p>
        </div>
        {onIrASeccion && (
          <Button variant="outline" className="h-11" onClick={() => onIrASeccion("promociones")}>
            Ir a Promociones
          </Button>
        )}
      </section>

      <AlertDialog open={confirmarDesconexion} onOpenChange={setConfirmarDesconexion}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar Mercado Pago?</AlertDialogTitle>
            <AlertDialogDescription>
              El catálogo deja de ofrecer Mercado Pago y transferencia hasta que la vuelvas a
              conectar. Las órdenes y ventas que ya tenés no se tocan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={desconectando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                desconectar();
              }}
              disabled={desconectando}
            >
              {desconectando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
