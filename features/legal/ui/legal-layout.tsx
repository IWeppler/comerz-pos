import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Marco compartido de las páginas legales (términos y privacidad).
 *
 * Son documentos largos que se leen casi siempre desde el mail o desde el
 * login en el celular, así que la página es una sola columna angosta, sin el
 * panel de branding: acá lo único que importa es que el texto se lea.
 */
export function LegalLayout({
  titulo,
  descripcion,
  actualizado,
  children,
}: Readonly<{
  titulo: string;
  descripcion: string;
  actualizado: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/ingresar" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm">
              <Image
                src="/logow.png"
                alt="Comerz"
                width={32}
                height={32}
                className="h-full w-full rounded-lg object-contain p-1"
              />
            </div>
            <span className="text-base font-bold tracking-tight text-foreground">
              Comerz
            </span>
          </Link>

          <Link
            href="/ingresar"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
        <div className="space-y-3 border-b border-border/50 pb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {titulo}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {descripcion}
          </p>
          <p className="text-xs font-medium text-muted-foreground/70">
            Última actualización: {actualizado}
          </p>
        </div>

        {/* El estilo se aplica por descendencia para que el documento en sí
            quede como texto plano y sea fácil de editar sin tocar clases. */}
        <div className="mt-10 space-y-10 text-sm leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:pl-1 [&_p]:mt-3 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
          {children}
        </div>

        <footer className="mt-14 space-y-3 border-t border-border/50 pt-8">
          <p className="text-sm text-muted-foreground">
            ¿Dudas sobre este documento? Escribinos a{" "}
            <a
              href="mailto:ignacionweppler@gmail.com"
              className="font-medium text-primary underline underline-offset-2"
            >
              ignacionweppler@gmail.com
            </a>
            .
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground/70">
            <Link href="/terminos" className="hover:text-foreground">
              Términos y Condiciones
            </Link>
            <Link href="/privacidad" className="hover:text-foreground">
              Política de Privacidad
            </Link>
            <span className="ml-auto">
              © {new Date().getFullYear()} Comerz
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
