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

if (!fin.length) {
  // Sin finalistas no hay nada que extraer: llamada minima para mantener el flujo (cuesta casi cero)
  return [{ json: { omitir: true, dominio: '', claude_body: { model: MODELO, max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] } } }];
}

return fin.map((f) => ({
  json: {
    omitir: false,
    dominio: f.dominio,
    url: f.url,
    claude_body: {
      model: MODELO,
      max_tokens: 1100,
      temperature: 0,
      system: PROMPT_EXTRAER,
      messages: [{ role: 'user', content: `ESPECIFICACION BUSCADA: ${espec}\nURL: ${f.url}\nTEXTO DE LA PAGINA:\n${recortar(f.texto, 4200)}` }],
    },
  },
}));
