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
import { MOTIVOS_SIN_IMEI } from "@/features/sales/lib/aparatos-sin-imei";
import {
  MotivoSinImeiField,
  OPCION_OTRO,
  motivoElegido,
  type EleccionMotivoSinImei,
} from "./motivo-sin-imei-field";

/** Línea del carrito que no se puede vender sin elegir el aparato. */
export interface LineaSerializada {
  varianteId: string;
  nombre: string;
  variante: string;
  /** Una línea de cantidad 2 son dos aparatos: se elige uno por unidad. */
  cantidad: number;
}

/**
 * Línea de un producto que lleva IMEI (por él o por su categoría) que NO tiene
 * ninguna unidad cargada. Se tipea el número acá (y queda registrado) o se
 * vende sin IMEI con un motivo, que create-sale exige.
 */
export type LineaSinImei = LineaSerializada;

/** Por qué sale sin IMEI cada línea que lo lleva y va sin número. */
export type MotivoSinImeiLinea = { varianteId: string; motivo: string };

/**
 * Cuántos aparatos hay que elegir en una línea: uno por unidad vendida, hasta
 * los que tienen IMEI. Mismo criterio que create-sale (`requeridas`): si hay
 * 1 con IMEI y se venden 2, el segundo sale sin número.
 */
export function aparatosRequeridos(cantidad: number, disponibles: number): number {
  return Math.max(0, Math.min(Math.floor(cantidad), disponibles));
}

/** Los IMEI elegidos de cada variante, juntos ("356…, 357…"): una línea de
 * dos aparatos los muestra a los dos en el carrito y en el ticket. */
export function imeisPorVariante(
  unidades: UnidadSeleccionada[],
): Record<string, string> {
  const porVariante: Record<string, string[]> = {};
  for (const u of unidades) {
    (porVariante[u.varianteId] ??= []).push(u.imei);
  }
  return Object.fromEntries(
    Object.entries(porVariante).map(([varianteId, imeis]) => [
      varianteId,
      imeis.join(", "),
    ]),
  );
}

interface SeleccionarUnidadesModalProps {
  /** El componente se monta solo cuando hay que elegir: no recibe `open`. */
  onCerrar: () => void;
  lineas: LineaSerializada[];
  lineasSinImei?: LineaSinImei[];
  /** Variantes que llevan IMEI. Una línea serializada de éstas que vende más
   * aparatos que los que tienen número pide motivo para los que sobran. */
  variantesLlevanSerie?: ReadonlySet<string>;
  /** Motivos ya elegidos en esta venta (reabrir el modal no los pierde). */
  motivosIniciales?: MotivoSinImeiLinea[];
  /**
   * Se llama con una unidad por línea serializada (más las recién tipeadas).
   * `creadas`: variantes a las que se les acaba de crear la unidad.
   * `sinImei`: líneas que salen (en todo o en parte) sin IMEI, con su motivo.
   */
  onConfirmar: (
    seleccion: UnidadSeleccionada[],
    extra: { creadas: string[]; sinImei: MotivoSinImeiLinea[] },
  ) => void;
}

