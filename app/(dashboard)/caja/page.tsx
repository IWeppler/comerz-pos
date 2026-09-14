import { RUTA_SALIR } from "@/shared/lib/salir-sesion";
import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CajaDashboard } from "@/features/caja/ui/caja-dashboard";
import { VistaGerencial } from "@/features/caja/ui/vista-gerencial";
import { CajaVistas } from "@/features/caja/ui/caja-vistas";
import { CajaHistoryTable } from "@/features/caja/ui/caja-history-table";
import { puedeVerVistaGerencialAction } from "@/features/caja/actions/permisos-caja";
import {
  getDetalleMediosPagoAction,
  getResumenGerencialAction,
  getTotalesPorTurnoAction,
} from "@/features/caja/actions/get-resumen-gerencial";
import { getPosicionDineroAction } from "@/features/caja/actions/get-posicion-dinero";
import { PosicionDinero } from "@/features/caja/ui/posicion-dinero";
import { getVentasFacturadasAction } from "@/features/caja/actions/get-ventas-facturadas";
import { VentasFacturadas } from "@/features/caja/ui/ventas-facturadas";
import {
  TurnoCajaHistorial,
  VentaCaja,
  EgresoCaja,
} from "@/entities/caja/types";
import { VentaPago } from "@/entities/ventas/types";
import { getUsuarioActual } from "@/shared/config/supabase/usuario-actual";
import { getRolActual } from "@/shared/config/supabase/contexto-actual";

export const dynamic = "force-dynamic";

/** Con qué período abre la pestaña Dinero. El mes es la unidad en la que la
 * dueña piensa los gastos fijos; el server y el cliente tienen que arrancar
 * con el MISMO valor o la etiqueta diría un período y el número sería otro. */
const PERIODO_INICIAL_DINERO = "mes" as const;

