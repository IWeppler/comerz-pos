"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Producto } from "@/entities/productos/types";
import { createPublicBrowserClient } from "@/shared/config/supabase/client";
import { useLinkCatalogo, useSlugNegocio } from "@/shared/lib/use-negocio";
import { useCartStore } from "@/shared/store/cart-store";
import { useCatalogoPublico } from "./catalogo-publico-provider";
import { CarruselHorizontal } from "./carrusel-horizontal";
import { ProductCard } from "./product-card";
import { Button } from "@/shared/ui/button";
import { esFraccionable } from "@/shared/lib/unidad-venta";
import { elegirParaEnvioGratis } from "../lib/completar-envio-gratis";

/** Reusa el índice público; no descarga fotos, precios ni stock desde ventas. */
export function SugerenciasCarrito({ ids, onVerFicha, contextoEnvio }: { ids: string[]; onVerFicha: () => void; contextoEnvio?: Omit<Parameters<typeof elegirParaEnvioGratis>[0], "productos" | "items"> }) {
  const slug = useSlugNegocio();
  const link = useLinkCatalogo();
  const router = useRouter();
  const { indice, cargarIndice } = useCatalogoPublico();
  const addItem = useCartStore(s => s.addItem);
  const items = useCartStore(s => s.items);
  const cliente = useMemo(() => createPublicBrowserClient(slug), [slug]);
  const clave = [...new Set(ids)].sort().join(",");
  const [resultado, setResultado] = useState<{ clave: string; ids: string[] } | null>(null);
  useEffect(() => {
    let vigente = true;
    void cargarIndice();
    void Promise.resolve(cliente.rpc("sugerencias_carrito", { p_producto_ids: clave ? clave.split(",") : [], p_limite: clave ? 6 : 4 }))
      .then(({ data, error }) => {
        if (error) { console.error("[CATÁLOGO] sugerencias_carrito:", error.message); return; }
        if (vigente) setResultado({ clave, ids: ((data ?? []) as { producto_id: string }[]).map(p => p.producto_id) });
      })
      .catch(() => {});
    return () => { vigente = false; };
  }, [clave, cliente, cargarIndice]);
  const relacionados = resultado?.clave === clave ? resultado.ids.map(id => indice?.find(p => p.id === id)).filter((p): p is Producto => !!p && p.publicado && !!p.slug && !ids.includes(p.id)) : [];
  // No interpretar un error de la RPC como ausencia de relaciones.
  const paraEnvio = contextoEnvio && resultado?.clave === clave && resultado.ids.length === 0 && indice
    ? elegirParaEnvioGratis({ ...contextoEnvio, productos: indice, items }) : [];
  const productos = relacionados.length ? relacionados : paraEnvio.map(c => c.producto);
  if (!productos.length) return null;
  const agregar = (p: Producto) => {
    const variantes = p.producto_variantes ?? [];
    const simple = variantes.length <= 1 && !Object.keys(variantes[0]?.atributos ?? {}).length;
    if (!simple || variantes.length === 0 || variantes[0].stock < 1 || esFraccionable(p.unidad_medida)) { onVerFicha(); router.push(`${link(p.slug)}?origen=sugerencia-carrito`); return; }
    const v = variantes[0];
    addItem({ productoId: p.id, nombre: p.nombre, tipo: p.tipo, variante: v.nombre_display, varianteId: v.id, precio: v.precio ?? p.precio, cantidad: 1, unidadMedida: p.unidad_medida, stockMaximo: v.stock, imagenUrl: p.grid_url ?? p.imagen_url, sugeridoCatalogo: true });
  };
  return <section className="min-w-0 space-y-3 overflow-hidden">
    <h3 className="text-sm font-semibold">{paraEnvio.length ? "Acercate al envío gratis" : ids.length ? "Completá tu compra" : "Lo más vendido"}</h3>
    {paraEnvio.length > 0 && <p className="text-xs text-muted-foreground">{contextoEnvio?.config?.envio_gratis_alcance !== "TODOS" ? "Para envíos locales. " : ""}El beneficio se confirma al elegir entrega y cómo pagás.</p>}
    <CarruselHorizontal ariaLabel="Sugerencias del carrito" compacto>
      {productos.map(p => {
        const opcionEnvio = paraEnvio.find(c => c.producto.id === p.id);
        return <div key={p.id} className="w-36 shrink-0 snap-start sm:w-40">
        <ProductCard producto={p} origenCarrito />
        {opcionEnvio && <p className="mt-2 text-xs text-muted-foreground">Una unidad de {opcionEnvio.variante.nombre_display}: ${opcionEnvio.precio.toLocaleString("es-AR")}</p>}
        <Button className="mt-3 h-11 w-full" variant="outline" onClick={() => agregar(p)}>Agregar</Button>
      </div>; })}
    </CarruselHorizontal>
  </section>;
}
