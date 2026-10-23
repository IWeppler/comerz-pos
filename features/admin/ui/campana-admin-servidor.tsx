import { getFeedComerzAction } from "@/features/admin/actions/feed-comerz";
import { CampanaAdmin } from "./campana-admin";

/**
 * Trae el feed y dibuja la campana. Va dentro de un `Suspense` en el layout:
 * el feed son varias consultas y no tiene que frenar la pantalla que se abrió
 * (la campana aparece cuando llega).
 */
export async function CampanaAdminServidor() {
  const notificaciones = await getFeedComerzAction();
  return <CampanaAdmin notificaciones={notificaciones} />;
}
