"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Download, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { DatePickerAR } from "@/shared/components/date-picker-ar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatearMoneda } from "@/shared/utils/formatters";
import { numeroTicketVenta } from "@/features/sales/lib/numero-ticket";
import { anularEgresoAction } from "../actions/caja-action";
import {
  etiquetaMovimiento,
  mueveElResultado,
} from "../lib/movimiento-financiero";
import {
  exportarMovimientosAction,
  getMetodosPagoParaFiltroAction,
  getMovimientosFinancierosAction,
  getUsuariosDelNegocioAction,
  type FiltrosMovimientos,
  type MetodoPagoFiltro,
  type MovimientoFinancieroFila,
  type OrigenMovimiento,
  type UsuarioFiltro,
} from "../actions/movimientos-financieros";
import {
  getCuentasFinancierasAction,
  type CuentaFinanciera,
} from "../actions/cuentas-financieras";
import {
  getCategoriasEgresoAction,
  type CategoriaEgreso,
} from "../actions/categorias-egreso";

const TAMANO_PAGINA = 50;
const TODOS = "__todos__";
const SIN_CATEGORIA = "__sin_categoria__";

const ETIQUETA_ORIGEN: Record<OrigenMovimiento, string> = {
  VENTA_PAGO: "Cobros de venta",
  EGRESO: "Gastos",
  TRANSFERENCIA: "Transferencias",
  ACREDITACION: "Acreditaciones",
  TURNO_CAJA: "Apertura / cierre de caja",
  AJUSTE: "Ajustes",
};

const CELDA_APILADA =
  "max-md:block max-md:w-full max-md:px-4 max-md:py-1.5 " +
  "max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] " +
  "max-md:before:font-semibold max-md:before:uppercase " +
  "max-md:before:tracking-wide max-md:before:text-muted-foreground " +
  "max-md:before:content-[attr(data-label)]";

interface FiltrosUI {
  desde: string;
  hasta: string;
  cuentaId: string;
  origenTipo: string;
  categoriaId: string;
  metodoPagoId: string;
  usuarioId: string;
}

const FILTROS_VACIOS: FiltrosUI = {
  desde: "",
  hasta: "",
  cuentaId: "",
  origenTipo: "",
  categoriaId: "",
  metodoPagoId: "",
  usuarioId: "",
};

/** yyyy-mm-dd → inicio del día en ISO, interpretado en hora local (Argentina
 * no tiene DST, así que la hora del navegador de un usuario real coincide con
 * la de la base). */
function inicioDeDiaISO(fecha: string): string {
  return new Date(`${fecha}T00:00:00`).toISOString();
}

/** yyyy-mm-dd → el día SIGUIENTE a las 00:00, porque `hasta` es EXCLUSIVO en
 * la RPC: sin este +1 el propio día elegido quedaría afuera. */
