"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  Copy,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
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
import type { AmbienteArca } from "../lib/codigos-arca";
import type { EstadoCredenciales } from "../lib/credenciales";
import { estadoCertificado } from "../lib/estado-certificado";
import {
  borrarCredencialesArcaAction,
  cambiarAmbienteArcaAction,
  cargarCertificadoArcaAction,
  estadoConexionArcaAction,
  generarCsrArcaAction,
  probarConexionArcaAction,
  type EstadoConexionArca,
} from "../actions/conexion-arca";

/**
 * Conexión con ARCA, dentro de Configuración → Facturación.
 *
 * Reemplaza al wizard de mentira que hubo acá (generaba un CSR de texto fijo
 * y decía "certificado guardado" sin guardar nada). Este hace las tres cosas
 * de verdad, en el server: genera clave + CSR, valida y guarda el
 * certificado, y prueba la cadena entera contra ARCA.
 *
 * Homologación y producción son DOS tarjetas con credenciales propias: ARCA
 * emite certificados distintos para cada una, y el ambiente activo se elige
 * aparte. Nada de lo que se muestra acá es secreto: la clave privada nunca
 * sale del server (ver credenciales.ts).
 */

interface Props {
  puedeEditar: boolean;
}

const ETIQUETA: Record<AmbienteArca, string> = {
  HOMOLOGACION: "Homologación (pruebas)",
  PRODUCCION: "Producción",
};

