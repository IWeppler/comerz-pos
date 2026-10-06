"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Merge, Search } from "lucide-react";
import { queryKeys } from "@/shared/lib/query-keys";
import {
  buscarCandidatosFusionAction,
  fusionarProductosAction,
  previsualizarFusionAction,
  type CandidatoFusion,
  type PreviewFusion,
} from "../actions/fusionar-productos";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

/**
 * Combinar este producto con otro.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA PREVIEW NO ES OPCIONAL
 *
 * Fusionar NO tiene deshacer: cuando las dos partes tienen la misma variante,
 * su stock se suma, y separar "3 unidades" de vuelta en 1 + 2 es una
 * suposición — nada dice cuál de las dos filas trajo cuál unidad. Esta
 * pantalla es la única oportunidad de arrepentirse, así que dice números
 * exactos y no "se van a combinar los productos".
 *
 * Los números salen de la BASE (`previsualizar_fusion_productos`), no de un
 * cálculo en el navegador, y usan la misma identidad de variante que la
 * fusión real. Si la preview y la fusión contaran distinto, la preview sería
 * peor que no tenerla.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTE PRODUCTO ES EL QUE SE VA
 *
 * Se elige el DESTINO y desaparece el que abrió el modal. Es al revés de lo
 * que parece y por eso está escrito con todas las letras: el que sobrevive es
 * el que conserva su foto, su precio y su historia de ventas, y normalmente es
 * el viejo — el duplicado es el que acaba de crear el remito.
 */
