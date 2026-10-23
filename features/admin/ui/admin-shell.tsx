"use client";

import { useState } from "react";
import Image from "next/image";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AdminNav } from "./admin-nav";

/** La cookie que recuerda si el menú quedó colapsado. Dura un año. */
export const COOKIE_NAV_COLAPSADO = "admin_nav_colapsado";

/**
 * El marco de /admincomerz: menú lateral (colapsable en desktop), encabezado
 * con la campana, y el contenido.
 *
 * El estado del menú viaja en una cookie y no en localStorage: el layout la
 * lee en el servidor y el primer render ya sale colapsado o abierto. Con
 * localStorage el menú arrancaba abierto y saltaba a colapsado cuando
 * hidrataba.
 *
 * En celular el menú es la barra de siempre con la hamburguesa; colapsar solo
 * existe desde el ancho de escritorio.
 *
 * La campana y el cierre de sesión llegan ya armados (son componentes del
 * servidor: uno trae datos, el otro es una acción del servidor).
 */
export function AdminShell({
  colapsadoInicial,
  email,
  campana,
  cerrarSesion,
  children,
}: Readonly<{
  colapsadoInicial: boolean;
  email: string | undefined;
  campana: React.ReactNode;
  /** El botón de cerrar sesión, con su propio form. Con el menú colapsado se
   * le esconde el texto y queda solo el ícono. */
  cerrarSesion: React.ReactNode;
  children: React.ReactNode;
}>) {
  const [colapsado, setColapsado] = useState(colapsadoInicial);

  const alternar = () => {
    const nuevo = !colapsado;
    setColapsado(nuevo);
    try {
      document.cookie = `${COOKIE_NAV_COLAPSADO}=${nuevo ? "1" : "0"}; path=/admincomerz; max-age=31536000; SameSite=Lax`;
    } catch {
      // Sin cookies el menú funciona igual, solo que no recuerda la elección.
    }
  };

  return (
    // Dark fijo, sin seguir el tema del sistema: este panel es una herramienta
    // interna de una sola persona. El dark en el contenedor hace que los
    // tokens de shadcn (dropdowns, dialogs de acá adentro) tomen su versión
    // oscura; el resto de la UI usa colores explícitos sobre negro.
    <div className="dark flex min-h-screen flex-col bg-zinc-950 text-white md:flex-row">
      {/* En celular es una barra de una línea con el menú detrás de la
          hamburguesa; en desktop, la columna. Es relative porque el panel
          desplegable del celular se ancla a su borde inferior. */}
      <aside
        className={`relative z-40 flex shrink-0 flex-row items-center justify-between gap-3 border-b border-white/10 bg-zinc-900 px-4 py-2 transition-[width] duration-200 md:static md:flex-col md:items-stretch md:border-b-0 md:border-r md:bg-zinc-900/50 md:p-6 ${
          colapsado ? "md:w-[4.5rem] md:px-3" : "md:w-64"
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 md:block md:space-y-6">
          <div
            className={`flex shrink-0 items-center gap-2 md:gap-3 ${
              colapsado ? "md:justify-center" : ""
            }`}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white">
              <Image
                src="/logow.png"
                alt="Logo"
                width={36}
                height={36}
                className="rounded object-contain"
              />
            </div>
            {/* El nombre se esconde en celular (el logo ya identifica) y con
                el menú colapsado. */}
            {!colapsado && (
              <span className="hidden text-lg font-bold tracking-tight text-white md:inline">
                Comerz
              </span>
            )}
          </div>

          <AdminNav colapsado={colapsado} />
        </div>

        <div className="shrink-0 md:border-t md:border-white/10 md:pt-6">
          {!colapsado && (
            <div className="mb-2 hidden truncate px-2 text-xs text-white/40 md:block">
              {email}
            </div>
          )}
          <div
            className={
              colapsado
                ? "md:[&_span]:hidden md:[&_button]:justify-center"
                : undefined
            }
          >
            {cerrarSesion}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-2 md:h-14 md:px-6">
          <button
            type="button"
            onClick={alternar}
            aria-label={colapsado ? "Expandir el menú" : "Colapsar el menú"}
            aria-pressed={colapsado}
            className="hidden size-10 cursor-pointer items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/5 hover:text-white md:flex"
          >
            {colapsado ? (
              <PanelLeftOpen className="size-[18px]" />
            ) : (
              <PanelLeftClose className="size-[18px]" />
            )}
          </button>
          <div className="ml-auto flex items-center gap-1">{campana}</div>
        </header>

        <main className="max-h-screen flex-1 overflow-y-auto p-2 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
