import { getEstadoActivacionAction } from "../actions/get-estado-activacion";
import { calcularProgresoActivacion } from "../lib/pasos-activacion";
import { WizardInicio } from "./wizard-inicio";
export async function WizardInicioServer() {
  const estado = await getEstadoActivacionAction();
  if (!estado || calcularProgresoActivacion(estado).activado) return null;
  return <WizardInicio primeraVenta={estado.primera_venta} />;
}
