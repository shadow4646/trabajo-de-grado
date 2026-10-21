// Prueba de punta a punta del agente de inventarios con los datos de ejemplo (sin n8n y sin IA).
// Uso: node test_local.js [mes AAAA-MM]
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const leer = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const codigo = leer('00_lib.js') + '\n' + leer('01_motor.js') + '\n' + leer('02_informe.js');
const E = new Function(codigo + '\nreturn { normalizar, calcularInventario, indicadores, isoDe, armarInforme, limpiarComentario };')();

// lector de CSV con comillas, equivalente a lo que entrega el nodo "Extraer de archivo" de n8n
function csv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') comillas = false; else campo += c; }
    else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); campo = ''; if (fila.length > 1 || fila[0] !== '') filas.push(fila); fila = []; }
    else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const [enc, ...cuerpo] = filas;
  return cuerpo.map((f) => Object.fromEntries(enc.map((h, i) => [h, f[i] ?? ''])));
}

const mes = process.argv[2] || '2026-09';
const t0 = Date.now();
const datos = E.normalizar(csv(leer('datos_ejemplo/movimientos_ejemplo.csv')), csv(leer('datos_ejemplo/maestro_ejemplo.csv')), { mapeo: {} });
if (datos.error) { console.log('ERROR de lectura:', datos.error); process.exit(1); }
const res = E.calcularInventario(datos, { mes }, {});
const ind = E.indicadores(res, res.P);
const ms = Date.now() - t0;

console.log(`Mes ${mes}, corte ${E.isoDe(res.corte)}, ${datos.movs.length} movimientos, ${res.resultados.length} productos, ${ms} ms`);
console.log('Avisos:'); res.avisos.forEach((a) => console.log('  -', a));
const fmt = (x, n) => String(x === null || x === undefined ? '-' : x).slice(0, n).padEnd(n);
console.log(`\n${fmt('sku', 12)}${fmt('clase', 6)}${fmt('accion', 28)}${fmt('stock', 7)}${fmt('sal.mes', 8)}${fmt('d.cero', 7)}${fmt('cobert', 7)}${fmt('cant', 7)}${fmt('conf', 6)}${fmt('patron', 13)}`);
for (const r of [...res.resultados].sort((a, b) => a.accion.localeCompare(b.accion) || a.sku.localeCompare(b.sku))) {
  console.log(`${fmt(r.sku, 12)}${fmt(r.clase, 6)}${fmt(r.accion, 28)}${fmt(Math.round(r.stock), 7)}${fmt(Math.round(r.salidas_mes), 8)}${fmt(r.dias_en_cero, 7)}${fmt(r.cobertura === Infinity ? 'inf' : Math.round(r.cobertura), 7)}${fmt(r.cantidad, 7)}${fmt(r.confianza, 6)}${fmt(r.pron ? r.pron.patron : '', 13)}`);
}
console.log('\nIndicadores:', JSON.stringify({ acciones: ind.cuenta_acciones, valor_inv: Math.round(ind.valor_inventario), rotacion: ind.rotacion_anual && +ind.rotacion_anual.toFixed(1), dio: ind.dias_inventario && Math.round(ind.dias_inventario), tasa_quiebre: ind.tasa_quiebre && +ind.tasa_quiebre.toFixed(2), disp: ind.disponibilidad_ponderada && +ind.disponibilidad_ponderada.toFixed(3), muerto: Math.round(ind.valor_muerto), pct_muerto: ind.pct_muerto && +ind.pct_muerto.toFixed(3), compra: Math.round(ind.compra_total), pron: ind.pronostico }));

