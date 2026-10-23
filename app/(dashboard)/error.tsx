"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, WifiOff, TriangleAlert, LogIn } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { esErrorDeRed } from "@/shared/lib/error-de-red";
import { esRespuestaNoRsc, esSesionVencida } from "@/shared/lib/sesion-vencida";
import { reportarErrorCliente } from "@/shared/lib/reportar-error-cliente";

/**
 * Error boundary del panel.
 *
 * POR QUÉ EXISTE: hasta acá el ÚNICO boundary de la app era
 * `app/global-error.tsx`, que por definición de Next reemplaza el `<html>`
 * entero. O sea que cualquier error —incluido un parpadeo de señal— dejaba la
 * pantalla negra con "la aplicación se cortó inesperadamente", perdiendo el
 * sidebar, el negocio activo y el formulario que se estaba llenando.
 *
 * Caso real (Evens, 20/8): la dueña subía una foto desde el celular, el POST
 * de la Server Action se moría en la red y la app entera se ponía en negro. No
 * se había roto nada.
 *
 * Este boundary corre DENTRO del layout del panel: el sidebar y la sesión
 * siguen ahí y `reset()` vuelve a montar solo la pantalla que falló.
 *
 * TRES CASOS, TRES SALIDAS. La versión anterior tenía dos problemas juntos:
 * mostraba "esta pantalla falló, quedó registrado" para TODO —incluida la
 * sesión vencida, que no es una falla y se arregla en un toque— y su único
 * botón era `reset()`, que vuelve a montar el árbol con el MISMO estado que ya
 * falló. Cuando la causa sigue viva (sesión vencida, RSC que no llega),
 * reintentar no puede hacer nada, y eso es exactamente lo que se reportó desde
 * el mostrador: "el botón reintentar no sirve para nada".
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const sesionVencida = esSesionVencida(error);
  const esDeRed = !sesionVencida && esErrorDeRed(error);
  // El error genérico de Next cuando la respuesta a un Server Action no es
  // RSC. Con la sesión ya descartada arriba, lo que queda es un servidor que
  // contestó otra cosa: una función caída, un timeout, una página de error.
  const respuestaRota = !sesionVencida && !esDeRed && esRespuestaNoRsc(error);

  useEffect(() => {
    reportarErrorCliente({
      tipo: "react-error-boundary",
      mensaje: error.message,
      stack: error.stack,
      // La clasificación va al log: sin ella, una sesión vencida y un crash de
      // verdad se leen igual en Vercel, y un día de mala señal parece una app
      // inestable. `sesionVencida` además marca los que NO hay que investigar.
      detalle: {
        digest: error.digest,
        esDeRed,
        sesionVencida,
        respuestaRota,
        alcance: "dashboard",
      },
    });
  }, [error, esDeRed, sesionVencida, respuestaRota]);

  // `router.refresh()` antes de `reset()`: pide el árbol de servidor de nuevo
  // en vez de volver a montar el que ya venía roto. Es la diferencia entre un
  // botón que reintenta de verdad y uno que repite el mismo error.
  const reintentar = () => {
    router.refresh();
    reset();
  };

  if (sesionVencida) {
    return (
      <Marco icono={<LogIn className="h-6 w-6 text-muted-foreground" />}>
        <h2 className="text-lg font-semibold text-foreground">
          Se cerró la sesión
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Por seguridad la sesión venció. No perdiste nada de lo que ya estaba
          guardado: volvé a entrar y seguí desde donde estabas.
        </p>
        {/* Enlace duro y no `router.push`: la sesión vencida deja al cliente
            con estado que ya no vale, y lo único que lo limpia entero es
            cargar la app de nuevo. */}
        <Button asChild className="mt-6" size="sm">
          <a href="/ingresar">
            <LogIn className="h-4 w-4" />
            Volver a entrar
          </a>
        </Button>
      </Marco>
    );
  }

  if (esDeRed) {
    return (
      <Marco icono={<WifiOff className="h-6 w-6 text-muted-foreground" />}>
        <h2 className="text-lg font-semibold text-foreground">
          Se cortó la conexión
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          No se pudo hablar con el servidor. No cerraste sesión y no perdiste
          nada: revisá la señal y tocá Reintentar.
        </p>
        <Acciones onReintentar={reintentar} />
      </Marco>
    );
  }

  return (
    <Marco icono={<TriangleAlert className="h-6 w-6 text-muted-foreground" />}>
      <h2 className="text-lg font-semibold text-foreground">
        Esta pantalla falló
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {respuestaRota ? (
          <>
            El servidor devolvió una respuesta incompleta. Quedó registrado.
            Probá de nuevo; si sigue igual, recargá la app.
          </>
        ) : (
          <>
            Quedó registrado para revisarlo. Podés reintentar sin cerrar
            sesión; si sigue fallando, probá desde otra pantalla.
          </>
        )}
      </p>
      <Acciones onReintentar={reintentar} />

      {/* Solo en errores reales: en un corte de red el digest no identifica
          nada del lado del servidor, porque el request nunca llegó. */}
      {error.digest && (
        <p className="mt-4 font-mono text-xs text-muted-foreground/70">
          Código: {error.digest}
        </p>
      )}
    </Marco>
  );
}

/** Reintentar y, al lado, la salida que siempre funciona. Recargar existe
 * porque hay estados que ningún re-render arregla —un chunk que no bajó, un
 * cliente que quedó viejo después de un deploy— y sin este botón la única
 * salida es cerrar la PWA, que en el mostrador nadie hace. */
function Acciones({ onReintentar }: Readonly<{ onReintentar: () => void }>) {
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      <Button onClick={onReintentar} size="sm">
        <RefreshCw className="h-4 w-4" />
        Reintentar
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => window.location.reload()}
      >
        Recargar la app
      </Button>
    </div>
  );
}

function Marco({
  icono,
  children,
}: Readonly<{ icono: React.ReactNode; children: React.ReactNode }>) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          {icono}
        </div>
        {children}
      </div>
    </div>
  );
}
