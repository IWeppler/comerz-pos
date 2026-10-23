import { Suspense } from "react";
import { ActivacionAutonomaPanel } from "@/features/admin/ui/activacion-autonoma-panel";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { getPanelComerzAction } from "@/features/admin/actions/metricas-comerz";
import { getComerciosConUsoAction } from "@/features/admin/actions/comercios-con-uso";
import { getCotizacionMepAction } from "@/features/admin/actions/cotizacion-mep";
import { getPlanesCompletosAction } from "@/features/admin/actions/planes-actions";
import { construirSerieMrr } from "@/features/admin/lib/serie-mrr";
import { ComerciosTabla } from "@/features/admin/ui/comercios-tabla";
import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import {
  montoEnPesos,
  type ContextoCotizacion,
  type NegocioParaPrevision,
  type PagoFinanciero,
} from "@/features/admin/lib/finanzas-comerz";
import { armarVistaFinanzas } from "@/features/admin/lib/vista-finanzas";
import { PanelFinanzas } from "@/features/admin/ui/panel-finanzas";
import { getGastosAction } from "@/features/admin/actions/gastos-comerz";
import { AnotarGastoBoton } from "@/features/admin/ui/anotar-gasto-boton";
import { GastosDelMes } from "@/features/admin/ui/gastos-del-mes";
import { getFunnelAction } from "@/features/admin/actions/funnel-comerz";
import { analizarFunnel, enRiesgo, porOrigen, resumirFunnel } from "@/features/admin/lib/funnel";
import { FunnelPanel } from "@/features/admin/ui/funnel-panel";
import { getEmbudoAltaAction } from "@/features/admin/actions/embudo-alta";
import { getUsuariosPruebaAction } from "@/features/admin/actions/usuarios-prueba";
import { getEstadoMailsAction } from "@/features/admin/actions/mails-de-etapa";
import {
  getCicloNegociosAction,
  hayLinkDePagoAction,
} from "@/features/admin/actions/ciclo-negocios";
import { CicloVidaPanel } from "@/features/admin/ui/ciclo-vida-panel";
import {
  analizarEmbudoAlta,
  resumirEmbudoAlta,
} from "@/features/admin/lib/embudo-alta";
import { EmbudoAltaPanel } from "@/features/admin/ui/embudo-alta-panel";
import { gastoAplicaEnMes } from "@/features/admin/lib/gastos-por-mes";
import {
  calcularArpu,
  calcularChurnMensual,
  calcularLtv,
  resumirCostos,
} from "@/features/admin/lib/metricas-saas";
import { MetricasSaasPanel } from "@/features/admin/ui/metricas-saas-panel";

// export const dynamic = "force-dynamic";

export const metadata = { title: "Panel Comerz" };

