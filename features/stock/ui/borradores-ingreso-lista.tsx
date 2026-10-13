"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  FileSpreadsheet,
  Loader2,
  Trash2,
  Truck,
} from "lucide-react";
import { toast } from "@/shared/ui/toast";
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
  descartarOrdenPendienteAction,
  getBorradoresIngresoAction,
  type BorradorIngreso,
} from "@/features/purchases/actions/borradores-ingreso";

/**
 * Los remitos empezados y sin terminar, arriba de todo en el modal de ingreso.
 *
 * Antes esto no se veía en ningún lado: el trabajo a medias solo aparecía si
 * se volvía a subir el MISMO archivo y saltaba el guard de hash. Un remito de
 * proveedor no tiene hash, así que ese no aparecía nunca — se seguía de largo
 * y se cargaba dos veces, o no se cargaba.
 *
 * Va ANTES de las dos formas de ingresar y no después: la pregunta "¿esto ya
 * lo empecé?" tiene que contestarse antes de subir nada, que es cuando
 * todavía se puede evitar el remito duplicado.
 */
export function BorradoresIngresoLista({
  onIr,
}: Readonly<{
  /** Cierra el modal antes de navegar: el que sigue trabajando no vuelve acá. */
  onIr: () => void;
}>) {
  const router = useRouter();
  const [cargando, setCargando] = useState(true);
  const [borradores, setBorradores] = useState<BorradorIngreso[]>([]);
  const [total, setTotal] = useState(0);
  const [aDescartar, setADescartar] = useState<BorradorIngreso | null>(null);
  const [descartando, setDescartando] = useState(false);

  useEffect(() => {
    let vigente = true;
    void getBorradoresIngresoAction().then((res) => {
      if (!vigente) return;
      if (res.error) {
        // No se frena el ingreso por no poder listar lo pendiente: subir una
        // planilla sigue funcionando y el guard de hash sigue puesto.
        console.error("[BORRADORES]", res.error);
      }
      setBorradores(res.borradores);
      setTotal(res.total);
      setCargando(false);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const confirmarDescarte = async () => {
    if (!aDescartar) return;
    setDescartando(true);
    const res = await descartarOrdenPendienteAction(aDescartar.ordenId);
    setDescartando(false);

    if (res.error) {
      toast.error(res.error);
      // Pudo haberse aprobado desde otra pantalla: la fila sale igual de la
      // lista para no ofrecer descartarla otra vez.
      setBorradores((prev) =>
        prev.filter((b) => b.ordenId !== aDescartar.ordenId),
      );
      setADescartar(null);
      return;
    }

    toast.success("Remito descartado");
    setBorradores((prev) =>
      prev.filter((b) => b.ordenId !== aDescartar.ordenId),
    );
    setTotal((prev) => Math.max(0, prev - 1));
    setADescartar(null);
  };

  if (cargando) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Buscando remitos empezados...
      </div>
    );
  }

  // Sin nada pendiente no se dibuja un vacío: el modal es para ingresar
  // mercadería, y un cartel que dice "no hay nada" es ruido en el camino.
  if (borradores.length === 0) return null;

  return (
    <>
      <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4 text-warning" />
          <p className="text-sm font-semibold">
            {borradores.length === 1
              ? "Tenés 1 remito empezado"
              : `Tenés ${borradores.length} remitos empezados`}
          </p>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Todavía no impactaron el stock. Seguilos donde los dejaste o
          descartalos.
        </p>

        <ul className="mt-2.5 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {borradores.map((borrador) => (
            <li
              key={borrador.ordenId}
              className="flex items-center gap-2 rounded-lg border border-border bg-background p-2.5"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                {borrador.desdePlanilla ? (
                  <FileSpreadsheet className="size-4 text-primary" />
                ) : (
                  <Truck className="size-4 text-success" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {borrador.proveedor}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {describirBorrador(borrador)}
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  onIr();
                  router.push(`/compras/merge/${borrador.ordenId}`);
                }}
              >
                Continuar
              </Button>

              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Descartar remito de ${borrador.proveedor}`}
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setADescartar(borrador)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>

        {total > borradores.length && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Se muestran los {borradores.length} más recientes de {total}.
          </p>
        )}
      </div>

      <AlertDialog
        open={aDescartar !== null}
        onOpenChange={(open) => {
          if (!open && !descartando) setADescartar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Descartar el remito de {aDescartar?.proveedor}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se pierden las {aDescartar?.lineas ?? 0} líneas cargadas y lo que
              hayas avanzado en la revisión, y no se puede deshacer. El stock no
              cambia —este remito nunca lo impactó— y los productos que hayas
              creado desde acá siguen en tu catálogo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={descartando}>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={descartando}
              onClick={(e) => {
                // El AlertDialogAction cierra solo. Se frena para cerrar recién
                // cuando el server contestó: si no, "descartado" aparece en
                // pantalla antes de que se haya borrado nada.
                e.preventDefault();
                void confirmarDescarte();
              }}
            >
              {descartando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Descartar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Qué es este remito y cuánto trabajo tiene adentro, en una línea. */
function describirBorrador(borrador: BorradorIngreso): string {
  const partes: string[] = [
    `${borrador.lineas} línea${borrador.lineas === 1 ? "" : "s"}`,
  ];

  if (borrador.unidades > 0) {
    // `ordenes_items.cantidad` es decimal (hay rubros que ingresan por peso),
    // así que 83 no puede imprimirse como "83.000" ni 2,5 redondearse a 3.
    const unidades = borrador.unidades.toLocaleString("es-AR", {
      maximumFractionDigits: 2,
    });
    partes.push(`${unidades} unidad${borrador.unidades === 1 ? "" : "es"}`);
  }

  if (borrador.lineasVinculadas > 0) {
    partes.push(`${borrador.lineasVinculadas} ya vinculadas`);
  }

  // El borrador guardado es la señal más fuerte de "acá hay trabajo hecho":
  // gana sobre la fecha de subida.
  const fecha = borrador.borradorActualizadoEn ?? borrador.creadoEn;
  const etiqueta = borrador.borradorActualizadoEn ? "guardado" : "subido";
  partes.push(`${etiqueta} ${fechaCorta(fecha)}`);

  return partes.join(" · ");
}

function fechaCorta(iso: string): string {
  const fecha = new Date(iso);
  const dias = Math.floor((Date.now() - fecha.getTime()) / 86_400_000);
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 7) return `hace ${dias} días`;
  return `el ${fecha.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  })}`;
}
