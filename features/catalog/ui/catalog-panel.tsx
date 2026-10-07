"use client";

import { useState } from "react";
import { useRouter } from "next/navigation"; // 🚀 Importamos el router
import { ConfiguracionPOS } from "@/entities/config/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import {
  Globe,
  Clock,
  Save,
  Loader2,
  Store,
  ShoppingBag,
  Type,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/shared/config/supabase/client";
import { BannerManager } from "./banner-manager";
import { DireccionTienda } from "./direccion-tienda";
import { FaFacebook, FaInstagram } from "react-icons/fa";

interface CatalogPanelProps {
  config: ConfiguracionPOS;
}

export function CatalogPanel({ config }: Readonly<CatalogPanelProps>) {
  const router = useRouter(); // 🚀 Inicializamos el router
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    catalogo_activo: config.catalogo_activo ?? true,
    mostrar_precios: config.mostrar_precios ?? true,
    mostrar_sin_stock: config.mostrar_sin_stock ?? false,
    pedidos_whatsapp: config.pedidos_whatsapp ?? true,
    direccion_visible: config.direccion_visible ?? true,
    horario_visible: config.horario_visible ?? true,
    horario_texto: config.horario_texto || "",
    instagram: config.instagram || "",
    facebook: config.facebook || "",
    marquee_activo: config.marquee_activo ?? false,
    marquee_texto: config.marquee_texto || "",
    localidad_negocio: config.localidad_negocio || "",
    envio_costo_local: config.envio_costo_local ?? 0,
    envio_mensaje_lejos: config.envio_mensaje_lejos || "",
    envio_gratis_desde_monto: config.envio_gratis_desde_monto?.toString() ?? "",
    envio_gratis_desde_unidades: config.envio_gratis_desde_unidades?.toString() ?? "",
    envio_gratis_alcance: config.envio_gratis_alcance ?? "LOCAL",
  });

  const handleChange = (field: string, value: string | boolean | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    const monto = formData.envio_gratis_desde_monto.trim() === "" ? null : Number(formData.envio_gratis_desde_monto);
    const unidades = formData.envio_gratis_desde_unidades.trim() === "" ? null : Number(formData.envio_gratis_desde_unidades);
    if ([monto, unidades].some(v => v !== null && (!Number.isFinite(v) || v <= 0))) {
      toast.error("El mínimo para envío gratis debe ser mayor que cero, o quedar vacío.");
      return;
    }
    setIsSaving(true);
    const supabase = createClient();

    // `.select("id")` no es decorativo: un UPDATE filtrado por RLS vuelve con
    // CERO filas y `error: null`, o sea indistinguible de haber guardado. Es el
    // incidente de las 35 fotos del 5/9. Acá el camino que lo dispara es el
    // negocio activo sin resolver —`security.current_negocio_id()` en NULL, que
    // es lo que pasa cuando el Modo Dios se quedó sin su cookie— y el síntoma
    // era exactamente este: apagar y prender "Catálogo Activo", ver el cartel
    // verde, y que la tienda siguiera cerrada.
    const { data: filasTocadas, error } = await supabase
      .from("configuracion_pos")
      .update({ ...formData, envio_gratis_desde_monto: monto, envio_gratis_desde_unidades: unidades })
      .eq("id", config.id)
      .select("id");

    setIsSaving(false);

    if (error) {
      toast.error("Error al guardar la configuración del catálogo.");
      console.error(error);
      return;
    }

    if (!filasTocadas || filasTocadas.length === 0) {
      toast.error(
        "No se guardó: no tenés permiso sobre este comercio, o se venció la sesión del negocio activo.",
      );
      return;
    }

    toast.success("Catálogo actualizado correctamente.");
    router.refresh(); // 🚀 FIX: Forzamos a Next.js a recargar el Layout y el Navbar para mostrar los nuevos datos
  };

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-300 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" /> Catálogo Online
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configura cómo los clientes ven tu tienda pública y qué acciones
            pueden realizar.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full sm:w-auto"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Guardar Cambios
        </Button>
      </div>

      {/* Arriba de todo: es lo primero que un comercio nuevo busca acá, y el
          único dato de esta pantalla que no es una preferencia sino la URL
          que ya está circulando. */}
      <DireccionTienda />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* COLUMNA IZQUIERDA: Visibilidad y Funcionamiento */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-2xl p-5 space-y-6">
            <h3 className="font-bold text-foreground flex items-center gap-2 border-b border-border/50 pb-3">
              <Store className="w-4 h-4 text-muted-foreground" /> Visibilidad de
              la Tienda
            </h3>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Catálogo Activo</Label>
                <p className="text-xs text-muted-foreground">
                  Si está inactivo, mostrará un cartel de &quot;Cerrado
                  temporalmente&quot;.
                </p>
              </div>
              <Switch
                checked={formData.catalogo_activo}
                onCheckedChange={(v) => handleChange("catalogo_activo", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">
                  Recibir Pedidos por WhatsApp
                </Label>
                <p className="text-xs text-muted-foreground">
                  Activa el carrito de compras y el envío de pedidos al WhatsApp
                  del local.
                </p>
              </div>
              <Switch
                checked={formData.pedidos_whatsapp}
                onCheckedChange={(v) => handleChange("pedidos_whatsapp", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Mostrar Precios</Label>
                <p className="text-xs text-muted-foreground">
                  Ocultar los precios convierte el catálogo en solo vidriera.
                </p>
              </div>
              <Switch
                checked={formData.mostrar_precios}
                onCheckedChange={(v) => handleChange("mostrar_precios", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">
                  Mostrar Productos Sin Stock
                </Label>
                <p className="text-xs text-muted-foreground">
                  Los productos agotados aparecerán tachados al final de la lista.
                </p>
              </div>
              <Switch
                checked={formData.mostrar_sin_stock}
                onCheckedChange={(v) => handleChange("mostrar_sin_stock", v)}
              />
            </div>
          </div>

          {/* MÓDULO MARQUEE */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
            <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-3">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <Type className="w-4 h-4 text-primary" /> Barra de Anuncios
              </h3>
              <Switch
                checked={formData.marquee_activo}
                onCheckedChange={(v) => handleChange("marquee_activo", v)}
              />
            </div>

            <div
              className={`space-y-2 transition-opacity ${!formData.marquee_activo ? "opacity-50 pointer-events-none" : ""}`}
            >
              <Label className="text-xs font-semibold text-foreground uppercase">
                Texto Infinito
              </Label>
              <Input
                value={formData.marquee_texto}
                onChange={(e) => handleChange("marquee_texto", e.target.value)}
                placeholder="Ej: 20% OFF EN EFECTIVO // ENVÍOS GRATIS"
              />
              <p className="text-xs text-muted-foreground">
                Este texto aparecerá desplazándose en la parte superior de la
                pantalla. Separa las promociones con &quot;//&quot;.
              </p>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: Datos Públicos */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
            <h3 className="font-bold text-foreground flex items-center gap-2 border-b border-border/50 pb-3">
              <ShoppingBag className="w-4 h-4 text-muted-foreground" /> Datos y
              Redes
            </h3>

            <div className="flex items-center justify-between gap-4 mb-2">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">
                  Mostrar Dirección
                </Label>
                <p className="text-xs text-muted-foreground">
                  Visible en la cabecera de la tienda.
                </p>
              </div>
              <Switch
                checked={formData.direccion_visible}
                onCheckedChange={(v) => handleChange("direccion_visible", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4 mb-8">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">
                  Mostrar Horarios
                </Label>
                <p className="text-xs text-muted-foreground">
                  Indicador de abierto/cerrado según tu horario.
                </p>
              </div>
              <Switch
                checked={formData.horario_visible}
                onCheckedChange={(v) => handleChange("horario_visible", v)}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Texto de Horarios
              </Label>
              <Input
                value={formData.horario_texto}
                onChange={(e) => handleChange("horario_texto", e.target.value)}
                placeholder="Ej: Lun a Sáb 9:00 a 13:00 y 16:30 a 20:00"
                className="bg-muted/50 border-border"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground uppercase tracking-widest flex items-center gap-1.5">
                <FaInstagram className="w-3.5 h-3.5 text-pink-600" />
                Link de Instagram
              </Label>
              <Input
                value={formData.instagram}
                onChange={(e) => handleChange("instagram", e.target.value)}
                placeholder="https://instagram.com/tu_negocio"
                className="bg-muted/50 border-border"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground uppercase tracking-widest flex items-center gap-1.5">
                <FaFacebook className="w-3.5 h-3.5 text-info" />
                Link de Facebook
              </Label>
              <Input
                value={formData.facebook}
                onChange={(e) => handleChange("facebook", e.target.value)}
                placeholder="https://facebook.com/tu_negocio"
                className="bg-muted/50 border-border"
              />
            </div>
          </div>

          {/* MÓDULO ENVÍOS */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
            <h3 className="font-bold text-foreground flex items-center gap-2 border-b border-border/50 pb-3">
              <Truck className="w-4 h-4 text-muted-foreground" /> Envíos del
              Catálogo
            </h3>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground uppercase tracking-widest">
                Localidad del Negocio
              </Label>
              <Input
                value={formData.localidad_negocio}
                onChange={(e) =>
                  handleChange("localidad_negocio", e.target.value)
                }
                placeholder="Ej: Santa Fe"
                className="bg-muted/50 border-border"
              />
              <p className="text-xs text-muted-foreground">
                Si un cliente escribe esta localidad al pedir envío, se le
                cobra el costo fijo de abajo. Si escribe otra, ve el aviso de
                &quot;a convenir&quot; en su lugar.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground uppercase tracking-widest">
                  Costo de Envío Local
              </Label>
                <Input
                  type="number"
                  value={formData.envio_costo_local}
                onChange={(e) =>
                  handleChange("envio_costo_local", Number(e.target.value))
                }
                placeholder="Ej: 2000"
                className="bg-muted/50 border-border"
              />
              </div>

              <div className="space-y-3">
                <Label htmlFor="gratis-monto">Envío gratis desde $</Label>
                <Input id="gratis-monto" type="number" min="0.01" step="any" className="h-11" value={formData.envio_gratis_desde_monto} onChange={e => handleChange("envio_gratis_desde_monto", e.target.value)} placeholder="Sin mínimo por monto" />
                <Label htmlFor="gratis-unidades">Envío gratis desde productos</Label>
                <Input id="gratis-unidades" type="number" min="1" className="h-11" value={formData.envio_gratis_desde_unidades} onChange={e => handleChange("envio_gratis_desde_unidades", e.target.value)} placeholder="Sin mínimo por cantidad" />
                <Label htmlFor="gratis-alcance">Dónde ofrecés envío gratis</Label>
                <select id="gratis-alcance" className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm" value={formData.envio_gratis_alcance} onChange={e => handleChange("envio_gratis_alcance", e.target.value)}>
                  <option value="LOCAL">Solo en la localidad del comercio</option>
                  <option value="TODOS">A todas las localidades</option>
                </select>
                <p className="text-xs text-muted-foreground">Dejá ambos mínimos vacíos para desactivar. Si completás los dos, alcanza con cumplir uno. El monto se calcula después de los descuentos.</p>
              </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground uppercase tracking-widest">
                Mensaje para Envíos Fuera de la Localidad
              </Label>
              <Input
                value={formData.envio_mensaje_lejos}
                onChange={(e) =>
                  handleChange("envio_mensaje_lejos", e.target.value)
                }
                placeholder="Envío a convenir — te contactamos por WhatsApp para coordinar"
                className="bg-muted/50 border-border"
              />
            </div>
          </div>
        </div>
      </div>

      <BannerManager config={config} />
    </div>
  );
}
