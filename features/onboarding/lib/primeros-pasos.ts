import { calcularProgresoActivacion, type EstadoActivacion, type PasoActivacion } from "./pasos-activacion";

/**
 * La pantalla "Primeros pasos": lo que ve un comercio nuevo EN LUGAR del panel
 * de números, hasta que se activa (vende o completa lo obligatorio).
 *
 * Es una proyección de `calcularProgresoActivacion`: los pasos, cuándo están
 * hechos y cuándo se apaga son los MISMOS que la guía y la barra de prueba. Acá
 * solo se decide cómo se muestran: dos tarjetas grandes con ilustración (lo
 * que hay que hacer primero) y tarjetas chicas para el resto.
 */

export type ClaveTarjeta = "productos" | "vender" | "catalogo_publicado" | "marca" | "empleados";

export interface TarjetaInicio {
  clave: ClaveTarjeta;
  titulo: string;
  /** Lo que se hace con el botón, hecho o no. */
  cta: string;
  href: string;
  /** El botón no navega: abre el diálogo de inicio o el modal de caja. */
  accion?: "elegir-camino" | "abrir-caja";
  hecho: boolean;
  /** Por qué todavía no se puede (la venta sin productos). */
  bloqueado: string | null;
  /** Es la que sigue: va con el botón sólido. */
  siguiente: boolean;
  opcional: boolean;
}

export interface PantallaPrimerosPasos {
  titulo: string;
  completados: number;
  total: number;
  grandes: TarjetaInicio[];
  chicas: TarjetaInicio[];
}

const TITULO_POR_PASO: Partial<Record<PasoActivacion["clave"], string>> = {
  productos: "Empezá por tus productos",
  // Caja y primera venta son UNA tarea para el comercio: el POS abre la caja
  // ahí mismo al cobrar (ver docs/activacion-autonoma.md §2).
  caja: "Ahora empezá a vender",
  primera_venta: "Ahora empezá a vender",
};

export function pantallaPrimerosPasos(estado: EstadoActivacion): PantallaPrimerosPasos {
  const { pasos, completados, total, siguiente } = calcularProgresoActivacion(estado);
  const paso = (clave: PasoActivacion["clave"]) => pasos.find((p) => p.clave === clave)!;
  const productos = paso("productos");
  const caja = paso("caja");
  const venta = paso("primera_venta");
  const catalogo = paso("catalogo_publicado");
  const marca = paso("marca");
  const empleados = paso("empleados");
  const esSiguiente = (p: PasoActivacion) => !p.hecho && siguiente?.clave === p.clave;

  const grandes: TarjetaInicio[] = [
    {
      clave: "productos",
      titulo: "Prepará tus productos",
      // Hecho: seguir cargando. Si arrancó con venta libre, todavía no tiene catálogo.
      cta: productos.hecho ? (estado.productos ? "Agregar otro producto" : "Cargar productos") : "Elegir cómo empezar",
      href: productos.hecho ? "/stock" : productos.href,
      accion: productos.hecho ? undefined : "elegir-camino",
      hecho: productos.hecho,
      bloqueado: null,
      siguiente: esSiguiente(productos),
      opcional: false,
    },
    {
      // Caja + primera venta en una: el POS pide abrir la caja al cobrar si
      // está cerrada. Hecha cuando vendió.
      clave: "vender",
      titulo: "Empezá a vender",
      cta: venta.hecho ? "Ir al Punto de Venta" : "Ir a vender",
      href: venta.href,
      hecho: venta.hecho,
      bloqueado: productos.hecho ? null : "Primero prepará tus productos",
      siguiente: !venta.hecho && (esSiguiente(caja) || esSiguiente(venta)),
      opcional: false,
    },
  ];

  const chicas: TarjetaInicio[] = [
    {
      clave: "catalogo_publicado",
      titulo: "Activá tu tienda online",
      cta: catalogo.cta,
      href: catalogo.href,
      hecho: catalogo.hecho,
      bloqueado: null,
      siguiente: false,
      opcional: true,
    },
    {
      clave: "marca",
      titulo: "Completá los datos del negocio",
      cta: marca.cta,
      href: marca.href,
      hecho: marca.hecho,
      bloqueado: null,
      siguiente: false,
      opcional: true,
    },
    {
      clave: "empleados",
      titulo: "Sumá a tu equipo",
      cta: empleados.cta,
      href: empleados.href,
      hecho: empleados.hecho,
      bloqueado: null,
      siguiente: false,
      opcional: true,
    },
  ];

  return {
    titulo: (siguiente && !siguiente.opcional && TITULO_POR_PASO[siguiente.clave]) || "Ya casi estás",
    completados,
    total,
    grandes,
    chicas,
  };
}
