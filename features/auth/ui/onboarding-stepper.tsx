"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  registrarseAction,
  type RegistroState,
} from "@/features/auth/actions/registro";
import { crearNegocioAction } from "@/features/auth/actions/negocios";
import { ReenviarVerificacion } from "@/features/auth/ui/reenviar-verificacion";
import { registrarPasoOnboardingAction } from "@/features/auth/actions/paso-onboarding";
import { BotonGoogle, SeparadorAuth } from "@/features/auth/ui/boton-google";
import { RUBROS, TAMANOS_EQUIPO } from "@/shared/lib/rubros";
import { PASSWORD_MIN } from "@/shared/lib/password";

const estadoRegistro: RegistroState = { error: "" };
const estadoNegocio = { error: null as string | null, success: false };

/**
 * Alta completa en DOS pasos: cuenta → negocio.
 *
 * Por qué el paso 1 se manda SOLO y no todo junto al final: crear el negocio
 * necesita una sesión (la RPC corta sin `auth.uid()`), así que la cuenta tiene
 * que existir antes. Y tiene un efecto secundario bueno: si abandona en el
 * paso 2, la cuenta ya está y al volver retoma donde dejó en vez de empezar de
 * cero — por eso `yaAutenticado` arranca directo en el paso 2.
 *
 * Por qué NO hay paso de plan: el trial desbloquea todo igual, así que elegir
 * plan acá es una decisión sin consecuencia, tomada en el momento de menor
 * información. Los planes se muestran cuando la prueba está por vencer.
 *
 * Y por qué NO hay paso de facturación: pedir razón social, CUIT y condición
 * frente al IVA antes de que la persona haya visto el producto espanta al que
 * vende informal y aburre al que ya factura. Ninguno de los tres hace falta
 * para vender: se cargan en Configuración el día que quiera emitir una
 * factura, que es cuando la pregunta tiene sentido. La action los sigue
 * aceptando —el formulario de Configuración usa la misma— pero el alta no los
 * pide.
 *
 * De los datos del negocio, solo NOMBRE y RUBRO son obligatorios: con eso
 * alcanza para armar el catálogo y el POS. El tamaño del equipo y el WhatsApp
 * se completan después.
 */
