"use client";

import { useState } from "react";
import { toast } from "sonner";
import type {
  ItemResuelto,
  OrdenCompra,
  SugerenciaSimilitud,
} from "@/entities/compras/types";
import type { Producto } from "@/entities/productos/types";
import type { Rubro } from "@/entities/config/types";
import {
  decidirModoConciliacion,
  type ModoConciliacion,
} from "../lib/modo-conciliacion";
import type { CategoriaReal } from "../lib/resolve-import-categoria";
import type { FilaCargaInicial } from "../lib/filas-carga-inicial";
import type { SerieConciliacion } from "../lib/imeis-remito";
import { CargaInicialTable } from "./carga-inicial-table";
import { MergeTable } from "./merge-table";

/**
 * Elige con qué pantalla abre un remito y deja cambiarla a mano.
 *
 * Vive aparte de las dos tablas a propósito: `merge-table.tsx` son 1.900
 * líneas y la decisión de modo no tiene nada que ver con su estado interno.
 * Acá arriba, cada modo se monta y se desmonta entero.
 */

/**
 * El borrador guardado en la base. Los dos modos escriben en la MISMA fila
 * (`ordenes_borradores`, una por orden) y se distinguen por `modo`: el
 * payload de uno no sirve para el otro, y sin ese campo reabrir el remito
 * podía elegir la pantalla equivocada y descartar el trabajo del otro modo.
 */
export type BorradorGuardado = {
  payload:
    | {
        version: 1;
        modo: "CARGA_INICIAL";
        filas: FilaCargaInicial[];
        recargo: number;
      }
    | {
        version: 1;
        modo: "CONCILIACION";
        items: ItemResuelto[];
        productosCreados: Producto[];
      }
    | null;
  actualizado_en: string;
} | null;

interface Props {
  orden: OrdenCompra;
  items: ItemResuelto[];
  productos: Producto[];
  sugerenciasSimilitud: SugerenciaSimilitud[];
  categorias: CategoriaReal[];
  rubro: Rubro;
  borrador: BorradorGuardado;
  /** Qué lleva IMEI: para pedir los que el Excel no trajo. */
  serie: SerieConciliacion;
}

export function ConciliacionClient({
  orden,
  items,
  productos,
  sugerenciasSimilitud,
  categorias,
  rubro,
  borrador,
  serie,
}: Readonly<Props>) {
  const decision = decidirModoConciliacion(items, productos.length);

  // Un remito que ya se venía trabajando abre en el modo en el que se estaba
  // trabajando: abrirlo en el otro tiraría ese trabajo a la basura.
  const [modo, setModo] = useState<ModoConciliacion>(
    borrador?.payload?.modo ?? decision.modo,
  );

  const borradorCargaInicial =
    borrador?.payload?.modo === "CARGA_INICIAL" ? borrador.payload : null;
  const borradorConciliacion =
    borrador?.payload?.modo === "CONCILIACION" ? borrador.payload : null;

  if (modo === "CARGA_INICIAL") {
    return (
      <CargaInicialTable
        orden={orden}
        itemsOriginales={items}
        categorias={categorias}
        rubro={rubro}
        decision={decision}
        borradorInicial={borradorCargaInicial}
        serie={serie}
        onCambiarModo={() => {
          setModo("CONCILIACION");
          toast.info(
            "Pasaste a vincular con productos existentes. Lo que cargaste queda guardado si volvés.",
          );
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 md:px-4">
        <p className="text-xs text-muted-foreground">
          {decision.gruposConMatch} de {decision.gruposTotales} productos de
          este remito ya están en tu catálogo.
        </p>
        <button
          type="button"
          onClick={() => setModo("CARGA_INICIAL")}
          className="cursor-pointer text-xs font-medium text-primary underline underline-offset-2"
        >
          Son casi todos nuevos — cargarlos en una tabla
        </button>
      </div>

      <MergeTable
        orden={orden}
        itemsOriginales={items}
        productos={productos}
        sugerenciasSimilitud={sugerenciasSimilitud}
        borradorServidor={borradorConciliacion}
        serie={serie}
      />
    </div>
  );
}
