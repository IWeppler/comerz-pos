"use client";

import { Banknote, Landmark, Wallet } from "lucide-react";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import type { OpcionesReintegro } from "../actions/opciones-reintegro";

const pesos = (monto: number) => `$${Math.round(monto).toLocaleString("es-AR")}`;

/** Valor del selector para "queda como saldo a favor del cliente". */
export const REINTEGRO_A_CUENTA = "A_CUENTA";
/** Valor del selector, sin permiso de elegir medio, para "por donde se
 * cobró": es lo que pasaba siempre y la RPC lo resuelve sola (medio null). */
export const REINTEGRO_POR_EL_COBRO = "POR_EL_COBRO";

/**
 * Por dónde se le devuelve la plata al cliente.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ARRANCA SIN NADA ELEGIDO, Y ESO ES LO IMPORTANTE
 *
 * Un default acá no es una comodidad: es la decisión que se guarda cuando
 * nadie mira. Elegir efectivo saca plata del cajón y elegir otro medio la
 * deja adentro, así que confirmar sin leer tiene que ser imposible. Mismo
 * criterio que el "por qué" de la anulación, que también nace vacío.
 *
 * Dos llaves distintas, y por eso dos formas del selector:
 * - Con `ventas.elegir_medio_devolucion` (hoy, ADMIN) se elige entre todos
 *   los medios del comercio, y además "a cuenta".
 * - Sin ese permiso, si la venta tiene cliente, se elige entre "por donde se
 *   cobró" (lo de siempre) y "a cuenta" (20260928240000): un vale no saca
 *   plata del cajón, así que alcanza con poder devolver.
 * Sin permiso y sin cliente no hay selector y la devolución sale por el medio
 * del cobro, que es lo que pasó siempre.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function SelectorMedioReintegro({
  opciones,
  valor,
  onChange,
  monto,
}: Readonly<{
  opciones: OpcionesReintegro | null;
  valor: string | null;
  onChange: (valor: string) => void;
  /** Lo que se va a devolver. Puede ser menos que lo cobrado en una
   * devolución parcial, así que lo pasa quien lo sabe. */
  monto: number;
}>) {
  if (!hayQueElegir(opciones) || !opciones) return null;

  const opcionACuenta = opciones.puedeDejarACuenta ? (
    <Label
      htmlFor="reintegro-a-cuenta"
      className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-transparent px-2 py-2 hover:bg-muted"
    >
      <RadioGroupItem value={REINTEGRO_A_CUENTA} id="reintegro-a-cuenta" />
      <Wallet className="h-4 w-4 shrink-0 text-success" />
      <span className="min-w-0 flex-1 break-words text-sm font-medium">
        A cuenta{opciones.clienteNombre ? ` de ${opciones.clienteNombre}` : ""}
      </span>
      <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Saldo a favor
      </span>
    </Label>
  ) : null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <Label className="text-sm font-semibold">
        ¿Por dónde le devolvés {monto > 0 ? pesos(monto) : "la plata"}?
      </Label>
      <p className="text-xs text-muted-foreground">
        {opciones.medioDelCobro
          ? `Se cobró con ${opciones.medioDelCobro}.${opciones.puedeElegir ? " Podés devolver por otro medio." : ""}`
          : "Elegí el medio por el que sale la plata."}
      </p>

      <RadioGroup
        value={valor ?? ""}
        onValueChange={onChange}
        className="gap-1 pt-1"
      >
        {opciones.puedeElegir ? (
          opciones.metodos.map((metodo) => (
            <Label
              key={metodo.id}
              htmlFor={`reintegro-${metodo.id}`}
              className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-transparent px-2 py-2 hover:bg-muted"
            >
              <RadioGroupItem value={metodo.id} id={`reintegro-${metodo.id}`} />
              {metodo.tipo === "EFECTIVO" ? (
                <Banknote className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 break-words text-sm font-medium">
                {metodo.nombre}
              </span>
              {metodo.esElDelCobro && (
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Con esto se cobró
                </span>
              )}
            </Label>
          ))
        ) : (
          <Label
            htmlFor="reintegro-por-el-cobro"
            className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-transparent px-2 py-2 hover:bg-muted"
          >
            <RadioGroupItem
              value={REINTEGRO_POR_EL_COBRO}
              id="reintegro-por-el-cobro"
            />
            <Banknote className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 break-words text-sm font-medium">
              {opciones.medioDelCobro
                ? `Devolver por ${opciones.medioDelCobro}`
                : "Devolver por donde se cobró"}
            </span>
          </Label>
        )}
        {opcionACuenta}
      </RadioGroup>

      {/* El efectivo es el único que mueve el arqueo, así que es el único que
          necesita decirlo antes de confirmar. */}
      {valor !== null &&
        opciones.metodos.find((metodo) => metodo.id === valor)?.tipo ===
          "EFECTIVO" && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            Sale de la caja: el turno va a cerrar con {pesos(monto)} menos.
          </p>
        )}
      {valor === REINTEGRO_A_CUENTA && (
        <p className="text-xs text-success">
          No sale plata: queda como saldo a favor y se descuenta de su próxima
          compra.
        </p>
      )}
    </div>
  );
}

/** ¿Se muestra el selector? Hace falta plata cobrada y alguna opción real. */
function hayQueElegir(opciones: OpcionesReintegro | null): boolean {
  if (!opciones || opciones.montoCobrado <= 0) return false;
  if (opciones.puedeElegir && opciones.metodos.length > 0) return true;
  return opciones.puedeDejarACuenta;
}

/** ¿Se puede confirmar? Con el selector visible hay que haber elegido. Vive
 * acá para que las dos pantallas no contesten distinto. */
export function faltaElegirMedio(
  opciones: OpcionesReintegro | null,
  valor: string | null,
): boolean {
  if (!hayQueElegir(opciones)) return false;
  return valor === null;
}

/** Lo que viaja a la action: el medio elegido, o a cuenta. "Por el cobro" y
 * "nada elegido" son lo mismo para la RPC: medio null. */
export function resolverReintegro(valor: string | null): {
  metodoId: string | null;
  aCuenta: boolean;
} {
  if (valor === REINTEGRO_A_CUENTA) return { metodoId: null, aCuenta: true };
  if (valor === null || valor === REINTEGRO_POR_EL_COBRO) {
    return { metodoId: null, aCuenta: false };
  }
  return { metodoId: valor, aCuenta: false };
}
