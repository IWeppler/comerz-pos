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
  crearCuentaFinancieraAction,
  getCuentasFinancierasAction,
  type CuentaFinanciera,
} from "@/features/caja/actions/cuentas-financieras";
import type { TipoMetodo } from "@/entities/payments/types";
import {
  cuentasElegibles,
  requiereCuentaDestino,
  tipoCuentaSugerido,
} from "../lib/cuenta-destino-metodo";

const CREAR = "__crear__";

/**
 * "¿En qué cuenta cae la plata de este método?"
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TRAE LA CREACIÓN DE CUENTA ADENTRO, Y ESE ES EL PUNTO
 *
 * Un comercio que recién arranca tiene CAJA_DIARIA y nada más. Si el selector
 * solo listara lo que existe, dar de alta "Mercado Pago" sería imposible sin
 * salir a otra pantalla, y el que no salga termina con el método sin cuenta —
 * que es exactamente el agujero que esto viene a cerrar.
 *
 * No va como `<form>` anidado: eso es HTML inválido y además dispararía el
 * submit del formulario de afuera. Se arma el FormData a mano y se llama a la
 * action, que es la MISMA que usa el panel de cuentas de /caja.
 *
 * Con EFECTIVO no se muestra nada: esa plata va siempre a la caja diaria y el
 * trigger la resuelve. Un selector ahí sería ofrecer una decisión que no
 * existe.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function SelectorCuentaDestino({
  tipo,
  valor,
  onChange,
}: Readonly<{
  tipo: TipoMetodo;
  valor: string;
  onChange: (cuentaId: string) => void;
}>) {
  const [cuentas, setCuentas] = useState<CuentaFinanciera[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [guardando, iniciar] = useTransition();

  useEffect(() => {
    let vigente = true;
    getCuentasFinancierasAction().then((data) => {
      if (vigente) setCuentas(cuentasElegibles(data));
    });
    return () => {
      vigente = false;
    };
  }, []);

  if (!requiereCuentaDestino(tipo)) {
    return (
      <p className="text-[10px] text-muted-foreground leading-tight">
        El efectivo entra siempre a la Caja diaria y se arquea al cerrar el
        turno.
      </p>
    );
  }

  const crear = () => {
    const nombre = nombreNuevo.trim();
    if (!nombre) return;

    iniciar(async () => {
      const formData = new FormData();
      formData.append("nombre", nombre);
      formData.append("tipo", tipoCuentaSugerido(tipo));

      const res = await crearCuentaFinancieraAction(
        { error: null, success: false },
        formData,
      );

      if (!res.success) {
        toast.error(res.error ?? "No se pudo crear la cuenta.");
        return;
      }

      // La action no devuelve el id, así que se relee y se busca por nombre.
      // Es un viaje de más en una operación que pasa una vez por cuenta.
      const frescas = cuentasElegibles(await getCuentasFinancierasAction());
      setCuentas(frescas);
      const creada = frescas.find((cuenta) => cuenta.nombre === nombre);
      if (creada) onChange(creada.id);
      setCreando(false);
      setNombreNuevo("");
      toast.success(`Cuenta "${nombre}" creada.`);
    });
  };

  return (
    <div className="space-y-2">
      <Label>
        ¿Dónde cae la plata? <span className="text-danger">*</span>
      </Label>

      <Select
        value={creando ? CREAR : valor}
        onValueChange={(nuevo) => {
          if (nuevo === CREAR) {
            setCreando(true);
            return;
          }
          setCreando(false);
          onChange(nuevo);
        }}
        disabled={cuentas === null}
      >
        <SelectTrigger className="rounded-lg shadow-none w-full">
          <SelectValue
            placeholder={cuentas === null ? "Cargando cuentas..." : "Elegí una"}
          />
        </SelectTrigger>
        <SelectContent>
          {(cuentas ?? []).map((cuenta) => (
            <SelectItem key={cuenta.id} value={cuenta.id}>
              {cuenta.nombre}
            </SelectItem>
          ))}
          <SelectItem value={CREAR}>+ Crear una cuenta nueva…</SelectItem>
        </SelectContent>
      </Select>

      {creando && (
        <div className="flex gap-2">
          <Input
            value={nombreNuevo}
            onChange={(evento) => setNombreNuevo(evento.target.value)}
            placeholder="Ej: Banco Nación, Mercado Pago"
            className="rounded-lg shadow-none"
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

      <p className="text-[10px] text-muted-foreground leading-tight">
        Los cobros con acreditación en 0 días entran directo acá. Los diferidos
        pasan primero por Por acreditar.
      </p>
    </div>
  );
}
