"use client";

import { useActionState, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { CreateClientDialog } from "@/features/clients/ui/create-client-dialog";
import { UserPlus } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { crearClienteAction } from "../actions/manage-clients";
import { queryKeys } from "@/shared/lib/query-keys";

type CreateClientState = {
  error: string | null;
  success: boolean;
};

interface CreateClientModalProps {
  buttonClassName?: string;
  labelClassName?: string;
  entregaMinimaActiva?: boolean;
}

export function CreateClientModal({
  buttonClassName,
  labelClassName = "hidden md:flex",
  entregaMinimaActiva = false,
}: Readonly<CreateClientModalProps> = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  const [, formAction, isPending] = useActionState(
    async (prevState: CreateClientState, formData: FormData) => {
      const result = await crearClienteAction(prevState, formData);
      if (result.success) {
        toast.success("Cliente registrado con exito.");
        queryClient.invalidateQueries({ queryKey: queryKeys.clientes.listado });
        setIsOpen(false);
      } else {
        toast.error(result.error || "Ocurrio un error");
      }
      return result;
    },
    { error: null, success: false },
  );

  return (
    <CreateClientDialog
      open={isOpen}
      onOpenChange={setIsOpen}
      action={formAction}
      isPending={isPending}
      includeVencimientoDeuda
      showExceptuadoEntregaMinima={entregaMinimaActiva}
      trigger={
        <Button title="Nuevo Cliente" className={buttonClassName}>
          <UserPlus className="w-4 h-4 sm:w-5 sm:h-5" />
          <span className={labelClassName}>Nuevo Cliente</span>
        </Button>
      }
    />
  );
}
