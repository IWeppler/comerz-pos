import { UpdatePasswordForm } from "@/features/auth/ui/update-password-form";
import { SesionDesdeHash } from "@/features/auth/ui/sesion-desde-hash";
import Image from "next/image";
import { Suspense } from "react";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nueva Contraseña | Comerz",
  description: "Crea una nueva contraseña para tu cuenta de Comer.",
};

export default function UpdatePasswordPage() {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-background">
      <div className="flex flex-col relative px-8 sm:px-16 py-12 lg:py-8 bg-card border-r border-border/50">
        <div className="flex-1 flex flex-col justify-center w-full max-w-sm mx-auto space-y-8 mt-4 lg:mt-0">
          <div className="flex items-center justify-center lg:justify-start gap-3 mb-2">
            <div className="w-10 h-10 bg-white shadow-sm border border-border rounded-lg flex items-center justify-center">
              <Image
                src="/logow.png"
                alt="Logo"
                width={28}
                height={28}
                className="object-contain rounded"
              />
            </div>
            <span className="font-bold text-2xl tracking-tight text-foreground">
              Comerz
            </span>
          </div>

          <div className="flex flex-col space-y-2 text-center lg:text-left">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
              Elegí una nueva contraseña
            </h1>
            <p className="text-sm text-muted-foreground">
              Asegurate de que sea segura y no la compartas con nadie.
            </p>
          </div>

          {/* El form lee ?invitacion= de la URL, así que necesita Suspense. */}
          {/* Links de mail viejos traen la sesión en el hash; ver
              sesion-desde-hash.tsx. Los nuevos llegan con cookies. */}
          <SesionDesdeHash>
            <Suspense fallback={null}>
              <UpdatePasswordForm />
            </Suspense>
          </SesionDesdeHash>
        </div>

        <p className="absolute bottom-8 left-0 right-0 text-xs font-medium text-muted-foreground text-center">
          © {new Date().getFullYear()} Comerz. Todos los derechos reservados.
        </p>
      </div>

      <div className="hidden lg:flex relative flex-col overflow-hidden">
        <Image
          src="/splash-backdrop.webp"
          alt="Background"
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
            Gestión comercial inteligente en tiempo real
          </h2>
          <div className="relative flex-1 mt-16 w-full">
            <div className="absolute left-0 top-8 w-[140%] rounded-xl shadow-2xl border border-white/10 overflow-hidden z-10">
              <Image
                src="/auth.png"
                alt="Dashboard"
                width={1600}
                height={1000}
                className="w-full h-auto object-cover"
              />
            </div>
            <div className="absolute left-[15%] top-[40%] w-[130%] rounded-xl shadow-[0_30px_60px_rgba(0,0,0,0.6)] border border-white/10 overflow-hidden z-20">
              <Image
                src="/auth1.png"
                alt="Detalle"
                width={1600}
                height={1000}
                className="w-full h-auto object-cover"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
