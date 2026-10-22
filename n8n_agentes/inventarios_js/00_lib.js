// Biblioteca comun del agente de inventarios. El generador la antepone a cada nodo Code (los nodos no pueden importar modulos).
// OJO: el entorno aislado de los nodos Code de n8n no trae URL, URLSearchParams, AbortController ni fetch.
const MODELO = 'claude-haiku-4-5-20251001';
const PRECIO_MTOK = { entrada: 1.0, salida: 5.0 }; // USD por millon de tokens; referencia de terceros, no oficial
const CARPETA_INFORMES = 'C:\\Users\\monca\\.n8n-files\\informes';

// ---------- utilidades de texto ----------
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const clave = (s) => norm(s).replace(/\b(de|del|la|el|los|las|en|por)\b/g, '').replace(/[^a-z0-9]/g, '');
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sinGuiones = (t) => String(t ?? '').replace(/\s*[\u2014\u2013]\s*/g, ', ');
const celda = (t) => String(t ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
const trozos = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const slug = (t) => norm(t).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'informe';

function extraerJson(texto) {
  const t = String(texto ?? '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}

// Markdown en linea a HTML en una sola pasada; texto y URLs se escapan por separado (los textos vienen de archivos ajenos).
function inlineHtml(t) {
  const formato = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const urlValida = (u) => /^https?:\/\/[^\s"'<>`\\]+$/i.test(u);
  const texto = String(t ?? '');
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<)]+)/g;
  const partes = [];
  let ultimo = 0;
  let m;
  while ((m = re.exec(texto))) {
    partes.push(formato(esc(texto.slice(ultimo, m.index))));
    const url = m[2] || m[3];
    partes.push(urlValida(url) ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(m[1] || url)}</a>` : esc(m[0]));
    ultimo = re.lastIndex;
  }
  partes.push(formato(esc(texto.slice(ultimo))));
  return partes.join('');
}

// ---------- fechas (todo en UTC y con numeros de dia, para no depender de la zona horaria) ----------
const MS_DIA = 86400000;
const diaNum = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_DIA) : null; };
const isoDe = (n) => new Date(n * MS_DIA).toISOString().slice(0, 10);
const mesDeDia = (n) => isoDe(n).slice(0, 7);
const mesIndice = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
const mesDeIndice = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const diasDelMes = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const primerDiaMes = (ym) => diaNum(`${ym}-01`);
const ultimoDiaMes = (ym) => primerDiaMes(ym) + diasDelMes(ym) - 1;
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

// Devuelve { dia, mensual } o null. Acepta ISO, AAAA/MM/DD, DD/MM/AAAA (o MM/DD/AAAA si se pide), AAAA-MM y numeros de serie de Excel.
function parsearFecha(v, formato) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : { dia: Math.floor(v.getTime() / MS_DIA), mensual: false };
  if (typeof v === 'number') return (v > 20000 && v < 80000) ? { dia: Math.floor(v) - 25569, mensual: false } : null;
  const s = String(v).trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)) || (m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s))) {
    const dia = diaNum(`${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`);
    return dia === null ? null : { dia, mensual: false };
  }
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s))) {
    let d = +m[1];
    let mm = +m[2];
    if (formato === 'MDY' || (mm > 12 && d <= 12)) { const x = d; d = mm; mm = x; }
    if (mm < 1 || mm > 12 || d < 1 || d > 31) return null;
    return { dia: diaNum(`${m[3]}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`), mensual: false };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(s))) return { dia: diaNum(`${m[1]}-${m[2]}-15`), mensual: true };
  if (/^\d{5}(\.\d+)?$/.test(s)) return parsearFecha(Number(s), formato);
  return null;
}

// Numeros en formato latino (1.234,56) o ingles (1,234.56); devuelve NaN si no es un numero.
function parsearNumero(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim().replace(/[\s$€£]/g, '');
  if (s === '' || s === '-') return NaN;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/^\(|\)$/g, '');
  const punto = s.lastIndexOf('.');
  const coma = s.lastIndexOf(',');
  if (punto >= 0 && coma >= 0) s = punto > coma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  else if (coma >= 0) s = /,\d{1,2}$/.test(s) && (s.match(/,/g) || []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
  else if (punto >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  // Number("0x10") da 16 y Number("0b11") da 3: solo se aceptan numeros decimales normales (el motor de Python hace lo mismo)
  const n = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : NaN;
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

// ---------- deteccion de columnas ----------
const SINONIMOS = {
  fecha: ['fecha', 'date', 'dia', 'fechamovimiento', 'fechamov', 'fechadocumento', 'fechatransaccion'],
  sku: ['sku', 'codigo', 'cod', 'referencia', 'ref', 'item', 'idproducto', 'productoid', 'codigoproducto', 'codproducto', 'codigoarticulo', 'articulo', 'producto'],
  producto: ['producto', 'nombre', 'descripcion', 'nombreproducto', 'itemname', 'articulo', 'descripcionproducto'],
  tipo: ['tipo', 'tipomovimiento', 'movimiento', 'concepto', 'operacion', 'transaccion', 'clasemovimiento', 'tipodocumento'],
  cantidad: ['cantidad', 'qty', 'unidades', 'cant', 'quantity', 'cantidadmovimiento'],
  entrada: ['entrada', 'entradas', 'ingreso', 'ingresos', 'compras', 'recibido'],
  salida: ['salida', 'salidas', 'egreso', 'egresos', 'ventas', 'despachado', 'consumo'],
  costo_unitario: ['costounitario', 'costo', 'preciocosto', 'costopromedio', 'unitcost', 'cost', 'valorunitario'],
  saldo: ['saldo', 'saldofinal', 'saldoposterior', 'existenciaposterior', 'balance'],
  stock_actual: ['stockactual', 'stock', 'existencia', 'existencias', 'existenciaactual', 'inventario', 'disponible', 'onhand', 'cantidadactual'],
  unidad: ['unidad', 'um', 'unidadmedida', 'uom'],
  lead_time_dias: ['leadtimedias', 'leadtime', 'plazoentrega', 'diasentrega', 'tiempoentrega', 'plazodias'],
  lead_time_desv_dias: ['leadtimedesvdias', 'desvleadtime', 'desviacionleadtime'],
  moq: ['moq', 'minimocompra', 'cantidadminima', 'multiplo', 'pedidominimo'],
  en_transito: ['entransito', 'por recibir', 'pedidopendiente', 'ordenado', 'pendienterecibir', 'pedido en camino', 'ordenes abiertas'],
  fecha_llegada_transito: ['fechallegadatransito', 'fechaestimadallegada', 'fechallegada'],
  proveedor: ['proveedor', 'vendor', 'supplier'],
  activo: ['activo', 'estado', 'active'],
  motivo: ['motivo', 'razon', 'causa', 'observacion'],
  bodega: ['bodega', 'almacen', 'warehouse', 'ubicacion', 'sede'],
  vida_util_dias: ['vidautildias', 'vidautil', 'diasvencimiento'],
  documento: ['documento', 'numerodocumento', 'nrodocumento', 'factura', 'consecutivo'],
};

// Devuelve { campo: nombreDeColumnaReal }. El mapeo del usuario manda sobre la deteccion automatica.
function detectarColumnas(encabezados, mapeoUsuario, campos) {
  const porClave = new Map(encabezados.map((h) => [clave(h), h]));
  const out = {};
  const usadas = new Set();
  const manual = mapeoUsuario || {};
  for (const campo of campos) {
    if (manual[campo]) {
      const h = encabezados.find((x) => x === manual[campo]) || porClave.get(clave(manual[campo]));
      if (h) { out[campo] = h; usadas.add(h); continue; }
    }
    for (const sinonimo of SINONIMOS[campo] || [campo]) {
      const h = porClave.get(clave(sinonimo));
      if (h && !usadas.has(h)) { out[campo] = h; usadas.add(h); break; }
    }
  }
  // Segunda pasada: encabezados que contienen un sinonimo largo y especifico ("Plazo de entrega (dias)", "Existencia actual")
  for (const campo of campos) {
    if (out[campo]) continue;
    for (const sinonimo of (SINONIMOS[campo] || []).map(clave).filter((s) => s.length >= 8)) {
      const h = encabezados.find((x) => !usadas.has(x) && clave(x).includes(sinonimo));
      if (h) { out[campo] = h; usadas.add(h); break; }
    }
  }
  return out;
}

// ---------- tipos de movimiento ----------
// efecto sobre el saldo y papel en la demanda; solo 'salida' y 'devolucion_cliente' cuentan para la demanda
const EFECTO_TIPO = { entrada: 1, saldo_inicial: 1, devolucion_cliente: 1, ajuste_pos: 1, traslado_entrada: 1, salida: -1, devolucion_proveedor: -1, ajuste_neg: -1, traslado_salida: -1 };

function clasificarTipo(texto, cantidadConSigno) {
  const t = norm(texto);
  if (!t) return cantidadConSigno < 0 ? 'salida' : (cantidadConSigno > 0 ? 'entrada' : 'desconocido');
  if (/saldo inicial|inventario inicial|apertura|existencia inicial/.test(t)) return 'saldo_inicial';
  if (/devol/.test(t) && /(cliente|venta|consumidor)/.test(t)) return 'devolucion_cliente';
  if (/devol/.test(t) && /(proveedor|compra)/.test(t)) return 'devolucion_proveedor';
  if (/nota credito/.test(t)) return 'devolucion_cliente';
  if (/devol/.test(t)) return cantidadConSigno < 0 ? 'devolucion_proveedor' : 'devolucion_cliente';
  if (/(traslado|transferencia)/.test(t)) {
    if (/(entrada|ingreso|recib|destino)/.test(t)) return 'traslado_entrada';
    if (/(salida|egreso|origen|envio)/.test(t)) return 'traslado_salida';
    return cantidadConSigno < 0 ? 'traslado_salida' : 'traslado_entrada';
  }
  if (/ajuste|sobrante|faltante|merma|averia|dano|baja de|vencimiento|vencido|perdida|robo|conteo|toma fisica/.test(t)) {
    if (/(positiv|sobrante|\+|entrada|aumento)/.test(t)) return 'ajuste_pos';
    if (/(negativ|faltante|merma|averia|dano|baja|vencimiento|vencido|perdida|robo|-|salida)/.test(t)) return 'ajuste_neg';
    return cantidadConSigno < 0 ? 'ajuste_neg' : 'ajuste_pos';
  }
  if (/compra|entrada|ingreso|recepcion|recibo|produccion|importacion|reposicion|reintegro/.test(t)) return 'entrada';
  if (/venta|salida|consumo|despacho|egreso|remision|factura|requisicion|entrega|pedido cliente|gasto/.test(t)) return 'salida';
  return 'desconocido';
}

// ---------- normalizacion ----------
// filasMov y filasMae son listas de objetos (una fila por registro, como las entregan los nodos de lectura de n8n).
function normalizar(filasMov, filasMae, cfg) {
  const avisos = [];
  const calidad = { filas_movimientos: filasMov.length, filas_usadas: 0, descartadas: {}, duplicados_sospechosos: 0, skus_sin_maestro: [], granularidad_mensual: false };
  const descartar = (motivo) => { calidad.descartadas[motivo] = (calidad.descartadas[motivo] || 0) + 1; };
  const encMov = filasMov.length ? Object.keys(filasMov[0]) : [];
  const colMov = detectarColumnas(encMov, cfg.mapeo, ['fecha', 'sku', 'producto', 'tipo', 'cantidad', 'entrada', 'salida', 'costo_unitario', 'saldo', 'motivo', 'bodega', 'documento', 'lead_time_dias', 'stock_actual']);
  if (!colMov.fecha || !colMov.sku || !(colMov.cantidad || colMov.entrada || colMov.salida)) {
    return { error: `No se reconocieron las columnas minimas de movimientos (fecha, sku y cantidad). Columnas recibidas: ${encMov.slice(0, 12).join(', ') || 'ninguna'}. Indica el mapeo en la configuracion.`, avisos, calidad };
  }
  const sinTipo = !colMov.tipo;
  const separadas = !colMov.cantidad && (colMov.entrada || colMov.salida);
  if (sinTipo && !separadas) avisos.push('El archivo de movimientos no tiene columna de tipo: se usa el signo de la cantidad (negativo = salida). Si el sistema registra devoluciones, ajustes o traslados, agrega la columna de tipo o de motivo para que no se cuenten como demanda.');
  const bodegas = new Set();
  const movs = [];
  const vistos = new Map();
  filasMov.forEach((fila, idx) => {
    const f = parsearFecha(fila[colMov.fecha], cfg.formato_fecha);
    const sku = String(fila[colMov.sku] ?? '').trim();
    if (!f) { descartar('fecha invalida'); return; }
    if (!sku) { descartar('sin codigo de producto'); return; }
    const registros = [];
    if (separadas) {
      const e = colMov.entrada ? parsearNumero(fila[colMov.entrada]) : NaN;
      const s = colMov.salida ? parsearNumero(fila[colMov.salida]) : NaN;
      if (e > 0) registros.push(['entrada', e]);
      if (s > 0) registros.push(['salida', s]);
    } else {
      const q = parsearNumero(fila[colMov.cantidad]);
      if (!Number.isFinite(q)) { descartar('cantidad invalida'); return; }
      if (q === 0) { descartar('cantidad cero'); return; }
      registros.push([sinTipo ? (q < 0 ? 'salida' : 'entrada') : clasificarTipo(fila[colMov.tipo], q), q]);
    }
    for (const [tipo, q] of registros) {
      if (tipo === 'desconocido') { descartar(`tipo de movimiento no reconocido (${String(fila[colMov.tipo] ?? '').slice(0, 25)})`); continue; }
      const bodega = colMov.bodega ? String(fila[colMov.bodega] ?? '').trim() : '';
      if (bodega) bodegas.add(bodega);
      const saldo = colMov.saldo ? parsearNumero(fila[colMov.saldo]) : NaN;
      const costo = colMov.costo_unitario ? parsearNumero(fila[colMov.costo_unitario]) : NaN;
      const m = {
        idx, dia: f.dia, mensual: f.mensual, sku, producto: colMov.producto ? String(fila[colMov.producto] ?? '').trim() : '', tipo, cantidad: Math.abs(q),
        efecto: EFECTO_TIPO[tipo] * Math.abs(q), costo: Number.isFinite(costo) && costo > 0 ? costo : null, saldo: Number.isFinite(saldo) ? saldo : null,
        bodega, documento: colMov.documento ? String(fila[colMov.documento] ?? '') : '',
      };
      const k = `${m.dia}|${m.sku}|${m.tipo}|${m.cantidad}|${m.bodega}|${m.documento}`;
      vistos.set(k, (vistos.get(k) || 0) + 1);
      if (m.documento && vistos.get(k) > 1) { calidad.duplicados_sospechosos++; descartar('duplicado exacto con el mismo documento'); continue; }
      movs.push(m);
    }
  });
  const sospechosos = [...vistos.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
  calidad.duplicados_sospechosos += sospechosos;
  if (sospechosos && !movs.some((m) => m.documento)) avisos.push(`Filas de movimiento identicas (misma fecha, producto, tipo y cantidad): ${sospechosos}. El archivo no trae numero de documento, asi que pueden ser ventas repetidas legitimas o duplicados. No se eliminaron.`);
  calidad.filas_usadas = movs.length;
  if (movs.length && movs.filter((m) => m.mensual).length / movs.length > 0.5) {
    calidad.granularidad_mensual = true;
    avisos.push('Las fechas vienen por mes (AAAA-MM) y no por dia: no se puede reconstruir el saldo diario, asi que no se calculan los dias en cero ni los quiebres dentro del mes.');
  }
  const porBodega = !!cfg.por_bodega && bodegas.size > 1;
  if (bodegas.size > 1 && !porBodega) avisos.push(`El archivo trae ${bodegas.size} bodegas y se analizan sumadas por producto (el saldo por bodega no se usa). Para analizar cada bodega por separado activa por_bodega en la configuracion.`);
  const llave = (sku, bodega) => (porBodega ? `${sku} | ${bodega}` : sku);
  movs.forEach((m) => { m.key = llave(m.sku, m.bodega); if (!porBodega && bodegas.size > 1) m.saldo = null; });

  // maestro
  const maestro = new Map();
  if (filasMae && filasMae.length) {
    const encMae = Object.keys(filasMae[0]);
    const colMae = detectarColumnas(encMae, cfg.mapeo_maestro || cfg.mapeo, ['sku', 'producto', 'unidad', 'stock_actual', 'costo_unitario', 'lead_time_dias', 'lead_time_desv_dias', 'moq', 'en_transito', 'fecha_llegada_transito', 'proveedor', 'activo', 'vida_util_dias', 'bodega']);
    const utiles = { stock_actual: 'stock actual', costo_unitario: 'costo', lead_time_dias: 'plazo de entrega', moq: 'pedido minimo', en_transito: 'pedidos en transito', proveedor: 'proveedor' };
    const faltan = Object.entries(utiles).filter(([campo]) => !colMae[campo]).map(([, nombre]) => nombre);
    if (colMae.sku && faltan.length) avisos.push(`Columnas del maestro que no se reconocieron (se usan valores por defecto o se omiten): ${faltan.join(', ')}. Columnas recibidas: ${encMae.slice(0, 14).join(', ')}. Si existen con otro nombre, indicalo en el mapeo de la configuracion.`);
    if (!colMae.sku) avisos.push('El maestro de productos no tiene columna de codigo reconocible: se ignora.');
    else {
      for (const fila of filasMae) {
        const sku = String(fila[colMae.sku] ?? '').trim();
        if (!sku) continue;
        const num = (campo) => { const n = colMae[campo] ? parsearNumero(fila[colMae[campo]]) : NaN; return Number.isFinite(n) ? n : null; };
        const activoTxt = colMae.activo ? norm(fila[colMae.activo]) : '';
        const llegada = colMae.fecha_llegada_transito ? parsearFecha(fila[colMae.fecha_llegada_transito], cfg.formato_fecha) : null;
        const bodega = colMae.bodega ? String(fila[colMae.bodega] ?? '').trim() : '';
        maestro.set(llave(sku, bodega), {
          sku, nombre: colMae.producto ? String(fila[colMae.producto] ?? '').trim() : '', unidad: colMae.unidad ? String(fila[colMae.unidad] ?? '').trim() : '',
          stock_actual: num('stock_actual'), costo: num('costo_unitario'), lead_time: num('lead_time_dias'), lead_time_desv: num('lead_time_desv_dias'),
          moq: num('moq'), en_transito: num('en_transito') || 0, llegada_transito: llegada ? llegada.dia : null,
          proveedor: colMae.proveedor ? String(fila[colMae.proveedor] ?? '').trim() : '',
          activo: !['no', 'inactivo', '0', 'false', 'descontinuado', 'baja'].includes(activoTxt),
          vida_util: num('vida_util_dias'),
        });
      }
    }
  } else avisos.push('No se leyo el maestro de productos: no se puede detectar los productos que nunca se movieron ni usar el stock actual, el costo y el plazo de entrega del sistema.');
  const skusMov = new Set(movs.map((m) => m.key));
  calidad.skus_sin_maestro = maestro.size ? [...skusMov].filter((k) => !maestro.has(k)) : [];
  calidad.maestro_sin_movimientos = maestro.size ? [...maestro.keys()].filter((k) => !skusMov.has(k)).length : 0;
  if (calidad.skus_sin_maestro.length) avisos.push(`Productos con movimientos que no estan en el maestro: ${calidad.skus_sin_maestro.length} (${calidad.skus_sin_maestro.slice(0, 4).join(', ')}). Se analizan sin stock actual, plazo ni costo del sistema.`);
  return { movs, maestro, avisos, calidad, porBodega, bodegas: [...bodegas] };
}
