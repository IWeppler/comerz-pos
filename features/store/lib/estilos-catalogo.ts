/**
 * El botón de acción del catálogo público: foreground, como el footer de la
 * tienda. El catálogo no usa el azul del sistema (`primary`), que sigue siendo
 * el del panel y el POS. Una constante y no una clase por botón, para que
 * "Añadir al carrito", "Finalizar compra", "Aplicar" y el resto no se separen.
 *
 * El único color del catálogo es el naranja del logo (`--marca-naranja`, ver
 * globals.css), en la barra de envío gratis.
 */
export const BOTON_CATALOGO =
  "bg-foreground text-background hover:bg-foreground/90 disabled:bg-foreground/40";
