"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/shared/config/supabase/client";
import {
  ImagenError,
  optimizarImagenesProducto,
} from "@/shared/utils/image-optimizer";
import { crearProductoAction } from "../actions/create-product";
import { esErrorDeRed, mensajeErrorDeRed } from "@/shared/lib/error-de-red";
import { subirImagenesProductoDesdeCliente } from "../lib/subir-imagenes-cliente";
import type { UrlsImagenesProducto } from "../lib/imagenes-producto-comun";
import { MAX_IMAGENES_PRODUCTO } from "@/shared/utils/limites-imagen";
import { controlarPayloadDeAction } from "@/shared/lib/tamano-payload";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useVariantSelection } from "./use-variant-selection";
import { queryKeys } from "@/shared/lib/query-keys";
import {
  marcarFinOperacion,
  marcarInicioOperacion,
} from "@/shared/lib/breadcrumb-carga";
import type {
  CategoriaOption,
  ProductActionState,
} from "@/features/stock/types";

/** Apertura controlada desde afuera. Sirve para montar UNA sola instancia del
 * sheet y dispararla desde varios botones (ej: el botón de la toolbar en
 * desktop y el ítem del dropdown en mobile) sin duplicar el hook — que trae
 * su propio fetch de categorías y su propio useActionState. */
