// Pruebas de la logica de clasificacion del pipeline. Uso: node test_logica.js
const fs = require('fs');
const path = require('path');
const lib = new Function(fs.readFileSync(path.join(__dirname, '00_lib.js'), 'utf8') + '\nreturn { hablaDelProducto, monedaProbable, norm };')();
let fallos = 0;
const verificar = (nombre, obtenido, esperado) => { if (obtenido !== esperado) { fallos++; console.log(`FALLA ${nombre}: esperaba ${esperado}, dio ${obtenido}`); } };

const carne = { producto: 'carne rib eye', nombre_en: 'rib eye beef', sinonimos: ['ojo de bife'] };
const harina = { producto: 'harina de trigo panadera', nombre_en: 'bakery wheat flour', sinonimos: ['harina panificable'] };
[
  [carne, 'Rib Eye Steak Angus 400 g, precio $26.000', true], [carne, 'Ribeye americano por kilo', true], [carne, 'Ojo de bife premium', true],
  [carne, 'Cortes: rib-eye, lomo fino, punta de anca', true], [carne, 'Tenemos la mejor carne de res para tu asado', false], [carne, 'Receta de arroz con pollo', false],
  [harina, 'Harina de trigo panadera Indupan', true], [harina, 'Harina panificable 000 x kg', true], [harina, 'Wheat flour bakery grade', true],
  [harina, 'Aceite de palma refinado', false], [harina, 'trigo duro para pasta', false],
].forEach(([plan, texto, esperado]) => verificar(`habla "${texto}"`, lib.hablaDelProducto(plan, lib.norm(texto)), esperado));

[
  ['Carnes en Bogota Colombia. Envios a Medellin', 'exito.com', 'COP'], ['Envios en CDMX y Monterrey, Mexico, precios en MXN', 'carnesjc.com', 'MXN'],
  ['hola', 'tienda.com', null], ['x', 'tienda.co', 'COP'], ['x', 'tienda.com.mx', 'MXN'],
].forEach(([texto, dom, esperado]) => verificar(`moneda ${dom}`, lib.monedaProbable(texto, dom), esperado));

console.log(`test_logica: fallos ${fallos}`);
process.exit(fallos ? 1 : 0);
