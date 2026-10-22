"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { formatearMoneda } from "@/shared/utils/formatters";
import { telefonoAWhatsapp } from "@/shared/lib/telefono-whatsapp";
import type { TipoAvisoCc } from "../lib/avisos-cc";

export interface ClienteTanda {
  id: string;
  nombre: string;
  telefono: string | null | undefined;
  /** Lo que se le cobra en este aviso. */
  monto: number;
  tipo: TipoAvisoCc;
}

const ETIQUETA_TIPO: Record<TipoAvisoCc, string> = {
  MORA: "Vencido",
  PREVIO: "Por vencer",
  CIERRE: "Cierre del mes",
};

/**
 * Mandar el resumen a toda la lista de cobro, una clienta detrás de otra: se
 * toca Enviar, se abre WhatsApp con el mensaje, se vuelve y ya está la
 * siguiente. Sin API de WhatsApp (sale del teléfono del comercio, con su
 * nombre). La cola se congela al abrir: marcar a una como enviada no reordena
 * la lista mientras se recorre.
 *
 * El envío es el mismo de la columna de WhatsApp (`enviarResumen` de la
 * tabla: link, plantilla, total con mora y registro en `cc_avisos`).
 */
export function EnvioEnTanda({
  clientes,
  onEnviar,
}: Readonly<{
  /** Los de la lista a los que todavía no se les mandó. */
  clientes: ClienteTanda[];
  onEnviar: (clienteId: string) => Promise<void>;
}>) {
  const [cola, setCola] = useState<ClienteTanda[] | null>(null);
  const [indice, setIndice] = useState(0);
  const [enviados, setEnviados] = useState(0);
  const [enviando, setEnviando] = useState(false);

  if (clientes.length === 0) return null;

  const abrir = () => {
    setCola(clientes);
    setIndice(0);
    setEnviados(0);
  };
  const cerrar = () => setCola(null);
  const actual = cola?.[indice] ?? null;
  const terminado = cola !== null && indice >= cola.length;

  const enviar = async () => {
    if (!actual) return;
    setEnviando(true);
    try {
      await onEnviar(actual.id);
      setEnviados((n) => n + 1);
      setIndice((i) => i + 1);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={abrir}
        className="h-11 w-full rounded-xl sm:w-auto"
      >
        <Send className="mr-2 h-4 w-4" />
        Enviar a {clientes.length}
      </Button>

      <Dialog open={cola !== null} onOpenChange={(abierto) => !abierto && cerrar()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar resúmenes</DialogTitle>
            <DialogDescription>
              {terminado
                ? `Listo: ${enviados} enviado${enviados === 1 ? "" : "s"}.`
                : `${indice + 1} de ${cola?.length ?? 0} · se abre WhatsApp, mandás el mensaje y volvés.`}
            </DialogDescription>
          </DialogHeader>

          {actual ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold">{actual.nombre}</span>
                    <span className="block text-xs text-muted-foreground">
                      {actual.telefono || "Sin teléfono cargado"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-[10px] font-bold uppercase tracking-widest ${
                      actual.tipo === "MORA" ? "text-danger" : "text-warning"
                    }`}
                  >
                    {ETIQUETA_TIPO[actual.tipo]}
                  </span>
                </div>
                <div className="mt-3 font-mono text-2xl font-medium">
                  {formatearMoneda(actual.monto)}
                </div>
                {!telefonoAWhatsapp(actual.telefono) && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Sin un teléfono válido WhatsApp te va a pedir que elijas el
                    contacto.
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1"
                  disabled={enviando}
                  onClick={() => setIndice((i) => i + 1)}
                >
                  Saltear
                </Button>
                <Button
                  type="button"
                  className="h-11 flex-1"
                  disabled={enviando}
                  onClick={() => void enviar()}
                >
                  {enviando ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FaWhatsapp className="mr-2 h-4 w-4" />
                  )}
                  Enviar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button type="button" onClick={cerrar} className="h-11">
                Cerrar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
