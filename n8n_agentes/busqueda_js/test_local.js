// Banco de pruebas local: ejecuta los nodos Code en el mismo orden que n8n, con SearXNG y paginas reales
// y respuestas de Claude SIMULADAS (no gasta dinero). Uso: node test_local.js "<solicitud>" [hasta]
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const lib = fs.readFileSync(path.join(dir, '00_lib.js'), 'utf8');

const ctx = {
  helpers: {
    httpRequest: async (o) => {
      const url = new URL(o.url);
      Object.entries(o.qs || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), o.timeout || 30000);
      try {
        const r = await fetch(url, { method: o.method || 'GET', headers: o.headers, signal: ac.signal, redirect: o.disableFollowRedirect ? 'manual' : 'follow' });
        if (!r.ok && !o.ignoreHttpStatusErrors) throw new Error('HTTP ' + r.status);
        const cuerpo = o.json ? await r.json() : await r.text();
        if (o.returnFullResponse) return { body: cuerpo, headers: Object.fromEntries(r.headers.entries()), statusCode: r.status };
        return cuerpo;
      } catch (e) {
        throw new Error((e.cause && (e.cause.code || e.cause.message)) || e.message);
      } finally { clearTimeout(t); }
    },
    prepareBinaryData: async (buf, nombre, mime) => ({ data: buf.toString('base64'), fileName: nombre, mimeType: mime }),
  },
};

const salidas = {};
async function nodo(nombre, archivo, items) {
  const codigo = lib + '\n' + fs.readFileSync(path.join(dir, archivo), 'utf8');
  // El entorno de los nodos Code de n8n no trae URL ni AbortController: aqui fallan en voz alta para no repetir ese error.
  const noExiste = (n) => function () { throw new Error(`${n} no existe en el entorno de n8n`); };
  const fn = new AsyncFunction('$input', '$', '$now', 'URL', 'URLSearchParams', 'AbortController', 'fetch', codigo);
  const $input = { all: () => items, first: () => items[0] };
  const $ = (n) => ({ first: () => salidas[n][0], all: () => salidas[n] });
  const t0 = Date.now();
  const out = await fn.call(ctx, $input, $, {}, noExiste('URL'), noExiste('URLSearchParams'), noExiste('AbortController'), noExiste('fetch'));
  salidas[nombre] = out;
  console.log(`  [${nombre}] ${((Date.now() - t0) / 1000).toFixed(1)}s, ${out.length} item(s)`);
  return out;
}

// ---- Claude simulado ----
const interpretarStub = (texto) => ({
  content: [{ text: JSON.stringify({
    producto: 'harina de trigo panadera', nombre_en: 'bakery wheat flour', sinonimos: ['harina de trigo', 'harina panadera'],
    especificacion: 'uso en panaderia', categoria: 'perecedero', cantidad_pedido: '5 toneladas', cantidad_anual: '60 toneladas',
    pais_destino: /colombia|bogota/i.test(texto) ? 'Colombia' : null, ciudad_destino: /bogota/i.test(texto) ? 'Bogota' : null,
    venta: /al por mayor/i.test(texto) ? 'mayor' : /al detal/i.test(texto) ? 'detal' : 'no_especificado', requisitos_calidad: [],
    certificaciones_requeridas: ['INVIMA'], paises_origen_probables: ['Colombia', 'Argentina', 'Canada'],
    kraljic_provisional: { cuadrante: 'apalancable', razon: 'Muchos molinos capaces y alto gasto anual.' },
    supuestos: ['Se asume entrega en Bogota.'], preguntas_pendientes: [],
    consultas: {
      fabricantes: [{ q: 'molino harina de trigo panadera Colombia fabricante', idioma: 'es' }, { q: 'bakery wheat flour manufacturer exporter', idioma: 'en' }, { q: 'farine de ble boulangerie fabricant', idioma: 'fr' }],
      distribuidores: [{ q: 'distribuidor mayorista harina de trigo Bogota', idioma: 'es' }, { q: 'proveedores harina panaderia por bulto Bogota', idioma: 'es' }],
      precios: [{ q: 'precio harina de trigo por tonelada Colombia 2026', idioma: 'es' }, { q: 'wheat flour price per ton FOB', idioma: 'en' }],
      detal: [{ q: 'precio harina de trigo por kilo Bogota supermercado', idioma: 'es' }, { q: 'donde comprar harina de trigo panadera Bogota', idioma: 'es' }],
      registros_oficiales: [{ q: 'INVIMA registro sanitario harina de trigo molinos', idioma: 'es' }],
      gremios: [{ q: 'molinos de trigo asociacion afiliados Colombia', idioma: 'es' }, { q: 'flour millers association members', idioma: 'en' }],
      reputacion: [{ q: 'molino harina de trigo opiniones reclamos', idioma: 'es' }],
    },
  }) }],
  usage: { input_tokens: 1200, output_tokens: 900 },
});

