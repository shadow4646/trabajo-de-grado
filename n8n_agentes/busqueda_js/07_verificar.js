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

// ---------- 1. Parseo y verificacion de citas ----------
items.forEach((it, i) => {
  const meta = ext[i]?.json;
  if (!meta || meta.omitir) return;
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
  c.marca_dom = norm(f.dominio.split('.')[0]).replace(/[^a-z0-9]/g, '');
  c.marca_emp = norm(c.empresa?.valor || '').replace(/[^a-z0-9]/g, '');
  candidatos.push(c);
});

// ---------- 2. Menciones en fuentes independientes y reputacion ----------
const compacto = (s) => norm(s).replace(/[^a-z0-9]/g, '');
const NEGATIVAS = /estafa|fraude|scam|reclamo|queja|denuncia|sancion|multa|retiro del mercado|recall|clausura|prohibid/;
const consultasReputacion = [];
leer.motores_busqueda = leer.motores_busqueda || {};
let primeroRep = true;
for (const lote of trozos(candidatos, 2)) {
  const nombre = (c) => (c.empresa?.valor || c.titulo.split(/[|\-:]/)[0] || c.dominio).trim();
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
  const menciona = (r) => r.dominio !== c.dominio && toks.some((t) => compacto(`${r.titulo} ${r.contenido}`).includes(t));
  const todas = [...fuentesGenerales, ...(c.rep_resultados || [])];
  c.menciones = [...new Set(todas.filter(menciona).map((r) => r.dominio))];
  c.alertas = (c.rep_resultados || []).filter((r) => menciona(r) && NEGATIVAS.test(norm(`${r.titulo} ${r.contenido}`))).slice(0, 3).map((r) => ({ url: r.url, titulo: r.titulo.slice(0, 100) }));
  delete c.rep_resultados;
}

// ---------- 3. Calificaciones ordinales ----------
const ORD = { Alto: 3, Medio: 2, Bajo: 1, 'No verificable': 0 };
const req = (plan.certificaciones_requeridas || []).map(norm).filter(Boolean);
const dest = norm(plan.pais_destino || '');
const tldDest = TLD_PAIS[dest] || null;

const certsDe = (c) => [...new Set([...c.certificaciones.map((x) => norm(x.valor)), ...c.certs_codigo.map(norm)])];

// Comparacion numerica de precios solo si hay 2 o mas con la misma moneda y unidad
const grupos = {};
candidatos.filter((c) => c.precio).forEach((c) => { const k = `${norm(c.precio.moneda)}|${norm(c.precio.unidad)}`; (grupos[k] = grupos[k] || []).push(c); });
Object.values(grupos).forEach((g) => { if (g.length >= 2) g.sort((a, b) => Number(a.precio.valor) - Number(b.precio.valor)).forEach((c, i) => { c.precio_rango = i; c.precio_comparable = true; }); });

