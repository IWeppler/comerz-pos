"use client";

import { Input } from "@/shared/ui/input";
import {
  MOTIVO_SIN_IMEI_MAX,
  MOTIVOS_SIN_IMEI,
  normalizarMotivoSinImei,
} from "@/features/sales/lib/aparatos-sin-imei";

/** Lo que eligió la vendedora: una opción fija o "Otro" con texto propio. */
export type EleccionMotivoSinImei = { opcion: string; otro: string };

export const OPCION_OTRO = "__OTRO__";

/** El motivo que viaja a create-sale, o null si todavía no hay uno válido. */
export function motivoElegido(
  eleccion: EleccionMotivoSinImei | undefined,
): string | null {
  if (!eleccion?.opcion) return null;
  return normalizarMotivoSinImei(
    eleccion.opcion === OPCION_OTRO ? eleccion.otro : eleccion.opcion,
  );
}

/**
 * Por qué un aparato que lleva IMEI sale sin número. Obligatorio: sin motivo
 * no se cobra (create-sale lo exige en las ventas online).
 */
export function MotivoSinImeiField({
  idBase,
  eleccion,
  onChange,
}: Readonly<{
  idBase: string;
  eleccion: EleccionMotivoSinImei | undefined;
  onChange: (eleccion: EleccionMotivoSinImei) => void;
}>) {
  const opcion = eleccion?.opcion ?? "";
  const otro = eleccion?.otro ?? "";
  const opciones = [...MOTIVOS_SIN_IMEI, OPCION_OTRO];

  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-muted-foreground mb-1">
        ¿Por qué sale sin IMEI?
      </legend>
      {opciones.map((valor) => (
        <label
          key={valor}
          htmlFor={`${idBase}-${valor}`}
          className="flex items-center gap-2 min-h-11 text-sm cursor-pointer select-none"
        >
          <input
            id={`${idBase}-${valor}`}
            type="radio"
            name={idBase}
            className="h-4 w-4"
            checked={opcion === valor}
            onChange={() => onChange({ opcion: valor, otro })}
          />
          {valor === OPCION_OTRO ? "Otro motivo" : valor}
        </label>
      ))}
      {opcion === OPCION_OTRO && (
        <Input
          value={otro}
          onChange={(e) => onChange({ opcion, otro: e.target.value })}
          placeholder="Escribí el motivo"
          aria-label="Otro motivo"
          maxLength={MOTIVO_SIN_IMEI_MAX}
          className="h-11 text-sm"
          autoComplete="off"
          autoFocus
        />
      )}
    </fieldset>
  );
}
