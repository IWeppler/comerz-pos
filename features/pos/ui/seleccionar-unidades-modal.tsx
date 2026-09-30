"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Barcode, Loader2, ScanLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { getUnidadesDisponiblesAction } from "@/features/sales/actions/get-unidades-serie";
import { agregarUnidadSerieAction } from "@/features/stock/actions/unidades-serie";
import { normalizarImei } from "@/entities/ventas/imei";
import type {
  UnidadSeleccionada,
  UnidadSerieDisponible,
} from "@/entities/ventas/unidades-serie-types";

/** Línea del carrito que no se puede vender sin elegir el aparato. */
export interface LineaSerializada {
  varianteId: string;
  nombre: string;
  variante: string;
}

/**
 * Línea de un producto marcado "lleva IMEI" que NO tiene ninguna unidad
 * cargada. No bloquea el cobro: se tipea el número acá (y queda registrado) o
 * se vende sin IMEI a sabiendas.
 */
export interface LineaSinImei extends LineaSerializada {
  cantidad: number;
}

interface SeleccionarUnidadesModalProps {
  /** El componente se monta solo cuando hay que elegir: no recibe `open`. */
  onCerrar: () => void;
  lineas: LineaSerializada[];
  lineasSinImei?: LineaSinImei[];
  /**
   * Se llama con una unidad por línea serializada (más las recién tipeadas).
   * `creadas`: variantes a las que se les acaba de crear la unidad.
   * `sinImei`: variantes que se venden sin IMEI por decisión de la vendedora.
   */
  onConfirmar: (
    seleccion: UnidadSeleccionada[],
    extra: { creadas: string[]; sinImei: string[] },
  ) => void;
}

