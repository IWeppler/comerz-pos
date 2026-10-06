import type { Metadata } from "next";
import { CentroSoporte } from "@/features/soporte/ui/centro-soporte";

export const metadata: Metadata = { title: "Soporte | Comerz" };

export default function SoportePage() {
  return <CentroSoporte />;
}
