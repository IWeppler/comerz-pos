"use client";

import { useEffect, useState } from "react";
import { Barcode, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import { normalizarImei } from "@/entities/ventas/imei";
import {
  agregarUnidadSerieAction,
  quitarUnidadSerieAction,
} from "../../actions/unidades-serie";
import { getSerieDeProductoAction } from "../../actions/get-serie-producto";
import { CorregirVarianteForm } from "./corregir-variante-form";

/**
 * "Lleva IMEI / número de serie" y los números de cada aparato.
 *
 * Existe porque los IMEI solo entraban por remito o planilla: un celular
 * cargado a mano no tenía dónde recibir el suyo, y el ticket —el papel con el
 * que el cliente reclama la garantía— salía sin IMEI.
 *
 * En la EDICIÓN los números se guardan al momento, uno por uno, con sus
 * propias actions: no viajan con "Guardar cambios". Así un IMEI mal tipeado no
 * voltea el guardado del producto y el guardado no puede pisar lo que otra
 * persona cargó mientras tanto. El tilde sí viaja con el formulario (input
 * oculto `lleva_serie`), y SOLO una vez leído el valor real: la action mira
 * `has()`, así que mientras carga no se pisa nada.
 *
 * En el ALTA no hay variante todavía: los números van en un textarea y los
 * inserta la action después de crear la variante única.
 */
type ProductSerieSectionProps =
  | {
      modo: "alta";
      /** Con variantes no hay a qué variante atar cada número: se cargan
       * después, desde la edición. */
      conVariantes: boolean;
    }
  | {
      modo: "edicion";
      productoId: string;
      /** Las variantes GUARDADAS: una recién agregada no tiene id todavía. */
      variantes: VarianteFicha[];
      /** Una variante se corrigió o se juntó con otra: el formulario quedó
       * viejo y hay que recargarlo antes de que alguien lo guarde. */
      onVariantesCambiaron: () => void;
    };

type VarianteFicha = {
  id: string;
  nombre_display: string;
  atributos: Record<string, string>;
};

export function ProductSerieSection(props: Readonly<ProductSerieSectionProps>) {
  if (props.modo === "alta") {
    return <SerieAlta conVariantes={props.conVariantes} />;
  }
  return (
    <SerieEdicion
      productoId={props.productoId}
      variantes={props.variantes}
      onVariantesCambiaron={props.onVariantesCambiaron}
    />
  );
}

function Encabezado({
  activo,
  onActivoChange,
  disabled,
  porCategoria,
}: Readonly<{
  activo: boolean;
  onActivoChange: (v: boolean) => void;
  disabled?: boolean;
  /** Lo pide la categoría: prendido y sin poder apagarse desde acá. */
  porCategoria?: boolean;
}>) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 md:p-5">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-muted/30 rounded-md border border-border/50">
          <Barcode className="w-4 h-4 text-muted-foreground" />
        </div>
        <div>
          <p className="font-bold text-sm">Lleva IMEI / número de serie</p>
          <p className="text-xs text-muted-foreground">
            {porCategoria
              ? "Lo pide su categoría: el POS lo exige al vender. Se cambia en Configuración › Categorías."
              : "Sale en el ticket y el POS lo pide al vender."}
          </p>
        </div>
      </div>
      <Switch
        checked={activo || Boolean(porCategoria)}
        onCheckedChange={onActivoChange}
        disabled={disabled || porCategoria}
        aria-label="Lleva IMEI o número de serie"
      />
    </div>
  );
}

