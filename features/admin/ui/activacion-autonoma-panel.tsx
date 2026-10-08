import { getEmbudoActivacionAction } from "../actions/funnel-comerz";
import {
  comerciosAutonomos,
  horasHastaHito,
  nombreCamino,
} from "../lib/activacion-autonoma";

const horas = (alta: string, fecha: string | null) => {
  const h = horasHastaHito(alta, fecha);
  return h === null
    ? "—"
    : `${h.toLocaleString("es-AR", { maximumFractionDigits: 1 })} h`;
};
export async function ActivacionAutonomaPanel() {
  const datos = await getEmbudoActivacionAction();
  return (
    <section className="space-y-3 rounded-xl border border-white/10 p-4 text-white/80">
      <h2 className="text-sm font-semibold">Activación autónoma</h2>
      <p className="text-xs text-white/40">
        Horas desde el alta hasta cada hito. Excluye demos y comercios migrados.
      </p>
      {!datos ? (
        <p className="text-sm text-white/50">
          Las métricas de activación todavía no están disponibles.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  {[
                    "Comercio",
                    "Alta",
                    "Camino",
                    "Productos",
                    "Caja",
                    "POS",
                    "Primera venta",
                  ].map((t) => (
                    <th key={t} className="px-2 py-3 font-medium text-white/50">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comerciosAutonomos(datos.comercios).map((c) => (
                  <tr key={c.id} className="border-t border-white/10">
                    <td className="px-2 py-3">{c.nombre}</td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      {new Date(c.alta).toLocaleDateString("es-AR", {
                        timeZone: "America/Argentina/Buenos_Aires",
                      })}
                    </td>
                    <td className="px-2 py-3">
                      {nombreCamino(c.camino)}
                      <span className="block text-white/40">
                        {horas(c.alta, c.camino_elegido)}
                      </span>
                    </td>
                    {[c.productos, c.caja, c.pos_abierto, c.primera_venta].map(
                      (fecha, index) => (
                        <td
                          key={index}
                          className="px-2 py-3 whitespace-nowrap font-mono"
                        >
                          {horas(c.alta, fecha)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="pt-2 text-sm font-medium">
            Primera venta en menos de 24 horas
          </h3>
          <p className="text-xs text-white/40">
            Por semana de alta, lunes en Argentina. El porcentaje usa comercios
            con al menos 24 h desde el alta; las altas más recientes esperan esa
            ventana.
          </p>
          <ul className="space-y-2">
            {datos.cohortes.map((c) => (
              <li
                key={c.semana}
                className="flex flex-wrap justify-between gap-2 text-sm"
              >
                <span>
                  Semana del {c.semana.split("-").reverse().join("/")}
                </span>
                <span className="font-mono">
                  {c.porcentaje_24h === null ? "—" : `${c.porcentaje_24h}%`} ·{" "}
                  {c.vendidos_24h}/{c.evaluables} evaluables ({c.comercios}{" "}
                  altas)
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
