"use client";

import { useActionState, useEffect, useState } from "react";
import { createClient } from "@/shared/config/supabase/client";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { CreateClientDialog } from "@/features/clients/ui/create-client-dialog";
import { Check, ChevronDown, Loader2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/shared/ui/input";
import {
  crearClienteAction,
  type ClienteCreado,
} from "@/features/clients/actions/manage-clients";

export interface ClienteBasico {
  id: string;
  nombre: string;
  telefono?: string | null;
  exceptuado_entrega_minima?: boolean;
  /** Lista de precios sugerida. El POS la propone al elegir al cliente; no
   * la aplica solo si el ticket ya tiene renglones. Ver `cart-panel-admin`. */
  lista_precio_id?: string | null;
  /** Para saber qué letra le corresponde ANTES de cobrar (un RI a otro RI
   * es A, al resto B). Ausente = consumidor final. */
  condicion_iva?: string | null;
}

interface ClientSelectorProps {
  clienteSeleccionado: ClienteBasico | null;
  onClienteChange: (cliente: ClienteBasico | null) => void;
  /** Apertura controlada desde afuera. La usa el atajo F7 del POS, que tiene
   * que poder abrir este popover sin que haya un click de por medio. Sin estas
   * props el selector se sigue manejando solo, como siempre. */
  abierto?: boolean;
  onAbiertoChange?: (abierto: boolean) => void;
}

interface EstadoCrearCliente {
  error: string | null;
  success: boolean;
  cliente?: ClienteCreado;
}

export function ClientSelector({
  clienteSeleccionado,
  onClienteChange,
  abierto,
  onAbiertoChange,
}: Readonly<ClientSelectorProps>) {
  const [openInterno, setOpenInterno] = useState(false);
  const esControlado = abierto !== undefined;
  const open = esControlado ? abierto : openInterno;

  const setOpen = (siguiente: boolean) => {
    if (!esControlado) setOpenInterno(siguiente);
    onAbiertoChange?.(siguiente);
  };
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  /**
   * El drawer que contiene este selector, cuando lo hay.
   *
   * En celular el ticket del POS vive adentro de un drawer (vaul), que le
   * pone `pointer-events: none` al body mientras está abierto. El popover se
   * portalea al body por defecto, así que quedaba FUERA de lo que recibe
   * eventos: se abría y no se podía tocar ningún cliente. En escritorio el
   * mismo panel no es un drawer, y por eso ahí siempre funcionó.
   *
   * Se resuelve con un callback ref y no con un efecto: el nodo se conoce en
   * el momento en que React lo monta, y `setState` con el mismo elemento no
   * vuelve a renderizar. Sin drawer queda `null` y el popover va al body,
   * exactamente como antes.
   */
  const [contenedorDrawer, setContenedorDrawer] = useState<HTMLElement | null>(
    null,
  );
  const [clientes, setClientes] = useState<ClienteBasico[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!open) return;

    const fetchClientes = async () => {
      setIsLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clientes")
        .select(
          "id, nombre, telefono, exceptuado_entrega_minima, lista_precio_id, condicion_iva",
        )
        .eq("activo", true)
        .order("nombre");

      // El error NO se puede tragar: una lista vacía por RLS (negocio activo
      // sin resolver) se ve igual que un comercio sin clientes, y el vendedor
      // termina cargando la venta a consumidor final sin enterarse.
      if (error) {
        console.error("[ClientSelector] error cargando clientes:", error);
        toast.error("No se pudieron cargar los clientes.");
      }

      setClientes(data ?? []);
      setIsLoading(false);
    };

    fetchClientes();
  }, [open]);

  const filteredClientes = clientes.filter(
    (cliente) =>
      cliente.nombre.toLowerCase().includes(search.toLowerCase()) ||
      (cliente.telefono && cliente.telefono.includes(search)),
  );

  // El alta pasa por la misma server action que la ficha de clientes: así el
  // POS guarda TODOS los campos del formulario (DNI, email, datos fiscales) y
  // con la misma validación server-side, en vez de un insert propio que solo
  // mandaba nombre, teléfono y notas.
  const [, crearCliente, isCreating] = useActionState(
    async (prevState: EstadoCrearCliente, formData: FormData) => {
      const result = await crearClienteAction(prevState, formData);

      if (!result.success || !result.cliente) {
        toast.error(result.error || "Ocurrió un error al crear el cliente.");
        return result;
      }

      const nuevo = result.cliente;
      toast.success("Cliente creado correctamente.");
      setClientes((prev) =>
        [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)),
      );
      onClienteChange(nuevo);
      setIsCreateOpen(false);
      setOpen(false);
      return result;
    },
    { error: null, success: false },
  );

  return (
    <>
      <div
        ref={(nodo) =>
          setContenedorDrawer(
            nodo?.closest<HTMLElement>("[data-slot='drawer-content']") ?? null,
          )
        }
        className="flex flex-col gap-1.5 bg-background rounded-lg"
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={`w-full justify-between h-11 border-border shadow-none ${clienteSeleccionado ? "bg-background border-info/20 text-info" : "bg-background"}`}
            >
              <span className="truncate font-semibold">
                {clienteSeleccionado
                  ? clienteSeleccionado.nombre
                  : "Consumidor Final"}
              </span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            container={contenedorDrawer}
            className="w-[calc(100vw-2rem)] sm:w-85 p-0 rounded-xl overflow-hidden border-border"
            align="center"
          >
            <div className="flex items-center border-b border-border px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <Input
                className="flex h-11 w-full rounded-md bg-transparent py-3 border-none outline-none text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Buscar cliente por nombre o telefono..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus={false}
              />
            </div>

            <div className="max-h-55 overflow-y-auto p-1">
              <div
                className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none font-medium"
                onClick={() => {
                  onClienteChange(null);
                  setOpen(false);
                }}
              >
                <Check
                  className={`mr-2 h-4 w-4 ${!clienteSeleccionado ? "opacity-100 text-success" : "opacity-0"}`}
                />
                Consumidor Final
              </div>

              {isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando...
                </div>
              ) : filteredClientes.length === 0 && search !== "" ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No se encontraron clientes.
                </div>
              ) : (
                filteredClientes.map((cliente) => (
                  <div
                    key={cliente.id}
                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-muted font-medium"
                    onClick={() => {
                      onClienteChange(cliente);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${clienteSeleccionado?.id === cliente.id ? "opacity-100 text-success" : "opacity-0"}`}
                    />
                    <div className="flex flex-col">
                      <span>{cliente.nombre}</span>
                      {cliente.telefono ? (
                        <span className="text-[10px] text-muted-foreground font-normal">
                          {cliente.telefono}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-2 border-t border-border bg-muted/20">
              <Button
                variant="ghost"
                className="w-full justify-start text-primary hover:text-info hover:bg-info/10 h-9 font-semibold"
                onClick={() => {
                  setOpen(false);
                  setIsCreateOpen(true);
                }}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Crear nuevo cliente
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <CreateClientDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        action={crearCliente}
        isPending={isCreating}
      />
    </>
  );
}
