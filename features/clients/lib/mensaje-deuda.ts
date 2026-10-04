export type DatosMensajeDeuda = {
  nombreCliente: string;
  /** Lo que figura en `clientes.saldo_pendiente`, sin recargo por mora. */
  saldo: number;
  /** Recargo por mora ya devengado. 0 si no hay. */
  montoRecargo: number;
  /** Saldo + recargo: lo que el sistema va a cobrar si paga hoy. */
  saldoConRecargo: number;
  /** ISO de vencimiento, o null si no tiene. */
  fechaVencimiento: string | null;
  /** Días vencido (positivo) o null si no venció / no aplica. */
  diasVencido: number | null;
  /** Link al resumen completo. Sin él el mensaje sale igual, sin detalle. */
  urlResumen?: string | null;
  nombreComercio?: string | null;
};

const moneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return anio && mes && dia ? `${dia}/${mes}` : iso;
}

/**
 * El texto del recordatorio de deuda que se manda por WhatsApp.
 *
 * Es CORTO a propósito, y el detalle viaja como LINK.
 *
 * La versión anterior metía los últimos movimientos adentro del mensaje y no
 * alcanzaba: o quedaba incompleto —¿cuántos movimientos entran antes de que
 * nadie lo lea?— o se volvía un chorizo. Y mandar un PDF adjunto es peor: son
 * cinco pasos desde el celular (descargar, abrir WhatsApp, buscar el contacto,
 * adjuntar, encontrar el archivo), o sea que se hace una vez y se abandona.
 *
 * Con link, el detalle es completo sin importar cuántos movimientos haya, y
 * además se mantiene VIVO: si la clienta paga y vuelve a abrirlo ve que está
 * al día, en vez de una foto congelada que la contradice.
 *
 * EL TOTAL ES EL QUE SE VA A COBRAR. Si hay recargo por mora devengado va
 * desglosado: mandar el saldo pelado y después cobrar más es la forma más
 * rápida de tener una discusión en el mostrador. Sale de la misma función que
 * usa el cobro.
 *
 * La función es pura y devuelve texto plano: el `*` de WhatsApp es negrita en
 * el celular de quien lo recibe.
 *
 * Con `plantilla` (configuracion_pos.mensaje_recordatorio_cc) el texto lo
 * escribe el comercio y acá solo se reemplazan las variables. Vacía o null =
 * este mensaje por defecto.
 */
export function construirMensajeDeuda(
  datos: DatosMensajeDeuda,
  plantilla?: string | null,
): string {
  if (plantilla?.trim()) return aplicarPlantillaDeuda(plantilla, datos);
  return mensajePorDefecto(datos);
}

/**
 * Variables que entiende la plantilla, con la explicación que ve el dueño en
 * Configuración. Una variable que no está acá se rechaza al guardar
 * (`variablesDesconocidas`): un `{totla}` saldría literal en el WhatsApp.
 */
export const VARIABLES_MENSAJE_DEUDA = [
  { clave: "nombre", ayuda: "Primer nombre del cliente" },
  { clave: "nombre_completo", ayuda: "Nombre completo del cliente" },
  { clave: "comercio", ayuda: "Nombre de tu comercio" },
  {
    clave: "total",
    ayuda: "Total a pagar hoy (saldo + recargo por mora si hay)",
  },
  { clave: "saldo", ayuda: "Saldo sin recargo" },
  { clave: "recargo", ayuda: "Recargo por mora ($ 0 si no hay)" },
  {
    clave: "desglose",
    ayuda: "Saldo, recargo y total en negrita (o solo el total si no hay recargo)",
  },
  { clave: "vencimiento", ayuda: "\"Venció hace N días.\" o \"Vence el dd/mm.\"" },
  { clave: "link", ayuda: "Link al resumen con el detalle de la cuenta" },
] as const;

/** Punto de partida en Configuración: el mismo mensaje por defecto, escrito
 * como plantilla. */
export const PLANTILLA_DEUDA_EJEMPLO = [
  "Hola {nombre}, ¿cómo estás?",
  "Te escribimos de {comercio} por tu cuenta corriente.",
  "",
  "{desglose}",
  "{vencimiento}",
  "",
  "Ver el detalle: {link}",
  "",
  "Cualquier duda avisame y lo revisamos. ¡Gracias!",
].join("\n");

export type VariableMensajeDeuda = (typeof VARIABLES_MENSAJE_DEUDA)[number]["clave"];

const PATRON_VARIABLE = /\{([^{}\s]+)\}/g;

