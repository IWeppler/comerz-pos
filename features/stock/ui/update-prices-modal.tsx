"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/shared/lib/query-keys";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  TrendingUp,
  Loader2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Percent,
  Target,
  AlertTriangle,
  Search,
} from "lucide-react";
import {
  simularPreciosAction,
  aplicarPreciosAction,
  listarMarcasAction,
  AlcancePrecio,
  OperacionPrecio,
  CampoObjetivo,
  TipoRedondeo,
  PrevisualizacionItem,
  AdvertenciasPrecio,
} from "../actions/update-prices";
import { formatearMoneda } from "@/shared/utils/formatters";
import { useActiveCategories } from "../hooks/use-active-categories";
import { normalizarMarca, type MarcaCatalogo } from "../lib/marcas-del-catalogo";

interface UpdatePricesModalProps {
  /** Controlado desde afuera (modo selección). Sin esto el modal maneja su
   * propio estado y muestra su trigger, como siempre. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  /** Presente = el alcance queda fijado en "los seleccionados" y el paso 1
   * deja de ofrecer TODOS/CATEGORIA. */
  seleccion?: { ids: string[] };
  onAplicado?: () => void;
}

export function UpdatePricesModal({
  open,
  onOpenChange,
  hideTrigger = false,
  seleccion,
  onAplicado,
}: Readonly<UpdatePricesModalProps> = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const categorias = useActiveCategories();
  const [isOpenInterno, setIsOpenInterno] = useState(false);
  const esControlado = open !== undefined;
  const isOpen = esControlado ? open : isOpenInterno;
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const esModoSeleccion = seleccion !== undefined;
  const alcanceInicial: AlcancePrecio = esModoSeleccion
    ? "SELECCION"
    : "TODOS";

  // --- ESTADO DEL FORMULARIO ---
  const [alcance, setAlcance] = useState<AlcancePrecio>(alcanceInicial);
  const [categoria, setCategoria] = useState<string>("todos");
  const [marca, setMarca] = useState("");
  const [busquedaMarca, setBusquedaMarca] = useState("");
  const [marcas, setMarcas] = useState<MarcaCatalogo[]>([]);
  const [cargandoMarcas, setCargandoMarcas] = useState(true);
  const [errorMarcas, setErrorMarcas] = useState<string | null>(null);
  const [solicitudId, setSolicitudId] = useState("");

  useEffect(() => {
    if (!isOpen || esModoSeleccion) return;
    let activo = true;
    listarMarcasAction().then((res) => {
      if (!activo) return;
      setMarcas(res.data ?? []);
      setErrorMarcas(res.error ?? null);
      setCargandoMarcas(false);
    }).catch(() => {
      if (!activo) return;
      setErrorMarcas("No se pudieron cargar las marcas. Cerrá y volvé a abrir para reintentar.");
      setCargandoMarcas(false);
    });
    return () => { activo = false; };
  }, [isOpen, esModoSeleccion]);

  const [campo, setCampo] = useState<CampoObjetivo>("PRECIO");
  const [operacion, setOperacion] = useState<OperacionPrecio>(
    "AUMENTAR_PORCENTAJE",
  );
  const [valor, setValor] = useState<string>("");
  const [redondeo, setRedondeo] = useState<TipoRedondeo>("SIN_REDONDEO");
  const [nombreLote, setNombreLote] = useState<string>("");

  // --- ESTADO DE LA SIMULACIÓN ---
  const [isSimulating, setIsSimulating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [previewData, setPreviewData] = useState<PrevisualizacionItem[]>([]);
  const [advertencias, setAdvertencias] = useState<AdvertenciasPrecio | null>(
    null,
  );
  const [confirmado, setConfirmado] = useState(false);
  const [confirmadoReduccionTotal, setConfirmadoReduccionTotal] =
    useState(false);
  const [busquedaPreview, setBusquedaPreview] = useState("");
  const [ordenPreview, setOrdenPreview] = useState<"cambio" | "az">("cambio");

  // --- HANDLERS ---
  const handleOpenChange = (abierto: boolean) => {
    if (isApplying || isSimulating) return;
    if (!esControlado) setIsOpenInterno(abierto);
    onOpenChange?.(abierto);
    if (!abierto) resetForm();
  };

  const resetForm = () => {
    setStep(1);
    setAlcance(alcanceInicial);
    setCategoria("todos");
    setMarca("");
    setBusquedaMarca("");
    setSolicitudId("");
    setCargandoMarcas(true);
    setErrorMarcas(null);
    setMarcas([]);
    setCampo("PRECIO");
    setOperacion("AUMENTAR_PORCENTAJE");
    setValor("");
    setRedondeo("SIN_REDONDEO");
    setNombreLote("");
    setPreviewData([]);
    setAdvertencias(null);
    setConfirmado(false);
    setConfirmadoReduccionTotal(false);
    setBusquedaPreview("");
    setOrdenPreview("cambio");
  };

  const handleSimular = async () => {
    if (!valor || isNaN(Number(valor))) {
      toast.error("Ingresa un valor numérico válido.");
      return;
    }

    setIsSimulating(true);
    try {
      const res = await simularPreciosAction(
        alcance,
        alcance === "MARCA" ? marca : categoria,
        campo,
        operacion,
        Number(valor),
        redondeo,
        seleccion?.ids,
      );


      if (res.error) {
        toast.error(res.error);
      } else if (res.preview) {
        setSolicitudId(crypto.randomUUID());
        if (!nombreLote && alcance === "MARCA") {
          const accion = operacion === "REDUCIR_PORCENTAJE" ? "Reducción" : operacion === "FIJAR_MARGEN" ? "Recargo" : "Aumento";
          setNombreLote(`${accion} ${marca} ${valor}%`);
        }
        setPreviewData(res.preview);
        setAdvertencias(res.advertencias || null);
        setConfirmadoReduccionTotal(false);
        setBusquedaPreview("");
        setOrdenPreview("cambio");
        setStep(3);
      }
    } catch {
      toast.error("No se pudo simular el ajuste. Volvé a intentar.");
    } finally {
      setIsSimulating(false);
    }
  };

  const previewFiltrado = useMemo(() => {
    const query = busquedaPreview.trim().toLowerCase();
    const lista = query
      ? previewData.filter((item) => item.nombre.toLowerCase().includes(query))
      : previewData;

    const cambioPrincipal = (item: PrevisualizacionItem) =>
      campo === "COSTO" ? item.diferencia_costo : item.diferencia_precio;

    return [...lista].sort((a, b) => {
      if (ordenPreview === "az") return a.nombre.localeCompare(b.nombre, "es");
      return Math.abs(cambioPrincipal(b)) - Math.abs(cambioPrincipal(a));
    });
  }, [previewData, busquedaPreview, ordenPreview, campo]);

  const handleAplicar = async () => {
    setIsApplying(true);
    try {
      const res = await aplicarPreciosAction(nombreLote, previewData, {
        alcance,
        campo,
        operacion,
        valor: Number(valor),
        redondeo,
        valorAlcance: alcance === "MARCA" ? marca : alcance === "CATEGORIA" ? categoria : undefined,
      }, solicitudId);

      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("¡Precios actualizados con éxito!");
        if (!esControlado) setIsOpenInterno(false);
        onOpenChange?.(false);
        resetForm();
        queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });
        router.refresh();
        onAplicado?.();
      }
    } catch {
      toast.error("No se pudo confirmar el resultado. Reintentá sin volver a simular para evitar duplicar el ajuste.");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-11 bg-background border-border/60 hover:bg-muted text-foreground"
            title="Actualizar Precios Masivamente"
          >
            <TrendingUp className="w-4 h-4 sm:mr-1.5 text-primary" />
            <span className="hidden sm:inline">Precios</span>
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-[550px] max-h-[90dvh] p-0 overflow-y-auto bg-card border-border">
        <DialogHeader className="p-6 pb-4 border-b border-border bg-muted/20">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Percent className="w-5 h-5 text-primary" />
            Actualización Masiva
          </DialogTitle>
          <DialogDescription className="sr-only">
            Actualiza los precios de costo o venta de tus productos de forma
            masiva.
          </DialogDescription>
          <div className="flex gap-2 mt-4">
            <div
              className={`h-1.5 flex-1 rounded-full ${step >= 1 ? "bg-primary" : "bg-muted"}`}
            />
            <div
              className={`h-1.5 flex-1 rounded-full ${step >= 2 ? "bg-primary" : "bg-muted"}`}
            />
            <div
              className={`h-1.5 flex-1 rounded-full ${step >= 3 ? "bg-primary" : "bg-muted"}`}
            />
          </div>
        </DialogHeader>

        <div className="p-6">
          {/* PASO 1: ALCANCE */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div>
                <h3 className="text-lg font-bold mb-1">Paso 1: Alcance</h3>
                <p className="text-sm text-muted-foreground">
                  ¿A qué productos quieres aplicarle esta regla?
                </p>
              </div>

              {esModoSeleccion ? (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    {seleccion.ids.length}{" "}
                    {seleccion.ids.length === 1
                      ? "producto seleccionado"
                      : "productos seleccionados"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    La regla se aplica solo a estos productos. Vas a poder ver
                    el detalle producto por producto antes de confirmar.
                  </p>
                </div>
              ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Seleccionar Alcance</Label>
                  <Select
                    value={alcance}
                    onValueChange={(v) => setAlcance(v as AlcancePrecio)}
                  >
                    <SelectTrigger className="h-12 rounded-xl">
                      <SelectValue placeholder="Selecciona..." />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="TODOS">
                        Todos los productos del inventario
                      </SelectItem>
                      <SelectItem value="CATEGORIA">
                        Filtrar por una Categoría específica
                      </SelectItem>
                      <SelectItem value="MARCA" disabled={cargandoMarcas || !!errorMarcas || marcas.length === 0} className="min-h-11">
                        Por marca
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {cargandoMarcas ? <p className="text-xs text-muted-foreground">Cargando marcas…</p>
                  : errorMarcas ? <p role="alert" className="text-xs text-destructive">{errorMarcas}</p>
                  : marcas.length === 0 ? <p className="text-xs text-muted-foreground">Tus productos no tienen marca cargada</p> : null}
                {alcance === "MARCA" && (
                  <div className="space-y-2">
                    <Label htmlFor="buscar-marca-precios">Marca</Label>
                    <Input id="buscar-marca-precios" className="h-11" placeholder="Buscar marca…"
                      value={busquedaMarca} onChange={(e) => setBusquedaMarca(e.target.value)} />
                    {marca && <p className="text-sm">Elegida: <strong>{marca}</strong></p>}
                    <div className="max-h-48 overflow-y-auto rounded-lg border" role="group" aria-label="Marcas del catálogo">
                      {marcas.filter((m) => m.clave.includes(normalizarMarca(busquedaMarca) ?? "")).map((m) => (
                        <button key={m.clave} type="button" aria-pressed={marca === m.nombre}
                          onClick={() => setMarca(m.nombre)}
                          className={`min-h-11 w-full px-3 py-2 text-left text-sm break-words hover:bg-muted ${marca === m.nombre ? "bg-primary/10 font-semibold" : ""}`}>
                          {m.nombre} · {m.cantidad} {m.cantidad === 1 ? "producto" : "productos"}
                        </button>
                      ))}
                      {!marcas.some((m) => m.clave.includes(normalizarMarca(busquedaMarca) ?? "")) && <p className="p-3 text-sm text-muted-foreground">No hay marcas con ese nombre.</p>}
                    </div>
                  </div>
                )}

                {alcance === "CATEGORIA" && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                    <Label>Categoría Objetivo</Label>
                    <Select value={categoria} onValueChange={setCategoria}>
                      <SelectTrigger className="h-12 rounded-xl">
                        <SelectValue placeholder="Elige la categoría..." />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {categorias.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              )}

              <div className="flex justify-end pt-4 border-t border-border">
                <Button
                  onClick={() => setStep(2)}
                  disabled={(alcance === "CATEGORIA" && categoria === "todos") || (alcance === "MARCA" && !marca)}
                  className="bg-primary hover:bg-primary/90 text-white rounded-xl shadow-none h-11 px-6"
                >
                  Siguiente <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* PASO 2: REGLA MATEMÁTICA */}
          {step === 2 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
              <div>
                <h3 className="text-lg font-bold mb-1">Paso 2: La Regla</h3>
                <p className="text-sm text-muted-foreground">
                  Configura cómo se modificarán los precios.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2 sm:col-span-1">
                  <Label>Campo Objetivo</Label>
                  <Select
                    value={campo}
                    onValueChange={(v) => setCampo(v as CampoObjetivo)}
                  >
                    <SelectTrigger className="rounded-lg h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRECIO">Precio de Venta</SelectItem>
                      <SelectItem value="COSTO">Precio de Costo</SelectItem>
                      <SelectItem value="AMBOS">Ambos a la vez</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 col-span-2 sm:col-span-1">
                  <Label>Estrategia</Label>
                  <Select
                    value={operacion}
                    onValueChange={(v) => setOperacion(v as OperacionPrecio)}
                  >
                    <SelectTrigger className="rounded-lg h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>
                          Ajuste directo sobre el precio actual
                        </SelectLabel>
                        <SelectItem value="AUMENTAR_PORCENTAJE">
                          Aumentar precio actual (+%)
                        </SelectItem>
                        <SelectItem value="REDUCIR_PORCENTAJE">
                          Reducir precio actual (-%)
                        </SelectItem>
                      </SelectGroup>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Recargo sobre costo</SelectLabel>
                        <SelectItem value="FIJAR_MARGEN">
                          Fijar Recargo (%)
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 col-span-2 sm:col-span-1">
                  <Label htmlFor="porcentaje-ajuste">Valor / Porcentaje</Label>
                  <Input
                    id="porcentaje-ajuste"
                    type="number"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    placeholder="Ej: 30"
                    className="h-11 rounded-lg"
                  />
                </div>

                <div className="space-y-2 col-span-2 sm:col-span-1">
                  <Label>Redondeo (Sugerido)</Label>
                  <Select
                    value={redondeo}
                    onValueChange={(v) => setRedondeo(v as TipoRedondeo)}
                  >
                    <SelectTrigger className="rounded-lg h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SIN_REDONDEO">Sin Redondeo</SelectItem>
                      <SelectItem value="10">Múltiplo de $10</SelectItem>
                      <SelectItem value="50">Múltiplo de $50</SelectItem>
                      <SelectItem value="100">Múltiplo de $100</SelectItem>
                      <SelectItem value="90">Terminar en 90</SelectItem>
                      <SelectItem value="99">Terminar en 99</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 col-span-2">
                  <Label htmlFor="nombre-ajuste">
                    Nombre de esta actualización (Para el Historial)
                  </Label>
                  <Input
                    id="nombre-ajuste"
                    value={nombreLote}
                    onChange={(e) => setNombreLote(e.target.value)}
                    placeholder="Ej: Aumento Proveedor Mayorista Mayo"
                    className="h-11 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:justify-between pt-4 border-t border-border">
                <Button
                  variant="ghost"
                  onClick={() => setStep(1)}
                  className="h-11 rounded-xl"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" /> Atrás
                </Button>
                <Button
                  onClick={handleSimular}
                  disabled={!valor || isSimulating}
                  className="bg-primary hover:bg-primary/90 text-white rounded-xl shadow-none h-11 px-6"
                >
                  {isSimulating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Target className="w-4 h-4 mr-2" />
                  )}
                  Simular Impacto
                </Button>
              </div>
            </div>
          )}

          {/* PASO 3: PREVIEW & CONFIRM */}
          {step === 3 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
              <div>
                <h3 className="text-lg font-bold text-primary mb-1 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" /> Paso 3: Revisión Final
                </h3>
                <p className="text-sm text-muted-foreground">
                  Se actualizarán{" "}
                  <strong className="text-foreground">
                    {previewData.length} productos
                  </strong>
                  . Revisa los cambios.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={busquedaPreview}
                    onChange={(e) => setBusquedaPreview(e.target.value)}
                    placeholder="Buscar producto..."
                    className="h-11 pl-8 text-xs rounded-lg"
                  />
                </div>
                <Select
                  value={ordenPreview}
                  onValueChange={(v) => setOrdenPreview(v as "cambio" | "az")}
                >
                  <SelectTrigger className="h-11 rounded-lg w-full sm:w-44 shrink-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cambio">Mayor cambio primero</SelectItem>
                    <SelectItem value="az">A-Z</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <ScrollArea className="h-50 border border-border rounded-xl bg-muted/20">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted text-muted-foreground font-bold sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Producto</th>
                      {(campo === "COSTO" || campo === "AMBOS") && (
                        <th className="px-3 py-2 text-right">
                          Costo antes / después
                        </th>
                      )}
                      {(campo === "PRECIO" || campo === "AMBOS") && (
                        <th className="px-3 py-2 text-right">
                          Precio antes / después
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewFiltrado.length === 0 && (
                      <tr>
                        <td
                          colSpan={campo === "AMBOS" ? 3 : 2}
                          className="px-3 py-6 text-center text-muted-foreground"
                        >
                          Ningún producto coincide con la búsqueda.
                        </td>
                      </tr>
                    )}

                    {previewFiltrado.slice(0, 30).map((item) => {
                      const precioEnRiesgo =
                        (campo === "PRECIO" || campo === "AMBOS") &&
                        item.precio_nuevo <= 0;

                      return (
                        <tr
                          key={item.producto_id}
                          className={
                            precioEnRiesgo ? "bg-[var(--bg-danger)]" : ""
                          }
                        >
                          <td className="px-3 py-2 font-medium truncate max-w-30">
                            {item.nombre}
                          </td>

                          {(campo === "COSTO" || campo === "AMBOS") && (
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                                  {formatearMoneda(item.costo_anterior)}
                                </span>
                                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                <span className="font-bold">
                                  {formatearMoneda(item.costo_nuevo)}
                                </span>
                              </div>
                              <div
                                className={`text-[10px] font-bold ${item.diferencia_costo > 0 ? "text-green-700" : item.diferencia_costo < 0 ? "text-destructive" : "text-muted-foreground"}`}
                              >
                                {item.diferencia_costo > 0 ? "+" : ""}
                                {formatearMoneda(item.diferencia_costo)}
                              </div>
                            </td>
                          )}

                          {(campo === "PRECIO" || campo === "AMBOS") && (
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                                  {formatearMoneda(item.precio_anterior)}
                                </span>
                                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                <span
                                  className={`font-bold ${precioEnRiesgo ? "text-destructive" : ""}`}
                                >
                                  {formatearMoneda(item.precio_nuevo)}
                                </span>
                              </div>
                              <div
                                className={`text-[10px] font-bold ${item.diferencia_precio > 0 ? "text-green-700" : item.diferencia_precio < 0 ? "text-destructive" : "text-muted-foreground"}`}
                              >
                                {item.diferencia_precio > 0 ? "+" : ""}
                                {formatearMoneda(item.diferencia_precio)}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {previewFiltrado.length > 30 && (
                  <div className="text-center py-2 text-xs text-muted-foreground bg-muted/30">
                    Mostrando los primeros 30 de {previewFiltrado.length}{" "}
                    productos{busquedaPreview ? " que coinciden" : ""}...
                  </div>
                )}
              </ScrollArea>

              {advertencias &&
                (advertencias.productosPrecioCero > 0 ||
                  advertencias.variantesPrecioCero > 0) && (
                  <div className="flex items-start gap-2 bg-amber-50 p-3 rounded-lg border border-amber-200">
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <p className="text-warning leading-tight font-medium text-xs">
                      {advertencias.productosPrecioCero > 0 && (
                        <>
                          {advertencias.productosPrecioCero} producto
                          {advertencias.productosPrecioCero === 1 ? "" : "s"}{" "}
                        </>
                      )}
                      {advertencias.productosPrecioCero > 0 &&
                        advertencias.variantesPrecioCero > 0 &&
                        "y "}
                      {advertencias.variantesPrecioCero > 0 && (
                        <>
                          {advertencias.variantesPrecioCero} variante
                          {advertencias.variantesPrecioCero === 1 ? "" : "s"}{" "}
                        </>
                      )}
                      ya {advertencias.productosPrecioCero +
                        advertencias.variantesPrecioCero ===
                      1
                        ? "tiene"
                        : "tienen"}{" "}
                      precio $0 — el ajuste por porcentaje no va a tener
                      ningún efecto en ellos.
                    </p>
                  </div>
                )}

              {advertencias?.reduccionTotal && (
                <div className="flex items-start gap-2 bg-red-50 p-3 rounded-lg border border-red-300">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-red-900 leading-tight font-medium text-xs mb-2">
                      Estás reduciendo el precio en un 100% o más. Esto va a
                      dejar {advertencias.productosResultanCeroONegativo}{" "}
                      producto
                      {advertencias.productosResultanCeroONegativo === 1
                        ? ""
                        : "s"}{" "}
                      en $0 o menos.
                    </p>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="confirm_reduccion_total"
                        checked={confirmadoReduccionTotal}
                        onChange={(e) =>
                          setConfirmadoReduccionTotal(e.target.checked)
                        }
                        className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500 accent-red-600 cursor-pointer"
                      />
                      <Label
                        htmlFor="confirm_reduccion_total"
                        className="text-red-900 cursor-pointer leading-tight font-medium text-xs"
                      >
                        Confirmo que quiero dejar estos productos en $0 o
                        menos.
                      </Label>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center min-h-11 space-x-2 bg-warning/10 p-3 rounded-lg border border-warning/20">
                <input
                  type="checkbox"
                  id="confirm_check"
                  checked={confirmado}
                  onChange={(e) => setConfirmado(e.target.checked)}
                  className="w-4 h-4 rounded border-amber-300 text-warning focus:ring-warning accent-warning cursor-pointer"
                />
                <Label
                  htmlFor="confirm_check"
                  className="text-foreground cursor-pointer leading-tight font-medium text-xs"
                >
                  Confirmo el cambio de precios. Puedo deshacerlo desde el historial.
                </Label>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:justify-between pt-4 border-t border-border">
                <Button
                  variant="ghost"
                  onClick={() => setStep(2)}
                  disabled={isApplying}
                  className="h-11 rounded-xl"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" /> Modificar Regla
                </Button>
                <Button
                  onClick={handleAplicar}
                  disabled={
                    !confirmado ||
                    isApplying ||
                    (advertencias?.reduccionTotal && !confirmadoReduccionTotal)
                  }
                  className="bg-primary hover:bg-primary text-white rounded-xl shadow-none h-11 px-6"
                >
                  {isApplying && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Confirmar y Aplicar
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
