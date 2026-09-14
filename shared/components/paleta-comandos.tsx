"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Calculator,
  CreditCard,
  FileSliders,
  Globe,
  HandCoins,
  Keyboard,
  LayoutDashboard,
  Loader2,
  Package,
  Receipt,
  ScanBarcode,
  Settings,
  ShoppingCart,
  Store,
  Tag,
  Tags,
  Users,
  Wallet,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/shared/ui/command";
import { formatearMoneda } from "@/shared/utils/formatters";
import { usePaletaStore } from "@/shared/store/paleta-store";
import { normalizarBusqueda as normalizar } from "@/shared/lib/normalizar-busqueda";
import { useCobroCcStore } from "@/shared/store/cobro-cc-store";
import { useCajaModalStore } from "@/shared/store/caja-modal-store";
import {
  buscarGlobalAction,
  type ResultadosBusquedaGlobal,
} from "@/shared/actions/buscar-global";

const MINIMO_CARACTERES = 2;
/** Lo justo para que tipear "campera" no dispare siete búsquedas. */
const DEBOUNCE_MS = 220;

type PaletaComandosProps = {
  /** Permiso `clientes.cobrar_cc`. Sin él, el cobro no aparece como acción ni
   * como atajo en la fila de un cliente con deuda. */
  puedeCobrarCuentaCorriente?: boolean;
  /** Mismo criterio que el sidebar: Panel y Reportes son de ADMIN. */
  esAdmin?: boolean;
};

type Destino = {
  clave: string;
  etiqueta: string;
  href: string;
  Icono: typeof Store;
  soloAdmin?: boolean;
};

const DESTINOS: Destino[] = [
  {
    clave: "panel",
    etiqueta: "Panel",
    href: "/",
    Icono: LayoutDashboard,
    soloAdmin: true,
  },
  { clave: "vender", etiqueta: "Vender", href: "/pos", Icono: Store },
  {
    clave: "caja",
    etiqueta: "Caja y movimientos",
    href: "/caja",
    Icono: Wallet,
  },
  { clave: "stock", etiqueta: "Inventario", href: "/stock", Icono: Package },
  { clave: "ventas", etiqueta: "Ventas", href: "/ventas", Icono: ShoppingCart },
  { clave: "clientes", etiqueta: "Clientes", href: "/clientes", Icono: Users },
  {
    clave: "reportes",
    etiqueta: "Reportes",
    href: "/reportes",
    Icono: BarChart3,
    soloAdmin: true,
  },
  {
    clave: "configuracion",
    etiqueta: "Configuración",
    href: "/configuracion",
    Icono: Settings,
  },
];

/**
 * Las secciones de Configuración, para poder llegar directo.
 *
 * POR QUÉ ESTÁN ACÁ: Configuración es UNA ruta con once paneles adentro, y
 * hasta ahora la paleta solo conocía rutas. O sea que buscar "listas de
 * precios", "promociones" o "métodos de pago" no encontraba nada, y la única
 * forma de llegar era acordarse de que vivían adentro de Configuración y
 * bajar por el menú lateral. Buscar por el nombre de lo que se quiere hacer
 * es exactamente para lo que existe esta paleta.
 *
 * Cada una linkea con `?seccion=`, que `SettingsManager` lee para abrir
 * directo el panel correcto. Las claves son las mismas que las de SECTIONS
 * en ese archivo: si una cambia allá y no acá, el link cae en "Comercio" en
 * vez de romperse.
 */
const SECCIONES_CONFIG: Destino[] = [
  {
    clave: "listas-precios",
    etiqueta: "Listas de precios (mayorista)",
    href: "/configuracion?seccion=listasPrecios",
    Icono: Tags,
    soloAdmin: true,
  },
  {
    clave: "promociones",
    etiqueta: "Promociones y descuentos",
    href: "/configuracion?seccion=promociones",
    Icono: Tag,
  },
  {
    clave: "metodos-pago",
    etiqueta: "Métodos de pago",
    href: "/configuracion?seccion=pagos",
    Icono: CreditCard,
  },
  {
    clave: "categorias",
    etiqueta: "Categorías",
    href: "/configuracion?seccion=categoria",
    Icono: FileSliders,
  },
  {
    clave: "empleados",
    etiqueta: "Empleados y permisos",
    href: "/configuracion?seccion=empleados",
    Icono: Users,
    soloAdmin: true,
  },
  {
    clave: "catalogo-online",
    etiqueta: "Catálogo online",
    href: "/configuracion?seccion=catalogo",
    Icono: Globe,
  },
  {
    clave: "caja-turnos",
    etiqueta: "Caja y turnos",
    href: "/configuracion?seccion=caja",
    Icono: Calculator,
  },
  {
    clave: "ticket-config",
    etiqueta: "Ticket de venta",
    href: "/configuracion?seccion=ticketConfig",
    Icono: Receipt,
  },
];