function SerieAlta({ conVariantes }: Readonly<{ conVariantes: boolean }>) {
  const [activo, setActivo] = useState(false);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <input type="hidden" name="lleva_serie" value={String(activo)} />
      <Encabezado activo={activo} onActivoChange={setActivo} />
      {activo && (
        <div className="px-3 md:px-5 pb-5 pt-3 border-t border-border/50 space-y-2">
          {conVariantes ? (
            <p className="text-xs text-muted-foreground">
              Con variantes, los IMEI se cargan desde la edición del producto
              una vez creado: cada número va con su variante.
            </p>
          ) : (
            <>
              <Label className="text-xs font-semibold text-muted-foreground">
                IMEI de los aparatos en stock (uno por línea, opcional)
              </Label>
              <Textarea
                name="imeis_iniciales"
                rows={3}
                placeholder={"355397377423083\n868870074774347"}
                className="font-mono text-sm shadow-none"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

type UnidadFicha = { id: string; imei: string; estado: string };

function SerieEdicion({
  productoId,
  variantes,
  onVariantesCambiaron,
}: Readonly<{
  productoId: string;
  variantes: VarianteFicha[];
  onVariantesCambiaron: () => void;
}>) {
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);
  const [activo, setActivo] = useState(false);
  const [porCategoria, setPorCategoria] = useState(false);
  const [unidades, setUnidades] = useState<Record<string, UnidadFicha[]>>({});
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    getSerieDeProductoAction(productoId).then((res) => {
      if (cancelado) return;
      if (res.error) toast.error(res.error);
      setActivo(res.llevaSerie);
      setPorCategoria(res.porCategoria);
      setUnidades(res.unidadesPorVariante);
      setCargado(true);
    });
    return () => {
      cancelado = true;
    };
  }, [productoId]);

  const agregar = async (varianteId: string) => {
    const imei = normalizarImei(borrador[varianteId]);
    if (!imei) return;
    setOcupado(varianteId);
    const res = await agregarUnidadSerieAction(varianteId, imei);
    setOcupado(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setUnidades((prev) => ({
      ...prev,
      [varianteId]: [
        ...(prev[varianteId] ?? []),
        { id: res.unidad.id, imei: res.unidad.imei, estado: "disponible" },
      ],
    }));
    setBorrador((prev) => ({ ...prev, [varianteId]: "" }));
    // Cargar un número prende la marca en la base (trigger); se refleja acá
    // para que el guardado del formulario no la vuelva a apagar.
    setActivo(true);
  };

  const quitar = async (varianteId: string, unidadId: string) => {
    setOcupado(unidadId);
    const res = await quitarUnidadSerieAction(unidadId);
    setOcupado(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setUnidades((prev) => ({
      ...prev,
      [varianteId]: (prev[varianteId] ?? []).filter((u) => u.id !== unidadId),
    }));
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {cargado && (
        <input type="hidden" name="lleva_serie" value={String(activo)} />
      )}
      {/* El input oculto manda la marca PROPIA: si la pide la categoría, el
          producto no se marca solo por eso (sacarlo de la categoría lo
          libera). */}
      <Encabezado
        activo={activo}
        onActivoChange={setActivo}
        disabled={!cargado}
        porCategoria={porCategoria}
      />

      {!cargado && (
        <div className="flex items-center gap-2 px-5 pb-4 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Buscando números de serie...
        </div>
      )}

      {cargado && (activo || porCategoria) && (
        <div className="px-3 md:px-5 pb-5 pt-3 border-t border-border/50 space-y-4">
          {variantes.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Guardá el producto para poder cargar los IMEI de sus variantes.
            </p>
          )}
          {variantes.map((v) => {
            const lista = unidades[v.id] ?? [];
            const disponibles = lista.filter((u) => u.estado === "disponible");
            return (
              <div key={v.id} className="space-y-2">
                {(variantes.length > 1 || Object.keys(v.atributos).length > 0) && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">
                      {v.nombre_display}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {disponibles.length} disponible
                        {disponibles.length === 1 ? "" : "s"}
                      </span>
                    </p>
                    {/* Corregir un valor mal tipeado sin perder los IMEI: la
                        grilla de abajo lo leería como borrar y crear. */}
                    {Object.keys(v.atributos).length > 0 && corrigiendo !== v.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11 px-2 text-xs text-muted-foreground shrink-0"
                        onClick={() => setCorrigiendo(v.id)}
                      >
                        Corregir
                      </Button>
                    )}
                  </div>
                )}

                {corrigiendo === v.id && (
                  <CorregirVarianteForm
                    variante={v}
                    onCancelar={() => setCorrigiendo(null)}
                    onCorregida={() => {
                      setCorrigiendo(null);
                      onVariantesCambiaron();
                    }}
                  />
                )}

                {lista.length > 0 && (
                  <div className="divide-y divide-border/60 rounded-lg border border-border/60">
                    {lista.map((u) => {
                      const disponible = u.estado === "disponible";
                      return (
                        <div
                          key={u.id}
                          className="flex items-center justify-between gap-3 px-3 min-h-11"
                        >
                          <span
                            className={`font-mono text-xs ${disponible ? "" : "text-muted-foreground line-through"}`}
                          >
                            {u.imei}
                          </span>
                          {disponible ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-11 w-11 text-muted-foreground hover:text-danger"
                              onClick={() => quitar(v.id, u.id)}
                              disabled={ocupado === u.id}
                              aria-label={`Quitar IMEI ${u.imei}`}
                            >
                              {ocupado === u.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <X className="w-4 h-4" />
                              )}
                            </Button>
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              {u.estado === "baja" ? "De baja" : "Vendido"}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    value={borrador[v.id] ?? ""}
                    onChange={(e) =>
                      setBorrador((prev) => ({ ...prev, [v.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      // Enter agrega el número y no manda el formulario: el
                      // lector de códigos de barras termina cada lectura con
                      // Enter, y guardar el producto a mitad de carga es lo
                      // último que se quiere.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void agregar(v.id);
                      }
                    }}
                    placeholder="Escaneá o escribí el IMEI"
                    className="h-11 font-mono text-sm shadow-none"
                    inputMode="text"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0 shadow-none"
                    onClick={() => agregar(v.id)}
                    disabled={ocupado === v.id || !normalizarImei(borrador[v.id])}
                  >
                    {ocupado === v.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    <span className="ml-1">Agregar</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
