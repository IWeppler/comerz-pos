import { Gift, Megaphone, Rocket, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import { parsearNovedad, type IconoNovedad, type Tramo } from "@/features/notificaciones/lib/texto-novedad";

export const ICONO_NOVEDAD: Record<IconoNovedad, LucideIcon> = {
  sparkles: Sparkles,
  rocket: Rocket,
  wrench: Wrench,
  megaphone: Megaphone,
  gift: Gift,
};

/**
 * El cuerpo de una novedad, dibujado con elementos de React (nunca HTML
 * crudo): negritas, párrafos y viñetas. Lo usan la campana y la vista previa
 * del editor de /admincomerz, así lo que se previsualiza es lo que se ve.
 */
export function CuerpoNovedad({ cuerpo, className = "" }: Readonly<{ cuerpo: string; className?: string }>) {
  const bloques = parsearNovedad(cuerpo);
  if (bloques.length === 0) return null;
  return (
    <div className={`space-y-2 text-sm leading-relaxed text-muted-foreground ${className}`}>
      {bloques.map((b, i) =>
        b.tipo === "parrafo" ? (
          <p key={i}>
            <Tramos tramos={b.tramos} />
          </p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground/60">
            {b.items.map((tramos, j) => (
              <li key={j}>
                <Tramos tramos={tramos} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function Tramos({ tramos }: Readonly<{ tramos: Tramo[] }>) {
  return (
    <>
      {tramos.map((t, i) =>
        t.negrita ? (
          <strong key={i} className="font-semibold text-foreground">
            {t.texto}
          </strong>
        ) : (
          <span key={i}>{t.texto}</span>
        ),
      )}
    </>
  );
}