type ControlDeApertura = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function useCreateProductForm(control?: ControlDeApertura) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isOpenInterno, setIsOpenInterno] = useState(false);
  const esControlado = control?.open !== undefined;
  const isOpen = esControlado ? control.open! : isOpenInterno;
  const negocioId = useNegocioActivo()?.id ?? null;
  const [archivos, setArchivos] = useState<File[]>([]);
  /**
   * Fotos YA subidas a Storage, esperando a que el producto exista.
   *
   * En el alta no hay a qué colgarlas todavía, así que no se pueden guardar en
   * el momento como en la edición. Lo que sí se puede —y es de donde sale casi
   * toda la mejora— es SUBIRLAS apenas se eligen: para cuando toca Guardar,
   * los bytes ya viajaron y lo único que falta es un POST de unas pocas URLs.
   */
  const [urlsSubidas, setUrlsSubidas] = useState<UrlsImagenesProducto | null>(
    null,
  );
  const [isCompressing, setIsCompressing] = useState(false);

  const [showPrice, setShowPrice] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  /**
   * `null` = todavía nadie tocó el toggle de Variantes, así que lo decide la
   * categoría. Ver `showVariants` abajo.
   */
  const [variantesElegidoAMano, setVariantesElegidoAMano] = useState<
    boolean | null
  >(null);

  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [categorias, setCategorias] = useState<CategoriaOption[]>([]);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState("");
  const [precioCosto, setPrecioCosto] = useState("");
  const [precioVenta, setPrecioVenta] = useState("");

  const variantSelection = useVariantSelection({
    categoriaId: categoriaSeleccionada,
  });

  /**
   * Si la sección Variantes está abierta.
   *
   * Cuando la categoría exige atributos (`categoria_atributos`) se abre SOLA, y
   * eso arregla un callejón sin salida real: en Estilo Bonito, "Ropa Bebe"
   * exige Género y sus 12 subcategorías lo heredan. `useVariantSelection` ya
   * agregaba la propiedad "Género" esperando valores — pero adentro de esta
   * sección, que estaba cerrada. El formulario quedaba con Guardar
   * deshabilitado ("Esta categoría exige valores...") y sin ningún campo donde
   * cargarlo. El 30/8/2026 le pasó cargando una campera de bebé.
   *
   * Se deriva en vez de prenderse con un efecto para que no haya un render
   * extra ni un setState en cascada, y sobre todo para que la elección MANUAL
   * siga mandando: quien apaga Variantes a propósito puede guardar igual — el
   * server tampoco exige el atributo en el camino sin variantes, así que
   * bloquearlo acá era la UI pidiendo algo que la base no pide.
   */
  const showVariants =
    variantesElegidoAMano ??
    variantSelection.atributosRequeridosNombres.size > 0;
  const setShowVariants = setVariantesElegidoAMano;

  useEffect(() => {
    const fetchCats = async () => {
      const supabase = createClient();
      // El árbol COMPLETO, no solo las raíces: los productos cuelgan de las
      // hojas y hasta acá no había forma de elegir una.
      const { data } = await supabase
        .from("categorias")
        .select("id, nombre, parent_id")
        .eq("activa", true)
        .order("orden")
        .order("nombre");

      if (data && data.length > 0) setCategorias(data);
    };

    fetchCats();
  }, []);

  const costoNum = parseFloat(precioCosto) || 0;
  const ventaNum = parseFloat(precioVenta) || 0;
  const gananciaNeta = ventaNum > costoNum ? ventaNum - costoNum : 0;
  const recargoPorcentaje =
    costoNum > 0 && gananciaNeta > 0
      ? ((gananciaNeta / costoNum) * 100).toFixed(1)
      : "0";

  // Todos los cierres del sheet pasan por acá (botón cancelar, flecha del
  // header y el cierre automático tras crear el producto), así que avisarle
  // al padre desde este único lugar alcanza para que no quede colgado.
  const handleOpenChange = (open: boolean) => {
    if (!esControlado) setIsOpenInterno(open);
    control?.onOpenChange?.(open);
    if (!open) {
      setArchivos([]);
      setUrlsSubidas(null);
      setShowPrice(false);
      setShowInventory(false);
      // Vuelve a "lo decide la categoría", no a "cerrado": el sheet siguiente
      // arranca sin categoría elegida, así que da cerrado igual.
      setVariantesElegidoAMano(null);
      setStatus("active");
      setCategoriaSeleccionada("");
      setPrecioCosto("");
      setPrecioVenta("");
      variantSelection.reset();
    }
  };

  const [, formAction, isPending] = useActionState(
    async (
      prevState: ProductActionState,
      formData: FormData,
    ): Promise<ProductActionState> => {
      formData.append("tieneVariantes", showVariants.toString());
      if (showVariants) {
        formData.append("opciones", JSON.stringify(variantSelection.opciones));
        formData.append(
          "variantes",
          JSON.stringify(variantSelection.variantes),
        );
      }

      // Mismo blindaje que en la edición: un corte de red subiendo fotos no
      // puede tumbar la app entera. Ver el comentario largo en edit-sheet.tsx.
      //
      // Diferencia importante con la edición: acá el reintento puede DUPLICAR.
      // `Failed to fetch` no distingue "no llegó" de "llegó y se perdió la
      // respuesta", así que el producto pudo haberse creado igual. Por eso el
      // mensaje avisa que revise antes de reintentar, en vez de invitar a
      // apretar Guardar otra vez a ciegas.
      let result: ProductActionState;
      try {
        result = await crearProductoAction(prevState, formData);
      } catch (error) {
        if (!esErrorDeRed(error)) throw error;

        const mensaje = `${mensajeErrorDeRed("crear el producto")} Antes de volver a guardarlo, fijate en la lista si quedó creado.`;
        toast.error(mensaje);
        return { error: mensaje, success: false };
      }

      if (result.success) {
        toast.success("Producto creado con éxito");
        if (result.aviso) toast.warning(result.aviso, { duration: 10000 });
        handleOpenChange(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });
        router.refresh();
      } else if (result.error) {
        toast.error(result.error);
      }

      return result;
    },
    { error: null, success: false },
  );

  /**
   * Comprime y sube las fotos apenas se eligen, sin esperar a Guardar.
   *
   * En el alta no se pueden "guardar" todavía —el producto no existe— pero sí
   * viajar: para cuando toca Guardar, los bytes ya están en Storage y el POST
   * es de unas pocas URLs. Si abandona el alta, esos archivos quedan
   * huérfanos; a este volumen es más barato que perderle la carga.
   */
  const subirFotosElegidas = async (nuevos: File[]) => {
    setArchivos(nuevos);

    if (nuevos.length === 0) {
      setUrlsSubidas(null);
      return;
    }

    if (!negocioId) return; // Sin negocio resuelto: se suben al guardar.

    setIsCompressing(true);
    marcarInicioOperacion("crear-producto:subir-fotos", {
      cantidadImagenes: nuevos.length,
      bytesTotales: nuevos.reduce((acc, f) => acc + f.size, 0),
    });

    try {
      const optimizadas = await optimizarImagenesProducto(
        nuevos.slice(0, MAX_IMAGENES_PRODUCTO),
      );
      const urls = await subirImagenesProductoDesdeCliente(
        negocioId,
        optimizadas,
        MAX_IMAGENES_PRODUCTO,
      );

      if (urls.mains.length === 0) {
        toast.error(mensajeErrorDeRed("subir las fotos"));
        return;
      }

      setUrlsSubidas(urls);
    } catch (error) {
      if (esErrorDeRed(error)) {
        toast.error(mensajeErrorDeRed("subir las fotos"));
        return;
      }
      toast.error(
        error instanceof ImagenError
          ? error.message
          : "No se pudieron procesar las fotos. Probá con una a la vez.",
      );
      setArchivos([]);
    } finally {
      setIsCompressing(false);
      marcarFinOperacion();
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    if (!precioVenta || !precioCosto) {
      setShowPrice(true);
      toast.error("Por favor completa los precios del producto.");
      return;
    }

    if (!showVariants && !formData.get("stockBase")) {
      setShowInventory(true);
      toast.error("Por favor indica el stock inicial.");
      return;
    }

    if (showVariants && variantSelection.duplicatePropertyNames.size > 0) {
      toast.error(
        "Resolvé los nombres de propiedad duplicados antes de guardar.",
      );
      return;
    }

    if (showVariants && variantSelection.genericPropertyNames.size > 0) {
      toast.error(
        "Renombrá las propiedades con nombre genérico (Propiedad/Opción) antes de guardar.",
      );
      return;
    }

    if (showVariants && variantSelection.missingRequiredAttributes.size > 0) {
      toast.error(
        "Esta categoría exige valores para uno o más atributos requeridos — completalos antes de guardar.",
      );
      return;
    }

    // Las fotos ya se subieron a Storage cuando se eligieron: acá solo viajan
    // sus URLs. Es lo que hace que el guardado sea un POST chico en vez de
    // varios MB que en el celular se mueren a mitad de camino.
    formData.delete("imagenes");
    formData.delete("thumbnails");
    formData.delete("grids");
    formData.delete("masters");

    if (urlsSubidas && urlsSubidas.mains.length > 0) {
      formData.append("imagenes_urls", JSON.stringify(urlsSubidas));
    } else if (archivos.length > 0) {
      // Red de seguridad: se eligieron fotos pero no llegaron a subir (no
      // había negocio resuelto al elegirlas). Se comprimen y viajan como
      // antes, en el mismo POST. Es más lento y más frágil, pero es mucho
      // mejor que crear el producto sin fotos sin decir nada.
      setIsCompressing(true);
      try {
        const optimizadas = await optimizarImagenesProducto(archivos);
        optimizadas.forEach(({ main, thumbnail, grid, master }) => {
          formData.append("imagenes", main);
          formData.append("thumbnails", thumbnail);
          formData.append("grids", grid);
          formData.append("masters", master);
        });
      } catch (error) {
        toast.error(
          error instanceof ImagenError
            ? error.message
            : "No se pudieron procesar las fotos.",
        );
        return;
      } finally {
        setIsCompressing(false);
      }
    }

    // Con la red de seguridad de arriba el POST puede volver a llevar los
    // binarios. Medirlo es lo que hace que, si un día se pasa del tope de la
    // plataforma, quede en el log con los campos culpables en vez de aparecer
    // como una pantalla rota sin causa.
    controlarPayloadDeAction("crear-producto:guardar", formData);

    startTransition(() => formAction(formData));
  };

  return {
    isOpen,
    handleOpenChange,
    archivos,
    setArchivos: subirFotosElegidas,
    isCompressing,
    showPrice,
    setShowPrice,
    showInventory,
    setShowInventory,
    showVariants,
    setShowVariants,
    status,
    setStatus,
    categorias,
    categoriaSeleccionada,
    setCategoriaSeleccionada,
    precioCosto,
    setPrecioCosto,
    precioVenta,
    setPrecioVenta,
    gananciaNeta,
    recargoPorcentaje,
    opciones: variantSelection.opciones,
    setOpciones: variantSelection.setOpciones,
    customTypeMode: variantSelection.customTypeMode,
    setCustomTypeMode: variantSelection.setCustomTypeMode,
    focusedOptionId: variantSelection.focusedOptionId,
    setFocusedOptionId: variantSelection.setFocusedOptionId,
    variantes: variantSelection.variantes,
    baseVariants: variantSelection.baseVariants,
    selectedCombinations: variantSelection.selectedCombinations,
    pivotSelections: variantSelection.pivotSelections,
    duplicatePropertyNames: variantSelection.duplicatePropertyNames,
    genericPropertyNames: variantSelection.genericPropertyNames,
    isPending,
    handleSubmit,
    handleAddOption: variantSelection.handleAddOption,
    handleRemoveOption: variantSelection.handleRemoveOption,
    handleUpdateOptionName: variantSelection.handleUpdateOptionName,
    handleAddOptionValue: variantSelection.handleAddOptionValue,
    handleRemoveOptionValue: variantSelection.handleRemoveOptionValue,
    handleVarChange: variantSelection.handleVarChange,
    handleToggleCombination: variantSelection.handleToggleCombination,
    handleBulkSetSelection: variantSelection.handleBulkSetSelection,
    handleInvertSelection: variantSelection.handleInvertSelection,
    handlePivotChange: variantSelection.handlePivotChange,
    ensureSuggestionsLoaded: variantSelection.ensureSuggestionsLoaded,
    isLoadingSuggestions: variantSelection.isLoadingSuggestions,
    getFilteredSuggestions: variantSelection.getFilteredSuggestions,
    atributosExistentes: variantSelection.atributosExistentes,
    atributosRequeridos: variantSelection.atributosRequeridos,
    atributosRequeridosNombres: variantSelection.atributosRequeridosNombres,
    missingRequiredAttributes: variantSelection.missingRequiredAttributes,
  };
}
