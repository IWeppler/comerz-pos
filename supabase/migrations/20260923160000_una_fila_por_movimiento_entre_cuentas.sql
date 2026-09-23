-- ═══════════════════════════════════════════════════════════════════════════
-- MOVER PLATA ENTRE DOS CUENTAS PROPIAS ES UN SOLO MOVIMIENTO
--
-- El ledger es de partida doble: una transferencia y el ciclo del turno
-- escriben DOS filas con la misma `operacion_id`, una por cuenta, que suman
-- cero. Eso es correcto como bitácora y es ilegible como pantalla.
--
-- El caso que lo mostró (El Nono Cacho, 23/9/2026): cerraron a las 12:45 y
-- abrieron a las 16:49, y la Actividad de cuentas listaba CUATRO filas —un
-- egreso de la caja diaria y un ingreso a la caja grande, y al revés en la
-- apertura— para dos hechos. Peor que ilegible: cada pata se leía como un
-- ingreso o un gasto, cuando ahí no entró ni salió un peso del negocio.
-- "No se debe registrar ni como ingreso ni como egreso, sino como movimiento
-- de cuentas."
--
-- ───────────────────────────────────────────────────────────────────────────
-- QUÉ PATA SE MUESTRA, Y POR QUÉ SIEMPRE LA MISMA
--
-- Se queda la NEGATIVA: de dónde SALIÓ la plata. Es la que deja leer la fila
-- como una frase —"Caja Grande → Caja diaria"— y hace que la flecha apunte
-- siempre para el mismo lado, sin que el lector tenga que deducir la
-- dirección del signo.
--
-- Eso obligó a arreglar la contraparte, que hasta ahora salía de `datos`. En
-- una transferencia las dos patas guardan origen y destino, pero en el turno
-- **solo la pata de la caja general** guarda `cuenta_contraparte_id`: en la
-- apertura esa es la negativa (sale bien) y en el cierre es la positiva, o
-- sea que la fila que queda no tenía con qué dibujar la flecha. Ahora la
-- contraparte cae a buscar la OTRA pata de la misma `operacion_id`, que es
-- el dato de verdad y no depende de qué guardó cada RPC en su jsonb.
--
-- ───────────────────────────────────────────────────────────────────────────
-- LO QUE NO SE TOCA
--
-- * Con `p_cuenta_id` NO se colapsa nada. Ahí la pregunta es "qué movió ESTA
--   cuenta", y la pata que le corresponde a esa cuenta es justamente la que
--   se estaría escondiendo.
-- * Solo la vista CUENTAS. La tabla general (`COMPLETA`) es la bitácora
--   auditable: ahí las dos patas TIENEN que estar, y el saldo posterior de
--   cada cuenta depende de que estén.
-- * `ACREDITACION` queda fuera a propósito, aunque también tenga dos patas:
--   su pata negativa vive en el puente, que no es una cuenta del comercio
--   sino una sala de espera. Colapsarla mostraría "Dinero por acreditar →
--   Mercado Pago" como si alguien hubiera movido esa plata, y no la movió
--   nadie: venció una fecha. Es otra decisión y va aparte.
-- * El saldo posterior sigue saliendo del ledger ENTERO, antes de filtrar.
--   La fila que se esconde no cambia ningún saldo.
--
-- Se parchea sobre el cuerpo VIVO (`pg_get_functiondef` + `replace`), como
-- `20260921180000` y `20260922100000`: reescribir 9.000 caracteres desde un
-- archivo viejo es exactamente cómo `20260819180039` se llevó puestas dos
-- features que ya estaban aplicadas. Cada anclaje se verifica que aparezca
-- EXACTAMENTE una vez o la migración aborta.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_firma constant text :=
    'public.movimientos_financieros_negocio(timestamptz,timestamptz,uuid,text[],uuid,boolean,uuid,uuid,text,integer,integer,text)';
  v_def text := pg_get_functiondef(v_firma::regprocedure);
  v_ancla text;
  v_nuevo text;
