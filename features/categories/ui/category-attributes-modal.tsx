"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/shared/ui/toast";
import { Loader2, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { queryKeys } from "@/shared/lib/query-keys";
import {
  getAtributosCategoriaAction,
  guardarAtributosCategoriaAction,
  type AtributoCategoriaRow,
} from "../actions/manage-categories";

type CategoryAttributesModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoriaId: string;
  categoriaNombre: string;
};

export function CategoryAttributesModal({
  open,
  onOpenChange,
  categoriaId,
  categoriaNombre,
}: Readonly<CategoryAttributesModalProps>) {
  const {
    data: filas,
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.categorias.atributos(categoriaId),
    queryFn: async () => {
      const res = await getAtributosCategoriaAction(categoriaId);
      if (res.error) throw new Error(res.error);
      return res.data;
    },
    enabled: open,
    staleTime: 30 * 1000,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Atributos de &quot;{categoriaNombre}&quot;
          </DialogTitle>
          <DialogDescription>
            Los atributos requeridos se van a exigir al crear/editar
            productos en esta categoría; los opcionales solo se sugieren.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando...
          </div>
        ) : isError ? (
          <p className="py-6 text-sm text-destructive text-center">
            No se pudieron cargar los atributos. Cerrá e intentá de nuevo.
          </p>
        ) : filas && filas.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground text-center">
            No hay atributos cargados en el sistema todavía.
          </p>
        ) : (
          filas && (
            // Se monta solo cuando ya hay datos reales, con key por
            // categoría — así el estado editable local nace ya sembrado
            // con lo que vino del server, sin necesitar un efecto que
            // sincronice query -> estado local en cada apertura.
            <CategoryAttributesForm
              key={categoriaId}
              categoriaId={categoriaId}
              initialFilas={filas}
              onCancel={() => onOpenChange(false)}
              onSaved={() => onOpenChange(false)}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryAttributesForm({
  categoriaId,
  initialFilas,
  onCancel,
  onSaved,
}: Readonly<{
  categoriaId: string;
  initialFilas: AtributoCategoriaRow[];
  onCancel: () => void;
  onSaved: () => void;
}>) {
  const queryClient = useQueryClient();
  const [filas, setFilas] = useState(initialFilas);
  const [isSaving, setIsSaving] = useState(false);

  const toggleAplica = (atributoId: string) => {
    setFilas((prev) =>
      prev.map((f) =>
        f.atributoId === atributoId
          ? { ...f, aplica: !f.aplica, requerido: !f.aplica ? f.requerido : false }
          : f,
      ),
    );
  };

  const toggleRequerido = (atributoId: string) => {
    setFilas((prev) =>
      prev.map((f) =>
        f.atributoId === atributoId ? { ...f, requerido: !f.requerido } : f,
      ),
    );
  };

  const handleGuardar = async () => {
    setIsSaving(true);

    const res = await guardarAtributosCategoriaAction(
      categoriaId,
      filas
        .filter((f) => f.aplica)
        .map((f) => ({ atributoId: f.atributoId, requerido: f.requerido })),
    );

    setIsSaving(false);

    if (res.success) {
      toast.success("Atributos actualizados.");
      queryClient.invalidateQueries({
        queryKey: queryKeys.categorias.atributos(categoriaId),
      });
      onSaved();
    } else {
      toast.error(res.error || "Ocurrió un error al guardar.");
    }
  };

  return (
    <>
      <div className="space-y-1 py-2">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Atributo</span>
          <span className="w-16 text-center">Aplica</span>
          <span className="w-20 text-center">Requerido</span>
        </div>
        {filas.map((fila) => (
          <div
            key={fila.atributoId}
            className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-2 py-2 rounded-md hover:bg-muted/40"
          >
            <Label
              htmlFor={`aplica-${fila.atributoId}`}
              className="font-medium cursor-pointer"
            >
              {fila.nombre}
            </Label>
            <div className="w-16 flex justify-center">
              <input
                id={`aplica-${fila.atributoId}`}
                type="checkbox"
                checked={fila.aplica}
                onChange={() => toggleAplica(fila.atributoId)}
                className="w-4 h-4 cursor-pointer accent-primary"
              />
            </div>
            <div className="w-20 flex justify-center">
              <input
                type="checkbox"
                checked={fila.requerido}
                disabled={!fila.aplica}
                onChange={() => toggleRequerido(fila.atributoId)}
                className="w-4 h-4 cursor-pointer accent-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                title={
                  fila.aplica
                    ? "Exigir este atributo en productos de esta categoría"
                    : 'Tildá "Aplica" primero'
                }
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-border">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>
          Cancelar
        </Button>
        <Button type="button" onClick={handleGuardar} disabled={isSaving}>
          {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Guardar
        </Button>
      </div>
    </>
  );
}
