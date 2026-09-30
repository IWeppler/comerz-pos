"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/shared/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { AvatarUsuario } from "@/shared/components/avatar-usuario";
import { Save, Loader2, User, Mail, Lock, ShieldCheck } from "lucide-react";
import {
  updateProfileAction,
  updatePasswordAction,
} from "../actions/profile-actions";
import type { PlanDelNegocio } from "@/features/admin/actions/planes-actions";

interface CuentaFormProps {
  usuario: {
    id: string;
    nombre: string;
    email: string;
  };
  /** Null si la sesión todavía no tiene un negocio resuelto. */
  plan: PlanDelNegocio | null;
  /** El centro de suscripción se arma en el server y entra ya renderizado. */
  suscripcion: React.ReactNode;
  /** Pestaña con la que abre (`/perfil?tab=plan`). */
  tabInicial?: "perfil" | "seguridad" | "plan";
}

export function ProfileDashboard({
  usuario,
  suscripcion,
  tabInicial = "perfil",
}: Readonly<CuentaFormProps>) {
  const [isPending, startTransition] = useTransition();
  const handleSaveProfile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await updateProfileAction(formData);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleChangePassword = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const result = await updatePasswordAction(formData);
      if (result.success) {
        toast.success(result.message);
        form.reset();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    // La página envuelve esto en un contenedor `h-screen overflow-hidden`, así
    // que el scroll tiene que vivir acá: sin `overflow-y-auto` todo lo que pase
    // del alto de la pantalla queda recortado y sin forma de llegar. Con la
    // pestaña de suscripción vieja (una card corta) no se notaba; con el centro
    // de suscripción sí. `min-h-0` es lo que permite que un hijo de flex column
    // se achique en vez de desbordar al padre.
    <div className="min-h-0 flex-1 overflow-y-auto max-w-7xl mx-auto px-4 w-full space-y-8 pb-12">
      <div className="flex items-center gap-4">
        {/* El mismo avatar del sidebar (semilla = id del usuario), más
            grande. Se mueve al pasar el mouse. */}
        <AvatarUsuario
          userId={usuario.id}
          nombre={usuario.nombre}
          size={64}
          animado
        />
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Mi Cuenta
          </h1>
          <p className="text-muted-foreground mt-1 truncate">
            {usuario.nombre || usuario.email}
            {usuario.nombre && usuario.email && (
              <span className="text-muted-foreground/60"> · {usuario.email}</span>
            )}
          </p>
        </div>
      </div>

      {/* La key hace que "Mejorar plan" cambie de pestaña también cuando ya
          se está en /perfil: `defaultValue` solo vale al montar. */}
      <Tabs key={tabInicial} defaultValue={tabInicial} className="w-full">
        {/* Navegación de las pestañas */}
        <TabsList className="grid w-full grid-cols-3 max-w-md bg-muted/50 p-1">
          <TabsTrigger
            value="perfil"
            className="text-xs font-bold uppercase tracking-widest"
          >
            Perfil
          </TabsTrigger>
          <TabsTrigger
            value="seguridad"
            className="text-xs font-bold uppercase tracking-widest"
          >
            Seguridad
          </TabsTrigger>
          <TabsTrigger
            value="plan"
            className="text-xs font-bold uppercase tracking-widest"
          >
            Suscripción
          </TabsTrigger>
        </TabsList>

        {/* ==========================================
            PESTAÑA 1: PERFIL Y CORREO
        ========================================== */}
        <TabsContent value="perfil" className="mt-6">
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <User className="w-5 h-5 text-primary" />
                Información Personal
              </CardTitle>
              <CardDescription>
                Actualiza tu nombre y correo electrónico. Este correo se usará
                para notificaciones y facturación.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSaveProfile}>
              <CardContent className="space-y-6">
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="nombre" className="text-sm font-semibold">
                    Nombre Completo
                  </Label>
                  <Input
                    id="nombre"
                    name="nombre"
                    defaultValue={usuario.nombre}
                    required
                    className="h-11 shadow-none"
                  />
                </div>

                <div className="space-y-2 max-w-md">
                  <Label
                    htmlFor="email"
                    className="text-sm font-semibold flex items-center gap-2"
                  >
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    Correo Electrónico
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    defaultValue={usuario.email}
                    required
                    className="h-11 shadow-none"
                  />
                  <p className="text-xs text-muted-foreground mb-2">
                    Si cambias tu correo, deberás usar el nuevo para iniciar
                    sesión en Comerz.
                  </p>
                </div>
              </CardContent>
              <CardFooter className="border-t border-border/50 pt-6">
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Guardar Cambios
                </Button>
              </CardFooter>
            </form>
          </Card>
        </TabsContent>

        {/* ==========================================
            PESTAÑA 2: SEGURIDAD (CONTRASEÑA)
        ========================================== */}
        <TabsContent value="seguridad" className="mt-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <ShieldCheck className="w-5 h-5 text-primary" />
                Seguridad de la Cuenta
              </CardTitle>
              <CardDescription>
                Asegúrate de usar una contraseña larga y difícil de adivinar.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleChangePassword}>
              <CardContent className="space-y-6 mb-2">
                <div className="space-y-2 max-w-md">
                  <Label
                    htmlFor="current_password"
                    className="text-sm font-semibold"
                  >
                    Contraseña Actual
                  </Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="current_password"
                      name="current_password"
                      type="password"
                      required
                      className="h-11 pl-9 shadow-none"
                    />
                  </div>
                </div>

                <div className="space-y-2 max-w-md pt-2 border-t border-border/50">
                  <Label
                    htmlFor="new_password"
                    className="text-sm font-semibold"
                  >
                    Nueva Contraseña
                  </Label>
                  <Input
                    id="new_password"
                    name="new_password"
                    type="password"
                    required
                    className="h-11 shadow-none"
                  />
                </div>

                <div className="space-y-2 max-w-md">
                  <Label
                    htmlFor="confirm_password"
                    className="text-sm font-semibold"
                  >
                    Confirmar Nueva Contraseña
                  </Label>
                  <Input
                    id="confirm_password"
                    name="confirm_password"
                    type="password"
                    required
                    className="h-11 shadow-none"
                  />
                </div>
              </CardContent>
              <CardFooter className="border-t border-border/50 pt-6">
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Lock className="w-4 h-4 mr-2" />
                  )}
                  Actualizar Contraseña
                </Button>
              </CardFooter>
            </form>
          </Card>
        </TabsContent>

        {/* ==========================================
            PESTAÑA 3: PLAN Y SUSCRIPCIÓN
        ========================================== */}
        <TabsContent value="plan" className="mt-6">
          {suscripcion}
        </TabsContent>
      </Tabs>
    </div>
  );
}
