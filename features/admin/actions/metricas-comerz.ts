"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import {
  esNegocioDemo,
  negocioHabilitado,
  sumaAlMrr,
} from "@/shared/lib/estado-negocio";

export interface NegocioAdmin {
  id: string;
  nombre: string;
  slug: string;
  estado: string;
  created_at: string;
  estado_cambiado_en: string;
  plan_id: string | null;
  plan_nombre: string | null;
  plan_precio: number;
  plan_vencimiento: string | null;
  /** Comerz lo cuenta en el MRR (ver `sumaAlMrr`). */
  cuenta_en_mrr: boolean;
  /** Se calcula acá y no en el cliente: comparar contra "ahora" durante el
   * render hace que el componente deje de ser puro. */
  vencido: boolean;
  duenio: string | null;
  usuarios: number;
}

export interface MetricasComerz {
  mrr: number;
  activos: number;
  suspendidos: number;
  sinPlan: number;
  altasSemana: number;
  bajasMes: number;
  porVencer: number;
  /** Altas self-service dentro de sus 14 días de prueba. */
  enPrueba: number;
  /** Comercios de muestra. Se informan aparte para que se vea que existen y
   * que por eso no aparecen en ninguna de las otras cuentas. */
  demos: number;
}

/**
 * Todo lo que necesita el panel de Comerz, en una sola pasada. Las policies ya
 * exigen super admin, así que si alguien más llega acá recibe listas vacías,
 * no datos de otro.
 */
export async function getPanelComerzAction(): Promise<{
  negocios: NegocioAdmin[];
  metricas: MetricasComerz;
}> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data: filas }, { data: membresias }] = await Promise.all([
    supabase
      .from("negocios")
      .select(
        "id, nombre, slug, estado, cuenta_en_mrr, created_at, estado_cambiado_en, plan_id, plan_vencimiento, planes(nombre, precio_mensual)",
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("usuarios_negocios")
      .select("negocio_id, es_owner, perfiles(email)"),
  ]);

  const duenios = new Map<string, string>();
  const cantidadUsuarios = new Map<string, number>();

  for (const m of membresias ?? []) {
    const negocioId = m.negocio_id as string;
    cantidadUsuarios.set(negocioId, (cantidadUsuarios.get(negocioId) ?? 0) + 1);

    if (!m.es_owner) continue;
    const perfil = Array.isArray(m.perfiles) ? m.perfiles[0] : m.perfiles;
    if (perfil?.email) duenios.set(negocioId, perfil.email as string);
  }

  const negocios: NegocioAdmin[] = (filas ?? []).map((n) => {
    const plan = Array.isArray(n.planes) ? n.planes[0] : n.planes;
    return {
      id: n.id as string,
      nombre: n.nombre as string,
      slug: n.slug as string,
      estado: n.estado as string,
      created_at: n.created_at as string,
      estado_cambiado_en: n.estado_cambiado_en as string,
      plan_id: (n.plan_id as string | null) ?? null,
      plan_nombre: (plan?.nombre as string | undefined) ?? null,
      plan_precio: Number(plan?.precio_mensual ?? 0),
      plan_vencimiento: (n.plan_vencimiento as string | null) ?? null,
      cuenta_en_mrr: n.cuenta_en_mrr !== false,
      vencido: n.plan_vencimiento
        ? new Date(n.plan_vencimiento as string).getTime() < Date.now()
        : false,
      duenio: duenios.get(n.id as string) ?? null,
      usuarios: cantidadUsuarios.get(n.id as string) ?? 0,
    };
  });

  const ahora = Date.now();
  const dias = (d: number) => ahora - d * 24 * 60 * 60 * 1000;

  // "Activo" acá es el que PAGA: los de prueba tienen su propio estado y no
  // suman al MRR. Antes contaban como activos y lo inflaban con plata que
  // todavía no había entrado.
  const activos = negocios.filter((n) => n.estado === "activo");
  const enPrueba = negocios.filter((n) => n.estado === "prueba");
  // El comercio de muestra no es cliente ni candidato: no suma al MRR, no es
  // alta y no es baja. Queda en su propia cuenta para que se vea por qué la
  // lista de comercios tiene más filas que la suma de las métricas.
  const demos = negocios.filter((n) => esNegocioDemo(n.estado));
  // Ni activo ni en prueba: dejó de trabajar. Sin este corte, un negocio en
  // prueba pasaba a contarse como suspendido Y como baja del mes. Los demo
  // están habilitados, así que este filtro ya los deja afuera.
  const inactivos = negocios.filter((n) => !negocioHabilitado(n.estado));

  const metricas: MetricasComerz = {
    // Solo factura lo que está activo (un negocio suspendido no cobra) y lo
    // que Comerz no sacó de la cuenta (un comercio de cortesía no paga).
    mrr: negocios
      .filter(sumaAlMrr)
      .reduce((suma, n) => suma + n.plan_precio, 0),
    activos: activos.length,
    suspendidos: inactivos.length,
    sinPlan: activos.filter((n) => !n.plan_id).length,
    // Los demo no son altas: los crea Comerz para mostrar el producto, no
    // llegan solos. Contarlos haría que armar una demo se leyera como tracción.
    altasSemana: negocios.filter(
      (n) =>
        !esNegocioDemo(n.estado) &&
        new Date(n.created_at).getTime() >= dias(7),
    ).length,
    // Churn: los que dejaron de estar activos en los últimos 30 días. Se apoya
    // en estado_cambiado_en, que lo mantiene un trigger.
    bajasMes: inactivos.filter(
      (n) => new Date(n.estado_cambiado_en).getTime() >= dias(30),
    ).length,
    porVencer: activos.filter(
      (n) =>
        n.plan_vencimiento &&
        new Date(n.plan_vencimiento).getTime() <= ahora + 15 * 86400000,
    ).length,
    // Ahora sale de un estado propio y no de una deducción. Antes se sacaba de
    // que el vencimiento cayera dentro de los 14 días del alta, que dejaba de
    // ser cierto en cuanto alguien tocaba esa fecha a mano — y estuvo mintiendo
    // meses, con la semilla de `now() + 12 months` que puso 20260803010000.
    enPrueba: enPrueba.length,
    demos: demos.length,
  };

  return { negocios, metricas };
}

// Acá vivían `getPlanesAction`, `asignarPlanAction` y una segunda
// `cambiarEstadoNegocioAction`. Las tres quedaron sin uso al borrar la página
// /admincomerz/negocios, que era lo único que las llamaba.
//
// Se borran y no se dejan "por las dudas" porque este archivo es "use server":
// cada export es un endpoint que el navegador puede invocar. Y la
// `cambiarEstadoNegocioAction` de acá era además la peor de las dos: no
// chequeaba super admin en el código (confiaba solo en la policy) y no
// escribía `estado_cambiado_en`, que es de donde sale el churn del panel.
// La que se usa es la de `acciones-comercio.ts`.
