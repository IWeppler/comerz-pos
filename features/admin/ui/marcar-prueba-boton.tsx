"use client";

import { useState, useTransition } from "react";
import { FlaskConical } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { marcarUsuarioPruebaAction } from "@/features/admin/actions/usuarios-prueba";

/**
 * Marca una cuenta como prueba propia, o le saca la marca.
 *
 * Es lo único de este panel que necesita ser cliente, y por eso vive en su
 * propio archivo: el resto de `EmbudoAltaPanel` sigue siendo Server Component.
 *
 * `deducida` deshabilita el botón: esas salieron de un hecho del mail —un
 * subaddress de una casilla que ya existe— y no hay nada que decidir. Se
 * muestra igual, con el motivo en el `title`, para que quede claro por qué esa
 * fila no cuenta.
 */
export function MarcarPruebaBoton({
  usuarioId,
  esPrueba,
  deducida,
}: Readonly<{ usuarioId: string; esPrueba: boolean; deducida: boolean }>) {
  const [pendiente, startTransition] = useTransition();
  // Optimista: el `revalidatePath` del server tarda, y sin esto el botón queda
  // igual medio segundo y da la sensación de que no hizo nada.
  const [marcado, setMarcado] = useState(esPrueba);

  if (deducida) {
    return (
      <span
        title="Es un subaddress de una casilla que ya está registrada, o sea que va al mismo buzón. No cuenta para la tasa."
        className="shrink-0 cursor-help text-white/30"
      >
        <FlaskConical className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={pendiente}
      title={marcado ? "Es una prueba: no cuenta" : "Marcar como prueba propia"}
      aria-pressed={marcado}
      onClick={() => {
        const siguiente = !marcado;
        setMarcado(siguiente);

        startTransition(async () => {
          const res = await marcarUsuarioPruebaAction(usuarioId, siguiente);
          if (!res.ok) {
            // Volver atrás: el estado optimista mintió.
            setMarcado(!siguiente);
            toast.error(res.error ?? "No se pudo guardar.");
          }
        });
      }}
      className={`shrink-0 rounded p-0.5 transition-colors disabled:opacity-40 ${
        marcado
          ? "text-amber-400/80 hover:text-amber-400"
          : "text-white/20 hover:text-white/60"
      }`}
    >
      <FlaskConical className="h-3.5 w-3.5" />
    </button>
  );
}
