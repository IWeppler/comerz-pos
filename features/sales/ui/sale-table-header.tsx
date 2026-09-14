import { ReactNode } from "react";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Search } from "lucide-react";
import {
  ESTADOS_VENTA,
  METODO_TODOS,
  COMPROBANTES_FILTRO,
} from "./sale-table-filtros";

export interface SaleTableHeaderOption {
  value: string;
  label: string;
}

interface SaleTableHeaderProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  orderValue: string;
  onOrderChange: (value: string) => void;
  orderOptions: SaleTableHeaderOption[];
  estadoValue: string;
  onEstadoChange: (value: string) => void;
  metodoValue: string;
  onMetodoChange: (value: string) => void;
  /** Los métodos que aparecen en el historial, no los configurados. Ver la
   * tabla: una opción que da cero resultados es peor que no ofrecerla. */
  metodosOptions: string[];
  /** Ausente = el historial no tiene facturas y el select no se muestra. */
  comprobanteValue?: string;
  onComprobanteChange?: (value: string) => void;
  actions?: ReactNode;
}

/**
 * La barra de búsqueda y filtros del historial.
 *
 * DOS FILAS EN MOBILE, UNA EN ESCRITORIO, y no es una decisión estética: son
 * cuatro controles y el buscador es el único donde se escribe. Apretados en una
 * sola fila de celular, el input quedaba en ~90px —cuatro caracteres— justo
 * cuando lo que se pega ahí es un número de ticket de trece. Arriba el
 * buscador a todo el ancho; abajo los tres selects repartiéndose la fila.
 *
 * Los selects no se colapsan a íconos como hacía el de orden: un ícono no
 * puede mostrar QUÉ filtro está activo, y un filtro activo invisible es la
 * causa clásica del "me desaparecieron las ventas".
 */
export function SaleTableHeader({
  searchValue,
  onSearchChange,
  orderValue,
  onOrderChange,
  orderOptions,
  estadoValue,
  onEstadoChange,
  metodoValue,
  onMetodoChange,
  metodosOptions,
  comprobanteValue,
  onComprobanteChange,
}: Readonly<SaleTableHeaderProps>) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 sm:flex-row sm:items-center sm:gap-3 sm:p-3">
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground sm:h-5 sm:w-5" />
        <Input
          placeholder="Buscar por cliente o #ticket..."
          className="h-10 w-full rounded-lg border-border/60 bg-muted pl-9 text-xs shadow-none transition-colors focus-visible:bg-background sm:pl-10 sm:text-sm"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <FiltroSelect
          value={estadoValue}
          onChange={onEstadoChange}
          placeholder="Estado"
          opciones={ESTADOS_VENTA.map((estado) => ({ ...estado }))}
        />

        <FiltroSelect
          value={metodoValue}
          onChange={onMetodoChange}
          placeholder="Pago"
          opciones={[
            { value: METODO_TODOS, label: "Todos los pagos" },
            ...metodosOptions.map((metodo) => ({
              value: metodo,
              label: metodo,
            })),
          ]}
        />

        {comprobanteValue !== undefined && onComprobanteChange && (
          <FiltroSelect
            value={comprobanteValue}
            onChange={onComprobanteChange}
            placeholder="Comprobante"
            opciones={COMPROBANTES_FILTRO.map((c) => ({ ...c }))}
          />
        )}

        <FiltroSelect
          value={orderValue}
          onChange={onOrderChange}
          placeholder="Ordenar"
          opciones={orderOptions}
        />
      </div>
    </div>
  );
}

function FiltroSelect({
  value,
  onChange,
  placeholder,
  opciones,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  opciones: SaleTableHeaderOption[];
}>) {
  return (
    <Select value={value} onValueChange={onChange}>
      {/* `flex-1 min-w-0` en mobile para que los tres se repartan el ancho sin
          desbordar, y ancho fijo en escritorio para que no bailen al cambiar
          de opción. */}
      <SelectTrigger className="h-10 min-w-0 flex-1 rounded-lg border-border/60 bg-muted px-2.5 text-xs font-medium shadow-none sm:w-40 sm:flex-none sm:px-3 sm:text-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="rounded-xl">
        {opciones.map((opcion) => (
          <SelectItem key={opcion.value} value={opcion.value}>
            {opcion.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
