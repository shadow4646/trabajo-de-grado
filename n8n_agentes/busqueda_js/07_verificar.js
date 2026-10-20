// Nodo "Verificar y calificar": comprueba por codigo cada dato extraido, califica, ordena y prepara la narrativa.
const leer = $('Leer paginas').first().json;
const ext = $('Preparar extracciones').all();
const items = $input.all();
const plan = leer.plan;
const cfg = leer.cfg;
const llamadas = [...(leer.llamadas || [])];
const porDominio = new Map((leer.finalistas || []).map((f) => [f.dominio, f]));

let camposTotales = 0;
let camposDescartados = 0;
const candidatos = [];

const compacto = (s) => norm(s).replace(/[^a-z0-9]/g, '');
// Palabras que por si solas no identifican a una empresa: un nombre hecho solo de ellas coincidiria con cualquier pagina
const GENERICAS = ['distribuidora', 'distribuidor', 'mayorista', 'mayoristas', 'comercializadora', 'comercializador', 'harinas', 'harina', 'harinera', 'panaderia', 'panadera', 'panificadora', 'molinos', 'molino', 'productos', 'alimentos', 'insumos', 'industrias', 'industria', 'empresa', 'proveedores', 'proveedor', 'tienda', 'almacen', 'suministros', 'importadora', 'exportadora', 'colombia', 'bogota', 'online'].sort((a, b) => b.length - a.length);
const esGenerica = (nombre) => GENERICAS.reduce((t, g) => t.split(g).join(''), compacto(nombre)).length < 4;
const tokensProducto = [...new Set([plan.producto, plan.nombre_en, ...(plan.sinonimos || [])].filter(Boolean).flatMap((s) => norm(s).split(' ').filter((w) => w.length >= 5)))];
const esNombreDeProducto = (txt) => tokensProducto.some((w) => norm(txt).includes(w));

// ---------- 0. Ofertas de precio (de todas las paginas con precios, no solo de los finalistas) ----------
const paginaPorUrl = new Map((leer.paginas || []).map((g) => [g.url, g]));
const ofertasCrudas = [];
const FACT_MASA = { kg: 1, kilo: 1, kilos: 1, kilogramo: 1, kilogramos: 1, g: 0.001, gr: 0.001, gramo: 0.001, gramos: 0.001, lb: 0.45359237, libra: 0.45359237, libras: 0.45359237, oz: 0.0283495, onza: 0.0283495, onzas: 0.0283495, ton: 1000, tonelada: 1000, toneladas: 1000, t: 1000, mt: 1000 };
const FACT_VOL = { l: 1, lt: 1, litro: 1, litros: 1, ml: 0.001, gal: 3.78541, galon: 3.78541 };
const ALIAS_UNIDAD = { kg: ['kg', 'kilo'], lb: ['lb', 'libra'], libra: ['libra', 'lb'], kilo: ['kilo', 'kg'], ton: ['ton'], tonelada: ['ton'], l: ['litro', 'lt'], litro: ['litro'], g: ['gr', 'gramo'], unidad: ['unidad', 'und', 'pieza', 'c/u'] };
const baseDeUnidad = (u) => {
  const k = norm(u).replace(/\./g, '');
  if (k in FACT_MASA) return { k, base: 'kg', f: FACT_MASA[k] };
  if (k in FACT_VOL) return { k, base: 'l', f: FACT_VOL[k] };
  if (['unidad', 'unidades', 'und', 'u', 'pieza', 'piezas', 'pza'].includes(k)) return { k: 'unidad', base: 'unidad', f: 1 };
  if (k === 'docena') return { k, base: 'unidad', f: 12 };
  return null;
};
const soloDigitos = (t) => String(t ?? '').replace(/\D/g, '');