begin
  -- ── 1. Se esconde la pata positiva de un movimiento de dos patas ────────
  v_ancla := '                              and c.tipo = ''CAJA_DIARIA''))';
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'GUARD: el filtro de la vista CUENTAS no aparece exactamente una vez';
  end if;

  v_nuevo := v_ancla || '
       -- Mover plata entre dos cuentas propias es UN movimiento, no dos. Se
       -- muestra la pata negativa (de dónde salió) y la otra se esconde. Con
       -- `p_cuenta_id` no se colapsa: ahí la pregunta es qué movió esa cuenta.
       and (not v_cuentas or p_cuenta_id is not null
            or l.origen_tipo not in (''TRANSFERENCIA'', ''TURNO_CAJA'')
            or l.importe < 0
            or not exists (select 1 from ledger o
                            where o.operacion_id = l.operacion_id
                              and o.id <> l.id
                              and o.cuenta_financiera_id <> l.cuenta_financiera_id
                              and o.importe < 0))';
  v_def := replace(v_def, v_ancla, v_nuevo);

  -- ── 2. La contraparte sale de la OTRA pata, no de `datos` ───────────────
  v_ancla := '       and cc.id <> l.cuenta_financiera_id';
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'GUARD: el join de la contraparte no aparece exactamente una vez';
  end if;

  v_nuevo := v_ancla || '
      -- `datos` no alcanza: en el ciclo del turno solo la pata de la caja
      -- general guarda `cuenta_contraparte_id`, así que la otra se quedaba
      -- sin flecha. La verdad es la OTRA pata de la misma operación.
      left join lateral (
        select c2.nombre
          from public.movimientos_financieros o
          join public.cuentas_financieras c2
            on c2.id = o.cuenta_financiera_id and c2.negocio_id = v_negocio
         where o.negocio_id = v_negocio
           and o.operacion_id = l.operacion_id
           and o.origen_tipo in (''TRANSFERENCIA'', ''TURNO_CAJA'')
           and o.cuenta_financiera_id <> l.cuenta_financiera_id
         limit 1
      ) par on true';
  v_def := replace(v_def, v_ancla, v_nuevo);

  v_ancla := 'cc.nombre as cuenta_contraparte_nombre';
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'GUARD: la columna de contraparte no aparece exactamente una vez';
  end if;
  v_def := replace(v_def, v_ancla,
                   'coalesce(cc.nombre, par.nombre) as cuenta_contraparte_nombre');

  execute v_def;
end $$;

-- La contraparte se busca por `operacion_id` una vez por fila de la página
-- (diez), y esa columna no tenía índice.
create index if not exists movimientos_financieros_operacion_idx
  on public.movimientos_financieros (negocio_id, operacion_id);

-- ───────────────────────────────────────────────────────────────────────────
-- GUARDS
--
-- Sobre el texto, y después EJECUTANDO: una función que solo se parsea puede
-- estar rota y no enterarse hasta que alguien abre la pantalla. Es la lección
-- de `20260922230225`, que dejó las dos vistas caídas en producción.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text := pg_get_functiondef(
    'public.movimientos_financieros_negocio(timestamptz,timestamptz,uuid,text[],uuid,boolean,uuid,uuid,text,integer,integer,text)'::regprocedure);
begin
  if position('p_cuenta_id is not null' in v_def) = 0 then
    raise exception 'GUARD: filtrando por cuenta NO se puede colapsar la contrapartida';
  end if;
  if position('coalesce(cc.nombre, par.nombre)' in v_def) = 0 then
    raise exception 'GUARD: la contraparte tiene que caer a la otra pata de la operación';
  end if;
  -- La bitácora completa conserva las dos patas: el colapso es solo de la
  -- vista CUENTAS y va atado a `v_cuentas`.
  if position('not v_cuentas or p_cuenta_id is not null' in v_def) = 0 then
    raise exception 'GUARD: el colapso se escapó de la vista CUENTAS';
  end if;
end $$;
