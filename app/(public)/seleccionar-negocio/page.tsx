import { redirect } from "next/navigation";
import { listarMisNegociosAction } from "@/features/auth/actions/negocios";
import { SelectorNegocio } from "@/features/auth/ui/selector-negocio";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Elegí el negocio | Comerz",
};

export default async function SeleccionarNegocioPage() {
  const negocios = await listarMisNegociosAction();

  // Con un solo negocio no hay nada que elegir: la base lo resuelve sola.
  if (negocios.length === 1) redirect("/");
  // Sin ninguno no se ofrece crear uno acá: es un flujo aparte, y esta
  // pantalla es para elegir entre los que ya tenés.
  if (negocios.length === 0) redirect("/ingresar?error=sin-negocio");

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">¿En qué negocio trabajás hoy?</h1>
          <p className="text-sm text-muted-foreground">
            Todo lo que hagas —ventas, caja, stock— queda en el negocio que
            elijas.
          </p>
        </div>

        <SelectorNegocio negocios={negocios} />
      </div>
    </main>
  );
}