export function ArcaConexion({ puedeEditar }: Readonly<Props>) {
  const [estado, setEstado] = useState<EstadoConexionArca | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const recargar = async () => {
    const r = await estadoConexionArcaAction();
    if (r.ok) {
      setEstado(r.data);
      setError(null);
    } else {
      setError(r.error);
    }
  };

  useEffect(() => {
    let vigente = true;
    estadoConexionArcaAction().then((r) => {
      if (!vigente) return;
      if (r.ok) setEstado(r.data);
      else setError(r.error);
    });
    return () => {
      vigente = false;
    };
  }, []);

  if (error) {
    return (
      <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
        {error}
      </div>
    );
  }
  if (!estado) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
        <Loader2 className="w-4 h-4 animate-spin" /> Leyendo el estado de la
        conexión…
      </div>
    );
  }

  const cifradoOk = estado.homologacion.cifradoConfigurado;

  return (
    <div className="space-y-4">
      {!cifradoOk && (
        <div className="text-sm text-warning bg-warning/10 border border-warning/20 rounded-lg p-3">
          El servidor no tiene configurada <code>ARCA_CLAVE_CIFRADO</code>. Sin
          eso no se pueden guardar credenciales. Es una variable de entorno de
          Vercel, no algo que se cargue acá.
        </div>
      )}

      {!estado.cuit && (
        <div className="text-sm text-warning bg-warning/10 border border-warning/20 rounded-lg p-3">
          Cargá el CUIT del comercio en Configuración → Comercio: ARCA lo
          valida contra el certificado.
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-sm font-semibold">Ambiente activo</Label>
        <RadioGroup
          value={estado.ambienteActivo}
          disabled={!puedeEditar}
          onValueChange={async (v) => {
            const r = await cambiarAmbienteArcaAction(v);
            if (r.ok) {
              toast.success(`Ambiente: ${ETIQUETA[v as AmbienteArca]}.`);
              await recargar();
              router.refresh();
            } else {
              toast.error(r.error);
            }
          }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        >
          {(["HOMOLOGACION", "PRODUCCION"] as const).map((a) => (
            <Label
              key={a}
              htmlFor={`ambiente-${a}`}
              className={`flex items-center gap-2 border rounded-lg p-3 text-sm ${
                estado.ambienteActivo === a
                  ? "border-primary bg-primary/5"
                  : "border-border"
              } ${puedeEditar ? "cursor-pointer" : "opacity-60"}`}
            >
              <RadioGroupItem value={a} id={`ambiente-${a}`} />
              {ETIQUETA[a]}
            </Label>
          ))}
        </RadioGroup>
        <p className="text-xs text-muted-foreground">
          En homologación los CAE no tienen valor fiscal: sirven para probar el
          circuito entero antes de facturar de verdad. Pasar a producción exige
          un certificado de producción vigente.
        </p>
      </div>

      <TarjetaAmbiente
        ambiente="HOMOLOGACION"
        estado={estado.homologacion}
        activo={estado.ambienteActivo === "HOMOLOGACION"}
        puedeEditar={puedeEditar && cifradoOk && Boolean(estado.cuit)}
        onCambio={recargar}
      />
      <TarjetaAmbiente
        ambiente="PRODUCCION"
        estado={estado.produccion}
        activo={estado.ambienteActivo === "PRODUCCION"}
        puedeEditar={puedeEditar && cifradoOk && Boolean(estado.cuit)}
        onCambio={recargar}
      />
    </div>
  );
}

function TarjetaAmbiente({
  ambiente,
  estado,
  activo,
  puedeEditar,
  onCambio,
}: Readonly<{
  ambiente: AmbienteArca;
  estado: EstadoCredenciales;
  activo: boolean;
  puedeEditar: boolean;
  onCambio: () => Promise<void>;
}>) {
  const [certificado, setCertificado] = useState("");
  const [pendiente, startTransition] = useTransition();
  const [prueba, setPrueba] = useState<string | null>(null);
  /** Qué confirmación está abierta. Diálogo de la app, no `window.confirm`. */
  const [confirmando, setConfirmando] = useState<"regenerar" | "borrar" | null>(null);

  const conectado = estado.tieneCertificado && !estado.certificadoVencido;
  const vencimiento = estadoCertificado(estado.certificadoVencimiento);
  const porVencer = vencimiento?.estado === "por_vencer";

  const generarCsr = () => {
    if (estado.tieneCertificado && confirmando !== "regenerar") {
      setConfirmando("regenerar");
      return;
    }
    setConfirmando(null);
    startTransition(async () => {
      const r = await generarCsrArcaAction(ambiente);
      if (r.ok) {
        toast.success("CSR generado. Pegalo en ARCA para pedir el certificado.");
        await onCambio();
      } else {
        toast.error(r.error);
      }
    });
  };

  const cargarCertificado = () => {
    startTransition(async () => {
      const r = await cargarCertificadoArcaAction(ambiente, certificado);
      if (r.ok) {
        toast.success(
          `Certificado guardado. Vence el ${r.data.vencimiento.slice(0, 10)}.`,
        );
        setCertificado("");
        await onCambio();
      } else {
        toast.error(r.error);
      }
    });
  };

  const probar = () => {
    setPrueba(null);
    startTransition(async () => {
      const r = await probarConexionArcaAction(ambiente);
      if (r.ok) {
        const u = r.data.ultimoAutorizado;
        setPrueba(
          `Conectado. Servidores ${r.data.servidores.appServer}/${r.data.servidores.dbServer}/${r.data.servidores.authServer}. ` +
            `Ticket vigente hasta ${new Date(r.data.taVigenteHasta).toLocaleString("es-AR")}.` +
            (u
              ? ` Último ${u.tipo.replace("_", " ")} autorizado: ${u.numero}.`
              : " Sin punto de venta: no se consultó numeración."),
        );
        await onCambio();
      } else {
        setPrueba(`Falló: ${r.error}`);
      }
    });
  };

  const borrar = () => {
    if (confirmando !== "borrar") {
      setConfirmando("borrar");
      return;
    }
    setConfirmando(null);
    startTransition(async () => {
      const r = await borrarCredencialesArcaAction(ambiente);
      if (r.ok) {
        toast.success("Credenciales borradas.");
        await onCambio();
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <div
      className={`border rounded-xl p-4 space-y-4 ${
        activo ? "border-primary/60" : "border-border"
      }`}
    >
      <AlertDialog
        open={confirmando !== null}
        onOpenChange={(open) => !open && setConfirmando(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmando === "borrar"
                ? `¿Borrar las credenciales de ${ETIQUETA[ambiente].toLowerCase()}?`
                : "¿Generar un CSR nuevo?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmando === "borrar"
                ? "Se borran la clave privada y el certificado. Para volver a facturar hay que generar un CSR y pedir otro certificado en ARCA."
                : "Un CSR nuevo invalida el certificado actual: vas a tener que pedir otro en ARCA y cargarlo. Hasta entonces la caja emite ticket interno."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => (confirmando === "borrar" ? borrar() : generarCsr())}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {confirmando === "borrar" ? "Borrar" : "Generar de nuevo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold">{ETIQUETA[ambiente]}</h4>
          {activo && <Badge variant="secondary">Activo</Badge>}
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium">
          {conectado && porVencer ? (
            <span className="flex items-center gap-1.5 text-warning">
              <ShieldCheck className="w-4 h-4" />
              Vence en {vencimiento.dias} día{vencimiento.dias === 1 ? "" : "s"}: pedí
              el nuevo en ARCA
            </span>
          ) : conectado ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-success" />
              Certificado vigente hasta{" "}
              {estado.certificadoVencimiento?.slice(0, 10)}
            </>
          ) : estado.certificadoVencido ? (
            <>
              <XCircle className="w-4 h-4 text-destructive" /> Certificado
              vencido
            </>
          ) : estado.tieneClave ? (
            <>
              <span className="w-2 h-2 rounded-full bg-warning" /> Falta el
              certificado
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-muted-foreground" /> Sin
              configurar
            </>
          )}
        </div>
      </div>

      {/* Paso 1: CSR */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Label className="text-sm">1. Pedido de certificado (CSR)</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!puedeEditar || pendiente}
            onClick={generarCsr}
          >
            {pendiente ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1" />
            )}
            {estado.tieneClave ? "Generar de nuevo" : "Generar CSR"}
          </Button>
        </div>
        {estado.csrPem ? (
          <div className="relative">
            <Textarea
              readOnly
              value={estado.csrPem}
              rows={5}
              className="font-mono text-[11px] leading-tight pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 h-8 w-8"
              onClick={async () => {
                await navigator.clipboard.writeText(estado.csrPem ?? "");
                toast.success("CSR copiado.");
              }}
              aria-label="Copiar CSR"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Genera un par de claves en el servidor y te muestra el CSR para
            pegar en ARCA → Administrador de Certificados Digitales. La clave
            privada no sale de acá.
          </p>
        )}
      </div>

      {/* Paso 2: certificado */}
      {estado.tieneClave && (
        <div className="space-y-2">
          <Label className="text-sm" htmlFor={`cert-${ambiente}`}>
            2. Certificado emitido por ARCA (.crt)
          </Label>
          <Textarea
            id={`cert-${ambiente}`}
            value={certificado}
            onChange={(e) => setCertificado(e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----"
            rows={4}
            disabled={!puedeEditar || pendiente}
            className="font-mono text-[11px] leading-tight"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!puedeEditar || pendiente || !certificado.trim()}
              onClick={cargarCertificado}
            >
              <ShieldCheck className="w-4 h-4 mr-1" />
              {estado.tieneCertificado ? "Reemplazar certificado" : "Guardar certificado"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Después de emitirlo, en ARCA hay que autorizar el servicio{" "}
            <code>wsfe</code> para este certificado (Administrador de
            Relaciones). Sin eso el login falla.
          </p>
        </div>
      )}

      {/* Paso 3: probar */}
      {conectado && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label className="text-sm">3. Probar la conexión</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!puedeEditar || pendiente}
                onClick={probar}
              >
                {pendiente ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <PlugZap className="w-4 h-4 mr-1" />
                )}
                Probar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!puedeEditar || pendiente}
                onClick={borrar}
                aria-label="Borrar credenciales"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {prueba && (
            <p
              className={`text-xs rounded-lg p-2 border ${
                prueba.startsWith("Falló")
                  ? "text-destructive bg-destructive/10 border-destructive/20"
                  : "text-foreground bg-success/10 border-success/20"
              }`}
            >
              {prueba}
            </p>
          )}
          {estado.taVigenteHasta && !prueba && (
            <p className="text-xs text-muted-foreground">
              Último ticket de acceso vigente hasta{" "}
              {new Date(estado.taVigenteHasta).toLocaleString("es-AR")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
