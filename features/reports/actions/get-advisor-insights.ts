export interface Insight {
  id: string;
  type: "danger" | "warning" | "success" | "info";
  title: string;
  message: string;
  actionLabel?: string;
  href?: string;
  priority: number; // Define el orden de aparición (100 = Máxima urgencia)
  /** Plata en juego, cuando la regla puede ponerle un número. Desempata entre
   * insights de la MISMA urgencia: dos advertencias operativas no son igual de
   * urgentes si una son $8.000 y la otra $800.000. No cruza bandas de
   * prioridad a propósito — un quiebre de stock sigue arriba de un descuento
   * grande, porque son clases distintas de problema. */
  impacto?: number;
}

// Interfaz adaptada a lo que ya retorna tu getDashboardMetrics
export interface AdvisorMetrics {
  ingresos: number;
  ordenes: number;
  unidadesVendidas: number; // <-- Propiedad agregada para corregir el error TS
  gananciaBrutaVentas: number;
  gananciaNeta: number; // Ex Resultado Operativo Estimado
  totalEgresos: number;
  costoPerdidoBajas: number;
  unidadesBajas: number;
  margenPorcentaje: number;
  ticketPromedio: number;
  stockValorizadoCosto: number;
  stockTotalUnidades: number;
  productosCriticos: number;
  /** TODOS los productos con stock, cada uno con hace cuántos días vendió por
   * última vez. NO viene filtrado: el filtro es de quien lo consume (ver
   * `DIAS_SIN_MOVIMIENTO` acá y el selector de días en inventario-tab.tsx). */
  productosSinMovimiento: { diasSinVender: number }[];
  topProductos: { nombre: string; unidades: number; ganancia: number }[];
  topProductosRentables: {
    nombre: string;
    unidades: number;
    ganancia: number;
  }[];
  peoresProductosRentables?: {
    nombre: string;
    unidades: number;
    ganancia: number;
  }[];
  ventasPorDia: { label: string; value: number }[];
  ventasPorCategoria: {
    label: string;
    ingresos: number;
    unidades: number;
    tickets: number;
  }[];
  /** Opcionales: hoy solo los completa el dashboard principal (que ya trae
   * estos fetches para su columna de Atención Requerida) — /reportes sigue
   * llamando a getAdvisorInsights sin ellos y las reglas de abajo
   * simplemente no se disparan (guardadas con `metrics.x &&`). */
  deudaVencida?: { monto: number; clientes: number };
  remitosPendientes?: { cantidad: number; diasMasAntiguo: number; idMasAntiguo: string };
  categoriaEnRiesgo?: {
    categoria: string;
    unidadesVendidas: number;
    diasCobertura: number;
  };
  finDeTemporada?: {
    frase: string;
    valorizado: number;
  };
  proximaTemporada?: {
    frase: string;
    stockUnidades: number;
  };
  /** Días ABIERTOS del período analizado (días con al menos una venta). Lo
   * completa el panel principal, que ya lo calcula para los badges. Las reglas
   * que hablan de RITMO —cobertura de stock, día pico— lo necesitan: sin él no
   * se puede pasar de un total a "por día", y comparar un stock contra los
   * ingresos de dos días no mide el negocio, mide el largo de la ventana.
   * Sin este dato esas reglas no disparan (fail-closed). */
  diasDelPeriodo?: number;
  /** Tickets del período que se llevaron UNA sola unidad. Sin este dato la
   * regla de venta cruzada no dispara (fail-closed). */
  ticketsDeUnaUnidad?: number;
  /** Cuánto se resignó en descuentos y cuántos puntos de margen costó. Sale
   * de `curva_de_precio` vía getDescuentosResignadosAction. */
  descuentosResignados?: {
    monto: number;
    margenPct: number;
    margenPctAPrecioLleno: number;
    unidades: number;
  };
  /** Renglones vendidos sin costo cargado, sobre el total. Ver margen_realizado. */
  renglonesSinCosto?: { renglones: number; total: number };
  /** Margen de la prenda que se SUMA en un ticket de dos, y cuántos tickets de
   * un solo renglón hay. Ver composicion_ticket. */
  renglonAdicional?: {
    margenPromedio: number;
    ticketsDeUnRenglon: number;
    pctDeUnRenglon: number;
  };
  /** Día más fuerte y más flojo, en ventas POR DÍA (normalizado por cuántos
   * días de cada tipo hubo en el rango). Ver ventas_por_momento. */
  momentoDelDia?: {
    diaFuerte: string;
    ventasPorDiaFuerte: number;
    diaFlojo: string;
    ventasPorDiaFlojo: number;
  };
  /** Clientes donde el libro de CC no cierra contra el saldo. */
  cuentaCorrienteDescuadrada?: { clientes: number; clientesConDeuda: number };
  /** El método de pago cuyo recargo no llega a cubrir su comisión. Sale de
   * `rentabilidad_por_metodo`; sin permiso gerencial llega undefined y la
   * regla no dispara. */
  metodoQuePierde?: {
    medio: string;
    neto: number;
    base: number;
    recargo: number;
    comision: number;
    operaciones: number;
  };
}

