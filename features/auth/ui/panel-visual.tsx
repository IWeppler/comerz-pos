import Image from "next/image";

/**
 * Mitad derecha de las pantallas de entrada (/ingresar y /empezar).
 *
 * Vive en un componente y no copiada en cada página a propósito: son dos
 * pantallas que tienen que verse como la misma cosa, y este repo ya pagó el
 * precio de tener la misma regla escrita dos veces (el grid del backfill a
 * 320px mientras la app generaba a 480, con un comentario jurando que eran
 * iguales). Si mañana cambia el mockup, cambia en un solo lado.
 *
 * Solo desktop: en mobile el formulario ocupa la pantalla entera y esto no se
 * monta — no es que se esconda, `hidden lg:flex` evita bajar dos imágenes de
 * 1600px a un celular que nunca las va a mostrar.
 */
export function PanelVisualAuth({
  titulo = "Gestión comercial inteligente en tiempo real",
}: Readonly<{ titulo?: string }>) {
  return (
    <div className="hidden lg:flex relative flex-col overflow-hidden">
      <Image
        src="/splash-backdrop.webp"
        alt=""
        fill
        className="object-cover z-0 opacity-90"
        priority
      />

      <div className="absolute inset-0 bg-[#0a2342]/40 z-0" />

      <div
        className="absolute inset-0 z-0 opacity-30 mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage: 'url("/noise.svg")',
          backgroundRepeat: "repeat",
        }}
      />

      <div className="relative z-10 w-full h-full flex flex-col pt-24 pl-16">
        <h2 className="text-5xl font-medium text-white tracking-tight leading-[1.1] max-w-xl">
          {titulo}
        </h2>

        {/* Los mockups desbordan a propósito (140% y 130%): tapan el fondo y
            dan la sensación de que la app sigue más allá del borde. */}
        <div className="relative flex-1 mt-16 w-full">
          <div className="absolute left-0 top-8 w-[140%] rounded-xl shadow-2xl border border-white/10 overflow-hidden transform transition-transform duration-700 hover:-translate-y-2 z-10">
            <Image
              src="/auth2.webp"
              alt=""
              width={1600}
              height={1000}
              className="w-full h-auto object-cover"
            />
          </div>

          <div className="absolute left-[15%] top-[40%] w-[130%] rounded-xl shadow-[0_30px_60px_rgba(0,0,0,0.6)] border border-white/10 overflow-hidden transform transition-transform duration-700 hover:-translate-y-2 z-20">
            <Image
              src="/auth1.webp"
              alt=""
              width={1600}
              height={1000}
              className="w-full h-auto object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
