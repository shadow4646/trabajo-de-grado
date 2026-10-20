// Nodo "Pedir datos": respuesta cuando el mensaje no trae ningun producto.
const p = $('Armar plan').first().json;
const vacio = !p.solicitud_texto;
const msg = (vacio ? 'Tu mensaje llego vacio. ' : 'No identifique un producto en tu mensaje. ')
  + 'Para buscar necesito, como minimo, el producto con su especificacion. Ayuda mucho agregar: cantidad por pedido y cantidad anual, pais y ciudad de destino, si compras al por mayor o al detal, y requisitos de calidad o certificaciones.\n\n'
  + 'Tambien puedes elegir el modo: escribe "rapida" (por defecto) o "profunda" (mas fuentes, mas verificacion, mas tiempo).\n\n'
  + 'Ejemplo: profunda: harina de trigo panadera, 5 toneladas por pedido, 60 toneladas al ano, destino Bogota, Colombia, al por mayor, con registro INVIMA.';
return [{ json: { output: msg } }];
