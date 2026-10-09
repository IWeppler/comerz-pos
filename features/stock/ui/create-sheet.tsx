"use client";

import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";
import { useCreateProductForm } from "../hooks/use-create-product-form";
import { CreateProductFooter } from "./create-product/create-product-footer";
import { ProductBasicInfoSection } from "./create-product/product-basic-info-section";
import { ProductCategorySection } from "./create-product/product-category-section";
import { ProductInventorySection } from "./create-product/product-inventory-section";
import { ProductMediaSection } from "./create-product/product-media-section";
import { ProductTramosSection } from "./create-product/product-tramos-section";
import { ProductPriceSection } from "./create-product/product-price-section";
import { ProductVariantsSection } from "./create-product/product-variants-section";
import { ProductFiscalSection } from "./create-product/product-fiscal-section";
import { ProductSerieSection } from "./create-product/product-serie-section";
import { defaultsFiscalesPorRubro } from "@/shared/lib/fiscal-producto";
import type { Rubro } from "@/entities/config/types";
import { textoAtributosFaltantes } from "@/features/stock/utils/texto-atributos-faltantes";

interface CrearProductoSheetProps {
  /** Apertura controlada por el padre. Omitir = el sheet se maneja solo con
   * su propio trigger (uso original: dashboard). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Para cuando el/los botón/es que abren el sheet viven en otro lado. */
  hideTrigger?: boolean;
  /** Decide con qué unidad y alícuota nace el producto. Omitirlo cae al
   * default general (unidad + 21%), igual que el server. */
  rubro?: Rubro;
}