export function FusionarProductoModal({
  id,
  nombre,
  children,
  open,
  onOpenChange,
}: Readonly<{
  id: string;
  nombre: string;
  children?: React.ReactNode;
  /** Controlado desde afuera: lo abre un ítem de menú que vive afuera del
   * modal (si el modal viviera adentro del menú, cerrar el menú lo
   * desmontaría). Sin esto maneja su estado y muestra su trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [abiertoInterno, setAbiertoInterno] = useState(false);
  const esControlado = open !== undefined;
  const abierto = esControlado ? open : abiertoInterno;
  const setAbierto = (v: boolean) => {
    if (!esControlado) setAbiertoInterno(v);
    onOpenChange?.(v);
    if (!v) {
      // Al cerrar se limpia todo: reabrir con un destino elegido de la vez
      // anterior es la forma más fácil de fusionar el producto equivocado.
      setDestino(null);
      setPreview(null);
      setCandidatos(null);
      setBusqueda("");
    }
  };
  const [pendiente, startTransition] = useTransition();

  const [busqueda, setBusqueda] = useState("");
  const [candidatos, setCandidatos] = useState<CandidatoFusion[] | null>(null);
  const [destino, setDestino] = useState<CandidatoFusion | null>(null);
  const [preview, setPreview] = useState<PreviewFusion | null>(null);

  const buscar = (texto: string) => {
    startTransition(async () => {
      setCandidatos(await buscarCandidatosFusionAction(id, texto));
    });
  };

  const elegir = (c: CandidatoFusion) => {
    setDestino(c);
    startTransition(async () => {
      setPreview(await previsualizarFusionAction(id, c.id));
    });
  };

  const fusionar = () => {
    if (!destino) return;
    startTransition(async () => {
      const res = await fusionarProductosAction(id, destino.id);
      if (res.ok) {
        setAbierto(false);
        toast.success(
          `"${nombre}" se combinó con "${destino.nombre}": ` +
            `${res.variantesMovidas} variantes movidas` +
            (res.variantesSumadas ? `, ${res.variantesSumadas} sumadas` : "") +
            `, ${res.unidades} unidades en total.`,
        );
        queryClient.invalidateQueries({ queryKey: queryKeys.catalogo });
        router.refresh();
      } else {
        toast.error(res.error ?? "No se pudo combinar.");
      }
    });
  };

  // Al abrir se buscan candidatos. En un efecto y no en onOpenChange porque,
  // abierto desde un menú (controlado), onOpenChange(true) no se dispara.
  useEffect(() => {
    if (abierto) buscar("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const distintos =
    preview?.ok && (!preview.mismaCategoria || !preview.mismaMarca);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      {!esControlado && <DialogTrigger asChild>{children}</DialogTrigger>}

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Combinar con otro producto</DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-foreground">{nombre}</span> se
            va a eliminar y todo lo suyo —variantes, stock, ventas, remitos y
            fotos de proveedor— pasa al producto que elijas.
          </DialogDescription>
        </DialogHeader>

        {!destino && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);
                  buscar(e.target.value);
                }}
                placeholder="Buscar el producto que se queda"
                className="pl-8"
              />
            </div>

            <ul className="space-y-1">
              {(candidatos ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => elegir(c)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {c.nombre}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {c.variantes} variantes · {c.stock} unidades
                        {/* Los dos ejes que hacen a un duplicado de verdad. Si
                            no coinciden puede ser el error al revés: juntar la
                            remera de hombre con la de mujer. */}
                        {c.mismaCategoria && c.mismaMarca
                          ? " · misma categoría y marca"
                          : !c.mismaCategoria
                            ? " · OTRA CATEGORÍA"
                            : " · otra marca"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {candidatos?.length === 0 && (
                <li className="p-2 text-sm text-muted-foreground">
                  No hay otros productos con ese nombre.
                </li>
              )}
            </ul>
          </div>
        )}

        {destino && preview?.ok && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <p className="font-semibold">
                Queda: {preview.destinoNombre}
              </p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                <li>
                  {preview.variantesAMover} variantes se mueven
                  {preview.variantesASumar ? (
                    <>
                      {" "}
                      y{" "}
                      <span className="font-semibold text-foreground">
                        {preview.variantesASumar} se suman
                      </span>{" "}
                      (ya existen en los dos)
                    </>
                  ) : null}
                  .
                </li>
                <li>
                  Queda con {preview.variantesFinales} variantes y{" "}
                  {preview.unidadesFinales} unidades.
                </li>
                {(preview.ventasAReapuntar ?? 0) > 0 && (
                  <li>
                    {preview.ventasAReapuntar} renglones de venta pasan al
                    producto que queda.
                  </li>
                )}
                {(preview.aliasAReapuntar ?? 0) > 0 && (
                  <li>
                    {preview.aliasAReapuntar} nombres de proveedor pasan
                    también, así el próximo remito no vuelve a duplicarlo.
                  </li>
                )}
                {preview.origenTieneFoto && !preview.destinoTieneFoto && (
                  <li className="text-warning">
                    La foto de &ldquo;{nombre}&rdquo; se pierde: el que queda no
                    tiene.
                  </li>
                )}
                {preview.origenPrecio !== preview.destinoPrecio && (
                  <li>
                    Precio: queda ${preview.destinoPrecio?.toLocaleString("es-AR")}{" "}
                    (el de &ldquo;{nombre}&rdquo; era $
                    {preview.origenPrecio?.toLocaleString("es-AR")}).
                  </li>
                )}
              </ul>
            </div>

            {distintos && (
              <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground/90">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                <span>
                  {!preview.mismaCategoria
                    ? "Están en categorías distintas. "
                    : "Tienen marcas distintas. "}
                  Puede ser correcto, pero la misma prenda en dos categorías
                  suele ser dos productos de verdad: fijate antes de seguir.
                </span>
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Esto no se puede deshacer. El stock que se suma no se puede volver
              a separar.
            </p>

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setDestino(null);
                  setPreview(null);
                }}
              >
                Elegir otro
              </Button>
              <Button onClick={fusionar} disabled={pendiente}>
                <Merge className="mr-2 h-4 w-4" />
                {pendiente ? "Combinando…" : "Combinar"}
              </Button>
            </div>
          </div>
        )}

        {destino && preview && !preview.ok && (
          <p className="text-sm text-destructive">{preview.error}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
