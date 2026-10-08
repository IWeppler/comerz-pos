"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useNegocioActivo } from "@/shared/components/negocio-activo-provider";
import { useCajaStatusStore } from "@/shared/store/caja-status-store";
import { useVentaLibreStore } from "@/shared/store/venta-libre-store";
import { useWizardInicioStore } from "@/shared/store/wizard-inicio-store";
import { Spotlight } from "@/shared/components/spotlight";
import { pasoWizardInicio } from "../lib/wizard-inicio";

const textos = {
  caja: "Primero abrí la caja: contá la plata que hay en el cajón. $0 está bien.",
  "venta-libre": "Escribí qué vendiste y el precio.",
  cobrar: "Elegí cómo te pagaron y confirmá.",
};
export function WizardInicio({
  primeraVenta,
}: Readonly<{ primeraVenta: boolean }>) {
  const negocio = useNegocioActivo();
  const ruta = usePathname();
  const cajaAbierta = useCajaStatusStore((s) => s.isCajaAbierta);
  const ventaLibreAbierta = useVentaLibreStore((s) => s.abierto);
  const { activo, negocioId, cargar, salir, ticketConLineas, ventaExitosa } =
    useWizardInicioStore();
  useEffect(() => {
    if (negocio) cargar(negocio.id);
  }, [negocio, cargar]);
  useEffect(() => {
    if (activo && negocioId === negocio?.id && (ventaExitosa || primeraVenta)) salir();
  }, [activo, ventaExitosa, primeraVenta, salir, negocioId, negocio]);
  if (!activo || negocioId !== negocio?.id) return null;
  const paso = pasoWizardInicio({
    cajaAbierta,
    ventaLibreAbierta,
    ticketConLineas,
    primeraVenta: primeraVenta || ventaExitosa,
    ruta,
  });
  return paso ? (
    <Spotlight
      selector={`[data-wizard="${paso}"]`}
      texto={textos[paso]}
      onSalir={salir}
    />
  ) : null;
}
