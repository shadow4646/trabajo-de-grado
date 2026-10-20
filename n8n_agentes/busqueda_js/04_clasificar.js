// Nodo "Clasificar y puntuar": clasifica cada resultado por tipo, lo puntua y elige que paginas leer.
const p = $input.first().json;
const cfg = p.cfg;
const plan = p.plan;

const tld = TLD_PAIS[norm(plan.pais_destino || '')] || null;

const coincideProducto = (txt) => hablaDelProducto(plan, txt);

const puntuados = p.resultados.map((r) => {
  const tipo = clasificarResultado(r);
  const txt = norm(`${r.titulo} ${r.contenido}`);
  const coincide = coincideProducto(txt);
  let s = PESO_TIPO[tipo] ?? 1;
  s += Math.min(3, r.consultas.length * 0.6);
  s += Math.max(0, r.familias.length - 1) * 0.8;
  s += Math.min(1.5, r.engines.length * 0.3);
  s += coincide ? 2 : -1.5;
  if (tld && (r.dominio.endsWith('.' + tld) || r.dominio.endsWith('.com.' + tld))) s += 1.5;
  s += Math.max(0, 1 - r.mejor_pos * 0.1);
  return { ...r, tipo, coincide, puntaje: Math.round(s * 100) / 100 };
}).filter((r) => r.tipo !== 'bloqueado');

// Un candidato por dominio, con su mejor pagina
const porDominio = new Map();
for (const r of puntuados) {
  const g = porDominio.get(r.dominio);
  if (!g) porDominio.set(r.dominio, { dominio: r.dominio, mejor: r, n: 1, familias: new Set(r.familias) });
  else { g.n++; r.familias.forEach((f) => g.familias.add(f)); if (r.puntaje > g.mejor.puntaje) g.mejor = r; }
}
const candidatos = [...porDominio.values()].map((g) => ({
  dominio: g.dominio, tipo: g.mejor.tipo, url: g.mejor.url, titulo: g.mejor.titulo, contenido: g.mejor.contenido,
  coincide: g.mejor.coincide, familias: [...g.familias], apariciones: g.n,
  puntaje: Math.round((g.mejor.puntaje + Math.min(2, (g.n - 1) * 0.5)) * 100) / 100,
})).sort((a, b) => b.puntaje - a.puntaje);

// En una compra al por mayor no se gastan lecturas en tiendas y supermercados en linea (ni en avisos clasificados)
const NO_LEER = ['noticia', 'academico', 'pdf', ...(plan.venta === 'mayor' ? ['tienda'] : [])];
let dirs = 0;
const aLeer = [];
for (const c of candidatos) {
  if (aLeer.length >= cfg.max_paginas) break;
  if (NO_LEER.includes(c.tipo)) continue;
  if (c.tipo === 'directorio') { if (dirs >= 4) continue; dirs++; }
  aLeer.push(c);
}

const porTipo = {};
candidatos.forEach((c) => { porTipo[c.tipo] = (porTipo[c.tipo] || 0) + 1; });

return [{
  json: {
    ...p,
    resultados: puntuados.map((r) => ({ url: r.url, dominio: r.dominio, titulo: r.titulo, contenido: r.contenido, tipo: r.tipo, familias: r.familias })),
    candidatos_total: candidatos.length,
    candidatos_por_tipo: porTipo,
    a_leer: aLeer,
  },
}];
