"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Lock, MapPin, Plus, Store } from "lucide-react";
import { useCartStore } from "@/shared/store/cart-store";
import { createPublicBrowserClient } from "@/shared/config/supabase/client";
import { useLinkCatalogo, useSlugNegocio } from "@/shared/lib/use-negocio";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import type { ConfiguracionPOS } from "@/entities/config/types";
import type { PromocionDB } from "@/shared/components/cart-sidebar/types";
import {
  generarLinkWhatsAppPublico,
  type ModalidadEntregaPublica,
} from "@/shared/components/cart-sidebar/cart-sidebar-utils";
import { COLUMNAS_CONFIG_PUBLICA } from "@/shared/lib/columnas-publicas";
import type { OpcionPagoPublica } from "@/shared/lib/opciones-pago-publicas";
import { calcularTotalesPedido } from "@/shared/lib/totales-pedido-publico";
import { slugify } from "@/shared/utils/slugify";
import { BOTON_CATALOGO } from "../../lib/estilos-catalogo";
import { CHECKOUT_MP_DISPONIBLE } from "../../lib/checkout-mp-disponible";
import {
  MENSAJE_SIN_PAGO_ONLINE,
  motivoSinPagoOnline,
  normalizarCelular,
  opcionesConPagoOnline,
} from "../../lib/orden-tienda";
import { crearOrdenTiendaAction } from "../../actions/crear-orden-tienda";
import { useDescuentosPago } from "../descuentos-pago-provider";
import { CuponCatalogo } from "../cupon-catalogo";
import { ProgresoEnvioGratis } from "../progreso-envio-gratis";
import { MediosPagoCheckout, claveOpcionPago } from "./medios-pago-checkout";
import { OpcionRadio } from "./opcion-radio";
import { ResumenCheckout } from "./resumen-checkout";
import { pesos } from "./formato";

const subscribe = () => () => {};

// El resumen se dibuja UNA vez (arriba en el celular, a la derecha en compu):
// dos copias montadas duplicarían el campo del cupón y su estado.
const CONSULTA_COMPU = "(min-width: 1024px)";
const suscribirAncho = (avisar: () => void) => {
  const consulta = window.matchMedia(CONSULTA_COMPU);
  consulta.addEventListener("change", avisar);
  return () => consulta.removeEventListener("change", avisar);
};

type Campo = "nombre" | "celular" | "localidad" | "direccion" | "pago";

interface EnvioInfo {
  tipo: "LOCAL" | "LEJOS";
  costo?: number;
  mensaje?: string;
}

/**
 * El checkout del catálogo: `<tienda>/checkout`, una página propia como la de
 * cualquier tienda online (Tiendanube, Shopify), no un paso del panel lateral.
 *
 * Contacto → Entrega → Pago → UN botón, con el resumen del pedido siempre a
 * mano: a la derecha en compu, desplegable arriba en el celular. El panel
 * lateral quedó solo como carrito.
 *
 * Los totales salen de UN lugar (`calcularTotalesPedido`), el mismo que usa el
 * mensaje de WhatsApp; el server los recalcula igual desde la base al crear la
 * orden y, si no coinciden, no crea nada.
 */
