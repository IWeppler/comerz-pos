"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
export function StockInicio({
  permitido,
  onImportar,
  onNuevo,
}: Readonly<{
  permitido: boolean;
  onImportar: () => void;
  onNuevo: () => void;
}>) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const consumido = useRef(false);
  useEffect(() => {
    const accion = params.get("accion");
    if (
      pathname !== "/stock" ||
      !["importar", "nuevo"].includes(accion ?? "")
    ) {
      consumido.current = false;
      return;
    }
    if (consumido.current) return;
    consumido.current = true;
    const q = new URLSearchParams(params.toString());
    q.delete("accion");
    router.replace(pathname + (q.size ? `?${q}` : ""), { scroll: false });
    if (permitido) {
      if (accion === "importar") onImportar();
      else onNuevo();
    }
  }, [params, pathname, router, permitido, onImportar, onNuevo]);
  return null;
}