const procesarPrecios = (it, meta) => {
  const pg = paginaPorUrl.get(meta.url);
  const txtResp = it.json?.content?.[0]?.text ?? '';
  const uso = it.json?.usage ?? {};
  llamadas.push({ etapa: 'precios', dominio: meta.dominio, entrada: uso.input_tokens ?? 0, salida: uso.output_tokens ?? 0, ok: !!txtResp });
  const lista = extraerJson(txtResp)?.ofertas;
  if (!pg || !Array.isArray(lista)) return;
  const ventNorm = norm(pg.ventanas || '');
  const ventDig = soloDigitos(pg.ventanas || '');
  for (const o of lista.slice(0, 8)) {
    camposTotales++;
    const cita = String(o?.cita ?? '').trim();
    const precio = Number(o?.precio);
    const rechazo = cita.length < 6 ? 'sin cita textual'
      : !ventNorm.includes(norm(cita)) ? 'la cita no aparece en la pagina'
      : (!Number.isFinite(precio) || precio <= 0) ? 'precio no numerico'
      : (Math.floor(precio) > 0 && !soloDigitos(cita).includes(String(Math.floor(precio)))) ? 'el precio no coincide con la cita' : null;
    if (rechazo) { camposDescartados++; continue; }
    // La cantidad solo se usa si el texto la respalda; si no, el precio se muestra pero no se normaliza
    const unidades = Number(o.unidades) > 0 ? Number(o.unidades) : 1;
    const cant = Number(o.cantidad);
    const ub = o.unidad ? baseDeUnidad(o.unidad) : null;
    let total = null;
    if (ub && Number.isFinite(cant) && cant > 0) {
      const cantOk = cant === 1 ? (ALIAS_UNIDAD[ub.k] || [ub.k]).some((a) => ventNorm.includes(a)) : ventDig.includes(soloDigitos(cant));
      const unidOk = unidades === 1 || ventDig.includes(soloDigitos(unidades));
      if (cantOk && unidOk) total = unidades * cant * ub.f;
    }
    ofertasCrudas.push({
      dominio: meta.dominio, url: meta.url, titulo: pg.titulo || '',
      descripcion: String(o.descripcion ?? '').slice(0, 90), presentacion: String(o.presentacion ?? '').slice(0, 60),
      precio, moneda: /^[A-Za-z]{3}$/.test(String(o.moneda ?? '')) ? String(o.moneda).toUpperCase() : null,
      condicion: norm(o.condicion), cantidad_total: total, base: total ? ub.base : null, cita: cita.slice(0, 200),
    });
  }
};