/**
 * Qué recargo hay que cobrar para empatar una comisión `c`, las dos expresadas
 * en tanto por uno.
 *
 * No son el mismo número y ahí está toda la trampa: la comisión se cobra sobre
 * el BRUTO (lo que pasa por el posnet) y el recargo se calcula sobre la BASE
 * (lo que imputa al ticket). Empatar es `r · base = c · base · (1 + r)`, o sea
 * `r = c / (1 − c)`. Con 15% de comisión hace falta 17,65% de recargo, no 15%.
 */
export function recargoParaEmpatar(comisionPct: number): number {
  if (comisionPct <= 0 || comisionPct >= 1) return 0;
  return comisionPct / (1 - comisionPct);
}

/** Días sin vender a partir de los cuales un producto con stock cuenta como
 * estancado. 30 es el mismo default que ofrece /reportes. */
export const DIAS_SIN_MOVIMIENTO = 30;

/** Piso de muestra para cualquier regla que hable de un RITMO (por día, por
 * día de semana). Dos semanas es el mínimo para que un día de la semana haya
 * ocurrido dos veces; con menos, "los sábados vendés más" sale de un sábado. */
const MIN_DIAS_PARA_RITMO = 14;

/** Cobertura de stock a partir de la cual hay demasiado capital frenado: seis
 * meses de venta al ritmo del período. */
const DIAS_COBERTURA_ALTA = 180;

/** Cuántos insights devuelve por defecto. El panel pide más (su card los
 * muestra en una columna alta); el banner de /reportes se queda con 3. */
const LIMITE_DEFAULT = 3;

