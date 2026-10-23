/**
 * La pantalla de "no pude averiguarlo", que es distinta de "no tenés permiso".
 *
 * EL PROBLEMA. El middleware resuelve el negocio activo desde el claim del
 * token y, cuando no está, preguntándole a la base (`contexto_sesion`). Esa
 * consulta puede FALLAR —red, la base saturada, un deploy a medias— y hasta
 * ahora un fallo se leía igual que un `null`: "no tiene negocio elegido". El
 * gate 4 mandaba entonces a `/seleccionar-negocio` o a `/empezar`, y las
 * dos páginas, viendo que la persona SÍ tiene negocio, la devolvían a `/`:
 *
 *   /                     → middleware: no pude resolver → /seleccionar-negocio
 *   /seleccionar-negocio  → page.tsx:15, un solo negocio → redirect /
 *   ...                   → ERR_TOO_MANY_REDIRECTS
 *
 * Es la misma forma del incidente de `salir-sesion.ts` con otro disparador:
 * dos lugares que responden la misma pregunta con distinta información y se
 * la pasan para siempre.
 *
 * LA SALIDA. Un fallo no puede terminar en un redirect. Se sirve esta pantalla
 * con REWRITE —la URL no cambia, así que no hay salto que pueda repetirse— y
 * se le ofrece a la persona lo único que sirve: reintentar, o salir y volver a
 * entrar.
 */
export const RUTA_SESION_INTERRUMPIDA = "/sesion-interrumpida";