/** Lo que se muestra en "Ver atajos". Es la lista real; si un atajo cambia,
 * cambia acá y nadie queda mintiendo. */
const ATAJOS: {
  teclas: string;
  que: string;
  soloConPermiso?: boolean;
  /** Los del POS solo andan en Vender; se muestran igual para que se sepa que
   * existen, con el "En Vender" adelante. */
  soloEnPos?: boolean;
}[] = [
  { teclas: "Ctrl + K", que: "Abrir esta paleta" },
  { teclas: "F2", que: "Cobrar cuenta corriente", soloConPermiso: true },
  { teclas: "F9", que: "Abrir o cerrar el turno de caja" },
  { teclas: "Esc", que: "Cerrar lo que esté abierto" },
  { teclas: "F", que: "Foco al buscador", soloEnPos: true },
  {
    teclas: "↑ ↓ ← →",
    que: "Moverse por los productos (en lista, solo ↑ ↓)",
    soloEnPos: true,
  },
  { teclas: "Enter", que: "Agregar el producto marcado", soloEnPos: true },
  {
    teclas: "Ctrl + Espacio",
    que: "Confirmar la carga rápida",
    soloEnPos: true,
  },
  {
    teclas: "Alt + 1…9",
    que: "Agregar el producto N de la grilla",
    soloEnPos: true,
  },
  {
    teclas: "Alt + ↑ / ↓",
    que: "Cantidad del último renglón",
    soloEnPos: true,
  },
  { teclas: "F8", que: "Carga rápida ↔ Vender", soloEnPos: true },
  { teclas: "F4", que: "Ir al paso de pago", soloEnPos: true },
  { teclas: "F7", que: "Elegir cliente", soloEnPos: true },
  {
    teclas: "1 / 2 / 3",
    que: "En el pago: venta común, cuenta corriente o reservado",
    soloEnPos: true,
  },
  {
    teclas: "Ctrl + Enter",
    que: "Ir al pago y, ahí, confirmar la venta",
    soloEnPos: true,
  },
  {
    teclas: "Ctrl + Shift + Borrar",
    que: "Vaciar el ticket",
    soloEnPos: true,
  },
];



/**
 * Paleta de comandos (Ctrl+K).
 *
 * Cuatro tipos de resultado en una sola lista: acciones, navegación, productos
 * y clientes. Los dos primeros son locales y aparecen al instante; los dos
 * últimos salen de `buscarGlobalAction`, debounceado.
 *
 * Se monta UNA vez, en el layout del panel. El atajo se escucha en `window` y
 * funciona con el foco en cualquier input —incluido el buscador del POS—
 * porque es el único que no se confunde con tipear.
 *
 * Un producto NO se agrega al ticket desde acá: navega al POS con la búsqueda
 * puesta. Con talles y colores, elegir la variante es una decisión que ya tiene
 * su pantalla, y saltearla sería agregar al carrito la variante equivocada.
 */