// ---- lo que el agente debe detectar en estos datos ----
const por = Object.fromEntries(res.resultados.map((r) => [r.sku, r]));
let fallos = 0;
const espera = (sku, cond, texto) => { if (!por[sku] || !cond(por[sku])) { fallos++; console.log(`FALLA ${sku}: ${texto} (obtuvo ${por[sku] ? por[sku].accion : 'sin resultado'})`); } };
espera('MOT-1HP', (r) => r.accion === 'COMPRAR URGENTE' && r.stock === 0, 'quiebre actual debe ser compra urgente');
espera('LAM-AC-2MM', (r) => r.stock === 0 && /URGENTE|PEDIDO EN CAMINO/.test(r.accion), 'sin stock con pedido en transito');
espera('ROD-6204', (r) => r.dias_en_cero > 0 && r.dias_en_cero < 30, 'quiebre dentro del mes y recuperado');
espera('ACE-HID-20L', (r) => r.accion === 'NUNCA SE MOVIO', 'nunca se movio');
espera('ETI-ADH-R', (r) => r.accion === 'NUNCA SE MOVIO', 'nunca se movio');
espera('SEL-MEC-A', (r) => r.accion === 'SIN MOVIMIENTO', 'sin movimiento hace meses');
espera('BAT-12V', (r) => r.accion === 'SIN MOVIMIENTO', 'sin movimiento hace meses');
espera('LIJ-80', (r) => r.accion === 'SOBRESTOCK', 'sobrestock');
espera('CAB-12AWG', (r) => /COMPRAR/.test(r.accion), 'stock bajo con demanda estable');
espera('FIL-AIR-X', (r) => r.clase === 'N' && r.confianza !== 'ALTA', 'producto nuevo sin historial suficiente');
espera('MAN-HID-12', (r) => r.pron.patron === 'intermitente' || r.pron.patron === 'irregular', 'demanda intermitente');
espera('FANTASMA-01', (r) => r.accion === 'REVISAR DATOS', 'sin stock conocido no se recomienda comprar');
espera('TUB-PVC-2', (r) => r.transito === 200, 'pedido en transito considerado');
// ---- informe ----
const comentarioIA = '## Comentario del analista\nAtiende primero los productos urgentes y los que siguen en cero. El capital inmovilizado es de 3779 en 5 productos y debe revisarse. Ademas se ahorrarian 999999 pesos. ';
const entradaIA = JSON.stringify({ urgentes: ind.cuenta_acciones['COMPRAR URGENTE'], muerto: Math.round(ind.valor_muerto), n: 5 });
const limpio = E.limpiarComentario(comentarioIA, entradaIA);
if (/999999/.test(limpio) || !/3779/.test(limpio)) { fallos++; console.log('FALLA: el filtro de cifras del comentario no funciona:', limpio); }
const inf = E.armarInforme({ res, ind, cfg: { fuente: 'csv', moneda: '$' }, comentario: limpio, uso: { llamadas: 1, entrada: 900, salida: 200, costo: 0.002 }, tiempos: ms });
fs.writeFileSync(path.join(dir, '_prueba_informe.md'), inf.md, 'utf8');
fs.writeFileSync(path.join(dir, '_prueba_informe.html'), inf.html, 'utf8');
fs.writeFileSync(path.join(dir, '_prueba_pedido.csv'), inf.csvPedido, 'utf8');
fs.writeFileSync(path.join(dir, '_prueba_detalle.csv'), inf.csvDetalle, 'utf8');
fs.writeFileSync(path.join(dir, '_prueba_chat.md'), inf.chat, 'utf8');
const dashes = (inf.md + inf.chat).split('').filter((c) => c === String.fromCharCode(0x2014) || c === String.fromCharCode(0x2013)).length;
if (dashes) { fallos++; console.log('FALLA: hay guiones largos en el informe'); }
if (/undefined|NaN|\[object/.test(inf.md + inf.chat)) { fallos++; console.log('FALLA: el informe contiene undefined, NaN u [object]:', ((inf.md + inf.chat).match(/.{0,40}(undefined|NaN|\[object).{0,40}/) || [''])[0]); }
// ---- inyeccion de formulas en los CSV: textos hostiles que vienen del sistema de inventario ----
const maeHostil = csv(leer('datos_ejemplo/maestro_ejemplo.csv'));
maeHostil[0].producto = '=HYPERLINK("http://evil.test","clic")';
maeHostil[0].proveedor = '@SUM(A1:A9)';
maeHostil[1].producto = "+cmd|' /C calc'!A0";
maeHostil[2].producto = '-2+3';
maeHostil[3].proveedor = '\t=1+1';
maeHostil[4].producto = 'Tornillo, =1+1';
maeHostil[5].proveedor = 'Acme; @SUM(A1:A9)';
maeHostil[6].producto = 'Pieza ,-2+3 mas';
maeHostil[7].producto = 'Item\n=HYPERLINK("http://evil.test")';
const datosHostiles = E.normalizar(csv(leer('datos_ejemplo/movimientos_ejemplo.csv')), maeHostil, { mapeo: {} });
const resHostil = E.calcularInventario(datosHostiles, { mes }, {});
const infHostil = E.armarInforme({ res: resHostil, ind: E.indicadores(resHostil, resHostil.P), cfg: { fuente: 'csv', moneda: '$' }, comentario: '', uso: null, tiempos: 0 });
// Se simula el peor caso: abrir el archivo con CUALQUIER separador (coma, punto y coma, tabulador, salto de linea).
// Ninguna celda resultante puede empezar con = + - @ salvo que sea un numero puro.
for (const [nombre, texto] of [['pedido', infHostil.csvPedido], ['detalle', infHostil.csvDetalle]]) {
  const celdas = texto.replace(/^﻿/, '').split(/[,;\t\r\n]/);
  const peligrosas = celdas.filter((c) => /^\s*"?\s*[=@+\-]/.test(c) && !/^\s*"?-?\d+([.,]\d+)?"?\s*$/.test(c));
  if (peligrosas.length) { fallos++; console.log(`FALLA: el CSV de ${nombre} tiene celdas que Excel leeria como formula con algun separador:`, peligrosas.slice(0, 4)); }
}
if (!infHostil.csvDetalle.includes("'=HYPERLINK") || !infHostil.csvDetalle.includes("'@SUM")) { fallos++; console.log('FALLA: los textos hostiles no quedaron neutralizados con la comilla simple'); }

console.log(`informe: ${inf.md.length} caracteres, resumen ${JSON.stringify(inf.resumen)}`);
console.log(`\ntest_local: fallos ${fallos}`);
process.exit(fallos ? 1 : 0);
