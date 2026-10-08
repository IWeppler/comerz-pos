/** Atajos de calculadora: no modifican el monto que registra la venta. */
export function montosRapidosEfectivo(total: number): number[] {
  if (!Number.isFinite(total) || total < 0) return [];
  const paso = Math.max(1000, 10 ** Math.floor(Math.log10(Math.max(1, total))));
  const primero = (Math.floor(total / 1000) + 1) * 1000;
  const candidatos = [primero, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
  if (new Set(candidatos.filter((monto) => monto > total)).size < 4) {
    for (let i = 1; i <= 4; i++) candidatos.push((Math.floor(total / paso) + i) * paso);
  }
  return [...new Set(candidatos)].filter((monto) => monto > total).sort((a, b) => a - b).slice(0, 4);
}
