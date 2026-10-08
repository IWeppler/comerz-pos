import { afterEach, expect, it, vi } from "vitest";
import { useWizardInicioStore } from "./wizard-inicio-store";
afterEach(() => { vi.unstubAllGlobals(); useWizardInicioStore.setState({ negocioId: null, activo: false, ticketConLineas: false, ventaExitosa: false }); });
it("retoma por negocio y salir elimina solamente su intención", () => {
  const datos = new Map<string,string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string,v: string) => datos.set(k,v), removeItem: (k: string) => datos.delete(k) });
  const store = useWizardInicioStore.getState();
  store.iniciar("a"); store.cargar("b"); expect(useWizardInicioStore.getState().activo).toBe(false);
  store.cargar("a"); expect(useWizardInicioStore.getState().activo).toBe(true);
  store.salir(); expect(datos.has("comerz:wizard-inicio:a")).toBe(false);
});
it("storage bloqueado no frena iniciar ni salir", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw Error("bloqueado"); }, setItem: () => { throw Error("bloqueado"); }, removeItem: () => { throw Error("bloqueado"); } });
  expect(() => useWizardInicioStore.getState().iniciar("bloqueado")).not.toThrow();
  expect(useWizardInicioStore.getState().activo).toBe(true);
  expect(() => useWizardInicioStore.getState().salir()).not.toThrow();
});