function finDeDiaISO(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/**
 * "¿Qué pasó con la plata?" — la fuente principal para entenderlo: una fila
 * por movimiento, de TODAS las cuentas, con saldo posterior.
 *
 * Sobre `movimientos_financieros_negocio` (`20260921230000`), que ya resuelve
 * lo difícil: el saldo posterior se calcula sobre el ledger entero antes de
 * filtrar, la categoría se lee viva, el método sale del snapshot congelado.
 * Acá solo se arman los filtros y se pinta la tabla.
 *
 * Período con inputs de fecha y no con `PeriodoSelector`: esa RPC toma
 * `p_desde`/`p_hasta` en crudo (no `p_periodo`), así que replicar acá el
 * `date_trunc` de calendario que usa `posicion_dinero` sería reinventar en JS
 * una cuenta que la base ya resuelve para OTRA pantalla, con otro contrato.
 * Las fechas se eligen con el calendario compartido de shadcn y siguen siendo
 * editables en formato argentino (DD/MM/AAAA).
 */
export function MovimientosFinancierosTable({
  puedeAnular = false,
}: Readonly<{
  /** `caja.anular_movimiento`: ofrece "Anular" en cada fila de gasto que
   * todavía no sea un reintegro de venta (DEVOLUCION). A diferencia de "Mi
   * turno", acá pueden aparecer gastos de turnos YA CERRADOS o de Caja
   * grande (sin turno): la RPC frena sola con `TURNO_CERRADO` cuando
   * corresponde, así que no hace falta filtrarlos acá. */
  puedeAnular?: boolean;
}> = {}) {
  const [filtros, setFiltros] = useState<FiltrosUI>(FILTROS_VACIOS);
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");

  const [cuentas, setCuentas] = useState<CuentaFinanciera[] | null>(null);
  const [categorias, setCategorias] = useState<CategoriaEgreso[] | null>(null);
  const [metodos, setMetodos] = useState<MetodoPagoFiltro[] | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioFiltro[] | null>(null);

  const [filas, setFilas] = useState<MovimientoFinancieroFila[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [aAnular, setAAnular] = useState<MovimientoFinancieroFila | null>(
    null,
  );
  const [motivoAnular, setMotivoAnular] = useState("");
  const [anulando, setAnulando] = useState(false);

  useEffect(() => {
    getCuentasFinancierasAction().then(setCuentas);
    getCategoriasEgresoAction().then(setCategorias);
    getMetodosPagoParaFiltroAction().then(setMetodos);
    getUsuariosDelNegocioAction().then(setUsuarios);
  }, []);

  // Búsqueda con debounce: si dispara una request por letra tipeada, con 200
  // filas por página el usuario ve la tabla parpadear en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaAplicada(busqueda.trim()), 400);
    return () => clearTimeout(t);
  }, [busqueda]);

  const filtrosApi: FiltrosMovimientos = useMemo(
    () => ({
      desde: filtros.desde ? inicioDeDiaISO(filtros.desde) : null,
      hasta: filtros.hasta ? finDeDiaISO(filtros.hasta) : null,
      cuentaId: filtros.cuentaId || null,
      origenTipos: filtros.origenTipo
        ? [filtros.origenTipo as OrigenMovimiento]
        : null,
      categoriaId:
        filtros.categoriaId && filtros.categoriaId !== SIN_CATEGORIA
          ? filtros.categoriaId
          : null,
      sinCategoria: filtros.categoriaId === SIN_CATEGORIA,
      metodoPagoId: filtros.metodoPagoId || null,
      usuarioId: filtros.usuarioId || null,
      busqueda: busquedaAplicada || null,
    }),
    [filtros, busquedaAplicada],
  );

  // Cambió algún filtro: se vuelve a la página 1.
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    getMovimientosFinancierosAction({
      ...filtrosApi,
      limite: TAMANO_PAGINA,
      offset: 0,
    }).then((res) => {
      if (!vigente) return;
      if (res.error) toast.error(res.error);
      setFilas(res.data?.filas ?? []);
      setTotal(res.data?.total ?? 0);
      setCargando(false);
    });
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filtrosApi)]);

  const cargarMas = async () => {
    setCargandoMas(true);
    const res = await getMovimientosFinancierosAction({
      ...filtrosApi,
      limite: TAMANO_PAGINA,
      offset: filas.length,
    });
    if (res.error) toast.error(res.error);
    if (res.data) {
      setFilas((actual) => [...actual, ...res.data!.filas]);
      setTotal(res.data.total);
    }
    setCargandoMas(false);
  };

  const anular = async () => {
    if (!aAnular || !motivoAnular.trim()) return;
    setAnulando(true);
    const res = await anularEgresoAction(aAnular.origen_id, motivoAnular);
    setAnulando(false);
    if (!res.success) {
      toast.error(res.error ?? "No se pudo anular el gasto.");
      return;
    }
    toast.success("Gasto anulado");
    // La fila se saca localmente en vez de refetchear: el egreso ya no
    // existe, así que no puede volver a aparecer, y esto conserva la
    // posición de scroll y el resto de las páginas ya cargadas.
    setFilas((actual) => actual.filter((f) => f.id !== aAnular.id));
    setTotal((t) => Math.max(0, t - 1));
    setAAnular(null);
    setMotivoAnular("");
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const res = await exportarMovimientosAction(filtrosApi);
      if (res.error || !res.archivoBase64) {
        toast.error(res.error ?? "No se pudo generar la exportación.");
        return;
      }
      const binario = atob(res.archivoBase64);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = res.nombreArchivo ?? "movimientos.xlsx";
      link.click();
      URL.revokeObjectURL(url);
      toast.success(
        res.truncado
          ? `${res.filas} filas exportadas (hay más; acotá el período para traerlas todas).`
          : `${res.filas} filas exportadas.`,
      );
    } catch (err) {
      console.error("[EXPORTAR MOVIMIENTOS]", err);
      toast.error("No se pudo descargar el archivo.");
    } finally {
      setExportando(false);
    }
  };

  const hayFiltrosActivos =
    JSON.stringify(filtros) !== JSON.stringify(FILTROS_VACIOS) || busqueda;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Movimientos</h2>
          <p className="text-xs text-muted-foreground">
            Todo lo que movió plata: cobros, gastos, transferencias y ajustes,
            de todas las cuentas.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={exportar}
          disabled={exportando || cargando || total === 0}
        >
          {exportando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Exportar
        </Button>
      </div>

      {/* Filtros */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por concepto, cliente o proveedor..."
              className="pl-8"
            />
          </div>
          {hayFiltrosActivos && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFiltros(FILTROS_VACIOS);
                setBusqueda("");
              }}
            >
              <X className="h-3.5 w-3.5" />
              Limpiar
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 flex gap-1 sm:col-span-3 lg:col-span-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor="movimientos-desde" className="sr-only">
                Desde
              </Label>
              <DatePickerAR
                id="movimientos-desde"
                value={filtros.desde}
                max={filtros.hasta || undefined}
                onChange={(desde) =>
                  setFiltros((f) => ({ ...f, desde }))
                }
                placeholder="Desde"
              />
            </div>
            <div className="min-w-0 flex-1">
              <Label htmlFor="movimientos-hasta" className="sr-only">
                Hasta
              </Label>
              <DatePickerAR
                id="movimientos-hasta"
                value={filtros.hasta}
                min={filtros.desde || undefined}
                onChange={(hasta) =>
                  setFiltros((f) => ({ ...f, hasta }))
                }
                placeholder="Hasta"
              />
            </div>
          </div>

          <Select
            value={filtros.cuentaId || TODOS}
            onValueChange={(v) =>
              setFiltros((f) => ({ ...f, cuentaId: v === TODOS ? "" : v }))
            }
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Cuenta" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas las cuentas</SelectItem>
              {(cuentas ?? [])
                .filter((c) => c.codigo !== "POR_ACREDITAR")
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          <Select
            value={filtros.origenTipo || TODOS}
            onValueChange={(v) =>
              setFiltros((f) => ({ ...f, origenTipo: v === TODOS ? "" : v }))
            }
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los tipos</SelectItem>
              {Object.entries(ETIQUETA_ORIGEN).map(([valor, label]) => (
                <SelectItem key={valor} value={valor}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtros.categoriaId || TODOS}
            onValueChange={(v) =>
              setFiltros((f) => ({ ...f, categoriaId: v === TODOS ? "" : v }))
            }
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas las categorías</SelectItem>
              <SelectItem value={SIN_CATEGORIA}>Sin categoría</SelectItem>
              {(categorias ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtros.metodoPagoId || TODOS}
            onValueChange={(v) =>
              setFiltros((f) => ({ ...f, metodoPagoId: v === TODOS ? "" : v }))
            }
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Método" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los métodos</SelectItem>
              {(metodos ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm max-md:block md:min-w-full">
          <thead className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wide text-foreground/80 max-md:hidden">
            <tr>
              <th className="px-3 py-2.5">Fecha</th>
              <th className="px-3 py-2.5">Concepto</th>
              <th className="px-3 py-2.5">Categoría</th>
              <th className="px-3 py-2.5">Cuenta</th>
              <th className="px-3 py-2.5">Método</th>
              <th className="px-3 py-2.5">Relacionado</th>
              <th className="px-3 py-2.5">Usuario</th>
              <th className="px-3 py-2.5 text-right">Importe</th>
              <th className="px-3 py-2.5 text-right">Saldo</th>
              {puedeAnular && <th className="px-3 py-2.5 w-10" aria-hidden />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border max-md:block">
            {cargando ? (
              <tr>
                <td colSpan={puedeAnular ? 10 : 9} className="px-3 py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : filas.length === 0 ? (
              <tr>
                <td
                  colSpan={puedeAnular ? 10 : 9}
                  className="px-3 py-10 text-center text-xs text-muted-foreground"
                >
                  No hay movimientos con estos filtros.
                </td>
              </tr>
            ) : (
              filas.map((f) => (
                <FilaMovimiento
                  key={f.id}
                  fila={f}
                  puedeAnular={puedeAnular}
                  onAnular={() => setAAnular(f)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {!cargando && filas.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            Mostrando {filas.length} de {total}
          </p>
          {filas.length < total && (
            <Button
              variant="outline"
              size="sm"
              onClick={cargarMas}
              disabled={cargandoMas}
            >
              {cargandoMas && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Cargar más
            </Button>
          )}
        </div>
      )}

      <Dialog
        open={aAnular !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setAAnular(null);
            setMotivoAnular("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Anular gasto</DialogTitle>
            <DialogDescription>
              {aAnular?.descripcion} ·{" "}
              {aAnular ? formatearMoneda(Number(aAnular.importe)) : ""}. Se
              borra de las cuentas; el registro de que existió y se anuló
              queda en la bitácora, con el motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="motivo-anular-movimiento">Motivo</Label>
              <Input
                id="motivo-anular-movimiento"
                value={motivoAnular}
                onChange={(e) => setMotivoAnular(e.target.value)}
                placeholder="Ej: Se cargó dos veces"
                autoFocus
              />
            </div>
            <Button
              className="w-full"
              variant="destructive"
              onClick={anular}
              disabled={anulando || !motivoAnular.trim()}
            >
              {anulando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Anular gasto
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function FilaMovimiento({
  fila: f,
  puedeAnular = false,
  onAnular,
}: Readonly<{
  fila: MovimientoFinancieroFila;
  puedeAnular?: boolean;
  onAnular?: () => void;
}>) {
  const importe = Number(f.importe);
  const etiqueta = etiquetaMovimiento(f.origen_tipo, f.evento, importe);
  const afectaResultado = mueveElResultado(f.origen_tipo, f.evento);
  // Ofrece "Anular" sobre el REGISTRO de un egreso, nunca sobre un
  // reintegro de venta (DEVOLUCION: se corrige desde la venta). El evento es
  // append-only y no cambia, así que la fila REGISTRO de un egreso YA
  // anulado en otra sesión sigue viéndose "anulable" hasta que se recargue
  // la página — un click ahí devuelve EGRESO_NO_ENCONTRADO, sin dañar nada.
  // Dentro de ESTA sesión no pasa: anular saca la fila de la lista al toque.
  const esEgresoAnulable =
    f.origen_tipo === "EGRESO" &&
    f.evento === "REGISTRO" &&
    f.egreso_tipo !== "DEVOLUCION";

  return (
    <tr className="max-md:block max-md:border-b max-md:border-border max-md:py-2 max-md:last:border-b-0">
      <td data-label="Fecha" className={CELDA_APILADA + " px-3 py-2"}>
        {new Date(f.fecha).toLocaleString("es-AR", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </td>
      <td data-label="Concepto" className={CELDA_APILADA + " px-3 py-2"}>
        <div className="min-w-0">
          <p className="truncate font-medium">{f.descripcion || etiqueta}</p>
          <p className="text-[11px] text-muted-foreground">
            {etiqueta}
            {!afectaResultado && f.origen_tipo === "EGRESO" && (
              <span className="ml-1 text-warning">(no es gasto)</span>
            )}
          </p>
        </div>
      </td>
      <td data-label="Categoría" className={CELDA_APILADA + " px-3 py-2"}>
        {f.categoria_nombre ?? (f.origen_tipo === "EGRESO" ? "Sin categoría" : "—")}
      </td>
      <td data-label="Cuenta" className={CELDA_APILADA + " px-3 py-2"}>
        {f.cuenta_nombre}
        {f.cuenta_contraparte_nombre && (
          <span className="text-muted-foreground">
            {" "}
            {importe < 0 ? "→" : "←"} {f.cuenta_contraparte_nombre}
          </span>
        )}
      </td>
      <td data-label="Método" className={CELDA_APILADA + " px-3 py-2"}>
        {f.metodo_nombre ?? "—"}
      </td>
      <td data-label="Relacionado" className={CELDA_APILADA + " px-3 py-2"}>
        <Relacionado fila={f} />
      </td>
      <td data-label="Usuario" className={CELDA_APILADA + " px-3 py-2"}>
        {f.usuario_nombre ?? "—"}
      </td>
      <td
        data-label="Importe"
        className={
          CELDA_APILADA +
          ` px-3 py-2 text-right font-mono font-semibold tabular-nums max-md:text-right ${
            importe < 0 ? "text-danger" : "text-success"
          }`
        }
      >
        {formatearMoneda(importe)}
      </td>
      <td
        data-label="Saldo"
        className={
          CELDA_APILADA +
          " px-3 py-2 text-right font-mono tabular-nums text-muted-foreground max-md:text-right"
        }
      >
        {formatearMoneda(Number(f.saldo_posterior))}
      </td>
      {puedeAnular && (
        <td data-label="" className={CELDA_APILADA + " px-3 py-2 max-md:text-right"}>
          {esEgresoAnulable && (
            <button
              type="button"
              aria-label="Anular gasto"
              title="Anular gasto"
              onClick={onAnular}
              className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger"
            >
              <Ban className="h-3.5 w-3.5" />
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function Relacionado({
  fila,
}: Readonly<{ fila: MovimientoFinancieroFila }>) {
  if (fila.venta_id) {
    const numero = numeroTicketVenta({
      id: fila.venta_id,
      comprobantes: {
        punto_venta: fila.comprobante_punto_venta,
        numero: fila.comprobante_numero,
      },
    });
    return (
      <span>
        Venta #{numero}
        {fila.cliente_nombre && (
          <span className="text-muted-foreground"> · {fila.cliente_nombre}</span>
        )}
      </span>
    );
  }
  if (fila.orden_compra_id) {
    return <span>Remito{fila.proveedor ? ` · ${fila.proveedor}` : ""}</span>;
  }
  if (fila.cliente_nombre) {
    return <span>{fila.cliente_nombre}</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}
