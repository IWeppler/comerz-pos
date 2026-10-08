-- ─────────────────────────────────────────────────────────────────────────────
-- Alias para transferir, en el resumen público de cuenta corriente.
--
-- Pedido de Ignacio (8/10/2026): que la clienta pueda copiar el alias del
-- comercio (y el monto) desde el link de WhatsApp. No hay forma estándar de
-- abrir una transferencia con destinatario y monto cargados sin pasar por una
-- pasarela, así que es copiar y pegar. La clienta confirma mandando el
-- comprobante por WhatsApp; el cobro lo registra el comercio como siempre.
--
-- 1. `configuracion_pos.alias_transferencia`: alias (6 a 20 letras, números,
--    punto o guion) o CBU/CVU (22 dígitos). NULL = no se muestra. Espejo TS:
--    `validarAliasTransferencia`. Para anon nace cerrada (GRANT por columna):
--    sale SOLO por `resumen_cuenta_por_token`, a quien tiene el link.
-- 2. `resumen_cuenta_por_token` lo devuelve en `comercio.alias`. Reemplazo
--    sobre el cuerpo VIVO con guards, como 20261008190000.
-- Reversión: supabase/reversals/20261008200000_alias_transferencia_resumen_cc.sql
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.configuracion_pos
  add column alias_transferencia text
  constraint configuracion_pos_alias_transferencia_check
    check (
      alias_transferencia is null
      or alias_transferencia ~ '^[A-Za-z0-9.-]{6,20}$'
      or alias_transferencia ~ '^[0-9]{22}$'
    );

comment on column public.configuracion_pos.alias_transferencia is
  'Alias o CBU/CVU para que los clientes transfieran. Se muestra en el resumen público de cuenta corriente con botón de copiar. NULL = no se muestra.';

do $$
declare
  v_def text;
  v_nueva text;
  v_reemplazos text[][] := array[
    array[
      'select cp."posName" as pos_name, cp."posLogo" as pos_logo, cp.catalogo_activo,',
      'select cp."posName" as pos_name, cp."posLogo" as pos_logo, cp.catalogo_activo,'
        || E'\n         cp.alias_transferencia,'
    ],
    array[
      E'''logo'', nullif(btrim(coalesce(v_config.pos_logo, '''')), ''''),\n',
      E'''logo'', nullif(btrim(coalesce(v_config.pos_logo, '''')), ''''),\n'
        || E'      ''alias'', nullif(btrim(coalesce(v_config.alias_transferencia, '''')), ''''),\n'
    ]
  ];
  i int;
  v_veces int;
begin
  select pg_get_functiondef('public.resumen_cuenta_por_token(text)'::regprocedure)
    into v_def;
  v_nueva := v_def;

  for i in 1 .. array_length(v_reemplazos, 1) loop
    v_veces := (length(v_nueva) - length(replace(v_nueva, v_reemplazos[i][1], '')))
               / length(v_reemplazos[i][1]);
    if v_veces <> 1 then
      raise exception 'El reemplazo % matchea % veces (se esperaba 1): %',
        i, v_veces, v_reemplazos[i][1];
    end if;
    v_nueva := replace(v_nueva, v_reemplazos[i][1], v_reemplazos[i][2]);
  end loop;

  if v_nueva not like '%SECURITY DEFINER%'
     or v_nueva not like '%SET search_path TO ''public'', ''pg_temp''%'
     or v_nueva not like '%where c.resumen_token = p_token%' then
    raise exception 'La función perdió SECURITY DEFINER, su search_path o el filtro por token';
  end if;

  execute v_nueva;
end;
$$;

do $$
declare
  v_n int;
  v_out jsonb;
begin
  select count(*) into v_n from pg_proc
   where proname = 'resumen_cuenta_por_token' and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then
    raise exception 'Se esperaba una sola resumen_cuenta_por_token, hay %', v_n;
  end if;

  select public.resumen_cuenta_por_token(c.resumen_token) into v_out
    from public.clientes c
   where c.resumen_token is not null
   limit 1;
  if v_out is not null and not (v_out->'comercio' ? 'alias') then
    raise exception 'El resumen no trae alias: %', v_out->'comercio';
  end if;

  -- anon no lee la columna directo.
  if has_column_privilege('anon', 'public.configuracion_pos', 'alias_transferencia', 'SELECT') then
    raise exception 'anon puede leer alias_transferencia directo';
  end if;
end;
$$;