// ---------- 1. Parseo y verificacion de citas ----------
items.forEach((it, i) => {
  const meta = ext[i]?.json;
  if (!meta || meta.omitir) return;
  if (meta.tipo_item === 'precios') { procesarPrecios(it, meta); return; }
  const f = porDominio.get(meta.dominio);
  if (!f) return;
  const txtResp = it.json?.content?.[0]?.text ?? '';
  const uso = it.json?.usage ?? {};
  llamadas.push({ etapa: 'extraer', dominio: f.dominio, entrada: uso.input_tokens ?? 0, salida: uso.output_tokens ?? 0, ok: !!txtResp });
  const data = extraerJson(txtResp) || {};
  const textoNorm = norm(f.texto);
  const descartados = [];

  const verificar = (campo, nombre) => {
    if (campo === null || campo === undefined || typeof campo !== 'object') return null;
    camposTotales++;
    const cita = String(campo.cita ?? '').trim();
    if (cita.length < 6) { camposDescartados++; descartados.push({ campo: nombre, motivo: 'sin cita textual' }); return null; }
    if (!textoNorm.includes(norm(cita))) { camposDescartados++; descartados.push({ campo: nombre, motivo: 'la cita no aparece en la pagina' }); return null; }
    if (nombre === 'tipo') {
      // Que la cita exista en la pagina no basta: tiene que decir lo que el tipo afirma (un eslogan no prueba que sea fabricante)
      const t = norm(campo.valor);
      const ct = norm(cita);
      const dice = t === 'fabricante' ? /fabric|produc|elabor|molin|planta|manufactur|procesa|moliend|cultiv|factory|\bmill\b/.test(ct)
        : (t === 'distribuidor' || t === 'comercializador') ? /distribu|comercializ|mayorista|import|revend|wholesale|supplier|proveedor|catalogo|tienda/.test(ct)
        : true;
      if (!dice) { camposDescartados++; descartados.push({ campo: nombre, motivo: 'la cita no respalda el tipo declarado' }); return null; }
    }
    if (nombre === 'precio') {
      const v = Number(campo.valor);
      if (!Number.isFinite(v)) { camposDescartados++; descartados.push({ campo: nombre, motivo: 'valor no numerico' }); return null; }
      if (Math.floor(v) > 0 && !cita.replace(/\D/g, '').includes(String(Math.floor(v)))) { camposDescartados++; descartados.push({ campo: nombre, motivo: 'el valor no coincide con la cita' }); return null; }
    }
    return campo;
  };

  const c = {
    dominio: f.dominio, url: f.url, titulo: f.titulo, tipo_busqueda: f.tipo, leyo_contacto: !!f.leyo_contacto,
    emails: f.emails || [], telefonos: f.telefonos || [], certs_codigo: f.certs || [],
    empresa: verificar(data.empresa, 'empresa'), tipo: verificar(data.tipo, 'tipo'), ofrece: verificar(data.ofrece_producto, 'ofrece_producto'),
    productos: verificar(data.productos, 'productos'), pais: verificar(data.pais, 'pais'), ciudad: verificar(data.ciudad, 'ciudad'),
    direccion: verificar(data.direccion, 'direccion'),
    certificaciones: (Array.isArray(data.certificaciones) ? data.certificaciones : []).map((x) => verificar(x, 'certificacion')).filter(Boolean),
    precio: verificar(data.precio, 'precio'), moq: verificar(data.moq, 'moq'), incoterm: verificar(data.incoterm, 'incoterm'),
    plazo: verificar(data.plazo_entrega, 'plazo_entrega'), anios: verificar(data.anios_operacion, 'anios_operacion'),
    capacidad: verificar(data.capacidad, 'capacidad'), envio: verificar(data.envio_internacional, 'envio_internacional'),
    descartados,
  };
  // El modelo a veces devuelve el nombre del producto como si fuera la empresa: en ese caso se usa el dominio
  c.nombre = (c.empresa?.valor && !esNombreDeProducto(c.empresa.valor)) ? String(c.empresa.valor).trim() : f.dominio;
  c.marca_dom = compacto(f.dominio.split('.')[0]);
  c.marca_emp = esGenerica(c.nombre) ? '' : compacto(c.nombre);
  candidatos.push(c);
});

// ---------- 2. Menciones en fuentes independientes y reputacion ----------
const NEGATIVAS = /estafa|fraude|scam|reclamo|queja|denuncia|sancion|multa|retiro del mercado|recall|clausura|prohibid/;
const consultasReputacion = [];
leer.motores_busqueda = leer.motores_busqueda || {};
let primeroRep = true;
for (const lote of trozos(candidatos, 2)) {
  const nombre = (c) => c.nombre;
  if (!primeroRep) await sleep(leer.cfg?.pausa_ms || 0);
  primeroRep = false;
  const res = await Promise.all(lote.map((c) => buscarSearx(this, { q: `"${nombre(c)}" ${plan.producto} opiniones reclamos`, idioma: 'es' })));
  res.forEach((r, i) => {
    contarMotores(leer.motores_busqueda, r);
    lote[i].rep_resultados = r.resultados.slice(0, 15).map((x) => ({ url: x.url, dominio: dominio(x.url), titulo: x.title || '', contenido: x.content || '' }));
    consultasReputacion.push({ dominio: lote[i].dominio, resultados: r.resultados.length });
  });
}
const fuentesGenerales = leer.resultados || [];
for (const c of candidatos) {
  const toks = [c.marca_dom, c.marca_emp].filter((t) => t && t.length >= 5);
  // Un dominio que contiene el nombre de la marca pero no es el del proveedor suele ser una empresa homonima: no cuenta
  const menciona = (r) => r.dominio !== c.dominio && !toks.some((t) => compacto(r.dominio).includes(t)) && toks.some((t) => compacto(`${r.titulo} ${r.contenido}`).includes(t));
  const todas = [...fuentesGenerales, ...(c.rep_resultados || [])];
  c.menciones = [...new Set(todas.filter(menciona).map((r) => r.dominio))];
  c.alertas = (c.rep_resultados || []).filter((r) => menciona(r) && NEGATIVAS.test(norm(`${r.titulo} ${r.contenido}`))).slice(0, 3).map((r) => ({ url: r.url, titulo: r.titulo.slice(0, 100) }));
  delete c.rep_resultados;
}

