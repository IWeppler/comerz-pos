"use client";

import { parsearCantidadDeEntrada } from "@/shared/lib/unidad-venta";
import { esErrorDeRed, mensajeErrorDeRed } from "@/shared/lib/error-de-red";
import { subirImagenesProductoDesdeCliente } from "../lib/subir-imagenes-cliente";
import { controlarPayloadDeAction } from "@/shared/lib/tamano-payload";
import { MAX_IMAGENES_PRODUCTO } from "@/shared/utils/limites-imagen";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { FormEvent } from "react";
import { useSlugNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Producto, ProductoIndice } from "@/entities/productos/types";
import type { Rubro } from "@/entities/config/types";
import { Button } from "@/shared/ui/button";
import { createClient } from "@/shared/config/supabase/client";
import {
  ImagenError,
  optimizarImagenesProducto,
} from "@/shared/utils/image-optimizer";
import {
  marcarFinOperacion,
  marcarInicioOperacion,
} from "@/shared/lib/breadcrumb-carga";
import { parseProductImages } from "../lib/stock-product-utils";
import { queryKeys } from "@/shared/lib/query-keys";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";
import {
  editarProductoAction,
  type EditarProductoResult,
} from "../actions/edit-product";
import { getStockDetalleProductoAction } from "../actions/get-product";
import { actualizarFotosProductoAction } from "../actions/actualizar-fotos-producto";
import { useVariantSelection } from "../hooks/use-variant-selection";
import type { CategoriaOption } from "../types";
import {
  buildVariantKey,
  isSingleVariantProduct,
  parseLegacyVariant,
} from "../utils/parse-legacy-variant";
import { emparejarPorEsquema } from "../lib/emparejar-variantes-por-esquema";
import {
  ConfirmSaveVariantsModal,
  type VarianteDiffRow,
} from "./confirm-save-variants-modal";
import { CreateProductFooter } from "./create-product/create-product-footer";
import { ProductBasicInfoSection } from "./create-product/product-basic-info-section";
import { ProductCategorySection } from "./create-product/product-category-section";
import { ProductInventorySection } from "./create-product/product-inventory-section";
import { ProductMediaSection } from "./create-product/product-media-section";
import { ProductPriceSection } from "./create-product/product-price-section";
import { ProductVariantsSection } from "./create-product/product-variants-section";
import { ProductFiscalSection } from "./create-product/product-fiscal-section";
import { ProductListasSection } from "./create-product/product-listas-section";
import { ProductPresentacionesSection } from "./create-product/product-presentaciones-section";
import { ShareButton } from "@/shared/components/share-button";
import {
  construirUrlProducto,
  esVisibleEnCatalogo,
} from "@/shared/utils/compartir-catalogo";
import { getTotalStock } from "../lib/stock-product-utils";
import { snapshotCampo } from "../lib/precio-en-todas-las-variantes";

type ProductEditDetailSheetProps = {
  producto: ProductoIndice;
  userRole?: string;
  nombreComercio?: string;
  mostrarSinStock?: boolean;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  /** Rubro del comercio. Solo lo usa el bloque de identidad (marca): en kiosco,
   * alimentos, farmacia y ferretería el campo se ofrece siempre. */
  rubro?: Rubro;
};