export function CheckoutPublico({ numeroWhatsApp }: Readonly<{ numeroWhatsApp?: string }>) {
  const montado = useSyncExternalStore(subscribe, () => true, () => false);
  const esCompu = useSyncExternalStore(suscribirAncho, () => window.matchMedia(CONSULTA_COMPU).matches, () => false);
  const router = useRouter();
  const linkCatalogo = useLinkCatalogo();
  const slugNegocio = useSlugNegocio();
  const supabase = useMemo(() => createPublicBrowserClient(slugNegocio), [slugNegocio]);

  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const cuponGuardado = useCartStore((s) => s.cuponCatalogo);
  const setCupon = useCartStore((s) => s.setCuponCatalogo);

  const [branding, setBranding] = useState<ConfiguracionPOS | null>(null);
  const [nombre, setNombre] = useState("");
  const [celular, setCelular] = useState("");
  const [modalidad, setModalidad] = useState<ModalidadEntregaPublica>("RETIRO");
  const [localidad, setLocalidad] = useState("");
  const [direccion, setDireccion] = useState("");
  const [nota, setNota] = useState("");
  const [notaAbierta, setNotaAbierta] = useState(false);
  const [opcionPago, setOpcionPago] = useState<OpcionPagoPublica | null>(null);
  const [errores, setErrores] = useState<Partial<Record<Campo, string>>>({});
  const [sitio, setSitio] = useState(""); // campo trampa
  const [enviando, setEnviando] = useState(false);
  // Mensaje mientras se navega a MP o a la orden. Va ANTES de vaciar el
  // carrito: si no, la página re-renderiza "Tu carrito está vacío" mientras
  // la página de la orden todavía carga.
  const [saliendo, setSaliendo] = useState<string | null>(null);
  const [errorOrden, setErrorOrden] = useState<string | null>(null);
  // Un id por intento: si la respuesta se pierde y se vuelve a tocar el botón,
  // el server devuelve la misma orden en vez de apartar el stock dos veces.
  const [idOrden] = useState(() => crypto.randomUUID());

  // Uno por uno y no en un objeto: leer `refs.x` en el render es lo que marca
  // la regla react-hooks/refs.
  const refNombre = useRef<HTMLInputElement>(null);
  const refCelular = useRef<HTMLInputElement>(null);
  const refLocalidad = useRef<HTMLInputElement>(null);
  const refDireccion = useRef<HTMLInputElement>(null);
  const refPago = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Promise.resolve(supabase.from("configuracion_pos").select(COLUMNAS_CONFIG_PUBLICA).single()).then(
      ({ data }) => {
        if (data) setBranding(data as ConfiguracionPOS);
      },
    );
  }, [supabase]);

  const { promociones: promocionesDB, opcionesPago: opcionesBase, opcionesOnline } = useDescuentosPago();
  const cupon = cuponGuardado?.slug === slugNegocio ? cuponGuardado : null;
  const promociones = useMemo(() => (cupon ? [...promocionesDB, cupon.promocion] : promocionesDB), [cupon, promocionesDB]);

  // El cupón guardado se revalida al entrar: no conserva usos o fechas viejos.
  const codigoGuardado = cupon?.codigo;
  useEffect(() => {
    if (!codigoGuardado || !slugNegocio) return;
    let vigente = true;
    void Promise.resolve(supabase.rpc("validar_cupon_catalogo", { p_codigo: codigoGuardado }))
      .then(({ data, error }) => {
        if (!vigente) return;
        if (error || !data) setCupon(null);
        else setCupon({ slug: slugNegocio, codigo: codigoGuardado, promocion: { ...(data as PromocionDB), codigo: codigoGuardado } });
      })
      .catch(() => {
        if (vigente) setCupon(null);
      });
    return () => {
      vigente = false;
    };
  }, [codigoGuardado, slugNegocio, supabase, setCupon]);

  const envioInfo: EnvioInfo | null = useMemo(() => {
    if (modalidad !== "ENVIO" || localidad.trim() === "") return null;
    const localidadNegocio = branding?.localidad_negocio?.trim() || "";
    if (localidadNegocio !== "" && slugify(localidad) === slugify(localidadNegocio)) {
      return { tipo: "LOCAL", costo: Number(branding?.envio_costo_local) || 0 };
    }
    return {
      tipo: "LEJOS",
      mensaje: branding?.envio_mensaje_lejos || "El envío se coordina con la tienda por WhatsApp.",
    };
  }, [modalidad, localidad, branding]);
  const costoEnvio = envioInfo?.tipo === "LOCAL" ? envioInfo.costo || 0 : 0;

  const motivoSinOnline = motivoSinPagoOnline({ items, destinoEnvio: envioInfo?.tipo });
  const opcionesPago = useMemo(
    () =>
      opcionesConPagoOnline(opcionesBase, opcionesOnline, {
        disponible: motivoSinOnline === null,
        incluirMercadoPago: CHECKOUT_MP_DISPONIBLE,
      }),
    [opcionesBase, opcionesOnline, motivoSinOnline],
  );
  const cobraOnline = opcionesPago.some((o) => o.online);
  const hayPagoOnlineEnComercio =
    opcionesOnline.transferencia || (opcionesOnline.mercadopago && CHECKOUT_MP_DISPONIBLE);
  // Una opción que dejó de existir (cambió la entrega) no está elegida: un
  // total calculado con un medio que ya no se ofrece mentiría.
  const opcionElegida =
    opcionPago && opcionesPago.some((o) => claveOpcionPago(o) === claveOpcionPago(opcionPago)) ? opcionPago : null;

  const totalesCon = (opcion: OpcionPagoPublica | null) =>
    calcularTotalesPedido({
      items,
      promociones,
      opcionPago: opcion,
      costoEnvio,
      configEnvio: branding,
      destinoEnvio: envioInfo?.tipo,
    });
  const totales = totalesCon(opcionElegida);
  const totalPorOpcion = new Map(opcionesPago.map((o) => [claveOpcionPago(o), totalesCon(o).total]));
  const totalSinMedio = totalesCon(null).total;

  if (!montado) return <EsqueletoCheckout />;

  if (saliendo) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        {saliendo}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-4 py-20 text-center">
        <p className="text-lg font-semibold">Tu carrito está vacío</p>
        <p className="mt-2 text-sm text-muted-foreground">Agregá productos para finalizar la compra.</p>
        <Button asChild className={`mt-6 h-12 w-full ${BOTON_CATALOGO}`}>
          <Link href={linkCatalogo()}>Volver a la tienda</Link>
        </Button>
      </div>
    );
  }

  const cuponAplicado = !!cupon && totales.promosAplicadas.some((p) => p.id === cupon.promocion.id);
  const descuentoCupon = cuponAplicado
    ? (totales.descuentosPorPromocion?.find((d) => d.id === cupon!.promocion.id)?.monto ?? 0)
    : 0;
  const faltaCupon = cupon ? Math.max(0, cupon.promocion.monto_minimo - totales.subtotal) : 0;
  const avisoCupon =
    faltaCupon > 0
      ? `Te faltan ${pesos(faltaCupon)} para usar ${cupon!.codigo}`
      : cupon && !cuponAplicado
        ? "El descuento se confirma al elegir cómo pagás; se aplica la mejor promoción."
        : undefined;
  const aplicarCupon = async (codigo: string) => {
    const { data, error } = await supabase.rpc("validar_cupon_catalogo", { p_codigo: codigo });
    if (error) throw error;
    if (!data || !slugNegocio) return false;
    setCupon({ slug: slugNegocio, codigo, promocion: { ...(data as PromocionDB), codigo } });
    return true;
  };
  const campoCupon = (
    <CuponCatalogo
      codigo={cupon?.codigo}
      monto={descuentoCupon}
      aviso={avisoCupon}
      onAplicar={aplicarCupon}
      onQuitar={() => setCupon(null)}
    />
  );
  const progresoEnvio =
    modalidad === "ENVIO" ? (
      <ProgresoEnvioGratis
        items={items}
        base={totales.subtotal - (totales.descuento?.monto ?? 0)}
        config={branding}
        destino={envioInfo?.tipo}
      />
    ) : null;

  const esPagoOnline = !!opcionElegida?.online;
  const esMercadoPago = opcionElegida?.online === "MP_CHECKOUT" || opcionElegida?.online === "MP_CREDITO";

  const validar = (): Campo | null => {
    const nuevos: Partial<Record<Campo, string>> = {
      nombre: nombre.trim() === "" ? "Completá tu nombre." : undefined,
      celular:
        cobraOnline && !normalizarCelular(celular) ? "Poné tu celular con código de área, sin 0 ni 15." : undefined,
      localidad: modalidad === "ENVIO" && localidad.trim() === "" ? "Completá tu localidad." : undefined,
      direccion: modalidad === "ENVIO" && direccion.trim() === "" ? "Completá la dirección." : undefined,
      pago: opcionesPago.length > 0 && !opcionElegida ? "Elegí cómo vas a pagar." : undefined,
    };
    setErrores(nuevos);
    const orden: Campo[] = ["nombre", "celular", "localidad", "direccion", "pago"];
    return orden.find((c) => nuevos[c]) ?? null;
  };

  const medir = (total: number, pago: string, envioACoordinar: boolean) =>
    void Promise.resolve(
      supabase.rpc("registrar_pedido_catalogo", {
        p_total: total,
        p_renglones: items.length,
        p_unidades: items.reduce((suma, item) => suma + item.cantidad, 0),
        p_modalidad: modalidad,
        p_pago: pago,
        p_envio_a_coordinar: envioACoordinar,
        p_cupon: cuponAplicado ? cupon?.codigo : null,
        p_envio_gratis: totales.envio?.etiqueta === "Envío gratis",
        p_items_sugeridos: items.filter((i) => i.sugeridoCatalogo).length,
      }),
    ).catch(() => {});

  const finalizar = () => {
    const faltante = validar();
    if (faltante) {
      const destino = {
        nombre: refNombre,
        celular: refCelular,
        localidad: refLocalidad,
        direccion: refDireccion,
        pago: refPago,
      }[faltante].current;
      destino?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (faltante === "pago") destino?.querySelector<HTMLElement>("[role=radio]")?.focus({ preventScroll: true });
      else (destino as HTMLInputElement | null)?.focus({ preventScroll: true });
      return;
    }
    if (esPagoOnline) {
      void confirmarOrden();
      return;
    }

    const envioACoordinar = envioInfo?.tipo === "LEJOS" && totales.envio?.etiqueta !== "Envío gratis";
    const href = generarLinkWhatsAppPublico({
      numeroWhatsApp,
      nombreComercio: branding?.posName,
      items,
      totales,
      etiquetaPago: opcionElegida?.etiqueta ?? "A coordinar",
      nombreCliente: nombre,
      modalidad,
      direccion,
      localidad,
      envioACoordinar,
      nota,
    });
    if (href === "#") return;
    medir(totales.total, opcionElegida?.etiqueta ?? "A coordinar", envioACoordinar);
    // Sincrónico dentro del click: después de un await el navegador lo bloquea.
    window.open(href, "_blank", "noopener,noreferrer");
    clearCart();
    router.push(linkCatalogo());
  };

  const confirmarOrden = async () => {
    const medio = opcionElegida?.online;
    if (enviando || !medio) return;
    setEnviando(true);
    setErrorOrden(null);
    try {
      const r = await crearOrdenTiendaAction({
        idOrden,
        items,
        medio,
        nombre,
        celular,
        modalidad,
        localidad,
        direccion,
        nota,
        cupon: cupon?.codigo ?? null,
        totalVisto: totales.total,
        sitio,
      });
      if (!r.ok) {
        setErrorOrden(r.error);
        return;
      }
      medir(r.orden.total, `${opcionElegida?.etiqueta ?? "Online"} (online)`, false);
      const paginaOrden = linkCatalogo(`orden/${r.orden.token}`);
      if (r.orden.medio !== "TRANSFERENCIA" && r.orden.initPoint) {
        // Misma pestaña: no es un popup, el navegador no lo bloquea.
        setSaliendo("Te estamos llevando a Mercado Pago…");
        clearCart();
        window.location.assign(r.orden.initPoint);
        return;
      }
      // Transferencia (o MP que no abrió): la página de la orden es el
      // comprobante, con los datos para transferir o "Pagar con Mercado Pago".
      setSaliendo("¡Pedido realizado! Preparando tu comprobante…");
      router.push(paginaOrden);
      clearCart();
    } catch {
      setErrorOrden("No pudimos confirmar tu pedido. Revisá tu conexión y probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  const textoBoton = !opcionElegida
    ? "Finalizar compra"
    : esMercadoPago
      ? `Pagar ${pesos(totales.total)}`
      : esPagoOnline
        ? "Confirmar pedido"
        : "Enviar pedido por WhatsApp";

  const resumen = (
    <ResumenCheckout items={items} totales={totales} cupon={campoCupon} extra={progresoEnvio} retiro={modalidad === "RETIRO"} />
  );

  return (
    <div className="w-full flex-1">
      {/* Celular: el resumen arriba, cerrado, con el total a la vista. */}
      <details className="group border-b border-border bg-muted/40 lg:hidden">
        <summary className="mx-auto flex min-h-14 max-w-xl cursor-pointer list-none items-center justify-between px-4 text-sm [&::-webkit-details-marker]:hidden">
          <span className="font-medium underline-offset-4 group-open:hidden">
            Ver resumen ({items.length})
          </span>
          <span className="hidden font-medium group-open:inline">Ocultar resumen</span>
          <span className="text-base font-bold">{pesos(totales.total)}</span>
        </summary>
        <div className="mx-auto max-w-xl px-4 pb-5">{!esCompu && resumen}</div>
      </details>

      <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:py-10">
        <div className="min-w-0 space-y-8">
          <Link
            href={linkCatalogo()}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Seguir comprando
          </Link>

          <Seccion titulo="Contacto">
            <CampoTexto id="checkout-nombre" etiqueta="Nombre y apellido" error={errores.nombre}>
              <Input
                id="checkout-nombre"
                ref={refNombre}
                value={nombre}
                onChange={(e) => {
                  setNombre(e.target.value);
                  setErrores((p) => ({ ...p, nombre: undefined }));
                }}
                autoComplete="name"
                aria-invalid={!!errores.nombre}
                className="h-12"
              />
            </CampoTexto>
            {cobraOnline && (
              <CampoTexto
                id="checkout-celular"
                etiqueta="Celular"
                ayuda="Para avisarte cuando tu pedido esté listo."
                error={errores.celular}
              >
                <Input
                  id="checkout-celular"
                  ref={refCelular}
                  value={celular}
                  onChange={(e) => {
                    setCelular(e.target.value);
                    setErrores((p) => ({ ...p, celular: undefined }));
                  }}
                  placeholder="Ej: 11 5470 2118"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  aria-invalid={!!errores.celular}
                  className="h-12"
                />
              </CampoTexto>
            )}
          </Seccion>

          <Seccion titulo="Entrega">
            <div role="radiogroup" aria-label="Entrega" className="overflow-hidden rounded-xl border border-border">
              <OpcionRadio
                activa={modalidad === "RETIRO"}
                onElegir={() => setModalidad("RETIRO")}
                icono={<Store className="h-5 w-5" />}
                titulo="Retiro en el local"
                detalle={branding?.direccion_visible !== false && branding?.direccion ? branding.direccion : undefined}
                derecha="Gratis"
              />
              <OpcionRadio
                activa={modalidad === "ENVIO"}
                onElegir={() => setModalidad("ENVIO")}
                icono={<MapPin className="h-5 w-5" />}
                titulo="Envío a domicilio"
                detalle={
                  branding?.localidad_negocio
                    ? `En ${branding.localidad_negocio}${Number(branding?.envio_costo_local) > 0 ? `: ${pesos(Number(branding.envio_costo_local))}` : ""}. Fuera de ahí, a coordinar.`
                    : undefined
                }
              >
                {modalidad === "ENVIO" && (
                  <div className="space-y-3 pt-3">
                    <CampoTexto id="checkout-localidad" etiqueta="Localidad" error={errores.localidad}>
                      <Input
                        id="checkout-localidad"
                        ref={refLocalidad}
                        value={localidad}
                        onChange={(e) => {
                          setLocalidad(e.target.value);
                          setErrores((p) => ({ ...p, localidad: undefined }));
                        }}
                        autoComplete="address-level2"
                        aria-invalid={!!errores.localidad}
                        className="h-12 bg-background"
                      />
                    </CampoTexto>
                    <CampoTexto id="checkout-direccion" etiqueta="Calle y número" error={errores.direccion}>
                      <Input
                        id="checkout-direccion"
                        ref={refDireccion}
                        value={direccion}
                        onChange={(e) => {
                          setDireccion(e.target.value);
                          setErrores((p) => ({ ...p, direccion: undefined }));
                        }}
                        autoComplete="street-address"
                        aria-invalid={!!errores.direccion}
                        className="h-12 bg-background"
                      />
                    </CampoTexto>
                    {envioInfo?.tipo === "LEJOS" && totales.envio?.etiqueta !== "Envío gratis" && (
                      <p className="text-xs text-warning">{envioInfo.mensaje}</p>
                    )}
                  </div>
                )}
              </OpcionRadio>
            </div>
          </Seccion>

          <Seccion
            titulo="Pago"
            subtitulo={cobraOnline ? "Pagás de forma segura con Mercado Pago o por transferencia." : undefined}
          >
            {opcionesPago.length > 0 ? (
              <MediosPagoCheckout
                ref={refPago}
                opciones={opcionesPago}
                elegida={opcionElegida}
                onElegir={(o) => {
                  setOpcionPago(o);
                  setErrorOrden(null);
                  setErrores((p) => ({ ...p, pago: undefined }));
                }}
                totalPorOpcion={totalPorOpcion}
                totalSinMedio={totalSinMedio}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Coordinás el pago con la tienda por WhatsApp.</p>
            )}
            {errores.pago && <p className="text-xs font-medium text-danger">{errores.pago}</p>}
            {hayPagoOnlineEnComercio && motivoSinOnline && (
              <p className="text-xs text-muted-foreground">{MENSAJE_SIN_PAGO_ONLINE[motivoSinOnline]}</p>
            )}
          </Seccion>

          {notaAbierta ? (
            <CampoTexto id="checkout-nota" etiqueta="Nota para la tienda">
              <Textarea
                id="checkout-nota"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </CampoTexto>
          ) : (
            <button
              type="button"
              onClick={() => setNotaAbierta(true)}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> Agregar una nota
            </button>
          )}

          {/* Campo trampa: una persona no lo ve; un bot que llena todo, sí. */}
          <input
            type="text"
            name="sitio"
            value={sitio}
            onChange={(e) => setSitio(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute left-[-9999px] h-0 w-0 opacity-0"
          />

          <div className="space-y-3">
            {errorOrden && (
              <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm font-medium text-danger">
                {errorOrden}
              </p>
            )}
            <Button
              type="button"
              onClick={finalizar}
              disabled={enviando}
              className={`flex h-14 w-full items-center justify-center gap-2 text-base font-semibold ${BOTON_CATALOGO}`}
            >
              {enviando ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : opcionElegida && !esPagoOnline ? (
                <Image src="/whatsappp.png" alt="" width={20} height={20} />
              ) : null}
              {textoBoton}
            </Button>
            {esPagoOnline && (
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                {esMercadoPago
                  ? "Vas a pagar en Mercado Pago y volvés acá."
                  : "Tus productos quedan reservados mientras transferís."}
              </p>
            )}
          </div>
        </div>

        {/* Compu: el resumen a la derecha, quieto mientras se completa. */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 rounded-2xl border border-border bg-muted/40 p-5">{esCompu && resumen}</div>
        </aside>
      </div>
    </div>
  );
}

function Seccion({
  titulo,
  subtitulo,
  children,
}: Readonly<{ titulo: string; subtitulo?: string; children: React.ReactNode }>) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{titulo}</h2>
        {subtitulo && <p className="text-sm text-muted-foreground">{subtitulo}</p>}
      </div>
      {children}
    </section>
  );
}

function CampoTexto({
  id,
  etiqueta,
  ayuda,
  error,
  children,
}: Readonly<{ id: string; etiqueta: string; ayuda?: string; error?: string; children: React.ReactNode }>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {etiqueta}
      </Label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger">{error}</p>
      ) : (
        ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>
      )}
    </div>
  );
}

function EsqueletoCheckout() {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 py-10">
      <div className="h-6 w-40 animate-pulse rounded bg-muted" />
      <div className="h-12 animate-pulse rounded bg-muted" />
      <div className="h-32 animate-pulse rounded bg-muted" />
      <div className="h-48 animate-pulse rounded bg-muted" />
    </div>
  );
}
