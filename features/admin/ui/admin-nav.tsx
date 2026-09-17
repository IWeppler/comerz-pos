"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CreditCard,
  LayoutDashboard,
  Menu,
  X,
} from "lucide-react";

const SECCIONES = [
  { href: "/admincomerz", nombre: "Dashboard", icono: LayoutDashboard },
  { href: "/admincomerz/metricas", nombre: "Métricas", icono: BarChart3 },
  { href: "/admincomerz/planes", nombre: "Planes", icono: CreditCard },
] as const;

/**
 * La navegación del panel: hamburguesa en mobile, columna en desktop.
 *
 * Antes en mobile los links iban en una fila con scroll horizontal. El
 * problema no era el espacio sino que no se ve qué hay: un link que queda
 * fuera del borde no existe para quien no piensa en arrastrar, y cada sección
 * nueva empeoraba.
 *
 * En desktop no cambia nada: la misma columna de siempre, sin botón.
 */
export function AdminNav() {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);

  // Al navegar se cierra solo, sin esto el panel queda tapando la pantalla a
  // la que se acaba de entrar. Se ajusta DURANTE el render y no en un efecto
  // —mismo patrón que `search-bar.tsx`— porque un `setState` dentro de un
  // efecto provoca un segundo render en cascada, y acá el valor se puede
  // derivar de la ruta directamente.
  const [ultimaRuta, setUltimaRuta] = useState(pathname);
  if (pathname !== ultimaRuta) {
    setUltimaRuta(pathname);
    setAbierto(false);
  }

  // Con el menú abierto no se scrollea lo de atrás: es una capa que ocupa la
  // pantalla, y dejar el fondo moviéndose se siente como que la app se rompió.
  useEffect(() => {
    if (!abierto) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, [abierto]);

  const esActiva = (href: string) =>
    href === "/admincomerz" ? pathname === href : pathname.startsWith(href);

  const links = (
    <>
      {SECCIONES.map(({ href, nombre, icono: Icono }) => {
        const activa = esActiva(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={activa ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors md:py-2 ${
              activa
                ? "bg-white/10 text-white"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icono className="h-4 w-4 shrink-0" />
            {nombre}
          </Link>
        );
      })}
    </>
  );

  return (
    <>
      {/* MOBILE: botón + capa desplegable */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls="admin-nav-mobile"
        aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
        // 44px de blanco táctil: es el mínimo con el que un pulgar no falla.
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/5 hover:text-white md:hidden"
      >
        {abierto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {abierto && (
        <>
          {/* Tocar fuera cierra. Va debajo del panel y de la barra en el orden
              de apilado, así el botón de cerrar sigue siendo clickeable. */}
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setAbierto(false)}
            className="fixed inset-0 z-30 cursor-default bg-black/60 md:hidden"
          />
          {/* `top-full` y no una altura fija en píxeles: el panel se cuelga del
              borde de abajo de la barra, así que si la barra cambia de alto
              esto la sigue sin que haya que acordarse de actualizar un número.
              La barra es `relative` en el layout para que esto ancle ahí. */}
          <nav
            id="admin-nav-mobile"
            className="absolute inset-x-0 top-full z-40 flex flex-col gap-1 border-b border-white/10 bg-zinc-900 p-3 shadow-xl md:hidden"
          >
            {links}
          </nav>
        </>
      )}

      {/* DESKTOP: la columna de siempre */}
      <nav className="hidden md:flex md:flex-col md:gap-1">{links}</nav>
    </>
  );
}
