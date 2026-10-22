"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { toast } from "@/shared/ui/toast";
import {
  crearProveedorAction,
  listarProveedoresAction,
  type Proveedor,
} from "../actions/proveedores";

interface SelectorProveedorProps {
  valor: string | null;
  onChange: (proveedor: Proveedor | null) => void;
  /** Texto del botón sin proveedor elegido. */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * Elegir el proveedor de un remito, o crearlo con el nombre escrito. El
 * proveedor es a quién se le compra (y a quién se le debe), no el nombre del
 * ingreso.
 */
export function SelectorProveedor({
  valor,
  onChange,
  placeholder = "Elegí o creá el proveedor",
  disabled,
  id,
}: Readonly<SelectorProveedorProps>) {
  const [open, setOpen] = useState(false);
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    listarProveedoresAction().then((data) => {
      if (!cancelado) setProveedores(data);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  const elegido = proveedores?.find((p) => p.id === valor) ?? null;
  const texto = busqueda.trim();
  const filtrados = useMemo(() => {
    const q = texto.toLowerCase();
    return (proveedores ?? []).filter((p) => p.nombre.toLowerCase().includes(q));
  }, [proveedores, texto]);
  const existeExacto = (proveedores ?? []).some(
    (p) => p.nombre.trim().toLowerCase() === texto.toLowerCase(),
  );

  const crear = async () => {
    setCreando(true);
    const { proveedor, error } = await crearProveedorAction(texto);
    setCreando(false);
    if (!proveedor) {
      toast.error(error ?? "No se pudo crear el proveedor.");
      return;
    }
    setProveedores((prev) =>
      prev?.some((p) => p.id === proveedor.id)
        ? prev
        : [...(prev ?? []), proveedor].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    );
    onChange(proveedor);
    setBusqueda("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-11 w-full justify-between shadow-none"
        >
          <span className={`truncate ${elegido ? "font-medium" : "text-muted-foreground"}`}>
            {elegido ? elegido.nombre : placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[calc(100vw-2rem)] p-0 sm:w-80" align="start">
        <div className="flex items-center border-b border-border px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            className="h-11 border-none bg-transparent shadow-none focus-visible:ring-0"
            placeholder="Buscar o escribir uno nuevo..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && texto && !existeExacto) {
                e.preventDefault();
                void crear();
              }
            }}
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {proveedores === null ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando...
            </div>
          ) : (
            <>
              {valor && (
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  Sin proveedor
                </button>
              )}
              {filtrados.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={p.id === valor}
                  className="flex min-h-11 w-full items-center rounded-sm px-2 text-left text-sm font-medium hover:bg-muted"
                  onClick={() => {
                    onChange(p);
                    setBusqueda("");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${p.id === valor ? "text-success opacity-100" : "opacity-0"}`}
                  />
                  {p.nombre}
                </button>
              ))}
              {filtrados.length === 0 && !texto && (
                <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                  Todavía no cargaste proveedores. Escribí el nombre para crearlo.
                </p>
              )}
            </>
          )}
        </div>
        {texto && !existeExacto && (
          <div className="border-t border-border p-1">
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full justify-start font-semibold text-primary"
              disabled={creando}
              onClick={() => void crear()}
            >
              {creando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Crear «{texto}»
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