const extraerStub = (finalistas, cuerpo, i) => {
  const f = finalistas[i];
  const lineas = f.texto.split('\n').filter((l) => l.length > 30);
  const linea = (re) => (lineas.find((l) => re.test(l)) || '').slice(0, 160);
  const campo = (valor, cita) => (cita ? { valor, cita } : null);
  const fab = linea(/fabric|molino|planta|manufactur|produc/i);
  const campos = {
    empresa: campo(f.titulo.split(/[|\-:]/)[0].trim(), linea(new RegExp(f.titulo.split(/[|\-:]/)[0].trim().split(' ')[0], 'i'))),
    tipo: fab ? { valor: /distribu|mayorista/i.test(fab) ? 'distribuidor' : 'fabricante', cita: fab, senales: ['texto de la pagina'] } : null,
    ofrece_producto: campo(true, linea(/harina/i)),
    certificaciones: f.certs.slice(0, 2).map((c) => ({ valor: c, cita: linea(new RegExp(c.replace(' ', '\\s*'), 'i')) })).filter((x) => x.cita),
  };
  if (i === 0) campos.moq = { valor: '500 toneladas', cita: 'Minimo de pedido 500 toneladas por contenedor' }; // inventado a proposito: debe ser descartado
  return { content: [{ text: JSON.stringify(campos) }], usage: { input_tokens: 1500, output_tokens: 350 } };
};

// Extraccion de precios simulada: lee las lineas con "$" de los fragmentos y arma ofertas con cita textual
const preciosStub = (cuerpo) => {
  const c = cuerpo.messages[0].content;
  const moneda = (c.match(/MONEDA PROBABLE DEL SITIO: (\w+)/) || [])[1];
  const lineas = c.slice(c.indexOf('FRAGMENTOS:') + 11).split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean);
  const ofertas = [];
  lineas.forEach((l, i) => {
    const m = l.match(/\$\s?([\d.,]+)/);
    if (!m || ofertas.length >= 8) return;
    const precio = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(precio) || precio <= 0) return;
    const q = (l + ' ' + (lineas[i - 1] || '')).match(/(\d+(?:[.,]\d+)?)\s?(kg|kilos?|gr|g|lb|libras?)\b/i);
    ofertas.push({ descripcion: 'harina', unidades: 1, cantidad: q ? Number(q[1].replace(',', '.')) : null, unidad: q ? q[2].toLowerCase().replace(/^kilos?$/, 'kg').replace(/^libras?$/, 'lb') : null,
      presentacion: q ? q[0] : '', precio, moneda: moneda && moneda !== 'desconocida' ? moneda : null, condicion: 'no_indica', cita: l.slice(0, 200) });
  });
  return { content: [{ text: JSON.stringify({ ofertas }) }], usage: { input_tokens: 600, output_tokens: 250 } };
};

const narrativaStub = () => ({
  content: [{ text: '## Resumen ejecutivo y recomendacion\n(simulado) Hay varios finalistas. El precio equivale a USD 390-410 por tonelada, dentro del rango esperado.\n\n## Lectura de cada proveedor\n(simulado)\n\n## Riesgos y plan B\n(simulado)\n\n## Sensibilidad\n(simulado)' }],
  usage: { input_tokens: 2500, output_tokens: 700 },
});

