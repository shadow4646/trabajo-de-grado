// Servidor local que imita la API de mensajes de Claude con respuestas deterministas. Solo para pruebas del workflow
// dentro de n8n sin gastar dinero ni depender de una clave. Uso: node mock_claude.js [puerto]
const http = require('http');
const puerto = Number(process.argv[2] || 8899);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function interpretar() {
  return {
    producto: 'harina de trigo panadera', nombre_en: 'bakery wheat flour', sinonimos: ['harina de trigo', 'harina panadera'],
    especificacion: 'uso en panaderia', categoria: 'perecedero', cantidad_pedido: '5 toneladas', cantidad_anual: '60 toneladas',
    pais_destino: 'Colombia', ciudad_destino: 'Bogota', venta: 'mayor', requisitos_calidad: ['proteina 11 a 13 por ciento'],
    certificaciones_requeridas: ['INVIMA'], paises_origen_probables: ['Colombia', 'Argentina', 'Canada'],
    kraljic_provisional: { cuadrante: 'apalancable', razon: 'Muchos molinos capaces y alto gasto anual.' },
    supuestos: ['Se asume entrega en Bogota.'], preguntas_pendientes: [],
    consultas: {
      fabricantes: [{ q: 'molino harina de trigo panadera Colombia fabricante', idioma: 'es' }, { q: 'bakery wheat flour manufacturer exporter', idioma: 'en' }, { q: 'farine de ble boulangerie fabricant', idioma: 'fr' }],
      distribuidores: [{ q: 'distribuidor mayorista harina de trigo Bogota', idioma: 'es' }, { q: 'proveedores harina panaderia por bulto Bogota', idioma: 'es' }],
      precios: [{ q: 'precio harina de trigo por tonelada Colombia 2026', idioma: 'es' }, { q: 'wheat flour price per ton FOB', idioma: 'en' }],
      registros_oficiales: [{ q: 'INVIMA registro sanitario harina de trigo molinos', idioma: 'es' }],
      gremios: [{ q: 'molinos de trigo asociacion afiliados Colombia', idioma: 'es' }],
      reputacion: [{ q: 'molino harina de trigo opiniones reclamos', idioma: 'es' }],
    },
  };
}

function extraer(contenido) {
  const texto = contenido.split('TEXTO DE LA PAGINA:\n')[1] || '';
  const lineas = texto.split('\n').map((l) => l.trim()).filter((l) => l.length > 20);
  const hallar = (re) => (lineas.find((l) => re.test(norm(l))) || '').slice(0, 200);
  const campo = (valor, cita) => (cita ? { valor, cita } : null);
  const fab = hallar(/fabric|molino|manufactur|planta|produc/);
  const dis = hallar(/distribu|mayorista|comercializ/);
  const lPrecio = lineas.find((l) => /\$\s?[\d.,]+/.test(l) && /bulto|kg|kilo|tonelada|libra|\bton\b/i.test(l)) || '';
  const m = lPrecio.match(/\$\s?([\d.,]+)/);
  const valor = m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
  const certs = ['ISO 9001', 'ISO 22000', 'HACCP', 'INVIMA', 'BPM'].map((c) => ({ valor: c, cita: hallar(new RegExp(c.toLowerCase().replace(' ', '\\s*'))) })).filter((x) => x.cita);
  return {
    empresa: campo((lineas[0] || '').slice(0, 80), (lineas[0] || '').slice(0, 120)),
    tipo: fab ? { valor: 'fabricante', cita: fab, senales: ['menciona produccion o molino'] } : (dis ? { valor: 'distribuidor', cita: dis, senales: ['menciona distribucion'] } : null),
    ofrece_producto: campo(true, hallar(/harina/)),
    productos: campo(['harina de trigo'], hallar(/harina/)),
    certificaciones: certs,
    precio: valor ? { valor, moneda: 'COP', unidad: /tonelada/i.test(lPrecio) ? 'tonelada' : (/bulto/i.test(lPrecio) ? 'bulto' : 'kg'), condicion: 'lista', cita: lPrecio.slice(0, 200) } : null,
  };
}

function narrativa(contenido) {
  let datos = {};
  try { datos = JSON.parse(contenido); } catch (e) { /* sin datos */ }
  const r = datos.ranking || [];
  const nombre = (i) => (r[i] ? r[i].proveedor : 'sin proveedor');
  return `## Resumen ejecutivo y recomendacion\nSegun el ranking verificado, el proveedor principal es ${nombre(0)} y el respaldo es ${nombre(1)}. Antes de comprar hay que validar certificaciones, precio por volumen y plazos con un RFQ. (texto simulado)\n\n## Lectura de cada proveedor\n${r.map((x) => `**${x.proveedor}**: ${x.veredicto}.`).join('\n\n')}\n\n## Riesgos y plan B\nSi el principal falla, usar ${nombre(1)}. (texto simulado)\n\n## Sensibilidad\n${datos.sensibilidad || ''}`;
}

http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    let texto = '';
    let n = 0;
    try {
      const b = JSON.parse(cuerpo);
      const sistema = b.system || '';
      const usuario = b.messages?.[0]?.content || '';
      n = Math.ceil((sistema.length + usuario.length) / 4);
      if (sistema.includes('prepara el plan de busqueda web') || sistema.includes('preparar el plan de busqueda')) texto = JSON.stringify(interpretar());
      else if (sistema.includes('Extraes datos de proveedores')) texto = JSON.stringify(extraer(usuario));
      else if (sistema.includes('redacta la parte narrativa')) texto = narrativa(usuario);
      else texto = 'ok';
    } catch (e) { texto = 'error: ' + e.message; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model: 'mock', content: [{ type: 'text', text: texto }], usage: { input_tokens: n, output_tokens: Math.ceil(texto.length / 4) } }));
  });
}).listen(puerto, '127.0.0.1', () => console.log('mock de Claude escuchando en 127.0.0.1:' + puerto));