export function getAdvisorInsights(
  metrics: AdvisorMetrics,
  limite: number = LIMITE_DEFAULT,
): Insight[] {
  const insights: Insight[] = [];

  // Los porcentajes también van en es-AR: mezclar "15.0%" con "$ 2.250" en la
  // misma frase usa el punto como decimal y como separador de miles a la vez.
  const pct = (valor: number, decimales = 1) =>
    new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(valor);

  const formatter = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });

  // --- REGLA DE CONFIANZA (Onboarding) ---
  // Si no hay suficientes datos en el periodo, nos abstenemos de dar consejos erróneos.
  if (metrics.ordenes < 3) {
    return [
      {
        id: "onboarding",
        type: "info",
        priority: 100,
        title: "Recopilando datos...",
        message:
          "El Advisor necesita al menos 3 ventas en este período para analizar el comportamiento de tu negocio y darte recomendaciones precisas.",
      },
    ];
  }

  /* =========================================================================
     1. ALERTAS GRAVES (Action Required) - Prioridad 80 a 100
     ========================================================================= */

  // 1. Margen Operativo Negativo
  if (metrics.margenPorcentaje < 0) {
    insights.push({
      id: "margin_negative",
      type: "danger",
      priority: 100,
      title: "Alerta de Rentabilidad",
      message: `Tu margen operativo está en rojo (${pct(metrics.margenPorcentaje)}%). Tus gastos superan tus ganancias brutas. Revisa urgente la caja o ajusta tus precios.`,
      actionLabel: "Analizar Caja",
      href: "/caja",
    });
  }

  // 2. Bajas Elevadas (Fuga de capital > 3% de los ingresos o mayor a $20k)
  const porcentajeBajas =
    metrics.ingresos > 0
      ? (metrics.costoPerdidoBajas / metrics.ingresos) * 100
      : 0;
  if (porcentajeBajas > 3 || metrics.costoPerdidoBajas > 20000) {
    insights.push({
      id: "high_shrinkage",
      type: "danger",
      priority: 95,
      impacto: metrics.costoPerdidoBajas,
      title: "Fuga de Capital en Bajas",
      message: `Has perdido ${formatter.format(metrics.costoPerdidoBajas)} en productos dados de baja (${metrics.unidadesBajas} u.). Esto afecta directamente tu bolsillo limpio.`,
      actionLabel: "Ver historial",
      href: "/reportes", // O "/stock/bajas"
    });
  }

  // 3. Egresos Operativos Altos (Si los gastos son más del 40% de la ganancia bruta)
  const proporcionGastos =
    metrics.gananciaBrutaVentas > 0
      ? (metrics.totalEgresos / metrics.gananciaBrutaVentas) * 100
      : 0;
  if (proporcionGastos > 40 && metrics.totalEgresos > 10000) {
    insights.push({
      id: "high_expenses",
      type: "warning",
      priority: 90,
      impacto: metrics.totalEgresos,
      title: "Egresos Elevados",
      message: `Tus gastos operativos consumen el ${pct(proporcionGastos, 0)}% de tu ganancia bruta. Audita en qué se está yendo el efectivo físico.`,
      actionLabel: "Revisar Caja",
      href: "/caja",
    });
  }

  // 4. Stock Crítico — solo productos/variantes que ADEMÁS tuvieron ventas
  // recientes (ver detectar-quiebres.ts): contar todo el catálogo con
  // stock ≤3 disparaba con ~90% de los productos en indumentaria.
  if (metrics.productosCriticos > 0) {
    insights.push({
      id: "stock_critical",
      type: "danger",
      priority: 85,
      title: "Riesgo de Quiebre",
      message: `Tienes ${metrics.productosCriticos} productos/variantes que están rotando y con stock crítico (≤ 3 unidades). Podrías estar perdiendo ventas por falta de mercadería.`,
      actionLabel: "Reponer Stock",
      href: "/stock",
    });
  }

  // 4c. Riesgo por categoría: alta rotación reciente + stock total
  // agotándose (ver detectar-riesgo-categoria.ts). Complementa la regla
  // anterior, que mira producto por producto — esta mira la categoría
  // completa aunque ningún producto individual esté todavía en ≤3.
  if (metrics.categoriaEnRiesgo) {
    const diasRestantes = Math.max(
      1,
      Math.round(metrics.categoriaEnRiesgo.diasCobertura),
    );
    insights.push({
      id: "categoria_riesgo_stock",
      type: "warning",
      priority: 80,
      title: "Categoría en Riesgo de Stock",
      message: `Estás vendiendo mucho en ${metrics.categoriaEnRiesgo.categoria} y te estás quedando con poco stock (quedan ~${diasRestantes} día${diasRestantes === 1 ? "" : "s"} al ritmo actual) — reponé antes de perder ventas.`,
      actionLabel: "Ver stock",
      href: "/stock",
    });
  }

  // 4b. Deuda Vencida Cobrable (reusa clientes.saldo_pendiente +
  // fecha_vencimiento_deuda, el mismo caché que ya mantiene manage-clients.ts
  // vía calcularDiasVencido — ver get-deuda-vencida.ts).
  // Umbral: grave si la deuda vencida supera el 50% de los ingresos del
  // período (compromete la próxima reposición) o supera $50k en términos
  // absolutos aunque el período haya facturado mucho; si no, advertencia.
  if (metrics.deudaVencida && metrics.deudaVencida.monto > 0) {
    const proporcionDeuda =
      metrics.ingresos > 0
        ? (metrics.deudaVencida.monto / metrics.ingresos) * 100
        : 100;
    // Escala continua en vez de un acantilado. Antes era binario: $49.999
    // sacaba prioridad 72 y $50.001 sacaba 92, con un peso de diferencia. El
    // factor llega a 1 en los mismos umbrales de siempre (50% de los ingresos
    // o $50.000), así que en el borde se comporta igual que antes.
    const factorDeuda = Math.min(
      1,
      Math.max(proporcionDeuda / 50, metrics.deudaVencida.monto / 50000),
    );
    const esGrave = factorDeuda >= 1;
    insights.push({
      id: "deuda_vencida",
      type: esGrave ? "danger" : "warning",
      priority: Math.round(72 + 20 * factorDeuda),
      impacto: metrics.deudaVencida.monto,
      title: "Deuda Vencida",
      message: `Tenés ${formatter.format(metrics.deudaVencida.monto)} en deuda vencida de ${metrics.deudaVencida.clientes} cliente${metrics.deudaVencida.clientes === 1 ? "" : "s"}. Es plata tuya que ya deberías haber cobrado.`,
      actionLabel: "Ver clientes",
      href: "/clientes",
    });
  }

  // 4f. El libro de cuenta corriente no cierra contra el saldo.
  //
  // Es el control de calidad de la propia señal de antigüedad: cuenta los
  // clientes donde (Σ débitos − Σ créditos) no coincide con
  // `clientes.saldo_pendiente`. Va arriba de las advertencias operativas
  // porque no es una oportunidad de mejora: es plata cuyo número no se sabe
  // cuál es, y mientras esté así la antigüedad de la deuda no cierra contra lo
  // que ve la dueña. Nada más en el panel lo mira.
  if (metrics.cuentaCorrienteDescuadrada) {
    const cc = metrics.cuentaCorrienteDescuadrada;
    insights.push({
      id: "cc_descuadrada",
      type: "warning",
      priority: 88,
      title: "Cuenta corriente sin cuadrar",
      message: `En ${cc.clientes} de ${cc.clientesConDeuda} ${cc.clientesConDeuda === 1 ? "cliente con deuda" : "clientes con deuda"} el libro de movimientos no coincide con el saldo. Hasta revisarlos, lo que dice la deuda de esos clientes no es confiable.`,
      actionLabel: "Ver clientes",
      href: "/clientes",
    });
  }

  /* =========================================================================
     2. ADVERTENCIAS OPERATIVAS - Prioridad 50 a 79
     ========================================================================= */

  // 4g. Renglones vendidos sin costo cargado.
  //
  // Un costo en cero no es margen del 100%: es un costo que nadie cargó.
  // Mientras esos renglones estén ahí, el margen que muestra el panel está
  // INFLADO y cualquier ranking de rentabilidad los pone primeros por un
  // motivo falso. Por eso la tarjeta habla de que los números no son
  // confiables, no de que el producto rinda bien.
  if (metrics.renglonesSinCosto && metrics.renglonesSinCosto.total > 0) {
    const sc = metrics.renglonesSinCosto;
    const proporcion = (sc.renglones / sc.total) * 100;

    if (proporcion >= 2) {
      insights.push({
        id: "renglones_sin_costo",
        type: "warning",
        priority: 74,
        title: "Ventas sin costo cargado",
        message: `${sc.renglones} de ${sc.total} renglones vendidos no tienen costo cargado (${pct(proporcion, 0)}%). Su margen figura como 100%, así que la ganancia que ves está más alta de lo que es.`,
        actionLabel: "Cargar costos",
        href: "/stock",
      });
    }
  }

  // 4d. Un método de pago cuyo recargo no cubre su propia comisión.
  //
  // Es la primera señal de Comerz Insights que llega al panel, y la que apunta
  // a plata que se está yendo AHORA sin que nadie la vea: no es un problema
  // operativo que se resuelve reponiendo, es un precio mal puesto que sangra
  // en cada venta. Medido en Evens sobre Tarjeta Banco Nación: recargo 15% y
  // comisión 15% dan −2,25%, porque la comisión se cobra sobre el bruto y el
  // recargo sobre la base. Ver `recargoParaEmpatar`.
  //
  // Va arriba de "capital inmovilizado" (75) porque se arregla con un número
  // en una pantalla de configuración, y abajo de los quiebres de stock, que
  // cuestan ventas hoy.
  if (metrics.metodoQuePierde) {
    const m = metrics.metodoQuePierde;
    const bruto = m.base + m.recargo;
    const comisionPct = bruto > 0 ? m.comision / bruto : 0;
    const necesario = recargoParaEmpatar(comisionPct) * 100;
    const actual = m.base > 0 ? (m.recargo / m.base) * 100 : 0;

    insights.push({
      id: "metodo_pierde",
      type: "warning",
      priority: 78,
      impacto: Math.abs(m.neto),
      title: `${m.medio} te está costando plata`,
      message: `Perdés ${formatter.format(Math.abs(m.neto))} en ${m.operaciones} ${m.operaciones === 1 ? "cobro" : "cobros"}: cobrás ${pct(actual)}% de recargo y la comisión se lleva más. Para empatar tendrías que cobrar ${pct(necesario)}%.`,
      actionLabel: "Ajustar recargo",
      href: "/configuracion",
    });
  }

  // 4e. Descuentos de mostrador.
  //
  // La otra cara del mismo asunto: con markup uniforme —86,3% de los renglones
  // de Evens tienen costo exactamente igual a la mitad del precio— el margen
  // no varía por producto, varía por descuento. ACÁ vive toda la variación
  // real de la rentabilidad. Evens, 30 días: $768.680 resignados, 2,68 puntos
  // de margen, en 168 de 401 tickets. No hay liquidación de por medio: es
  // descuento de mostrador, uno por uno.
  //
  // Lo que se muestra son PUNTOS de margen, no un porcentaje de un porcentaje:
  // la diferencia entre lo que se ganó y lo que se habría ganado vendiendo a
  // precio de lista. Es lo que se puede afirmar por construcción.
  if (metrics.descuentosResignados) {
    const d = metrics.descuentosResignados;
    const puntos = d.margenPctAPrecioLleno - d.margenPct;

    if (puntos >= 1) {
      insights.push({
        id: "descuentos_mostrador",
        type: "warning",
        priority: 76,
        impacto: d.monto,
        title: "Descuentos de mostrador",
        message: `Resignaste ${formatter.format(d.monto)} en descuentos: ${pct(puntos)} puntos de margen (${pct(d.margenPct)}% en vez de ${pct(d.margenPctAPrecioLleno)}%). Mirá a qué productos se les está bajando el precio.`,
        actionLabel: "Ver rentabilidad",
        href: "/reportes",
      });
    }
  }

  // 5. Capital Inmovilizado Alto — medido en DÍAS DE COBERTURA, no contra los
  // ingresos del período.
  //
  // La regla era `stockValorizado > ingresos * 5`, que compara un STOCK (un
  // nivel, $31,9 M en Evens) contra un FLUJO de una ventana arbitraria. Medido:
  // con el selector en Semana (2 días, $421.400) disparaba, y con el mismo
  // stock en Mes ($12,9 M) no. O sea que la tarjeta aparecía o no según el
  // selector, y decía "poca rotación en este período" sobre dos días, donde
  // ningún inventario rota.
  //
  // La versión honesta es cuántos días de venta hay guardados en el depósito,
  // que no depende del largo de la ventana. Necesita el ritmo diario, y por eso
  // pide `diasDelPeriodo` y un piso de muestra: estimar el ritmo con dos días
  // es estimarlo con ruido. Evens en Mes da ~104 días de cobertura, o sea que
  // NO tiene un problema de capital inmovilizado — la regla vieja decía que sí.
  const costoVendido = metrics.ingresos - metrics.gananciaBrutaVentas;
  if (
    metrics.diasDelPeriodo &&
    metrics.diasDelPeriodo >= MIN_DIAS_PARA_RITMO &&
    costoVendido > 0 &&
    metrics.stockValorizadoCosto > 0
  ) {
    const costoPorDia = costoVendido / metrics.diasDelPeriodo;
    const diasCobertura = Math.round(metrics.stockValorizadoCosto / costoPorDia);

    if (diasCobertura > DIAS_COBERTURA_ALTA) {
      insights.push({
        id: "capital_stuck",
        type: "warning",
        priority: 75,
        impacto: metrics.stockValorizadoCosto,
        title: "Capital Inmovilizado",
        message: `Tenés ${formatter.format(metrics.stockValorizadoCosto)} en mercadería: unos ${diasCobertura} días de venta al ritmo de este período. Es plata frenada que podrías estar rotando.`,
        actionLabel: "Ver stock",
        href: "/stock",
      });
    }
  }

  // 6. Mucha rotación concentrada en pocos productos (Dependencia)
  if (metrics.topProductos.length > 0) {
    const ventasDelTop1 = metrics.topProductos[0]?.unidades || 0;
    if (ventasDelTop1 > metrics.unidadesVendidas * 0.4) {
      // El % que se muestra es el MEDIDO, no el umbral. Antes el mensaje decía
      // "El 40%" siempre, fuera 41% o 90%: el umbral estaba escrito como si
      // fuera la medición.
      const concentracion = Math.round(
        (ventasDelTop1 / metrics.unidadesVendidas) * 100,
      );
      insights.push({
        id: "high_dependency",
        type: "warning",
        priority: 70,
        title: "Dependencia de Catálogo",
        message: `El ${concentracion}% de tu volumen de ventas depende de un solo producto: "${metrics.topProductos[0].nombre}". Intenta promocionar otras categorías para diversificar el riesgo.`,
      });
    }
  }

  // 7. Productos con stock pero sin movimiento.
  //
  // OJO con `productosSinMovimiento`: NO viene filtrado, trae todos los
  // productos con stock y el filtro lo pone quien consume (inventario-tab.tsx
  // usa un selector de días). Acá se leía `.length` como si ya estuviera
  // filtrado, así que el insight contaba TODO el catálogo con stock: en Evens
  // decía "1.043 productos que no registran ventas" cuando los que de verdad
  // no vendían hace 30 días eran 764 — y de paso llamaba "sin ventas" a
  // productos vendidos ayer.
  const estancados = metrics.productosSinMovimiento.filter(
    (p) => p.diasSinVender >= DIAS_SIN_MOVIMIENTO,
  ).length;
  if (estancados > 3) {
    insights.push({
      id: "no_movement",
      type: "warning",
      priority: 65,
      title: "Inventario Estancado",
      message: `Tenés ${estancados} productos con stock que no venden hace más de ${DIAS_SIN_MOVIMIENTO} días. Considerá armar un combo o un descuento temporal para liquidarlos.`,
      actionLabel: "Ver stock",
      href: "/stock",
    });
  }

  // 7b. Remitos Pendientes de Conciliar (prioridad media: no es plata
  // perdida como la deuda o las bajas, pero mientras no se concilien el
  // costo/stock de esos productos puede estar desactualizado).
  if (metrics.remitosPendientes && metrics.remitosPendientes.cantidad > 0) {
    insights.push({
      id: "remitos_pendientes",
      type: "warning",
      priority: 58,
      title: "Remitos sin Conciliar",
      message: `Tenés ${metrics.remitosPendientes.cantidad} remito${metrics.remitosPendientes.cantidad === 1 ? "" : "s"} sin conciliar — el más antiguo hace ${metrics.remitosPendientes.diasMasAntiguo} día${metrics.remitosPendientes.diasMasAntiguo === 1 ? "" : "s"}. El costo y stock real de esos productos puede no estar actualizado hasta que los revises.`,
      actionLabel: "Conciliar",
      href: `/compras/merge/${metrics.remitosPendientes.idMasAntiguo}`,
    });
  }

  // 7c. Fin de temporada (invierno/verano) con stock remanente sin
  // rotación — ver detectar-estacionalidad.ts. Calendario hardcodeado
  // (Argentina), sin forecasting: son rangos de fecha conocidos.
  if (metrics.finDeTemporada) {
    insights.push({
      id: "fin_de_temporada",
      type: "warning",
      priority: 68,
      impacto: metrics.finDeTemporada.valorizado,
      title: "Fin de Temporada",
      message: `${metrics.finDeTemporada.frase} y tenés ${formatter.format(metrics.finDeTemporada.valorizado)} en esa categoría con poca rotación — considerá una liquidación.`,
      actionLabel: "Ver stock",
      href: "/stock",
    });
  }

  /* =========================================================================
     3. OPORTUNIDADES COMERCIALES - Prioridad 30 a 49
     ========================================================================= */

  // 7d. Se acerca una temporada (incluidas las fiestas) y el stock de sus
  // categorías típicas está bajo — oportunidad de reponer a tiempo, no un
  // problema todavía (por eso vive en la sección de oportunidades y no en
  // advertencias).
  if (metrics.proximaTemporada) {
    insights.push({
      id: "proxima_temporada",
      type: "info",
      priority: 42,
      title: "Reposición de Temporada",
      message: `${metrics.proximaTemporada.frase} y tu stock de esa categoría está bajo — es buen momento para reponer.`,
      actionLabel: "Ver stock",
      href: "/stock",
    });
  }

  // 8. Oportunidad de venta cruzada.
  //
  // La regla era `ticketPromedio < $5.000`, un umbral en pesos fijos que la
  // inflación dejó muerto: el ticket de Evens es $36.172, así que hace rato
  // que no se dispara para nadie. Un número en pesos escrito en el código
  // envejece; una PROPORCIÓN no.
  //
  // Lo que se mide ahora es qué parte de los tickets se lleva UNA sola unidad
  // — la población sobre la que se puede hacer algo en el mostrador. Medido a
  // 60 días: Evens 55,6% y Estilo Bonito 41,9%.
  //
  // Y no promete plata. La versión vieja decía "tus ganancias crecerán";
  // cuánto deja convertir un ticket de uno en uno de dos NO sale de acá (es la
  // diferencia entre dos poblaciones distintas, no el valor de una conversión).
  // La tarjeta pone el hecho y la acción; el número lo da Insights cuando haya
  // con qué sostenerlo.
  //
  // Fail-closed por muestra, igual que el badge de ticket promedio: se afirma
  // "más de la mitad" solo si el extremo inferior del intervalo al 95% sigue
  // arriba del 50%. Con 23 tickets de una semana no alcanza; con 408 de un mes
  // sí.
  // Y AHORA SÍ hay con qué sostener el número: `composicion_ticket` devuelve
  // el margen de la prenda que se SUMA en un ticket de dos ($6.823 en Evens).
  // Ese es el único que se puede prometer, y no es la diferencia de ticket
  // promedio entre tickets de uno y de dos ($14.810): eso compara dos
  // poblaciones distintas, no el valor de una conversión.
  //
  // Cuando esa señal está, gana; si no (sin permiso gerencial), queda la
  // versión por unidades. Un solo id: dos tarjetas diciendo casi lo mismo es
  // peor que una.
  if (metrics.renglonAdicional) {
    const ra = metrics.renglonAdicional;
    insights.push({
      id: "upselling",
      type: "info",
      priority: 45,
      impacto: ra.margenPromedio * ra.ticketsDeUnRenglon,
      title: "Tickets de un solo renglón",
      message: `El ${pct(ra.pctDeUnRenglon, 0)}% de tus ventas se lleva un solo producto. Cada vez que sumás uno más, el que se agrega deja ${formatter.format(ra.margenPromedio)} de margen en promedio.`,
    });
  } else if (metrics.ticketsDeUnaUnidad !== undefined && metrics.ordenes > 0) {
    const proporcion = metrics.ticketsDeUnaUnidad / metrics.ordenes;
    const error = Math.sqrt((proporcion * (1 - proporcion)) / metrics.ordenes);
    const pisoDelIntervalo = proporcion - 1.96 * error;

    if (pisoDelIntervalo > 0.5) {
      insights.push({
        id: "upselling",
        type: "info",
        priority: 45,
        title: "Ventas de una sola unidad",
        message: `El ${pct(proporcion * 100, 0)}% de tus ventas se lleva un solo artículo. Ofrecer una segunda prenda en el mostrador es la palanca más directa que tenés: no necesita clientes nuevos.`,
      });
    }
  }

  // 9. Producto Estrella con rentabilidad destacada
  if (
    metrics.topProductosRentables.length > 0 &&
    metrics.topProductosRentables[0].ganancia > 0
  ) {
    const top = metrics.topProductosRentables[0];
    insights.push({
      id: "top_profitable",
      type: "success",
      priority: 40,
      title: "Producto Estrella",
      message: `"${top.nombre}" es tu producto más rentable (te dejó +${formatter.format(top.ganancia)} limpios). Dale prioridad en el escaparate o publícalo más seguido.`,
    });
  }

  // 10. Día fuerte de ventas.
  //
  // Pide muestra: `ventasPorDia` es por día de la semana y acumula solo el
  // período elegido, así que con el selector en Hoy tiene UNA entrada con el
  // 100% de los ingresos — superaba el 30% y disparaba siempre, afirmando un
  // patrón semanal a partir de un día. Y decía "Históricamente", que era falso:
  // no mira más historia que la ventana elegida. Con dos semanas cada día de la
  // semana ocurrió al menos dos veces.
  //
  // `ventas_por_momento` gana cuando está, porque trae el dato NORMALIZADO por
  // cuántos días de cada tipo hubo en el rango. Sin normalizar, comparar
  // sábados contra lunes en 60 días compara 9 sábados contra 8 lunes y la
  // diferencia incluye el calendario. Además dice las dos puntas, que es lo
  // que convierte el dato en una decisión de cuánta gente poner.
  if (metrics.momentoDelDia && metrics.momentoDelDia.ventasPorDiaFlojo > 0) {
    const m = metrics.momentoDelDia;
    const veces = m.ventasPorDiaFuerte / m.ventasPorDiaFlojo;

    if (veces >= 1.5) {
      insights.push({
        id: "best_day",
        type: "info",
        priority: 35,
        title: `Tu día fuerte es el ${m.diaFuerte.toLowerCase()}`,
        message: `El ${m.diaFuerte.toLowerCase()} hace ${pct(m.ventasPorDiaFuerte)} ventas por día y el ${m.diaFlojo.toLowerCase()} ${pct(m.ventasPorDiaFlojo)} — ${pct(veces)} veces más. Poné el personal y el cambio en consecuencia.`,
      });
    }
  } else if (
    metrics.diasDelPeriodo &&
    metrics.diasDelPeriodo >= MIN_DIAS_PARA_RITMO &&
    metrics.ventasPorDia &&
    metrics.ventasPorDia.length > 0
  ) {
    const bestDay = metrics.ventasPorDia[0];
    if (bestDay.value > metrics.ingresos * 0.3) {
      // Representa el 30% de los ingresos
      insights.push({
        id: "best_day",
        type: "info",
        priority: 35,
        title: `Día Pico: ${bestDay.label}`,
        message: `En este período, los ${bestDay.label}s concentran tu mayor volumen de facturación. Asegurá personal, stock y cambio en la caja desde la mañana.`,
      });
    }
  }

  /* =========================================================================
     4. FELICITACIONES (Señales Positivas) - Prioridad 1 a 29
     ========================================================================= */

  // Solo felicitamos si NO hay alertas graves o advertencias, para no "tapar" el fuego con confeti.
  const hasCriticalWarnings = insights.some(
    (i) => i.type === "danger" || i.type === "warning",
  );

  if (!hasCriticalWarnings) {
    if (metrics.margenPorcentaje > 30) {
      insights.push({
        id: "good_margin",
        type: "success",
        priority: 20,
        title: "Rentabilidad Saludable",
        message: `¡Excelente trabajo! Tu margen operativo está muy sano (${pct(metrics.margenPorcentaje)}%). Estás controlando muy bien tus gastos.`,
      });
    }

    // Acá vivía "Inventario Perfecto", que felicitaba cuando
    // `porcentajeBajas === 0`. Se sacó porque esa condición es SIEMPRE
    // verdadera y no por mérito del comercio: la tabla `bajas` tiene cero
    // filas en toda la base, y `createBajaAction` inserta siempre en estado
    // PENDIENTE sin que exista ningún camino que apruebe (get-movimientos-
    // stock.ts lee bajas 'APROBADA' que nada crea). O sea que felicitaba por
    // no tener pérdidas que el sistema no puede registrar aunque ocurran.
    //
    // Una felicitación falsa cuesta más que las demás tarjetas equivocadas:
    // enseña a no creerle al módulo. Vuelve el día que el circuito de bajas
    // tenga aprobación — ahí el cero SÍ va a significar algo.
  }

  // --- FILTRADO FINAL ---
  // Ordenamos de mayor prioridad a menor, y cortamos el array para que el dueño
  // solo lea los consejos MÁS importantes, evitando la fatiga de información.
  // Cuántos, lo decide la superficie: el banner de /reportes es un carrusel y
  // se queda con 3; la card del panel es una columna alta y pide 5.
  return insights
    .sort(
      (a, b) =>
        b.priority - a.priority || (b.impacto ?? 0) - (a.impacto ?? 0),
    )
    .slice(0, limite);
}