export function PaletaComandos({
  puedeCobrarCuentaCorriente = false,
  esAdmin = false,
}: Readonly<PaletaComandosProps>) {
  const router = useRouter();
  const abierta = usePaletaStore((s) => s.abierta);
  const alternar = usePaletaStore((s) => s.alternar);
  const abrirPaleta = usePaletaStore((s) => s.abrir);
  const cerrarPaleta = usePaletaStore((s) => s.cerrar);

  const abrirCobroCc = useCobroCcStore((s) => s.abrir);
  const abrirModalCaja = useCajaModalStore((s) => s.abrir);

  const [consulta, setConsulta] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [verAtajos, setVerAtajos] = useState(false);
  const [resultados, setResultados] = useState<ResultadosBusquedaGlobal>({
    productos: [],
    clientes: [],
  });

  // Los atajos globales viven acá, en el mismo componente que la lista que los
  // muestra: un atajo que se agrega en un archivo y se documenta en otro es un
  // atajo que en algún momento va a estar mal escrito en la ayuda.
  //
  // `preventDefault` en Ctrl+K es lo que evita que Chrome se lo lleve a la
  // barra de direcciones cuando la app corre en una pestaña común en vez de
  // instalada. F2 y F9 no las reclama el navegador, pero igual se frenan para
  // que no lleguen a un input que las esté escuchando.
  useEffect(() => {
    const alPresionar = (evento: KeyboardEvent) => {
      // `key` puede venir undefined: Chrome en Windows despacha keydown
      // sintéticos sin `key` desde el autocompletado y algunas extensiones
      // (gestores de contraseñas). Visto el 14/9/2026 en /configuracion como
      // "Cannot read properties of undefined (reading 'toLowerCase')". Este
      // listener es global al panel, así que el crash era en cualquier pantalla.
      const tecla = evento.key?.toLowerCase();
      const esCtrlK = tecla === "k" && (evento.ctrlKey || evento.metaKey);

      if (esCtrlK) {
        evento.preventDefault();
        alternar();
        return;
      }

      // Con la paleta abierta, las teclas son de la paleta: F2 adentro de ella
      // abriría el cobro por atrás del diálogo.
      if (abierta) return;

      if (evento.key === "F2" && puedeCobrarCuentaCorriente) {
        evento.preventDefault();
        abrirCobroCc();
        return;
      }

      if (evento.key === "F9") {
        evento.preventDefault();
        abrirModalCaja();
      }
    };

    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [
    alternar,
    abierta,
    puedeCobrarCuentaCorriente,
    abrirCobroCc,
    abrirModalCaja,
  ]);

  // La búsqueda va debounceada y con la respuesta vieja descartada: sin el
  // `vigente`, una consulta lenta de "ca" puede pisar los resultados de
  // "campera" y mostrar lo que no se buscó.
  useEffect(() => {
    if (!abierta) return;

    const patron = consulta.trim();

    if (patron.length < MINIMO_CARACTERES) {
      const limpiar = setTimeout(() => {
        setResultados({ productos: [], clientes: [] });
        setBuscando(false);
      }, 0);
      return () => clearTimeout(limpiar);
    }

    let vigente = true;

    const temporizador = setTimeout(async () => {
      setBuscando(true);
      try {
        const datos = await buscarGlobalAction(patron);
        if (vigente) setResultados(datos);
      } finally {
        if (vigente) setBuscando(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
  }, [consulta, abierta]);

  const cerrarYLimpiar = () => {
    setConsulta("");
    setVerAtajos(false);
    setResultados({ productos: [], clientes: [] });
    cerrarPaleta();
  };

  const ejecutar = (accion: () => void) => {
    cerrarYLimpiar();
    accion();
  };

  const patronNormalizado = normalizar(consulta.trim());
  const coincide = (texto: string) =>
    !patronNormalizado || normalizar(texto).includes(patronNormalizado);

  const destinos = useMemo(
    () =>
      [...DESTINOS, ...SECCIONES_CONFIG]
        .filter((d) => (d.soloAdmin ? esAdmin : true))
        .filter((d) => coincide(d.etiqueta)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [esAdmin, patronNormalizado],
  );

  const acciones = [
    ...(puedeCobrarCuentaCorriente
      ? [
          {
            clave: "cobrar-cc",
            etiqueta: "Cobrar cuenta corriente",
            atajo: "F2",
            Icono: HandCoins,
            correr: () => abrirCobroCc(),
          },
        ]
      : []),
    {
      clave: "turno",
      etiqueta: "Abrir o cerrar el turno de caja",
      atajo: "F9",
      Icono: Wallet,
      correr: () => abrirModalCaja(),
    },
    {
      clave: "carga-rapida",
      etiqueta: "Carga rápida de mercadería",
      atajo: "",
      Icono: ScanBarcode,
      correr: () => router.push("/stock/carga-rapida"),
    },
  ].filter((a) => coincide(a.etiqueta));

  const { productos, clientes } = resultados;
  const hayAlgo =
    destinos.length > 0 ||
    acciones.length > 0 ||
    productos.length > 0 ||
    clientes.length > 0;

  return (
    <CommandDialog
      open={abierta}
      onOpenChange={(siguiente) =>
        siguiente ? abrirPaleta() : cerrarYLimpiar()
      }
      title="Buscador global"
      description="Buscá productos, clientes, pantallas y acciones."
      className="sm:max-w-150"
    >
      {/* `shouldFilter={false}`: navegación y acciones se filtran acá arriba y
          productos y clientes ya vienen filtrados por la base. Dejar que cmdk
          filtre además esconde resultados que el server sí devolvió — su
          matching corre contra el `value` de cada ítem, que acá es un id. */}
      <Command shouldFilter={false} loop>
        <CommandInput
          placeholder="Buscar productos, clientes, pantallas…"
          value={consulta}
          onValueChange={(valor) => {
            setConsulta(valor);
            setVerAtajos(false);
          }}
        />

        <CommandList>
          {verAtajos ? (
            <CommandGroup heading="Atajos de teclado">
              {ATAJOS.filter(
                (a) => !a.soloConPermiso || puedeCobrarCuentaCorriente,
              ).map((a) => (
                <CommandItem
                  key={a.teclas}
                  value={a.teclas}
                  onSelect={() => undefined}
                >
                  <Keyboard className="text-muted-foreground" />
                  <span>
                    {a.soloEnPos && (
                      <span className="text-muted-foreground">En Vender: </span>
                    )}
                    {a.que}
                  </span>
                  <CommandShortcut>{a.teclas}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : (
            <>
              {!hayAlgo && !buscando && (
                <CommandEmpty>
                  {consulta.trim().length < MINIMO_CARACTERES
                    ? "Escribí al menos 2 letras para buscar productos y clientes."
                    : "Sin resultados."}
                </CommandEmpty>
              )}

              {acciones.length > 0 && (
                <CommandGroup heading="Acciones">
                  {acciones.map(({ clave, etiqueta, atajo, Icono, correr }) => (
                    <CommandItem
                      key={clave}
                      value={`accion-${clave}`}
                      onSelect={() => ejecutar(correr)}
                    >
                      <Icono className="text-muted-foreground" />
                      <span>{etiqueta}</span>
                      {atajo && <CommandShortcut>{atajo}</CommandShortcut>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {destinos.length > 0 && (
                <CommandGroup heading="Ir a">
                  {destinos.map(({ clave, etiqueta, href, Icono }) => (
                    <CommandItem
                      key={clave}
                      value={`ir-${clave}`}
                      onSelect={() => ejecutar(() => router.push(href))}
                    >
                      <Icono className="text-muted-foreground" />
                      <span>{etiqueta}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {productos.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Productos">
                    {productos.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={`producto-${p.id}`}
                        onSelect={() =>
                          ejecutar(() =>
                            router.push(
                              `/pos?q=${encodeURIComponent(p.nombre)}`,
                            ),
                          )
                        }
                      >
                        <Package className="text-muted-foreground" />
                        <span className="truncate">{p.nombre}</span>
                        <CommandShortcut>
                          {formatearMoneda(p.precio)}
                        </CommandShortcut>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {clientes.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Clientes">
                    {clientes.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`cliente-${c.id}`}
                        onSelect={() =>
                          ejecutar(() => router.push("/clientes"))
                        }
                      >
                        <Users className="text-muted-foreground" />
                        <span className="truncate">{c.nombre}</span>
                        {c.saldo > 0 && (
                          <CommandShortcut className="text-danger">
                            Debe {formatearMoneda(c.saldo)}
                          </CommandShortcut>
                        )}
                      </CommandItem>
                    ))}

                    {/* El cobro va como fila propia y no como acción secundaria
                      de la fila del cliente: en una lista que se maneja con
                      flechas y Enter, dos acciones en un mismo renglón son dos
                      resultados posibles para la misma tecla. */}
                    {puedeCobrarCuentaCorriente &&
                      clientes
                        .filter((c) => c.saldo > 0)
                        .map((c) => (
                          <CommandItem
                            key={`cobrar-${c.id}`}
                            value={`cobrar-${c.id}`}
                            onSelect={() => ejecutar(() => abrirCobroCc(c.id))}
                          >
                            <HandCoins className="text-primary" />
                            <span className="truncate">
                              Cobrarle a {c.nombre}
                            </span>
                            <CommandShortcut>
                              {formatearMoneda(c.saldo)}
                            </CommandShortcut>
                          </CommandItem>
                        ))}
                  </CommandGroup>
                </>
              )}

              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="ver-atajos"
                  onSelect={() => setVerAtajos(true)}
                >
                  <Keyboard className="text-muted-foreground" />
                  <span>Ver atajos de teclado</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>

        {buscando && (
          <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Buscando…
          </div>
        )}
      </Command>
    </CommandDialog>
  );
}
