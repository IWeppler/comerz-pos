"use client";

import { useMemo, useState, useTransition, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/shared/ui/toast";
import {
  Copy,
  Eye,
  EyeOff,
  FolderInput,
  Loader2,
  MessageCircle,
  Share2,
  Star,
  StarOff,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { ProductoIndice } from "@/entities/productos/types";
import { queryKeys } from "@/shared/lib/query-keys";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  construirArbolCategorias,
  type CategoriaBase,
} from "@/shared/utils/category-tree";
import {
  compartirNativo,
  construirLinkWhatsApp,
  construirUrlSeleccion,
  esVisibleEnCatalogo,
  puedeCompartirNativo,
  MAX_PRODUCTOS_COMPARTIDOS,
} from "@/shared/utils/compartir-catalogo";
import { getTotalStock } from "../../lib/stock-product-utils";
import {
  bulkDeleteProductsAction,
  bulkUpdateCategoryAction,
} from "../../actions/delete-product";
import {
  bulkTogglePublicadoAction,
  bulkToggleDestacadoAction,
} from "../../actions/bulk-catalogo";
import { UpdatePricesModal } from "../update-prices-modal";

// ---------------------------------------------------------------------------
// CONTRATO
// ---------------------------------------------------------------------------

export interface CtxSeleccion {
  ids: string[];
  /** Los productos seleccionados con sus datos. El índice completo vive en
   * memoria en stock-view, así que esto incluye los que quedaron en otra
   * página — nunca solo los visibles. */
  productos: ProductoIndice[];
  isAdmin: boolean;
  nombreComercio: string;
  mostrarSinStock: boolean;
  slugNegocio: string;
  categoriasArbol: CategoriaBase[];
  /** Invalida las queries de stock/POS y limpia la selección. */
  finalizar: () => void;
}

export interface AccionMasiva {
  clave: string;
  label: (ctx: CtxSeleccion) => string;
  icono: LucideIcon;
  /** Menor = más a la izquierda / más arriba. Las 3 más prioritarias que no
   * sean de grupo "peligro" se muestran como botón en la barra de desktop;
   * el resto vive en el menú "⋯". Agregar una acción nueva es agregar una
   * entrada acá: ni la barra ni el sheet se tocan. */
  prioridad: number;
  grupo: "precios" | "organizar" | "catalogo" | "peligro";
  visible?: (ctx: CtxSeleccion) => boolean;
  /** Devuelve el motivo por el que no se puede ejecutar, o null si se puede. */
  bloqueada?: (ctx: CtxSeleccion) => string | null;
  /** Acción con UI propia. Se monta solo cuando el usuario la activa. */
  Modal?: ComponentType<{
    ctx: CtxSeleccion;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>;
  /** Acción directa, sin paso intermedio. Reservado para lo reversible. */
  ejecutar?: (ctx: CtxSeleccion) => Promise<void>;
}

/** Invalida lo que toca cualquier escritura masiva de productos. */
function invalidarStock(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });
}

export function useFinalizarSeleccion(limpiar: () => void) {
  const queryClient = useQueryClient();
  return useMemo(
    () => () => {
      invalidarStock(queryClient);
      limpiar();
    },
    [queryClient, limpiar],
  );
}

// ---------------------------------------------------------------------------
// MODALES DE CADA ACCIÓN
// ---------------------------------------------------------------------------

