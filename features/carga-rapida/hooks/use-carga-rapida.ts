"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Producto } from "@/entities/productos/types";
import type { Rubro } from "@/entities/config/types";
import {
  UNIDAD_MEDIDA_DEFAULT,
  normalizarUnidadMedida,
  type UnidadMedida,
} from "@/shared/lib/fiscal-producto";
import {
  normalizarCantidadVendible,
  parsearCantidadDeEntrada,
  redondearCantidad,
} from "@/shared/lib/unidad-venta";
import {
  normalizarCantidadEnForma,
  presentacionesDeVariante,
  type Presentacion,
} from "@/shared/lib/presentaciones";
import {
  matchPorNombre,
  matchSkuExacto,
  normalizarQuery,
} from "../lib/matching";
import { prefillAVariantes } from "../lib/maestro-prefill";
import { confirmarCargaAction } from "../actions/confirmar-carga";
import {
  buscarEnCatalogoMaestroAction,
  buscarEnCatalogoMaestroPorNombreAction,
  obtenerPrefillMaestroAction,
} from "../actions/buscar-en-maestro";
import type { CandidatoMaestro, PrefillMaestro } from "../lib/maestro-prefill";
import type {
  LineaCarga,
  LineaCargaExistente,
  LineaCargaNueva,
  ProductoCargado,
} from "../types";

export type OpcionesCargaRapida = {
  /**
   * Campo de texto controlado desde afuera. En Inventario la Carga rápida
   * tiene su propio input y no hace falta; en el POS el que escribe es el
   * buscador de la barra superior, el MISMO en las dos vistas, así que el
   * texto tiene que vivir allá arriba y no acá adentro.
   */
  query?: string;
  onQueryChange?: (query: string) => void;
  /**
   * Contexto de retorno. La Carga rápida es la misma en todos lados; lo
   * ÚNICO que cambia según desde dónde se abrió es qué pasa al terminar.
   * Sin esto (Inventario), la lista se limpia y se sigue cargando. Con
   * esto (POS), el que invoca decide — cerrar y seguir la venta.
   */
  onFinalizar?: (cargados: ProductoCargado[]) => void;
};

type AltaRapidaPendiente = {
  nombrePrefill: string;
  codigoPrefill: string;
  queryOriginal: string;
  editando: LineaCargaNueva | null;
  /** No-null cuando el EAN escaneado matcheó en el Catálogo Maestro: el
   * modal arranca con nombre/marca/modelo/atributos ya cargados y el
   * empleado solo confirma cantidad y precio. */
  maestro: PrefillMaestro | null;
};

/** Las celdas de la tabla que pueden recibir el foco por teclado. Es el mismo
 * nombre que usa la celda en su `data-celda`, así el hook nombra el destino
 * sin tener refs de la tabla. */
export type CampoDeFoco =
  | "nombre"
  | "codigo"
  | `atributo:${string}`
  | "precioCompra"
  | "precioVenta"
  | "cantidad";

type VarianteResuelta = {
  varianteId: string;
  productoId: string;
  nombreDisplay: string;
  nombreProducto: string;
  sku: string | null;
  precioCosto: number;
  precioVenta: number;
  /** `productos.unidad_medida` tal cual viene del catálogo; se normaliza al
   * armar la línea. */
  unidadMedida: string | null | undefined;
  /** `productos.producto_presentaciones` del catálogo; se resuelven para la
   * variante al armar la línea. */
  presentaciones: Presentacion[] | null | undefined;
};

/** Heurística simple: un código/SKU escaneado no tiene espacios; un
 * nombre de producto tipeado a mano casi siempre sí. No hay datos de
 * sku reales en prod todavía contra los que afinar el patrón. */
function pareceCodigo(q: string): boolean {
  return !/\s/.test(q);
}

/**
 * Más estricta que `pareceCodigo`, y para otra decisión: si lo tipeado va a
 * la columna Código o a la columna Producto de la fila nueva.
 *
 * `pareceCodigo` alcanza para decidir a QUÉ preguntarle al Catálogo Maestro
 * (probar el EAN primero es barato y si falla hay fallback por texto), pero
 * acá el costo del error es distinto: con esa heurística "remera" —una sola
 * palabra— entraría como código y dejaría la fila sin nombre, obligando a
 * retipearlo. Un código de barras o un SKU escaneado tiene 6+ caracteres y
 * al menos un dígito; una palabra suelta no.
 */
function pareceCodigoDeBarras(q: string): boolean {
  return pareceCodigo(q) && q.length >= 6 && /\d/.test(q);
}

