"use client";

import { useState } from "react";
import { PackagePlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Button } from "@/shared/ui/button";
import { ProductCategorySection } from "@/features/stock/ui/create-product/product-category-section";
import { ProductVariantsSection } from "@/features/stock/ui/create-product/product-variants-section";
import { useCategoriasProducto } from "@/features/stock/hooks/use-categorias-producto";
import { useVariantSelection } from "@/features/stock/hooks/use-variant-selection";
import type { Opcion, VarianteInput } from "@/features/stock/types";
import { parsearCantidadDeEntrada } from "@/shared/lib/unidad-venta";
import type { LineaCargaNueva } from "../types";
import { prefillAVariantes, type PrefillMaestro } from "../lib/maestro-prefill";
import { Sparkles } from "lucide-react";

interface AltaRapidaPendiente {
  nombrePrefill: string;
  codigoPrefill: string;
  queryOriginal: string;
  /** No-null cuando se reabre el modal para editar una línea NUEVA ya
   * agregada (hoy solo pasa con líneas con variantes: no hay "cantidad"
   * única para sumar con un simple +1 al reescanear). */
  editando: LineaCargaNueva | null;
  /** No-null cuando el EAN matcheó en el Catálogo Maestro. */
  maestro: PrefillMaestro | null;
}

type DatosGuardar = {
  nombre: string;
  codigo: string;
  marca: string;
  modelo: string;
  categoriaId: string;
  precioCompra: number;
  precioVenta: number;
  editandoLineaId: string | null;
} & (
  | { tieneVariantes: false; cantidad: number }
  | { tieneVariantes: true; opciones: Opcion[]; variantes: VarianteInput[] }
);

interface CargaRapidaQuickCreateModalProps {
  altaRapida: AltaRapidaPendiente | null;
  recargoGlobal: number | "";
  onCancelar: () => void;
  onGuardar: (datos: DatosGuardar) => void;
}

export function CargaRapidaQuickCreateModal({
  altaRapida,
  recargoGlobal,
  onCancelar,
  onGuardar,
}: Readonly<CargaRapidaQuickCreateModalProps>) {
  const isOpen = altaRapida !== null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancelar()}>
      {isOpen ? (
        <CargaRapidaQuickCreateModalContent
          key={altaRapida.editando?.clienteLineaId ?? altaRapida.queryOriginal}
          altaRapida={altaRapida}
          recargoGlobal={recargoGlobal}
          onGuardar={onGuardar}
        />
      ) : null}
    </Dialog>
  );
}

