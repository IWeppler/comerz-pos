import { redirect } from "next/navigation";

/**
 * /store sin negocio no es el catálogo de nadie. Antes era el de Evens, que
 * fue el primer y único tenant; con multi-tenant, servir "el catálogo" sin
 * saber de quién es sería mostrarle a un comercio los productos de otro.
 */
export default function StoreSinNegocio() {
  redirect("/ingresar");
}