// ---------- 5b. Ofertas de precio: precio por kilo (o litro, o unidad) y en la moneda del destino ----------
const monedaDestino = MONEDA_PAIS[norm(plan.pais_destino || '')] || 'COP';
let fx = { ok: false, moneda: monedaDestino, fecha: null, fuente: null };
let ratesFx = {};
if (ofertasCrudas.some((o) => o.moneda && o.moneda !== monedaDestino)) {
  try {
    const r = await this.helpers.httpRequest({ method: 'GET', url: FX_URL, json: true, timeout: 12000 });
    if (r && r.rates && r.rates[monedaDestino]) { ratesFx = r.rates; fx = { ok: true, moneda: monedaDestino, fecha: r.time_last_update_utc || null, fuente: 'ExchangeRate-API (open.er-api.com)' }; }
  } catch (e) { fx.error = String(e.message || e).slice(0, 80); }
} else if (ofertasCrudas.length) fx = { ok: true, moneda: monedaDestino, fecha: null, fuente: null };
const aDestino = (valor, moneda) => {
  if (!moneda) return null;
  if (moneda === monedaDestino) return valor;
  return (fx.ok && ratesFx[moneda]) ? valor * (ratesFx[monedaDestino] / ratesFx[moneda]) : null;
};
const nombrePorDominio = new Map(candidatos.map((c) => [c.dominio, c.nombre]));
const vistasOferta = new Set();
const ofertas = [];
for (const o of ofertasCrudas) {
  const k = `${o.dominio}|${o.precio}|${o.moneda}|${o.cantidad_total}`;
  if (vistasOferta.has(k)) continue;
  vistasOferta.add(k);
  const porBase = o.cantidad_total ? o.precio / o.cantidad_total : null;
  let venta = o.condicion === 'detal' ? 'detal' : o.condicion === 'mayorista' ? 'mayor' : null;
  let porTamano = false;
  // Si la pagina no dice si es detal o mayor, se clasifica por el tamano de la presentacion (se declara en el informe)
  if (!venta && o.base === 'kg' && o.cantidad_total) { if (o.cantidad_total <= 5) { venta = 'detal'; porTamano = true; } else if (o.cantidad_total >= 20) { venta = 'mayor'; porTamano = true; } }
  // Un precio al detal en la moneda de otro pais no le sirve a quien compra en el destino: se omite del cuadro y se cuenta
  const fueraDeDestino = venta === 'detal' && !!o.moneda && o.moneda !== monedaDestino;
  ofertas.push({ ...o, nombre: nombrePorDominio.get(o.dominio) || o.dominio, precio_base: porBase, precio_base_destino: porBase !== null ? aDestino(porBase, o.moneda) : null, venta: venta || 'sin_clasificar', venta_por_tamano: porTamano, fuera_de_destino: fueraDeDestino });
}
const ofertasOtrosPaises = ofertas.filter((o) => o.fuera_de_destino).length;
const ofertasUtiles = ofertas.filter((o) => !o.fuera_de_destino);
const conteoBase = {};
ofertasUtiles.filter((o) => o.base).forEach((o) => { conteoBase[o.base] = (conteoBase[o.base] || 0) + 1; });
const baseDominante = Object.entries(conteoBase).sort((a, b) => b[1] - a[1])[0]?.[0] || 'kg';
const percentil = (a, q) => { const s = [...a].sort((x, y) => x - y); const pos = (s.length - 1) * q; const i = Math.floor(pos); return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (pos - i); };
const statsPrecios = {};
for (const venta of ['detal', 'mayor']) {
  const xs = ofertasUtiles.filter((o) => o.venta === venta && o.base === baseDominante && o.precio_base_destino !== null).map((o) => o.precio_base_destino);
  if (xs.length) statsPrecios[venta] = { n: xs.length, minimo: Math.min(...xs), q1: percentil(xs, 0.25), mediana: percentil(xs, 0.5), q3: percentil(xs, 0.75), maximo: Math.max(...xs) };
}
// Mejor precio comparable de cada proveedor (en la moneda del destino): alimenta el ranking y el narrador
const mejorPrecioPorDominio = new Map();
ofertasUtiles.filter((o) => o.base === baseDominante && o.precio_base_destino !== null).forEach((o) => {
  const previo = mejorPrecioPorDominio.get(o.dominio);
  if (previo === undefined || o.precio_base_destino < previo) mejorPrecioPorDominio.set(o.dominio, o.precio_base_destino);
});
const preciosOrdenados = [...new Set([...mejorPrecioPorDominio.values()])].sort((a, b) => a - b);
// ---------- 3. Calificaciones ordinales ----------
const ORD = { Alto: 3, Medio: 2, Bajo: 1, 'No verificable': 0 };
const req = (plan.certificaciones_requeridas || []).map(norm).filter(Boolean);
const dest = norm(plan.pais_destino || '');
const tldDest = TLD_PAIS[dest] || null;

