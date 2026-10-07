"use client";

import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { BOTON_CATALOGO } from "../lib/estilos-catalogo";
import { Input } from "@/shared/ui/input";
import { normalizarCodigoCupon, codigoCuponValido } from "../lib/codigo-cupon";

export function CuponCatalogo({ codigo, monto, aviso, onAplicar, onQuitar }: {
  codigo?: string | null; monto: number; aviso?: string;
  onAplicar: (codigo: string) => Promise<boolean>; onQuitar: () => void;
}) {
  const [valor, setValor] = useState("");
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState("");
  return <div className="space-y-2">
    <label htmlFor="cupon-catalogo" className="text-sm font-medium">¿Tenés un código de descuento?</label>
    {codigo ? <div className="flex items-center justify-between gap-2 rounded-lg border border-border pl-3 text-sm">
      <span>{codigo} · −${monto.toLocaleString("es-AR")}</span>
      <Button type="button" variant="ghost" className="h-11" onClick={onQuitar} aria-label={`Quitar cupón ${codigo}`}>Quitar</Button>
    </div> : <form className="flex gap-2" onSubmit={async e => {
      e.preventDefault();
      const normalizado = normalizarCodigoCupon(valor);
      if (!normalizado || !codigoCuponValido(normalizado)) { setError("Ese código no es válido o ya venció"); return; }
      setPendiente(true); setError("");
      try { if (!await onAplicar(normalizado)) setError("Ese código no es válido o ya venció"); }
      catch { setError("No pudimos validar el código. Intentá de nuevo."); }
      finally { setPendiente(false); }
    }}>
      <Input id="cupon-catalogo" className="h-11 min-w-0 text-base uppercase" value={valor} maxLength={40} onChange={e => setValor(e.target.value)} autoCapitalize="characters" autoCorrect="off" aria-invalid={!!error} disabled={pendiente} />
      <Button className={`h-11 ${BOTON_CATALOGO}`} disabled={pendiente || !valor.trim()}>{pendiente ? "Validando…" : "Aplicar"}</Button>
    </form>}
    {(error || aviso) && <p role="status" className="text-xs text-muted-foreground">{error || aviso}</p>}
  </div>;
}
