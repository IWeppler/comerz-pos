"use client";

import { Blobatar } from "@blobatar/react";
// Sin este CSS el modo animado se dibuja quieto. El paquete lo marca como
// sideEffect para que el bundler no lo descarte.
import "blobatar/motion.css";
import { cn } from "@/lib/utils";

interface AvatarUsuarioProps {
  /**
   * La semilla. Es el id del usuario y no el nombre: el avatar es el mismo
   * en cualquier comercio y no cambia si la persona corrige cómo se llama.
   */
  userId: string;
  /** Para lectores de pantalla. */
  nombre?: string;
  /** Lado en px. */
  size?: number;
  /** Se mueve al pasar el mouse (respeta "reducir movimiento"). */
  animado?: boolean;
  className?: string;
}

/**
 * El avatar de una persona del comercio: un blob geométrico determinístico
 * (https://blobatar.dev, MIT, sin dependencias) generado en el navegador a
 * partir del id. No hay fotos que subir ni guardar, y dos vendedoras con el
 * mismo nombre no se confunden.
 */
export function AvatarUsuario({
  userId,
  nombre,
  size = 32,
  animado = false,
  className,
}: Readonly<AvatarUsuarioProps>) {
  const clases = cn("shrink-0 rounded-full", className);
  return animado ? (
    <Blobatar
      name={userId}
      size={size}
      background="circle"
      title={nombre}
      animate="hover"
      className={clases}
    />
  ) : (
    <Blobatar
      name={userId}
      size={size}
      background="circle"
      title={nombre}
      alt={nombre ?? ""}
      className={clases}
    />
  );
}
