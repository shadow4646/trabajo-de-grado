// Nodo "Preparar extracciones": un item por finalista con el texto recortado que se enviara a Claude.
const p = $input.first().json;
const plan = p.plan;

const CLAVES = /precio|price|usd|cop|\$|minimo|minimum|moq|pedido|certific|iso|haccp|invima|capacidad|toneladas|tons|años|anos|desde|fundad|planta|fabric|manufactur|export|incoterm|fob|cif|entrega|delivery|envio|shipping|direccion|address|ubicad|contacto|telefono/i;

const recortar = (texto, max) => {
  const lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  let salida = '';
  const usadas = new Set();
  for (let i = 0; i < lineas.length && salida.length < 1400; i++) { salida += lineas[i].slice(0, 300) + '\n'; usadas.add(i); }
  for (let i = 0; i < lineas.length && salida.length < max; i++) {
    if (!usadas.has(i) && CLAVES.test(norm(lineas[i]))) salida += lineas[i].slice(0, 300) + '\n';
  }
  return salida.slice(0, max);
};

const espec = `${plan.producto}${plan.especificacion ? ' (' + plan.especificacion + ')' : ''}`;
const fin = p.finalistas || [];
const cfg = p.cfg;

// Paginas con precios: se leen con una llamada barata que solo recibe las lineas con precio (no la pagina completa)
const monedaDe = (dom) => MONEDA_TLD[String(dom).split('.').pop()] || null;
const paginasPrecio = (p.paginas || [])
  .filter((g) => g.estado === 'ok' && g.habla_producto && g.n_precios > 0 && (g.ventanas || '').length >= 10)
  .sort((a, b) => b.puntaje - a.puntaje)
  .slice(0, cfg.max_paginas_precio || 12);

const items = [
  ...fin.map((f) => ({
    json: {
      omitir: false, tipo_item: 'finalista', dominio: f.dominio, url: f.url,
      claude_body: {
        model: MODELO, max_tokens: 1100, temperature: 0, system: PROMPT_EXTRAER,
        messages: [{ role: 'user', content: `ESPECIFICACION BUSCADA: ${espec}
URL: ${f.url}
TEXTO DE LA PAGINA:
${recortar(f.texto, 4200)}` }],
      },
    },
  })),
  ...paginasPrecio.map((g) => ({
    json: {
      omitir: false, tipo_item: 'precios', dominio: g.dominio, url: g.url,
      claude_body: {
        model: MODELO, max_tokens: 1200, temperature: 0, system: PROMPT_PRECIOS,
        messages: [{ role: 'user', content: `PRODUCTO BUSCADO: ${espec}
MONEDA PROBABLE DEL SITIO: ${g.moneda_probable || monedaDe(g.dominio) || 'desconocida'}
URL: ${g.url}
FRAGMENTOS:
${g.ventanas}` }],
      },
    },
  })),
];

if (!items.length) {
  // Nada que extraer: llamada minima para mantener el flujo (cuesta casi cero)
  return [{ json: { omitir: true, dominio: '', claude_body: { model: MODELO, max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] } } }];
}

return items;
