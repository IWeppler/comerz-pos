import { esIconoNovedad, type IconoNovedad } from "./texto-novedad";

/** Categorías de "Tu negocio" (las mismas que `categoria_notificacion` en SQL). */
export type CategoriaNotificacion = "STOCK" | "TIENDA" | "PLAN" | "PLATA";

export type Notificacion = {
  clave: string;
  tipo: string;
  categoria: CategoriaNotificacion;
  titulo: string;
  detalle: string | null;
  href: string | null;
  /** ISO. La última vez que el hecho cambió (un aviso agrupado se actualiza). */
  fecha: string;
  leida: boolean;
};

/** Una novedad de Comerz (N5): la misma para todos los usuarios. */
export type Novedad = {
  clave: string;
  icono: IconoNovedad;
  titulo: string;
  /** Texto con **negritas** y viñetas: ver `texto-novedad.ts`. */
  cuerpo: string;
  fecha: string;
  leida: boolean;
};

export type ListaNotificaciones = {
  tuNegocio: Notificacion[];
  novedades: Novedad[];
  /** Lo no leído de las DOS pestañas. */
  sinLeer: number;
};

const CATEGORIAS: CategoriaNotificacion[] = ["STOCK", "TIENDA", "PLAN", "PLATA"];

/**
 * El JSON de `mis_notificaciones()` a algo tipado. Defensivo: una fila con
 * forma rara se descarta sola en vez de romper la campana, y un `href` que no
 * empieza con "/" se anula (la base ya lo exige; acá es la segunda llave,
 * porque es un link que se toca).
 */
export function normalizarNotificaciones(crudo: unknown): ListaNotificaciones {
  const r = (crudo ?? {}) as { tu_negocio?: unknown; novedades?: unknown };
  const lista = Array.isArray(r.tu_negocio) ? r.tu_negocio : [];
  const tuNegocio: Notificacion[] = [];
  for (const fila of lista) {
    const f = fila as Record<string, unknown>;
    if (typeof f?.clave !== "string" || typeof f.titulo !== "string" || typeof f.fecha !== "string") continue;
    const categoria = CATEGORIAS.includes(f.categoria as CategoriaNotificacion)
      ? (f.categoria as CategoriaNotificacion)
      : "PLATA";
    const href = typeof f.href === "string" && f.href.startsWith("/") && !f.href.startsWith("//") ? f.href : null;
    tuNegocio.push({
      clave: f.clave,
      tipo: typeof f.tipo === "string" ? f.tipo : "",
      categoria,
      titulo: f.titulo,
      detalle: typeof f.detalle === "string" ? f.detalle : null,
      href,
      fecha: f.fecha,
      leida: f.leida === true,
    });
  }
  const novedades: Novedad[] = [];
  for (const fila of Array.isArray(r.novedades) ? r.novedades : []) {
    const f = fila as Record<string, unknown>;
    if (typeof f?.clave !== "string" || typeof f.titulo !== "string" || typeof f.fecha !== "string") continue;
    novedades.push({
      clave: f.clave,
      icono: esIconoNovedad(f.icono) ? f.icono : "sparkles",
      titulo: f.titulo,
      cuerpo: typeof f.cuerpo === "string" ? f.cuerpo : "",
      fecha: f.fecha,
      leida: f.leida === true,
    });
  }
  return {
    tuNegocio,
    novedades,
    sinLeer: tuNegocio.filter((n) => !n.leida).length + novedades.filter((n) => !n.leida).length,
  };
}

/**
 * "Hace 1 min", "Hace 3 h", "Ayer", "12/10". Corto a propósito: va en una
 * línea chica abajo del aviso. Pasadas 48 horas ya no importa la hora exacta,
 * sino el día.
 */
export function tiempoRelativo(fechaIso: string, ahora: Date = new Date()): string {
  const fecha = new Date(fechaIso);
  const ms = ahora.getTime() - fecha.getTime();
  if (!Number.isFinite(ms)) return "";
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 1) return "Recién";
  if (minutos < 60) return `Hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `Hace ${horas} h`;
  if (horas < 48) return "Ayer";
  const dd = String(fecha.getDate()).padStart(2, "0");
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/** El número del ícono: "9+" pasado nueve, nada con cero. */
export function etiquetaContador(n: number): string | null {
  if (n <= 0) return null;
  return n > 9 ? "9+" : String(n);
}