// La fila de /stock rinde 100% desde ProductoIndice (búsqueda/orden/página
// sin red). Este sheet es el único lugar que necesita el detalle completo
// de un producto puntual (descripción, fecha de alta, SKU por variante,
// filas de productos_stock) — lo pide con su propio fetch al abrirse, no
// bloquea la lista ni se dispara por tipeo/filtro/orden.
export function ProductEditDetailSheet({
  producto,
  nombreComercio = "Tienda",
  mostrarSinStock = true,
  children,
  open,
  onOpenChange,
  hideTrigger = false,
  rubro,
}: Readonly<ProductEditDetailSheetProps>) {
  // El link del catálogo necesita el negocio, no solo el origen: cada
  // comercio tiene su propia tienda.
  const slugNegocio = useSlugNegocioActivo() ?? "";
  const urlProducto = producto.slug
    ? construirUrlProducto(slugNegocio, producto.slug)
    : null;
  const compartirDeshabilitado =
    !urlProducto ||
    !esVisibleEnCatalogo(
      { publicado: producto.publicado, stockTotal: getTotalStock(producto) },
      { mostrarSinStock },
    );
  const motivoCompartirDeshabilitado = !urlProducto
    ? "Este producto no tiene link público"
    : "Este producto no está visible en el catálogo";

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const {
    data: detalle,
    isLoading: isLoadingDetalle,
    isError: isErrorDetalle,
  } = useQuery({
    queryKey: queryKeys.stock.detalle(producto.id),
    queryFn: async () => {
      const { data, error } = await getStockDetalleProductoAction(producto.id);
      if (error || !data) throw new Error(error || "Producto no encontrado.");
      return data;
    },
    enabled: isOpen,
    staleTime: 60 * 1000,
  });

  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      {!hideTrigger && (
        <SheetTrigger asChild>
          {children ?? <Button variant="outline">Editar producto</Button>}
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
              onClick={() => setOpen(false)}
              className="h-8 w-8 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <SheetTitle className="text-xl font-bold text-foreground m-0">
                Editar Producto
              </SheetTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {detalle?.creado_en
                  ? `Actualizado por última vez: ${new Date(
                      detalle.creado_en,
                    ).toLocaleDateString("es-AR")}`
                  : " "}
              </p>
            </div>
          </div>

          <ShareButton
            url={urlProducto ?? ""}
            disabled={compartirDeshabilitado}
            disabledReason={motivoCompartirDeshabilitado}
            label="Compartir"
            variant="outline"
            size="sm"
          />
        </SheetHeader>

        {isErrorDetalle ? (
          <div className="flex-1 flex items-center justify-center text-sm text-destructive p-8 text-center">
            No se pudo cargar el producto. Cerrá e intentá de nuevo.
          </div>
        ) : !detalle || isLoadingDetalle ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando producto...
          </div>
        ) : (
          <EditProductForm
            key={detalle.id}
            producto={detalle}
            rubro={rubro}
            onSaved={() => setOpen(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

type EditableProducto = Producto & {
  categoria_id?: string | null;
};

/** "Talle: 39 / Color: Negro/blanco" — como se nombra una combinación en el
 * modal de confirmación, del mismo modo en las dos puntas del diff. */
function labelDeVariante(valores: Record<string, string>): string {
  return (
    Object.entries(valores)
      .map(([prop, valor]) => `${prop}: ${valor}`)
      .join(" / ") || "Variante"
  );
}

function EditProductForm({
  producto,
  rubro,
  onSaved,
}: Readonly<{
  producto: EditableProducto;
  rubro?: Rubro;
  onSaved: () => void;
}>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isSimpleProduct = isSingleVariantProduct(producto);
  // Fuente única de verdad para reconstruir opciones/variantes al cargar:
  // prioriza producto_variantes (nombres de atributo reales) y limpia
  // formatos legacy tipo "TALLE: L" antes de repartirlos en el form.
  const parsedProducto = useMemo(
    () => parseLegacyVariant(producto, isSimpleProduct),
    [producto, isSimpleProduct],
  );

  // El código de la variante única. Solo tiene sentido sin variantes: con
  // variantes cada fila de la grilla trae el suyo, y la primera no
  // representa a las demás.
  const skuVarianteUnica = isSimpleProduct
    ? (producto.producto_variantes?.[0]?.sku ?? null)
    : null;

  // Espejo local de imagen_url — arranca desde el producto cargado, pero
  // se actualiza apenas el servidor confirma un guardado de imágenes
  // exitoso (ver el success handler de formAction más abajo). Es la
  // fuente para "imágenes existentes" en vez de producto.imagen_url
  // directo: si el guard de variantes bloquea y el usuario reintenta
  // después de corregir, esto evita que el formulario crea que las fotos
  // ya guardadas siguen pendientes y las vuelva a subir — la causa exacta
  // de la duplicación del incidente original.
  const negocioId = useNegocioActivo()?.id ?? null;
  const [imagenesActuales, setImagenesActuales] = useState<string[]>(() =>
    parseProductImages(producto.imagen_url),
  );
  // URLs de imagen_url que el usuario tildó para borrar en esta sesión de
  // edición. No tocamos producto.imagen_url localmente: el servidor arma
  // el resultado final partiendo del imagen_url real en base (ver
  // editarProductoAction), esta lista solo indica la intención del click.
  const [isCompressing, setIsCompressing] = useState(false);
  // Última barrera antes de guardar un producto con variantes: comparamos
  // el payload que se va a mandar contra lo que HOY existe en base (no
  // contra el estado local del formulario, que puede haber perdido una
  // combinación sin que nadie lo note — el caso exacto de este incidente).
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diffFilas, setDiffFilas] = useState<VarianteDiffRow[]>([]);
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);
  const [categorias, setCategorias] = useState<CategoriaOption[]>([]);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState(
    producto.categoria_id || "",
  );
  const [status, setStatus] = useState<"active" | "inactive">(
    producto.publicado ? "active" : "inactive",
  );
  const [showPrice, setShowPrice] = useState(true);
  const [showInventory, setShowInventory] = useState(true);
  const [showVariants, setShowVariants] = useState(!isSimpleProduct);
  const [precioCosto, setPrecioCosto] = useState(
    producto.precio_costo?.toString() || "",
  );
  const [precioVenta, setPrecioVenta] = useState(
    producto.precio?.toString() || "",
  );

  // Las combinaciones que ya existen en producto_variantes (reconstruidas
  // arriba por parseLegacyVariant) arrancan tildadas en la matriz — el
  // vendedor no debe perder Stock/Precio/SKU ya cargados solo por abrir
  // el formulario de edición.
  const variantSelection = useVariantSelection({
    initialOpciones: parsedProducto.opciones,
    initialVariantes: parsedProducto.variantes,
    categoriaId: categoriaSeleccionada,
  });

  // Las que NO se enteran de lo que se escriba en "Precio Venta". Sale del
  // estado VIVO de la grilla, no de lo que trajo la base: si la persona le
  // borra el precio a una variante, el aviso tiene que desaparecer en el acto
  // —porque a partir de ahí sí va a heredar—.
  const variantesConPrecioPropio = variantSelection.variantes
    .filter(
      (v) => v.precio !== "" && v.precio !== null && v.precio !== undefined,
    )
    .map((v) => ({
      nombre: Object.values(v.valores).join(" / "),
      precio: Number(v.precio),
    }))
    .filter((v) => Number.isFinite(v.precio));

  // Lo que había antes de "Usar este precio en todas", para poder deshacer.
  // `null` = no se aplicó nada todavía. Vive acá y no en el hook porque el
  // snapshot hay que tomarlo ANTES de limpiar, leyendo el estado actual — no
  // adentro del updater de setState, que corre después (y dos veces en
  // StrictMode).
  const [preciosAntesDeAplicar, setPreciosAntesDeAplicar] = useState<Record<
    string,
    string
  > | null>(null);

  const usarPrecioDelProductoEnTodas = () => {
    setPreciosAntesDeAplicar(
      snapshotCampo(variantSelection.variantes, "precio"),
    );
    // Vacía el precio propio: las variantes vuelven a HEREDAR. No se les copia
    // el número — copiarlo se vería igual hoy y volvería a fabricar el
    // desacople la próxima vez que cambie el precio del producto.
    variantSelection.limpiarCampoDeVariantes("precio");
  };

  const deshacerPrecioEnTodas = () => {
    if (!preciosAntesDeAplicar) return;
    variantSelection.restaurarCampoDeVariantes("precio", preciosAntesDeAplicar);
    setPreciosAntesDeAplicar(null);
  };

  useEffect(() => {
    const fetchCats = async () => {
      const supabase = createClient();
      // Padres E hijas. Con solo las raíces, un producto que estaba en una
      // subcategoría no encontraba su id en la lista: el panel mostraba
      // "Asigna una categoría" sobre un producto que sí tenía una.
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

  const [, formAction, isPending] = useActionState(
    async (
      prevState: EditarProductoResult,
      formData: FormData,
    ): Promise<EditarProductoResult> => {
      formData.append("id", producto.id);
      formData.append("tieneVariantes", showVariants.toString());
      if (showVariants) {
        formData.append("opciones", JSON.stringify(variantSelection.opciones));
        formData.append(
          "variantes",
          JSON.stringify(variantSelection.variantes),
        );
      }

      // Un corte de red acá NO puede escalar al error boundary. La Server
      // Action viaja por el mismo `fetch` que el router de Next, así que
      // subiendo una foto por datos móviles el POST se muere y tira
      // `TypeError: Failed to fetch`. Sin este catch, React lo manda al
      // boundary y —como el único que había era `global-error`— la app entera
      // se ponía en negro con "la aplicación se cortó inesperadamente", con el
      // formulario lleno y la foto elegida perdidos.
      //
      // Devolver un estado de error en vez de relanzar deja el sheet abierto y
      // todo cargado: se toca Guardar de nuevo y listo.
      let result: EditarProductoResult;
      try {
        result = await editarProductoAction(prevState, formData);
      } catch (error) {
        if (!esErrorDeRed(error)) throw error;

        const mensaje = mensajeErrorDeRed("guardar el producto");
        toast.error(mensaje);
        return {
          imagenes: { success: false, error: mensaje },
          variantes: { success: false, error: mensaje },
        };
      }

      if (result.imagenes.success) {
        // Las fotos ya quedaron guardadas en el servidor — sincronizamos
        // el estado local ANTES de cualquier posible reintento (ej. si
        // las variantes se bloquean y el usuario corrige y vuelve a
        // guardar) para no volver a subir los mismos binarios ni volver a
        // pedir el borrado de fotos que ya no existen.
        if (result.imagenes.urls?.imagen_url !== undefined) {
          setImagenesActuales(
            parseProductImages(result.imagenes.urls.imagen_url),
          );
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });
        // Los precios fijos por lista viven en otra entrada del cache: sin
        // esto el POS seguiría cobrando el anterior hasta que venza el
        // staleTime, y el que lo acaba de cambiar es el que menos lo esperaría.
        queryClient.invalidateQueries({ queryKey: queryKeys.listasPrecios });
        queryClient.invalidateQueries({
          queryKey: queryKeys.stock.detalle(producto.id),
        });
        router.refresh();
      }

      // Los precios por lista son una tercera preocupación y avisan aparte:
      // que no se hayan podido escribir —los pide ADMIN— no cambia que el
      // producto sí se guardó, pero tampoco puede pasar en silencio.
      if (result.preciosLista) {
        toast.warning(result.preciosLista);
      }
      if (result.presentaciones) {
        toast.warning(result.presentaciones);
      }

      if (result.imagenes.success && result.variantes.success) {
        toast.success("Producto actualizado");
        onSaved();
      } else {
        // Éxito parcial o falla total: cada parte informa por su cuenta,
        // el sheet se queda abierto para que se pueda corregir y
        // reintentar sin perder lo que ya se guardó.
        if (result.imagenes.success) {
          toast.success("Fotos guardadas.");
        } else if (result.imagenes.error) {
          toast.error(
            `No se pudieron guardar las fotos: ${result.imagenes.error}`,
          );
        }
        if (!result.variantes.success && result.variantes.error) {
          toast.error(result.variantes.error);
        }
      }

      return result;
    },
    { imagenes: { success: false }, variantes: { success: false } },
  );

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

    // Las fotos ya se subieron a Storage y ya quedaron guardadas en el
    // producto cuando se eligieron (ver subirFotosAhora). Pero el `<input
    // type="file" name="imagenes">` sigue montado DENTRO de este <form> y
    // conserva los archivos ORIGINALES, así que `new FormData(e.currentTarget)`
    // los mete igual: el POST se llevaba las fotos crudas del celular, de
    // varios MB, para no usarlas.
    //
    // Eso es lo que rompía la edición de precio + foto en Estilo Bonito el 10 y
    // el 11/9/2026: pasado el tope de cuerpo de la plataforma el request muere
    // antes de llegar al handler, la respuesta no es RSC y el boundary muestra
    // "el servidor devolvió una respuesta incompleta". Y por debajo del tope
    // tampoco era gratis: `edit-product.ts` toma la rama vieja cuando ve
    // archivos y vuelve a subir a Storage lo que ya estaba subido.
    //
    // El formulario de ALTA ya hacía exactamente esto (ver
    // use-create-product-form.ts); acá faltaba. El comentario decía que las
    // fotos no pasaban por el submit — ahora es cierto.
    formData.delete("imagenes");
    formData.delete("thumbnails");
    formData.delete("grids");
    formData.delete("masters");

    // Lo que quede tiene que ser chico. Si algún día no lo es, que quede
    // medido en el log en vez de aparecer como una pantalla rota sin causa.
    controlarPayloadDeAction("editar-producto:guardar", formData);

    if (showVariants) {
      await abrirConfirmacionVariantes(formData);
    } else {
      startTransition(() => formAction(formData));
    }
  };

  /**
   * Sube las fotos elegidas y las deja guardadas en el producto, ya.
   *
   * No espera al botón Guardar: si el guardado fallaba por red, antes se
   * perdía la foto junto con todo el formulario. Ahora la foto es su propia
   * operación y lo único que puede fallar es la foto.
   */
  const subirFotosAhora = async (nuevos: File[]) => {
    if (nuevos.length === 0) return;

    if (!negocioId) {
      toast.error("Todavía no se resolvió el comercio activo. Probá de nuevo.");
      return;
    }

    const cupo = Math.max(0, MAX_IMAGENES_PRODUCTO - imagenesActuales.length);
    if (cupo === 0) {
      toast.error(`Este producto ya tiene ${MAX_IMAGENES_PRODUCTO} fotos.`);
      return;
    }

    setIsCompressing(true);
    marcarInicioOperacion("editar-producto:subir-fotos", {
      cantidadImagenes: nuevos.length,
      bytesTotales: nuevos.reduce((acc, f) => acc + f.size, 0),
    });

    try {
      const optimizadas = await optimizarImagenesProducto(
        nuevos.slice(0, cupo),
      );
      const urls = await subirImagenesProductoDesdeCliente(
        negocioId,
        optimizadas,
        cupo,
      );

      if (urls.mains.length === 0) {
        toast.error(mensajeErrorDeRed("subir las fotos"));
        return;
      }

      const res = await actualizarFotosProductoAction(producto.id, {
        agregar: urls,
      });

      if (!res.success) {
        toast.error(res.error ?? "No se pudieron guardar las fotos.");
        return;
      }

      // La galería se sincroniza con lo que devolvió el server, no con lo que
      // creemos localmente: es la misma razón por la que la action parte de la
      // base y no de una lista del cliente.
      if (res.imagenes) setImagenesActuales(res.imagenes);
      queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });
      toast.success(
        urls.mains.length === 1 ? "Foto guardada" : "Fotos guardadas",
      );
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
    } finally {
      setIsCompressing(false);
      marcarFinOperacion();
    }
  };

  /** Quita una foto del producto al instante. El archivo NO se borra de
   * Storage — ver el comentario de `actualizarFotosProductoAction`. */
  const quitarFotoAhora = async (url: string) => {
    const previas = imagenesActuales;
    // Optimista: la cruz tiene que responder al toque. Si el server rechaza,
    // se vuelve atrás.
    setImagenesActuales((prev) => prev.filter((u) => u !== url));

    const res = await actualizarFotosProductoAction(producto.id, {
      quitar: [url],
    });

    if (!res.success) {
      setImagenesActuales(previas);
      toast.error(res.error ?? "No se pudo quitar la foto.");
      return;
    }

    if (res.imagenes) setImagenesActuales(res.imagenes);
    queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });
  };

  const abrirConfirmacionVariantes = async (formData: FormData) => {
    setPendingFormData(formData);
    // El modal NO se abre acá. Antes se abría antes de calcular el diff y se
    // cerraba solo si no había cambios, así que en TODO guardado de un
    // producto con variantes parpadeaba una confirmación que no había que
    // confirmar — incluso cambiando únicamente una foto. Un cartel que
    // aparece cuando no corresponde es un cartel que se aprende a ignorar, y
    // este existe para frenar borrados de mercadería.
    //
    // Ahora primero se calcula, y el modal se abre solo si hay algo que
    // confirmar. `isLoadingDiff` sostiene el botón mientras tanto.
    setIsLoadingDiff(true);

    // Re-fetch obligatorio contra la base real al momento de confirmar —
    // NUNCA contra el estado local del form, que puede haber perdido una
    // combinación sin que nadie lo note (el caso exacto del incidente que
    // originó este modal). Columnas acotadas a lo que el diff usa.
    const supabase = createClient();
    const { data: existentes } = await supabase
      .from("producto_variantes")
      .select("nombre_display, atributos, precio, stock")
      .eq("producto_id", producto.id);

    // .key ya viene calculado por buildCartesianVariants/parseLegacyVariant
    // — no hace falta recalcularlo acá.
    const formVariantesPorKey = new Map(
      variantSelection.variantes.map((v) => [v.key, v]),
    );
    const existentesPorKey = new Map(
      (existentes ?? []).map((ex) => [
        buildVariantKey((ex.atributos as Record<string, string>) ?? {}),
        ex,
      ]),
    );

    // Emparejamiento por propiedades comunes: cuando el guardado agrega o
    // quita una propiedad, la key de todas las combinaciones cambia y el
    // diff crudo las leería como "se eliminan todas y se crean otras
    // tantas". El módulo distingue el renombre del borrado real.
    const renombresPorKeyBase = emparejarPorEsquema(
      (existentes ?? []).map((ex) => {
        const atributos = (ex.atributos as Record<string, string>) ?? {};
        return { key: buildVariantKey(atributos), valores: atributos };
      }),
      variantSelection.variantes.map((v) => ({
        key: v.key,
        valores: v.valores,
      })),
    );

    /** key del form -> stock que hereda de la variante que la precede. */
    const renombradas = new Map<string, { stockAntes: number | null }>();

    // Pasada 1: lo que hoy existe en base — eliminadas (no está en el
    // payload) y modificadas (stock o precio distinto).
    const filasEliminadasYModificadas: VarianteDiffRow[] = [];
    existentesPorKey.forEach((ex, key) => {
      const atributos = (ex.atributos as Record<string, string>) ?? {};
      const atributosLabel =
        Object.entries(atributos)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" / ") ||
        ex.nombre_display ||
        "Variante";
      const precioAntes = ex.precio ? Number(ex.precio) : null;
      const enPayload = formVariantesPorKey.get(key);

      if (!enPayload) {
        // ¿Es la misma combinación con otro esquema de atributos? Si el
        // emparejamiento por propiedades comunes la encuentra, esta fila no
        // desaparece: se reescribe con la key nueva y se lleva su stock.
        const keyDestino = renombresPorKeyBase.get(key);

        if (keyDestino && !renombradas.has(keyDestino)) {
          renombradas.set(keyDestino, { stockAntes: ex.stock });
          filasEliminadasYModificadas.push({
            key,
            atributosLabel,
            tipo: "renombrada",
            stockAntes: ex.stock,
            stockDespues: ex.stock,
            precioAntes,
            precioDespues: precioAntes,
            atributos,
            labelDestino: labelDeVariante(
              formVariantesPorKey.get(keyDestino)?.valores ?? {},
            ),
          });
          return;
        }

        filasEliminadasYModificadas.push({
          key,
          atributosLabel,
          tipo: "eliminada",
          stockAntes: ex.stock,
          stockDespues: null,
          precioAntes,
          precioDespues: null,
          atributos,
        });
        return;
      }

      const stockDespues = enPayload.stock?.trim()
        ? parsearCantidadDeEntrada(enPayload.stock)
        : ex.stock;
      const precioDespues = enPayload.precio?.trim()
        ? Number.parseFloat(enPayload.precio)
        : null;

      // Ocultamos del todo lo que no cambia: solo lo que realmente va a
      // moverse merece la atención del usuario.
      if (ex.stock !== stockDespues || precioAntes !== precioDespues) {
        filasEliminadasYModificadas.push({
          key,
          atributosLabel,
          tipo: "modificada",
          stockAntes: ex.stock,
          stockDespues,
          precioAntes,
          precioDespues,
        });
      }
    });

    // Pasada 2: lo que trae el payload y no existe en base todavía. Las que
    // son el destino de un renombre NO son nuevas: ya se listaron del otro
    // lado, y contarlas dos veces infla la tabla justo cuando lo que hace
    // falta es que se lea corto.
    const filasNuevas: VarianteDiffRow[] = [];
    formVariantesPorKey.forEach((v, key) => {
      if (existentesPorKey.has(key) || renombradas.has(key)) return;
      filasNuevas.push({
        key,
        atributosLabel: labelDeVariante(v.valores),
        tipo: "nueva",
        stockAntes: null,
        stockDespues: v.stock?.trim() ? parsearCantidadDeEntrada(v.stock) : 0,
        precioAntes: null,
        precioDespues: v.precio?.trim() ? Number.parseFloat(v.precio) : null,
      });
    });

    // El renombre solo conserva la mercadería si el stock efectivamente
    // viaja: la grilla cartesiana genera las combinaciones nuevas con el
    // stock vacío, y la RPC borra y reinserta, así que sin esto la fila
    // nueva nacería en cero. Se escribe en la grilla —no en el FormData—
    // para que el usuario vea el número correcto aunque cancele el guardado.
    renombradas.forEach(({ stockAntes }, keyDestino) => {
      const destino = formVariantesPorKey.get(keyDestino);
      if (destino?.stock?.trim()) return;
      variantSelection.handleVarChange(
        keyDestino,
        "stock",
        (stockAntes ?? 0).toString(),
      );
    });

    const filas = [...filasEliminadasYModificadas, ...filasNuevas];

    // Si de verdad no cambia nada, el modal no aporta nada — guardamos
    // directo en vez de mostrar una tabla vacía sin explicación.
    if (filas.length === 0) {
      setIsLoadingDiff(false);
      setPendingFormData(null);
      startTransition(() => formAction(formData));
      return;
    }

    setDiffFilas(filas);
    setIsLoadingDiff(false);
    // Recién ahora: hay algo concreto que confirmar.
    setConfirmModalOpen(true);
  };

  const handleConfirmSave = () => {
    if (!pendingFormData) return;

    // Le mandamos al server exactamente lo que este modal mostró y el
    // usuario confirmó como "se elimina" — es la única lista que el RPC va
    // a aceptar como excepción al freno de variantes faltantes. Cualquier
    // otra faltante que aparezca del lado servidor (estado stale, carrera
    // entre pestañas) sigue bloqueando el guardado.
    // Las renombradas también entran: para la RPC su combinación vieja
    // desaparece igual (se borra y se reinserta con la key nueva), así que
    // sin declararlas el guardado quedaría bloqueado. La diferencia entre
    // una y otra es de dónde sale la autorización — la eliminación con
    // mercadería se tilda fila por fila, el renombre no borra nada.
    const atributosConfirmados = diffFilas
      .filter(
        (f) =>
          (f.tipo === "eliminada" || f.tipo === "renombrada") && f.atributos,
      )
      .map((f) => f.atributos);
    if (atributosConfirmados.length > 0) {
      pendingFormData.set(
        "confirmadasEliminar",
        JSON.stringify(atributosConfirmados),
      );
    }

    setConfirmModalOpen(false);
    startTransition(() => formAction(pendingFormData));
    setPendingFormData(null);
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
        <form
          onSubmit={handleSubmit}
          id="edit-product-form"
          className="max-w-3xl mx-auto space-y-6"
        >
          {/* Las fotos ya NO son un campo de este formulario: se guardan al
              subirlas y se quitan al tocar la cruz. `Cancelar` cancela el
              resto (nombre, precio, variantes), no las fotos. */}
          <ProductMediaSection
            archivos={[]}
            onArchivosChange={subirFotosAhora}
            existingImages={imagenesActuales}
            onRemoveExistingImage={quitarFotoAhora}
            inputId={`imagenes-edit-${producto.id}`}
          />

          {/* Los MISMOS campos que el alta. Antes la marca solo aparecía
              enterrada en el bloque fiscal —y el código, en ningún lado—, así
              que un producto se daba de alta con marca y después no había
              dónde corregirla. */}
          <ProductBasicInfoSection
            status={status}
            onStatusChange={setStatus}
            defaultNombre={producto.nombre}
            defaultDescripcion={producto.descripcion}
            mostrarMarca
            defaultMarca={producto.marca}
            mostrarSku={!showVariants}
            defaultSku={skuVarianteUnica}
            rubro={rubro}
            categoriaId={categoriaSeleccionada}
            // Sin esto, renombrar un producto para que coincida con otro no
            // avisaría, y editar el propio nombre avisaría contra sí mismo.
            productoId={producto.id}
          />

          <ProductCategorySection
            categorias={categorias}
            categoriaSeleccionada={categoriaSeleccionada}
            onCategoriaSeleccionadaChange={setCategoriaSeleccionada}
          />

          <ProductPriceSection
            showPrice={showPrice}
            onShowPriceChange={setShowPrice}
            precioCosto={precioCosto}
            onPrecioCostoChange={setPrecioCosto}
            precioVenta={precioVenta}
            onPrecioVentaChange={setPrecioVenta}
            gananciaNeta={gananciaNeta}
            recargoPorcentaje={recargoPorcentaje}
            variantesConPrecioPropio={variantesConPrecioPropio}
            onUsarPrecioEnTodas={usarPrecioDelProductoEnTodas}
            onDeshacerPrecioEnTodas={
              preciosAntesDeAplicar ? deshacerPrecioEnTodas : undefined
            }
          />

          <ProductInventorySection
            showVariants={showVariants}
            showInventory={showInventory}
            onShowInventoryChange={setShowInventory}
            defaultStock={producto.stock?.[0]?.cantidad || 0}
            unidadMedida={producto.unidad_medida}
          />

          <ProductVariantsSection
            showVariants={showVariants}
            onShowVariantsChange={setShowVariants}
            opciones={variantSelection.opciones}
            resetOpciones={variantSelection.reset}
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
            showAdvancedColumns
            baseVariants={variantSelection.baseVariants}
            selectedCombinations={variantSelection.selectedCombinations}
            onToggleCombination={variantSelection.handleToggleCombination}
            onBulkSetSelection={variantSelection.handleBulkSetSelection}
            onInvertSelection={variantSelection.handleInvertSelection}
            pivotSelections={variantSelection.pivotSelections}
            onPivotChange={variantSelection.handlePivotChange}
            atributosExistentes={variantSelection.atributosExistentes}
          />

          {/* Los precios fijos por lista: la excepción a la regla. No se
              dibuja si el comercio no tiene listas. Colapsada, con el mismo
              mecanismo de `has()` que el bloque fiscal. */}
          <ProductListasSection
            productoId={producto.id}
            precioVenta={precioVenta}
            precioCosto={precioCosto}
          />

          {/* Presentaciones comerciales (Balde, Pack x10): UN stock, varias
              formas de venderlo. Colapsada; el conjunto viaja como JSON con
              centinela, mismo mecanismo que precios por lista. Las variantes
              que ve son las GUARDADAS: una presentación atada a una variante
              recién agregada en este mismo guardado no se puede elegir
              todavía, porque esa variante no tiene id hasta que se guarde. */}
          <ProductPresentacionesSection
            presentacionesIniciales={producto.producto_presentaciones}
            unidadMedida={producto.unidad_medida}
            precioVenta={precioVenta}
            variantes={(producto.producto_variantes ?? []).map((v) => ({
              id: v.id,
              nombre_display: v.nombre_display,
              stock: Number(v.stock) || 0,
            }))}
          />

          {/* Colapsada. Mientras esté cerrada NO monta sus inputs, y la
              action mira `has()`: corregir un precio no puede pisarle el
              tratamiento de IVA a un producto. */}
          <ProductFiscalSection
            tratamientoActual={producto.tratamiento_iva}
            unidadActual={producto.unidad_medida}
            generoActual={producto.genero}
          />
        </form>
      </div>

      <CreateProductFooter
        // El diff de variantes ahora se calcula ANTES de abrir el modal, así
        // que hay un tramo con el botón activo y nada en pantalla. Sin esto,
        // dos toques disparan dos consultas y dos guardados.
        isPending={isPending || isLoadingDiff}
        isCompressing={isCompressing}
        onCancel={onSaved}
        formId="edit-product-form"
        cancelLabel="Descartar cambios"
        idleLabel="Guardar Cambios"
        blockedReason={
          variantSelection.duplicatePropertyNames.size > 0
            ? "Resolvé los nombres de propiedad duplicados antes de guardar."
            : variantSelection.genericPropertyNames.size > 0
              ? "Renombrá las propiedades con nombre genérico (Propiedad/Opción) antes de guardar."
              : variantSelection.missingRequiredAttributes.size > 0
                ? "Esta categoría exige valores para uno o más atributos requeridos."
                : null
        }
      />

      <ConfirmSaveVariantsModal
        open={confirmModalOpen}
        onOpenChange={(open) => {
          setConfirmModalOpen(open);
          if (!open) setPendingFormData(null);
        }}
        isLoadingDiff={isLoadingDiff}
        filas={diffFilas}
        isSubmitting={isPending}
        onConfirm={handleConfirmSave}
      />
    </>
  );
}

export const EditarProductoSheet = ProductEditDetailSheet;
export const EditarProductoModal = ProductEditDetailSheet;
