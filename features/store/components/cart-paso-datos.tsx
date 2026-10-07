"use client";

import { useState, type RefObject } from "react";
import { MapPin, Plus, Store } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { ModalidadEntregaPublica } from "@/shared/components/cart-sidebar/cart-sidebar-utils";
import type { OpcionPagoPublica } from "@/shared/lib/opciones-pago-publicas";

export interface EnvioInfo {
  tipo: "LOCAL" | "LEJOS";
  costo?: number;
  mensaje?: string;
}

export type CampoPedido = "nombre" | "localidad" | "direccion" | "pago";

export type ErroresPedido = Partial<Record<CampoPedido, string>>;

interface CartPasoDatosProps {
  beneficio?: React.ReactNode;
  nombre: string;
  onNombreChange: (value: string) => void;
  modalidad: ModalidadEntregaPublica;
  onModalidadChange: (value: ModalidadEntregaPublica) => void;
  localidad: string;
  onLocalidadChange: (value: string) => void;
  direccion: string;
  onDireccionChange: (value: string) => void;
  envioInfo: EnvioInfo | null;
  opcionesPago: OpcionPagoPublica[];
  opcionPago: OpcionPagoPublica | null;
  onOpcionPagoChange: (opcion: OpcionPagoPublica) => void;
  nota: string;
  onNotaChange: (value: string) => void;
  errores: ErroresPedido;
  /**
   * Los refs llegan UNO POR UNO y no en un objeto `refs`, aunque el objeto
   * fuera más corto: el panel es quien manda el foco al primer campo que falta
   * (ver `enviarPedido`), así que los refs tienen que vivir allá. Pasarlos
   * agrupados obliga a leer `refs.nombre` durante el render, que es
   * exactamente lo que la regla `react-hooks/refs` señala — y que rompe si
   * algún día el objeto se arma con lógica.
   */
  refNombre: RefObject<HTMLInputElement | null>;
  refLocalidad: RefObject<HTMLInputElement | null>;
  refDireccion: RefObject<HTMLInputElement | null>;
  refPago: RefObject<HTMLDivElement | null>;
}

/**
 * PASO 2: los datos del pedido, en el orden en que se piensan — quién sos,
 * dónde lo recibís, cómo pagás.
 *
 * EL MÉTODO DE PAGO ESTÁ ACÁ Y NO EN EL CHAT porque es lo único que faltaba
 * para que el total del pie fuera verdadero. Mientras se resolvía después por
 * WhatsApp, la pantalla tenía que arreglárselas con un disclaimer de tres
 * líneas explicando qué descuentos podrían aplicar y qué recargos no estaban
 * incluidos. Elegirlo acá convierte esas tres líneas en un renglón con un
 * número.
 *
 * LOS ERRORES VAN EN EL CAMPO, nunca abajo del botón: en un celular el botón
 * de enviar está al pie y el campo vacío puede estar tres scrolls arriba, así
 * que un cartel abajo dice que algo falta sin decir dónde. Acá el mensaje sale
 * al lado del input y el foco viaja al primero que falta, que además abre el
 * teclado en el lugar correcto.
 */
