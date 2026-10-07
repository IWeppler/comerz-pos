export interface ParComplementario {
  producto_a_id: string;
  producto_a: string;
  producto_b_id: string;
  producto_b: string;
  ventas_juntas: number;
  ventas_a: number;
  ventas_b: number;
  activo: boolean;
  publicables: boolean;
}
export interface AnalisisComplementos {
  dias: number;
  puede_editar: boolean;
  pares: ParComplementario[];
}