/** Las `{algo}` de la plantilla que no son variables conocidas, sin repetir. */
export function variablesDesconocidas(plantilla: string): string[] {
  const conocidas = new Set<string>(VARIABLES_MENSAJE_DEUDA.map((v) => v.clave));
  const desconocidas = new Set<string>();
  for (const [, clave] of plantilla.matchAll(PATRON_VARIABLE)) {
    if (!conocidas.has(clave.toLowerCase())) desconocidas.add(clave);
  }
  return [...desconocidas];
}

function valoresVariables(
  datos: DatosMensajeDeuda,
): Record<VariableMensajeDeuda, string> {
  const nombreCompleto = datos.nombreCliente.trim();
  return {
    nombre: nombreCompleto.split(/\s+/)[0] || nombreCompleto,
    nombre_completo: nombreCompleto,
    comercio: datos.nombreComercio?.trim() ?? "",
    total: moneda.format(totalACobrar(datos)),
    saldo: moneda.format(datos.saldo),
    recargo: moneda.format(Math.max(0, datos.montoRecargo)),
    desglose: lineasDesglose(datos).join("\n"),
    vencimiento: lineaVencimiento(datos) ?? "",
    link: datos.urlResumen?.trim() ?? "",
  };
}

/**
 * Reemplaza las variables de la plantilla del comercio.
 *
 * Una línea que usa un dato que no hay (sin vencimiento, sin link) NO se
 * manda: "Ver el detalle: " con nada atrás, o "Vence el ." confunden más que
 * la línea ausente. Por eso la regla es por línea y no por variable.
 *
 * Una variable desconocida queda literal: la pantalla de Configuración no deja
 * guardarla, y si igual llegara, mostrarla es mejor que borrar texto en
 * silencio.
 */
export function aplicarPlantillaDeuda(
  plantilla: string,
  datos: DatosMensajeDeuda,
): string {
  const valores = valoresVariables(datos);
  const lineas: string[] = [];

  for (const linea of plantilla.replace(/\r\n?/g, "\n").split("\n")) {
    let faltaDato = false;
    const reemplazada = linea.replace(PATRON_VARIABLE, (crudo, clave: string) => {
      const k = clave.toLowerCase() as VariableMensajeDeuda;
      if (!(k in valores)) return crudo;
      if (valores[k] === "") faltaDato = true;
      return valores[k];
    });
    if (!faltaDato) lineas.push(reemplazada.trimEnd());
  }

  // Sacar una línea puede dejar dos vacías seguidas.
  return lineas
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function totalACobrar(datos: DatosMensajeDeuda): number {
  return datos.montoRecargo > 0 ? datos.saldoConRecargo : datos.saldo;
}

function lineasDesglose(datos: DatosMensajeDeuda): string[] {
  if (datos.montoRecargo > 0) {
    return [
      `Saldo: ${moneda.format(datos.saldo)}`,
      `Recargo por mora: ${moneda.format(datos.montoRecargo)}`,
      `*Total a pagar: ${moneda.format(datos.saldoConRecargo)}*`,
    ];
  }
  return [`*Total a pagar: ${moneda.format(datos.saldo)}*`];
}

function lineaVencimiento(datos: DatosMensajeDeuda): string | null {
  const { diasVencido, fechaVencimiento } = datos;
  if (diasVencido !== null && diasVencido > 0) {
    return `Venció hace ${diasVencido} día${diasVencido === 1 ? "" : "s"}.`;
  }
  if (fechaVencimiento) return `Vence el ${fechaCorta(fechaVencimiento)}.`;
  return null;
}

function mensajePorDefecto(datos: DatosMensajeDeuda): string {
  const { nombreCliente, urlResumen, nombreComercio } = datos;

  const primerNombre = nombreCliente.trim().split(/\s+/)[0] || nombreCliente;
  const lineas: string[] = [`Hola ${primerNombre}, ¿cómo estás?`];

  const deQuien = nombreComercio?.trim();
  lineas.push(
    deQuien
      ? `Te escribimos de ${deQuien} por tu cuenta corriente.`
      : "Te escribimos por tu cuenta corriente.",
  );
  lineas.push("");

  lineas.push(...lineasDesglose(datos));

  const vencimiento = lineaVencimiento(datos);
  if (vencimiento) lineas.push(vencimiento);

  if (urlResumen) {
    lineas.push("");
    lineas.push(`Ver el detalle: ${urlResumen}`);
  }

  lineas.push("");
  lineas.push("Cualquier duda avisame y lo revisamos. ¡Gracias!");

  return lineas.join("\n");
}
