"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Check,
  Loader2,
  Pencil,
  Plus,
  Power,
  SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { formatearMoneda } from "@/shared/utils/formatters";
import { SelectorCategoriaEgreso } from "./selector-categoria-egreso";
import {
  actualizarEgresoProgramadoAction,
  cambiarEstadoEgresoProgramadoAction,
  confirmarEgresoProgramadoAction,
  crearEgresoProgramadoAction,
  getEgresosProgramadosAction,
  omitirEgresoProgramadoAction,
  type EgresoProgramado,
} from "../actions/egresos-programados";
import {
  FRECUENCIAS,
  estadoVencimiento,
  etiquetaFrecuencia,
  siguienteFechaProgramada,
} from "../lib/egreso-programado";

/**
 * La agenda de gastos fijos: qué vence, cuándo, y el botón para registrarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CONFIRMAR ES LA ACCIÓN, NO GUARDAR
 *
 * Cargar el alquiler acá no registra ningún gasto: solo lo agenda. El día que
 * vence aparece arriba con "Registrar pago", y ese click sí crea el egreso —
 * con su cuenta, su turno y su categoría, por el mismo camino que un gasto
 * cargado a mano.
 *
 * Por eso el monto se puede ajustar EN el momento de confirmar: el alquiler
 * sube, y una agenda que obliga a editarla antes de pagar es una agenda que se
 * deja de usar. El número confirmado pasa a ser el esperado.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function EgresosProgramadosSheet({
  abierto,
  onOpenChange,
  puedeAdministrar,
  puedeConfirmar,
}: Readonly<{
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  /** ADMIN: cargar, editar y dar de baja. Define lo que la dueña ve como
   * comprometido, y una cifra inflada ahí le dice que no compre mercadería
   * que sí podía comprar. */
  puedeAdministrar: boolean;
  /** `caja.registrar_egreso`: confirmar es registrar un gasto. */
  puedeConfirmar: boolean;
}>) {
  return (
    <Sheet open={abierto} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border px-4 py-4 sm:px-5">
          <SheetTitle>Gastos programados</SheetTitle>
          <SheetDescription>
            Alquiler, sueldos y suscripciones. Comerz te los recuerda; el pago
            lo registrás vos.
          </SheetDescription>
        </SheetHeader>

        {abierto && (
          <Contenido
            puedeAdministrar={puedeAdministrar}
            puedeConfirmar={puedeConfirmar}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Contenido({
  puedeAdministrar,
  puedeConfirmar,
}: Readonly<{ puedeAdministrar: boolean; puedeConfirmar: boolean }>) {
  const router = useRouter();
  const [lista, setLista] = useState<EgresoProgramado[] | null>(null);
  const [editando, setEditando] = useState<EgresoProgramado | null>(null);
  const [creando, setCreando] = useState(false);

  const recargar = () => {
    getEgresosProgramadosAction().then(setLista);
    router.refresh();
  };

  useEffect(() => {
    let vigente = true;
    getEgresosProgramadosAction().then((f) => {
      if (vigente) setLista(f);
    });
    return () => {
      vigente = false;
    };
  }, []);

  if (lista === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (creando || editando) {
    return (
      <Formulario
        programado={editando}
        onListo={() => {
          setCreando(false);
          setEditando(null);
          recargar();
        }}
        onCancelar={() => {
          setCreando(false);
          setEditando(null);
        }}
      />
    );
  }

  const activos = lista.filter((p) => p.activo);
  const bajas = lista.filter((p) => !p.activo);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
      {activos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <CalendarClock className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">Todavía no cargaste ninguno</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cargá el alquiler, los sueldos o una suscripción y Comerz te va a
            avisar cuando venzan.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {activos.map((p) => (
            <Fila
              key={p.id}
              programado={p}
              puedeAdministrar={puedeAdministrar}
              puedeConfirmar={puedeConfirmar}
              onEditar={() => setEditando(p)}
              onCambio={recargar}
            />
          ))}
        </ul>
      )}

      {bajas.length > 0 && (
        <div className="mt-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Dados de baja
          </p>
          {/* Se muestran igual: uno desactivado por error se vuelve a prender
              en vez de tipearse de nuevo con otro monto. */}
          <ul className="mt-2 divide-y divide-border">
            {bajas.map((p) => (
              <Fila
                key={p.id}
                programado={p}
                puedeAdministrar={puedeAdministrar}
                puedeConfirmar={false}
                onEditar={() => setEditando(p)}
                onCambio={recargar}
              />
            ))}
          </ul>
        </div>
      )}

      {puedeAdministrar && (
        <Button
          variant="outline"
          className="mt-5 w-full"
          onClick={() => setCreando(true)}
        >
          <Plus className="h-4 w-4" />
          Programar un gasto
        </Button>
      )}
    </div>
  );
}

function Fila({
  programado: p,
  puedeAdministrar,
  puedeConfirmar,
  onEditar,
  onCambio,
}: Readonly<{
  programado: EgresoProgramado;
  puedeAdministrar: boolean;
  puedeConfirmar: boolean;
  onEditar: () => void;
  onCambio: () => void;
}>) {
  const [monto, setMonto] = useState(String(p.monto));
  const [confirmando, setConfirmando] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const hoy = new Date().toISOString().slice(0, 10);
  const estado = estadoVencimiento(p.proxima_fecha, hoy);
  const vence = estado !== "PROXIMO";

  const confirmar = () => {
    const importe = Number(monto);
    if (!Number.isFinite(importe) || importe <= 0) {
      toast.error("Ingresá un monto mayor a cero.");
      return;
    }
    iniciar(async () => {
      const res = await confirmarEgresoProgramadoAction(p.id, {
        monto: importe,
      });
      if (!res.success) {
        toast.error(res.error ?? "No se pudo registrar el gasto.");
        return;
      }
      toast.success(`${p.concepto} registrado`);
      setConfirmando(false);
      onCambio();
    });
  };

  const omitir = () => {
    iniciar(async () => {
      const res = await omitirEgresoProgramadoAction(p.id);
      if (!res.success) {
        toast.error(res.error ?? "No se pudo omitir.");
        return;
      }
      toast.success("Vencimiento omitido, sin registrar ningún gasto");
      onCambio();
    });
  };

  const cambiarEstado = () => {
    iniciar(async () => {
      const res = await cambiarEstadoEgresoProgramadoAction(p.id, !p.activo);
      if (!res.success) {
        toast.error(res.error ?? "No se pudo cambiar el estado.");
        return;
      }
      onCambio();
    });
  };

  return (
    <li className={`py-3.5 ${p.activo ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{p.concepto}</p>
          <p className="text-[11px] text-muted-foreground">
            {etiquetaFrecuencia(p.frecuencia)}
            {p.categoria_nombre && ` · ${p.categoria_nombre}`}
            {p.cuenta_nombre && ` · ${p.cuenta_nombre}`}
          </p>
          <p
            className={`mt-0.5 text-[11px] font-medium ${
              estado === "VENCIDO"
                ? "text-danger"
                : estado === "HOY"
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-muted-foreground"
            }`}
          >
            {estado === "VENCIDO"
              ? `Venció el ${fechaCorta(p.proxima_fecha)}`
              : estado === "HOY"
                ? "Vence hoy"
                : `Vence el ${fechaCorta(p.proxima_fecha)}`}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="font-mono text-sm font-semibold tabular-nums">
            {formatearMoneda(p.monto)}
          </span>
          <div className="flex gap-0.5">
            {puedeAdministrar && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-1.5"
                onClick={onEditar}
                aria-label={`Editar ${p.concepto}`}
                title="Editar"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {puedeAdministrar && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-1.5 text-muted-foreground hover:text-danger"
                onClick={cambiarEstado}
                disabled={pendiente}
                aria-label={p.activo ? "Dar de baja" : "Reactivar"}
                title={p.activo ? "Dar de baja" : "Reactivar"}
              >
                <Power className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* El pago solo se ofrece cuando de verdad vence. Un botón "registrar"
          disponible siempre invita a adelantar un alquiler que todavía no se
          pagó, y ahí el arqueo empieza a mentir. */}
      {p.activo && vence && puedeConfirmar && (
        <div className="mt-2.5 rounded-lg border border-border bg-muted/40 p-2.5">
          {confirmando ? (
            <div className="space-y-2">
              <Label htmlFor={`monto-${p.id}`} className="text-[11px]">
                ¿Por cuánto? El monto que confirmes pasa a ser el esperado.
              </Label>
              <div className="flex gap-2">
                <Input
                  id={`monto-${p.id}`}
                  type="number"
                  min="0.01"
                  step="any"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  className="h-9"
                  autoFocus
                />
                <Button size="sm" onClick={confirmar} disabled={pendiente}>
                  {pendiente ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Registrar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmando(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setConfirmando(true)}>
                Registrar pago
              </Button>
              {/* Omitir corre la fecha sin registrar nada: el mes que se pagó
                  por fuera de Comerz, o que no se pagó. Sin esta salida el
                  aviso se queda vencido para siempre y se aprende a
                  ignorarlo. */}
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={omitir}
                disabled={pendiente}
                title="Correr la fecha sin registrar ningún gasto"
              >
                <SkipForward className="h-3.5 w-3.5" />
                Omitir
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Formulario({
  programado,
  onListo,
  onCancelar,
}: Readonly<{
  programado: EgresoProgramado | null;
  onListo: () => void;
  onCancelar: () => void;
}>) {
  const [frecuencia, setFrecuencia] = useState(
    programado?.frecuencia ?? "MENSUAL",
  );
  const [fecha, setFecha] = useState(
    programado?.proxima_fecha?.slice(0, 10) ??
      new Date().toISOString().slice(0, 10),
  );
  const [tipo, setTipo] = useState(programado?.tipo ?? "OPERATIVO");
  const [categoriaId, setCategoriaId] = useState(programado?.categoria_id ?? "");

  const [, enviar, guardando] = useActionState(
    async (_prev: { error: string | null; success: boolean }, data: FormData) => {
      const res = programado
        ? await actualizarEgresoProgramadoAction(programado.id, data)
        : await crearEgresoProgramadoAction(
            { error: null, success: false },
            data,
          );
      if (res.success) {
        toast.success(programado ? "Cambio guardado" : "Gasto programado");
        onListo();
      } else toast.error(res.error);
      return res;
    },
    { error: null, success: false },
  );

  // El de después, calculado con el espejo de la función de la base. Sirve
  // para que se vea la consecuencia de elegir el 31 antes de guardar.
  const siguiente = siguienteFechaProgramada(
    fecha,
    frecuencia,
    Number(fecha.slice(8, 10)),
  );

  return (
    <form action={enviar} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
      <div className="space-y-1.5">
        <Label htmlFor="prog-concepto">Concepto</Label>
        <Input
          id="prog-concepto"
          name="concepto"
          defaultValue={programado?.concepto}
          placeholder="Ej: Alquiler del local"
          required
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="prog-monto">Monto</Label>
          <Input
            id="prog-monto"
            name="monto"
            type="number"
            min="0.01"
            step="any"
            defaultValue={programado?.monto}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prog-fecha">Próximo vencimiento</Label>
          <Input
            id="prog-fecha"
            name="proxima_fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="prog-frecuencia">¿Cada cuánto?</Label>
        <input type="hidden" name="frecuencia" value={frecuencia} />
        <Select value={frecuencia} onValueChange={setFrecuencia}>
          <SelectTrigger id="prog-frecuencia">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FRECUENCIAS.map((f) => (
              <SelectItem key={f} value={f}>
                {etiquetaFrecuencia(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {siguiente && (
          <p className="text-[11px] text-muted-foreground">
            Después de este, el siguiente sería el {fechaCorta(siguiente)}.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="prog-tipo">Tipo</Label>
        <input type="hidden" name="tipo" value={tipo} />
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger id="prog-tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OPERATIVO">Gasto operativo</SelectItem>
            <SelectItem value="RETIRO_SOCIO">Retiro de socio</SelectItem>
            <SelectItem value="COMPRA_MERCADERIA">Compra de mercadería</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Solo un gasto OPERATIVO lleva categoría: en el resto el tipo ya dice
          todo, y la base lo rechaza con un CHECK. */}
      {tipo === "OPERATIVO" && (
        <div className="space-y-1.5">
          <Label>Categoría</Label>
          <input type="hidden" name="categoria_id" value={categoriaId} />
          <SelectorCategoriaEgreso valor={categoriaId} onChange={setCategoriaId} />
        </div>
      )}

      <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-[11px] text-muted-foreground">
        Esto <strong>no registra ningún gasto</strong>. Cuando llegue la fecha
        vas a ver el aviso acá, y ahí decidís si lo registrás.
      </p>

      <div className="flex gap-2 pb-4">
        <Button className="flex-1" disabled={guardando}>
          {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {programado ? "Guardar cambios" : "Programar"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(a, m - 1, d)));
}
