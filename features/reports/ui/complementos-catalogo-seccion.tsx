import Link from "next/link";
import { getComplementosCatalogoAction } from "../actions/complementos-catalogo";
import { ComplementosCatalogo } from "./complementos-catalogo";

export async function ComplementosCatalogoSeccion({ compacto = false }: { compacto?: boolean }) {
  const { data, error } = await getComplementosCatalogoAction();
  if (error) return compacto ? null : <p id="complementos-catalogo" role="status" className="rounded-xl border p-5 text-sm text-muted-foreground">{error}</p>;
  if (!data) return null;
  if (!compacto) return <ComplementosCatalogo analisis={data} />;
  const sugerido = data.pares.find(p => !p.activo && p.publicables);
  if (!sugerido) return null;
  return <Link href="/reportes#complementos-catalogo" className="block rounded-xl border border-border bg-card p-4 hover:bg-muted/30">
    <p className="text-xs font-medium text-muted-foreground">Comerz Intelligence</p>
    <h2 className="mt-1 font-semibold">Probá una asociación para el catálogo</h2>
    <p className="mt-2 text-sm">{sugerido.producto_a} y {sugerido.producto_b} aparecieron juntos en {sugerido.ventas_juntas} ventas durante los últimos {data.dias} días.</p>
    <span className="mt-3 inline-flex min-h-11 items-center text-sm font-medium">Revisar asociaciones →</span>
  </Link>;
}