export function OnboardingStepper({
  yaAutenticado,
}: Readonly<{ yaAutenticado: boolean }>) {
  const [paso, setPaso] = useState(yaAutenticado ? 2 : 1);
  const router = useRouter();

  const [registro, accionRegistro, registrando] = useActionState(
    registrarseAction,
    estadoRegistro,
  );
  const [negocio, accionNegocio, creando] = useActionState(
    crearNegocioAction,
    estadoNegocio,
  );

  // Datos del negocio. Viven en estado porque el Select y los botones de
  // tamaño no son controles nativos: al submit viajan por inputs ocultos.
  const [datosNegocio, setDatosNegocio] = useState({
    nombre: "",
    rubro: "",
    tamano_equipo: "",
    whatsapp: "",
  });

  // Avanzar de paso cuando el registro salió bien se hace DURANTE el render y
  // no en un efecto: un setState dentro de useEffect dispara un render en
  // cascada (React lo desaconseja explícitamente y el linter lo marca). Mismo
  // patrón que usa search-bar.tsx para resincronizar con la URL.
  // `registroConsumido` es lo que evita que se repita en cada render.
  const [registroConsumido, setRegistroConsumido] = useState(false);
  if (registro.success && registro.destino && !registroConsumido) {
    setRegistroConsumido(true);
    setPaso(2);
  }

  useEffect(() => {
    if (negocio.success) {
      router.push("/");
      router.refresh();
    }
  }, [negocio.success, router]);

  // El escalón del embudo que no se puede deducir de `auth.users`.
  //
  // "Se le emitió sesión" y "vio el formulario y lo abandonó" son cosas
  // distintas y hasta ahora se veían iguales: `last_sign_in_at` lo escribe
  // Supabase al emitir el token del link del mail, o sea que se marca aunque
  // la persona no haya visto nada. Sin este evento no hay forma de separarlas.
  //
  // Se dispara al MOSTRAR el paso 2, no al enviarlo: lo que interesa es que
  // llegó a verlo. La RPC es idempotente por (usuario, paso) y la action nunca
  // lanza, así que un fallo de telemetría no puede frenar un alta.
  useEffect(() => {
    if (paso !== 2) return;
    registrarPasoOnboardingAction("PASO_2_NEGOCIO");
  }, [paso]);

  // Confirmación por email prendida en el proyecto: no hay sesión, así que no
  // se puede seguir al paso 2. Es el camino que el alta directa viene a
  // evitar, pero mientras la opción siga prendida hay que dar una salida:
  // sin el botón de reenviar, un mail que no llega (spam, dirección mal
  // tipeada, SMTP demorado) deja a la persona sin nada que hacer más que
  // registrarse de nuevo con otro mail.
  if (registro.aviso) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <Check className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-lg font-semibold">Revisá tu correo</h2>
        <p className="mt-2 text-sm text-muted-foreground">{registro.aviso}</p>

        {registro.email && (
          <div className="mt-4 flex flex-col items-center gap-1">
            <p className="text-xs text-muted-foreground">
              ¿No te llegó? Fijate en spam, o pedilo de nuevo.
            </p>
            <ReenviarVerificacion email={registro.email} />
          </div>
        )}
      </div>
    );
  }

  const cargando = registrando || creando || negocio.success;

  return (
    <div className="space-y-6">
      <Progreso paso={paso} />

      {paso === 1 && (
        <div className="space-y-4">
          <Encabezado
            titulo="Creá tu cuenta"
            detalle="Con esto entrás vos. Después configuramos el comercio."
          />

          {/* Con Google el alta termina acá: no hay mail que abrir ni link
              que clickear, así que desaparece el salto de dispositivo donde
              se perdieron 6 de las 10 cuentas medidas el 9/9/2026. Va antes
              del formulario porque es el camino más corto. */}
          <BotonGoogle next="/onboarding" etiqueta="Registrarme con Google" />
          <SeparadorAuth />

          <form
            action={accionRegistro}
            className="space-y-4"
            aria-busy={registrando}
          >
            <Campo
              id="nombre"
              label="Tu nombre"
              autoComplete="name"
              required
              disabled={registrando}
            />
            <Campo
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              required
              disabled={registrando}
            />
            <Campo
              id="password"
              label="Contraseña"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN}
              disabled={registrando}
              ayuda={`Mínimo ${PASSWORD_MIN} caracteres.`}
            />
            <Error mensaje={registro.error} />
            <Button
              type="submit"
              disabled={registrando}
              className="h-11 w-full"
            >
              {registrando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Continuar"
              )}
            </Button>
          </form>
        </div>
      )}

      {paso === 2 && (
        <form action={accionNegocio} className="space-y-4" aria-busy={cargando}>
          <Encabezado
            titulo="Tu negocio"
            detalle="Con esto armamos tu catálogo y tu punto de venta."
          />

          <div className="space-y-2">
            <Label htmlFor="nombre-negocio">Nombre del negocio</Label>
            <Input
              id="nombre-negocio"
              required
              value={datosNegocio.nombre}
              onChange={(e) =>
                setDatosNegocio((d) => ({ ...d, nombre: e.target.value }))
              }
              placeholder="Nombre Comercio"
              className="h-11 bg-background shadow-none"
            />
            <p className="text-xs text-muted-foreground">
              Es el que ven tus clientes en la tienda online.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rubro">¿A qué se dedica?</Label>
            {/* Controlado y no con `name`: el Select de Radix no aporta al
                FormData, así que el valor viaja por un hidden más abajo. */}
            <Select
              value={datosNegocio.rubro}
              onValueChange={(v) =>
                setDatosNegocio((d) => ({ ...d, rubro: v }))
              }
            >
              <SelectTrigger
                id="rubro"
                className="h-11 w-full rounded-lg bg-background shadow-none"
              >
                <SelectValue placeholder="Elegí un rubro" />
              </SelectTrigger>
              <SelectContent>
                {RUBROS.map((r) => (
                  <SelectItem key={r.valor} value={r.valor}>
                    {r.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              ¿Cuánta gente trabaja ahí?{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {TAMANOS_EQUIPO.map((t) => {
                const elegido = datosNegocio.tamano_equipo === t.valor;
                return (
                  <button
                    type="button"
                    key={t.valor}
                    onClick={() =>
                      setDatosNegocio((d) => ({ ...d, tamano_equipo: t.valor }))
                    }
                    aria-pressed={elegido}
                    className={`rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      elegido
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    {t.etiqueta}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="whatsapp">
              WhatsApp de contacto{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Input
              id="whatsapp"
              value={datosNegocio.whatsapp}
              onChange={(e) =>
                setDatosNegocio((d) => ({ ...d, whatsapp: e.target.value }))
              }
              placeholder="+54 9 11 1234-5678"
              className="h-11 bg-background shadow-none"
            />
            <p className="text-xs text-muted-foreground">
              Por acá te escriben los pedidos desde el catálogo.
            </p>
          </div>

          {/* Los controlados (Select de Radix y los botones de tamaño) no
              aportan al FormData por sí solos: viajan por estos hidden. */}
          <input type="hidden" name="nombre" value={datosNegocio.nombre} />
          <input type="hidden" name="rubro" value={datosNegocio.rubro} />
          <input
            type="hidden"
            name="tamano_equipo"
            value={datosNegocio.tamano_equipo}
          />
          <input type="hidden" name="whatsapp" value={datosNegocio.whatsapp} />

          <Error mensaje={negocio.error} />

          {/* Solo nombre y rubro frenan el botón: lo demás es opcional y
              pedirlo para entrar era cobrar peaje por datos que no hacen
              falta para vender. */}
          <Button
            type="submit"
            className="h-11 w-full"
            disabled={cargando || !datosNegocio.nombre || !datosNegocio.rubro}
          >
            {cargando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Crear mi comercio"
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Empezás con 14 días de prueba, con todo desbloqueado y sin tarjeta.
          </p>
        </form>
      )}

      {paso > (yaAutenticado ? 2 : 1) && !cargando && (
        <button
          type="button"
          onClick={() => setPaso((p) => p - 1)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Volver
        </button>
      )}
    </div>
  );
}

function Progreso({ paso }: Readonly<{ paso: number }>) {
  const pasos = ["Cuenta", "Negocio"];
  return (
    <ol className="flex items-center gap-2">
      {pasos.map((nombre, i) => {
        const numero = i + 1;
        const hecho = numero < paso;
        const actual = numero === paso;
        return (
          <li key={nombre} className="flex flex-1 flex-col gap-1.5">
            <div
              className={`h-1 rounded-full ${
                hecho || actual ? "bg-primary" : "bg-border"
              }`}
            />
            <span
              className={`text-xs ${
                actual ? "font-medium text-foreground" : "text-muted-foreground"
              }`}
            >
              {nombre}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Encabezado({
  titulo,
  detalle,
}: Readonly<{ titulo: string; detalle: string }>) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">{titulo}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{detalle}</p>
    </div>
  );
}

function Campo({
  id,
  label,
  ayuda,
  ...props
}: Readonly<
  { id: string; label: string; ayuda?: string } & React.ComponentProps<
    typeof Input
  >
>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        className="h-11 bg-background shadow-none"
        {...props}
      />
      {ayuda ? <p className="text-xs text-muted-foreground">{ayuda}</p> : null}
    </div>
  );
}

function Error({ mensaje }: Readonly<{ mensaje: string | null | undefined }>) {
  if (!mensaje) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {mensaje}
    </p>
  );
}
