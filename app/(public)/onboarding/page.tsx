import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/config/supabase/server";
import { OnboardingStepper } from "@/features/auth/ui/onboarding-stepper";
import { PanelVisualAuth } from "@/features/auth/ui/panel-visual";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Empezá con Comerz",
  description: "Creá tu comercio y empezá a vender en minutos.",
};

/**
 * Alta de comercio, de punta a punta. Reemplaza a /crear-negocio y al
 * formulario de "dejanos tus datos" del login, que eran dos mitades del mismo
 * camino: uno pedía contacto y esperaba un WhatsApp, el otro exigía una cuenta
 * que no había forma de crear.
 *
 * Es ruta propia y no un modo de /auth a propósito: /auth es para el que YA
 * tiene cuenta. Meter el alta ahí obligaba a decidir "¿entro o me registro?"
 * antes de saber de qué se trata, y dejaba el paso más largo del producto
 * escondido detrás de un link chico.
 *
 * El layout es el MISMO que /auth (formulario a la izquierda, panel visual a la
 * derecha) y comparten el componente: entrar y registrarse son dos puertas de
 * la misma casa, y si se ven distinto parece que una de las dos no es del mismo
 * producto.
 */
export default async function OnboardingPage() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Con sesión Y negocio esto no tiene nada que ofrecer: adentro. Es el caso
  // de quien vuelve al link por costumbre o desde un mail viejo.
  if (user) {
    const { count } = await supabase
      .from("usuarios_negocios")
      .select("negocio_id", { count: "exact", head: true })
      .eq("usuario_id", user.id);

    if ((count ?? 0) > 0) redirect("/");

    // Sin negocio pero con una invitación PENDIENTE a su mail: no es alguien
    // que viene a crear un comercio, es un empleado al que el link del mail
    // dejó acá (hasta el 14/9/2026 la sesión llegaba en el hash y nadie la
    // leía). Se acepta por email y adentro. La cookie del negocio activo y el
    // claim no se pueden escribir desde un Server Component; con una sola
    // membresía el middleware la elige solo al pasar por `/`.
    const { data: negocioInvitado, error: errorInvitacion } = await supabase.rpc(
      "aceptar_invitaciones_pendientes",
    );
    if (errorInvitacion) {
      console.error("[ONBOARDING] aceptar invitaciones pendientes:", errorInvitacion);
    } else if (negocioInvitado) {
      redirect("/");
    }
  }

  return (
    <div className="min-h-svh grid grid-cols-1 lg:grid-cols-2 bg-background">
      {/* PANEL IZQUIERDO — FORMULARIO. `group` habilita el modo teclado igual
          que en /auth: cuando algo toma foco en mobile, la marca se achica en
          vez de empujar el formulario abajo de la pantalla. */}
      <div className="group flex flex-col relative px-6 sm:px-16 py-10 lg:py-8 bg-card lg:border-r border-border/50">
        {/* Logo — desktop: arriba a la izquierda */}
        <div className="hidden lg:flex absolute top-8 left-8 sm:top-12 sm:left-12 items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
            <Image
              src="/logow.png"
              alt=""
              width={36}
              height={36}
              className="object-contain rounded"
            />
          </div>
          <span className="font-bold text-lg tracking-tight text-foreground">
            Comerz
          </span>
        </div>

        <div className="flex-1 flex flex-col justify-center w-full max-w-sm mx-auto lg:mt-0">
          {/* MARCA — solo mobile, mismo bloque que /auth. */}
          <div className="lg:hidden flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center transition-all duration-300 ease-out group-focus-within:w-11 group-focus-within:h-11">
              <Image
                src="/logow.png"
                alt="Comerz"
                width={56}
                height={56}
                className="w-full h-full object-contain rounded-2xl p-2"
              />
            </div>
            <span className="mt-3 text-xl font-bold tracking-tight text-foreground transition-all duration-300 ease-out group-focus-within:mt-2 group-focus-within:text-lg">
              Comerz
            </span>
            <p className="mt-1.5 max-h-16 overflow-hidden text-sm leading-snug text-muted-foreground transition-all duration-300 ease-out group-focus-within:mt-0 group-focus-within:max-h-0 group-focus-within:opacity-0">
              <span className="block">Empezá con Comerz.</span>
              <span className="block">Tu comercio, más simple.</span>
            </p>
          </div>

          <div className="lg:hidden h-px w-full bg-border/60 my-7 transition-all duration-300 ease-out group-focus-within:my-5" />

          {/* `yaAutenticado` es lo que permite retomar: si se registró y
              abandonó antes de crear el negocio, vuelve directo al paso 2 en
              vez de chocarse con un formulario de cuenta que ya completó. */}
          <OnboardingStepper yaAutenticado={Boolean(user)} />

          <p className="mt-8 text-center text-sm text-muted-foreground lg:text-left">
            ¿Ya tenés cuenta?{" "}
            <Link
              href="/auth"
              className="font-semibold text-primary underline-offset-4 hover:underline transition-colors"
            >
              Iniciar sesión
            </Link>
          </p>
        </div>

        <div className="mt-8 text-center space-y-3">
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-muted-foreground/80">
            Al continuar, aceptás nuestros{" "}
            <Link
              href="/terminos"
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Términos y Condiciones
            </Link>{" "}
            y reconocés haber leído nuestra{" "}
            <Link
              href="/privacidad"
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Política de Privacidad
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Titular propio: en /auth le habla al que vuelve, acá al que todavía no
          decidió. El resto del panel es idéntico. */}
      <PanelVisualAuth titulo="Tu comercio ordenado, desde el primer día" />
    </div>
  );
}
