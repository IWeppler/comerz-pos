"use client";

import { useState, useTransition } from "react";
import {
  Edit2,
  MoreVertical,
  Percent,
  Power,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { precioDeLista } from "@/shared/lib/precio-de-lista";
import type { ListaPrecio } from "@/entities/precios/types";
import { ListaPrecioModal } from "./lista-precio-modal";
import {
  eliminarListaPrecioAction,
  toggleListaPrecioAction,
} from "../actions/manage-listas-precios";

/**
 * Listas de precios: el mismo producto vendido a distinto precio según a quién.
 *
 * ES OTRA SECCIÓN QUE PROMOCIONES, Y NO ES PROLIJIDAD. Una promoción responde
 * "¿bajo qué condición bajo el precio?" (temporal, por ticket, se publica en
 * la vidriera); una lista responde "¿qué precio le corresponde a este
 * cliente?" (permanente, por unidad, nunca sale al catálogo público). Si
 * convivieran en la misma pantalla, en seis meses habría una lista llamada
 * "20% OFF verano" y una promo llamada "Mayorista".
 */

const pesos = (valor: number) => `$${Math.round(valor).toLocaleString("es-AR")}`;

/** Cómo se lee la regla de una lista, en una línea. */
function describirRegla(lista: ListaPrecio): string {
  const valor = Number(lista.valor) || 0;

  if (lista.tipo_regla === "MARKUP") {
    return `Costo × ${valor.toString().replace(".", ",")}`;
  }
  const magnitud = Math.abs(valor).toString().replace(".", ",");
  return valor < 0 ? `${magnitud}% menos` : `${magnitud}% más`;
}

/**
 * El ejemplo de la fila, con la misma función que cobra el POS.
 *
 * Se fuerza `activa: true` porque la columna describe QUÉ HACE la regla, no si
 * está aplicándose ahora: con la lista apagada, `precioDeLista` devuelve el
 * precio base y la fila mostraría "$20.000 → $20.000", que se lee como una
 * regla mal cargada. Que está apagada ya lo dice la columna Estado.
 */
function ejemplo(lista: ListaPrecio): string {
  const { precio } = precioDeLista({
    precioBase: 20000,
    precioCosto: 10000,
    lista: { ...lista, activa: true },
  });
  return `${pesos(20000)} → ${pesos(precio)}`;
}

export function ListasPreciosPanel({
  listas,
}: Readonly<{ listas: ListaPrecio[] }>) {
  const [editando, setEditando] = useState<ListaPrecio | null>(null);
  const [borrando, setBorrando] = useState<ListaPrecio | null>(null);
  const [pendiente, startTransition] = useTransition();

  const cambiarEstado = (lista: ListaPrecio) => {
    startTransition(async () => {
      const res = await toggleListaPrecioAction(lista.id, lista.activa);
      if (res.success) {
        toast.info(`Lista ${lista.activa ? "desactivada" : "activada"}.`);
      } else {
        toast.error(res.error ?? "Ocurrió un error.");
      }
    });
  };

  const eliminar = () => {
    if (!borrando) return;
    const lista = borrando;
    startTransition(async () => {
      const res = await eliminarListaPrecioAction(lista.id);
      if (res.success) {
        toast.success(`Se eliminó "${lista.nombre}".`);
        setBorrando(null);
      } else {
        toast.error(res.error ?? "Ocurrió un error.");
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            Listas de Precios
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Para venderle más barato (o más caro) a un tipo de cliente, como el{" "}
            <strong>mayorista</strong>. Distinto de una{" "}
            <strong>promoción</strong>, que es un descuento temporal y por
            ticket: una lista es el precio que le corresponde a ese cliente
            siempre.
          </p>
        </div>
        <ListaPrecioModal />
      </div>

      {listas.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card p-12 text-center text-card-foreground">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Tags className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-bold">Todavía no tenés listas</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Tu catálogo se vende al precio que tiene cargado cada producto. Si
            creás una lista, el POS te deja elegirla en el ticket y no cambia
            nada hasta que la uses.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/50 bg-muted/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-5 py-4">Lista</th>
                  <th className="px-5 py-4">Regla</th>
                  <th className="px-5 py-4">Ejemplo</th>
                  <th className="px-5 py-4 text-center">Promociones</th>
                  <th className="px-5 py-4 text-center">Estado</th>
                  <th className="px-5 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {listas.map((lista) => (
                  <tr
                    key={lista.id}
                    className={`group transition-colors ${
                      lista.activa ? "hover:bg-muted/30" : "bg-muted/10 opacity-70"
                    }`}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg border p-2 text-muted-foreground">
                          <Tags className="h-4 w-4" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-foreground">
                            {lista.nombre}
                          </span>
                          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {lista.overrides
                              ? `${lista.overrides} ${lista.overrides === 1 ? "precio fijo" : "precios fijos"}`
                              : "Solo la regla"}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <Badge className="rounded-lg border-border bg-muted px-2 py-1 font-bold text-foreground shadow-none">
                        <Percent className="mr-1 h-3 w-3" />
                        {describirRegla(lista)}
                      </Badge>
                    </td>

                    <td className="px-5 py-4 whitespace-nowrap text-muted-foreground">
                      {ejemplo(lista)}
                    </td>

                    {/* Acumulación con promociones: el default es NO, y se
                        muestra porque es lo que decide el margen. */}
                    <td className="px-5 py-4 text-center">
                      {lista.admite_promociones ? (
                        <Badge className="rounded-lg border-warning/20 bg-warning/10 px-2 py-1 font-bold text-warning shadow-none">
                          Se acumulan
                        </Badge>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <X className="h-3 w-3" />
                          No se aplican
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-center">
                      <Badge
                        className={`rounded-lg px-2 py-1 font-bold shadow-none ${
                          lista.activa
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-border bg-muted text-muted-foreground"
                        }`}
                      >
                        {lista.activa ? "Activa" : "Inactiva"}
                      </Badge>
                    </td>

                    <td className="px-5 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={pendiente}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl">
                          <DropdownMenuItem onClick={() => setEditando(lista)}>
                            <Edit2 className="mr-2 h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => cambiarEstado(lista)}>
                            <Power className="mr-2 h-4 w-4" />
                            {lista.activa ? "Desactivar" : "Activar"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setBorrando(lista)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Montado solo mientras se edita: sin el guard, `lista` llega en null y
          el componente se dibujaría en modo ALTA, con su propio botón "Nueva
          lista" duplicado al pie de la tabla. */}
      {editando && (
        <ListaPrecioModal
          lista={editando}
          abierto
          onAbiertoChange={(abierto) => !abierto && setEditando(null)}
        />
      )}

      <AlertDialog
        open={Boolean(borrando)}
        onOpenChange={(abierto) => !abierto && setBorrando(null)}
      >
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Eliminar &quot;{borrando?.nombre}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Se pierden{" "}
                  {borrando?.overrides
                    ? `los ${borrando.overrides} precios fijos cargados en esta lista y `
                    : ""}
                  la asignación a los clientes que la tenían.
                </p>
                <p>
                  Las ventas ya cobradas con esta lista{" "}
                  <strong>no cambian</strong>: cada ticket guarda el precio que
                  se cobró y el nombre de la lista.
                </p>
                <p className="text-muted-foreground">
                  Si solo querés dejar de usarla, conviene{" "}
                  <strong>desactivarla</strong>: deja de aplicarse y conserva
                  todo.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendiente}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                eliminar();
              }}
              disabled={pendiente}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Eliminar lista
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
