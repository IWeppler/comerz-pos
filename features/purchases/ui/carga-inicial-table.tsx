"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Layers, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { queryKeys } from "@/shared/lib/query-keys";
import {
  CategoriaPadreHijoSelect,
  useArbolParaElegir,
} from "@/shared/components/categoria-padre-hijo-select";
import type { ItemResuelto, OrdenCompra } from "@/entities/compras/types";
import type { Rubro } from "@/entities/config/types";
import {
  construirFilasCargaInicial,
  filasAItems,
  precioSugerido,
  unidadesDeFila,
  type FilaCargaInicial,
} from "../lib/filas-carga-inicial";
import type { CategoriaReal } from "../lib/resolve-import-categoria";
import { explicarModo, type DecisionModo } from "../lib/modo-conciliacion";
import {
  borrarBorradorOrdenAction,
  crearProductosDesdeRemitoAction,
  guardarBorradorOrdenAction,
  type GrupoParaCrear,
} from "../actions/carga-inicial";
import { aprobarOrdenAction } from "../actions/merge-purchase";
import { ProgresoOverlay } from "./progreso-overlay";
import {
  AlertaImeisFaltantes,
  ImeisRemitoPanel,
  type RenglonImei,
} from "./imeis-remito-panel";
import {
  faltantesImei as calcularFaltantesImei,
  problemasImeis,
  type FaltanteImei,
} from "../lib/imeis-remito";
import type { SerieConciliacion } from "../lib/imeis-remito";
import { categoriaPideImeiPorNombre } from "@/shared/lib/categoria-pide-imei";

/**
 * Tabla editable del modo CARGA INICIAL.
 *
 * La pantalla de conciliación asume que la mayoría de las filas ya existen en
 * el catálogo, y por eso pide, fila por fila, buscar el producto en un
 * combobox y crearlo en un modal. Medido sobre los 142 remitos reales: el
 * comercio establecido matchea 18% y el que arranca 0%. O sea que la pregunta
 * "¿con cuál de tus productos se corresponde esta fila?" tiene, casi siempre,
 * la misma respuesta: con ninguno.
 *
 * Acá el default está dado vuelta. Toda fila arranca como producto NUEVO, con
 * todo lo inferible ya puesto (nombre, marca, categoría, costo, precio), y se
 * corrige en la misma grilla. Sin combobox, sin modales, sin fotos.
 *
 * Las filas que el import SÍ reconoció no desaparecen: quedan aparte, marcadas
 * como "ya está en tu catálogo", y solo suman stock. El modo cambia el default
 * y el trabajo, no lo que el remito puede hacer.
 */

/** Markup por defecto. Medido: el 93,1% de los productos de Evens y el 94,4%
 * de los de Estilo Bonito tienen precio EXACTAMENTE el doble del costo. El
 * default correcto no es "vacío", es ×2. */
const RECARGO_DEFAULT = 100;

// La columna de categoría lleva DOS selects (padre y subcategoría) apilados,
// así que necesita más ancho mínimo que cuando era uno solo: con 160px el
// nombre del padre se cortaba justo donde se distinguen "Ropa Mujer" de "Ropa
// Niña".
const COLUMNAS =
  "grid-cols-[32px_minmax(200px,1.4fr)_minmax(190px,1.1fr)_minmax(120px,0.8fr)_104px_104px_minmax(150px,1fr)_40px]";
// El ancho mínimo vale de md para arriba. Debajo, la grilla se apila: 1.110
// píxeles fijos en un teléfono de 390 px eran tres cuartos de fila invisibles
// y scroll horizontal para llegar a cada campo.
const ANCHO_MINIMO = "md:min-w-[1110px]";

/** Cada celda pasa a ser una fila de ancho completo en mobile, con el rótulo
 * que en desktop pone la cabecera. */
const CELDA_APILADA =
  "max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] " +
  "max-md:before:font-semibold max-md:before:uppercase " +
  "max-md:before:tracking-wide max-md:before:text-muted-foreground " +
  "max-md:before:content-[attr(data-label)]";