export default async function CajaPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 1. Verificación de permisos y perfil
  const { user } = await getUsuarioActual();
  if (!user) redirect(RUTA_SALIR);

  // El rol es por negocio (usuarios_negocios), el nombre es del perfil global.
  const [{ data: perfil }, rolActual] = await Promise.all([
    supabase.from("perfiles").select("nombre").eq("id", user.id).single(),
    getRolActual(),
  ]);

  const userRole = rolActual || "VENDEDOR";

  const { data: puedeCerrarAjenaRaw } = await supabase.rpc("tiene_permiso", {
    clave: "caja.cerrar_ajena",
  });
  const puedeCerrarAjena = Boolean(puedeCerrarAjenaRaw);

  // 2. Traer configuración operativa
  const { data: config } = await supabase
    .from("configuracion_pos")
    .select("modo_caja, requiere_caja_abierta, modo_facturacion")
    .single();

  // Facturado / sin facturar tiene sentido SOLO para quien factura con
  // ARCA: en un comercio de ticket interno "0% facturado" es ruido.
  const facturaConArca = config?.modo_facturacion === "ARCA";

  const modoCaja = config?.modo_caja || "UNICA";

  // 3. Traemos el historial de turnos (Filtrado según el rol y modo)
  let historialQuery = supabase
    .from("turnos_caja")
    .select("*, perfiles(nombre)")
    .order("fecha_apertura", { ascending: false })
    .limit(30);

  // Si no tiene caja.cerrar_ajena y opera por usuario, solo ve sus propias cajas pasadas
  if (!puedeCerrarAjena && modoCaja === "POR_USUARIO") {
    historialQuery = historialQuery.eq("vendedor_id", user.id);
  }

  const { data: turnosHistorial, error: queryError } = await historialQuery;

  if (queryError) {
    console.error("Error cargando historial:", queryError);
  }
  
  const turnos = (turnosHistorial || []) as TurnoCajaHistorial[];

  // 4. Identificamos los turnos ABIERTOS actuales
  const turnosAbiertos = turnos.filter((t) => t.estado === "ABIERTO");

  // El turno que ESTA persona opera, con la misma regla que usa CajaDashboard:
  // en POR_USUARIO cada quien tiene el suyo; en UNICA la caja es una sola
  // compartida por todo el local.
  //
  // Los movimientos se traen SOLO de este turno. Antes se traían de todos los
  // turnos abiertos visibles, y como un admin ve los ajenos, el efectivo de
  // otra cajera se sumaba a su "Efectivo en Cajón". Con un turno de otro día
  // que quedó abierto, eso aparecía como un sobrante fantasma en un turno
  // recién abierto (incidente 30/7: los 22.650 de Brisa del 20/7 aparecían en
  // la caja de Evelyn).
  const turnoPropio =
    turnosAbiertos.find((t) =>
      t.modo === "POR_USUARIO" ? t.vendedor_id === user.id : true,
    ) ?? null;

  let ventas: VentaCaja[] = [];
  let pagosSueltos: VentaPago[] = [];
  let egresos: EgresoCaja[] = [];

  // 5. Traemos los movimientos SOLAMENTE del turno propio abierto
  if (turnoPropio) {
    const [ventasRes, pagosSueltosRes, egresosRes] = await Promise.all([
      supabase
        .from("ventas")
        .select(
          "id, total, metodo_pago, fecha_venta, turno_caja_id, cliente_id, clientes(nombre), monto_cobrado, monto_pendiente, estado_pago, estado_operacion, perfiles(nombre), ventas_items(producto:productos(nombre)), venta_pagos(metodo_nombre, metodo_tipo, monto_bruto, comision_monto, monto_neto, acreditacion_dias, tipo_movimiento)",
        )
        .eq("turno_caja_id", turnoPropio.id)
        // Las ANULADAS entran: su efectivo lo saca el egreso de devolución, no
        // hay que sacarlo de nuevo acá. Ver `calcularTotalesTurno` y el
        // comentario largo en `getDetallesTurnoAction`. Este es el fetch que
        // alimenta el arqueo que ve la vendedora.
        .order("fecha_venta", { ascending: false }),
      supabase
        .from("venta_pagos")
        .select(
          "id, turno_caja_id, metodo_nombre, metodo_tipo, monto_bruto, comision_monto, monto_neto, acreditacion_dias, tipo_movimiento, creado_en, clientes(nombre)",
        )
        .is("venta_id", null)
        .eq("turno_caja_id", turnoPropio.id)
        .neq("estado_pago_operacion", "ANULADO")
        .order("creado_en", { ascending: false }),
      supabase
        .from("egresos")
        .select(
          "id, concepto, monto, fecha, tipo, orden_compra_id, creado_por, turno_caja_id, perfiles(nombre)",
        )
        .eq("turno_caja_id", turnoPropio.id)
        .order("fecha", { ascending: false }),
    ]);

    ventas = (ventasRes.data || []) as unknown as VentaCaja[];
    pagosSueltos = (pagosSueltosRes.data || []) as unknown as VentaPago[];
    egresos = (egresosRes.data || []) as unknown as EgresoCaja[];

    // Si es vendedor, no le mostramos los egresos que registraron otros usuarios
    if (userRole !== "ADMIN") {
      egresos = egresos.filter((e) => e.creado_por === user.id);
    }
  }

  // 6. Facturado por turno, para agrupar el historial por día. Va sobre los
  // turnos que ya trajimos, así que la RPC no amplía lo que el usuario ve.
  const totalesPorTurno = await getTotalesPorTurnoAction(turnos.map((t) => t.id));

  // 7. Vista Gerencial — solo con caja.ver_gerencial. El gate está también
  // dentro de las dos RPC (son SECURITY DEFINER y abortan con 42501), así que
  // esto es lo que decide si se renderiza, no lo que protege el dato.
  const puedeVerGerencial = await puedeVerVistaGerencialAction();

  const [resumenGerencial, detalleMedios, posicion, facturadas] =
    puedeVerGerencial
      ? await Promise.all([
          getResumenGerencialAction(),
          getDetalleMediosPagoAction(),
          getPosicionDineroAction(PERIODO_INICIAL_DINERO),
          facturaConArca
            ? getVentasFacturadasAction(PERIODO_INICIAL_DINERO)
            : Promise.resolve(null),
        ])
      : [null, null, null, null];

  // 8. ¿Esta persona opera caja, o solo mira números? No hay un flag para
  // esto: se deduce de si tiene un turno propio abierto o abrió alguno en el
  // historial. Una dueña que nunca abrió caja cae en "no cajera" y ve la Vista
  // Gerencial directamente; si algún día tiene que atender, abre su turno
  // desde el botón de caja del navbar y a partir de ahí le aparece el toggle.
  //
  // Límite conocido: el historial trae 30 turnos, así que alguien que abrió
  // caja hace mucho y no volvió a hacerlo también cae en "no cajera".
  const tieneTurnoPropioAbierto = turnosAbiertos.some((t) =>
    t.modo === "POR_USUARIO" ? t.vendedor_id === user.id : true,
  );
  const esCajera =
    tieneTurnoPropioAbierto || turnos.some((t) => t.vendedor_id === user.id);

  return (
    <div className="space-y-6 mx-auto pb-12 p-4">
      <CajaVistas
        esCajera={esCajera}
        vistaInicial={tieneTurnoPropioAbierto ? "hoy" : "dinero"}
        miTurno={
          <CajaDashboard
            turnosAbiertos={turnosAbiertos}
            ventas={ventas}
            pagosSueltos={pagosSueltos}
            egresos={egresos}
            historial={turnos}
            modoCaja={modoCaja}
            userRole={userRole}
            userId={user.id}
          />
        }
        resumenHoy={
          resumenGerencial?.data ? (
            <VistaGerencial
              resumen={resumenGerencial.data}
              detalle={detalleMedios?.data ?? []}
            />
          ) : undefined
        }
        dinero={
          posicion?.data ? (
            <div className="space-y-10">
              <PosicionDinero
                posicionInicial={posicion.data}
                periodoInicial={PERIODO_INICIAL_DINERO}
              />
              {facturadas?.data && (
                <VentasFacturadas
                  inicial={facturadas.data}
                  periodoInicial={PERIODO_INICIAL_DINERO}
                />
              )}
            </div>
          ) : undefined
        }
        historial={
          <CajaHistoryTable
            historial={turnos}
            totalesPorTurno={totalesPorTurno ?? undefined}
          />
        }
      />
    </div>
  );
}
