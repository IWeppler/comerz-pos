import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

/**
 * Fase 0 del modelo de cuentas financieras.
 * Auditoría de SOLO LECTURA: no tiene modo --commit ni ejecuta RPCs.
 * Imprime JSON agregado para comparar el modelo actual antes de migrarlo.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const TOLERANCIA = 0.01;
const MAX_MUESTRA = 25;
const advertencias: string[] = [];

function cargarEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

cargarEnv(path.join(ROOT, ".env.local"));
cargarEnv(path.join(ROOT, ".env"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabaseUrl = url;

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Negocio = { id: string; nombre: string };
type Turno = {
  id: string;
  negocio_id: string;
  estado: string;
  monto_inicial: number | string;
  efectivo_esperado: number | string | null;
  fecha_cierre: string | null;
};
type Egreso = {
  id: string;
  negocio_id: string;
  turno_caja_id: string | null;
  orden_compra_id: string | null;
  tipo: string | null;
  monto: number | string;
  fecha: string;
};
type Pago = {
  id: string;
  negocio_id: string;
  turno_caja_id: string | null;
  metodo_pago_id: string | null;
  metodo_nombre: string;
  metodo_tipo: string;
  estado_pago_operacion: string;
  monto_bruto: number | string;
  monto_neto: number | string;
  acreditacion_dias: number | string;
  creado_en: string;
};
type Metodo = {
  id: string;
  negocio_id: string;
  nombre: string;
  tipo: string;
  activo: boolean;
  acreditacion_dias: number | string;
};
type Orden = {
  id: string;
  negocio_id: string;
  estado: string | null;
  total_presupuestado: number | string;
};
type Item = {
  id: string;
  negocio_id: string;
  orden_id: string;
  cantidad: number | string;
  precio_costo: number | string;
};
type CorreccionCobro = {
  id: string;
  negocio_id: string;
  pago_id: string;
  turno_estado: string;
  valor_anterior: Record<string, unknown>;
  valor_nuevo: Record<string, unknown>;
  corregido_en: string;
};

async function traerTodo<T>(tabla: string, select: string): Promise<T[]> {
  const filas: T[] = [];
  const pagina = 1000;
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await supabase
      .from(tabla)
      .select(select)
      .range(desde, desde + pagina - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...((data ?? []) as T[]));
    if (!data || data.length < pagina) return filas;
  }
}

async function traerOpcional<T>(tabla: string, select: string): Promise<T[]> {
  try {
    return await traerTodo<T>(tabla, select);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    advertencias.push(`No se pudo auditar ${tabla}: ${mensaje}`);
    return [];
  }
}

const numero = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const redondear = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const sumar = <T>(filas: readonly T[], valor: (fila: T) => number) =>
  redondear(filas.reduce((total, fila) => total + valor(fila), 0));

function agrupar<T>(filas: readonly T[], key: (fila: T) => string) {
  const result = new Map<string, T[]>();
  for (const fila of filas) {
    const clave = key(fila);
    const grupo = result.get(clave) ?? [];
    grupo.push(fila);
    result.set(clave, grupo);
  }
  return result;
}

function muestra(ids: string[]) {
  return {
    cantidad: ids.length,
    ids: ids.slice(0, MAX_MUESTRA),
    muestra_truncada: ids.length > MAX_MUESTRA,
  };
}

function esPosterior(fecha: string, cierre: string | null) {
  return (
    cierre !== null &&
    new Date(fecha).getTime() > new Date(cierre).getTime()
  );
}

async function main() {
  const [
    negocios,
    turnos,
    egresos,
    pagos,
    metodos,
    ordenes,
    items,
    correccionesCobro,
  ] =
    await Promise.all([
      traerTodo<Negocio>("negocios", "id, nombre"),
      traerTodo<Turno>(
        "turnos_caja",
        "id, negocio_id, estado, monto_inicial, efectivo_esperado, fecha_cierre",
      ),
      traerTodo<Egreso>(
        "egresos",
        "id, negocio_id, turno_caja_id, orden_compra_id, tipo, monto, fecha",
      ),
      traerTodo<Pago>(
        "venta_pagos",
        "id, negocio_id, turno_caja_id, metodo_pago_id, metodo_nombre, metodo_tipo, estado_pago_operacion, monto_bruto, monto_neto, acreditacion_dias, creado_en",
      ),
      traerTodo<Metodo>(
        "metodos_pago",
        "id, negocio_id, nombre, tipo, activo, acreditacion_dias",
      ),
      traerTodo<Orden>(
        "ordenes_compra",
        "id, negocio_id, estado, total_presupuestado",
      ),
      traerTodo<Item>(
        "ordenes_items",
        "id, negocio_id, orden_id, cantidad, precio_costo",
      ),
      traerOpcional<CorreccionCobro>(
        "cobros_cc_correcciones",
        "id, negocio_id, pago_id, turno_estado, valor_anterior, valor_nuevo, corregido_en",
      ),
    ]);

  const turnoPorId = new Map(turnos.map((fila) => [fila.id, fila]));
  const ordenPorId = new Map(ordenes.map((fila) => [fila.id, fila]));
  const metodoPorId = new Map(metodos.map((fila) => [fila.id, fila]));
  const pagosPorTurno = agrupar(
    pagos.filter((pago) => pago.turno_caja_id),
    (pago) => pago.turno_caja_id!,
  );
  const egresosPorTurno = agrupar(
    egresos.filter((egreso) => egreso.turno_caja_id),
    (egreso) => egreso.turno_caja_id!,
  );
  const itemsPorOrden = agrupar(items, (item) => item.orden_id);
  const egresosPorOrden = agrupar(
    egresos.filter((egreso) => egreso.orden_compra_id),
    (egreso) => egreso.orden_compra_id!,
  );
  const correccionesPorPago = agrupar(
    correccionesCobro,
    (correccion) => correccion.pago_id,
  );

  const porNegocio = negocios.map((negocio) => {
    const turnosNegocio = turnos.filter(
      (fila) => fila.negocio_id === negocio.id,
    );
    const egresosNegocio = egresos.filter(
      (fila) => fila.negocio_id === negocio.id,
    );
    const pagosNegocio = pagos.filter(
      (fila) => fila.negocio_id === negocio.id,
    );
    const metodosNegocio = metodos.filter(
      (fila) => fila.negocio_id === negocio.id,
    );
    const ordenesNegocio = ordenes.filter(
      (fila) => fila.negocio_id === negocio.id,
    );
    const sinTurno = egresosNegocio.filter(
      (fila) => !fila.turno_caja_id,
    );

    const cierres = turnosNegocio
      .filter((turno) => turno.estado === "CERRADO")
      .map((turno) => {
        const pagosTurno = pagosPorTurno.get(turno.id) ?? [];
        const egresosTurno = egresosPorTurno.get(turno.id) ?? [];
        const efectivo = sumar(
          pagosTurno.filter(
            (pago) =>
              pago.metodo_tipo === "EFECTIVO" &&
              pago.estado_pago_operacion !== "ANULADO",
          ),
          (pago) => numero(pago.monto_bruto),
        );
        const efectivoAnulado = sumar(
          pagosTurno.filter(
            (pago) =>
              pago.metodo_tipo === "EFECTIVO" &&
              pago.estado_pago_operacion === "ANULADO",
          ),
          (pago) => numero(pago.monto_bruto),
        );
        const salidas = sumar(egresosTurno, (egreso) => numero(egreso.monto));
        const reconstruido = redondear(
          numero(turno.monto_inicial) + efectivo - salidas,
        );
        const guardado =
          turno.efectivo_esperado === null
            ? null
            : redondear(numero(turno.efectivo_esperado));
        return {
          id: turno.id,
          guardado,
          reconstruido,
          efectivo_confirmado: efectivo,
          efectivo_anulado: efectivoAnulado,
          salidas,
          correcciones_metodo: pagosTurno.flatMap((pago) =>
            (correccionesPorPago.get(pago.id) ?? []).map((correccion) => ({
              pago_id: pago.id,
              turno_estado: correccion.turno_estado,
              anterior: correccion.valor_anterior,
              nuevo: correccion.valor_nuevo,
              corregido_en: correccion.corregido_en,
            })),
          ),
          delta:
            guardado === null ? null : redondear(reconstruido - guardado),
          movimientosPosteriores:
            pagosTurno.some((pago) =>
              esPosterior(pago.creado_en, turno.fecha_cierre),
            ) ||
            egresosTurno.some((egreso) =>
              esPosterior(egreso.fecha, turno.fecha_cierre),
            ),
        };
      });
    const cierresDistintos = cierres.filter(
      (cierre) =>
        cierre.delta !== null && Math.abs(cierre.delta) > TOLERANCIA,
    );

    const remitos = ordenesNegocio.map((orden) => {
      const lineas = itemsPorOrden.get(orden.id) ?? [];
      const pagosProveedor = (egresosPorOrden.get(orden.id) ?? []).filter(
        (egreso) => egreso.tipo === "COMPRA_MERCADERIA",
      );
      const totalLineas = sumar(
        lineas,
        (item) => numero(item.cantidad) * numero(item.precio_costo),
      );
      const totalCabecera = redondear(numero(orden.total_presupuestado));
      const totalPagado = sumar(
        pagosProveedor,
        (egreso) => numero(egreso.monto),
      );
      return {
        id: orden.id,
        estado: orden.estado,
        lineas: lineas.length,
        totalLineas,
        totalCabecera,
        totalPagado,
        deltaCabecera: redondear(totalLineas - totalCabecera),
        deltaPago: redondear(totalPagado - totalLineas),
        cantidadPagos: pagosProveedor.length,
      };
    });
    const aprobados = remitos.filter(
      (remito) => remito.estado === "APROBADA",
    );
    const usoMetodos = agrupar(
      pagosNegocio,
      (pago) => `${pago.metodo_nombre}::${pago.metodo_tipo}`,
    );

    return {
      negocio: { id: negocio.id, nombre: negocio.nombre },
      egresos: {
        cantidad: egresosNegocio.length,
        monto: sumar(egresosNegocio, (egreso) => numero(egreso.monto)),
        sin_turno: {
          ...muestra(sinTurno.map((egreso) => egreso.id)),
          monto: sumar(sinTurno, (egreso) => numero(egreso.monto)),
        },
      },
      cierres: {
        cantidad: cierres.length,
        sin_snapshot: muestra(
          cierres.filter((cierre) => cierre.guardado === null).map((c) => c.id),
        ),
        distintos_al_reconstruir: {
          ...muestra(cierresDistintos.map((cierre) => cierre.id)),
          delta_neto: sumar(
            cierresDistintos,
            (cierre) => cierre.delta ?? 0,
          ),
          delta_absoluto: sumar(cierresDistintos, (cierre) =>
            Math.abs(cierre.delta ?? 0),
          ),
        },
        con_movimientos_posteriores: muestra(
          cierres
            .filter((cierre) => cierre.movimientosPosteriores)
            .map((cierre) => cierre.id),
        ),
      },
      remitos: {
        cantidad: remitos.length,
        aprobados: aprobados.length,
        costo_historico: sumar(remitos, (remito) => remito.totalLineas),
        cabecera_desigual_a_lineas: muestra(
          remitos
            .filter(
              (remito) => Math.abs(remito.deltaCabecera) > TOLERANCIA,
            )
            .map((remito) => remito.id),
        ),
        sin_lineas: muestra(
          remitos.filter((remito) => remito.lineas === 0).map((r) => r.id),
        ),
        aprobados_sin_pago_vinculado: muestra(
          aprobados
            .filter((remito) => remito.cantidadPagos === 0)
            .map((remito) => remito.id),
        ),
        aprobados_con_pago_menor_al_costo: muestra(
          aprobados
            .filter(
              (remito) =>
                remito.cantidadPagos > 0 && remito.deltaPago < -TOLERANCIA,
            )
            .map((remito) => remito.id),
        ),
        aprobados_con_pago_mayor_al_costo: muestra(
          aprobados
            .filter((remito) => remito.deltaPago > TOLERANCIA)
            .map((remito) => remito.id),
        ),
      },
      metodos_pago: {
        trazabilidad_pagos: {
          sin_metodo_id: pagosNegocio.filter((pago) => !pago.metodo_pago_id)
            .length,
          metodo_inexistente_o_ajeno: pagosNegocio.filter((pago) => {
            if (!pago.metodo_pago_id) return false;
            return metodoPorId.get(pago.metodo_pago_id)?.negocio_id !== negocio.id;
          }).length,
        },
        configurados: metodosNegocio.map((metodo) => ({
          id: metodo.id,
          nombre: metodo.nombre,
          tipo: metodo.tipo,
          activo: metodo.activo,
          acreditacion_dias: numero(metodo.acreditacion_dias),
        })),
        candidatos_cuenta: [...usoMetodos.values()]
          .filter((rows) => rows[0]?.metodo_tipo !== "EFECTIVO")
          .map((rows) => {
            const confirmados = rows.filter(
              (pago) => pago.estado_pago_operacion !== "ANULADO",
            );
            return {
              nombre: rows[0]?.metodo_nombre,
              tipo: rows[0]?.metodo_tipo,
              cobros_confirmados: confirmados.length,
              bruto: sumar(confirmados, (pago) => numero(pago.monto_bruto)),
              neto_estimado: sumar(
                confirmados,
                (pago) => numero(pago.monto_neto),
              ),
              dias_acreditacion: [
                ...new Set(rows.map((pago) => numero(pago.acreditacion_dias))),
              ].sort((a, b) => a - b),
            };
          })
          .sort((a, b) => b.bruto - a.bruto),
      },
      integridad_multitenant: {
        egresos_con_turno_ajeno: muestra(
          egresosNegocio
            .filter(
              (egreso) =>
                egreso.turno_caja_id &&
                turnoPorId.get(egreso.turno_caja_id)?.negocio_id !== negocio.id,
            )
            .map((egreso) => egreso.id),
        ),
        pagos_con_turno_ajeno: muestra(
          pagosNegocio
            .filter(
              (pago) =>
                pago.turno_caja_id &&
                turnoPorId.get(pago.turno_caja_id)?.negocio_id !== negocio.id,
            )
            .map((pago) => pago.id),
        ),
        egresos_con_remito_ajeno: muestra(
          egresosNegocio
            .filter(
              (egreso) =>
                egreso.orden_compra_id &&
                ordenPorId.get(egreso.orden_compra_id)?.negocio_id !== negocio.id,
            )
            .map((egreso) => egreso.id),
        ),
      },
      diagnostico: {
        cierres_distintos: cierresDistintos,
        remitos_cabecera_desigual: remitos.filter(
          (remito) => Math.abs(remito.deltaCabecera) > TOLERANCIA,
        ),
      },
    };
  });

  const reporte = {
    fase: 0,
    solo_lectura: true,
    advertencias,
    generado_en: new Date().toISOString(),
    proyecto: new URL(supabaseUrl).hostname.split(".")[0],
    criterios: {
      efectivo_reconstruido:
        "monto_inicial + pagos EFECTIVO confirmados - todos los egresos del turno",
      costo_historico_remito:
        "sum(cantidad * precio_costo) de ordenes_items",
      pago_vs_costo:
        "señal de auditoría, no deuda contable: faltan condiciones de pago y notas de crédito",
      tolerancia: TOLERANCIA,
    },
    fuentes: {
      negocios: negocios.length,
      turnos: turnos.length,
      egresos: egresos.length,
      pagos: pagos.length,
      metodos: metodos.length,
      remitos: ordenes.length,
      lineas_remito: items.length,
      correcciones_cobro_cc: correccionesCobro.length,
    },
    negocios: porNegocio,
  };

  if (process.argv.includes("--resumen")) {
    const resumen = {
      fase: reporte.fase,
      solo_lectura: reporte.solo_lectura,
      advertencias: reporte.advertencias,
      generado_en: reporte.generado_en,
      proyecto: reporte.proyecto,
      fuentes: reporte.fuentes,
      negocios: porNegocio.map((fila) => ({
        nombre: fila.negocio.nombre,
        egresos: {
          cantidad: fila.egresos.cantidad,
          monto: fila.egresos.monto,
          sin_turno: fila.egresos.sin_turno.cantidad,
        },
        cierres: {
          cantidad: fila.cierres.cantidad,
          sin_snapshot: fila.cierres.sin_snapshot.cantidad,
          distintos_al_reconstruir:
            fila.cierres.distintos_al_reconstruir.cantidad,
          delta_absoluto:
            fila.cierres.distintos_al_reconstruir.delta_absoluto,
          con_movimientos_posteriores:
            fila.cierres.con_movimientos_posteriores.cantidad,
        },
        remitos: {
          cantidad: fila.remitos.cantidad,
          aprobados: fila.remitos.aprobados,
          costo_historico: fila.remitos.costo_historico,
          cabecera_desigual_a_lineas:
            fila.remitos.cabecera_desigual_a_lineas.cantidad,
          sin_lineas: fila.remitos.sin_lineas.cantidad,
          aprobados_sin_pago_vinculado:
            fila.remitos.aprobados_sin_pago_vinculado.cantidad,
          aprobados_con_pago_menor_al_costo:
            fila.remitos.aprobados_con_pago_menor_al_costo.cantidad,
          aprobados_con_pago_mayor_al_costo:
            fila.remitos.aprobados_con_pago_mayor_al_costo.cantidad,
        },
        cuentas_candidatas: fila.metodos_pago.candidatos_cuenta.map(
          (metodo) => metodo.nombre,
        ),
        pagos_sin_metodo_id:
          fila.metodos_pago.trazabilidad_pagos.sin_metodo_id,
        errores_multitenant:
          fila.integridad_multitenant.egresos_con_turno_ajeno.cantidad +
          fila.integridad_multitenant.pagos_con_turno_ajeno.cantidad +
          fila.integridad_multitenant.egresos_con_remito_ajeno.cantidad,
      })),
    };
    process.stdout.write(`${JSON.stringify(resumen, null, 2)}\n`);
    return;
  }

  if (process.argv.includes("--anomalias")) {
    const anomalias = porNegocio
      .filter(
        (fila) =>
          fila.diagnostico.cierres_distintos.length > 0 ||
          fila.diagnostico.remitos_cabecera_desigual.length > 0,
      )
      .map((fila) => ({
        negocio: fila.negocio.nombre,
        ...fila.diagnostico,
      }));
    process.stdout.write(
      `${JSON.stringify({ advertencias, negocios: anomalias }, null, 2)}\n`,
    );
    return;
  }

  process.stdout.write(`${JSON.stringify(reporte, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(
    `[AUDITORIA FINANCIERA] ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