type BorradorCargaInicial = {
  version: 1;
  /** Discrimina el payload: la misma fila de `ordenes_borradores` la usan los
   * dos modos, y el borrador de uno no sirve para el otro. */
  modo: "CARGA_INICIAL";
  filas: FilaCargaInicial[];
  recargo: number;
};

interface Props {
  orden: OrdenCompra;
  itemsOriginales: ItemResuelto[];
  categorias: CategoriaReal[];
  rubro: Rubro;
  decision: DecisionModo;
  /** Lo que había guardado en la base de una sesión anterior. */
  borradorInicial: BorradorCargaInicial | null;
  /** Qué lleva IMEI (criterio de la base, `productos_llevan_serie`). */
  serie: SerieConciliacion;
  onCambiarModo: () => void;
}

export function CargaInicialTable({
  orden,
  itemsOriginales,
  categorias,
  rubro,
  decision,
  borradorInicial,
  serie,
  onCambiarModo,
}: Readonly<Props>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // La alerta de IMEI sin completar al confirmar (null = cerrada).
  const [faltantesImei, setFaltantesImei] = useState<FaltanteImei[] | null>(
    null,
  );

  const [recargo, setRecargo] = useState<number | "">(
    borradorInicial?.recargo ?? RECARGO_DEFAULT,
  );
  const [filas, setFilas] = useState<FilaCargaInicial[]>(
    () =>
      borradorInicial?.filas ??
      construirFilasCargaInicial({
        items: itemsOriginales,
        categorias,
        rubro,
        recargoPorcentaje: RECARGO_DEFAULT,
      }),
  );
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [categoriaEnLote, setCategoriaEnLote] = useState("");
  const [marcaEnLote, setMarcaEnLote] = useState("");
  const [markupEnLote, setMarkupEnLote] = useState<number | "">("");
  const [confirmando, setConfirmando] = useState(false);
  const [guardado, setGuardado] = useState<"limpio" | "guardando" | "guardado">(
    "limpio",
  );

  const nuevas = useMemo(() => filas.filter((f) => !f.yaExistia), [filas]);
  const existentes = useMemo(() => filas.filter((f) => f.yaExistia), [filas]);
  const unidadesTotales = useMemo(
    () => filas.reduce((total, f) => total + unidadesDeFila(f), 0),
    [filas],
  );
  /**
   * El árbol para los selectores de categoría, padre → subcategoría.
   *
   * Antes era UN select plano con las 50 categorías de Evens etiquetadas
   * "Padre › Hijo", y esta pantalla lo abre una vez POR FILA: un remito de 94
   * grupos es 94 veces scrollear la misma lista larga. Ahora son dos pasos (7
   * padres, después los hijos de ese padre), con el mismo componente que la
   * otra pantalla de esta conciliación.
   */
  const arbolCategorias = useArbolParaElegir(categorias);

  const categoriasNuevas = useMemo(
    () =>
      new Set(
        nuevas
          .filter((f) => !f.categoriaId && f.categoriaNombreNueva)
          .map((f) => f.categoriaNombreNueva as string),
      ),
    [nuevas],
  );

  // ---- IMEI ---------------------------------------------------------------
  // Una fila que ya existía lleva IMEI si la base lo dice. Una que se CREA
  // acá, si su categoría lo pide: marcada, o llamada "Celulares"/"Tablets"
  // (ella o la de arriba, también si se crea en este momento). Es el espejo
  // del trigger `productos_lleva_serie_por_categoria`, que marca el producto
  // al crearlo.
  const productosConSerie = useMemo(() => new Set(serie.productos), [serie]);
  const categoriasConSerie = useMemo(() => new Set(serie.categorias), [serie]);
  const categoriaPideImei = (f: FilaCargaInicial): boolean => {
    if (!f.categoriaId) return categoriaPideImeiPorNombre(f.categoriaNombreNueva);
    if (categoriasConSerie.has(f.categoriaId)) return true;
    const cat = categorias.find((c) => c.id === f.categoriaId);
    const padre = cat?.parent_id
      ? categorias.find((c) => c.id === cat.parent_id)
      : undefined;
    return (
      categoriaPideImeiPorNombre(cat?.nombre) ||
      categoriaPideImeiPorNombre(padre?.nombre)
    );
  };
  const filaLlevaSerie = (f: FilaCargaInicial) =>
    f.yaExistia
      ? Boolean(f.productoId && productosConSerie.has(f.productoId))
      : categoriaPideImei(f);
  const rawImeiPorItem = useMemo(
    () => new Map(itemsOriginales.map((i) => [i.id ?? "", i.raw_imei ?? null])),
    [itemsOriginales],
  );
  const renglonesImei: RenglonImei[] = filas
    .filter(filaLlevaSerie)
    .flatMap((f) =>
      f.lineas
        .filter((l) => l.cantidad > 0)
        .map((l) => ({
          itemId: l.itemId,
          nombre: f.nombre || f.rawNombre,
          variante: l.variante,
          cantidad: l.cantidad,
          rawImei: rawImeiPorItem.get(l.itemId) ?? null,
          imeis: l.imeis ?? [],
        })),
    );

  function editarImeis(itemId: string, imeis: string[]) {
    setFilas((prev) =>
      prev.map((f) =>
        f.lineas.some((l) => l.itemId === itemId)
          ? {
              ...f,
              lineas: f.lineas.map((l) =>
                l.itemId === itemId ? { ...l, imeis } : l,
              ),
            }
          : f,
      ),
    );
  }

  // ---- Persistencia: el borrador vive en la BASE ------------------------
  // El de IndexedDB (merge-draft-db.ts) sobrevive a cerrar la pestaña pero no
  // a cambiar de máquina ni a limpiar el navegador, y un remito de 94 grupos
  // es media hora de tipeo. Debounce de 1,2s: se guarda mientras se trabaja,
  // no en cada tecla.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    setGuardado("guardando");
    const timer = setTimeout(() => {
      const borrador: BorradorCargaInicial = {
        version: 1,
        modo: "CARGA_INICIAL",
        filas,
        recargo: recargo === "" ? RECARGO_DEFAULT : recargo,
      };
      guardarBorradorOrdenAction(orden.id, borrador).then((res) =>
        setGuardado(res.ok ? "guardado" : "limpio"),
      );
    }, 1200);
    return () => clearTimeout(timer);
  }, [filas, recargo, orden.id]);

  // ---- Edición ----------------------------------------------------------

  function editarFila(key: string, cambios: Partial<FilaCargaInicial>) {
    setFilas((prev) =>
      prev.map((f) => (f.key === key ? { ...f, ...cambios } : f)),
    );
  }

  function editarCantidad(key: string, itemId: string, cantidad: number) {
    if (!Number.isFinite(cantidad) || cantidad < 0) return;
    setFilas((prev) =>
      prev.map((f) =>
        f.key === key
          ? {
              ...f,
              lineas: f.lineas.map((l) =>
                l.itemId === itemId ? { ...l, cantidad } : l,
              ),
            }
          : f,
      ),
    );
  }

  function quitarFila(key: string) {
    setFilas((prev) => prev.filter((f) => f.key !== key));
    setSeleccion((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function toggleSeleccion(key: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleTodas() {
    setSeleccion((prev) =>
      prev.size === nuevas.length
        ? new Set()
        : new Set(nuevas.map((f) => f.key)),
    );
  }

  /** Recalcula el precio de venta desde el costo. Explícito y no automático:
   * pisa precios ya tipeados, y eso tiene que ser una decisión. */
  function aplicarRecargo(porcentaje: number, soloSeleccionadas: boolean) {
    const alcance = soloSeleccionadas ? seleccion : null;
    const enAlcance = (f: FilaCargaInicial) =>
      !f.yaExistia && (!alcance || alcance.has(f.key));

    // Los conteos se calculan ACÁ y no dentro del updater: en StrictMode el
    // updater corre dos veces y saldrían al doble.
    const tocadas = filas.filter((f) => enAlcance(f) && f.costo > 0).length;
    const sinCosto = filas.filter((f) => enAlcance(f) && f.costo <= 0).length;

    setFilas((prev) =>
      prev.map((f) =>
        enAlcance(f) && f.costo > 0
          ? { ...f, precio: Math.ceil(f.costo * (1 + porcentaje / 100)) }
          : f,
      ),
    );

    if (tocadas === 0) {
      toast.error(
        "Ninguna de esas filas tiene costo cargado: no hay sobre qué calcular el precio.",
      );
      return;
    }
    toast.success(
      `Precio recalculado con ${porcentaje}% en ${tocadas} producto${tocadas === 1 ? "" : "s"}.${
        sinCosto > 0 ? ` ${sinCosto} sin costo quedaron como estaban.` : ""
      }`,
    );
  }

  function aplicarCategoriaEnLote() {
    if (!categoriaEnLote || seleccion.size === 0) return;
    const cat = categorias.find((c) => c.id === categoriaEnLote);
    setFilas((prev) =>
      prev.map((f) =>
        seleccion.has(f.key)
          ? { ...f, categoriaId: categoriaEnLote, categoriaNombreNueva: null }
          : f,
      ),
    );
    toast.success(
      `"${cat?.nombre ?? "Categoría"}" aplicada a ${seleccion.size} producto${
        seleccion.size === 1 ? "" : "s"
      }.`,
    );
    setSeleccion(new Set());
    setCategoriaEnLote("");
  }

  function aplicarMarcaEnLote() {
    const marca = marcaEnLote.trim();
    if (!marca || seleccion.size === 0) return;
    setFilas((prev) =>
      prev.map((f) => (seleccion.has(f.key) ? { ...f, marca } : f)),
    );
    toast.success(
      `Marca "${marca}" aplicada a ${seleccion.size} producto${seleccion.size === 1 ? "" : "s"}.`,
    );
    setSeleccion(new Set());
    setMarcaEnLote("");
  }

  function aplicarMarkupEnLote() {
    if (markupEnLote === "" || seleccion.size === 0) return;
    aplicarRecargo(Number(markupEnLote), true);
    setSeleccion(new Set());
    setMarkupEnLote("");
  }

  // ---- Confirmación ------------------------------------------------------

  async function confirmar(aprobarSinImei = false) {
    if (confirmando) return;

    const sinNombre = nuevas.find((f) => !f.nombre.trim());
    if (sinNombre) {
      toast.error(`Falta el nombre de "${sinNombre.rawNombre}".`);
      return;
    }
    const sinPrecio = nuevas.find((f) => f.precio <= 0);
    if (sinPrecio) {
      toast.error(
        `Falta el precio de venta de "${sinPrecio.nombre || sinPrecio.rawNombre}". Sin eso no se puede cobrar.`,
      );
      return;
    }
    const sinCantidad = filas.find((f) => unidadesDeFila(f) <= 0);
    if (sinCantidad) {
      toast.error(
        `"${sinCantidad.nombre || sinCantidad.rawNombre}" no tiene unidades para ingresar.`,
      );
      return;
    }

    // IMEI: lo que la base va a rechazar se frena acá con los nombres; lo que
    // falta completar se avisa y se puede aprobar igual (el POS lo pide).
    const itemsConImeis = filasAItems(filas, itemsOriginales);
    const problemas = problemasImeis(itemsConImeis);
    if (problemas.length > 0) {
      toast.error(problemas[0], {
        description:
          problemas.length > 1 ? `Y ${problemas.length - 1} más.` : undefined,
      });
      return;
    }
    if (!aprobarSinImei) {
      const conSerie = new Set(renglonesImei.map((r) => r.itemId));
      const faltantes = calcularFaltantesImei(itemsConImeis, (i) =>
        conSerie.has(i.id ?? ""),
      );
      if (faltantes.length > 0) {
        setFaltantesImei(faltantes);
        return;
      }
    }

    setConfirmando(true);
    try {
      // Paso 1: crear las cabeceras de producto. Idempotente por
      // `ordenes_items.producto_id` — reintentar no duplica.
      const aCrear: GrupoParaCrear[] = nuevas
        .filter((f) => !f.productoId)
        .map((f) => ({
          rawNombre: f.rawNombre,
          itemIds: f.lineas.map((l) => l.itemId).filter(Boolean),
          nombre: f.nombre,
          categoriaId: f.categoriaId,
          categoriaNombreNueva: f.categoriaNombreNueva,
          marca: f.marca.trim() || null,
          precio: f.precio,
          costo: f.costo,
        }));

      let mapa: Record<string, string> = {};
      if (aCrear.length > 0) {
        const res = await crearProductosDesdeRemitoAction(orden.id, aCrear);
        if (res.error) {
          toast.error(res.error);
          return;
        }
        mapa = res.productosPorRawNombre;

        // Se guarda en el estado antes de impactar: si la aprobación falla,
        // el reintento ya sabe que estos productos existen.
        setFilas((prev) =>
          prev.map((f) =>
            f.productoId || !mapa[f.rawNombre]
              ? f
              : { ...f, productoId: mapa[f.rawNombre] },
          ),
        );
      }

      // Paso 2: impactar stock y precios. Ya era idempotente por su propio
      // guard (`update ... where estado <> 'APROBADA'`).
      const items = filasAItems(filas, itemsOriginales, mapa);
      const sinResolver = items.filter((i) => !i.producto_id).length;
      if (sinResolver > 0) {
        toast.error(
          `Quedaron ${sinResolver} líneas sin producto. Probá confirmar de nuevo.`,
        );
        return;
      }

      const impacto = await aprobarOrdenAction(
        orden.id,
        orden.proveedor,
        items,
      );
      if (impacto.error) {
        toast.error(impacto.error);
        return;
      }

      await borrarBorradorOrdenAction(orden.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });

      if (impacto.yaAprobada) {
        toast.info("Este remito ya estaba impactado. No se duplicó nada.");
      } else {
        const creados = aCrear.length;
        toast.success(
          `Listo: ${creados} producto${creados === 1 ? "" : "s"} nuevo${
            creados === 1 ? "" : "s"
          } y ${unidadesTotales} unidades en stock.`,
        );
        if (creados > 0) {
          toast.message(`${creados} productos quedaron sin foto`, {
            description: "Podés cargarlas todas juntas cuando quieras.",
            action: {
              label: "Cargar fotos",
              onClick: () => router.push("/stock/fotos-pendientes"),
            },
          });
        }
      }

      router.push("/stock");
      router.refresh();
    } finally {
      setConfirmando(false);
    }
  }

  // ---- Render ------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4 p-2 md:p-4">
      <ProgresoOverlay
        abierto={confirmando}
        titulo="Cargando la mercadería"
        descripcion="Estamos creando los productos e impactando el stock. No cierres esta pantalla."
      />

      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">
            Carga inicial · {orden.proveedor}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {explicarModo(decision)} Revisá lo que ya viene puesto y corregí lo
            que haga falta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {guardado === "guardando"
              ? "Guardando…"
              : guardado === "guardado"
                ? "Progreso guardado"
                : ""}
          </span>
          <Button variant="outline" size="sm" onClick={onCambiarModo}>
            Vincular con productos existentes
          </Button>
        </div>
      </div>

      {/* Recargo global */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background p-3">
        <span className="text-sm font-medium">Precio = costo +</span>
        <Input
          type="number"
          min={0}
          value={recargo}
          onChange={(e) =>
            setRecargo(e.target.value === "" ? "" : Number(e.target.value))
          }
          className="h-9 w-20 text-center"
        />
        <span className="text-sm text-muted-foreground">%</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={recargo === ""}
          onClick={() => aplicarRecargo(Number(recargo), false)}
        >
          Aplicar a todos
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Ya viene aplicado en cada fila. Tocá el botón solo si cambiás el
          porcentaje.
        </span>
      </div>

      {/* Barra de selección */}
      {seleccion.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
          <span className="text-sm font-semibold">
            {seleccion.size} seleccionado{seleccion.size === 1 ? "" : "s"}
          </span>

          <CategoriaPadreHijoSelect
            arbol={arbolCategorias}
            categoriasFlat={categorias}
            value={categoriaEnLote}
            onChange={setCategoriaEnLote}
            size="sm"
            triggerClassName="h-9! w-52 bg-background"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!categoriaEnLote}
            onClick={aplicarCategoriaEnLote}
          >
            Aplicar categoría
          </Button>

          <Input
            value={marcaEnLote}
            onChange={(e) => setMarcaEnLote(e.target.value)}
            placeholder="Marca"
            className="h-9 w-36 bg-background"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!marcaEnLote.trim()}
            onClick={aplicarMarcaEnLote}
          >
            Aplicar marca
          </Button>

          <Input
            type="number"
            min={0}
            value={markupEnLote}
            onChange={(e) =>
              setMarkupEnLote(
                e.target.value === "" ? "" : Number(e.target.value),
              )
            }
            placeholder="%"
            className="h-9 w-20 bg-background text-center"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={markupEnLote === ""}
            onClick={aplicarMarkupEnLote}
          >
            Aplicar recargo
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSeleccion(new Set())}
          >
            Cancelar selección
          </Button>
        </div>
      )}

      {categoriasNuevas.size > 0 && (
        <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Plus className="h-3.5 w-3.5" />
          Se van a crear {categoriasNuevas.size} categoría
          {categoriasNuevas.size === 1 ? "" : "s"} nueva
          {categoriasNuevas.size === 1 ? "" : "s"}:{" "}
          {Array.from(categoriasNuevas).join(", ")}. Cambiá la categoría de la
          fila si no las querés.
        </p>
      )}

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className={ANCHO_MINIMO}>
          <div
            className={`grid ${COLUMNAS} gap-2 border-b border-border bg-muted/30 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground max-md:hidden`}
          >
            <input
              type="checkbox"
              aria-label="Seleccionar todo"
              className="h-4 w-4 cursor-pointer"
              checked={seleccion.size > 0 && seleccion.size === nuevas.length}
              onChange={toggleTodas}
            />
            <span>Producto</span>
            <span>Categoría</span>
            <span>Marca</span>
            <span className="text-center">Costo</span>
            <span className="text-center">Precio</span>
            <span>Variantes y cantidades</span>
            <span />
          </div>

          <div className="divide-y divide-border">
            {nuevas.map((fila) => (
              <div
                key={fila.key}
                className={`grid ${COLUMNAS} items-start gap-2 px-3 py-2 max-md:grid-cols-1 max-md:border-b max-md:border-border max-md:py-3 ${
                  seleccion.has(fila.key) ? "bg-primary/5" : ""
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={`Seleccionar ${fila.nombre}`}
                  className="mt-2 h-4 w-4 cursor-pointer"
                  checked={seleccion.has(fila.key)}
                  onChange={() => toggleSeleccion(fila.key)}
                />

                <div className="min-w-0">
                  <Input
                    value={fila.nombre}
                    aria-label="Nombre del producto"
                    onChange={(e) =>
                      editarFila(fila.key, { nombre: e.target.value })
                    }
                    className={`h-9 w-full ${
                      fila.nombre.trim()
                        ? ""
                        : "border-destructive focus-visible:ring-destructive"
                    }`}
                  />
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {fila.rawNombre}
                    {fila.genero ? ` · ${fila.genero}` : ""}
                  </p>
                </div>

                <div className="min-w-0">
                  {/* `h-9!` y no `h-9`: el trigger trae
                      `sm:data-[size=sm]:h-7`, un selector de más especificidad
                      que una clase suelta, así que en desktop ganaba él y el
                      select quedaba 8px más bajo que el input de al lado.

                      El placeholder del select 1 lleva la categoría propuesta
                      cuando no hay ninguna elegida: es lo que se va a CREAR si
                      no se toca nada, y esconderlo detrás de "Elegí categoría"
                      lo dejaba sin avisar. */}
                  <CategoriaPadreHijoSelect
                    arbol={arbolCategorias}
                    categoriasFlat={categorias}
                    value={fila.categoriaId ?? ""}
                    onChange={(val) =>
                      editarFila(fila.key, {
                        categoriaId: val,
                        categoriaNombreNueva: null,
                      })
                    }
                    size="sm"
                    triggerClassName="h-9! w-full bg-background"
                    placeholderPadre={
                      fila.categoriaNombreNueva
                        ? `${fila.categoriaNombreNueva} (nueva)`
                        : "Elegí categoría"
                    }
                  />
                  {!fila.categoriaId && fila.categoriaNombreNueva && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-chart-3">
                      <Sparkles className="h-3 w-3" /> se crea
                    </p>
                  )}
                </div>

                <div data-label="Marca" className={CELDA_APILADA}>
                  <Input
                    value={fila.marca}
                    aria-label="Marca"
                    placeholder="—"
                    onChange={(e) =>
                      editarFila(fila.key, { marca: e.target.value })
                    }
                    className="h-9 w-full"
                  />
                </div>

                <div data-label="Costo" className={CELDA_APILADA}>
                  <Input
                    type="number"
                    min={0}
                    aria-label="Costo"
                    value={fila.costo > 0 ? fila.costo : ""}
                    placeholder="0"
                    onChange={(e) => {
                      const costo = Number.parseFloat(e.target.value);
                      const nuevoCosto = Number.isNaN(costo) ? 0 : costo;
                      editarFila(fila.key, {
                        costo: nuevoCosto,
                        // El precio sigue al costo mientras nadie lo haya
                        // tocado a mano: si no, corregir un costo dejaba el
                        // precio viejo, que es peor que no tener ninguno.
                        precio: precioSugerido(
                          nuevoCosto,
                          null,
                          recargo === "" ? RECARGO_DEFAULT : recargo,
                        ),
                      });
                    }}
                    className="h-9 w-full text-center"
                  />
                </div>

                <div data-label="Precio de venta" className={CELDA_APILADA}>
                  <Input
                    type="number"
                    min={0}
                    aria-label="Precio de venta"
                    value={fila.precio > 0 ? fila.precio : ""}
                    placeholder="0"
                    onChange={(e) => {
                      const precio = Number.parseFloat(e.target.value);
                      editarFila(fila.key, {
                        precio: Number.isNaN(precio) ? 0 : precio,
                      });
                    }}
                    className={`h-9 w-full text-center ${
                      fila.precio > 0
                        ? ""
                        : "border-destructive focus-visible:ring-destructive"
                    }`}
                  />
                </div>

                <div className="flex flex-wrap gap-1">
                  {fila.lineas.map((linea) => (
                    <label
                      key={linea.itemId}
                      className="flex items-center gap-1 rounded border border-border/70 bg-background px-1.5 py-1 text-[11px] text-muted-foreground"
                      title={linea.variante}
                    >
                      <Layers className="h-3 w-3 shrink-0 opacity-60" />
                      <span className="max-w-28 truncate">
                        {linea.variante}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        aria-label={`Cantidad de ${linea.variante}`}
                        value={linea.cantidad > 0 ? linea.cantidad : ""}
                        placeholder="0"
                        onChange={(e) =>
                          editarCantidad(
                            fila.key,
                            linea.itemId,
                            Number.parseInt(e.target.value, 10) || 0,
                          )
                        }
                        className="h-7 w-14 px-1 text-center"
                      />
                    </label>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => quitarFila(fila.key)}
                  aria-label={`Quitar ${fila.nombre}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Las que el import ya reconoció. No se crean: suman stock. */}
      {existentes.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 p-3">
          <p className="text-sm font-medium text-foreground">
            {existentes.length} producto{existentes.length === 1 ? "" : "s"} de
            este remito ya {existentes.length === 1 ? "está" : "están"} en tu
            catálogo
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            No se crean de nuevo: se les suma el stock y se les actualiza el
            precio.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {existentes.map((f) => (
              <li
                key={f.key}
                className="rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {f.nombre} · {unidadesDeFila(f)} u.
              </li>
            ))}
          </ul>
        </div>
      )}

      <ImeisRemitoPanel renglones={renglonesImei} onChange={editarImeis} />

      <AlertaImeisFaltantes
        faltantes={faltantesImei}
        onCompletar={() => setFaltantesImei(null)}
        onAprobarIgual={() => {
          setFaltantesImei(null);
          void confirmar(true);
        }}
      />

      <Button
        type="button"
        className="h-12 w-full text-sm font-semibold"
        disabled={confirmando || filas.length === 0}
        onClick={() => void confirmar()}
      >
        {confirmando
          ? "Cargando…"
          : `Confirmar carga (${nuevas.length} producto${
              nuevas.length === 1 ? "" : "s"
            } nuevo${nuevas.length === 1 ? "" : "s"} · ${unidadesTotales} u.)`}
      </Button>
    </div>
  );
}
