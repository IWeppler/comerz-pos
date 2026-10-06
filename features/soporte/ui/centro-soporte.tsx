"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, ChevronDown, LifeBuoy, MessageCircle, Search, Video } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { CATEGORIAS_SOPORTE, GUIAS_SOPORTE, PREGUNTAS_SOPORTE, type CategoriaSoporte, type GuiaSoporte } from "../lib/guias-soporte";

const WHATSAPP_SOPORTE = "https://wa.me/541154702118?text=" + encodeURIComponent("Hola, necesito ayuda con Comerz. Mi comercio es: ");
const normalizar = (texto: string) => texto.toLocaleLowerCase("es").normalize("NFD").replace(/\p{Diacritic}/gu, "");

export function CentroSoporte() {
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<CategoriaSoporte | "Todos">("Todos");
  const [guia, setGuia] = useState<GuiaSoporte | null>(null);
  const palabras = normalizar(busqueda).trim().split(/\s+/).filter(Boolean);
  const coincide = (texto: string) => palabras.every((palabra) => normalizar(texto).includes(palabra));
  const guias = GUIAS_SOPORTE.filter((item) =>
    (categoria === "Todos" || item.categoria === categoria) &&
    coincide([item.titulo, item.descripcion, item.categoria, ...item.pasos, item.nota ?? ""].join(" ")),
  );
  const preguntas = PREGUNTAS_SOPORTE.filter((item) => coincide(`${item.pregunta} ${item.respuesta}`));
  const secciones = [
    { id: "operacion", titulo: "Guías para el día a día", descripcion: "Ventas, caja, inventario y clientes.", guias: guias.filter((item) => item.categoria !== "Configuración" && item.categoria !== "Tienda online") },
    { id: "configuracion", titulo: "Configuración del comercio", descripcion: "Datos del negocio, reglas de venta, precios, pagos, facturación, equipo y preferencias. Algunas opciones requieren permisos de administrador, un módulo habilitado o un plan que las incluya.", guias: guias.filter((item) => item.categoria === "Configuración") },
    { id: "tienda-online", titulo: "Tienda online", descripcion: "Todo sobre tu catálogo público: publicación, productos, pedidos por WhatsApp, envíos, promociones y diseño.", guias: guias.filter((item) => item.categoria === "Tienda online") },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <LifeBuoy className="h-4 w-4" aria-hidden="true" /> Soporte
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">¿En qué te ayudamos?</h1>
        <p className="max-w-xl text-sm text-muted-foreground">Encontrá una guía para seguir trabajando o escribinos si necesitás ayuda con tu comercio.</p>
        <div className="relative max-w-2xl pt-2">
          <Search className="pointer-events-none absolute left-3 top-[30px] h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Buscá una tarea, por ejemplo: cerrar caja" aria-label="Buscar en las guías y preguntas de soporte" className="h-11 w-full pl-9" />
        </div>
      </header>

      <section aria-labelledby="guias-soporte" className="space-y-4">
        <div>
          <h2 id="guias-soporte" className="text-lg font-semibold">Explorá las guías</h2>
          <p className="mt-1 text-sm text-muted-foreground">Paso a paso por escrito. Los videos se sumarán a estas mismas guías.</p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Filtrar guías por tema">
          {(["Todos", ...CATEGORIAS_SOPORTE] as const).map((tema) => (
            <Button key={tema} type="button" variant={categoria === tema ? "default" : "outline"} aria-pressed={categoria === tema} onClick={() => setCategoria(tema)} className="min-h-11 px-3 text-xs">{tema}</Button>
          ))}
        </div>
        <p aria-live="polite" className="text-xs text-muted-foreground">{guias.length} {guias.length === 1 ? "guía disponible" : "guías disponibles"}</p>
        {guias.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <p className="font-medium">No encontramos una guía con esos filtros.</p>
            <p className="mt-1 text-sm text-muted-foreground">Probá con otra palabra o consultá todos los temas.</p>
            <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setBusqueda(""); setCategoria("Todos"); }}>Limpiar filtros</Button>
          </div>
        ) : (
          <div className="space-y-8">
            {secciones.filter((seccion) => seccion.guias.length > 0).map((seccion) => (
              <section key={seccion.id} aria-labelledby={`soporte-${seccion.id}`} className="space-y-4">
                <div className="border-t border-border pt-5">
                  <h2 id={`soporte-${seccion.id}`} className="text-lg font-semibold">{seccion.titulo}</h2>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{seccion.descripcion}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {seccion.guias.map((item) => (
              <button key={item.id} type="button" onClick={() => setGuia(item)} className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <div className="flex min-h-14 w-full items-center justify-center gap-2 border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <Video className="h-5 w-5" aria-hidden="true" />{item.videoUrl ? "Video disponible" : "Video próximamente"}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-xs text-muted-foreground">{item.categoria}</p>
                  <h3 className="mt-2 font-semibold text-foreground">{item.titulo}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{item.descripcion}</p>
                  <span className="mt-4 flex items-center gap-2 pt-1 text-sm font-medium text-foreground"><BookOpen className="h-4 w-4" aria-hidden="true" /> Ver guía <ArrowRight className="ml-auto h-4 w-4" aria-hidden="true" /></span>
                </div>
              </button>
            ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="preguntas-soporte" className="space-y-4">
        <h2 id="preguntas-soporte" className="text-lg font-semibold">Preguntas frecuentes</h2>
        {preguntas.length === 0 ? <p className="text-sm text-muted-foreground">No hay preguntas que coincidan con tu búsqueda.</p> : (
          <div className="rounded-xl border border-border bg-card">
            {preguntas.map((item) => (
              <details key={item.pregunta} className="group border-b border-border last:border-b-0">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  {item.pregunta}<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">{item.respuesta}</p>
              </details>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="contacto-soporte" className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <h2 id="contacto-soporte" className="text-lg font-semibold">¿Necesitás que lo revisemos con vos?</h2>
          <p className="mt-1 text-sm text-muted-foreground">Contanos qué intentabas hacer, en qué pantalla y qué mensaje apareció. Incluí el comercio y el ticket o producto si corresponde.</p>
        </div>
        <Button asChild className="min-h-11 shrink-0"><a href={WHATSAPP_SOPORTE} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" /> Escribir a soporte</a></Button>
      </section>

      <Dialog open={guia !== null} onOpenChange={(abierto) => { if (!abierto) setGuia(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {guia && <>
            <DialogHeader className="pr-8"><DialogTitle>{guia.titulo}</DialogTitle><DialogDescription>{guia.descripcion}</DialogDescription></DialogHeader>
            {guia.videoUrl ? <video key={guia.id} src={guia.videoUrl} controls preload="none" className="aspect-video w-full rounded-lg bg-muted" aria-label={`Tutorial: ${guia.titulo}`} /> : (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 text-center">
                <Video className="h-8 w-8 text-muted-foreground" aria-hidden="true" /><p className="text-sm font-medium">Video próximamente</p><p className="px-4 text-xs text-muted-foreground">Mientras tanto, seguí los pasos de esta guía.</p>
              </div>
            )}
            <ol className="space-y-3 pl-5 text-sm leading-relaxed [list-style-type:decimal]">{guia.pasos.map((paso) => <li key={paso} className="pl-1">{paso}</li>)}</ol>
            {guia.nota && <p className="rounded-lg bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">{guia.nota}</p>}
            <Button asChild variant="outline" className="min-h-11"><a href={`https://wa.me/541154702118?text=${encodeURIComponent(`Hola, necesito ayuda con la guía «${guia.titulo}» de Comerz. Mi comercio es: `)}`} target="_blank" rel="noopener noreferrer">Consultar esta guía con soporte</a></Button>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
