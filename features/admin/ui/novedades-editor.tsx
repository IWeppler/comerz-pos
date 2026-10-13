"use client";

import { useRef, useState, useTransition } from "react";
import { Bold, List, Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { toast } from "@/shared/ui/toast";
import {
  eliminarNovedadAction,
  guardarNovedadAction,
  type NovedadAdmin,
} from "@/features/admin/actions/novedades";
import {
  ICONOS_NOVEDAD,
  NOMBRE_ICONO_NOVEDAD,
  type IconoNovedad,
} from "@/features/notificaciones/lib/texto-novedad";
import { ICONO_NOVEDAD } from "@/features/notificaciones/ui/cuerpo-novedad";
import { FilaNovedad } from "@/features/notificaciones/ui/campana-notificaciones";

type Borrador = { id: string | null; titulo: string; icono: IconoNovedad; cuerpo: string; publicada: boolean };

const VACIO: Borrador = { id: null, titulo: "", icono: "sparkles", cuerpo: "", publicada: false };

const fecha = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Editor de Novedades (N5): lista a la izquierda, formulario y vista previa a
 * la derecha. La vista previa usa el MISMO componente que la campana, así lo
 * que se ve acá es lo que van a ver todos.
 *
 * Publicar pide confirmación: llega al instante a la campana de TODOS los
 * usuarios de todos los comercios, y no hay forma de "desenviarla" (se puede
 * despublicar, pero quien ya la vio, la vio).
 */
export function NovedadesEditor({ novedades }: Readonly<{ novedades: NovedadAdmin[] }>) {
  const [b, setB] = useState<Borrador>(VACIO);
  const [confirmar, setConfirmar] = useState<null | "publicar" | "eliminar">(null);
  const [pendiente, startTransition] = useTransition();
  const texto = useRef<HTMLTextAreaElement>(null);

  function editar(n: NovedadAdmin) {
    setB({ id: n.id, titulo: n.titulo, icono: n.icono, cuerpo: n.cuerpo, publicada: n.publicadaEn !== null });
  }

  /** Envuelve la selección en **…** (o inserta **negrita** si no hay selección). */
  function negrita() {
    const el = texto.current;
    if (!el) return;
    const { selectionStart: i, selectionEnd: f, value } = el;
    const elegido = value.slice(i, f) || "negrita";
    const nuevo = value.slice(0, i) + `**${elegido}**` + value.slice(f);
    setB((x) => ({ ...x, cuerpo: nuevo }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(i + 2, i + 2 + elegido.length);
    });
  }

  /** Pone "- " al principio de cada línea elegida (o de la línea del cursor). */
  function vineta() {
    const el = texto.current;
    if (!el) return;
    const { selectionStart: i, selectionEnd: f, value } = el;
    const desde = value.lastIndexOf("\n", i - 1) + 1;
    const hastaIdx = value.indexOf("\n", f);
    const hasta = hastaIdx === -1 ? value.length : hastaIdx;
    const lineas = value
      .slice(desde, hasta)
      .split("\n")
      .map((l) => (l.trimStart().startsWith("- ") ? l : `- ${l}`))
      .join("\n");
    setB((x) => ({ ...x, cuerpo: value.slice(0, desde) + lineas + value.slice(hasta) }));
    requestAnimationFrame(() => el.focus());
  }

  function guardar(publicar: boolean) {
    startTransition(async () => {
      const r = await guardarNovedadAction({ ...b, publicar });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setB((x) => ({ ...x, id: r.id, publicada: publicar }));
      toast.success(publicar ? (b.publicada ? "Cambios publicados" : "Novedad publicada") : "Guardada como borrador");
    });
  }

  function eliminar() {
    if (!b.id) return;
    const id = b.id;
    startTransition(async () => {
      const r = await eliminarNovedadAction(id);
      if (!r.ok) {
        toast.error("No se pudo eliminar.");
        return;
      }
      setB(VACIO);
      toast.success("Novedad eliminada");
    });
  }

  const valida = b.titulo.trim().length > 0 && b.titulo.trim().length <= 120 && b.cuerpo.length <= 4000;

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      {/* Lista */}
      <div className="space-y-2">
        <Button variant="outline" className="w-full justify-start" onClick={() => setB(VACIO)}>
          <Plus className="mr-2 size-4" />
          Nueva novedad
        </Button>
        {novedades.length === 0 ? (
          <p className="rounded-xl border border-white/10 p-4 text-sm text-white/50">Todavía no hay novedades.</p>
        ) : (
          <ul className="space-y-1.5">
            {novedades.map((n) => {
              const Icono = ICONO_NOVEDAD[n.icono];
              const activa = b.id === n.id;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => editar(n)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      activa ? "border-white/30 bg-white/10" : "border-white/10 hover:bg-white/5"
                    }`}
                  >
                    <Icono className="mt-0.5 size-4 shrink-0 text-white/60" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{n.titulo}</span>
                      <span className="mt-0.5 block text-xs text-white/50">
                        {n.publicadaEn ? `Publicada ${fecha.format(new Date(n.publicadaEn))} · ${n.vistas} vistas` : "Borrador"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Formulario + vista previa */}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="nov-titulo" className="text-sm font-medium text-white/80">Título</label>
            <Input
              id="nov-titulo"
              value={b.titulo}
              maxLength={120}
              placeholder="Llegó la campana de notificaciones"
              onChange={(e) => setB((x) => ({ ...x, titulo: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-white/80">Ícono</p>
            <div className="flex flex-wrap gap-1.5">
              {ICONOS_NOVEDAD.map((icono) => {
                const Icono = ICONO_NOVEDAD[icono];
                const elegido = b.icono === icono;
                return (
                  <button
                    key={icono}
                    type="button"
                    aria-pressed={elegido}
                    onClick={() => setB((x) => ({ ...x, icono }))}
                    className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                      elegido ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-white/60 hover:bg-white/5"
                    }`}
                  >
                    <Icono className="size-4" />
                    {NOMBRE_ICONO_NOVEDAD[icono]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="nov-cuerpo" className="text-sm font-medium text-white/80">Texto</label>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={negrita} title="Negrita (**texto**)">
                  <Bold className="size-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={vineta} title="Viñeta (- al principio)">
                  <List className="size-4" />
                </Button>
              </div>
            </div>
            <Textarea
              id="nov-cuerpo"
              ref={texto}
              rows={9}
              value={b.cuerpo}
              placeholder={"Ahora te avisamos **lo importante** de tu negocio:\n- Productos agotados\n- Ventas online pagadas"}
              onChange={(e) => setB((x) => ({ ...x, cuerpo: e.target.value }))}
            />
            <p className="text-xs text-white/40">
              **negrita** · una línea que empieza con &quot;- &quot; es una viñeta · línea en blanco = párrafo nuevo ·{" "}
              {b.cuerpo.length}/4000
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!valida || pendiente} onClick={() => setConfirmar("publicar")}>
              {b.publicada ? "Publicar cambios" : "Publicar"}
            </Button>
            <Button variant="outline" disabled={!valida || pendiente} onClick={() => guardar(false)}>
              {b.publicada ? "Despublicar" : "Guardar borrador"}
            </Button>
            {b.id && (
              <Button variant="destructive" disabled={pendiente} onClick={() => setConfirmar("eliminar")}>
                <Trash2 className="mr-1.5 size-4" />
                Eliminar
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-white/80">Vista previa</p>
          <div className="overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground">
            <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
              Novedades
            </div>
            <ul>
              <FilaNovedad
                n={{
                  icono: b.icono,
                  titulo: b.titulo.trim() || "Título de la novedad",
                  cuerpo: b.cuerpo,
                  fecha: new Date().toISOString(),
                }}
                nueva
              />
            </ul>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmar !== null} onOpenChange={(abierto) => !abierto && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar === "eliminar" ? "¿Eliminar esta novedad?" : "¿Publicar para todos?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === "eliminar"
                ? "Desaparece de la campana de todos. Quien ya la leyó, ya la leyó."
                : "Aparece al instante en la campana de todos los usuarios de todos los comercios."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmar === "eliminar") eliminar();
                else guardar(true);
                setConfirmar(null);
              }}
            >
              {confirmar === "eliminar" ? "Eliminar" : "Publicar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
