"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
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
  crearCategoriaEgresoAction,
  getCategoriasEgresoAction,
  type CategoriaEgreso,
} from "../actions/categorias-egreso";

const SIN_CATEGORIA = "__sin_categoria__";
const CREAR = "__crear__";

/**
 * "¿En qué categoría entra este gasto?"
 *
 * Mismo patrón que `SelectorCuentaDestino`: la creación va ADENTRO del
 * selector, porque un comercio recién llegado tiene las 10 categorías
 * sembradas y nada más — si hiciera falta salir a Configuración para dar de
 * alta "Delivery", la mitad de los gastos quedarían en la primera categoría
 * que aparece en la lista, no en la que corresponde.
 *
 * **Opcional, y "Sin categoría" es la opción de arriba, no un placeholder
 * vacío.** Obligar a elegir es la decisión que se guarda cuando nadie mira:
 * la vendedora con la fila en el mostrador toca la primera de la lista. Un
 * gasto sin categoría es un valor válido (`categoria_id = null`), no un
 * error de carga.
 */
export function SelectorCategoriaEgreso({
  valor,
  onChange,
}: Readonly<{
  /** "" = sin categoría. */
  valor: string;
  onChange: (categoriaId: string) => void;
}>) {
  const [categorias, setCategorias] = useState<CategoriaEgreso[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [guardando, iniciar] = useTransition();

  useEffect(() => {
    let vigente = true;
    getCategoriasEgresoAction().then((data) => {
      if (vigente) setCategorias(data);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const crear = () => {
    const nombre = nombreNuevo.trim();
    if (!nombre) return;

    iniciar(async () => {
      const res = await crearCategoriaEgresoAction(nombre);
      if (!res.categoria) {
        toast.error(res.error ?? "No se pudo crear la categoría.");
        return;
      }
      setCategorias((actual) => {
        const sinDuplicado = (actual ?? []).filter(
          (c) => c.id !== res.categoria!.id,
        );
        return [...sinDuplicado, res.categoria!].sort(
          (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre),
        );
      });
      onChange(res.categoria.id);
      setCreando(false);
      setNombreNuevo("");
      toast.success(`Categoría "${res.categoria.nombre}" creada.`);
    });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="categoria-egreso">Categoría (opcional)</Label>

      <Select
        value={creando ? CREAR : valor || SIN_CATEGORIA}
        onValueChange={(nuevo) => {
          if (nuevo === CREAR) {
            setCreando(true);
            return;
          }
          setCreando(false);
          onChange(nuevo === SIN_CATEGORIA ? "" : nuevo);
        }}
        disabled={categorias === null}
      >
        <SelectTrigger id="categoria-egreso" className="w-full">
          <SelectValue
            placeholder={
              categorias === null ? "Cargando categorías..." : "Sin categoría"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SIN_CATEGORIA}>Sin categoría</SelectItem>
          {(categorias ?? []).map((categoria) => (
            <SelectItem key={categoria.id} value={categoria.id}>
              {categoria.nombre}
            </SelectItem>
          ))}
          <SelectItem value={CREAR}>+ Crear categoría nueva…</SelectItem>
        </SelectContent>
      </Select>

      {creando && (
        <div className="flex gap-2">
          <Input
            value={nombreNuevo}
            onChange={(evento) => setNombreNuevo(evento.target.value)}
            placeholder="Ej: Delivery, Mantenimiento"
            autoFocus
          />
          <Button
            type="button"
            onClick={crear}
            disabled={guardando || !nombreNuevo.trim()}
          >
            {guardando ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
