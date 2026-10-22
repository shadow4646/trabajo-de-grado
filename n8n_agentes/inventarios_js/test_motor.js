// Pruebas del motor de inventarios con resultados conocidos. Uso: node test_motor.js
const fs = require('fs');
const path = require('path');
const codigo = fs.readFileSync(path.join(__dirname, '00_lib.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '01_motor.js'), 'utf8');
const M = new Function(codigo + '\nreturn { parsearFecha, parsearNumero, detectarColumnas, clasificarTipo, normalizar, construirSerie, agregarMeses, demandaAjustada, crostonSBA, pronosticar, stockSeguridad, politica, calcularInventario, indicadores, backtest, DEFECTOS, diaNum, isoDe, mesIndice };')();
let fallos = 0;
const ok = (nombre, cond, detalle) => { if (!cond) { fallos++; console.log(`FALLA ${nombre}${detalle !== undefined ? ': ' + detalle : ''}`); } };
const cerca = (nombre, a, b, tol) => ok(nombre, Math.abs(a - b) <= (tol === undefined ? 0.01 : tol), `obtenido ${a}, esperado ${b}`);

// ---- formulas contra los ejemplos de la investigacion (research_inventario.md) ----
// Ejemplo 1: demanda 100/semana, sigma 20/semana, plazo 3 semanas, Z 1,645: SS = 57
cerca('SS ejemplo 1', M.stockSeguridad({ n: 12, sigma: 20 * Math.sqrt(30 / 7), demandaMes: (100 * 30) / 7, sigmaL: 0, Z: 1.645 }, 21), 57, 0.6);
// Ejemplo 2: demanda 50/dia, plazo 7 dias con sigma 2, sigma diaria 10, Z 1,65: SS = 171 y ROP = 521
const ss2 = M.stockSeguridad({ n: 12, sigma: 10 * Math.sqrt(30), demandaMes: 1500, sigmaL: 2, Z: 1.65 }, 7);
cerca('SS ejemplo 2', ss2, 171, 0.6);
cerca('ROP ejemplo 2', 50 * 7 + ss2, 521, 0.6);
// Con menos de 6 meses se usa el metodo simplificado (maximo menos promedio)
cerca('SS metodo simple', M.stockSeguridad({ n: 4, sigma: 10, demandaMes: 100, maximo: 130, Z: 2 }, 15), 15, 0.001);

// ---- lectura de datos ----
ok('fecha dd/mm/aaaa', M.isoDe(M.parsearFecha('14/09/2026').dia) === '2026-09-14');
ok('fecha serie Excel', M.isoDe(M.parsearFecha(46279).dia) === '2026-09-14');
ok('fecha con hora', M.isoDe(M.parsearFecha('2026-09-30T00:00:00.000Z').dia) === '2026-09-30');
ok('fecha mensual', M.parsearFecha('2026-09').mensual === true);
ok('fecha invalida', M.parsearFecha('nada') === null);
ok('numero latino', M.parsearNumero('1.234,56') === 1234.56);
ok('numero ingles', M.parsearNumero('1,234.56') === 1234.56);
ok('numero miles', M.parsearNumero('1.200') === 1200);
ok('numero texto', Number.isNaN(M.parsearNumero('abc')));
const tipos = { VENTA: 'salida', COMPRA: 'entrada', 'DEVOLUCION VENTA': 'devolucion_cliente', 'Devolucion a proveedor': 'devolucion_proveedor', 'AJUSTE NEGATIVO': 'ajuste_neg', 'AJUSTE POSITIVO': 'ajuste_pos', 'SALDO INICIAL': 'saldo_inicial', 'Traslado entrada': 'traslado_entrada', 'merma por vencimiento': 'ajuste_neg', xyz: 'desconocido' };
Object.entries(tipos).forEach(([t, e]) => ok(`tipo ${t}`, M.clasificarTipo(t, 1) === e, M.clasificarTipo(t, 1)));
const cols = M.detectarColumnas(['Código', 'Fecha movimiento', 'Descripción', 'Tipo de movimiento', 'Cantidad', 'Costo'], {}, ['sku', 'fecha', 'producto', 'tipo', 'cantidad', 'costo_unitario']);
ok('columnas en espanol', cols.sku === 'Código' && cols.fecha === 'Fecha movimiento' && cols.tipo === 'Tipo de movimiento' && cols.cantidad === 'Cantidad' && cols.costo_unitario === 'Costo', JSON.stringify(cols));
const colsMae = M.detectarColumnas(['Código', 'Descripción', 'Unidad', 'Existencia actual', 'Costo', 'Plazo de entrega (días)', 'Pedido mínimo', 'Por recibir', 'Proveedor'], {}, ['sku', 'producto', 'unidad', 'stock_actual', 'costo_unitario', 'lead_time_dias', 'moq', 'en_transito', 'proveedor']);
ok('todas las columnas del maestro en espanol', Object.keys(colsMae).length === 9 && colsMae.en_transito === 'Por recibir' && colsMae.lead_time_dias === 'Plazo de entrega (días)' && colsMae.stock_actual === 'Existencia actual', JSON.stringify(colsMae));
const cm = M.detectarColumnas(['ID', 'Cant'], { sku: 'ID', cantidad: 'Cant' }, ['sku', 'cantidad']);
ok('mapeo manual', cm.sku === 'ID' && cm.cantidad === 'Cant');
const sinCols = M.normalizar([{ a: 1 }], [], { mapeo: {} });
ok('columnas faltantes se avisan', !!sinCols.error);

// ---- saldo diario y dias en cero ----
const d0 = M.diaNum('2026-09-01');
const EFECTO = { entrada: 1, salida: -1, saldo_inicial: 1 };
const mov = (dia, tipo, cant, saldo) => ({ idx: dia, dia: d0 + dia, tipo, cantidad: cant, efecto: EFECTO[tipo] * cant, saldo: saldo === undefined ? null : saldo, key: 'A', sku: 'A' });
const ledger = [mov(0, 'saldo_inicial', 10), mov(2, 'salida', 6), mov(5, 'salida', 4), mov(9, 'entrada', 20), mov(12, 'salida', 5)];
const s1 = M.construirSerie(ledger, 15, d0 + 14);
ok('base stock_actual', s1.base === 'stock_actual');
ok('saldo reconstruido final', s1.bal[14] === 15, s1.bal[14]);
ok('saldo reconstruido dia 5', s1.bal[5] === 0, s1.bal[5]);
const conSaldo = [mov(0, 'saldo_inicial', 10, 10), mov(2, 'salida', 6, 4), mov(5, 'salida', 4, 0), mov(9, 'entrada', 20, 20), mov(12, 'salida', 5, 15)];
const s2 = M.construirSerie(conSaldo, 14, d0 + 14);
ok('base saldo', s2.base === 'saldo');
cerca('descuadre detectado', s2.descuadre, -1, 0.001);
const s3 = M.construirSerie(ledger, null, d0 + 14);
ok('sin ancla', s3.base === 'asumido_cero');
const meses = M.agregarMeses(ledger, s1, '2026-09', 2, d0 + 14, true);
const sep = meses[meses.length - 1];
ok('dias en cero (5 al 8)', sep.dias_en_cero === 4, sep.dias_en_cero);
ok('salidas del mes', sep.salidas === 15, sep.salidas);
ok('dias con salida', sep.dias_con_salida === 3, sep.dias_con_salida);

// ---- demanda censurada ----
const P = M.DEFECTOS;
cerca('demanda ajustada con 10 dias en cero', M.demandaAjustada({ activos: 30, dias_mes: 30, demanda_neta: 100, dias_en_cero: 10 }, P), 150, 0.001);
cerca('tope del ajuste (parametro)', M.demandaAjustada({ activos: 30, dias_mes: 30, demanda_neta: 100, dias_en_cero: 15 }, { ...P, tope_censura: 1.5 }), 150, 0.001);
ok('mas de la mitad en cero es dato faltante', M.demandaAjustada({ activos: 30, dias_mes: 30, demanda_neta: 100, dias_en_cero: 16 }, P) === null);
ok('mes parcial corto se excluye', M.demandaAjustada({ activos: 10, dias_mes: 30, demanda_neta: 5, dias_en_cero: 0 }, P) === null);
cerca('mes parcial largo se escala', M.demandaAjustada({ activos: 20, dias_mes: 30, demanda_neta: 20, dias_en_cero: 0 }, P), 30, 0.001);

// ---- pronostico y patron ----
cerca('Croston SBA', M.crostonSBA([0, 0, 10, 0, 0, 10, 0, 0, 10], 0.2), 0.9 * (10 / 3), 0.001);
ok('patron suave', M.pronosticar([100, 105, 98, 102, 101, 99, 103], P).patron === 'suave');
ok('patron intermitente', M.pronosticar([0, 0, 10, 0, 0, 11, 0, 0, 9, 0], P).patron === 'intermitente');
ok('patron irregular', M.pronosticar([0, 0, 2, 0, 0, 40, 0, 0, 5, 0], P).patron === 'irregular');
ok('patron erratico', M.pronosticar([10, 90, 15, 80, 5, 70], P).patron === 'erratica');
ok('pocos datos', M.pronosticar([5, 6], P).confianza === 'BAJA');
ok('metodo SES con 6 o mas', /exponencial/.test(M.pronosticar([10, 12, 11, 13, 12, 14, 13], P).metodo));
ok('metodo SMA con 3 a 5', /movil/.test(M.pronosticar([10, 12, 11, 13], P).metodo));

// ---- politica (R,S) ----
const base = { demandaMes: 300, sigma: 30, maximo: 340, n: 12, Z: 1.645, L: 15, sigmaL: 0, R: 30, moq: 10 };
const polA = M.politica({ ...base, stock: 500, transito: 0 }, P);
ok('sin compra con stock alto (queda sobre el punto de reorden al proximo corte)', !polA.comprar, JSON.stringify(polA));
ok('con 400 si pide: al proximo corte quedaria en 100, bajo el punto de reorden', M.politica({ ...base, stock: 400, transito: 0 }, P).comprar);
const polB = M.politica({ ...base, stock: 120, transito: 0 }, P);
ok('compra con stock bajo', polB.comprar && polB.cantidad > 0 && polB.cantidad % 10 === 0, JSON.stringify(polB));
const polC = M.politica({ ...base, stock: 120, transito: 400 }, P);
ok('el pedido en transito evita la compra', !polC.comprar);
ok('el stock de seguridad sube el nivel objetivo', polB.S > 10 * (15 + 30));
ok('urgente si la cobertura es menor que el plazo', M.politica({ ...base, stock: 100, transito: 0 }, P).urgente);
const polD = M.politica({ ...base, stock: 200, transito: 0 }, P);
ok('compra aunque la cobertura supere el plazo (la revision es mensual)', polD.comprar && polD.cobertura > 15, JSON.stringify(polD));

// ---- datos sucios: lo que traen los sistemas reales ----
const fila = (f, s, t, c, extra) => ({ Fecha: f, Codigo: s, Tipo: t, Cantidad: c, ...(extra || {}) });
const conTipos = M.normalizar([fila('2026-09-01', 'A', 'VENTA', 5), fila('2026-09-02', 'A', 'Cosa rara', 3), fila('fecha mala', 'A', 'VENTA', 1), fila('2026-09-03', '', 'VENTA', 1), fila('2026-09-04', 'A', 'VENTA', 'abc'), fila('2026-09-05', 'A', 'VENTA', 0)], [], { mapeo: {} });
ok('normalizar usa solo las filas validas', conTipos.movs.length === 1, conTipos.movs && conTipos.movs.length);
const desc = conTipos.calidad.descartadas;
ok('se cuentan los descartes por motivo', Object.keys(desc).length === 5 && Object.keys(desc).some((k) => /tipo de movimiento no reconocido/.test(k)) && desc['fecha invalida'] === 1 && desc['sin codigo de producto'] === 1 && desc['cantidad invalida'] === 1 && desc['cantidad cero'] === 1, JSON.stringify(desc));
const separadas = M.normalizar([{ Fecha: '2026-09-01', Codigo: 'A', Entradas: 10, Salidas: '' }, { Fecha: '2026-09-02', Codigo: 'A', Entradas: '', Salidas: 4 }], [], { mapeo: {} });
ok('columnas separadas de entrada y salida', separadas.movs.length === 2 && separadas.movs[0].tipo === 'entrada' && separadas.movs[1].tipo === 'salida', JSON.stringify(separadas.movs.map((m) => m.tipo)));
const sinTipo = M.normalizar([{ Fecha: '2026-09-01', Codigo: 'A', Cantidad: 10 }, { Fecha: '2026-09-02', Codigo: 'A', Cantidad: -4 }], [], { mapeo: {} });
ok('sin columna de tipo se usa el signo y se avisa', sinTipo.movs[1].tipo === 'salida' && sinTipo.avisos.some((a) => /columna de tipo/.test(a)));
const mensual = M.normalizar([{ Fecha: '2026-08', Codigo: 'A', Tipo: 'VENTA', Cantidad: 10 }, { Fecha: '2026-09', Codigo: 'A', Tipo: 'VENTA', Cantidad: 12 }], [], { mapeo: {} });
ok('fechas por mes se detectan y se avisa', mensual.calidad.granularidad_mensual && mensual.avisos.some((a) => /por mes/.test(a)));
const resMensual = M.calcularInventario(mensual, { mes: '2026-09' }, {});
ok('con fechas por mes no se inventan quiebres', resMensual.resultados.every((r) => r.dias_en_cero === null || r.dias_en_cero === undefined));
const bodegas = M.normalizar([fila('2026-09-01', 'A', 'VENTA', 2, { Bodega: 'Norte', Saldo: 5 }), fila('2026-09-02', 'A', 'VENTA', 2, { Bodega: 'Sur', Saldo: 9 })], [], { mapeo: {} });
ok('varias bodegas sumadas avisan y no usan el saldo', bodegas.avisos.some((a) => /bodegas/.test(a)) && bodegas.movs.every((m) => m.saldo === null));
const conDoc = M.normalizar([fila('2026-09-01', 'A', 'VENTA', 2, { Documento: 'F-1' }), fila('2026-09-01', 'A', 'VENTA', 2, { Documento: 'F-1' }), fila('2026-09-01', 'A', 'VENTA', 2, { Documento: 'F-2' })], [], { mapeo: {} });
ok('duplicado exacto con el mismo documento se descarta', conDoc.movs.length === 2, conDoc.movs.length);
const sinDoc = M.normalizar([fila('2026-09-01', 'A', 'VENTA', 2), fila('2026-09-01', 'A', 'VENTA', 2)], [], { mapeo: {} });
ok('filas identicas sin documento se avisan pero no se borran', sinDoc.movs.length === 2 && sinDoc.avisos.some((a) => /identicas/.test(a)));
const maeIncompleto = M.normalizar([fila('2026-09-01', 'A', 'VENTA', 2)], [{ Codigo: 'A', Nombre: 'Algo' }], { mapeo: {} });
ok('avisa que columnas utiles del maestro no se reconocieron', maeIncompleto.avisos.some((a) => /no se reconocieron/.test(a) && /plazo de entrega/.test(a)), JSON.stringify(maeIncompleto.avisos));
const serie1 = M.normalizar([{ Fecha: 46279, Codigo: 'A', Tipo: 'VENTA', Cantidad: 3 }], [], { mapeo: {} });
ok('fecha serie Excel en una fila', M.isoDe(serie1.movs[0].dia) === '2026-09-14');
const conSaldoNeg = M.normalizar([fila('2026-09-01', 'A', 'COMPRA', 5, { Saldo: 5 }), fila('2026-09-02', 'A', 'VENTA', 9, { Saldo: -4 })], [{ Codigo: 'A', Existencia: 0, Costo: 1, 'Plazo de entrega': 10 }], { mapeo: {} });
const rNeg = M.calcularInventario(conSaldoNeg, { mes: '2026-09' }, {});
ok('saldo negativo del kardex se reporta', rNeg.calidad.saldo_negativo.length === 1 && rNeg.calidad.saldo_negativo[0] === 'A', JSON.stringify(rNeg.calidad.saldo_negativo));
ok('descuadre entre el saldo del kardex y el maestro se reporta', rNeg.calidad.descuadres.length === 1 && rNeg.calidad.descuadres[0].diferencia === 4, JSON.stringify(rNeg.calidad.descuadres));
ok('el stock negativo se trata como cero en la decision', rNeg.resultados[0].stock === 0);

// ---- volumen: Math.max(...lista) revienta con unos 125 mil argumentos; un kardex de empresa grande los supera ----
const grande = [];
for (let i = 0; i < 200000; i++) grande.push(fila(`2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`, 'A', 'VENTA', 1));
let errGrande = null;
let msGrande = 0;
try {
  const t0 = Date.now();
  const dg = M.normalizar(grande, [{ Codigo: 'A', Existencia: 10, Costo: 1, 'Plazo de entrega': 7 }], { mapeo: {} });
  M.calcularInventario(dg, { mes: '2026-09' }, {});
  msGrande = Date.now() - t0;
} catch (e) { errGrande = e.message; }
ok('un kardex de 200 mil movimientos no rompe el motor', errGrande === null, errGrande);
console.log(`kardex de 200000 movimientos: ${errGrande === null ? msGrande + ' ms' : 'ERROR'}`);

console.log(`test_motor: fallos ${fallos}`);
process.exit(fallos ? 1 : 0);