export function SeleccionarUnidadesModal({
  onCerrar,
  lineas,
  lineasSinImei = [],
  onConfirmar,
}: Readonly<SeleccionarUnidadesModalProps>) {
  // Arranca en true: el componente se monta justo para cargar, así el
  // primer setState ya es el de la respuesta y no hay reset síncrono.
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unidadesPorVariante, setUnidadesPorVariante] = useState<
    Record<string, UnidadSerieDisponible[]>
  >({});
  const [elegidaPorVariante, setElegidaPorVariante] = useState<
    Record<string, string>
  >({});
  const [filtro, setFiltro] = useState("");
  // Líneas sin unidades: lo tipeado, lo aceptado "sin IMEI", y lo que ya se
  // creó en la base en un intento anterior (para no volver a crearlo y
  // chocar contra el índice único si otro número de la lista falló).
  const [imeiTipeado, setImeiTipeado] = useState<Record<string, string>>({});
  const [sinImei, setSinImei] = useState<Record<string, boolean>>({});
  const [creadas, setCreadas] = useState<
    Record<string, { unidadId: string; imei: string }>
  >({});
  const [guardando, setGuardando] = useState(false);
  const [errorSinImei, setErrorSinImei] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const entradas = await Promise.all(
        lineas.map(async (linea) => {
          const res = await getUnidadesDisponiblesAction(linea.varianteId);
          return [linea.varianteId, res.unidades, res.error] as const;
        }),
      );

      const mapa: Record<string, UnidadSerieDisponible[]> = {};
      let primerError: string | null = null;
      for (const [varianteId, unidades, err] of entradas) {
        mapa[varianteId] = unidades;
        if (err && !primerError) primerError = err;
      }

      setUnidadesPorVariante(mapa);
      setError(primerError);

      // Preselección FIFO: la primera disponible de cada línea. Es lo que
      // el vendedor elige en el 90% de los casos y ahorra un clic por
      // aparato; sigue pudiendo cambiarla si el cliente pide otro.
      setElegidaPorVariante((previo) => {
        const siguiente = { ...previo };
        for (const [varianteId, unidades] of Object.entries(mapa)) {
          if (!siguiente[varianteId] && unidades.length > 0) {
            siguiente[varianteId] = unidades[0].id;
          }
        }
        return siguiente;
      });
    } finally {
      setCargando(false);
    }
  }, [lineas]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const todasElegidas = lineas.every((l) => elegidaPorVariante[l.varianteId]);
  const sinImeiResueltas = lineasSinImei.every(
    (l) => sinImei[l.varianteId] || normalizarImei(imeiTipeado[l.varianteId]),
  );

  const handleConfirmar = async () => {
    const seleccion: UnidadSeleccionada[] = [];
    for (const linea of lineas) {
      const unidadId = elegidaPorVariante[linea.varianteId];
      const unidad = unidadesPorVariante[linea.varianteId]?.find(
        (u) => u.id === unidadId,
      );
      if (!unidad) return;
      seleccion.push({
        varianteId: linea.varianteId,
        unidadId: unidad.id,
        imei: unidad.imei,
      });
    }

    // Los IMEI tipeados se registran ANTES de cobrar, como unidades
    // disponibles: la venta las marca vendidas por el camino de siempre. Si
    // la venta después no se hace, el aparato queda con su número en stock,
    // que es la verdad.
    const creadasAhora = { ...creadas };
    const aceptadasSinImei: string[] = [];
    setErrorSinImei(null);
    setGuardando(true);
    try {
      for (const linea of lineasSinImei) {
        if (sinImei[linea.varianteId]) {
          aceptadasSinImei.push(linea.varianteId);
          continue;
        }
        const imei = normalizarImei(imeiTipeado[linea.varianteId]);
        if (creadasAhora[linea.varianteId]?.imei !== imei) {
          const res = await agregarUnidadSerieAction(linea.varianteId, imei);
          if (!res.ok) {
            setErrorSinImei(`${linea.nombre}: ${res.error}`);
            setCreadas(creadasAhora);
            return;
          }
          creadasAhora[linea.varianteId] = {
            unidadId: res.unidad.id,
            imei: res.unidad.imei,
          };
        }
        const creada = creadasAhora[linea.varianteId];
        seleccion.push({
          varianteId: linea.varianteId,
          unidadId: creada.unidadId,
          imei: creada.imei,
        });
      }
    } catch {
      setErrorSinImei("No se pudo guardar el IMEI. Revisá la conexión.");
      setCreadas(creadasAhora);
      return;
    } finally {
      setGuardando(false);
    }

    onConfirmar(seleccion, {
      // Toda unidad creada en este modal existe en la base como disponible,
      // aunque la línea se haya pasado después a "sin IMEI".
      creadas: Object.keys(creadasAhora),
      sinImei: aceptadasSinImei,
    });
  };

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="sm:max-w-[600px] border-border bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Barcode className="w-5 h-5 text-success" />
            {lineas.length > 0 ? "Elegí el aparato" : "Falta el IMEI"}
          </DialogTitle>
          <DialogDescription>
            {lineas.length > 0
              ? "Estos productos se venden por número de serie. Seleccioná qué unidad se lleva el cliente."
              : "Estos productos llevan IMEI y no tienen ninguno cargado. Sin él, el ticket sale sin IMEI."}
          </DialogDescription>
        </DialogHeader>

        {cargando ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Buscando unidades disponibles...
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {error && (
              <p className="text-xs text-danger border border-danger/20 bg-danger/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            {lineas.length > 0 && (
              <div className="relative">
                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                  placeholder="Escaneá o tipeá un IMEI para filtrar"
                  className="pl-9"
                />
              </div>
            )}

            {lineas.map((linea) => {
              const unidades = unidadesPorVariante[linea.varianteId] ?? [];
              const filtradas = filtro.trim()
                ? unidades.filter((u) =>
                    u.imei.toLowerCase().includes(filtro.trim().toLowerCase()),
                  )
                : unidades;

              return (
                <div
                  key={linea.varianteId}
                  className="border border-border rounded-xl overflow-hidden"
                >
                  <div className="bg-muted/40 px-3 py-2">
                    <div className="text-sm font-semibold">{linea.nombre}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {linea.variante}
                    </div>
                  </div>

                  {unidades.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-danger">
                      No quedan unidades disponibles de este producto. Sacalo
                      del carrito para poder cobrar.
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto divide-y divide-border">
                      {filtradas.length === 0 && (
                        <p className="px-3 py-3 text-xs text-muted-foreground">
                          Ningún IMEI de este producto coincide con el filtro.
                        </p>
                      )}
                      {filtradas.map((unidad, idx) => {
                        const elegida =
                          elegidaPorVariante[linea.varianteId] === unidad.id;
                        return (
                          <button
                            key={unidad.id}
                            type="button"
                            onClick={() =>
                              setElegidaPorVariante((previo) => ({
                                ...previo,
                                [linea.varianteId]: unidad.id,
                              }))
                            }
                            className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                              elegida ? "bg-success/10" : "hover:bg-muted/50"
                            }`}
                          >
                            <span className="font-mono text-xs">
                              {unidad.imei}
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              {/* El primero de la lista es el más viejo: es
                                  el que conviene sacar primero. */}
                              {idx === 0 && !filtro.trim() && (
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                  Más antiguo
                                </span>
                              )}
                              <span
                                className={`text-[10px] font-bold uppercase tracking-widest ${
                                  elegida ? "text-success" : "text-transparent"
                                }`}
                              >
                                Elegido
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {lineasSinImei.map((linea) => {
              const unaPorLinea = linea.cantidad === 1;
              const aceptada = Boolean(sinImei[linea.varianteId]);
              return (
                <div
                  key={linea.varianteId}
                  className="border border-warning/40 rounded-xl overflow-hidden"
                >
                  <div className="bg-warning/10 px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold">{linea.nombre}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {linea.variante} · sin IMEI cargado
                      </div>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {unaPorLinea ? (
                      <Input
                        value={imeiTipeado[linea.varianteId] ?? ""}
                        onChange={(e) => {
                          const valor = e.target.value;
                          setImeiTipeado((prev) => ({
                            ...prev,
                            [linea.varianteId]: valor,
                          }));
                        }}
                        onKeyDown={(e) => {
                          // El lector de códigos termina con Enter: no tiene
                          // que confirmar la venta a mitad de carga.
                          if (e.key === "Enter") e.preventDefault();
                        }}
                        placeholder="Escaneá o escribí el IMEI"
                        className="h-11 font-mono text-sm"
                        disabled={aceptada}
                        autoComplete="off"
                      />
                    ) : (
                      // Una unidad serializada va en una línea de cantidad 1
                      // (create-sale lo exige): con cantidad 2 no hay a qué
                      // renglón atar el segundo número.
                      <p className="text-xs text-muted-foreground">
                        Para registrar el IMEI, cargá una línea por aparato
                        (cantidad 1).
                      </p>
                    )}
                    <label className="flex items-center gap-2 min-h-11 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={aceptada}
                        onChange={(e) => {
                          const marcado = e.target.checked;
                          setSinImei((prev) => ({
                            ...prev,
                            [linea.varianteId]: marcado,
                          }));
                        }}
                      />
                      Vender sin IMEI
                    </label>
                  </div>
                </div>
              );
            })}

            {errorSinImei && (
              <p className="text-xs text-danger border border-danger/20 bg-danger/10 rounded-lg px-3 py-2">
                {errorSinImei}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={onCerrar}
                className="shadow-none"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirmar()}
                disabled={!todasElegidas || !sinImeiResueltas || guardando}
              >
                {guardando && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {lineas.length > 0 ? "Confirmar unidades" : "Continuar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