function CargaRapidaQuickCreateModalContent({
  altaRapida,
  recargoGlobal,
  onGuardar,
}: Readonly<{
  altaRapida: AltaRapidaPendiente;
  recargoGlobal: number | "";
  onGuardar: CargaRapidaQuickCreateModalProps["onGuardar"];
}>) {
  const editando = altaRapida.editando;
  const maestro = altaRapida.maestro;
  const categorias = useCategoriasProducto();

  // Del maestro sale UNA combinación concreta (128GB / 4GB / Black), así que
  // el alta arranca ya en modo variantes con esa fila cargada y el EAN como
  // sku. Se calcula una sola vez: el modal se remonta por `key` cuando
  // cambia el alta, así que no hace falta re-sincronizar por efecto.
  const [prefillVariantes] = useState(() =>
    maestro ? prefillAVariantes(maestro) : null,
  );
  const tienePrefillDeVariantes =
    prefillVariantes !== null && prefillVariantes.opciones.length > 0;

  const [nombre, setNombre] = useState(
    editando?.nombre ?? altaRapida.nombrePrefill,
  );
  const [codigo, setCodigo] = useState(
    editando?.codigo ?? altaRapida.codigoPrefill,
  );
  const [marca, setMarca] = useState(editando?.marca ?? maestro?.marca ?? "");
  const [modelo, setModelo] = useState(
    editando?.modelo ?? maestro?.modelo ?? "",
  );
  const [categoriaId, setCategoriaId] = useState(
    editando?.categoriaId ?? maestro?.categoriaId ?? "",
  );
  const [cantidad, setCantidad] = useState(
    editando && !editando.tieneVariantes ? String(editando.cantidad) : "1",
  );
  const [precioCompra, setPrecioCompra] = useState(
    editando ? String(editando.precioCompra) : "",
  );
  const [precioVenta, setPrecioVenta] = useState(
    editando ? String(editando.precioVenta) : "",
  );
  const [showVariantes, setShowVariantes] = useState(
    editando?.tieneVariantes ?? tienePrefillDeVariantes,
  );
  const variantSelection = useVariantSelection(
    editando?.tieneVariantes
      ? {
          initialOpciones: editando.opciones,
          initialVariantes: editando.variantes,
        }
      : tienePrefillDeVariantes
        ? {
            initialOpciones: prefillVariantes.opciones,
            initialVariantes: prefillVariantes.variantes,
          }
        : undefined,
  );

  // Al reeditar una línea por peso, `parseInt("0.5")` daría 0 y el modal la
  // rechazaría; la unidad se elige en la fila, acá solo se respeta el número.
  const cantidadNum = parsearCantidadDeEntrada(cantidad);
  const precioCompraNum = Number.parseFloat(precioCompra);
  const precioVentaNum = Number.parseFloat(precioVenta);
  const precioVentaCargado =
    Number.isFinite(precioVentaNum) && precioVentaNum > 0;
  const recargoValido = recargoGlobal !== "" && Number(recargoGlobal) >= 0;

  // Precio de venta calculado por recargo global — mismo cálculo que
  // "Aplicar recargo global" en la conciliación de remitos
  // (features/purchases/ui/merge-table.tsx), sin duplicar un valor de
  // config: acá el % se tipea por sesión, no se persiste.
  const precioVentaCalculado =
    !precioVentaCargado && recargoValido && Number.isFinite(precioCompraNum)
      ? Math.ceil(precioCompraNum * (1 + Number(recargoGlobal) / 100))
      : null;

  const variantesValidas =
    variantSelection.duplicatePropertyNames.size === 0 &&
    variantSelection.genericPropertyNames.size === 0 &&
    variantSelection.variantes.length > 0;

  const esValido =
    nombre.trim().length > 0 &&
    Number.isFinite(precioCompraNum) &&
    precioCompraNum > 0 &&
    (precioVentaCargado || precioVentaCalculado !== null) &&
    (showVariantes
      ? variantesValidas
      : Number.isFinite(cantidadNum) && cantidadNum > 0);

  const handleSubmit = () => {
    if (!esValido) return;
    const precioVentaFinal = precioVentaCargado
      ? precioVentaNum
      : (precioVentaCalculado as number);
    const comunes = {
      nombre: nombre.trim(),
      codigo,
      marca,
      modelo,
      categoriaId,
      precioCompra: precioCompraNum,
      precioVenta: precioVentaFinal,
      editandoLineaId: editando?.clienteLineaId ?? null,
    };
    onGuardar(
      showVariantes
        ? {
            ...comunes,
            tieneVariantes: true,
            opciones: variantSelection.opciones,
            variantes: variantSelection.variantes,
          }
        : { ...comunes, tieneVariantes: false, cantidad: cantidadNum },
    );
  };

  return (
    <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-card border-border">
      <DialogHeader className="p-5 pb-3 border-b border-border bg-muted/20">
        <DialogTitle className="flex items-center gap-2 text-lg font-bold">
          <PackagePlus className="w-5 h-5 text-primary" />
          {editando ? "Editar variantes" : "Producto nuevo"}
        </DialogTitle>
        <p className="text-sm text-muted-foreground mt-1">
          {(() => {
            if (editando) {
              return "Ajustá las combinaciones y el stock antes de confirmar la carga.";
            }
            if (maestro) {
              return "Encontrado en el Catálogo Maestro";
            }
            return "No se encontró en el catálogo — completá lo básico para recibirlo.";
          })()}
        </p>
      </DialogHeader>

      <div className="p-2 space-y-4 max-h-[70vh] overflow-y-auto">
        <div className="space-y-1.5">
          <Label>Nombre</Label>
          <Input
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del producto"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Código / SKU (opcional)</Label>
          <Input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Código de barras o del proveedor"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Marca (opcional)</Label>
            <Input
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              placeholder="Marca"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Modelo (opcional)</Label>
            <Input
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              placeholder="Modelo oficial"
            />
          </div>
        </div>

        <ProductCategorySection
          categorias={categorias}
          categoriaSeleccionada={categoriaId}
          onCategoriaSeleccionadaChange={setCategoriaId}
        />

        <div
          className={
            showVariantes ? "grid grid-cols-2 gap-3" : "grid grid-cols-3 gap-3"
          }
        >
          {!showVariantes && (
            <div className="space-y-1.5">
              <Label>Cantidad</Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>$ Compra</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={precioCompra}
              onChange={(e) => setPrecioCompra(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>$ Venta</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={precioVenta}
              onChange={(e) => setPrecioVenta(e.target.value)}
              placeholder={
                precioVentaCalculado !== null
                  ? String(precioVentaCalculado)
                  : undefined
              }
            />
          </div>
        </div>

        {precioVentaCalculado !== null ? (
          <p className="text-xs text-muted-foreground -mt-2">
            Se calcula con el {recargoGlobal}% de recargo global: $
            {precioVentaCalculado.toLocaleString("es-AR")}
          </p>
        ) : null}

        {showVariantes ? (
          <p className="text-xs text-muted-foreground -mt-2">
            $ Compra / $ Venta de arriba son el precio base del producto
          </p>
        ) : null}

        <ProductVariantsSection
          showVariants={showVariantes}
          onShowVariantsChange={setShowVariantes}
          opciones={variantSelection.opciones}
          resetOpciones={() => variantSelection.setOpciones([])}
          customTypeMode={variantSelection.customTypeMode}
          setCustomTypeMode={variantSelection.setCustomTypeMode}
          focusedOptionId={variantSelection.focusedOptionId}
          setFocusedOptionId={variantSelection.setFocusedOptionId}
          precioVenta={precioVenta}
          variantes={variantSelection.variantes}
          duplicatePropertyNames={variantSelection.duplicatePropertyNames}
          genericPropertyNames={variantSelection.genericPropertyNames}
          handleAddOption={variantSelection.handleAddOption}
          handleRemoveOption={variantSelection.handleRemoveOption}
          handleUpdateOptionName={variantSelection.handleUpdateOptionName}
          handleAddOptionValue={variantSelection.handleAddOptionValue}
          handleRemoveOptionValue={variantSelection.handleRemoveOptionValue}
          handleVarChange={variantSelection.handleVarChange}
          ensureSuggestionsLoaded={variantSelection.ensureSuggestionsLoaded}
          isLoadingSuggestions={variantSelection.isLoadingSuggestions}
          getFilteredSuggestions={variantSelection.getFilteredSuggestions}
          baseVariants={variantSelection.baseVariants}
          selectedCombinations={variantSelection.selectedCombinations}
          onToggleCombination={variantSelection.handleToggleCombination}
          onBulkSetSelection={variantSelection.handleBulkSetSelection}
          onInvertSelection={variantSelection.handleInvertSelection}
          pivotSelections={variantSelection.pivotSelections}
          onPivotChange={variantSelection.handlePivotChange}
          atributosExistentes={variantSelection.atributosExistentes}
        />
      </div>

      <div className="p-4 border-t border-border bg-card">
        <Button
          type="button"
          className="w-full h-12"
          disabled={!esValido}
          onClick={handleSubmit}
        >
          {editando ? "Guardar cambios" : "Agregar a la lista"}
        </Button>
      </div>
    </DialogContent>
  );
}
