// Nodo "Armar informe": junta los calculos con el comentario de Claude (si hubo) y prepara los archivos.
const calc = $('Calcular inventario').first().json;
let textoIA = '';
let usoIA = null;
try {
  const r = $('Claude: comentario').first().json;
  textoIA = r && r.content && r.content[0] ? String(r.content[0].text || '') : '';
  usoIA = r && r.usage ? r.usage : null;
} catch (e) { /* no se uso IA en esta corrida */ }

const comentario = textoIA ? limpiarComentario(textoIA, calc.entrada_ia) : '';
const uso = usoIA ? { llamadas: 1, entrada: usoIA.input_tokens || 0, salida: usoIA.output_tokens || 0, costo: ((usoIA.input_tokens || 0) * PRECIO_MTOK.entrada + (usoIA.output_tokens || 0) * PRECIO_MTOK.salida) / 1e6 } : null;
const inf = armarInforme({ res: calc.res, ind: calc.ind, cfg: calc.cfg, comentario, uso, tiempos: calc.ms });

const base = `${CARPETA_INFORMES}\\inventario_${calc.res.ym}`;
const salidaChat = `${inf.chat}\n\nInforme completo (tablas, indicadores y supuestos): ${base}.html\nPedido sugerido para Excel: ${base}_pedido.csv`;
const bin = async (contenido, nombre, mime) => this.helpers.prepareBinaryData(Buffer.from(contenido, 'utf8'), nombre, mime);

return [
  { json: { ruta: `${base}.html`, output: salidaChat }, binary: { data: await bin(inf.html, 'informe.html', 'text/html') } },
  { json: { ruta: `${base}.md`, output: salidaChat }, binary: { data: await bin(inf.md, 'informe.md', 'text/markdown') } },
  { json: { ruta: `${base}_pedido.csv`, output: salidaChat }, binary: { data: await bin(inf.csvPedido, 'pedido.csv', 'text/csv') } },
  { json: { ruta: `${base}_detalle.csv`, output: salidaChat }, binary: { data: await bin(inf.csvDetalle, 'detalle.csv', 'text/csv') } },
];
