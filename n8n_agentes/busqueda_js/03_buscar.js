// Nodo "Ejecutar busquedas": corre las consultas contra SearXNG local, con parada por saturacion y bola de nieve.
const p = $input.first().json;
const cfg = p.cfg;
const t0 = Date.now();
const mapa = new Map();
const dominios = new Set();
const log = [];
let ejecutadas = 0;
let detenido = 'lista_completa';
const motores = {};
let consultasSinResultados = 0;

const registrar = (c, rs) => {
  let nuevos = 0;
  rs.forEach((r, pos) => {
    if (!r || !r.url) return;
    const d = dominio(r.url);
    let e = mapa.get(r.url);
    if (!e) {
      e = { url: r.url, dominio: d, titulo: r.title || '', contenido: r.content || '', engines: [], familias: [], consultas: [], mejor_pos: pos };
      mapa.set(r.url, e);
    }
    e.mejor_pos = Math.min(e.mejor_pos, pos);
    if (!e.familias.includes(c.familia)) e.familias.push(c.familia);
    if (!e.consultas.includes(c.q)) e.consultas.push(c.q);
    for (const g of (r.engines || [])) if (!e.engines.includes(g)) e.engines.push(g);
    if (d && !dominios.has(d)) { dominios.add(d); nuevos++; }
  });
  return nuevos;
};

// Devuelve false si hay que dejar de buscar (limite, tiempo o saturacion)
const correr = async (lista, fase) => {
  let sinNuevos = 0;
  let primero = true;
  for (const lote of trozos(lista, cfg.lote || 2)) {
    if (Date.now() - t0 > cfg.presupuesto_ms) { detenido = 'presupuesto_de_tiempo'; return false; }
    if (ejecutadas >= cfg.max_consultas) { detenido = 'limite_de_consultas'; return false; }
    if (!primero) await sleep(cfg.pausa_ms || 0);
    primero = false;
    const res = await Promise.all(lote.map((c) => buscarSearx(this, c)));
    let nuevosLote = 0;
    res.forEach((r, i) => {
      const n = registrar(lote[i], r.resultados);
      nuevosLote += n;
      contarMotores(motores, r);
      if (!r.resultados.length) consultasSinResultados++;
      log.push({ fase, familia: lote[i].familia, q: lote[i].q, resultados: r.resultados.length, nuevos_dominios: n, error: r.error || null });
    });
    ejecutadas += lote.length;
    if (cfg.saturacion && fase === 'principal') {
      sinNuevos = nuevosLote < 3 ? sinNuevos + 1 : 0;
      if (sinNuevos >= 4 && ejecutadas >= 15) { detenido = 'saturacion'; return false; }
    }
  }
  return true;
};

await correr(p.consultas_lista, 'principal');

// Bola de nieve: a partir de los candidatos mejor posicionados, busca sus competidores y alternativas
if (cfg.bola_nieve && detenido !== 'presupuesto_de_tiempo' && ejecutadas < cfg.max_consultas) {
  const cand = [...mapa.values()]
    .map((e) => ({ e, tipo: clasificarResultado(e) }))
    .filter((x) => ['fabricante_probable', 'distribuidor_probable', 'otro'].includes(x.tipo))
    .sort((a, b) => (b.e.familias.length + b.e.consultas.length) - (a.e.familias.length + a.e.consultas.length))
    .slice(0, 14);
  const marcas = [];
  const vistas = new Set();
  for (const x of cand) {
    const m = nombreMarca(x.e.titulo, x.e.dominio);
    if (m && m.length >= 5 && !vistas.has(m)) { vistas.add(m); marcas.push(m); }
    if (marcas.length >= 4) break;
  }
  const prod = p.plan.producto;
  const en = p.plan.nombre_en || prod;
  const extra = [];
  for (const m of marcas) {
    extra.push({ q: `${m} competidores alternativas ${prod}`, idioma: 'es', familia: 'bola_de_nieve' });
    extra.push({ q: `suppliers similar to ${m} ${en} manufacturer`, idioma: 'en', familia: 'bola_de_nieve' });
  }
  await correr(extra.slice(0, Math.max(0, cfg.max_consultas - ejecutadas)), 'bola_de_nieve');
}

return [{
  json: {
    ...p,
    resultados: [...mapa.values()],
    log_busqueda: log,
    consultas_ejecutadas: ejecutadas,
    detenido_por: detenido,
    dominios_distintos: dominios.size,
    motores_busqueda: motores,
    consultas_sin_resultados: consultasSinResultados,
    ms_busqueda: Date.now() - t0,
  },
}];
