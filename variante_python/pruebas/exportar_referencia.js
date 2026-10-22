// Genera las salidas de referencia del motor de JavaScript (prototipo con n8n) para comprobar que el motor de Python
// da lo mismo con los mismos datos. Uso: node exportar_referencia.js
// Lee los casos de casos/*.json (los crea generar_casos.py) y los datos de ejemplo del prototipo, y escribe referencia/*.json.
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', '..', 'n8n_agentes', 'inventarios_js');
const codigo = ['00_lib.js', '01_motor.js', '02_informe.js'].map((f) => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n');
const E = new Function(codigo + '\nreturn { normalizar, calcularInventario, indicadores, armarInforme, armarEntradaIA, limpiarComentario, parsearFecha, parsearNumero, isoDe, clasificarTipo, detectarColumnas, inlineHtml };')();

// lector de CSV con comillas, equivalente al nodo "Extraer de archivo" de n8n
function csv(texto, sep) {
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  sep = sep || ',';
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') comillas = false; else campo += c; }
    else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); campo = ''; if (fila.length > 1 || fila[0] !== '') filas.push(fila); fila = []; }
    else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const [enc, ...cuerpo] = filas;
  return cuerpo.map((f) => Object.fromEntries(enc.map((h, i) => [h, f[i] ?? ''])));
}

function correr(nombre, filasMov, filasMae, cfg, mes) {
  const salida = { caso: nombre, mes };
  const datos = E.normalizar(filasMov, filasMae, { ...cfg, mapeo: cfg.mapeo || {}, mapeo_maestro: cfg.mapeo_productos && Object.keys(cfg.mapeo_productos).length ? cfg.mapeo_productos : (cfg.mapeo || {}) });
  if (datos.error) { salida.error = datos.error; return salida; }
  const res = E.calcularInventario(datos, { mes }, cfg.parametros || {});
  const ind = E.indicadores(res, res.P);
  salida.res = res;
  salida.ind = ind;
  salida.entrada_ia = E.armarEntradaIA(res, ind);
  salida.entrada_ia_json = JSON.stringify(salida.entrada_ia);
  const cfgInf = { fuente: cfg.fuente || 'csv', moneda: cfg.moneda || '$' };
  salida.informe = E.armarInforme({ res, ind, cfg: cfgInf, comentario: '', uso: null, tiempos: 0 });
  // segunda salida con comentario de IA y uso, para cubrir esas lineas del informe
  const entrada = JSON.stringify({ urgentes: ind.cuenta_acciones['COMPRAR URGENTE'] || 0, productos: ind.productos });
  const comentario = E.limpiarComentario('## Comentario del analista\nAtiende primero los urgentes. Hay ' + (ind.cuenta_acciones['COMPRAR URGENTE'] || 0) + ' urgentes y ' + ind.productos + ' productos. Ademas se ahorrarian 987654 pesos — seguro. ', entrada);
  salida.comentario = comentario;
  salida.informe_ia = E.armarInforme({ res, ind, cfg: cfgInf, comentario, uso: { llamadas: 1, entrada: 900, salida: 200, costo: 0.0019 }, tiempos: 12 });
  return salida;
}

const salidaDir = path.join(__dirname, 'referencia');
fs.mkdirSync(salidaDir, { recursive: true });
const guardar = (nombre, obj) => { fs.writeFileSync(path.join(salidaDir, nombre + '.json'), JSON.stringify(obj), 'utf8'); console.log(nombre, Math.round(fs.statSync(path.join(salidaDir, nombre + '.json')).size / 1024) + ' KB'); };

// 1. datos de ejemplo del prototipo (CSV)
const ej = path.join(JS, 'datos_ejemplo');
guardar('ejemplo', correr('ejemplo', csv(fs.readFileSync(path.join(ej, 'movimientos_ejemplo.csv'), 'utf8')), csv(fs.readFileSync(path.join(ej, 'maestro_ejemplo.csv'), 'utf8')), { fuente: 'csv', moneda: '$' }, '2026-09'));

// 2. casos generados (datos sucios, entradas y salidas separadas, bodegas, nombres hostiles)
const dirCasos = path.join(__dirname, 'casos');
for (const f of fs.readdirSync(dirCasos).filter((x) => x.endsWith('.json')).sort()) {
  const c = JSON.parse(fs.readFileSync(path.join(dirCasos, f), 'utf8'));
  guardar(f.replace('.json', ''), correr(f.replace('.json', ''), c.movimientos, c.maestro, c.cfg, c.mes));
}

// 3. funciones sueltas que el motor de Python debe reproducir
const fechas = ['2026-09-14', '14/09/2026', '09/14/2026', '14-09-2026', '14.09.2026', '2026/09/14', '2026-02-30', '2026-13-01', '2024-02-29', '2025-02-29', '31/12/2026', '1/1/2026', '2026-09', '46279', '46279.5', '2026-09-30T00:00:00.000Z', '', 'nada', '32/13/2026', '00/05/2026', '2026-9-3'];
const numeros = ['1.234,56', '1,234.56', '1.200', '1,5', '1,234', '12.5', '(5)', '-', '', 'abc', '1e3', '$ 1.000', '1_000', 'Infinity', '0x10', '1.234.567', '12,345,678', '-7,5', '  42 ', '.5', '5.'];
const tipos = ['VENTA', 'COMPRA', 'DEVOLUCION VENTA', 'Devolucion a proveedor', 'AJUSTE NEGATIVO', 'AJUSTE POSITIVO', 'SALDO INICIAL', 'Traslado entrada', 'Traslado salida', 'merma por vencimiento', 'Nota credito', 'Requisicion', 'xyz', ''];
const sueltas = {
  fechas: fechas.map((s) => [s, E.parsearFecha(s)]).concat([[46279, E.parsearFecha(46279)], [19000, E.parsearFecha(19000)], [90000, E.parsearFecha(90000)]]),
  fechas_mdy: fechas.map((s) => [s, E.parsearFecha(s, 'MDY')]),
  numeros: numeros.map((s) => [s, Number.isNaN(E.parsearNumero(s)) ? null : E.parsearNumero(s)]),
  tipos: tipos.flatMap((t) => [[t, 1, E.clasificarTipo(t, 1)], [t, -1, E.clasificarTipo(t, -1)]]),
  columnas: E.detectarColumnas(['Código', 'Fecha movimiento', 'Descripción', 'Tipo de movimiento', 'Cantidad', 'Costo', 'Existencia actual', 'Plazo de entrega (días)', 'Por recibir'], {}, ['sku', 'fecha', 'producto', 'tipo', 'cantidad', 'costo_unitario', 'stock_actual', 'lead_time_dias', 'en_transito']),
  dias: [0, 1, 19000, 46279 - 25569, 20000, 21000, 25000].map((n) => [n, E.isoDe(n)]),
  html: ['[a](https://ok.test/x) **negrita** `codigo` <b>x</b> https://sitio.test/a?b=1&c=2', '[clic](javascript:alert(1))', '[a](https://ok.test" onclick="alert(1))', '**<script>alert(1)</script>**', 'https://a.test/<img src=x>'].map((s) => [s, E.inlineHtml(s)]),
};
guardar('sueltas', sueltas);
