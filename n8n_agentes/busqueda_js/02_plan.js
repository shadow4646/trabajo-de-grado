// Nodo "Armar plan": interpreta la respuesta de Claude y arma la lista de consultas segun el modo.
const prep = $('Preparar solicitud').first().json;
const resp = $input.first().json;
const cfg = MODOS[prep.modo] || MODOS.rapida;
const textoResp = resp?.content?.[0]?.text ?? '';
const uso = resp?.usage ?? {};
const llamadas = [{ etapa: 'interpretar', entrada: uso.input_tokens ?? 0, salida: uso.output_tokens ?? 0, ok: !!textoResp }];

let interp = extraerJson(textoResp);
let fallback = false;
const extraSupuestos = [];
if (!interp && prep.solicitud_texto) {
  fallback = true;
  const prod = prep.solicitud_texto.replace(/\b(profunda|profundo|a fondo|deep|rapida|rapido)\b[:,]?/gi, '').trim().slice(0, 80);
  interp = { producto: prod || null, nombre_en: null, sinonimos: [], consultas: {}, supuestos: [], preguntas_pendientes: [] };
  extraSupuestos.push('No se pudo interpretar la solicitud con IA: se uso el texto tal cual y consultas genericas.');
}
const falta = !interp || !interp.producto;

if (falta) {
  return [{ json: { falta_producto: true, modo: prep.modo, cfg, fecha: prep.fecha, solicitud_texto: prep.solicitud_texto, llamadas, consultas_lista: [] } }];
}

const producto = String(interp.producto).trim();
const en = interp.nombre_en || producto;
const pais = interp.pais_destino || null;
const detectaIdioma = (q) => (/[áéíóúñ¿]|\b(de|para|por|al|el|la|los|precio|fabricante)\b/i.test(q) ? 'es' : 'en');

const fam = {};
const addFam = (f, q, idioma) => {
  const t = String(q ?? '').trim();
  if (!t) return;
  (fam[f] = fam[f] || []).push({ q: t, idioma: idioma || detectaIdioma(t), familia: f });
};
const consultasClaude = interp.consultas || {};
for (const f of ['fabricantes', 'distribuidores', 'precios', 'registros_oficiales', 'gremios', 'reputacion']) {
  for (const c of (consultasClaude[f] || [])) addFam(f, c?.q ?? c, c?.idioma);
}
// Consultas minimas por codigo si Claude no aporto
if (!(fam.fabricantes || []).length) { addFam('fabricantes', `${producto} fabricante`, 'es'); addFam('fabricantes', `${en} manufacturer`, 'en'); }
if (!(fam.distribuidores || []).length) addFam('distribuidores', `${producto} distribuidor mayorista ${pais || ''}`, 'es');
if (!(fam.precios || []).length) { addFam('precios', `${producto} precio por mayor ${pais || ''}`, 'es'); addFam('precios', `${en} price per ton`, 'en'); }
if (!(fam.registros_oficiales || []).length && (interp.certificaciones_requeridas || []).length) addFam('registros_oficiales', `${producto} ${interp.certificaciones_requeridas[0]} empresas autorizadas`, 'es');
// Familias deterministas (solo modo profundo)
if (cfg.familias.includes('catalogos_pdf')) {
  addFam('catalogos_pdf', `${producto} ficha tecnica filetype:pdf`, 'es');
  addFam('catalogos_pdf', `${en} specification sheet filetype:pdf`, 'en');
  addFam('catalogos_pdf', `${producto} catalogo de productos filetype:pdf`, 'es');
}
if (cfg.familias.includes('directorios_b2b')) {
  for (const d of DIRECTORIOS_B2B.slice(0, cfg.directorios)) addFam('directorios_b2b', `${en} manufacturer site:${d}`, d === 'quiminet.com' ? 'es' : 'en');
}
if (cfg.familias.includes('reputacion') && !(fam.reputacion || []).length) addFam('reputacion', `${producto} proveedor opiniones reclamos`, 'es');

// Orden round-robin entre familias, para que ninguna quede sin cobertura si se alcanza el limite
const porFam = cfg.familias.map((f) => (fam[f] || []).slice(0, f === 'directorios_b2b' ? cfg.directorios : cfg.por_familia));
const lista = [];
const vistos = new Set();
for (let i = 0; lista.length < cfg.max_consultas; i++) {
  let alguna = false;
  for (const arr of porFam) {
    if (i < arr.length) {
      alguna = true;
      const c = arr[i];
      const k = norm(c.q);
      if (!vistos.has(k) && lista.length < cfg.max_consultas) { vistos.add(k); lista.push(c); }
    }
  }
  if (!alguna) break;
}

const supuestos = [...(interp.supuestos || []), ...extraSupuestos];
const preguntas = [...(interp.preguntas_pendientes || [])];
if (!interp.cantidad_anual && !interp.cantidad_pedido) {
  supuestos.push('No se indico cantidad: no se calcula costo total, solo comparacion cualitativa.');
  preguntas.push('Cantidad por pedido y cantidad anual.');
}
if (!pais) {
  supuestos.push('No se indico pais de destino: no se evalua cobertura ni costo de importacion.');
  preguntas.push('Pais y ciudad de destino.');
}
if (!interp.venta || interp.venta === 'no_especificado') supuestos.push('No se indico si la compra es al por mayor o al detal.');

const plan = {
  producto, nombre_en: en, sinonimos: interp.sinonimos || [], especificacion: interp.especificacion || null,
  categoria: interp.categoria || 'otro', cantidad_pedido: interp.cantidad_pedido || null, cantidad_anual: interp.cantidad_anual || null,
  pais_destino: pais, ciudad_destino: interp.ciudad_destino || null, venta: interp.venta || 'no_especificado',
  requisitos_calidad: interp.requisitos_calidad || [], certificaciones_requeridas: interp.certificaciones_requeridas || [],
  paises_origen_probables: interp.paises_origen_probables || [], kraljic: interp.kraljic_provisional || { cuadrante: 'no_determinado', razon: 'Sin datos suficientes.' },
  supuestos, preguntas_pendientes: [...new Set(preguntas)],
};

return [{ json: { falta_producto: false, fallback_interpretacion: fallback, modo: prep.modo, cfg, fecha: prep.fecha, solicitud_texto: prep.solicitud_texto, plan, consultas_lista: lista, llamadas } }];
