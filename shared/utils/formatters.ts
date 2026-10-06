export const formatearMoneda = (monto: number) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(monto);
};

// Hora de Argentina SIEMPRE, no la del que formatea: un componente que se
// renderiza en el server (Vercel, en UTC) mostraba las ventas 3 horas
// corridas. En un navegador argentino el resultado es el mismo que antes.
const ZONA_COMERCIO = "America/Argentina/Buenos_Aires";

export const formatearHora = (fechaString: string) => {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_COMERCIO,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(fechaString));
};

export const formatearFechaHora = (fechaString: string | null) => {
  if (!fechaString) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_COMERCIO,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(fechaString));
};