"use client";

/** Un renglón elegible de una lista con radio (entrega, medio de pago). */
export function OpcionRadio({
  activa,
  onElegir,
  icono,
  titulo,
  detalle,
  derecha,
  children,
}: Readonly<{
  activa: boolean;
  onElegir: () => void;
  icono?: React.ReactNode;
  titulo: string;
  detalle?: string;
  derecha?: React.ReactNode;
  children?: React.ReactNode;
}>) {
  return (
    <div className={`border-b border-border last:border-b-0 ${activa ? "bg-muted/50" : ""}`}>
      <div
        role="radio"
        aria-checked={activa}
        tabIndex={0}
        onClick={onElegir}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onElegir();
          }
        }}
        className="flex min-h-16 cursor-pointer items-center gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
            activa ? "border-foreground" : "border-muted-foreground/50"
          }`}
        >
          {activa && <span className="h-2.5 w-2.5 rounded-full bg-foreground" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{titulo}</span>
          {detalle && <span className="block text-xs text-muted-foreground">{detalle}</span>}
        </span>
        {derecha && <span className="shrink-0 text-sm font-medium">{derecha}</span>}
        {icono && <span className="shrink-0 text-muted-foreground">{icono}</span>}
      </div>
      {children && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