const certsDe = (c) => [...new Set([...c.certificaciones.map((x) => norm(x.valor)), ...c.certs_codigo.map(norm)])];

// Un precio al detal no sirve como referencia para una compra al por mayor
const precioDetalEnMayor = (c) => plan.venta === 'mayor' && !!c.precio && norm(c.precio.condicion) === 'detal';
// Un precio sin unidad (37 USD, pero por que?) no se puede comparar con nada
const precioSinUnidad = (c) => !!c.precio && ['', 'no_indica', 'null', 'undefined', 'n/a'].includes(norm(c.precio.unidad));
const precioNoComparable = (c) => precioDetalEnMayor(c) || precioSinUnidad(c);

// Comparacion numerica de precios solo si hay 2 o mas con la misma moneda y unidad
const grupos = {};
candidatos.filter((c) => c.precio && !precioNoComparable(c)).forEach((c) => { const k = `${norm(c.precio.moneda)}|${norm(c.precio.unidad)}`; (grupos[k] = grupos[k] || []).push(c); });
Object.values(grupos).forEach((g) => { if (g.length >= 2) g.sort((a, b) => Number(a.precio.valor) - Number(b.precio.valor)).forEach((c, i) => { c.precio_rango = i; c.precio_comparable = true; }); });

const redondeo = (x) => (x >= 100 ? Math.round(x) : Math.round(x * 100) / 100);
for (const c of candidatos) {
  c.mejor_precio_dest = mejorPrecioPorDominio.has(c.dominio) ? mejorPrecioPorDominio.get(c.dominio) : null;
  const pts = (c.empresa ? 1 : 0) + (c.emails.length ? 1 : 0) + (c.telefonos.length ? 1 : 0) + ((c.direccion || c.ciudad) ? 1 : 0) + (c.menciones.length >= 2 ? 1 : 0);
  const tv = norm(c.tipo?.valor || '');
  const have = certsDe(c);
  let certCal;
  if (!req.length) certCal = 'No exigidas';
  else {
    const ok = req.filter((r) => have.some((h) => h.includes(r) || r.includes(h)));
    certCal = ok.length === req.length ? 'Alto' : ok.length > 0 ? 'Medio' : have.length ? 'Bajo' : 'No verificable';
  }
  let cob;
  if (!dest) cob = 'No evaluada';
  else if ((c.pais && norm(c.pais.valor).includes(dest)) || (tldDest && (c.dominio.endsWith('.' + tldDest) || c.dominio.endsWith('.com.' + tldDest)))) cob = 'Local';
  else if (c.envio && c.envio.valor === true) cob = 'Envia al exterior (declarado)';
  else if (c.pais && norm(c.pais.valor) && !norm(c.pais.valor).includes(dest)) cob = 'Fuera del pais de destino (sin envio declarado)';
  else cob = 'No verificable';
  c.cal = {
    identidad: pts >= 4 ? 'Alto' : pts >= 2 ? 'Medio' : pts >= 1 ? 'Bajo' : 'No verificable',
    tipo: tv === 'fabricante' ? 'Fabricante' : (tv === 'distribuidor' || tv === 'comercializador') ? 'Distribuidor' : 'No determinado',
    certificaciones: certCal,
    cobertura: cob,
    precio: c.mejor_precio_dest != null ? `Mejor precio comparable: ${redondeo(c.mejor_precio_dest)} ${monedaDestino}/${baseDominante}` : !c.precio ? 'No encontrado' : precioDetalEnMayor(c) ? 'Solo al detal (no comparable con compra mayorista)' : precioSinUnidad(c) ? 'Sin unidad indicada (no comparable)' : 'Referencia disponible',
  };
  c.ord = {
    identidad: ORD[c.cal.identidad],
    tipo: { Fabricante: 3, Distribuidor: 2, 'No determinado': 1 }[c.cal.tipo],
    certificaciones: certCal === 'No exigidas' ? 2 : (ORD[certCal] ?? 0),
    cobertura: { Local: 3, 'Envia al exterior (declarado)': 2, 'No verificable': 1, 'No evaluada': 1, 'Fuera del pais de destino (sin envio declarado)': 0 }[cob],
    precio: c.mejor_precio_dest != null ? Math.max(1, 3 - preciosOrdenados.indexOf(c.mejor_precio_dest)) : ((!c.precio || precioNoComparable(c)) ? 0 : (c.precio_comparable ? Math.max(1, 3 - c.precio_rango) : 2)),
  };
  if (c.ofrece && c.ofrece.valor === false) c.veredicto = 'Descartado: no ofrece el producto';
  else if (req.length && certCal === 'No verificable') c.veredicto = 'Condicionado: validar certificaciones';
  else if (['Bajo', 'No verificable'].includes(c.cal.identidad)) c.veredicto = 'Condicionado: identidad poco verificada';
  else if (c.alertas.length) c.veredicto = 'Condicionado: revisar alertas de reputacion';
  else c.veredicto = 'Preseleccionado';
}

