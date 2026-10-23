"use client";

import { useActionState } from "react";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import { resetPasswordAction } from "../actions/reset-password";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Button } from "@/shared/ui/button";
import Link from "next/link";

const initialState = { error: "", success: false };

export function RecoverForm() {
  const [state, formAction, isPending] = useActionState(
    resetPasswordAction,
    initialState,
  );

  // Si el correo se envió, mostramos el estado de éxito
  if (state?.success) {
    return (
      <div className="space-y-6 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="w-16 h-16 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto mb-6">
          <Mail className="w-8 h-8" />
        </div>
        <h3 className="text-2xl font-bold tracking-tight text-foreground">
          Revisá tu bandeja de entrada
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed px-4">
          Te enviamos un enlace seguro para restablecer tu contraseña. Si no lo
          encontrás en unos minutos, revisá tu carpeta de Spam.
        </p>
        <div className="pt-4">
          <Button asChild variant="outline" className="w-full h-11 font-bold">
            <Link href="/ingresar">Volver al inicio de sesión</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Estado normal: Formulario
  return (
    <form action={formAction} className="space-y-6" aria-busy={isPending}>
      <div className="space-y-2">
        <Label htmlFor="email">Correo Electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          disabled={isPending}
          placeholder="correo@ejemplo.com"
          className="h-11 shadow-none bg-background"
        />
      </div>

      {state?.error && (
        <div
          role="alert"
          aria-live="polite"
          className="p-3 text-sm text-destructive font-medium bg-destructive/10 rounded-md border border-destructive/20"
        >
          {state.error}
        </div>
      )}

      <Button
        type="submit"
        disabled={isPending}
        className="w-full h-12"
      >
        {isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Enviando enlace...
          </>
        ) : (
          "Enviar enlace de recuperación"
        )}
      </Button>

      <div className="text-center pt-2">
        <Link
          href="/ingresar"
          className="inline-flex items-center text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver a iniciar sesión
        </Link>
      </div>
    </form>
  );
}
