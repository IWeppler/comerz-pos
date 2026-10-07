import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { ArbolCategorias } from "@/shared/utils/category-tree";

interface CategoryPillsProps {
  tipoActivo: string;
  arbolCategorias: ArbolCategorias;
  onSelectTodos: () => void;
  onSelectCategoria: (id: string) => void;
  /**
   * En la grilla completa ("ver todo") el primer chip ya no es un filtro —
   * es la salida hacia la portada. Sin esto quedaba marcado como activo y al
   * tocarlo te sacaba de la pantalla, que se lee como un bug.
   */
  volverAInicio?: boolean;
}

const pillBase =
  "rounded-full h-12 md:h-9 px-5 text-xs font-semibold shrink-0 shadow-none border-border/60 transition-colors";
const pillInactivo =
  "bg-background text-muted-foreground hover:bg-muted hover:text-foreground";
const pillActivo = "bg-foreground text-background border-transparent hover:bg-foreground/90";

/**
 * Chips de categoría, tolerantes a árbol MIXTO: si `arbolCategorias.padres`
 * está vacío (Evens hoy, 100% plano), esto degrada exactamente a la fila
 * plana de siempre — cero cambio visual. Si hay padres con hijos, agrega
 * un segundo nivel de navegación sin esconder las categorías sueltas que
 * todavía no tienen padre asignado (Pasada 2 pendiente).
 */
export function CategoryPills({
  tipoActivo,
  arbolCategorias,
  onSelectTodos,
  onSelectCategoria,
  volverAInicio = false,
}: Readonly<CategoryPillsProps>) {
  // El padre "en vista" para el nivel 2 es el que matchea directo (se
  // seleccionó el padre o "Todo <Padre>") o el que contiene al hijo activo
  // (se seleccionó una subcategoría puntual).
  const padreEnVista = useMemo(() => {
    const directo = arbolCategorias.padres.find((p) => p.id === tipoActivo);
    if (directo) return directo;
    return (
      arbolCategorias.padres.find((p) =>
        p.hijos.some((h) => h.id === tipoActivo),
      ) ?? null
    );
  }, [arbolCategorias, tipoActivo]);

  if (padreEnVista) {
    return (
      <div className="flex gap-2 overflow-x-auto bg-background py-1 scrollbar-hide w-full top-16 z-20">
        <Button
          variant="default"
          className={`${pillBase} sticky left-0 z-10 bg-background gap-1.5 ${pillInactivo}`}
          onClick={onSelectTodos}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {padreEnVista.nombre}
        </Button>

        {padreEnVista.hijos.map((hijo) => (
          <Button
            key={hijo.id}
            variant={tipoActivo === hijo.id ? "default" : "outline"}
            className={`${pillBase} ${tipoActivo === hijo.id ? pillActivo : pillInactivo}`}
            onClick={() => onSelectCategoria(hijo.id)}
          >
            {hijo.nombre}{" "}
            <span className="ml-1.5 opacity-60 font-normal">
              ({hijo.count})
            </span>
          </Button>
        ))}

        <Button
          variant={tipoActivo === padreEnVista.id ? "default" : "outline"}
          className={`${pillBase} ${tipoActivo === padreEnVista.id ? pillActivo : pillInactivo}`}
          onClick={() => onSelectCategoria(padreEnVista.id)}
        >
          Todo {padreEnVista.nombre}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto bg-background py-1 scrollbar-hide w-full top-16 z-20">
      <Button
        variant={!volverAInicio && tipoActivo === "todos" ? "default" : "outline"}
        className={`${pillBase} ${volverAInicio ? "gap-1.5 " : ""}${
          !volverAInicio && tipoActivo === "todos"
            ? "bg-neutral-900 text-white border-transparent hover:bg-neutral-800"
            : pillInactivo
        }`}
        onClick={onSelectTodos}
      >
        {volverAInicio ? (
          <>
            <ArrowLeft className="w-3.5 h-3.5" />
            Inicio
          </>
        ) : (
          "Ver todo"
        )}
      </Button>

      {arbolCategorias.padres.map((padre) => (
        <Button
          key={padre.id}
          variant="outline"
          className={`${pillBase} gap-1.5 font-bold border-foreground/30 text-foreground hover:bg-muted`}
          onClick={() => onSelectCategoria(padre.id)}
        >
          {/* <FolderOpen className="w-3.5 h-3.5 text-primary" /> */}
          {padre.nombre}{" "}
          <span className="ml-1 opacity-60 font-normal">({padre.count})</span>
        </Button>
      ))}

      {arbolCategorias.sinPadre.map((cat) => (
        <Button
          key={cat.id}
          variant={tipoActivo === cat.id ? "default" : "outline"}
          className={`${pillBase} ${tipoActivo === cat.id ? pillActivo : pillInactivo}`}
          onClick={() => onSelectCategoria(cat.id)}
        >
          {cat.nombre}{" "}
          <span className="ml-1.5 opacity-60 font-normal">({cat.count})</span>
        </Button>
      ))}
    </div>
  );
}