// ---------- 4. Ranking explicable (prioridad segun Kraljic) ----------
const kr = norm(plan.kraljic?.cuadrante || '');
const riesgoPrimero = /estrateg|cuello/.test(kr);
// La cobertura va antes que el tipo: un fabricante que no puede entregar en el destino no es una opcion real
const ORDEN_PRECIO = ['precio', 'cobertura', 'tipo', 'identidad', 'certificaciones'];
const ORDEN_RIESGO = ['identidad', 'certificaciones', 'cobertura', 'tipo', 'precio'];
const rangoVeredicto = (c) => (c.veredicto.startsWith('Preseleccionado') ? 0 : c.veredicto.startsWith('Condicionado') ? 1 : 2);
const ordenar = (orden) => [...candidatos].sort((a, b) => {
  if (rangoVeredicto(a) !== rangoVeredicto(b)) return rangoVeredicto(a) - rangoVeredicto(b);
  for (const k of orden) if (b.ord[k] !== a.ord[k]) return b.ord[k] - a.ord[k];
  return (b.menciones.length - a.menciones.length);
});
const ranking = ordenar(riesgoPrimero ? ORDEN_RIESGO : ORDEN_PRECIO);
const topPrecio = ordenar(ORDEN_PRECIO)[0];
const topRiesgo = ordenar(ORDEN_RIESGO)[0];
const nombreDe = (c) => c?.nombre || c?.dominio || 'sin proveedor';
const sensibilidad = !topPrecio ? 'Sin proveedores finalistas para comparar.'
  : (topPrecio.dominio === topRiesgo.dominio
    ? `Gana ${nombreDe(topPrecio)} tanto si se prioriza el precio como si se prioriza el riesgo y la continuidad.`
    : `Si se prioriza el precio gana ${nombreDe(topPrecio)}; si se prioriza el riesgo y la continuidad gana ${nombreDe(topRiesgo)}.`);

