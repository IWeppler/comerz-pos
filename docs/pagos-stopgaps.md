# Pagos: atajos pendientes (STOPGAP)

Cada atajo de la épica de pagos se marca en el código con `// STOPGAP:` (o
`-- STOPGAP:` en SQL) y se lista acá con la fecha en que hay que revisarlo. Contexto
en [pagos-auditoria.md](pagos-auditoria.md).

| # | Atajo | Por qué hoy | Lo que falta | Revisar |
|---|---|---|---|---|
| 1 | **Vencimiento sin job**: las órdenes impagas vencen y devuelven stock cuando alguien las lee (página de la orden, lista del panel). | Decisión de Nacho (12/10/2026): no habilitar `pg_cron` todavía. | `pg_cron` cada **10 min** llamando a la función de vencimiento. Mientras no esté, una orden que nadie mira retiene stock. | Al activar el segundo comercio |
| 2 | **Conciliación por lectura y botón de respaldo**: la transferencia al alias de MP se concilia sola al abrir /ordenes o la página de la orden (monto exacto, una candidata); si no coincide (dos órdenes con el mismo monto, alias de otra cuenta) queda "Confirmar transferencia". | Sin referencia en la transferencia, el monto es el único dato; sin job, solo corre cuando alguien mira. | Job cada 10 min (con #1) y, si molestan los empates, hacer único el total de cada orden pendiente. Verificar si las transferencias disparan el webhook (T7). | Con el primer comercio real |
| 3 | **Reembolsos y contracargos no devuelven stock ni anulan la venta** solos. | La mercadería puede estar entregada; lo decide el comercio. | Acción "Devolver al stock" sobre la orden reembolsada. | Después de T10 |
| 4 | **Sin pago online para presentaciones, importe fijado y envío "a convenir"**: esos pedidos siguen por WhatsApp. | Su precio/costo tiene reglas que hoy solo resuelve `create-sale.ts`; duplicarlas sería un segundo criterio de plata. | Extraer la resolución de precio de `create-sale.ts` a un módulo compartido y usarlo en la orden. | Si los comercios de pinturería/fiambrería piden pago online |
| 5 | **REVISAR y PAGADA_SIN_STOCK sin acción propia**: la orden queda marcada y en Pendientes, pero no hay botón para cobrarla igual, cancelarla ni devolver la plata; REVISAR retiene stock. | Son casos raros (monto alterado, pago del último minuto pasada la gracia); que decida el comercio desde MP. | Acciones "Registrar venta igual" / "Cancelar y devolver stock" sobre esas órdenes. | Al primer caso real |
| 6 | **Aviso sin firma = solo pista**: un aviso sin `x-signature` no se aplica directo, dispara la conciliación (que no mira reembolsos ni contracargos de órdenes ya pagadas). | No está confirmado que los avisos de notification_url lleguen firmados. | Si en sandbox llegan firmados, exigir firma y rechazar el resto. | En la prueba de T7 en sandbox |

