// Nodo "Armar informe": une la narrativa de Claude con las secciones generadas por codigo y prepara los archivos.
const v = $('Verificar y calificar').first().json;
const resp = $input.first().json;
const plan = v.plan;
const cands = v.candidatos || [];

const textoNarr = resp?.content?.[0]?.text ?? '';
const uso = resp?.usage ?? {};
const llamadas = [...(v.llamadas || []), { etapa: 'redactar', entrada: uso.input_tokens ?? 0, salida: uso.output_tokens ?? 0, ok: !!textoNarr && !v.sin_finalistas }];
const tokIn = llamadas.reduce((s, x) => s + (x.entrada || 0), 0);
const tokOut = llamadas.reduce((s, x) => s + (x.salida || 0), 0);
const costo = (tokIn * PRECIO_MTOK.entrada + tokOut * PRECIO_MTOK.salida) / 1e6;

const NE = 'NO ENCONTRADO';
const nombreDe = (c) => c?.nombre || c?.dominio;
const celda = (t) => String(t ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
const lista = (arr) => (arr && arr.length ? arr.join(', ') : NE);
const sinUnidad = (c) => !c.precio.unidad || ['no_indica', 'null', 'n/a'].includes(String(c.precio.unidad).toLowerCase());
const precioTxt = (c) => (c.precio ? `${c.precio.valor} ${c.precio.moneda || ''}${sinUnidad(c) ? ' (sin unidad indicada)' : '/' + c.precio.unidad}${c.precio.condicion && c.precio.condicion !== 'no_indica' ? ' (' + c.precio.condicion + ')' : ''}` : NE);

// ---------- Narrativa (con limpieza) ----------
let narr = sinGuiones(textoNarr).trim();
// Control de cifras: una frase con dinero cuyas cifras no estan en los datos verificados se elimina (el modelo puede convertir
// monedas o inventar rangos de precio, y eso no se puede comprobar).
const digitos = (t) => (String(t).match(/\d[\d.,]*/g) || []).map((n) => n.replace(/\D/g, '')).filter(Boolean);
const cifrasConocidas = new Set(digitos(v.claude_body?.messages?.[0]?.content ?? ''));
let frasesEliminadas = 0;
narr = narr.split('\n').map((linea) => {
  if (/^\s*#/.test(linea)) return linea;
  return linea.split(/(?<=[.!?])\s+/).filter((frase) => {
    if (!/usd|eur\b|\bcop\b|us\$|\$|€|d[oó]lar|euro|pesos/i.test(frase)) return true;
    const desconocidas = digitos(frase).filter((d) => !cifrasConocidas.has(d));
    if (desconocidas.length) { frasesEliminadas++; return false; }
    return true;
  }).join(' ');
}).join('\n');
if (frasesEliminadas) narr += '\n\n> Nota del sistema: se eliminaron ' + frasesEliminadas + ' frase(s) de esta narrativa por contener cifras de dinero que no estaban en los datos verificados.';
const urlsPermitidas = new Set([...cands.map((c) => c.url), ...(v.paginas || []).map((g) => g.url)]);
narr = narr.replace(/https?:\/\/[^\s)\]>"']+/g, (u) => (urlsPermitidas.has(u) ? u : '[enlace no verificado, eliminado]'));
if (!narr || v.sin_finalistas) {
  narr = v.sin_finalistas
    ? '## Resumen ejecutivo y recomendacion\nNo se pudo verificar ningun proveedor con las fuentes publicas leidas, por lo que no hay una recomendacion de compra. Revisa el anexo de cobertura para ver que se intento y que fallo, y considera pedir la busqueda en modo profunda o agregar datos del producto.\n'
    : '## Resumen ejecutivo y recomendacion\nNo se pudo generar la narrativa con IA en esta corrida. Las tablas y fichas siguientes si fueron verificadas por codigo; usa el ranking de la tabla comparativa.\n';
}

// ---------- Secciones generadas por codigo ----------
const L = [];
// ---------- Bloque de precios: lo primero que se lee ----------
const miles = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const num = (x) => (Math.abs(x) >= 100 ? miles(x) : String(Math.round(x * 100) / 100).replace('.', ','));
const mdest = v.moneda_destino || 'COP';
const baseDom = v.base_dominante || 'kg';
const urlMd = (u) => String(u).replace(/\)/g, '%29').replace(/\|/g, '%7C').replace(/\s/g, '%20');
const ofertasV = (v.ofertas || []).filter((o) => !o.fuera_de_destino);
const otrosPaises = v.ofertas_otros_paises || 0;
const st = v.stats_precios || {};
const destinoTxt = `${[plan.ciudad_destino, plan.pais_destino].filter(Boolean).join(', ') || NE}${plan.destino_por_defecto ? ' (asumido, no lo indicaste)' : ''}`;
const ordenOferta = (a, b) => ((a.precio_base_destino ?? Infinity) - (b.precio_base_destino ?? Infinity)) || ((a.precio_base ?? Infinity) - (b.precio_base ?? Infinity));
const comparableTxt = (o) => (o.precio_base_destino !== null ? `${num(o.precio_base_destino)} ${mdest}/${o.base}` : (o.precio_base !== null && o.moneda ? `${num(o.precio_base)} ${o.moneda}/${o.base} (sin pasar a ${mdest})` : (o.precio_base !== null ? 'moneda no clara' : 'sin cantidad clara')));
const esComparable = (o) => o.precio_base_destino !== null || (o.precio_base !== null && !!o.moneda);
const cantidadTxt = (o) => (o.cantidad_total ? `${num(o.cantidad_total)} ${o.base}` : celda(String(o.presentacion || o.descripcion || 'cantidad no clara').slice(0, 50)));
const filaOferta = (o, i) => `| ${i + 1} | ${celda(o.nombre)} | ${cantidadTxt(o)} | ${num(o.precio)} ${o.moneda || 'moneda?'} | **${comparableTxt(o)}** | [${o.dominio}](${urlMd(o.url)}) |`;
const tablaOfertas = (arr, max) => ['| # | Proveedor | Cantidad | Precio publicado | Precio comparable | Donde |', '|---|---|---|---|---|---|', ...[...arr].sort(ordenOferta).slice(0, max || 99).map(filaOferta)];
const lineaStat = (s, etiqueta) => (s
  ? (s.n === 1 ? `- **${etiqueta}:** ${num(s.minimo)} ${mdest}/${baseDom}, segun 1 oferta.`
    : s.n < 4 ? `- **${etiqueta}:** de ${num(s.minimo)} a ${num(s.maximo)} ${mdest}/${baseDom}, segun ${s.n} ofertas.`
    : `- **${etiqueta}:** lo tipico es ${num(s.mediana)} ${mdest}/${baseDom} (la mitad de las ofertas esta entre ${num(s.q1)} y ${num(s.q3)}; minimo ${num(s.minimo)}, maximo ${num(s.maximo)}), segun ${s.n} ofertas.`)
  : null);
const lineasResumen = [];
if (st.detal) lineasResumen.push(lineaStat(st.detal, 'Al detal'));
else if (plan.venta !== 'mayor') lineasResumen.push('- **Al detal:** no se encontraron precios comparables.');
if (st.mayor) lineasResumen.push(lineaStat(st.mayor, 'Al por mayor'));
else if (plan.venta !== 'detal') lineasResumen.push('- **Al por mayor:** no hay precios publicos comparables; se piden por cotizacion (borrador al final del informe).');
const fx = v.fx || {};
if (fx.fuente) lineasResumen.push(`- Tipo de cambio a ${mdest}: ${fx.fuente}${fx.fecha ? ', actualizado ' + fx.fecha : ''}. Es una referencia, no una tasa oficial.`);
const GRUPOS_VENTA = [['detal', 'Al detal'], ['mayor', 'Al por mayor'], ['sin_clasificar', 'Venta no indicada']];
const porVenta = (t) => ofertasV.filter((o) => o.venta === t);
const hayPorTamano = ofertasV.some((o) => o.venta_por_tamano);
const notaPrecios = `Los precios son los publicados en cada pagina el dia de la consulta y pueden cambiar. El precio comparable divide el precio por la cantidad que la pagina indica; si no era clara, no se calcula. Pueden faltar flete e impuestos.${otrosPaises ? ` Se omitieron ${otrosPaises} precios al detal en monedas de otros paises.` : ''}${hayPorTamano ? ' Cuando la pagina no dice si es detal o mayor, se clasifico por tamano (hasta 10 kg detal, desde 25 kg mayor).' : ''}`;

L.push(`# Precios de ${plan.producto}`);
L.push('');
L.push(`Consulta del ${v.fecha} | Destino: ${destinoTxt} | Modo: ${v.modo}`);
L.push('');
L.push('## Cuanto cuesta');
lineasResumen.forEach((t) => L.push(t));
L.push('');
L.push('## Cuadro de precios');
if (!ofertasV.length) {
  L.push('No se encontraron precios publicos verificables en las paginas leidas. Los precios por volumen se piden por cotizacion: el borrador esta al final del informe.');
  L.push('');
} else {
  for (const [clave, titulo] of GRUPOS_VENTA) {
    const arr = porVenta(clave);
    if (!arr.length) { if (clave !== 'sin_clasificar' && !(clave === 'detal' && plan.venta === 'mayor') && !(clave === 'mayor' && plan.venta === 'detal')) { L.push(`### ${titulo}`); L.push('No se encontraron precios publicos.'); L.push(''); } continue; }
    L.push(`### ${titulo}`);
    tablaOfertas(arr).forEach((t) => L.push(t));
    L.push('');
  }
  L.push(`> ${notaPrecios}`);
  L.push('');
}
// Donde conseguirlo: primero los proveedores con precio (del mas barato al mas caro), luego los finalistas sin precio publicado
const paginaDe = new Map((v.paginas || []).map((g) => [g.dominio, g]));
const mejorPorDominio = new Map();
[...ofertasV].sort(ordenOferta).forEach((o) => { if (!mejorPorDominio.has(o.dominio)) mejorPorDominio.set(o.dominio, o); });
const hayCompar = esComparable;
const fuentes = [];
for (const o of mejorPorDominio.values()) fuentes.push({ dominio: o.dominio, nombre: o.nombre, url: o.url, mejor: hayCompar(o) ? comparableTxt(o) : 'sin precio comparable', cand: cands.find((c) => c.dominio === o.dominio) });
for (const c of cands) if (!mejorPorDominio.has(c.dominio)) fuentes.push({ dominio: c.dominio, nombre: nombreDe(c), url: c.url, mejor: 'sin precio publicado', cand: c });
const contactoDe = (f) => {
  const g = paginaDe.get(f.dominio);
  return [f.cand?.emails?.[0] || g?.emails?.[0], f.cand?.telefonos?.[0] || g?.telefonos?.[0]].filter(Boolean).join(' / ') || NE;
};
if (fuentes.length) {
  L.push('## Donde conseguirlo');
  L.push('| # | Proveedor | Mejor precio | Contacto | Donde |');
  L.push('|---|---|---|---|---|');
  fuentes.slice(0, 12).forEach((f, i) => L.push(`| ${i + 1} | ${celda(f.nombre)} | ${f.mejor} | ${celda(contactoDe(f))} | [${f.dominio}](${urlMd(f.url)}) |`));
  L.push('');
}
L.push(narr);
L.push('');
L.push('> Este informe es un escaneo de mercado previo a una cotizacion formal (RFQ): con informacion publica no se conocen precios por volumen, plazos de pago ni capacidad real. Los datos de cada ficha se verificaron por codigo contra el texto de la pagina.');
L.push('');

L.push('## Supuestos declarados y clasificacion Kraljic provisional');
L.push(`- Clasificacion Kraljic provisional: ${plan.kraljic?.cuadrante || 'no determinada'}. ${plan.kraljic?.razon || ''}`);
(plan.supuestos || []).forEach((s) => L.push(`- ${s}`));
L.push('');
L.push('## Especificacion interpretada');
L.push(`- Producto: ${plan.producto}${plan.nombre_en ? ' (' + plan.nombre_en + ')' : ''}`);
L.push(`- Especificacion: ${plan.especificacion || NE}`);
L.push(`- Cantidad por pedido: ${plan.cantidad_pedido || NE} | Cantidad anual: ${plan.cantidad_anual || NE}`);
L.push(`- Destino: ${[plan.ciudad_destino, plan.pais_destino].filter(Boolean).join(', ') || NE} | Modalidad: ${plan.venta}`);
L.push(`- Certificaciones o registros requeridos: ${lista(plan.certificaciones_requeridas)}`);
L.push(`- Requisitos de calidad: ${lista(plan.requisitos_calidad)}`);
L.push('');

if (cands.length) {
  L.push('## Calificacion de proveedores');
  L.push('| # | Proveedor | Tipo | Identidad | Certificaciones | Precio de referencia | Cobertura | Menciones indep. | Veredicto |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  cands.forEach((c, i) => L.push(`| ${i + 1} | ${celda(nombreDe(c))} | ${c.cal.tipo} | ${c.cal.identidad} | ${c.cal.certificaciones} | ${celda(precioTxt(c))} | ${c.cal.cobertura} | ${c.menciones.length} | ${celda(c.veredicto)} |`));
  L.push('');
  L.push(`Sensibilidad del ranking: ${v.sensibilidad}`);
  L.push('');
  L.push('Nota sobre certificaciones: una calificacion "Alto" significa que el sitio del propio proveedor menciona los registros requeridos. No se consulto el registro oficial (por ejemplo INVIMA o RUES), asi que debe confirmarse con el certificado vigente antes de comprar.');
  L.push('');
  L.push('## Ficha por proveedor');
  cands.forEach((c, i) => {
    L.push(`### ${i + 1}. ${nombreDe(c)}`);
    L.push(`- Sitio: ${c.url}`);
    L.push(`- Veredicto: ${c.veredicto}`);
    L.push(`- Tipo: ${c.cal.tipo}${c.tipo?.cita ? ` (cita de la pagina: "${c.tipo.cita}")` : ' (sin evidencia textual suficiente)'}`);
    L.push(`- Que ofrece: ${c.productos ? lista(c.productos.valor) : NE}`);
    L.push(`- Ubicacion: ${[c.ciudad?.valor, c.pais?.valor].filter(Boolean).join(', ') || NE}${c.direccion ? ' | Direccion: ' + c.direccion.valor : ''}`);
    L.push(`- Contacto extraido del texto de la pagina: correos: ${lista(c.emails)} | telefonos (posibles): ${lista(c.telefonos)}`);
    L.push(`- Certificaciones declaradas: ${lista([...new Set([...c.certificaciones.map((x) => x.valor), ...c.certs_codigo])])}`);
    L.push(`- Precio de referencia: ${precioTxt(c)}${c.precio?.cita ? ` (cita: "${c.precio.cita}")` : ''}`);
    L.push(`- Minimo de pedido: ${c.moq ? c.moq.valor : NE} | Incoterm: ${c.incoterm ? c.incoterm.valor : NE} | Plazo de entrega: ${c.plazo ? c.plazo.valor : NE}`);
    L.push(`- Antiguedad: ${c.anios ? c.anios.valor : NE} | Capacidad: ${c.capacidad ? c.capacidad.valor : NE} | Envio internacional: ${c.envio ? (c.envio.valor ? 'si (declarado)' : 'no (declarado)') : NE}`);
    L.push(`- Menciones en fuentes independientes: ${c.menciones.length}${c.menciones.length ? ' (' + c.menciones.slice(0, 5).join(', ') + ')' : ''}`);
    L.push(`- Posibles alertas de reputacion (verificar que sean la misma empresa y no una homonima): ${c.alertas.length ? c.alertas.map((a) => `${a.titulo} (${a.url})`).join('; ') : 'ninguna encontrada en las fuentes revisadas'}`);
    if (c.descartados.length) L.push(`- Datos descartados por no poder verificarse: ${c.descartados.map((d) => `${d.campo} (${d.motivo})`).join(', ')}`);
    L.push('');
  });
}

if (v.riesgos && v.riesgos.length) {
  L.push('## Riesgos detectados por el sistema');
  v.riesgos.forEach((r) => L.push(`- ${r}`));
  L.push('');
}

// Borrador de RFQ
L.push('## Borrador de solicitud de cotizacion (RFQ)');
L.push(`**Asunto:** Solicitud de cotizacion: ${plan.producto}`);
L.push('');
L.push('Estimados senores:');
L.push('');
L.push(`Estamos interesados en comprar ${plan.producto}${plan.especificacion ? ' (' + plan.especificacion + ')' : ''}. Cantidad: ${plan.cantidad_pedido || '[indicar por pedido]'} por pedido y ${plan.cantidad_anual || '[indicar anual]'} al ano. Destino: ${[plan.ciudad_destino, plan.pais_destino].filter(Boolean).join(', ') || '[indicar destino]'}. Modalidad: ${plan.venta === 'no_especificado' ? '[mayor o detal]' : plan.venta}.`);
L.push('');
L.push('Les agradecemos una cotizacion formal que incluya:');
[
  'Precio unitario y escala de precios por volumen (tramos), con moneda y vigencia de la oferta.',
  'Cantidad minima de pedido y presentacion o empaque.',
  'Incoterm y lugar de entrega, con el costo de flete e impuestos si aplica.',
  'Plazo de entrega y capacidad de suministro mensual.',
  'Condiciones y plazos de pago.',
  `Certificaciones y documentos: ${(plan.certificaciones_requeridas || []).length ? plan.certificaciones_requeridas.join(', ') + ', ' : ''}certificado de analisis por lote, ficha tecnica y ficha de seguridad.`,
  'Muestras: disponibilidad, costo y tiempo.',
  'Politica de calidad: tolerancia de defectos, devoluciones y garantias.',
  'Referencias de clientes comparables.',
].forEach((t, i) => L.push(`${i + 1}. ${t}`));
L.push('');
L.push('Quedamos atentos a su respuesta.');
L.push('');
if (cands.length) {
  L.push('Preguntas adicionales por proveedor, segun lo que no se pudo verificar:');
  cands.slice(0, 5).forEach((c) => {
    const f = [];
    if (!c.precio) f.push('precio de referencia');
    if (!c.moq) f.push('minimo de pedido');
    if (!c.incoterm) f.push('Incoterm');
    if (!c.plazo) f.push('plazo de entrega');
    if (c.cal.certificaciones === 'No verificable' || c.cal.certificaciones === 'Bajo') f.push('certificaciones requeridas');
    if (!c.emails.length && !c.telefonos.length) f.push('datos de contacto verificables');
    L.push(`- ${nombreDe(c)}: ${f.length ? f.join(', ') : 'sin datos faltantes relevantes'}`);
  });
  L.push('');
}

// Anexo A: cobertura
const log = v.log_busqueda || [];
const porFam = {};
log.forEach((x) => { const f = porFam[x.familia] = porFam[x.familia] || { consultas: 0, resultados: 0, nuevos: 0 }; f.consultas++; f.resultados += x.resultados; f.nuevos += x.nuevos_dominios; });
const el = v.estadisticas_lectura || {};
const motivos = {};
(v.paginas || []).filter((g) => g.estado !== 'ok').forEach((g) => { const k = g.estado + (g.motivo ? ' (' + g.motivo.slice(0, 40) + ')' : ''); motivos[k] = (motivos[k] || 0) + 1; });
const paradas = { lista_completa: 'se ejecuto toda la lista de consultas', saturacion: 'las ultimas consultas ya no aportaban dominios nuevos (saturacion)', limite_de_consultas: 'se alcanzo el limite de consultas del modo', presupuesto_de_tiempo: 'se alcanzo el limite de tiempo del modo' };
L.push('## Anexo A: cobertura de la busqueda');
L.push(`- Modo: ${v.modo}. Consultas ejecutadas: ${v.consultas_ejecutadas}. Parada: ${paradas[v.detenido_por] || v.detenido_por}.`);
L.push(`- Dominios distintos encontrados: ${v.dominios_distintos}. Candidatos por tipo: ${Object.entries(v.candidatos_por_tipo || {}).map(([k, n]) => `${k} ${n}`).join(', ')}.`);
const mot = Object.entries(v.motores_busqueda || {}).sort((a, b) => b[1].resultados - a[1].resultados);
if (mot.length) L.push(`- Buscadores que respondieron: ${mot.filter(([, x]) => x.resultados > 0).map(([k, x]) => `${k} (${x.resultados} resultados)`).join(', ') || 'ninguno'}.`);
const caidos = mot.filter(([, x]) => x.fallos > 0);
if (caidos.length) L.push(`- Buscadores que fallaron en alguna consulta: ${caidos.map(([k, x]) => `${k} (${x.fallos} veces${x.motivos.length ? ': ' + x.motivos.join(', ') : ''})`).join('; ')}. Si falla un buscador, la cobertura baja aunque la lista de consultas se haya completado.`);
if (v.consultas_sin_resultados) L.push(`- Consultas que no devolvieron ningun resultado: ${v.consultas_sin_resultados} de ${v.consultas_ejecutadas}.`);
L.push('');
L.push('| Familia de consultas | Consultas | Resultados | Dominios nuevos |');
L.push('|---|---|---|---|');
Object.entries(porFam).forEach(([f, x]) => L.push(`| ${f} | ${x.consultas} | ${x.resultados} | ${x.nuevos} |`));
L.push('');
L.push(`- Paginas leidas: ${el.intentadas || 0} intentadas, ${el.ok || 0} con texto util, ${el.bloqueadas || 0} bloqueadas por el sitio, ${el.vacias_js || 0} vacias o que requieren JavaScript, ${el.errores || 0} con error de red o HTTP${el.bloqueadas_seguridad ? `, ${el.bloqueadas_seguridad} descartadas por seguridad (direccion interna o no publica)` : ''}.`);
if (Object.keys(motivos).length) L.push(`- Motivos de fallo: ${Object.entries(motivos).map(([k, n]) => `${k}: ${n}`).join('; ')}.`);
L.push(`- Finalistas analizados: ${cands.length}. Paginas de contacto o "acerca de" leidas: ${el.paginas_extra_contacto || 0}. Consultas de reputacion: ${v.consultas_reputacion || 0}.`);
const vf = v.verificacion || { campos_totales: 0, campos_descartados: 0 };
L.push(`- Verificacion por codigo: ${vf.campos_totales} datos extraidos por la IA, ${vf.campos_descartados} descartados por no tener una cita textual que aparezca en la pagina${vf.campos_totales ? ` (${Math.round((vf.campos_descartados / vf.campos_totales) * 100)}%)` : ''}.`);
L.push(`- Uso de IA: ${llamadas.length} llamadas al modelo ${MODELO}, ${tokIn} tokens de entrada y ${tokOut} de salida. Costo estimado: ${costo.toFixed(3)} USD (precio de referencia de terceros, no oficial).`);
L.push('- Limites: solo se busco en la web publica que indexan los buscadores; no se consultaron bases de importaciones de pago, precios tras inicio de sesion, ni la dark web. Los sitios que bloquean robots o requieren JavaScript solo se vieron por el resumen del buscador. Los resultados del buscador pueden estar desactualizados.');
L.push('');

// Anexo B: fuentes
L.push('## Anexo B: fuentes consultadas');
cands.forEach((c, i) => L.push(`- Finalista ${i + 1}: ${c.url}`));
const otrasOk = (v.paginas || []).filter((g) => g.estado === 'ok' && !cands.some((c) => c.dominio === g.dominio));
if (otrasOk.length) { L.push('- Otras paginas leidas (no finalistas):'); otrasOk.slice(0, 40).forEach((g) => L.push(`  - ${g.url} (${g.tipo})`)); }
const noLeidas = (v.paginas || []).filter((g) => g.estado !== 'ok');
if (noLeidas.length) { L.push('- No se pudieron leer:'); noLeidas.slice(0, 30).forEach((g) => L.push(`  - ${g.url} (${g.estado})`)); }
L.push('');

const mdArchivo = sinGuiones(L.join('\n')).replace(/\n{3,}/g, '\n\n');

// ---------- HTML ----------
const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/(?<!["'>=])(https?:\/\/[^\s<)]+)/g, '<a href="$1">$1</a>');
const mdAHtml = (md) => {
  const out = [];
  let lista = false;
  let tabla = false;
  let primeraFila = true;
  const cerrar = () => { if (lista) { out.push('</ul>'); lista = false; } if (tabla) { out.push('</table>'); tabla = false; primeraFila = true; } };
  for (const l of md.split('\n')) {
    if (/^\|.*\|$/.test(l)) {
      if (!tabla) { cerrar(); out.push('<table>'); tabla = true; primeraFila = true; }
      if (/^\|[-| ]+\|$/.test(l)) continue;
      const celdas = l.slice(1, -1).split('|').map((x) => x.trim());
      out.push('<tr>' + celdas.map((x) => (primeraFila ? `<th>${inline(x)}</th>` : `<td>${inline(x)}</td>`)).join('') + '</tr>');
      primeraFila = false;
      continue;
    }
    if (/^\s*- /.test(l) || /^\s*\d+\. /.test(l)) {
      if (tabla) cerrar();
      if (!lista) { out.push('<ul>'); lista = true; }
      out.push('<li>' + inline(l.replace(/^\s*(- |\d+\. )/, '')) + '</li>');
      continue;
    }
    cerrar();
    const h = l.match(/^(#{1,3}) (.*)$/);
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (/^> /.test(l)) out.push('<blockquote>' + inline(l.slice(2)) + '</blockquote>');
    else if (l.trim()) out.push('<p>' + inline(l) + '</p>');
  }
  cerrar();
  return out.join('\n');
};
const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Informe de sourcing: ${esc(plan.producto)}</title>
<style>body{font-family:Arial,sans-serif;max-width:1000px;margin:30px auto;padding:0 16px;color:#222;line-height:1.5}
h1{border-bottom:2px solid #333;padding-bottom:6px}h2{margin-top:28px;color:#333}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;vertical-align:top}th{background:#eee}blockquote{background:#f6f6f6;border-left:4px solid #999;margin:12px 0;padding:8px 12px}
code{background:#f0f0f0;padding:1px 4px}a{color:#0645ad;word-break:break-all}</style></head><body>${mdAHtml(mdArchivo)}</body></html>`;

const base = `${CARPETA_INFORMES}\\sourcing_${slug(plan.producto)}_${v.fecha}_${v.modo}`;
// Respuesta corta para el chat: precios, donde conseguirlo y el resumen. El informe completo queda en los archivos.
const C = [];
C.push(`## Precios de ${plan.producto}`);
C.push(`Consulta del ${v.fecha} | Destino: ${destinoTxt}`);
C.push('');
lineasResumen.forEach((t) => C.push(t));
C.push('');
const comparable = esComparable;
for (const [clave, titulo] of GRUPOS_VENTA) {
  const arr = porVenta(clave).filter(comparable);
  if (!arr.length) continue;
  C.push(`**${titulo}** (${arr.length} oferta${arr.length === 1 ? '' : 's'} con precio comparable${arr.length > 8 ? ', las 8 mas baratas' : ''})`);
  tablaOfertas(arr, 8).forEach((t) => C.push(t));
  C.push('');
}
const sinCantidad = ofertasV.filter((o) => !comparable(o)).length;
if (sinCantidad) { C.push(`Hay ${sinCantidad} precio${sinCantidad === 1 ? '' : 's'} mas sin cantidad clara (no se pueden comparar); estan en el informe completo.`); C.push(''); }
if (!ofertasV.length) { C.push('No se encontraron precios publicos verificables. Los precios por volumen se piden por cotizacion.'); C.push(''); }
if (fuentes.length) {
  C.push('**Donde conseguirlo**');
  fuentes.slice(0, 6).forEach((f) => C.push(`- **${f.nombre}**: ${f.mejor}. Contacto: ${contactoDe(f)}. ${f.url}`));
  C.push('');
}
const resumenNarr = narr.split(/\n##\s+Riesgos/)[0].replace(/^##[^\n]*\n/, '').trim();
if (resumenNarr && !v.sin_finalistas) { C.push(resumenNarr); C.push(''); }
(v.riesgos || []).slice(0, 3).forEach((r) => C.push(`- Ojo: ${r}`));
C.push('');
C.push(`Informe completo (fichas, borrador de cotizacion y fuentes): ${base}.html`);
C.push(`Costo de esta consulta: unos ${costo.toFixed(2)} USD en IA.`);
const salidaChat = sinGuiones(C.join('\n')).replace(/\n{3,}/g, '\n\n');
const binHtml = await this.helpers.prepareBinaryData(Buffer.from(html, 'utf8'), 'informe.html', 'text/html');
const binMd = await this.helpers.prepareBinaryData(Buffer.from(mdArchivo, 'utf8'), 'informe.md', 'text/markdown');

return [
  { json: { ruta: `${base}.html`, output: salidaChat, costo_estimado_usd: Math.round(costo * 1000) / 1000, llamadas }, binary: { data: binHtml } },
  { json: { ruta: `${base}.md`, output: salidaChat }, binary: { data: binMd } },
];