// ---------- 5. Riesgos generales ----------
const riesgos = [];
const paisesCand = new Set(candidatos.map((c) => (c.pais ? norm(c.pais.valor) : (TLD_PAIS && c.dominio.split('.').pop()))));
if (plan.venta === 'mayor' && candidatos.length >= 2 && paisesCand.size === 1) riesgos.push('Todos los finalistas parecen estar en el mismo pais: riesgo de concentracion geografica.');
if (candidatos.length < 3) riesgos.push('Hay menos de 3 finalistas verificables: poca competencia para negociar y poco respaldo si uno falla.');
if (candidatos.length && candidatos.every((c) => !c.precio && c.mejor_precio_dest == null)) riesgos.push('Ningun finalista publica precio verificable: el costo total no se puede estimar y debe pedirse por RFQ.');
if (plan.venta === 'mayor' && !candidatos.some((c) => c.cal.tipo === 'Fabricante')) riesgos.push('Ningun finalista pudo verificarse como fabricante directo: pueden ser intermediarios.');
candidatos.filter((c) => c.alertas.length).forEach((c) => riesgos.push(`Posibles alertas de reputacion para ${nombreDe(c)}: revisar las fuentes citadas y confirmar que se trata de la misma empresa y no de una homonima.`));
candidatos.filter((c) => c.mejor_precio_dest == null && precioDetalEnMayor(c)).forEach((c) => riesgos.push(`El precio publicado por ${nombreDe(c)} es al detal: no sirve como referencia para una compra al por mayor.`));
candidatos.filter((c) => c.mejor_precio_dest == null && !precioDetalEnMayor(c) && precioSinUnidad(c)).forEach((c) => riesgos.push(`El precio publicado por ${nombreDe(c)} no indica unidad (por kilo, bulto o tonelada): no se puede comparar.`));
if (dest && candidatos.length && candidatos.every((c) => c.cal.cobertura !== 'Local')) riesgos.push('Ningun finalista pudo verificarse como presente en el pais de destino: revisar costos y plazos de importacion o repetir la busqueda en modo profunda.');
const motoresActivos = Object.entries(leer.motores_busqueda).filter(([, x]) => x.resultados > 0).length;
if (motoresActivos <= 1) riesgos.push(`La busqueda dependio de ${motoresActivos === 1 ? 'un solo buscador' : 'ningun buscador'}: la cobertura es menor a la esperada, conviene repetirla mas tarde.`);
if (leer.consultas_ejecutadas && (leer.consultas_sin_resultados || 0) / leer.consultas_ejecutadas > 0.3) riesgos.push('Mas del 30% de las consultas no devolvio resultados (posible limite de los buscadores): la cobertura puede ser incompleta.');

if (!ofertasUtiles.length) riesgos.push('No se encontraron precios publicos verificables: hay que pedirlos por cotizacion (RFQ).');
else {
  if (!statsPrecios.mayor && plan.venta !== 'detal') riesgos.push('No se encontraron precios publicos al por mayor comparables: los precios por volumen se obtienen por cotizacion (RFQ).');
  if (!statsPrecios.detal && plan.venta !== 'mayor') riesgos.push('No se encontraron precios al detal comparables.');
  if (ofertas.some((o) => o.moneda && o.precio_base_destino === null && o.cantidad_total)) riesgos.push(`Algunos precios no se pudieron pasar a ${monedaDestino} porque el tipo de cambio no estuvo disponible.`);
}
const resumenStats = (s) => (s ? { ofertas: s.n, minimo: redondeo(s.minimo), mediana: redondeo(s.mediana), maximo: redondeo(s.maximo) } : null);