export function CartPasoDatos({
  nombre,
  onNombreChange,
  modalidad,
  onModalidadChange,
  localidad,
  onLocalidadChange,
  direccion,
  onDireccionChange,
  envioInfo,
  opcionesPago,
  opcionPago,
  onOpcionPagoChange,
  nota,
  onNotaChange,
  errores,
  refNombre,
  refLocalidad,
  refDireccion,
  refPago,
  beneficio,
}: Readonly<CartPasoDatosProps>) {
  // Arranca abierta si ya hay algo escrito: volver al paso 1 y regresar no
  // puede esconder una nota que la clienta ya cargó.
  const [notaAbierta, setNotaAbierta] = useState(() => nota.trim() !== "");

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <div className="space-y-5">
        {beneficio}
        <Campo
          id="nombre_cliente_publico"
          etiqueta="Nombre"
          obligatorio
          error={errores.nombre}
        >
          <Input
            id="nombre_cliente_publico"
            ref={refNombre}
            value={nombre}
            onChange={(e) => onNombreChange(e.target.value)}
            placeholder="Tu nombre"
            autoComplete="name"
            aria-invalid={!!errores.nombre}
            className="h-11 rounded-md"
          />
        </Campo>

        {/* Segmentado y no dos botones sueltos: son dos valores de UN campo, y
            un control único con el elegido pintado adentro lo dice sin
            necesidad de un título que aclare de qué se trata. */}
        <Grupo>
          <Opcion
            activo={modalidad === "RETIRO"}
            onClick={() => onModalidadChange("RETIRO")}
            icono={<Store className="h-4 w-4" />}
            texto="Retiro en local"
          />
          <Opcion
            activo={modalidad === "ENVIO"}
            onClick={() => onModalidadChange("ENVIO")}
            icono={<MapPin className="h-4 w-4" />}
            texto="Envío"
          />
        </Grupo>

        {modalidad === "ENVIO" && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
            <Campo
              id="localidad_publica"
              etiqueta="Localidad"
              obligatorio
              error={errores.localidad}
            >
              <Input
                id="localidad_publica"
                ref={refLocalidad}
                value={localidad}
                onChange={(e) => onLocalidadChange(e.target.value)}
                placeholder="Ej: Tostado"
                autoComplete="address-level2"
                aria-invalid={!!errores.localidad}
                className="h-11 rounded-md"
              />
            </Campo>

            <Campo
              id="direccion_publica"
              etiqueta="Dirección"
              obligatorio
              error={errores.direccion}
            >
              <Input
                id="direccion_publica"
                ref={refDireccion}
                value={direccion}
                onChange={(e) => onDireccionChange(e.target.value)}
                placeholder="Calle y número"
                autoComplete="street-address"
                aria-invalid={!!errores.direccion}
                className="h-11 rounded-md"
              />
            </Campo>

            {/* El costo CONOCIDO no se avisa acá: baja al desglose como un
                renglón del total, que es donde se mira la plata. Lo que sí
                queda es el caso en que no se puede calcular, porque eso el
                total no lo puede decir. */}
            {envioInfo?.tipo === "LEJOS" && (
              <p className="text-xs text-warning">{envioInfo.mensaje}</p>
            )}
          </div>
        )}

        {opcionesPago.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium">
              Cómo pagás <span className="text-danger">*</span>
            </span>
            {/* Grilla de 2 y no una fila: son hasta 4 opciones y en un celular
                angosto cuatro en línea dejan etiquetas de tres letras. */}
            <div
              ref={refPago}
              className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1"
            >
              {opcionesPago.map((opcion) => (
                <Opcion
                  key={opcion.tipo}
                  activo={opcionPago?.tipo === opcion.tipo}
                  onClick={() => onOpcionPagoChange(opcion)}
                  texto={opcion.etiqueta}
                  detalle={
                    opcion.recargoPorcentaje > 0
                      ? `+${opcion.recargoPorcentaje}%`
                      : undefined
                  }
                />
              ))}
            </div>
            {errores.pago && (
              <p className="text-xs font-medium text-danger">{errores.pago}</p>
            )}
          </div>
        )}

        {notaAbierta ? (
          <Campo id="nota_publica" etiqueta="Nota">
            <Textarea
              id="nota_publica"
              value={nota}
              onChange={(e) => onNotaChange(e.target.value)}
              placeholder="Algo que quieras aclarar sobre tu pedido..."
              rows={2}
              className="rounded-md"
            />
          </Campo>
        ) : (
          <button
            type="button"
            onClick={() => setNotaAbierta(true)}
            className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar una nota
          </button>
        )}
      </div>
    </div>
  );
}

function Campo({
  id,
  etiqueta,
  obligatorio = false,
  error,
  children,
}: Readonly<{
  id: string;
  etiqueta: string;
  obligatorio?: boolean;
  error?: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {etiqueta}
        {obligatorio && <span className="text-danger"> *</span>}
      </Label>
      {children}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

function Grupo({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
      {children}
    </div>
  );
}

function Opcion({
  activo,
  onClick,
  icono,
  texto,
  detalle,
}: Readonly<{
  activo: boolean;
  onClick: () => void;
  icono?: React.ReactNode;
  texto: string;
  detalle?: string;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
        activo
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {icono}
      {texto}
      {detalle && (
        <span className={activo ? "opacity-80" : "text-warning"}>{detalle}</span>
      )}
    </button>
  );
}