export function SeleccionarUnidadesModal({
  onCerrar,
  lineas,
  lineasSinImei = [],
  variantesLlevanSerie,
  motivosIniciales = [],
  onConfirmar,
}: Readonly<SeleccionarUnidadesModalProps>) {
  // Arranca en true: el componente se monta justo para cargar, así el
  // primer setState ya es el de la respuesta y no hay reset síncrono.
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unidadesPorVariante, setUnidadesPorVariante] = useState<
    Record<string, UnidadSerieDisponible[]>
  >({});
  // Las unidades elegidas de cada línea, en el orden en que se tocaron.
  const [elegidasPorVariante, setElegidasPorVariante] = useState<
    Record<string, string[]>
  >({});
  const [filtro, setFiltro] = useState("");
  // Líneas sin unidades: lo tipeado (un número por aparato), lo aceptado "sin
  // IMEI", y lo que ya se creó en la base en un intento anterior (para no
  // volver a crearlo y chocar contra el índice único si otro número falló).
  // Las claves de `creadas` son `${varianteId}|${posición}`.
  const [imeiTipeado, setImeiTipeado] = useState<Record<string, string[]>>({});
  const [sinImei, setSinImei] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(motivosIniciales.map((m) => [m.varianteId, true])),
  );
  // Motivo por variante. Arranca con lo ya elegido como "Otro" con su texto:
  // muestra lo mismo y no obliga a elegirlo de nuevo.
  const [motivos, setMotivos] = useState<Record<string, EleccionMotivoSinImei>>(
    () =>
      Object.fromEntries(
        motivosIniciales.map((m) => [
          m.varianteId,
          (MOTIVOS_SIN_IMEI as readonly string[]).includes(m.motivo)
            ? { opcion: m.motivo, otro: "" }
            : { opcion: OPCION_OTRO, otro: m.motivo },
        ]),
      ),
  );
  const elegirMotivo = (varianteId: string, eleccion: EleccionMotivoSinImei) =>
    setMotivos((prev) => ({ ...prev, [varianteId]: eleccion }));
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

      // Preselección FIFO: las más antiguas de cada línea, tantas como
      // aparatos lleva. Es lo que el vendedor elige en el 90% de los casos y
      // ahorra un clic por aparato; sigue pudiendo cambiarlas si el cliente
      // pide otro.
      setElegidasPorVariante((previo) => {
        const siguiente = { ...previo };
        for (const linea of lineas) {
          const unidades = mapa[linea.varianteId] ?? [];
          if (siguiente[linea.varianteId]?.length) continue;
          siguiente[linea.varianteId] = unidades
            .slice(0, aparatosRequeridos(linea.cantidad, unidades.length))
            .map((u) => u.id);
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

  const requeridasDe = (linea: LineaSerializada) =>
    aparatosRequeridos(
      linea.cantidad,
      unidadesPorVariante[linea.varianteId]?.length ?? 0,
    );

  const todasElegidas = lineas.every((l) => {
    const requeridas = requeridasDe(l);
    return (
      requeridas > 0 &&
      (elegidasPorVariante[l.varianteId]?.length ?? 0) === requeridas
    );
  });

  /** Una línea sin IMEI pide un número por aparato. Con una cantidad que no
   * es entera (no debería pasar en un producto con IMEI) no hay qué tipear:
   * solo se puede vender sin IMEI. */
  const casillasSinImei = (linea: LineaSinImei) =>
    Number.isInteger(linea.cantidad) ? linea.cantidad : 0;

  /** Aparatos de una línea serializada que salen sin número porque se venden
   * más que los que tienen IMEI. Si el producto lleva IMEI, piden motivo. */
  const sinNumeroDe = (linea: LineaSerializada) =>
    Math.max(0, linea.cantidad - requeridasDe(linea));
  const pideMotivoParcial = (linea: LineaSerializada) =>
    !cargando &&
    (unidadesPorVariante[linea.varianteId]?.length ?? 0) > 0 &&
    sinNumeroDe(linea) > 0 &&
    Boolean(variantesLlevanSerie?.has(linea.varianteId));
  const parcialesResueltas = lineas.every(
    (l) => !pideMotivoParcial(l) || motivoElegido(motivos[l.varianteId]) !== null,
  );

  const sinImeiResueltas = lineasSinImei.every((l) => {
    if (sinImei[l.varianteId]) return motivoElegido(motivos[l.varianteId]) !== null;
    const casillas = casillasSinImei(l);
    const tipeados = imeiTipeado[l.varianteId] ?? [];
    return (
      casillas > 0 &&
      Array.from({ length: casillas }, (_, i) => normalizarImei(tipeados[i])).every(
        Boolean,
      )
    );
  });

  const toggleUnidad = (linea: LineaSerializada, unidadId: string) => {
    const requeridas = requeridasDe(linea);
    setElegidasPorVariante((previo) => {
      const actuales = previo[linea.varianteId] ?? [];
      let siguientes: string[];
      if (actuales.includes(unidadId)) {
        siguientes = actuales.filter((id) => id !== unidadId);
      } else if (actuales.length < requeridas) {
        siguientes = [...actuales, unidadId];
      } else {
        // Ya están todas: tocar otra la cambia por la elegida hace más
        // tiempo. Con un solo aparato es el comportamiento de siempre
        // (elegir otro reemplaza al anterior).
        siguientes = [...actuales.slice(1), unidadId];
      }
      return { ...previo, [linea.varianteId]: siguientes };
    });
  };

  const handleConfirmar = async () => {
    const seleccion: UnidadSeleccionada[] = [];
    for (const linea of lineas) {
      const elegidas = elegidasPorVariante[linea.varianteId] ?? [];
      if (elegidas.length !== requeridasDe(linea)) return;
      for (const unidadId of elegidas) {
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
    }

    // Los IMEI tipeados se registran ANTES de cobrar, como unidades
    // disponibles: la venta las marca vendidas por el camino de siempre. Si
    // la venta después no se hace, el aparato queda con su número en stock,
    // que es la verdad.
    const creadasAhora = { ...creadas };
    const aceptadasSinImei: MotivoSinImeiLinea[] = [];
    // Las serializadas que venden más aparatos que los que tienen número.
    for (const linea of lineas) {
      if (!pideMotivoParcial(linea)) continue;
      const motivo = motivoElegido(motivos[linea.varianteId]);
      if (!motivo) return;
      aceptadasSinImei.push({ varianteId: linea.varianteId, motivo });
    }
    setErrorSinImei(null);
    setGuardando(true);
    try {
      for (const linea of lineasSinImei) {
        if (sinImei[linea.varianteId]) {
          const motivo = motivoElegido(motivos[linea.varianteId]);
          if (!motivo) return;
          aceptadasSinImei.push({ varianteId: linea.varianteId, motivo });
          continue;
        }
        const tipeados = imeiTipeado[linea.varianteId] ?? [];
        const numeros = Array.from({ length: casillasSinImei(linea) }, (_, i) =>
          normalizarImei(tipeados[i]),
        );
        // El mismo número dos veces fallaría recién en la base, con el primer
        // aparato ya creado: se frena acá, antes de escribir nada.
        if (new Set(numeros).size !== numeros.length) {
          setErrorSinImei(`${linea.nombre}: hay un IMEI repetido.`);
          return;
        }
        for (const [posicion, imei] of numeros.entries()) {
          const clave = `${linea.varianteId}|${posicion}`;
          if (creadasAhora[clave]?.imei !== imei) {
            const res = await agregarUnidadSerieAction(linea.varianteId, imei);
            if (!res.ok) {
              setErrorSinImei(`${linea.nombre}: ${res.error}`);
              setCreadas(creadasAhora);
              return;
            }
            creadasAhora[clave] = {
              unidadId: res.unidad.id,
              imei: res.unidad.imei,
            };
          }
          const creada = creadasAhora[clave];
          seleccion.push({
            varianteId: linea.varianteId,
            unidadId: creada.unidadId,
            imei: creada.imei,
          });
        }
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
      // aunque la línea se haya pasado después a "sin IMEI". Una entrada por
      // unidad: la variante se repite si se crearon varias.
      creadas: Object.keys(creadasAhora).map((clave) => clave.split("|")[0]),
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
              const requeridas = requeridasDe(linea);
              const elegidas = elegidasPorVariante[linea.varianteId] ?? [];
              const sinNumero = Math.max(0, linea.cantidad - requeridas);

              return (
                <div
                  key={linea.varianteId}
                  className="border border-border rounded-xl overflow-hidden"
                >
                  <div className="bg-muted/40 px-3 py-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{linea.nombre}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {linea.variante}
                      </div>
                    </div>
                    {requeridas > 1 && (
                      <span
                        className={`text-[11px] font-semibold shrink-0 ${
                          elegidas.length === requeridas
                            ? "text-success"
                            : "text-warning"
                        }`}
                      >
                        {elegidas.length} de {requeridas} elegidos
                      </span>
                    )}
                  </div>
                  {sinNumero > 0 && unidades.length > 0 && (
                    <div className="px-3 py-2 border-b border-border space-y-2">
                      <p className="text-[11px] text-warning">
                        Se venden {linea.cantidad} y hay {unidades.length} con
                        IMEI: {sinNumero === 1 ? "1 sale" : `${sinNumero} salen`}{" "}
                        sin número.
                      </p>
                      {pideMotivoParcial(linea) && (
                        <MotivoSinImeiField
                          idBase={`motivo-parcial-${linea.varianteId}`}
                          eleccion={motivos[linea.varianteId]}
                          onChange={(e) => elegirMotivo(linea.varianteId, e)}
                        />
                      )}
                    </div>
                  )}

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
                        const elegida = elegidas.includes(unidad.id);
                        return (
                          <button
                            key={unidad.id}
                            type="button"
                            aria-pressed={elegida}
                            onClick={() => toggleUnidad(linea, unidad.id)}
                            className={`w-full text-left px-3 min-h-11 flex items-center justify-between gap-3 transition-colors ${
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
              const casillas = casillasSinImei(linea);
              const tipeados = imeiTipeado[linea.varianteId] ?? [];
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
                    {casillas > 0 ? (
                      // Un número por aparato: create-sale parte la línea en
                      // un renglón por IMEI.
                      Array.from({ length: casillas }, (_, posicion) => (
                        <Input
                          key={posicion}
                          value={tipeados[posicion] ?? ""}
                          onChange={(e) => {
                            const valor = e.target.value;
                            setImeiTipeado((prev) => {
                              const lista = [...(prev[linea.varianteId] ?? [])];
                              lista[posicion] = valor;
                              return { ...prev, [linea.varianteId]: lista };
                            });
                          }}
                          onKeyDown={(e) => {
                            // El lector de códigos termina con Enter: no tiene
                            // que confirmar la venta a mitad de carga.
                            if (e.key === "Enter") e.preventDefault();
                          }}
                          placeholder={
                            casillas > 1
                              ? `IMEI del aparato ${posicion + 1}`
                              : "Escaneá o escribí el IMEI"
                          }
                          aria-label={`IMEI del aparato ${posicion + 1}`}
                          className="h-11 font-mono text-sm"
                          disabled={aceptada}
                          autoComplete="off"
                        />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        La cantidad no es entera: no hay a qué aparato atar
                        cada número.
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
                    {aceptada && (
                      <MotivoSinImeiField
                        idBase={`motivo-${linea.varianteId}`}
                        eleccion={motivos[linea.varianteId]}
                        onChange={(e) => elegirMotivo(linea.varianteId, e)}
                      />
                    )}
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
                disabled={
                  !todasElegidas ||
                  !sinImeiResueltas ||
                  !parcialesResueltas ||
                  guardando
                }
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
