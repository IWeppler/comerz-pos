"use client";

import Link from "next/link";
import Image from "next/image";
import { CartButton } from "@/shared/ui/cart-button";
import { X, Menu, MapPin, Clock } from "lucide-react";
import { useState, Suspense } from "react";
import { ConfiguracionPOS } from "@/entities/config/types";
import { FaFacebook, FaInstagram, FaWhatsapp } from "react-icons/fa";
import { AnnouncementBar } from "../ui/announcement-bar";
import { SearchBar } from "./search-bar";
import { useRutaCatalogo } from "@/shared/lib/use-negocio";

export interface CategoriaNavbar {
  id: string;
  nombre: string;
  slug: string | null;
}

interface NavbarProps {
  // Puede venir null: si la config no resuelve, el navbar tiene que renderizar
  // igual. Antes `branding.marquee_activo` sobre null tumbaba toda la tienda.
  branding: ConfiguracionPOS | null;
  /**
   * Categorías principales, para el menú hamburguesa de mobile. Son las mismas
   * que se ven en la portada del catálogo: sin esto, entrando desde un link a
   * un producto no había forma de llegar al resto del catálogo sin volver a la
   * home.
   */
  categorias?: CategoriaNavbar[];
}

export function Navbar({ branding, categorias = [] }: Readonly<NavbarProps>) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const rutaDelCatalogo = useRutaCatalogo();

  return (
    <>
      {/* MARQUEE (ANNOUNCEMENT BAR) */}
      {branding?.marquee_activo && branding?.marquee_texto && (
        <AnnouncementBar isActive={true} text={branding?.marquee_texto} />
      )}

      {/* HEADER INTELIGENTE */}
      <header className="bg-card border-b border-border sticky top-0 z-40 flex flex-col">
        {/* LÍNEA PRINCIPAL (Logo, Buscador, Carrito) */}
        <div className="w-full mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between z-20">
          {/* LADO IZQUIERDO: Menú Hamburguesa (Mobile) */}
          <div className="flex items-center md:hidden w-1/3">
            <button
              className="p-2 -ml-2 text-foreground hover:bg-muted rounded-md cursor-pointer"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? (
                <X className="w-6 h-6" />
              ) : (
                <Menu className="w-6 h-6" />
              )}
            </button>
          </div>

          {/* CENTRO: Logo y Nombre (Centrado en Mobile, Izquierda en Desktop) */}
          <div className="flex items-center justify-center md:justify-start w-1/3 md:w-auto">
            <Link
              href={rutaDelCatalogo}
              // Sin prefetch en toda la barra: el catálogo es force-dynamic y
              // sin loading boundary, así que el prefetch no precarga nada y
              // cuesta una invocación por link visible. Mismo criterio que el
              // sidebar del panel.
              prefetch={false}
              className="flex items-center gap-2 shrink-0"
            >
              {branding?.posLogo && (
                <div className="w-10 h-10 flex items-center justify-center rounded-lg overflow-hidden text-white shrink-0">
                  <Image
                    src={branding?.posLogo}
                    alt={`Logo ${branding?.posName}`}
                    width={52}
                    height={52}
                    className="object-cover"
                  />
                </div>
              )}
              <span className="hidden md:flex font-bold text-lg md:text-xl tracking-tight">
                {branding?.posName}
              </span>
            </Link>
          </div>

          {/* LADO DERECHO: Buscador y Carrito */}
          <div className="flex items-center justify-end gap-1 sm:gap-4 w-1/3 md:w-auto md:ml-auto">
            <Suspense
              fallback={<div className="w-10 h-10 md:w-65 bg-transparent" />}
            >
              <SearchBar />
            </Suspense>
            {/* Ocultar carrito si pedidos_whatsapp es falso */}
            {branding?.pedidos_whatsapp !== false && <CartButton />}
          </div>
        </div>

        {/*  SUB-BARRA DE INFORMACIÓN (Solo Desktop) */}
        <div className="hidden md:flex w-full bg-sidebar text-[10px] font-semibold tracking-wider py-1.5 px-4 sm:px-6 lg:px-8 justify-between items-center text-muted-foreground">
          <div className="flex items-center gap-6">
            {branding?.direccion_visible && branding?.direccion && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                <span className="uppercase">{branding?.direccion}</span>
              </div>
            )}
            <div className="h-4 border border-border"></div>
            {branding?.horario_visible && branding?.horario_texto && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span className="uppercase">{branding?.horario_texto}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-5">
            {branding?.whatsapp && (
              <a
                href={`https://wa.me/${branding?.whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 hover:text-[#25D366] transition-colors uppercase"
              >
                <FaWhatsapp className="w-3.5 h-3.5" /> WhatsApp
              </a>
            )}
            {branding?.instagram && (
              <a
                href={branding?.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 hover:text-pink-600 transition-colors uppercase"
              >
                <FaInstagram className="w-3.5 h-3.5" /> Instagram
              </a>
            )}
            {branding?.facebook && (
              <a
                href={branding?.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 hover:text-info transition-colors uppercase"
              >
                <FaFacebook className="w-3.5 h-3.5" /> Facebook
              </a>
            )}
          </div>
        </div>

        {/* MENÚ HAMBURGUESA DESPLEGABLE (Mobile) */}
        {isMenuOpen && (
          <div className="md:hidden absolute top-16 left-0 w-full bg-card border-b border-border animate-in slide-in-from-top-2 z-40">
            <div className="p-5 flex flex-col gap-4">
              {categorias.length > 0 && (
                <>
                  <nav aria-label="Categorías">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                      Categorías
                    </p>
                    <ul className="flex flex-col">
                      {categorias.map((categoria) => (
                        <li key={categoria.id}>
                          <Link
                            href={`${rutaDelCatalogo}?categoria=${encodeURIComponent(categoria.slug || categoria.id)}`}
                            prefetch={false}
                            onClick={() => setIsMenuOpen(false)}
                            className="block py-2.5 text-sm font-medium text-foreground hover:text-primary transition-colors"
                          >
                            {categoria.nombre}
                          </Link>
                        </li>
                      ))}
                      <li>
                        <Link
                          href={`${rutaDelCatalogo}?ver=todo`}
                          prefetch={false}
                          onClick={() => setIsMenuOpen(false)}
                          className="block py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Ver todo el catálogo
                        </Link>
                      </li>
                    </ul>
                  </nav>

                  <div className="border-t border-border my-1" />
                </>
              )}

              {branding?.direccion_visible && branding?.direccion && (
                <div className="flex items-start gap-3 text-sm text-muted-foreground font-medium">
                  <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                  <p>{branding?.direccion}</p>
                </div>
              )}

              {branding?.horario_visible && branding?.horario_texto && (
                <div className="flex items-start gap-3 text-sm text-muted-foreground font-medium">
                  <Clock className="w-4 h-4 mt-0.5 shrink-0" />
                  <p>{branding?.horario_texto}</p>
                </div>
              )}

              <div className="border-t border-border my-2" />

              <div className="flex items-center justify-center gap-6">
                {branding?.whatsapp && (
                  <a
                    href={`https://wa.me/${branding?.whatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 bg-[#25D366]/10 text-[#25D366] rounded-full"
                  >
                    <FaWhatsapp className="w-5 h-5" />
                  </a>
                )}
                {branding?.instagram && (
                  <a
                    href={branding?.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 bg-pink-500/10 text-pink-600 rounded-full"
                  >
                    <FaInstagram className="w-5 h-5" />
                  </a>
                )}
                {branding?.facebook && (
                  <a
                    href={branding?.facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 bg-info/10 text-info rounded-full"
                  >
                    <FaFacebook className="w-5 h-5" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
