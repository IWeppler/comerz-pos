"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  seleccionarNegocioAction,
  type MembresiaNegocio,
} from "@/features/auth/actions/negocios";

/**
 * - "sidebar": la cajita con borde del sidebar desktop.
 * - "identidad": el logo + nombre del comercio que ya oficia de identidad en
 *   el header mobile. Sin caja propia ni borde — ES el branding, y además
 *   abre el selector cuando hay más de un negocio. Así el comercio activo se
 *   dibuja UNA sola vez.
 */
type ModoSwitcher = "sidebar" | "identidad";

interface NegocioSwitcherProps {
  negocios: MembresiaNegocio[];
  negocioActivoId?: string;
  /** Nombre y logo del negocio activo, que ya vienen de configuracion_pos. */
  nombreActivo: string;
  logoActivo?: string;
  inicial: string;
  isCollapsed: boolean;
  modo?: ModoSwitcher;
  /** Modo "identidad" con un solo negocio: no hay nada que elegir, así que el
   * branding vuelve a ser un link (a dónde lo decide quien lo usa). */
  hrefSinSwitcher?: string;
  /** Modo "sidebar": el logo + nombre lleva acá (el inicio). Sin esto, no es link. */
  hrefInicio?: string;
  /** Estás en el inicio: el bloque se marca como activo. */
  inicioActivo?: boolean;
}

export function NegocioSwitcher({
  negocios,
  negocioActivoId,
  nombreActivo,
  logoActivo,
  inicial,
  isCollapsed,
  modo = "sidebar",
  hrefSinSwitcher,
  hrefInicio,
  inicioActivo = false,
}: Readonly<NegocioSwitcherProps>) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [cambiandoA, setCambiandoA] = useState<string | null>(null);

  const cambiar = (negocioId: string) => {
    if (negocioId === negocioActivoId) return;
    setCambiandoA(negocioId);
    startTransition(async () => {
      const res = await seleccionarNegocioAction(negocioId);
      setCambiandoA(null);
      if (!res.success) return;
      // Refresh completo: el negocio cambia TODOS los datos de la pantalla
      // actual, no solo el nombre del sidebar.
      router.refresh();
    });
  };

  const esIdentidad = modo === "identidad";
  const ladoAvatar = esIdentidad ? 36 : 28;

  const avatar = (
    <div
      className={`flex items-center justify-center shrink-0 overflow-hidden border ${
        esIdentidad
          ? "w-9 h-9 rounded-lg border-border bg-background"
          : "w-7 h-7 rounded bg-primary/10 border-border/50"
      }`}
    >
      {logoActivo ? (
        <Image
          src={logoActivo}
          alt={nombreActivo}
          width={ladoAvatar}
          height={ladoAvatar}
          className="object-cover w-full h-full"
        />
      ) : (
        <span
          className={
            esIdentidad
              ? "font-bold text-lg text-muted-foreground"
              : "font-bold text-xs text-primary"
          }
        >
          {inicial}
        </span>
      )}
    </div>
  );

  const claseNombre = esIdentidad
    ? "font-bold text-lg text-foreground tracking-tight truncate min-w-0"
    : "font-semibold text-sm truncate flex-1 text-left";

  const claseBoton = esIdentidad
    ? "flex items-center gap-2.5 min-w-0 max-w-full rounded-lg -ml-1 px-1 py-0.5 cursor-pointer active:bg-muted transition-colors"
    : `flex items-center gap-2.5 rounded-lg border border-border/50 bg-background/50 w-full ${
        isCollapsed ? "p-1.5 justify-center" : "p-2"
      }`;

  const menuNegocios = (
    <DropdownMenuContent align="start" className="w-60">
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        Tus negocios
      </DropdownMenuLabel>

      {negocios.map((negocio) => (
        <DropdownMenuItem
          key={negocio.negocio_id}
          disabled={pendiente}
          onSelect={() => cambiar(negocio.negocio_id)}
          className="gap-2"
        >
          {cambiandoA === negocio.negocio_id ? (
            <Loader2 className="size-4 animate-spin shrink-0" />
          ) : (
            <Check
              className={`size-4 shrink-0 ${
                negocio.negocio_id === negocioActivoId
                  ? "opacity-100"
                  : "opacity-0"
              }`}
            />
          )}
          <span className="flex flex-col">
            <span className="text-sm">{negocio.nombre}</span>
            <span className="text-xs text-muted-foreground">
              {negocio.es_owner ? "Dueño" : negocio.rol}
            </span>
          </span>
        </DropdownMenuItem>
      ))}

      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <a href="/onboarding" className="gap-2">
          <Plus className="size-4" />
          <span className="text-sm">Crear otro negocio</span>
        </a>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  // El nombre se oculta solo en modo sidebar colapsado; en identidad siempre
  // va (es la única marca del comercio en toda la pantalla).
  const mostrarNombre = esIdentidad || !isCollapsed;

  // ─── Sidebar con inicio: el negocio ES el link al panel ───────────────
  // (reemplaza al ítem "Panel"). Con varios negocios el clic se parte: el
  // logo + nombre van al inicio y la flecha abre el cambio de negocio. Un
  // solo blanco para las dos cosas obligaba a elegir cuál se perdía.
  if (!esIdentidad && hrefInicio) {
    const claseLink = `flex min-w-0 flex-1 items-center gap-2.5 rounded-md transition-colors active:scale-[0.98] ${
      isCollapsed ? "justify-center p-1.5" : "p-2"
    } ${inicioActivo ? "bg-primary/10 text-primary" : "hover:bg-muted"}`;
    const link = (
      <Link
        href={hrefInicio}
        prefetch={false}
        aria-current={inicioActivo ? "page" : undefined}
        title={isCollapsed ? `${nombreActivo} · Inicio` : undefined}
        className={claseLink}
      >
        {pendiente ? <Loader2 className="w-7 h-7 p-1.5 animate-spin shrink-0" /> : avatar}
        {mostrarNombre && <span className={claseNombre}>{nombreActivo}</span>}
      </Link>
    );
    if (negocios.length <= 1 || isCollapsed) {
      return <div className="flex w-full rounded-lg border border-border/50 bg-background/50">{link}</div>;
    }
    return (
      <div className="flex w-full items-center rounded-lg border border-border/50 bg-background/50">
        {link}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Cambiar de negocio"
              className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <ChevronsUpDown className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          {menuNegocios}
        </DropdownMenu>
      </div>
    );
  }

  // Con un solo negocio no hay nada que elegir: se muestra igual pero sin
  // menú, para no ofrecer una acción que no hace nada.
  if (negocios.length <= 1) {
    const contenido = (
      <>
        {avatar}
        {mostrarNombre && <span className={claseNombre}>{nombreActivo}</span>}
      </>
    );

    if (esIdentidad && hrefSinSwitcher) {
      return (
        <Link href={hrefSinSwitcher} className={claseBoton}>
          {contenido}
        </Link>
      );
    }
    return <div className={claseBoton}>{contenido}</div>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={claseBoton} aria-label="Cambiar de negocio">
          {pendiente ? (
            <Loader2
              className={`animate-spin shrink-0 ${esIdentidad ? "w-9 h-9 p-2" : "w-7 h-7 p-1.5"}`}
            />
          ) : (
            avatar
          )}
          {mostrarNombre && (
            <>
              <span className={claseNombre}>{nombreActivo}</span>
              <ChevronsUpDown
                className={`text-muted-foreground shrink-0 ${esIdentidad ? "w-3.5 h-3.5" : "w-4 h-4"}`}
              />
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      {menuNegocios}
    </DropdownMenu>
  );
}