export function CrearProductoSheet({
  open,
  onOpenChange,
  hideTrigger = false,
  rubro,
}: Readonly<CrearProductoSheetProps> = {}) {
  const form = useCreateProductForm({ open, onOpenChange });
  const defaultsFiscales = defaultsFiscalesPorRubro(rubro);

  return (
    <>
      <Sheet open={form.isOpen} onOpenChange={form.handleOpenChange}>
        {!hideTrigger && (
          <SheetTrigger asChild>
            <Button variant="ghost">
              <Plus className="w-4 h-4 mr-2" />
              <span className="hidden md:flex">Nuevo Producto</span>
            </Button>
          </SheetTrigger>
        )}

        <SheetContent
          side="right"
          size="wide"
          className="w-full sm:w-3xl! p-0 flex flex-col h-dvh bg-card border-l border-border"
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onFocusOutside={(event) => event.preventDefault()}
        >
          <SheetHeader className="px-8 py-5 border-b border-border bg-card shrink-0 flex-row items-center justify-between shadow-none z-10 space-y-0">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => form.handleOpenChange(false)}
                className="h-8 w-8 -ml-2 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <SheetTitle className="text-xl font-bold text-foreground m-0">
                Crear Producto
              </SheetTitle>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto min-h-0 px-2 md:px-8 py-4">
            <form
              onSubmit={form.handleSubmit}
              id="create-product-form"
              className="max-w-3xl mx-auto space-y-6"
            >
              <ProductMediaSection
                archivos={form.archivos}
                onArchivosChange={form.setArchivos}
              />

              {/* Marca y código van acá, y la EDICIÓN muestra exactamente lo
                  mismo: identifican al producto, así que se cargan donde se
                  lo nombra. Los dos son opcionales y el producto nace igual
                  sin ellos. El código solo cuando no hay variantes: con
                  variantes, cada fila de la grilla trae el suyo. */}
              <ProductBasicInfoSection
                status={form.status}
                onStatusChange={form.setStatus}
                mostrarMarca
                mostrarSku={!form.showVariants}
                rubro={rubro}
                categoriaId={form.categoriaSeleccionada}
              />

              <ProductCategorySection
                categorias={form.categorias}
                categoriaSeleccionada={form.categoriaSeleccionada}
                onCategoriaSeleccionadaChange={form.setCategoriaSeleccionada}
              />

              <ProductPriceSection
                showPrice={form.showPrice}
                onShowPriceChange={form.setShowPrice}
                precioCosto={form.precioCosto}
                onPrecioCostoChange={form.setPrecioCosto}
                precioVenta={form.precioVenta}
                onPrecioVentaChange={form.setPrecioVenta}
                gananciaNeta={form.gananciaNeta}
                recargoPorcentaje={form.recargoPorcentaje}
              />

              <ProductTramosSection precioHabitual={form.precioVenta} />

              {/* La unidad va acá: en una verdulería o una fiambrería, que
                  el producto se venda por kilo es lo primero que hay que
                  poder decir, y estaba escondido en el bloque fiscal. */}
              <ProductInventorySection
                showVariants={form.showVariants}
                showInventory={form.showInventory}
                onShowInventoryChange={form.setShowInventory}
                unidadMedida={defaultsFiscales.unidad_medida}
              />

              {rubro === "electro" && (
                <ProductSerieSection
                  modo="alta"
                  conVariantes={form.showVariants}
                />
              )}

              <ProductVariantsSection
                showVariants={form.showVariants}
                onShowVariantsChange={form.setShowVariants}
                opciones={form.opciones}
                resetOpciones={() => form.setOpciones([])}
                customTypeMode={form.customTypeMode}
                setCustomTypeMode={form.setCustomTypeMode}
                focusedOptionId={form.focusedOptionId}
                setFocusedOptionId={form.setFocusedOptionId}
                precioVenta={form.precioVenta}
                variantes={form.variantes}
                duplicatePropertyNames={form.duplicatePropertyNames}
                genericPropertyNames={form.genericPropertyNames}
                handleAddOption={form.handleAddOption}
                handleRemoveOption={form.handleRemoveOption}
                handleUpdateOptionName={form.handleUpdateOptionName}
                handleAddOptionValue={form.handleAddOptionValue}
                handleRemoveOptionValue={form.handleRemoveOptionValue}
                handleVarChange={form.handleVarChange}
                ensureSuggestionsLoaded={form.ensureSuggestionsLoaded}
                isLoadingSuggestions={form.isLoadingSuggestions}
                getFilteredSuggestions={form.getFilteredSuggestions}
                baseVariants={form.baseVariants}
                selectedCombinations={form.selectedCombinations}
                onToggleCombination={form.handleToggleCombination}
                onBulkSetSelection={form.handleBulkSetSelection}
                onInvertSelection={form.handleInvertSelection}
                pivotSelections={form.pivotSelections}
                onPivotChange={form.handlePivotChange}
                atributosExistentes={form.atributosExistentes}
              />

              {/* Última y colapsada: el alta típica no la abre nunca y el
                  producto igual nace con los defaults del rubro. */}
              <ProductFiscalSection defaults={defaultsFiscales} />
            </form>
          </div>

          {/* Los tres frenos son de la grilla de variantes, así que ninguno
              aplica con la sección cerrada — es la misma condición que ya usaba
              `handleSubmit`, y la que faltaba acá dejaba el botón muerto sin
              ningún campo donde resolver el problema. El de atributos además
              dice CUÁL falta: "exige uno o más atributos requeridos" no le dice
              a nadie qué completar. */}
          <CreateProductFooter
            isPending={form.isPending}
            isCompressing={form.isCompressing}
            onCancel={() => form.handleOpenChange(false)}
            blockedReason={
              !form.showVariants
                ? null
                : form.duplicatePropertyNames.size > 0
                  ? "Resolvé los nombres de propiedad duplicados antes de guardar."
                  : form.genericPropertyNames.size > 0
                    ? "Renombrá las propiedades con nombre genérico (Propiedad/Opción) antes de guardar."
                    : form.missingRequiredAttributes.size > 0
                      ? `Completá ${textoAtributosFaltantes(form.atributosRequeridos, form.missingRequiredAttributes)} en Variantes: esta categoría lo exige.`
                      : null
            }
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