for (const c of candidatos) {
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
  else cob = 'No verificable';
  c.cal = {
    identidad: pts >= 4 ? 'Alto' : pts >= 2 ? 'Medio' : pts >= 1 ? 'Bajo' : 'No verificable',
    tipo: tv === 'fabricante' ? 'Fabricante' : (tv === 'distribuidor' || tv === 'comercializador') ? 'Distribuidor' : 'No determinado',
    certificaciones: certCal,
    cobertura: cob,
    precio: c.precio ? 'Referencia disponible' : 'No encontrado',
    reputacion: c.menciones.length >= 3 ? 'Alto' : c.menciones.length >= 1 ? 'Medio' : 'No verificable',
  };
  c.ord = {
    identidad: ORD[c.cal.identidad],
    tipo: { Fabricante: 3, Distribuidor: 2, 'No determinado': 1 }[c.cal.tipo],
    certificaciones: certCal === 'No exigidas' ? 2 : (ORD[certCal] ?? 0),
    cobertura: { Local: 3, 'Envia al exterior (declarado)': 2, 'No verificable': 1, 'No evaluada': 1 }[cob],
    precio: !c.precio ? 0 : (c.precio_comparable ? Math.max(1, 3 - c.precio_rango) : 2),
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
const ORDEN_PRECIO = ['precio', 'tipo', 'identidad', 'certificaciones', 'cobertura'];
const ORDEN_RIESGO = ['identidad', 'certificaciones', 'tipo', 'cobertura', 'precio'];
const rangoVeredicto = (c) => (c.veredicto.startsWith('Preseleccionado') ? 0 : c.veredicto.startsWith('Condicionado') ? 1 : 2);
const ordenar = (orden) => [...candidatos].sort((a, b) => {
  if (rangoVeredicto(a) !== rangoVeredicto(b)) return rangoVeredicto(a) - rangoVeredicto(b);
  for (const k of orden) if (b.ord[k] !== a.ord[k]) return b.ord[k] - a.ord[k];
  return (b.menciones.length - a.menciones.length);
});
const ranking = ordenar(riesgoPrimero ? ORDEN_RIESGO : ORDEN_PRECIO);
const topPrecio = ordenar(ORDEN_PRECIO)[0];
const topRiesgo = ordenar(ORDEN_RIESGO)[0];
const nombreDe = (c) => c?.empresa?.valor || c?.titulo?.split(/[|\-:]/)[0].trim() || c?.dominio || 'sin proveedor';
const sensibilidad = !topPrecio ? 'Sin proveedores finalistas para comparar.'
  : (topPrecio.dominio === topRiesgo.dominio
    ? `Gana ${nombreDe(topPrecio)} tanto si se prioriza el precio como si se prioriza el riesgo y la continuidad.`
    : `Si se prioriza el precio gana ${nombreDe(topPrecio)}; si se prioriza el riesgo y la continuidad gana ${nombreDe(topRiesgo)}.`);

// ---------- 5. Riesgos generales ----------
const riesgos = [];
const paisesCand = new Set(candidatos.map((c) => (c.pais ? norm(c.pais.valor) : (TLD_PAIS && c.dominio.split('.').pop()))));
if (candidatos.length >= 2 && paisesCand.size === 1) riesgos.push('Todos los finalistas parecen estar en el mismo pais: riesgo de concentracion geografica.');
if (candidatos.length < 3) riesgos.push('Hay menos de 3 finalistas verificables: poca competencia para negociar y poco respaldo si uno falla.');
if (candidatos.every((c) => !c.precio)) riesgos.push('Ningun finalista publica precio verificable: el costo total no se puede estimar y debe pedirse por RFQ.');
if (!candidatos.some((c) => c.cal.tipo === 'Fabricante')) riesgos.push('Ningun finalista pudo verificarse como fabricante directo: pueden ser intermediarios.');
candidatos.filter((c) => c.alertas.length).forEach((c) => riesgos.push(`Alertas de reputacion para ${nombreDe(c)}: revisar las fuentes citadas.`));
const motoresActivos = Object.entries(leer.motores_busqueda).filter(([, x]) => x.resultados > 0).length;
if (motoresActivos <= 1) riesgos.push(`La busqueda dependio de ${motoresActivos === 1 ? 'un solo buscador' : 'ningun buscador'}: la cobertura es menor a la esperada, conviene repetirla mas tarde.`);
if (leer.consultas_ejecutadas && (leer.consultas_sin_resultados || 0) / leer.consultas_ejecutadas > 0.3) riesgos.push('Mas del 30% de las consultas no devolvio resultados (posible limite de los buscadores): la cobertura puede ser incompleta.');

// ---------- 6. Solicitud a Claude para la narrativa ----------
const rankingCompacto = ranking.map((c, i) => ({
  posicion: i + 1, proveedor: nombreDe(c), url: c.url, veredicto: c.veredicto, calificaciones: c.cal,
  datos_verificados: {
    tipo: c.tipo?.valor || null, productos: c.productos?.valor || null, pais: c.pais?.valor || null, ciudad: c.ciudad?.valor || null,
    certificaciones: certsDe(c), precio: c.precio ? { valor: c.precio.valor, moneda: c.precio.moneda, unidad: c.precio.unidad, condicion: c.precio.condicion } : null,
    moq: c.moq?.valor || null, incoterm: c.incoterm?.valor || null, plazo_entrega: c.plazo?.valor || null, anios_operacion: c.anios?.valor || null,
    capacidad: c.capacidad?.valor || null, envio_internacional: c.envio?.valor ?? null, correos_encontrados: c.emails.length, telefonos_encontrados: c.telefonos.length,
  },
  menciones_en_fuentes_independientes: c.menciones.length,
  alertas_de_reputacion: c.alertas.length,
  campos_descartados_por_no_verificables: c.descartados.length,
}));
const entradaNarrativa = {
  solicitud: { producto: plan.producto, especificacion: plan.especificacion, cantidad_pedido: plan.cantidad_pedido, cantidad_anual: plan.cantidad_anual, pais_destino: plan.pais_destino, venta: plan.venta, certificaciones_requeridas: plan.certificaciones_requeridas, kraljic_provisional: plan.kraljic },
  supuestos: plan.supuestos, prioridad_del_ranking: riesgoPrimero ? 'riesgo y continuidad primero' : 'precio primero',
  ranking: rankingCompacto, sensibilidad, riesgos_generales: riesgos,
  cobertura: { modo: leer.modo, consultas: leer.consultas_ejecutadas, dominios_distintos: leer.dominios_distintos, paginas_leidas_ok: leer.estadisticas_lectura.ok, finalistas: candidatos.length },
};
const sinFinalistas = candidatos.length === 0;
const claudeBody = sinFinalistas
  ? { model: MODELO, max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] }
  : { model: MODELO, max_tokens: 2400, temperature: 0.2, system: PROMPT_INFORME, messages: [{ role: 'user', content: JSON.stringify(entradaNarrativa) }] };

const { resultados, finalistas, a_leer, consultas_lista, ...resto } = leer;
return [{
  json: {
    ...resto, llamadas, candidatos: ranking, sensibilidad, riesgos, prioridad: riesgoPrimero ? 'riesgo' : 'precio',
    verificacion: { campos_totales: camposTotales, campos_descartados: camposDescartados },
    consultas_reputacion: consultasReputacion.length, sin_finalistas: sinFinalistas, claude_body: claudeBody,
  },
}];
