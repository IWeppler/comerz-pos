"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useVentaLibreStore } from "@/shared/store/venta-libre-store";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import { useWizardInicioStore } from "@/shared/store/wizard-inicio-store";
import { registrarHitoActivacionAction } from "../actions/registrar-hito";

/** Se monta después del ticket: su suscripción ya existe al abrir venta libre. */
export function PosInicio() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const negocio = useNegocioActivo();
  const registrado = useRef<string | null>(null);
  const consumido = useRef(false);
  const pendiente = useRef(false);
  const cajaAbierta = useCajaStatusStore((s) => s.isCajaAbierta);
  useEffect(() => {
    if (!negocio || registrado.current === negocio.id) return;
    registrado.current = negocio.id;
    void registrarHitoActivacionAction("POS_ABIERTO").catch((error) => console.error("[HITO ACTIVACION] transporte", error));
  }, [negocio]);
  useEffect(() => {
    if (params.get("inicio") !== "venta-libre") {
      consumido.current = false;
      return;
    }
    if (consumido.current) return;
    consumido.current = true;
    const q = new URLSearchParams(params.toString());
    q.delete("inicio");
    router.replace(pathname + (q.size ? `?${q}` : ""), { scroll: false });
    // Con caja cerrada no abrir el drawer encima del chip que guía el primer paso.
    pendiente.current = true;
  }, [params, pathname, router]);
  useEffect(() => {
    if (!pendiente.current) return;
    const wizard = useWizardInicioStore.getState();
    if (wizard.activo && wizard.negocioId === negocio?.id && cajaAbierta !== true) return;
    pendiente.current = false;
    useVentaLibreStore.getState().abrir();
  }, [cajaAbierta, params, negocio]);
  return null;
}
