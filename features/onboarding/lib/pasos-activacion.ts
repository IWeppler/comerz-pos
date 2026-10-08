/**
 * Los pasos de la guía de inicio, derivados del estado real del negocio.
 *
 * Módulo puro y sin IO a propósito (recibe el estado ya resuelto por la RPC
 * `estado_activacion`): la lista de pasos, cuáles son obligatorios y cuándo se
 * considera activado el comercio son reglas de negocio, y así se testean sin
 * base.
 *
 * Por qué checklist y no tour por módulos: la pregunta del día 1 no es "qué
 * hace cada pantalla", es "qué me falta para vender". La explicación de cada
 * módulo va en su propio empty state, donde el usuario ya está parado en el
 * problema.
 */

/** Datos reales de la RPC; los pasos de la guía son una proyección. */
export interface EstadoActivacion {
  rubro: string;
  marca: boolean;
  /** La RPC lo sigue devolviendo, pero la guía ya NO arma un paso con esto:
   * ver el comentario en `construirPasosActivacion`. Se mantiene en el tipo
   * para que la forma de acá siga siendo la de la respuesta real. */
  metodos_pago: boolean;
  productos: boolean;
  stock_y_precios: boolean;
  empleados: boolean;
  catalogo_publicado: boolean;
  caja: boolean;
  primera_venta: boolean;
  venta_libre_elegida: boolean;
}

export interface PasoActivacion {
  clave:
    | "negocio"
    | "productos"
    | "caja"
    | "primera_venta"
    | "marca"
    | "empleados"
    | "catalogo_publicado";
  titulo: string;
  detalle: string;
  href: string;
  cta: string;
  hecho: boolean;
  /** Marca que el botón NO navega sino que dispara algo en la app. "abrir-caja" abre el modal del navbar; "elegir-camino" abre
   * el diálogo de inicio. La lib se mantiene pura: describe la intención, no la ejecuta. */
  accion?: "abrir-caja" | "elegir-camino";
  /** No cuenta para el progreso ni frena la activación: hay comercios
   * unipersonales y comercios que no quieren tienda online. Se listan igual
   * porque si no, nadie se entera de que existen. */
  opcional: boolean;
}

export function construirPasosActivacion(
  estado: EstadoActivacion,
): PasoActivacion[] {
  return [
    {
      clave: "negocio",
      titulo: "Creaste tu negocio",
      detalle: "",
      href: "/",
      cta: "",
      hecho: true,
      opcional: false,
    },
    {
      clave: "productos",
      titulo: "Prepará tus productos",
      detalle: "Cargalos o empezá con una venta libre: elegís vos.",
      href: "/?empezar=1",
      cta: "Elegir cómo empezar",
      accion: "elegir-camino",
      hecho:
        (estado.productos && estado.stock_y_precios) ||
        estado.venta_libre_elegida === true,
      opcional: false,
    },
    {
      clave: "caja",
      titulo: "Abrí la caja",
      detalle: "Con cuánta plata arrancás en el cajón. $0 está bien.",
      href: "/caja",
      cta: "Abrir caja",
      accion: "abrir-caja",
      hecho: estado.caja,
      opcional: false,
    },
    {
      clave: "primera_venta",
      titulo: "Hacé tu primera venta",
      detalle: estado.venta_libre_elegida
        ? "Tocá 'Venta libre', escribí qué vendiste y el precio."
        : "Elegí qué vendiste y cómo te pagaron.",
      href: "/pos",
      cta: "Ir al POS",
      hecho: estado.primera_venta,
      opcional: false,
    },
    {
      clave: "marca",
      titulo: "Ponele tu cara al negocio",
      detalle:
        "Subí tu logo y cargá el WhatsApp: van en el ticket y en tu tienda online.",
      href: "/configuracion",
      cta: "Configurar",
      hecho: estado.marca,
      opcional: true,
    },
    {
      clave: "empleados",
      titulo: "Sumá a tu equipo",
      detalle: "Cada quien con su usuario y su caja.",
      href: "/configuracion",
      cta: "Invitar",
      hecho: estado.empleados,
      opcional: true,
    },
    {
      clave: "catalogo_publicado",
      titulo: "Publicá tu tienda online",
      detalle:
        "Publicá productos para que tus clientes te compren por WhatsApp.",
      href: "/configuracion",
      cta: "Publicar",
      hecho: estado.catalogo_publicado,
      opcional: true,
    },
  ];
}

export interface ProgresoActivacion {
  pasos: PasoActivacion[];
  /** Cuántos obligatorios están hechos. Los opcionales no cuentan: si contaran,
   * el comercio unipersonal nunca llegaría al 100% y la barra le mentiría. */
  completados: number;
  total: number;
  /**
   * Lo que apaga la guía: todos los obligatorios hechos, O una venta hecha.
   *
   * El segundo caso es la red de seguridad para los comercios que ya trabajan.
   * Si vendió, está activado por definición — cualquier paso que dé en falso
   * después de eso es un bug de la detección, y el costo de equivocarse es
   * mostrarle "primeros pasos" a alguien que factura hace un año.
   */
  activado: boolean;
  /** El primero que falta, obligatorio u opcional. Es el que la card destaca. */
  siguiente: PasoActivacion | null;
}

export function calcularProgresoActivacion(
  estado: EstadoActivacion,
): ProgresoActivacion {
  const pasos = construirPasosActivacion(estado);
  const obligatorios = pasos.filter((p) => !p.opcional);

  return {
    pasos,
    completados: obligatorios.filter((p) => p.hecho).length,
    total: obligatorios.length,
    activado: estado.primera_venta || obligatorios.every((p) => p.hecho),
    siguiente:
      pasos.find((p) => !p.hecho && !p.opcional) ??
      pasos.find((p) => !p.hecho) ??
      null,
  };
}