export default async function AdminComerzPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { negocios, metricas },
    comercios,
    mep,
    planes,
    { data: pagos },
    gastos,
    filasFunnel,
    filasEmbudoAlta,
    marcadosComoPrueba,
    estadoMails,
    negociosEnCiclo,
    hayLinkDePago,
    { data: sesion },
  ] = await Promise.all([
    getPanelComerzAction(),
    getComerciosConUsoAction(),
    getCotizacionMepAction(),
    getPlanesCompletosAction(),
    supabase
      .from("pagos_suscripcion")
      .select("id, negocio_id, monto, fecha_pago")
      .order("fecha_pago", { ascending: true }),
    getGastosAction(),
    getFunnelAction(),
    getEmbudoAltaAction(),
    getUsuariosPruebaAction(),
    getEstadoMailsAction(),
    getCicloNegociosAction(),
    hayLinkDePagoAction(),
    supabase.auth.getUser(),
  ]);

  const ahora = new Date();
  const mesActual = diaComercial(ahora).slice(0, 7);

  // Lo cobrado de este mes, para el ARPU y el reparto por comercio. El número
  // que manda arriba es lo GANADO (ingresos − egresos), que sale de
  // `armarVistaFinanzas`.
  const serieCobrado = construirSerieMrr(
    (pagos ?? []).map((p) => ({
      monto: Number(p.monto ?? 0),
      fecha_pago: p.fecha_pago as string,
    })),
    ahora,
  );
  const cobradoEsteMes = serieCobrado[serieCobrado.length - 1]?.total ?? 0;

  // Todo en pesos, con los gastos en dólares convertidos como corresponde a
  // cada uno (ver `montoEnPesos`). Sin cotización cae a lo guardado en pesos.
  const ctx: ContextoCotizacion = {
    mepActual: mep?.venta ?? null,
    mesActual,
  };

  const pagosFinancieros: PagoFinanciero[] = (pagos ?? []).map((p) => ({
    id: p.id as string,
    negocioId: p.negocio_id as string,
    monto: Number(p.monto ?? 0),
    fechaPago: String(p.fecha_pago),
  }));

  const negociosParaPrevision: NegocioParaPrevision[] = comercios.map((c) => ({
    id: c.id,
    estado: c.estado,
    planVencimiento: c.plan_vencimiento,
    precioMensual: c.plan_precio,
    modalidad: c.modalidad,
    cuentaEnMrr: c.cuentaEnMrr,
  }));

  const vista = armarVistaFinanzas({
    pagos: pagosFinancieros,
    gastos,
    negocios: negociosParaPrevision,
    hoy: ahora,
    ctx,
  });

  // Para el formulario de comisiones: a qué comercio y a qué cobro se ata.
  const origenes = {
    comercios: comercios
      .filter((c) => c.estado !== "cancelado")
      .map((c) => ({ id: c.id, nombre: c.nombre })),
    pagos: pagosFinancieros.map((p) => ({
      id: p.id,
      negocioId: p.negocioId,
      monto: p.monto,
      fecha: p.fechaPago.slice(0, 10),
    })),
  };

  const comerciosFunnel = analizarFunnel(filasFunnel);
  const resumenFunnel = resumirFunnel(comerciosFunnel);
  const comerciosEnRiesgo = enRiesgo(comerciosFunnel);

  // El embudo de ANTES del negocio. Va aparte de `funnel_comerz` porque ese
  // arranca en "el negocio ya existe": las cuatro personas que en agosto y
  // septiembre confirmaron el mail, entraron y nunca crearon nada no aparecen
  // en el otro ni como fila.
  const usuariosEmbudo = analizarEmbudoAlta(filasEmbudoAlta, {
    marcadosComoPrueba,
  });
  const resumenEmbudoAlta = resumirEmbudoAlta(usuariosEmbudo);
  // Las marcadas como prueba SIGUEN en la lista, aunque no cuenten para la
  // tasa: si no, marcar una por error sería irreversible desde la pantalla.
  // Los otros excluidos (super admin, invitados) no son candidatos perdidos y
  // no tienen nada que hacer acá.
  const altasPerdidas = usuariosEmbudo.filter(
    (u) =>
      u.etapa !== "CREO_NEGOCIO" && (!u.fueraDelEmbudo || u.esPrueba),
  );

  // Los del mes en curso, con la MISMA regla que usa el gráfico. Repetirla
  // acá a mano sería tener dos definiciones de "gasto de este mes" y que un
  // día digan cosas distintas.
  const gastosDelMes = gastos.filter((g) => gastoAplicaEnMes(g, mesActual));

  // ARPU, churn y LTV se calculan sobre lo COBRADO y sobre las bajas reales.
  // Cada uno devuelve null cuando la muestra no alcanza, y el panel muestra el
  // motivo en vez del número: ver metricas-saas.ts.
  const arpu = calcularArpu(cobradoEsteMes, metricas.activos);
  const churn = calcularChurnMensual(
    negocios.map((n) => ({
      estado: n.estado,
      created_at: n.created_at,
      estado_cambiado_en: n.estado_cambiado_en,
    })),
    ahora,
  );
  const ltv = calcularLtv(arpu, churn);
  const costos = resumirCostos(
    gastosDelMes.map((g) => ({
      concepto: g.concepto,
      monto: montoEnPesos(g, mesActual, ctx),
    })),
    cobradoEsteMes,
    metricas.activos,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Panel Comerz
          </h1>
          <p className="text-sm text-white/40">Cómo viene el negocio.</p>
        </div>
        {/* A la altura del título y no adentro del panel de métricas: anotar un
            gasto es una acción, y las métricas son para leer. */}
        <AnotarGastoBoton origenes={origenes} />
      </div>

      <PanelFinanzas
        vista={vista}
        mep={mep}
        metricas={{
          mrr: metricas.mrr,
          activos: metricas.activos,
          enPrueba: metricas.enPrueba,
          suspendidos: metricas.suspendidos,
        }}
      />

      <MetricasSaasPanel
        arpu={arpu}
        churn={churn}
        ltv={ltv}
      />

      <GastosDelMes
        gastos={gastosDelMes}
        total={costos.total}
        porComercio={costos.porComercio}
        mep={mep?.venta ?? null}
        mesActual={mesActual}
        origenes={origenes}
      />

      <EmbudoAltaPanel
        resumen={resumenEmbudoAlta}
        perdidos={altasPerdidas}
        estadoMails={estadoMails}
      />

      {/* El ciclo de DESPUÉS del negocio. Va pegado al embudo de alta porque
          son el mismo recorrido con el negocio creado en el medio: alta,
          activación, conversión, cobro y retención.

          El `Map` no cruza a un client component, así que se pasa como objeto
          plano. */}
      <CicloVidaPanel
        negocios={negociosEnCiclo}
        yaEnviadas={Object.fromEntries(
          [...estadoMails.enviadasPorUsuario].map(([id, claves]) => [
            id,
            [...claves],
          ]),
        )}
        hayLinkDePago={hayLinkDePago}
        emailPropio={sesion.user?.email ?? ""}
      />

      <FunnelPanel
        resumen={resumenFunnel}
        riesgo={comerciosEnRiesgo}
        origenes={porOrigen(comerciosFunnel)}
      />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-white/5" aria-label="Cargando activación" />}><ActivacionAutonomaPanel /></Suspense>

      {/* Comercios pasa a ancho completo: con las notificaciones arriba, la
          tabla ya no comparte fila y sus 7 columnas dejan de ir apretadas. */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white/90">Comercios</h2>
        <ComerciosTabla
          comercios={comercios}
          planes={planes.map((p) => ({
            id: p.id,
            nombre: p.nombre,
            precio_mensual: p.precio_mensual,
          }))}
        />
      </div>
    </div>
  );
}
