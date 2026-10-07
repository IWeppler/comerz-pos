"use client";

import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
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
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Trash2,
  FolderTree,
  Loader2,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Settings2,
  Barcode,
} from "lucide-react";
import { bulkSaveCategoriasAction } from "../actions/manage-categories";
import { CategoryAttributesModal } from "./category-attributes-modal";
import { PortadaCategoria } from "./portada-categoria";
import {
  ETIQUETA_TEMPORADA,
  TEMPORADAS,
  normalizarTemporada,
} from "@/shared/lib/temporada-categoria";

export interface Categoria {
  id: string;
  nombre: string;
  slug?: string;
  descripcion?: string | null;
  activa: boolean;
  orden: number;
  parent_id?: string | null;
  /** Portada en la home del catálogo público. Sólo aplica a categorías raíz. */
  imagen_url?: string | null;
  /** Ventana de venta. Ver shared/lib/temporada-categoria.ts. */
  temporada?: string | null;
  /** Sus productos (y los de sus subcategorías) piden IMEI al vender. */
  lleva_serie?: boolean | null;
}

type LocalCategory = Categoria & { isNew?: boolean };

const generateId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export function CategoriesPanel({
  categorias,
}: Readonly<{ categorias: Categoria[] }>) {
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  // Estado local plano — cada fila (padre o subcategoría) tiene siempre un
  // id real desde que existe (ver A1: nunca "" ni diferido), y su
  // `parent_id` se asigna de forma EXPLÍCITA (selector "Padre"), nunca
  // inferido por posición en el array.
  const [cats, setCats] = useState<LocalCategory[]>(() =>
    categorias.map((c) => ({ ...c })),
  );

  // Qué padres están expandidos en el árbol — UI local, no se persiste.
  // Arrancan todos expandidos.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(categorias.filter((c) => !c.parent_id).map((c) => c.id)),
  );

  const [newRootName, setNewRootName] = useState("");
  const [newSubNameByParent, setNewSubNameByParent] = useState<
    Record<string, string>
  >({});
  const [rootPendingDelete, setRootPendingDelete] =
    useState<LocalCategory | null>(null);
  const [categoriaParaAtributos, setCategoriaParaAtributos] =
    useState<LocalCategory | null>(null);

  const roots = cats
    .filter((c) => !c.parent_id)
    .sort((a, b) => a.orden - b.orden);
  const childrenOf = (parentId: string) =>
    cats
      .filter((c) => c.parent_id === parentId)
      .sort((a, b) => a.orden - b.orden);

  const updateCat = (id: string, patch: Partial<LocalCategory>) => {
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setHasChanges(true);
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddRoot = () => {
    const nombre = newRootName.trim();
    if (!nombre) return;
    const id = generateId();
    setCats((prev) => [
      ...prev,
      { id, nombre, activa: true, isNew: true, parent_id: null, orden: prev.length },
    ]);
    setExpanded((prev) => new Set(prev).add(id));
    setNewRootName("");
    setHasChanges(true);
  };

  const handleAddSub = (parentId: string) => {
    const nombre = (newSubNameByParent[parentId] || "").trim();
    if (!nombre) return;
    setCats((prev) => [
      ...prev,
      {
        id: generateId(),
        nombre,
        activa: true,
        isNew: true,
        parent_id: parentId,
        orden: prev.length,
      },
    ]);
    setNewSubNameByParent((prev) => ({ ...prev, [parentId]: "" }));
    setHasChanges(true);
  };

  const requestDelete = (cat: LocalCategory) => {
    const tieneHijos = !cat.parent_id && childrenOf(cat.id).length > 0;
    if (tieneHijos) {
      setRootPendingDelete(cat);
      return;
    }
    confirmDelete(cat.id);
  };

  const confirmDelete = (id: string) => {
    setCats((prev) => prev.filter((c) => c.id !== id && c.parent_id !== id));
    // Solo hace falta mandar a borrar server-side lo que ya existía antes
    // de esta sesión de edición — lo creado y borrado en la misma pasada
    // simplemente nunca se manda.
    const idsAPersistirBorrado = [
      id,
      ...childrenOf(id).map((c) => c.id),
    ].filter((catId) => categorias.some((c) => c.id === catId));
    if (idsAPersistirBorrado.length > 0) {
      setDeletedIds((prev) => [...prev, ...idsAPersistirBorrado]);
    }
    setRootPendingDelete(null);
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);

    const toUpsert = cats.filter((c) => c.nombre.trim() !== "");
    const res = await bulkSaveCategoriasAction(toUpsert, deletedIds);

    setIsSaving(false);

    if (res.success) {
      toast.success("Categorías actualizadas correctamente.");
      setHasChanges(false);
      setDeletedIds([]);
    } else {
      toast.error(res.error || "Ocurrió un error al guardar.");
    }
  };

  const renderRowActions = (cat: LocalCategory) => (
    <div className="flex items-center gap-1 shrink-0">
      {/* Temporada. Solo sirve para NO sugerir esta categoría fuera de su
          ventana de venta: nunca para sugerir que se compre. Por eso el
          default "Todo el año" no oculta nada y el título lo dice. */}
      <Select
        value={normalizarTemporada(cat.temporada)}
        onValueChange={(valor) => updateCat(cat.id, { temporada: valor })}
      >
        <SelectTrigger
          className="h-9 w-[132px] shadow-none border-border/50 bg-background text-xs"
          title="Fuera de esta temporada, Comerz no va a sugerir reponer esta categoría"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TEMPORADAS.map((t) => (
            <SelectItem key={t} value={t} className="text-xs">
              {ETIQUETA_TEMPORADA[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* IMEI. Una subcategoría de una que ya lo pide lo hereda (mismo
          criterio que `categorias_llevan_serie` en la base): se muestra
          prendido y no se puede apagar desde acá. */}
      {(() => {
        const heredado =
          !!cat.parent_id &&
          cats.some((c) => c.id === cat.parent_id && c.lleva_serie === true);
        const activo = heredado || cat.lleva_serie === true;
        return (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={heredado}
            aria-pressed={activo}
            onClick={() => updateCat(cat.id, { lleva_serie: !activo })}
            className={`h-9 w-9 rounded-md transition-colors ${activo ? "text-primary bg-primary/10 hover:bg-primary/15" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            title={
              heredado
                ? "Pide IMEI al vender (lo hereda de la categoría de arriba)"
                : activo
                  ? "Pide IMEI al vender. Tocá para que no lo pida"
                  : "No pide IMEI. Tocá para pedirlo al vender (celulares, tablets)"
            }
          >
            <Barcode className="w-4 h-4" />
          </Button>
        );
      })()}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setCategoriaParaAtributos(cat)}
        className="h-9 w-9 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10"
        title="Atributos de esta categoría"
      >
        <Settings2 className="w-4 h-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => updateCat(cat.id, { activa: !cat.activa })}
        className={`h-9 w-9 rounded-md transition-colors ${!cat.activa ? "text-warning hover:text-warning/90" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
        title={cat.activa ? "Ocultar en tienda" : "Mostrar en tienda"}
      >
        {cat.activa ? (
          <Eye className="w-4 h-4" />
        ) : (
          <EyeOff className="w-4 h-4" />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => requestDelete(cat)}
        className="h-9 w-9 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        title="Eliminar"
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FolderTree className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-foreground">Categorías</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Para organizar tus productos, creá categorías y subcategorías que
            aparecerán en el menú de tu tienda y POS. La miniatura de cada
            categoría principal es su portada en la home del catálogo: si no
            elegís ninguna, se usa la foto de alguno de sus productos.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="w-full sm:w-auto"
          >
            {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Guardar Cambios
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="flex flex-col divide-y divide-border/60">
          {roots.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground text-center">
              Todavía no hay categorías — creá la primera abajo.
            </p>
          )}

          {roots.map((root) => {
            const kids = childrenOf(root.id);
            const isExpanded = expanded.has(root.id);

            return (
              <div key={root.id}>
                <div className="flex items-center gap-2 p-3 hover:bg-muted/30 transition-colors">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(root.id)}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    title={isExpanded ? "Colapsar" : "Expandir"}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>

                  {/* Sólo en raíces: la portada del catálogo muestra padres y
                      categorías sueltas, nunca subcategorías. */}
                  <PortadaCategoria
                    imagenUrl={root.imagen_url}
                    nombreCategoria={root.nombre}
                    onChange={(url) => updateCat(root.id, { imagen_url: url })}
                  />

                  <Input
                    value={root.nombre}
                    onChange={(e) =>
                      updateCat(root.id, { nombre: e.target.value })
                    }
                    className={`h-10 flex-1 shadow-none font-semibold border-border/50 bg-background focus:ring-2 focus:ring-[#0051ff]/20 focus:border-[#0051ff] ${!root.activa ? "text-muted-foreground line-through decoration-muted-foreground/50" : "text-foreground"}`}
                  />

                  {kids.length > 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {kids.length} sub{kids.length === 1 ? "" : "s"}
                    </span>
                  )}

                  {renderRowActions(root)}
                </div>

                {isExpanded && (
                  <div className="pl-9 pb-2 bg-muted/10">
                    {kids.map((sub) => (
                      <div
                        key={sub.id}
                        className="flex items-center gap-2 py-2 pr-3"
                      >
                        <CornerDownRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                        <Input
                          value={sub.nombre}
                          onChange={(e) =>
                            updateCat(sub.id, { nombre: e.target.value })
                          }
                          className={`h-9 flex-1 shadow-none border-border/50 bg-background focus:ring-2 focus:ring-[#0051ff]/20 focus:border-[#0051ff] ${!sub.activa ? "text-muted-foreground line-through decoration-muted-foreground/50" : "text-foreground"}`}
                        />
                        <Select
                          value={sub.parent_id ?? undefined}
                          onValueChange={(value) =>
                            updateCat(sub.id, { parent_id: value })
                          }
                        >
                          <SelectTrigger className="h-9 w-44 shrink-0 text-xs">
                            <SelectValue placeholder="Mover a..." />
                          </SelectTrigger>
                          <SelectContent>
                            {roots.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.nombre}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {renderRowActions(sub)}
                      </div>
                    ))}

                    <div className="flex items-center gap-2 py-2 pr-3">
                      <CornerDownRight className="w-4 h-4 text-muted-foreground/30 shrink-0" />
                      <Input
                        placeholder="+ Agregar subcategoría..."
                        value={newSubNameByParent[root.id] || ""}
                        onChange={(e) =>
                          setNewSubNameByParent((prev) => ({
                            ...prev,
                            [root.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddSub(root.id);
                          }
                        }}
                        className="h-9 flex-1 shadow-none border-dashed border-border bg-transparent hover:border-primary/50 focus:border-solid focus:bg-background"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-2 p-3 bg-muted/10">
            <FolderTree className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            <Input
              placeholder="+ Agregar categoría principal..."
              value={newRootName}
              onChange={(e) => setNewRootName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddRoot();
                }
              }}
              className="h-10 flex-1 shadow-none font-medium border-dashed border-border bg-transparent hover:border-primary/50 focus:border-solid focus:bg-background"
            />
          </div>
        </div>
      </div>

      <AlertDialog
        open={rootPendingDelete !== null}
        onOpenChange={(open) => !open && setRootPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar categoría con subcategorías?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">
                {rootPendingDelete?.nombre}
              </strong>{" "}
              tiene{" "}
              {rootPendingDelete ? childrenOf(rootPendingDelete.id).length : 0}{" "}
              subcategoría(s). Eliminarla también elimina todas sus
              subcategorías.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRootPendingDelete(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                rootPendingDelete && confirmDelete(rootPendingDelete.id)
              }
              className="bg-danger hover:bg-danger/90 text-white"
            >
              Eliminar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {categoriaParaAtributos && (
        <CategoryAttributesModal
          open={categoriaParaAtributos !== null}
          onOpenChange={(open) => !open && setCategoriaParaAtributos(null)}
          categoriaId={categoriaParaAtributos.id}
          categoriaNombre={categoriaParaAtributos.nombre}
        />
      )}
    </div>
  );
}
