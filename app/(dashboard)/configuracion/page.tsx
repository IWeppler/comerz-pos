import { getConfiguracionAction } from "@/features/config/actions/config-actions";
import { SettingsManager } from "@/features/config/ui/settings-manager";
import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import type {
  Permiso,
  PerfilConRol,
  Rol,
  RolPermiso,
} from "@/entities/roles/types";
import type { InvitacionPendiente } from "@/features/config/ui/invitaciones-panel";
import {
  getUsoDelPlanAction,
  type UsoDelPlan,
} from "@/features/planes/actions/uso-del-plan";
import { bloquearVendedor } from "@/shared/config/supabase/guard-rol";
import type { ListaPrecio } from "@/entities/precios/types";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  // Antes esta página solo se protegía desde el middleware: acá adentro
  // `is_admin()` esconde secciones, pero no impedía entrar. Ver `bloquearVendedor`.
  await bloquearVendedor();

  const { data: config, error: configError } = await getConfiguracionAction();

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: esAdmin } = await supabase.rpc("is_admin");
  const isAdmin = Boolean(esAdmin);

  // Datos de Empleados y Permisos: solo se cargan si el usuario es
  // admin. RLS ya bloquea la lectura para cualquier otro caso, pero
  // evitamos incluso el intento/exposición de la data en props para
  // usuarios no-admin que lleguen a /configuracion.
  let empleados: PerfilConRol[] = [];
  let roles: Rol[] = [];
  let permisos: Permiso[] = [];
  let rolPermisos: RolPermiso[] = [];
  let invitaciones: InvitacionPendiente[] = [];
  // Uso real de los límites del plan, contado igual que los triggers de la
  // base. Solo para admin: es el único que ve la sección de equipo.
  let uso: UsoDelPlan | null = null;

  if (isAdmin) {
    // `usuarios_negocios` NO tiene la policy restrictiva de aislamiento (es
    // la tabla de membresías: el selector de negocio la lee entera) y el
    // super admin la ve toda por policy propia. Sin el filtro explícito, en
    // modo dios esta pantalla listaba a TODOS los usuarios del SaaS como
    // empleados del negocio. El id sale de la base, no de la cookie.
    const [{ data: negocioActual }, usoRes] = await Promise.all([
      supabase.rpc("negocio_actual"),
      getUsoDelPlanAction(),
    ]);
    uso = usoRes;
    const negocioId = (negocioActual as string | null) ?? null;
    const [
      empleadosRes,
      rolesRes,
      permisosRes,
      rolPermisosRes,
      invitacionesRes,
    ] = await Promise.all([
        // Los empleados del negocio salen de las membresías, no de perfiles:
        // perfiles es global y un mismo usuario puede estar en otro negocio.
        supabase
          .from("usuarios_negocios")
          .select("usuario_id, rol_id, perfiles(nombre, email), roles(nombre)")
          .eq("negocio_id", negocioId ?? "00000000-0000-0000-0000-000000000000")
          .order("created_at", { ascending: true }),
        supabase.from("roles").select("id, nombre, es_sistema"),
        supabase
          .from("permisos")
          .select("id, clave, modulo, descripcion")
          .order("modulo", { ascending: true })
          .order("clave", { ascending: true }),
        supabase.from("rol_permisos").select("rol_id, permiso_id"),
        supabase
          .from("invitaciones")
          .select("id, email, expira_en, roles(nombre)")
          .eq("estado", "PENDIENTE")
          .order("created_at", { ascending: false }),
      ]);

    // Se aplana a la forma que ya consume el panel de empleados: id es el del
    // usuario, que es con lo que se edita la membresía.
    empleados = (empleadosRes.data || []).map((fila) => {
      const perfil = Array.isArray(fila.perfiles) ? fila.perfiles[0] : fila.perfiles;
      const rol = Array.isArray(fila.roles) ? fila.roles[0] : fila.roles;
      return {
        id: fila.usuario_id,
        nombre: perfil?.nombre ?? "",
        email: perfil?.email ?? "",
        rol_id: fila.rol_id,
        roles: rol ? { nombre: rol.nombre } : null,
      };
    }) as PerfilConRol[];
    roles = rolesRes.data || [];
    permisos = permisosRes.data || [];
    rolPermisos = rolPermisosRes.data || [];
    invitaciones = (invitacionesRes.data || []).map((inv) => {
      const rol = Array.isArray(inv.roles) ? inv.roles[0] : inv.roles;
      return {
        id: inv.id,
        email: inv.email,
        expira_en: inv.expira_en,
        roles: rol ? { nombre: rol.nombre } : null,
      };
    });
  }

  // Listas de precios. Solo para admin, igual que Empleados: la RLS ya impide
  // escribirlas sin ser ADMIN, y un ENCARGADO no tiene nada que hacer con una
  // sección que no puede tocar.
  //
  // Los precios fijos se cuentan aparte y NO se traen: son la excepción a la
  // regla de la lista, y lo único que la pantalla necesita saber es cuántos
  // hay. Traerlos enteros sería bajarse un pedazo del catálogo para mostrar un
  // número.
  let listasPrecios: ListaPrecio[] = [];
  if (isAdmin) {
    const [{ data: listas }, { data: overrides }] = await Promise.all([
      supabase
        .from("listas_precios")
        .select("id, nombre, tipo_regla, valor, admite_promociones, activa, creado_en")
        .order("creado_en", { ascending: true }),
      supabase.from("producto_precios").select("lista_id"),
    ]);

    const porLista = new Map<string, number>();
    for (const fila of overrides ?? []) {
      porLista.set(fila.lista_id, (porLista.get(fila.lista_id) ?? 0) + 1);
    }

    listasPrecios = (listas ?? []).map((lista) => ({
      ...lista,
      overrides: porLista.get(lista.id) ?? 0,
    })) as ListaPrecio[];
  }

  const { data: promociones } = await supabase
    .from("promociones")
    .select(
      "*, promociones_metodos_pago (metodo_pago), promociones_categorias (categoria_nombre)",
    )
    .order("creado_en", { ascending: false });

  const { data: pagos } = await supabase
    .from("metodos_pago")
    .select("*")
    .order("nombre", { ascending: true });

  const { data: categorias } = await supabase
    .from("categorias")
    .select("*, categoria_atributos(*)")
    .order("nombre", { ascending: true });

  const { data: atributos } = await supabase
    .from("atributos")
    .select("*, atributo_valores(*)")
    .order("nombre", { ascending: true });

  return (
    <div className="space-y-6 mx-auto px-4 p-2">
      {configError || !config ? (
        <div className="p-4 rounded-md bg-destructive/10 border border-destructive/20 text-destructive font-medium">
          {configError ||
            "No se encontró la configuración en la base de datos."}
        </div>
      ) : (
        <SettingsManager
          config={config}
          promociones={promociones || []}
          listasPrecios={listasPrecios}
          pagos={pagos || []}
          categorias={categorias || []}
          isAdmin={isAdmin}
          empleados={empleados}
          roles={roles}
          permisos={permisos}
          rolPermisos={rolPermisos}
          invitaciones={invitaciones}
          uso={uso}
        />
      )}
    </div>
  );
}
