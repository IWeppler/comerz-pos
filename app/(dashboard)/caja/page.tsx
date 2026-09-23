import { RUTA_SALIR } from "@/shared/lib/salir-sesion";
import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CajaDashboard } from "@/features/caja/ui/caja-dashboard";
import { CajaVistas } from "@/features/caja/ui/caja-vistas";
import { CajaHistoryTable } from "@/features/caja/ui/caja-history-table";
import {
  puedeVerVistaGerencialAction,
  puedeVerMovimientosAction,
  puedeAnularMovimientoAction,
  puedeRegistrarIngresoAction,
  puedeRegistrarEgresoAction,
  puedeTransferirAction,
} from "@/features/caja/actions/permisos-caja";
import { MovimientosFinancierosTable } from "@/features/caja/ui/movimientos-financieros-table";
import { getActividadDeCuentasAction } from "@/features/caja/actions/movimientos-financieros";
import { ActividadCuentas } from "@/features/caja/ui/actividad-cuentas";
import { puedeOperarCaja } from "@/features/caja/lib/puede-operar-caja";
import { getTotalesPorTurnoAction } from "@/features/caja/actions/get-resumen-gerencial";
import { getPosicionDineroAction } from "@/features/caja/actions/get-posicion-dinero";
import {
  TurnoCajaHistorial,
  VentaCaja,
  EgresoCaja,
  TransferenciaCaja,
} from "@/entities/caja/types";
import { VentaPago } from "@/entities/ventas/types";
import { getUsuarioActual } from "@/shared/config/supabase/usuario-actual";
import { getRolActual } from "@/shared/config/supabase/contexto-actual";
import { getEstadoCuentasFinancierasAction } from "@/features/caja/actions/cuentas-financieras";
import { getEgresosProgramadosAction } from "@/features/caja/actions/egresos-programados";
import { CuentasFinancierasPanel } from "@/features/caja/ui/cuentas-financieras-panel";

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

  // Quien no opera caja ni tiene la vista gerencial no tiene nada que hacer
  // acá: es la vendedora de "varios puestos, una caja", o cualquiera a quien
  // le sacaron "Operar la caja" desde Empleados y Permisos. El link del
  // sidebar ya no se muestra; esto es lo que impide entrar tipeando /caja.
  const [
    operaCaja,
    veGerencial,
    veMovimientosGate,
    puedeAnular,
    puedeRegistrarIngreso,
    puedeRegistrarEgreso,
    puedeTransferir,
  ] = await Promise.all([
    puedeOperarCaja(),
    puedeVerVistaGerencialAction(),
    puedeVerMovimientosAction(),
    puedeAnularMovimientoAction(),
    puedeRegistrarIngresoAction(),
    puedeRegistrarEgresoAction(),
    puedeTransferirAction(),
  ]);
  if (!operaCaja && !veGerencial && !veMovimientosGate) redirect("/pos");

  // El rol es por negocio (usuarios_negocios).
  const rolActual = await getRolActual();
  const userRole = rolActual || "VENDEDOR";

  const { data: puedeCerrarAjenaRaw } = await supabase.rpc("tiene_permiso", {
    clave: "caja.cerrar_ajena",
  });
  const puedeCerrarAjena = Boolean(puedeCerrarAjenaRaw);

  // 2. Traer configuración operativa
  const { data: config } = await supabase
    .from("configuracion_pos")
    // posName y ancho_ticket_mm son la cabecera del cierre Z impreso.
    .select(
      "modo_caja, requiere_caja_abierta, posName, ancho_ticket_mm",
    )
    .single();

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
  
  let turnos = (turnosHistorial || []) as TurnoCajaHistorial[];

  // Un cierre conserva para siempre el esperado que la cajera vio y firmó.
  // Si después una administradora corrige un medio de pago, el historial
  // necesita además el esperado ACTUAL para no seguir mostrando un faltante
  // ficticio. La RPC suma todos los movimientos del turno sin depender de la
  // RLS por usuario (en caja ÚNICA participan varias personas).
  if (turnos.length > 0) {
    const { data: efectivosActuales, error: efectivosError } = await supabase.rpc(
      "efectivo_actual_turnos",
      { p_turno_ids: turnos.map((turno) => turno.id) },
    );

    if (efectivosError) {
      console.error("Error recalculando efectivos del historial:", efectivosError);
    } else {
      const porTurno = new Map(
        (
          (efectivosActuales ?? []) as {
            turno_id: string;
            efectivo_esperado_actual: number | string;
          }[]
        ).map((fila) => [fila.turno_id, fila.efectivo_esperado_actual]),
      );
      turnos = turnos.map((turno) => ({
        ...turno,
        efectivo_esperado_actual: porTurno.get(turno.id) ?? null,
      }));
    }
  }

  // 4. Identificamos los turnos ABIERTOS actuales
  const turnosAbiertos = turnos.filter((t) => t.estado === "ABIERTO");

  // El turno que ESTA persona opera, con la misma regla que usa CajaDashboard:
  // en POR_USUARIO cada quien tiene el suyo; en UNICA la caja es una sola
  // compartida por todo el local.
  //
  const turnoPropio =
    turnosAbiertos.find((t) =>
      t.modo === "POR_USUARIO" ? t.vendedor_id === user.id : true,
    ) ?? null;

  // ───────────────────────────────────────────────────────────────────────
  // QUÉ MOVIMIENTOS SE TRAEN, Y LA LÍNEA QUE NO SE PUEDE CRUZAR
  //
  // Se traen los de TODOS los turnos abiertos que esta persona puede ver. Para
  // una vendedora eso es uno solo —el suyo—, porque el historial ya viene
  // filtrado por `cerrar_ajena` + modo POR_USUARIO. Para la dueña son todos:
  // ella no opera una caja, mira el negocio, y su pregunta es "qué está
  // pasando en el local ahora", no "qué pasó en mi cajón".
  //
  // LO QUE NO SE PUEDE HACER es dejar que esos movimientos ajenos entren en el
  // ARQUEO. Ya pasó: cuando el fetch era ancho, el efectivo de otra cajera se
  // sumaba al "Efectivo en Cajón" de quien miraba, y un turno viejo que quedó
  // abierto aparecía como sobrante fantasma en uno recién abierto (incidente
  // 30/7: los $22.650 de Brisa del 20/7 en la caja de Evelyn).
  //
  // Por eso cada movimiento viaja con su `turno_caja_id` y el componente
  // calcula los totales SOLO con los del turno propio. La tabla es ancha; el
  // arqueo es angosto. Si alguien vuelve a tocar esto, esa es la regla.
  // ───────────────────────────────────────────────────────────────────────
  const turnosVisibles = turnosAbiertos.map((t) => t.id);
  const cuentasDeTurno = [
    ...new Set(
      turnosAbiertos
        .map((t) => t.cuenta_financiera_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  let ventas: VentaCaja[] = [];
  let pagosSueltos: VentaPago[] = [];
  let egresos: EgresoCaja[] = [];
  let transferenciasCaja: TransferenciaCaja[] = [];

  // 5. Movimientos de todos los turnos abiertos visibles (ver arriba).
  if (turnosVisibles.length > 0) {
    const [ventasRes, pagosSueltosRes, egresosRes, transferenciasRes] = await Promise.all([
      supabase
        .from("ventas")
        .select(
          "id, total, metodo_pago, fecha_venta, turno_caja_id, cliente_id, clientes(nombre), monto_cobrado, monto_pendiente, estado_pago, estado_operacion, perfiles(nombre), ventas_items(variante, es_venta_libre, producto:productos(nombre)), venta_pagos(metodo_nombre, metodo_tipo, monto_bruto, comision_monto, monto_neto, acreditacion_dias, tipo_movimiento)",
        )
        .in("turno_caja_id", turnosVisibles)
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
        .in("turno_caja_id", turnosVisibles)
        .neq("estado_pago_operacion", "ANULADO")
        .order("creado_en", { ascending: false }),
      supabase
        .from("egresos")
        .select(
          "id, concepto, monto, fecha, tipo, orden_compra_id, creado_por, turno_caja_id, cuenta_origen_id, perfiles(nombre)",
        )
        .in("turno_caja_id", turnosVisibles)
        // El par turno + cuenta se mantiene: un egreso cargado contra OTRA
        // cuenta (la caja general, el banco) no salió de ningún cajón y no
        // tiene nada que hacer en el arqueo de un turno.
        .in("cuenta_origen_id", cuentasDeTurno)
        .order("fecha", { ascending: false }),
      // La RPC es por turno, así que se llama una vez por cada uno. Son dos o
      // tres en el peor caso real (los turnos ABIERTOS de un local).
      Promise.all(
        turnosVisibles.map((id) =>
          supabase.rpc("transferencias_caja_turno", { p_turno_id: id }),
        ),
      ),
    ]);

    ventas = (ventasRes.data || []) as unknown as VentaCaja[];
    pagosSueltos = (pagosSueltosRes.data || []) as unknown as VentaPago[];
    egresos = (egresosRes.data || []) as unknown as EgresoCaja[];
    // El turno se pega acá porque la RPC no lo devuelve: se la llamó por
    // turno, así que el índice lo sabe. Sin esto, con dos cajas abiertas no
    // habría forma de decir cuál de estas transferencias entra al arqueo
    // propio.
    transferenciasCaja = transferenciasRes.flatMap((r, i) =>
      ((r.data || []) as TransferenciaCaja[]).map((t) => ({
        ...t,
        turno_caja_id: turnosVisibles[i],
      })),
    );

    // Si es vendedor, no le mostramos los egresos que registraron otros
    // usuarios. Con el fetch ancho esto importa más que antes: sin el filtro,
    // una vendedora en modo UNICA vería los gastos de sus compañeras.
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

  // `getResumenGerencialAction` y `getDetalleMediosPagoAction` salieron de
  // acá con la card "Hoy" (ver el comentario largo más abajo). Son dos RPC
  // menos por cada carga de /caja.
  const [posicion, estadoCuentas, actividad, programados] =
    puedeVerGerencial
      ? await Promise.all([
          getPosicionDineroAction(PERIODO_INICIAL_DINERO),
          getEstadoCuentasFinancierasAction(),
          // La preview de "Actividad de cuentas" tiene su propio permiso
          // (`caja.ver_movimientos`). Sin él la RPC devuelve SIN_PERMISO, así
          // que ni se pide: el bloque simplemente no aparece.
          veMovimientosGate
            ? getActividadDeCuentasAction()
            : Promise.resolve(null),
          // La agenda de gastos fijos. No mueve plata: alimenta "Próximos
          // movimientos" y nada más. Cualquiera del negocio la puede LEER;
          // cargarla y editarla es de ADMIN (lo decide la RLS).
          getEgresosProgramadosAction(),
        ])
      : [null, null, null, []];

  // 8. ¿Esta persona opera caja, o solo mira números? No hay un flag para
  // esto: se deduce de si tiene un turno propio abierto o abrió alguno en el
  // historial. Una dueña que nunca abrió caja cae en "no cajera", y eso ya no
  // la deja sin nada: Hoy le muestra las cajas abiertas del local y todos sus
  // movimientos. Si algún día tiene que atender, abre su turno desde el botón
  // de caja del navbar.
  //
  // Límite conocido: el historial trae 30 turnos, así que alguien que abrió
  // caja hace mucho y no volvió a hacerlo también cae en "no cajera".
  //
  // La pregunta "¿tiene turno propio?" se contesta con `turnoPropio`, que es
  // la MISMA búsqueda que ya se hizo arriba. Tenerla dos veces era dos
  // lugares donde cambiar la regla de POR_USUARIO vs ÚNICA.
  const esCajera =
    turnoPropio !== null || turnos.some((t) => t.vendedor_id === user.id);

  // ───────────────────────────────────────────────────────────────────────
  // LA CARD "HOY" SALIÓ DE ESTA PESTAÑA (22/9/2026)
  //
  // Mostraba cobrado del día, turnos cerrados y el arqueo de TODOS los
  // turnos, arriba de un bloque que es del TURNO PROPIO. Dos alcances con un
  // "esperado" cada uno en la misma pantalla. El propio componente lo admitía
  // en un comentario que trataba de desambiguar tres números con el mismo
  // nombre — una nota al pie tapando un problema de estructura.
  //
  // Dónde quedó cada cosa:
  //  - El arqueo del día → Cierres. Su primera fila ES hoy, con vendido,
  //    esperado y diferencia, y además con el detalle por turno.
  //  - El desglose por medio de pago → adentro de la tabla de movimientos,
  //    calculado sobre lo que la tabla muestra, así sigue a los filtros.
  //
  // `VistaGerencial` y sus dos actions quedan en el repo sin consumidor: el
  // desglose por medio del DÍA sigue siendo la única vista que cruza turnos
  // cerrados con abiertos, y borrarlo antes de saber si hace falta en
  // /reportes sería tirar una consulta ya probada.
  // ───────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 mx-auto pb-12 p-4">
      <CajaVistas
        esCajera={esCajera}
        vistaInicial={turnoPropio ? "hoy" : "dinero"}
        miTurno={
          <CajaDashboard
            turnosAbiertos={turnosAbiertos}
            ventas={ventas}
            pagosSueltos={pagosSueltos}
            egresos={egresos}
            transferenciasCaja={transferenciasCaja}
            historial={turnos}
            modoCaja={modoCaja}
            userRole={userRole}
            userId={user.id}
            puedeAnular={puedeAnular}
          />
        }
        dinero={
          posicion?.data ? (
            // El orden responde preguntas cada vez menos urgentes: cuánto
            // tengo y dónde (la tira de cuentas), qué está por caer, qué pasó
            // último, y recién al final cómo cerró el período.
            <div className="space-y-10">
              {estadoCuentas?.data && (
                <CuentasFinancierasPanel
                  cuentas={estadoCuentas.data.cuentas}
                  // Los saldos salen de `posicion_dinero`, que es la única
                  // fuente que los calcula: `estado_cuentas_financieras`
                  // devuelve la estructura de cuentas y nada más. De tener dos
                  // fuentes salía la lista duplicada que había acá abajo.
                  saldos={posicion.data.cuentas ?? []}
                  turnosAbiertos={posicion.data.efectivo.turnos_abiertos}
                  programados={programados}
                  esAdmin={userRole === "ADMIN"}
                  ingresosPorAcreditar={Number(
                    posicion.data.por_acreditar_real?.saldo ??
                      posicion.data.por_acreditar.reduce(
                        (total, cuenta) => total + Number(cuenta.neto),
                        0,
                      ),
                  )}
                  cantidadPorAcreditar={Number(
                    posicion.data.por_acreditar_real?.cantidad_movimientos ??
                      posicion.data.por_acreditar.reduce(
                        (total, cuenta) => total + Number(cuenta.cantidad),
                        0,
                      ),
                  )}
                  puedeRegistrarIngreso={puedeRegistrarIngreso}
                  puedeRegistrarEgreso={puedeRegistrarEgreso}
                  puedeTransferir={puedeTransferir}
                />
              )}
              {/* `actividad` es null solo cuando no se pidió (sin permiso de
                  movimientos). Si se pidió y falló, `data` viene null y el
                  bloque lo dice: un error que se muestra como lista vacía es
                  un error que nadie reporta. */}
              {actividad && (
                <ActividadCuentas
                  paginaInicial={actividad.data}
                  error={actividad.error}
                />
              )}
              {/* El resumen del período y "facturado vs sin facturar" se
                  mudaron a /reportes → Finanzas (22/9/2026). Dinero contesta
                  "dónde está la plata AHORA" y se abre entre dos clientas;
                  aquello es un reporte que se mira con tiempo. */}
            </div>
          ) : undefined
        }
        movimientos={
          // Permiso PROPIO (`caja.ver_movimientos`), distinto de
          // `caja.ver_gerencial`: hoy los mismos roles tienen los dos, pero
          // son dos preguntas separadas ("¿cuánto hay?" vs "¿qué pasó?") y no
          // se pide prestado el gate de Dinero. El componente se autoabastece
          // (RPC en ~20ms) en vez de esperar datos server-side, así el resto
          // de la página no espera por una pestaña que puede no abrirse.
          veMovimientosGate ? (
            <MovimientosFinancierosTable puedeAnular={puedeAnular} />
          ) : undefined
        }
        historial={
          <CajaHistoryTable
            historial={turnos}
            totalesPorTurno={totalesPorTurno ?? undefined}
            papel={{
              nombreComercio: config?.posName ?? null,
              anchoTicketMm: config?.ancho_ticket_mm ?? null,
            }}
          />
        }
      />
    </div>
  );
}