(async () => {
  const solicitud = process.argv[2] || 'harina de trigo panadera, 5 toneladas por pedido, destino Bogota';
  const hasta = Number(process.argv[3] || 99);
  console.log('Solicitud:', solicitud);
  const t0 = Date.now();
  await nodo('Preparar solicitud', '01_preparar.js', [{ json: { chatInput: solicitud } }]);
  await nodo('Armar plan', '02_plan.js', [{ json: interpretarStub(solicitud) }]);
  const plan = salidas['Armar plan'][0].json;
  console.log(`  modo=${plan.modo} | consultas=${plan.consultas_lista.length} | producto=${plan.plan.producto}`);
  if (hasta <= 2) return;
  await nodo('Ejecutar busquedas', '03_buscar.js', salidas['Armar plan']);
  const b = salidas['Ejecutar busquedas'][0].json;
  console.log(`  consultas=${b.consultas_ejecutadas} | dominios=${b.dominios_distintos} | detenido_por=${b.detenido_por} | resultados=${b.resultados.length}`);
  await nodo('Clasificar y puntuar', '04_clasificar.js', salidas['Ejecutar busquedas']);
  const c = salidas['Clasificar y puntuar'][0].json;
  console.log('  candidatos=', c.candidatos_total, '| por tipo:', JSON.stringify(c.candidatos_por_tipo), '| a leer:', c.a_leer.length);
  if (hasta <= 4) return;
  await nodo('Leer paginas', '05_leer.js', salidas['Clasificar y puntuar']);
  const l = salidas['Leer paginas'][0].json;
  console.log('  lectura:', JSON.stringify(l.estadisticas_lectura));
  const fallos = {};
  l.paginas.filter((g) => g.estado !== 'ok').forEach((g) => { const k = `${g.estado}${g.motivo ? ' (' + g.motivo.slice(0, 50) + ')' : ''}`; fallos[k] = (fallos[k] || 0) + 1; });
  console.log('  motivos de fallo:', JSON.stringify(fallos));
  console.log('  finalistas:', l.finalistas.map((f) => `${f.dominio}[${f.tipo}] emails=${f.emails.length} tel=${f.telefonos.length} certs=${f.certs.join('/')}`).join('\n              '));
  await nodo('Preparar extracciones', '06_preparar_extraccion.js', salidas['Leer paginas']);
  const e = salidas['Preparar extracciones'];
  console.log('  extracciones a pedir:', e.length, `(finalistas ${e.filter((x) => x.json.tipo_item === 'finalista').length}, paginas de precio ${e.filter((x) => x.json.tipo_item === 'precios').length})`, '| tamano medio del texto enviado a Claude:', Math.round(e.reduce((s, x) => s + x.json.claude_body.messages[0].content.length, 0) / e.length), 'caracteres');
  if (hasta <= 6) return;
  let fi = 0;
  salidas['Claude: extraer datos'] = e.map((it) => ({ json: it.json.omitir ? { content: [{ text: 'ok' }], usage: {} } : it.json.tipo_item === 'precios' ? preciosStub(it.json.claude_body) : extraerStub(l.finalistas, it.json.claude_body, fi++) }));
  await nodo('Verificar y calificar', '07_verificar.js', salidas['Claude: extraer datos']);
  salidas['Claude: redactar informe'] = [{ json: narrativaStub() }];
  await nodo('Armar informe', '08_informe.js', salidas['Claude: redactar informe']);
  const inf = salidas['Armar informe'][0].json;
  fs.writeFileSync(path.join(dir, '_prueba_informe.md'), salidas['Armar informe'][1].binary ? Buffer.from(salidas['Armar informe'][1].binary.data.data, 'base64').toString('utf8') : inf.output, 'utf8');
  fs.writeFileSync(path.join(dir, '_prueba_chat.md'), inf.output, 'utf8');
  const vv = salidas['Verificar y calificar'][0].json;
  console.log('  ofertas:', vv.ofertas.length, '| stats:', JSON.stringify(vv.stats_precios), '| fx:', JSON.stringify(vv.fx));
  console.log('  informe: ' + inf.output.length + ' caracteres -> _prueba_informe.md');
  console.log(`TOTAL ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch((err) => { console.error('ERROR:', err); process.exit(1); });
