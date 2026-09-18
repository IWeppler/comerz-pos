"use client";

import { QuickAddModal } from "@/features/pos/ui/quick-add-modal";
import { Button } from "@/shared/ui/button";
import type { useCargaRapida } from "../hooks/use-carga-rapida";
import { CargaRapidaLista } from "./carga-rapida-lista";
import { CargaRapidaProductoPicker } from "./carga-rapida-producto-picker";
import { CargaRapidaMaestroPicker } from "./carga-rapida-maestro-picker";
import { CargaRapidaQuickCreateModal } from "./carga-rapida-quick-create-modal";

export type EstadoCargaRapida = ReturnType<typeof useCargaRapida>;

/**
 * El cuerpo de la Carga rápida: la lista de líneas y todos sus modales.
 *
 * NO trae el campo de texto. Quién escribe cambia según dónde vive la Carga
 * rápida — en Inventario es su propio input, en el POS es el mismo buscador
 * de la barra superior — pero el flujo y la lógica son los mismos en los dos
 * lados, porque los dos consumen `useCargaRapida`.
 */
export function CargaRapidaPanel({
  carga,
}: Readonly<{ carga: EstadoCargaRapida }>) {
  return (
    <>
      <CargaRapidaLista
        rubro={carga.rubro}
        lineas={carga.lineas}
        onUpdateCantidad={carga.updateCantidad}
        onUpdateUnidad={carga.updateUnidadLinea}
        onUpdateForma={carga.updateFormaLinea}
        onUpdatePrecio={carga.updatePrecioLinea}
        onUpdateTexto={carga.updateTextoLinea}
        onVolverAlBuscador={carga.enfocarBuscador}
        focoPendiente={carga.focoPendiente}
        onFocoAplicado={carga.onFocoAplicado}
        onRemove={carga.removeLinea}
        onEditarNueva={carga.onEditarLineaNueva}
        onConfirmar={carga.confirmar}
        isConfirming={carga.isConfirming}
      />

      <CargaRapidaProductoPicker
        candidatos={carga.pickerCandidatos}
        onCancelar={carga.onCancelarPicker}
        onSeleccionar={carga.onSeleccionarProducto}
      />

      <QuickAddModal
        producto={carga.variantSelectorProducto}
        isOpen={carga.variantSelectorProducto !== null}
        onClose={carga.onCerrarVariantSelector}
        permitirVentaSinStock
        onSelectVariante={carga.onSeleccionarVariante}
      />

      <CargaRapidaMaestroPicker
        candidatos={carga.maestroCandidatos?.lista ?? null}
        query={carga.maestroCandidatos?.query ?? ""}
        resolviendoId={carga.resolviendoCandidato}
        onElegir={carga.onElegirCandidatoMaestro}
        onCargarManual={carga.onCargarManualDesdeMaestro}
      />

      <CargaRapidaQuickCreateModal
        altaRapida={carga.altaRapida}
        recargoGlobal={carga.recargoGlobal}
        onCancelar={carga.onCancelarAltaRapida}
        onGuardar={carga.onGuardarAltaRapida}
      />
    </>
  );
}

/** Control de recargo global. Vive aparte porque cada contexto lo ubica en un
 * lugar distinto: en Inventario va en el header, en el POS ocupa la fila de
 * las pills. */
export function CargaRapidaRecargo({
  carga,
}: Readonly<{ carga: EstadoCargaRapida }>) {
  const hayLineasNuevas = carga.lineas.some((l) => l.kind === "NUEVA");

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Recargo
      </span>
      <input
        type="number"
        min={0}
        step="1"
        placeholder="%"
        value={carga.recargoGlobal}
        onChange={(e) =>
          carga.setRecargoGlobal(e.target.value ? Number(e.target.value) : "")
        }
        className="w-20 h-8 rounded-md border border-border bg-background px-2 text-xs"
        title="Recargo global para calcular el precio de venta de productos nuevos. No se guarda, es solo para esta sesión."
        onKeyDown={(e) => {
          // Enter acá aplica: el input está fuera de la lista y quien lo tipea
          // ya tiene la mano en el teclado.
          if (e.key === "Enter") {
            e.preventDefault();
            carga.aplicarRecargoGlobal();
          }
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 px-2.5 text-xs"
        // Sin líneas nuevas no hay nada que recalcular; sin porcentaje
        // tampoco. Deshabilitado antes que un toast de error evitable.
        disabled={carga.recargoGlobal === "" || !hayLineasNuevas}
        onClick={carga.aplicarRecargoGlobal}
        title="Recalcula el precio de venta de las líneas nuevas: costo + recargo. Pisa los precios de venta ya cargados."
      >
        Aplicar
      </Button>
    </div>
  );
}
