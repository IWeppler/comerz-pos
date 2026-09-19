"use client";

import { useActionState, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Landmark, Loader2, Plus, Repeat2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { formatearMoneda } from "@/shared/utils/formatters";
import {
  crearCuentaFinancieraAction,
  registrarTransferenciaFinancieraAction,
  type CuentaFinanciera,
  type TransferenciaFinanciera,
} from "../actions/cuentas-financieras";

type Estado = { error: string | null; success: boolean };

export function CuentasFinancierasPanel({
  cuentas,
  transferencias,
}: Readonly<{ cuentas: CuentaFinanciera[]; transferencias: TransferenciaFinanciera[] }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [transferirAbierto, setTransferirAbierto] = useState(
    searchParams.get("accion") === "transferir",
  );
  const [crearAbierto, setCrearAbierto] = useState(false);
  const [origen, setOrigen] = useState(cuentas[0]?.id ?? "");
  const [destino, setDestino] = useState(cuentas[1]?.id ?? "");
  const [tipo, setTipo] = useState("CAJA_GENERAL");

  const [, transferir, transfiriendo] = useActionState(
    async (prev: Estado, data: FormData) => {
      const res = await registrarTransferenciaFinancieraAction(prev, data);
      if (res.success) {
        toast.success("Transferencia registrada");
        setTransferirAbierto(false);
        router.refresh();
      } else toast.error(res.error);
      return res;
    },
    { error: null, success: false },
  );

  const [, crear, creando] = useActionState(
    async (prev: Estado, data: FormData) => {
      const res = await crearCuentaFinancieraAction(prev, data);
      if (res.success) {
        toast.success("Cuenta creada");
        setCrearAbierto(false);
        router.refresh();
      } else toast.error(res.error);
      return res;
    },
    { error: null, success: false },
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Fondos y cuentas</h2>
          <p className="text-[11px] text-muted-foreground">
            Una transferencia cambia dónde está el dinero; no cuenta como ingreso ni gasto.
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={crearAbierto} onOpenChange={setCrearAbierto}>
            <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="mr-1.5 h-4 w-4" />Cuenta</Button></DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader><DialogTitle>Nueva cuenta</DialogTitle><DialogDescription>Creá una caja general, banco o billetera del negocio.</DialogDescription></DialogHeader>
              <form action={crear} className="space-y-4">
                <div className="space-y-2"><Label htmlFor="cuenta-nombre">Nombre</Label><Input id="cuenta-nombre" name="nombre" placeholder="Ej: Banco Nación" required /></div>
                <div className="space-y-2"><Label>Tipo</Label><input type="hidden" name="tipo" value={tipo} /><Select value={tipo} onValueChange={setTipo}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CAJA_GENERAL">Caja general</SelectItem><SelectItem value="BANCO">Cuenta bancaria</SelectItem><SelectItem value="BILLETERA">Billetera virtual</SelectItem><SelectItem value="OTRA">Otra</SelectItem></SelectContent></Select></div>
                <Button className="w-full" disabled={creando}>{creando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Crear cuenta</Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={transferirAbierto} onOpenChange={setTransferirAbierto}>
            <DialogTrigger asChild><Button size="sm" disabled={cuentas.length < 2}><Repeat2 className="mr-1.5 h-4 w-4" />Transferir</Button></DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle>Transferir entre cuentas</DialogTitle><DialogDescription>El pase queda auditado y no modifica el resultado del negocio.</DialogDescription></DialogHeader>
              <form action={transferir} className="space-y-4">
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                  <div className="space-y-2"><Label>Desde</Label><input type="hidden" name="cuenta_origen_id" value={origen} /><Select value={origen} onValueChange={setOrigen}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{cuentas.filter((c) => c.id !== destino).map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}</SelectContent></Select></div>
                  <ArrowRight className="mb-2.5 h-4 w-4 text-muted-foreground" />
                  <div className="space-y-2"><Label>Hacia</Label><input type="hidden" name="cuenta_destino_id" value={destino} /><Select value={destino} onValueChange={setDestino}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{cuentas.filter((c) => c.id !== origen).map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}</SelectContent></Select></div>
                </div>
                <div className="space-y-2"><Label htmlFor="transferencia-monto">Monto</Label><Input id="transferencia-monto" name="monto" type="number" min="0.01" step="any" required /></div>
                <div className="space-y-2"><Label htmlFor="transferencia-concepto">Concepto</Label><Input id="transferencia-concepto" name="concepto" placeholder="Ej: Retiro al cierre" required /></div>
                <Button className="w-full" disabled={transfiriendo || !origen || !destino || origen === destino}>{transfiriendo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Registrar transferencia</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {cuentas.map((cuenta) => (
          <div key={cuenta.id} className="flex min-w-44 items-center gap-3 rounded-xl border border-border bg-card px-3 py-3">
            {cuenta.tipo === "BANCO" ? <Landmark className="h-4 w-4 text-muted-foreground" /> : <Wallet className="h-4 w-4 text-muted-foreground" />}
            <div className="min-w-0"><p className="truncate text-sm font-medium">{cuenta.nombre}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{etiquetaTipo(cuenta.tipo)}</p></div>
          </div>
        ))}
      </div>

      {transferencias.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Últimas transferencias</div>
          <div className="divide-y divide-border">
            {transferencias.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">{t.origen_nombre} → {t.destino_nombre}</p><p className="truncate text-xs text-muted-foreground">{t.concepto} · {new Date(t.fecha).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</p></div>
                <span className="shrink-0 font-mono font-semibold">{formatearMoneda(Number(t.monto))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function etiquetaTipo(tipo: string) {
  return ({ CAJA_DIARIA: "Caja diaria", CAJA_GENERAL: "Caja general", BANCO: "Banco", BILLETERA: "Billetera", OTRA: "Otra" } as Record<string, string>)[tipo] ?? tipo;
}