// ---------- 6. Solicitud a Claude para la narrativa ----------
const rankingCompacto = ranking.map((c, i) => ({
  posicion: i + 1, proveedor: nombreDe(c), url: c.url, veredicto: c.veredicto, calificaciones: c.cal,
  mejor_precio_comparable: c.mejor_precio_dest != null ? { valor: redondeo(c.mejor_precio_dest), moneda: monedaDestino, por: baseDominante } : null,
  datos_verificados: {
    tipo: c.tipo?.valor || null, productos: c.productos?.valor || null, pais: c.pais?.valor || null, ciudad: c.ciudad?.valor || null,
    certificaciones: certsDe(c), precio: c.precio ? { valor: c.precio.valor, moneda: c.precio.moneda, unidad: c.precio.unidad, condicion: c.precio.condicion, comparable: !precioNoComparable(c) } : null,
    moq: c.moq?.valor || null, incoterm: c.incoterm?.valor || null, plazo_entrega: c.plazo?.valor || null, anios_operacion: c.anios?.valor || null,
    capacidad: c.capacidad?.valor || null, envio_internacional: c.envio?.valor ?? null, correos_encontrados: c.emails.length, telefonos_encontrados: c.telefonos.length,
  },
  menciones_en_fuentes_independientes: c.menciones.length,
  posibles_alertas_por_verificar: c.alertas.length,
  campos_descartados_por_no_verificables: c.descartados.length,
}));
const entradaNarrativa = {
  solicitud: { producto: plan.producto, especificacion: plan.especificacion, cantidad_pedido: plan.cantidad_pedido, cantidad_anual: plan.cantidad_anual, pais_destino: plan.pais_destino, venta: plan.venta, certificaciones_requeridas: plan.certificaciones_requeridas, kraljic_provisional: plan.kraljic },
  supuestos: plan.supuestos, prioridad_del_ranking: riesgoPrimero ? 'riesgo y continuidad primero' : 'precio primero',
  precios_encontrados: {
    moneda_destino: monedaDestino, precio_por: baseDominante, ofertas_con_precio: ofertasUtiles.length,
    al_detal: resumenStats(statsPrecios.detal), al_por_mayor: resumenStats(statsPrecios.mayor),
  },
  ranking: rankingCompacto, sensibilidad, riesgos_generales: riesgos,
  cobertura: { modo: leer.modo, consultas: leer.consultas_ejecutadas, dominios_distintos: leer.dominios_distintos, paginas_leidas_ok: leer.estadisticas_lectura.ok, finalistas: candidatos.length },
};
const sinFinalistas = candidatos.length === 0 && ofertasUtiles.length === 0;
const claudeBody = sinFinalistas
  ? { model: MODELO, max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] }
  : { model: MODELO, max_tokens: 2400, temperature: 0.2, system: PROMPT_INFORME, messages: [{ role: 'user', content: JSON.stringify(entradaNarrativa) }] };

const { resultados, finalistas, a_leer, consultas_lista, ...resto } = leer;
return [{
  json: {
    ...resto, llamadas, candidatos: ranking, sensibilidad, riesgos, prioridad: riesgoPrimero ? 'riesgo' : 'precio',
    ofertas, ofertas_otros_paises: ofertasOtrosPaises, fx, stats_precios: statsPrecios, base_dominante: baseDominante, moneda_destino: monedaDestino,
    verificacion: { campos_totales: camposTotales, campos_descartados: camposDescartados },
    consultas_reputacion: consultasReputacion.length, sin_finalistas: sinFinalistas, claude_body: claudeBody,
  },
}];