function ModalPrecios({
  ctx,
  open,
  onOpenChange,
}: Readonly<{
  ctx: CtxSeleccion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  // Reusa el modal de 3 pasos tal cual (simulación + preview + advertencias):
  // lo único que cambia es que el alcance queda fijado en los seleccionados.
  return (
    <UpdatePricesModal
      open={open}
      onOpenChange={onOpenChange}
      hideTrigger
      seleccion={{ ids: ctx.ids }}
      onAplicado={ctx.finalizar}
    />
  );
}

function ModalMoverCategoria({
  ctx,
  open,
  onOpenChange,
}: Readonly<{
  ctx: CtxSeleccion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const [padreId, setPadreId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [isPending, startTransition] = useTransition();

  // Mismo armado de árbol que los chips del toolbar. Acá los conteos no
  // importan para decidir destino (una categoría vacía hoy sigue siendo un
  // destino válido), por eso la existencia va siempre en 1.
  const arbol = useMemo(() => {
    const existenciaSiempreUno = Object.fromEntries(
      ctx.categoriasArbol.map((c) => [c.id, 1]),
    );
    return construirArbolCategorias(ctx.categoriasArbol, existenciaSiempreUno);
  }, [ctx.categoriasArbol]);

  const padreSeleccionado = useMemo(
    () => arbol.padres.find((p) => p.id === padreId) ?? null,
    [arbol, padreId],
  );

  const handlePadreChange = (val: string) => {
    setPadreId(val);
    const esPadreConHijos = arbol.padres.some(
      (p) => p.id === val && p.hijos.length > 0,
    );
    // Padre sin hijos (o categoría suelta): el destino final ya se conoce con
    // este solo click. Padre con hijos: esperamos el segundo select.
    setCategoriaId(esPadreConHijos ? "" : val);
  };

  const handleMover = () => {
    if (!categoriaId) return;
    startTransition(async () => {
      const result = await bulkUpdateCategoryAction(ctx.ids, categoriaId);
      if (result.success) {
        toast.success(
          `${ctx.ids.length} ${
            ctx.ids.length === 1 ? "producto movido" : "productos movidos"
          } de categoría.`,
        );
        onOpenChange(false);
        ctx.finalizar();
      } else {
        toast.error(result.error || "No se pudo cambiar la categoría.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mover de categoría</DialogTitle>
          <DialogDescription>
            {ctx.ids.length}{" "}
            {ctx.ids.length === 1
              ? "producto va a quedar"
              : "productos van a quedar"}{" "}
            en la categoría que elijas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Select
            value={padreId}
            onValueChange={handlePadreChange}
            disabled={isPending}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Categoría destino" />
            </SelectTrigger>
            <SelectContent>
              {arbol.padres.map((padre) => (
                <SelectItem key={padre.id} value={padre.id}>
                  {padre.nombre}
                </SelectItem>
              ))}
              {arbol.sinPadre.map((categoria) => (
                <SelectItem key={categoria.id} value={categoria.id}>
                  {categoria.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {padreSeleccionado && padreSeleccionado.hijos.length > 0 && (
            <Select
              value={categoriaId}
              onValueChange={setCategoriaId}
              disabled={isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Subcategoría" />
              </SelectTrigger>
              <SelectContent>
                {padreSeleccionado.hijos.map((hijo) => (
                  <SelectItem key={hijo.id} value={hijo.id}>
                    {hijo.nombre}
                  </SelectItem>
                ))}
                <SelectItem value={padreSeleccionado.id}>
                  Todo {padreSeleccionado.nombre}, sin subcategoría específica
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button onClick={handleMover} disabled={isPending || !categoriaId}>
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FolderInput className="w-4 h-4 mr-2" />
            )}
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ids que realmente van a aparecer al abrir el link compartido — el catálogo
 * público omite los no publicados y (según config) los sin stock, así que sin
 * este filtro pasa el caso "comparto 5 y no se ve ninguno". */
function idsCompartibles(ctx: CtxSeleccion): string[] {
  return ctx.productos
    .filter((p) =>
      esVisibleEnCatalogo(
        { publicado: p.publicado, stockTotal: getTotalStock(p) },
        { mostrarSinStock: ctx.mostrarSinStock },
      ),
    )
    .map((p) => p.id);
}

function ModalCompartir({
  ctx,
  open,
  onOpenChange,
}: Readonly<{
  ctx: CtxSeleccion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const visibles = idsCompartibles(ctx);
  const capeados = Math.min(visibles.length, MAX_PRODUCTOS_COMPARTIDOS);
  const url = construirUrlSeleccion(ctx.slugNegocio, visibles);
  const ocultos = ctx.ids.length - visibles.length;

  const handleCopiar = async () => {
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado al portapapeles");
    onOpenChange(false);
  };

  const handleWhatsApp = () => {
    window.open(construirLinkWhatsApp(url), "_blank");
    onOpenChange(false);
  };

  const handleNativo = async () => {
    await compartirNativo({ url });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compartir {capeados} productos</DialogTitle>
          <DialogDescription>
            Se abre el catálogo público mostrando solo estos productos.
          </DialogDescription>
        </DialogHeader>

        {(ocultos > 0 || visibles.length > MAX_PRODUCTOS_COMPARTIDOS) && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground space-y-1">
            {ocultos > 0 && (
              <p>
                {ocultos}{" "}
                {ocultos === 1
                  ? "producto no está visible en el catálogo y queda afuera."
                  : "productos no están visibles en el catálogo y quedan afuera."}
              </p>
            )}
            {visibles.length > MAX_PRODUCTOS_COMPARTIDOS && (
              <p>
                El link admite {MAX_PRODUCTOS_COMPARTIDOS}: se comparten los
                primeros {MAX_PRODUCTOS_COMPARTIDOS} de {visibles.length}.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 py-2">
          {puedeCompartirNativo() && (
            <Button onClick={handleNativo} className="justify-start">
              <Share2 className="w-4 h-4 mr-2.5" />
              Compartir…
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleWhatsApp}
            className="justify-start"
          >
            <MessageCircle className="w-4 h-4 mr-2.5 text-success" />
            Enviar por WhatsApp
          </Button>
          <Button
            variant="outline"
            onClick={handleCopiar}
            className="justify-start"
          >
            <Copy className="w-4 h-4 mr-2.5 text-muted-foreground" />
            Copiar link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModalEliminar({
  ctx,
  open,
  onOpenChange,
}: Readonly<{
  ctx: CtxSeleccion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const [isPending, startTransition] = useTransition();

  const handleEliminar = () => {
    startTransition(async () => {
      const result = await bulkDeleteProductsAction(ctx.ids);
      if (result.success) {
        toast.success(
          `${ctx.ids.length} ${
            ctx.ids.length === 1
              ? "producto eliminado"
              : "productos eliminados"
          }.`,
        );
        onOpenChange(false);
        ctx.finalizar();
      } else {
        toast.error(result.error || "No se pudieron eliminar los productos.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Eliminar {ctx.ids.length} productos</DialogTitle>
          <DialogDescription>
            Se eliminan {ctx.ids.length}{" "}
            {ctx.ids.length === 1 ? "producto" : "productos"} y todo su stock
            asociado. Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        {/* Con "seleccionar todo lo filtrado" un click puede abarcar cientos
            de productos: la lista deja ver qué se está por borrar, no solo el
            número. */}
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
          {ctx.productos.map((p) => (
            <p key={p.id} className="truncate">
              {p.nombre}
            </p>
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleEliminar}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-2" />
            )}
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// REGISTRO
// ---------------------------------------------------------------------------

async function cambiarVisibilidad(ctx: CtxSeleccion, publicado: boolean) {
  const result = await bulkTogglePublicadoAction(ctx.ids, publicado);
  if (result.success) {
    toast.success(
      publicado
        ? `${ctx.ids.length} ${ctx.ids.length === 1 ? "producto visible" : "productos visibles"} en el catálogo.`
        : `${ctx.ids.length} ${ctx.ids.length === 1 ? "producto oculto" : "productos ocultos"} del catálogo.`,
    );
    ctx.finalizar();
  } else {
    toast.error(result.error || "No se pudo cambiar la visibilidad.");
  }
}


/**
 * Destacar / quitar de destacados.
 *
 * Directas y sin modal, igual que publicar/ocultar: son reversibles con un
 * click y no piden ningún dato. El tope de 8 lo chequea la action ANTES de
 * escribir y vuelve como error con el número exacto que sobra — no se
 * pre-calcula acá para deshabilitar el botón, porque el conteo del cliente
 * puede estar viejo (otra vendedora destacando desde otra terminal) y un botón
 * habilitado que después explica por qué no se pudo es más honesto que uno
 * gris sin motivo.
 */
async function cambiarDestacado(ctx: CtxSeleccion, destacado: boolean) {
  const result = await bulkToggleDestacadoAction(ctx.ids, destacado);
  if (result.success) {
    toast.success(
      destacado
        ? `${ctx.ids.length} ${ctx.ids.length === 1 ? "producto destacado" : "productos destacados"} en la portada.`
        : `${ctx.ids.length} ${ctx.ids.length === 1 ? "producto sacado" : "productos sacados"} de la portada.`,
    );
    ctx.finalizar();
  } else {
    toast.error(result.error || "No se pudieron cambiar los destacados.");
  }
}

export const ACCIONES_MASIVAS: AccionMasiva[] = [
  {
    clave: "precios",
    label: () => "Editar precios",
    icono: TrendingUp,
    prioridad: 10,
    grupo: "precios",
    visible: (ctx) => ctx.isAdmin,
    Modal: ModalPrecios,
  },
  {
    clave: "mover",
    label: () => "Mover de categoría",
    icono: FolderInput,
    prioridad: 20,
    grupo: "organizar",
    Modal: ModalMoverCategoria,
  },
  {
    clave: "compartir",
    label: () => "Compartir",
    icono: Share2,
    prioridad: 30,
    grupo: "catalogo",
    bloqueada: (ctx) =>
      idsCompartibles(ctx).length === 0
        ? "Ninguno de los seleccionados está visible en el catálogo"
        : null,
    Modal: ModalCompartir,
  },
  {
    clave: "destacar",
    label: () => "Destacar en la portada",
    icono: Star,
    prioridad: 35,
    grupo: "catalogo",
    // Solo si hay alguno sin destacar. Con los 8 ya marcados la entrada no
    // haría nada más que devolver el error del tope.
    visible: (ctx) => ctx.productos.some((p) => !p.destacado_en),
    // Destacar algo que el catálogo no muestra es armar una vidriera con un
    // hueco: la portada filtra por publicado/stock ANTES de mirar la marca.
    bloqueada: (ctx) =>
      ctx.productos.every((p) => !p.publicado)
        ? "Ninguno de los seleccionados está publicado en el catálogo"
        : null,
    ejecutar: (ctx) => cambiarDestacado(ctx, true),
  },
  {
    clave: "quitar-destacado",
    label: () => "Quitar de la portada",
    icono: StarOff,
    prioridad: 36,
    grupo: "catalogo",
    visible: (ctx) => ctx.productos.some((p) => Boolean(p.destacado_en)),
    ejecutar: (ctx) => cambiarDestacado(ctx, false),
  },
  {
    clave: "publicar",
    label: () => "Mostrar en el catálogo",
    icono: Eye,
    prioridad: 40,
    grupo: "catalogo",
    // Solo aparece si hay algo que publicar: con todo ya publicado la entrada
    // no haría nada y solo alarga el menú.
    visible: (ctx) => ctx.productos.some((p) => !p.publicado),
    ejecutar: (ctx) => cambiarVisibilidad(ctx, true),
  },
  {
    clave: "ocultar",
    label: () => "Ocultar del catálogo",
    icono: EyeOff,
    prioridad: 50,
    grupo: "catalogo",
    visible: (ctx) => ctx.productos.some((p) => p.publicado),
    ejecutar: (ctx) => cambiarVisibilidad(ctx, false),
  },
  {
    clave: "eliminar",
    label: () => "Eliminar",
    icono: Trash2,
    prioridad: 90,
    grupo: "peligro",
    visible: (ctx) => ctx.isAdmin,
    Modal: ModalEliminar,
  },
];

/** Cuántas acciones se muestran como botón suelto en la barra de desktop. */
export const MAX_ACCIONES_EN_BARRA = 3;

export function accionesVisibles(ctx: CtxSeleccion): AccionMasiva[] {
  return ACCIONES_MASIVAS.filter((a) => a.visible?.(ctx) ?? true).sort(
    (a, b) => a.prioridad - b.prioridad,
  );
}