export function useCargaRapida(
  productos: Producto[],
  rubro: Rubro,
  opciones?: OpcionesCargaRapida,
) {
  const [lineas, setLineas] = useState<LineaCarga[]>([]);
  const [queryInterna, setQueryInterna] = useState("");
  const query = opciones?.query ?? queryInterna;
  const setQuery = opciones?.onQueryChange ?? setQueryInterna;
  const [pickerCandidatos, setPickerCandidatos] = useState<Producto[] | null>(
    null,
  );
  const [variantSelectorProducto, setVariantSelectorProducto] =
    useState<Producto | null>(null);
  const [altaRapida, setAltaRapida] = useState<AltaRapidaPendiente | null>(
    null,
  );
  const [isConfirming, setIsConfirming] = useState(false);
  const [buscandoEnMaestro, setBuscandoEnMaestro] = useState(false);
  // Candidatos del maestro esperando que el empleado elija uno. Se guarda
  // también el texto que los originó: sin eso, al elegir un candidato no se
  // sabe con qué query dedupear la línea nueva.
  const [maestroCandidatos, setMaestroCandidatos] = useState<{
    lista: CandidatoMaestro[];
    query: string;
    queryNormalizada: string;
  } | null>(null);
  const [resolviendoCandidato, setResolviendoCandidato] = useState<
    string | null
  >(null);
  const [recargoGlobal, setRecargoGlobal] = useState<number | "">("");
  /** Celda que tiene que recibir el foco apenas se renderice la fila nueva.
   * Lo decide el hook (sabe por qué nació la línea) y lo aplica la tabla (es
   * la que tiene los inputs). */
  const [focoPendiente, setFocoPendiente] = useState<{
    clienteLineaId: string;
    campo: CampoDeFoco;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const modalAbierto =
    pickerCandidatos !== null ||
    variantSelectorProducto !== null ||
    altaRapida !== null ||
    maestroCandidatos !== null;

  // El input se deshabilita mientras hay un modal abierto o mientras vuelve la
  // consulta al maestro, y un input deshabilitado pierde el foco. Hay que
  // devolvérselo apenas se rehabilita por CUALQUIERA de las dos causas: si
  // esto solo mira `modalAbierto`, cada búsqueda en el maestro deja el foco
  // perdido y obliga a clickear antes de escanear la caja siguiente.
  useEffect(() => {
    if (!modalAbierto && !buscandoEnMaestro) inputRef.current?.focus();
  }, [modalAbierto, buscandoEnMaestro]);

  function resolverVariante(payload: VarianteResuelta) {
    setLineas((prev) => {
      const idx = prev.findIndex(
        (l): l is LineaCargaExistente =>
          l.kind === "EXISTENTE" && l.varianteId === payload.varianteId,
      );
      if (idx >= 0) {
        const copia = [...prev];
        const actual = copia[idx] as LineaCargaExistente;
        copia[idx] = { ...actual, cantidad: actual.cantidad + 1 };
        return copia;
      }
      const nueva: LineaCargaExistente = {
        kind: "EXISTENTE",
        clienteLineaId: crypto.randomUUID(),
        varianteId: payload.varianteId,
        productoId: payload.productoId,
        nombreDisplay: payload.nombreDisplay,
        nombreProducto: payload.nombreProducto,
        sku: payload.sku,
        cantidad: 1,
        precioCosto: payload.precioCosto,
        precioVenta: payload.precioVenta,
        unidadMedida: normalizarUnidadMedida(payload.unidadMedida),
        presentaciones: presentacionesDeVariante(
          payload.presentaciones,
          payload.varianteId,
        ),
        presentacionId: null,
      };
      return [...prev, nueva];
    });
    setPickerCandidatos(null);
    setVariantSelectorProducto(null);
  }

  function incrementarLinea(clienteLineaId: string) {
    setLineas((prev) =>
      prev.map((l) => {
        if (l.clienteLineaId !== clienteLineaId) return l;
        if (l.kind === "NUEVA" && l.tieneVariantes) {
          // Reescanear la misma caja suma una unidad a la variante fija, que
          // es lo que espera quien está pasando la pickeadora por un pallet.
          if (!l.varianteFijaLabel) return l;
          return {
            ...l,
            variantes: l.variantes.map((v, i) =>
              i === 0
                ? {
                    ...v,
                    stock: String(parsearCantidadDeEntrada(v.stock) + 1),
                  }
                : v,
            ),
          };
        }
        return { ...l, cantidad: l.cantidad + 1 };
      }),
    );
  }

  /**
   * Agrega una línea nueva SIN pasar por el modal de alta: nombre y nada más,
   * precio y cantidad se completan inline en la fila.
   *
   * Es el camino por defecto de TODA alta: la card "crear" de la grilla del
   * POS y también el Enter que no matcheó nada. La persona ya sabe que el
   * producto no existe; preguntárselo de nuevo en un modal es una pantalla de
   * por medio para cargar tres números que entran en la fila.
   *
   * Si ya hay una línea para ese texto, suma en vez de duplicar — mismo
   * criterio de dedupe que `procesarEnter`.
   *
   * `esCodigo`: lo escaneado/tipeado es un código, no un nombre. Va a la
   * columna Código y el nombre queda vacío para completarlo en la fila —
   * escribirlo como nombre dejaría productos llamados "7791234567890".
   */
  function agregarLineaNueva(
    textoCrudo: string,
    opciones?: { esCodigo?: boolean },
  ) {
    const texto = textoCrudo.trim();
    if (!texto) return;

    const esCodigo = opciones?.esCodigo ?? false;
    const nombre = esCodigo ? "" : texto;

    const normalizado = normalizarQuery(texto);
    const yaEsta = lineas.find(
      (l): l is LineaCargaNueva =>
        l.kind === "NUEVA" &&
        (l.queryOriginal === normalizado ||
          (l.nombre !== "" && normalizarQuery(l.nombre) === normalizado) ||
          (l.codigo !== null && normalizarQuery(l.codigo) === normalizado)),
    );
    if (yaEsta) {
      if (!yaEsta.tieneVariantes) incrementarLinea(yaEsta.clienteLineaId);
      setQuery("");
      return;
    }

    const clienteLineaId = crypto.randomUUID();

    // Enter en el buscador deja el cursor DENTRO de la fila recién creada: lo
    // que sigue a agregarla es completarla, y llegar hasta ahí con el mouse o
    // con seis Tab es la mitad del tiempo de la carga. En el primer campo que
    // hay que completar: el nombre si entró un código escaneado (queda vacío a
    // propósito), y si no el costo, que es el primero de los tres números.
    setFocoPendiente({
      clienteLineaId,
      campo: nombre ? "precioCompra" : "nombre",
    });

    setLineas((prev) => [
      ...prev,
      {
        kind: "NUEVA",
        clienteLineaId,
        queryOriginal: normalizado,
        nombre,
        codigo: esCodigo ? texto : null,
        marca: null,
        modelo: null,
        categoriaId: null,
        precioCompra: 0,
        precioVenta: 0,
        idMaster: null,
        unidadMedida: UNIDAD_MEDIDA_DEFAULT,
        tieneVariantes: false,
        cantidad: 1,
        atributos: {},
      },
    ]);
    setQuery("");
  }

  function abrirEdicionLineaNueva(linea: LineaCargaNueva) {
    setAltaRapida({
      queryOriginal: linea.queryOriginal,
      nombrePrefill: linea.nombre,
      codigoPrefill: linea.codigo ?? "",
      editando: linea,
      // Al reeditar, los datos del maestro ya están copiados en la línea —
      // no se vuelve a consultar.
      maestro: null,
    });
  }

  function seleccionarProducto(producto: Producto) {
    const variantes = producto.producto_variantes ?? [];
    if (variantes.length === 0) {
      toast.error(
        `"${producto.nombre}" no tiene variantes cargadas — no se puede recibir stock para este producto todavía.`,
      );
      setPickerCandidatos(null);
      return;
    }
    if (variantes.length === 1) {
      resolverVariante({
        varianteId: variantes[0].id,
        productoId: producto.id,
        nombreDisplay: variantes[0].nombre_display,
        nombreProducto: producto.nombre,
        sku: variantes[0].sku ?? null,
        precioCosto: variantes[0].costo ?? producto.precio_costo ?? 0,
        precioVenta: variantes[0].precio ?? producto.precio,
        unidadMedida: producto.unidad_medida,
        presentaciones: producto.producto_presentaciones,
      });
      return;
    }
    setPickerCandidatos(null);
    setVariantSelectorProducto(producto);
  }

  /**
   * Agrega la línea directo, sin pasar por el modal de combinaciones.
   *
   * Solo para match del maestro en electro: una fila del maestro ES una
   * combinación concreta (128GB / Black) con su propio EAN, así que la
   * variante ya está resuelta y la matriz no aporta nada. El empleado
   * completa precio y cantidad inline en la lista.
   *
   * Precios en 0 a propósito: el maestro no tiene precios y no debe
   * inventarlos. La línea queda visiblemente incompleta hasta que los carga.
   */
  function agregarLineaDesdeMaestro(
    prefill: PrefillMaestro,
    queryNormalizada: string,
  ) {
    const { opciones, variantes } = prefillAVariantes(prefill);

    const base = {
      kind: "NUEVA" as const,
      clienteLineaId: crypto.randomUUID(),
      queryOriginal: queryNormalizada,
      nombre: prefill.nombre,
      codigo: prefill.ean || null,
      marca: prefill.marca,
      modelo: prefill.modelo,
      categoriaId: prefill.categoriaId,
      precioCompra: 0,
      precioVenta: 0,
      idMaster: prefill.idMaster,
      unidadMedida: UNIDAD_MEDIDA_DEFAULT,
    };

    // Sin atributos en el maestro no hay combinación que congelar: es un
    // producto simple y sigue el camino de cantidad a nivel línea.
    const nueva: LineaCargaNueva =
      opciones.length > 0 && variantes.length > 0
        ? {
            ...base,
            tieneVariantes: true,
            opciones,
            variantes,
            varianteFijaLabel: Object.values(prefill.atributos).join(" / "),
          }
        : {
            ...base,
            tieneVariantes: false,
            cantidad: 1,
            atributos: {},
          };

    setLineas((prev) => [...prev, nueva]);
    // Del maestro viene todo menos los precios (no los tiene y no debe
    // inventarlos), así que el cursor va derecho al costo.
    setFocoPendiente({
      clienteLineaId: nueva.clienteLineaId,
      campo: "precioCompra",
    });
  }

  /** "Ninguno de estos": carga la línea a mano con lo que ya venía tipeado,
   * sin perder el texto. También es el camino de salida si resolver el
   * candidato falla. */
  function abrirAltaManualDesdeMaestro() {
    const actual = maestroCandidatos;
    if (!actual) return;
    setMaestroCandidatos(null);
    agregarLineaNueva(actual.query, {
      esCodigo: pareceCodigoDeBarras(actual.query),
    });
  }

  async function elegirCandidatoMaestro(candidato: CandidatoMaestro) {
    if (!maestroCandidatos || resolviendoCandidato) return;

    setResolviendoCandidato(candidato.idMaster);
    try {
      const prefill = await obtenerPrefillMaestroAction(candidato.idMaster);

      if (!prefill) {
        toast.error(
          "No se pudo traer ese producto del Catálogo Maestro. Cargalo a mano.",
        );
        abrirAltaManualDesdeMaestro();
        return;
      }

      // Igual que el match por EAN: la variante ya vino resuelta del maestro,
      // así que la línea entra directo a la lista sin modal de combinaciones.
      agregarLineaDesdeMaestro(prefill, maestroCandidatos.queryNormalizada);
      setMaestroCandidatos(null);
    } finally {
      setResolviendoCandidato(null);
    }
  }

  async function procesarEnter(rawQuery: string) {
    const q = rawQuery.trim();
    if (!q) return;

    // 1. Match exacto de SKU/código de barras. El mismo código puede
    // identificar varios talles/colores de un mismo modelo — o, en datos
    // sucios, hasta productos distintos — así que nunca se toma "el
    // primero": con 1 sola variante resuelve directo, con más se abre el
    // mismo selector que ya se usa para nombre-ambiguo.
    const matchesSku = matchSkuExacto(productos, q);
    if (matchesSku.length === 1) {
      const m = matchesSku[0];
      resolverVariante({
        varianteId: m.variante.id,
        productoId: m.producto.id,
        nombreDisplay: m.variante.nombre_display,
        nombreProducto: m.producto.nombre,
        sku: m.variante.sku ?? null,
        precioCosto: m.variante.costo ?? m.producto.precio_costo ?? 0,
        precioVenta: m.variante.precio ?? m.producto.precio,
        unidadMedida: m.producto.unidad_medida,
        presentaciones: m.producto.producto_presentaciones,
      });
      setQuery("");
      return;
    }
    if (matchesSku.length > 1) {
      const productosUnicos = Array.from(
        new Map(matchesSku.map((m) => [m.producto.id, m.producto])).values(),
      );
      if (productosUnicos.length === 1) {
        setVariantSelectorProducto(productosUnicos[0]);
      } else {
        setPickerCandidatos(productosUnicos);
      }
      setQuery("");
      return;
    }

    // 2. Dedupe contra líneas NUEVA ya agregadas en esta sesión — tiene
    // que ir antes de la búsqueda por nombre porque el producto todavía
    // no existe en la base. Matchea contra el texto que disparó el alta,
    // pero TAMBIÉN contra el nombre y el código que se hayan cargado en el
    // formulario: si el alta se disparó escaneando "remera" y ahí se le
    // cargó el código "1420", un reescaneo posterior de "1420" (o de
    // "remera" de nuevo) tiene que sumar a la MISMA línea, no abrir el
    // alta rápida de nuevo.
    const normalizado = normalizarQuery(q);
    const lineaNueva = lineas.find(
      (l): l is LineaCargaNueva =>
        l.kind === "NUEVA" &&
        (l.queryOriginal === normalizado ||
          normalizarQuery(l.nombre) === normalizado ||
          (l.codigo !== null && normalizarQuery(l.codigo) === normalizado)),
    );
    if (lineaNueva) {
      // Con variantes no hay una "cantidad" única para sumarle +1 — se
      // reabre el modal para que el usuario ajuste la grilla a mano. Salvo
      // que la variante venga fija del maestro: ahí sí hay una sola y suma.
      if (lineaNueva.tieneVariantes && !lineaNueva.varianteFijaLabel) {
        abrirEdicionLineaNueva(lineaNueva);
      } else {
        incrementarLinea(lineaNueva.clienteLineaId);
      }
      setQuery("");
      return;
    }

    // 3. Búsqueda por nombre.
    const candidatos = matchPorNombre(productos, q);
    if (candidatos.length === 0) {
      const esCodigo = pareceCodigo(q);

      // 4. Último recurso antes del alta manual: si parece un código, se
      // consulta el Catálogo Maestro (otro proyecto, solo lectura). Solo
      // para códigos — buscar un nombre tipeado ahí no tendría sentido, el
      // maestro se indexa por EAN — y solo en electro: el maestro no tiene
      // nada que decir sobre una remera, así que en indumentaria ni se
      // intenta (la action lo rechaza igual; esto evita el viaje y el
      // spinner de "Buscando en el Catálogo Maestro…").
      //
      // La query se limpia ANTES del await para que la pickeadora no quede
      // acumulando el próximo escaneo sobre el texto viejo mientras vuelve
      // la red.
      setQuery("");

      let maestro: PrefillMaestro | null = null;
      if (rubro === "electro") {
        setBuscandoEnMaestro(true);
        try {
          // Si parece un código se prueba primero el EAN exacto, que es el
          // camino barato y sin ambigüedad.
          if (esCodigo) {
            maestro = await buscarEnCatalogoMaestroAction(q);
          }

          // Si el EAN no resolvió, se busca por texto. Esto cubre los dos
          // agujeros reales: los productos del maestro sin ean_gtin cargado, y
          // el empleado que tipea el nombre en vez de escanear. Ojo que
          // pareceCodigo() marca "moto" como código (no tiene espacios), así
          // que sin este fallback tipear una sola palabra no encontraba nada.
          if (!maestro) {
            const candidatos = await buscarEnCatalogoMaestroPorNombreAction(q);
            if (candidatos.length > 0) {
              setMaestroCandidatos({
                lista: candidatos,
                query: q,
                queryNormalizada: normalizado,
              });
              return;
            }
          }
        } finally {
          setBuscandoEnMaestro(false);
        }
      }

      // Con match del maestro la variante ya está resuelta: línea directo a la
      // lista. Sin match, la línea entra igual de directo y se completa en la
      // fila — el alta ya no pasa por un modal.
      if (maestro) {
        agregarLineaDesdeMaestro(maestro, normalizado);
        return;
      }

      agregarLineaNueva(q, { esCodigo: pareceCodigoDeBarras(q) });
      return;
    }
    if (candidatos.length === 1) {
      seleccionarProducto(candidatos[0]);
      setQuery("");
      return;
    }
    setPickerCandidatos(candidatos);
    setQuery("");
  }

  function guardarAltaRapida(
    datos: {
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
      | {
          tieneVariantes: true;
          opciones: Extract<
            LineaCargaNueva,
            { tieneVariantes: true }
          >["opciones"];
          variantes: Extract<
            LineaCargaNueva,
            { tieneVariantes: true }
          >["variantes"];
        }
    ),
  ) {
    if (!altaRapida) return;
    const base = {
      kind: "NUEVA" as const,
      clienteLineaId: datos.editandoLineaId ?? crypto.randomUUID(),
      queryOriginal: altaRapida.queryOriginal,
      nombre: datos.nombre,
      codigo: datos.codigo.trim() || null,
      marca: datos.marca.trim() || null,
      modelo: datos.modelo.trim() || null,
      categoriaId: datos.categoriaId || null,
      precioCompra: datos.precioCompra,
      precioVenta: datos.precioVenta,
      // Se preserva al reeditar una línea que ya venía del maestro.
      idMaster:
        altaRapida.maestro?.idMaster ?? altaRapida.editando?.idMaster ?? null,
      // Se elige inline en la fila, no en el modal: al reeditar hay que
      // preservarla o guardar el modal la devolvería a UNIDAD sin avisar.
      unidadMedida: altaRapida.editando?.unidadMedida ?? UNIDAD_MEDIDA_DEFAULT,
    };
    const nueva: LineaCargaNueva = datos.tieneVariantes
      ? {
          ...base,
          tieneVariantes: true,
          opciones: datos.opciones,
          variantes: datos.variantes,
        }
      : {
          ...base,
          tieneVariantes: false,
          cantidad: datos.cantidad,
          // El modal no edita los atributos inline de la fila: al reeditar
          // una línea simple hay que preservar lo que ya se cargó, o guardar
          // el modal se los comería sin avisar.
          atributos:
            altaRapida.editando && !altaRapida.editando.tieneVariantes
              ? altaRapida.editando.atributos
              : {},
        };

    setLineas((prev) =>
      datos.editandoLineaId
        ? prev.map((l) =>
            l.clienteLineaId === datos.editandoLineaId ? nueva : l,
          )
        : [...prev, nueva],
    );
    setAltaRapida(null);
  }

  function updateCantidad(clienteLineaId: string, cantidad: number) {
    // Se acepta 0 para que el campo inline se pueda vaciar y retipear; la
    // línea queda marcada como incompleta y `confirmar` la frena.
    if (!Number.isFinite(cantidad) || cantidad < 0) return;
    // Al gramo, que es lo que guarda la base. Un producto por unidad no
    // debería recibir decimales, pero eso lo frena `confirmar` con el nombre
    // de la línea puesto, no un redondeo silencioso acá.
    cantidad = redondearCantidad(cantidad);
    setLineas((prev) =>
      prev.map((l) => {
        if (l.clienteLineaId !== clienteLineaId) return l;
        if (l.kind === "NUEVA" && l.tieneVariantes) {
          // Con variante fija del maestro hay UNA sola combinación, así que la
          // cantidad de la línea es su stock. Sin variante fija (matriz armada
          // a mano) no existe una cantidad única: se edita en el modal.
          if (!l.varianteFijaLabel) return l;
          return {
            ...l,
            variantes: l.variantes.map((v, i) =>
              i === 0 ? { ...v, stock: String(cantidad) } : v,
            ),
          };
        }
        // Líneas simples y EXISTENTE: no bajan de 1. Una línea de 0 unidades
        // no significa nada — para eso está el botón de quitar.
        if (cantidad <= 0) return l;
        return { ...l, cantidad };
      }),
    );
  }

  /**
   * Por qué se vende el producto NUEVO. Solo para líneas nuevas: la de un
   * producto que ya existe la trae del catálogo y se cambia editando el
   * producto, no desde una recepción de stock.
   */
  function updateUnidadLinea(clienteLineaId: string, unidad: UnidadMedida) {
    setLineas((prev) =>
      prev.map((l) =>
        l.clienteLineaId === clienteLineaId && l.kind === "NUEVA"
          ? { ...l, unidadMedida: normalizarUnidadMedida(unidad) }
          : l,
      ),
    );
  }

  /**
   * En qué FORMA entra el stock de un producto que ya existe: la unidad base
   * (null) o una de sus presentaciones ("3 baldes"). Cambiar de forma
   * redondea la cantidad a entero cuando pasa a presentación: 2,5 baldes no
   * existen, y dejar el decimal solo trasladaría el rechazo a Confirmar.
   */
  function updateFormaLinea(clienteLineaId: string, presentacionId: string | null) {
    setLineas((prev) =>
      prev.map((l) => {
        if (l.clienteLineaId !== clienteLineaId || l.kind !== "EXISTENTE") return l;
        const valida =
          presentacionId === null ||
          l.presentaciones.some((p) => p.id === presentacionId);
        if (!valida) return l;
        const cantidad =
          presentacionId === null
            ? l.cantidad
            : Math.max(1, Math.round(l.cantidad));
        return { ...l, presentacionId, cantidad };
      }),
    );
  }

  /** Edición inline de precios en la lista, para las líneas de variante fija:
   * el maestro no trae precios, así que se cargan acá en vez de en el modal. */
  function updatePrecioLinea(
    clienteLineaId: string,
    campo: "precioCompra" | "precioVenta",
    valor: number,
  ) {
    if (!Number.isFinite(valor) || valor < 0) return;
    setLineas((prev) =>
      prev.map((l) =>
        l.clienteLineaId === clienteLineaId && l.kind === "NUEVA"
          ? { ...l, [campo]: valor }
          : l,
      ),
    );
  }

  /**
   * Calcula el precio de venta de TODAS las líneas nuevas a partir de su
   * costo y el recargo global: `ceil(costo * (1 + r/100))`, la misma cuenta
   * que "Aplicar recargo global" en la conciliación de remitos y que la
   * sugerencia del modal de alta.
   *
   * Es explícito (botón) y no automático a propósito: pisa precios de venta
   * ya tipeados a mano, y eso tiene que ser una decisión, no un efecto de
   * tocar el campo del porcentaje.
   *
   * Las líneas EXISTENTE quedan afuera: su precio es el del catálogo y la
   * Carga rápida no cambia precios de lo que ya existe (confirmar-carga ni
   * siquiera manda ese dato). Las que no tienen costo cargado tampoco se
   * tocan — sin costo la cuenta daría 0, o sea una línea que después frena la
   * confirmación por precio inválido.
   */
  function aplicarRecargoGlobal() {
    if (recargoGlobal === "" || Number(recargoGlobal) < 0) {
      toast.error("Cargá un porcentaje de recargo antes de aplicarlo.");
      return;
    }

    const factor = 1 + Number(recargoGlobal) / 100;
    // Los conteos se calculan ACÁ y no dentro del updater: en StrictMode el
    // updater corre dos veces y los contadores saldrían al doble.
    const nuevas = lineas.filter((l) => l.kind === "NUEVA");
    const aplicadas = nuevas.filter((l) => l.precioCompra > 0).length;
    const sinCosto = nuevas.length - aplicadas;

    setLineas((prev) =>
      prev.map((l) =>
        l.kind === "NUEVA" && l.precioCompra > 0
          ? { ...l, precioVenta: Math.ceil(l.precioCompra * factor) }
          : l,
      ),
    );

    if (aplicadas === 0) {
      toast.error(
        "Ninguna línea nueva tiene costo cargado: no hay sobre qué calcular el recargo.",
      );
      return;
    }

    toast.success(
      `Recargo del ${recargoGlobal}% aplicado a ${aplicadas} línea${
        aplicadas === 1 ? "" : "s"
      }.${sinCosto > 0 ? ` ${sinCosto} sin costo quedaron como estaban.` : ""}`,
    );
  }

  /**
   * Edición inline de los campos de texto de una línea nueva: nombre, código
   * y los atributos de variante del rubro (`atributo:<clave>`, ej.
   * `atributo:talle`, `atributo:peso`).
   *
   * `nombre` es string y puede quedar vacío mientras se tipea (la fila se
   * marca y `confirmar` la frena). El código guarda null cuando queda vacío y
   * un atributo vacío se saca del mapa: son opcionales y un string vacío
   * llegaría al alta como un atributo sin valor.
   *
   * Atributos y código solo aplican a líneas sin variantes. Las que traen
   * grilla (o variante fija del maestro) ya tienen sus atributos y su sku ahí
   * adentro: un talle suelto al lado sería un segundo lugar diciendo lo mismo.
   */
  function updateTextoLinea(
    clienteLineaId: string,
    campo: "nombre" | "codigo" | `atributo:${string}`,
    valor: string,
  ) {
    setLineas((prev) =>
      prev.map((l) => {
        if (l.clienteLineaId !== clienteLineaId || l.kind !== "NUEVA") return l;
        if (campo === "nombre") return { ...l, nombre: valor };
        if (l.tieneVariantes) return l;
        if (campo === "codigo") {
          return { ...l, codigo: valor.trim() ? valor : null };
        }
        const clave = campo.slice("atributo:".length);
        const atributos = { ...l.atributos };
        if (valor.trim()) atributos[clave] = valor;
        else delete atributos[clave];
        return { ...l, atributos };
      }),
    );
  }

  function removeLinea(clienteLineaId: string) {
    setLineas((prev) =>
      prev.filter((l) => l.clienteLineaId !== clienteLineaId),
    );
  }

  async function confirmar() {
    if (!lineas.length || isConfirming) return;

    // Las líneas que se completan inline pueden llegar acá sin precio de
    // venta o sin cantidad. Se frena en el cliente para poder decir CUÁL
    // falta: la validación del server devuelve un error global que no
    // identifica la línea.
    //
    // El COSTO no se exige: se puede cargar un producto para poder cobrarlo
    // ya y completar el costo después (ver validarLinea en confirmar-carga).
    // Un escaneo sin match entra a la fila con el código y SIN nombre (poner
    // "7791234567890" de nombre sería peor que dejarlo vacío), así que el
    // nombre faltante es un caso normal, no un borde.
    const sinNombre = lineas.find(
      (l): l is LineaCargaNueva => l.kind === "NUEVA" && !l.nombre.trim(),
    );
    if (sinNombre) {
      toast.error(
        `Falta el nombre de la línea${
          sinNombre.codigo ? ` del código ${sinNombre.codigo}` : ""
        }.`,
      );
      return;
    }

    const incompleta = lineas.find((l): l is LineaCargaNueva => {
      if (l.kind !== "NUEVA") return false;
      if (l.precioVenta <= 0) return true;
      if (l.tieneVariantes) {
        if (!l.varianteFijaLabel) return false;
        return (
          normalizarCantidadVendible(
            l.variantes[0]?.stock ?? "0",
            l.unidadMedida,
          ) === null
        );
      }
      return normalizarCantidadVendible(l.cantidad, l.unidadMedida) === null;
    });
    if (incompleta) {
      toast.error(
        `Completá precio de venta y cantidad de "${incompleta.nombre}" antes de confirmar.`,
      );
      return;
    }

    // Un producto que ya existe se vende por lo que dice su ficha: 0,5 de
    // crema por kilo es medio kilo, pero 0,5 de una remera no es nada.
    // Y con presentación ("3 baldes") la cantidad es entera siempre, aunque
    // el producto sea por kilo: medio balde no es una presentación.
    const existenteMal = lineas.find(
      (l): l is LineaCargaExistente =>
        l.kind === "EXISTENTE" &&
        normalizarCantidadEnForma(
          l.cantidad,
          l.unidadMedida,
          l.presentaciones.find((p) => p.id === l.presentacionId) ?? null,
        ) === null,
    );
    if (existenteMal) {
      toast.error(
        existenteMal.presentacionId
          ? `"${existenteMal.nombreProducto}": la cantidad de presentaciones tiene que ser entera.`
          : `"${existenteMal.nombreProducto}" se vende por unidad: la cantidad tiene que ser entera.`,
      );
      return;
    }

    setIsConfirming(true);
    try {
      const res = await confirmarCargaAction(lineas);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      const fallidas = res.resultados.filter((r) => !r.ok);
      if (fallidas.length === 0) {
        toast.success(
          `Carga confirmada: ${res.totalOk} línea${res.totalOk === 1 ? "" : "s"} procesada${res.totalOk === 1 ? "" : "s"}.`,
        );
      } else {
        toast.error(
          `${res.totalOk} línea(s) OK, ${res.totalError} fallaron: ${fallidas
            .map((f) => f.error)
            .filter(Boolean)
            .join(" | ")}`,
        );
      }
      setLineas([]);

      // Se avisa con lo que SÍ se cargó, aunque alguna línea haya fallado:
      // las que salieron bien ya están en la base y quien invocó tiene que
      // poder seguir con ellas.
      const cargados = res.resultados
        .map((r) => r.cargado)
        .filter((c): c is ProductoCargado => c !== undefined);
      opciones?.onFinalizar?.(cargados);
    } finally {
      setIsConfirming(false);
    }
  }

  return {
    rubro,
    lineas,
    query,
    setQuery,
    procesarEnter,
    pickerCandidatos,
    onCancelarPicker: () => setPickerCandidatos(null),
    onSeleccionarProducto: seleccionarProducto,
    variantSelectorProducto,
    onCerrarVariantSelector: () => setVariantSelectorProducto(null),
    onSeleccionarVariante: (seleccion: {
      varianteId: string | undefined;
      variante: string;
      precio: number | null;
      costo: number | null;
      sku: string | null;
      stockDisponible: number;
    }) => {
      if (!variantSelectorProducto || !seleccion.varianteId) return;
      resolverVariante({
        varianteId: seleccion.varianteId,
        productoId: variantSelectorProducto.id,
        nombreDisplay: seleccion.variante,
        nombreProducto: variantSelectorProducto.nombre,
        sku: seleccion.sku,
        precioCosto:
          seleccion.costo ?? variantSelectorProducto.precio_costo ?? 0,
        precioVenta: seleccion.precio ?? variantSelectorProducto.precio,
        unidadMedida: variantSelectorProducto.unidad_medida,
        presentaciones: variantSelectorProducto.producto_presentaciones,
      });
    },
    maestroCandidatos,
    onElegirCandidatoMaestro: elegirCandidatoMaestro,
    onCargarManualDesdeMaestro: abrirAltaManualDesdeMaestro,
    resolviendoCandidato,
    altaRapida,
    onCancelarAltaRapida: () => setAltaRapida(null),
    onGuardarAltaRapida: guardarAltaRapida,
    onEditarLineaNueva: abrirEdicionLineaNueva,
    agregarLineaNueva,
    updateCantidad,
    updateUnidadLinea,
    updateFormaLinea,
    updatePrecioLinea,
    updateTextoLinea,
    removeLinea,
    confirmar,
    isConfirming,
    buscandoEnMaestro,
    focoPendiente,
    onFocoAplicado: () => setFocoPendiente(null),
    inputRef,
    /** Devuelve el foco al campo de escaneo. Es la vuelta al punto de partida
     * desde cualquier lado de la tabla: terminada una fila, lo siguiente
     * siempre es escanear el producto que sigue. */
    enfocarBuscador: () => inputRef.current?.focus(),
    modalAbierto,
    recargoGlobal,
    setRecargoGlobal,
    aplicarRecargoGlobal,
  };
}
