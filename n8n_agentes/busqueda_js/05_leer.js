// Nodo "Leer paginas": descarga las paginas elegidas (gratis, por codigo), extrae senales y escoge a los finalistas.
const p = $input.first().json;
const cfg = p.cfg;
const plan = p.plan;
const t0 = Date.now();

const descargar = async (url) => {
  let r = await descargarUna(url);
  // Las primeras resoluciones DNS suelen fallar y luego funcionan: se reintenta con una pequena espera
  for (let intento = 0; r.status === 0 && intento < 2; intento++) {
    await sleep(700);
    r = await descargarUna(url);
  }
  if (r.status === 0 && /ENOTFOUND/i.test(r.error || '')) {
    // Muchos sitios solo responden con o sin "www.": se prueba la variante contraria
    const r2 = await descargarUna(conOSinWww(url));
    if (r2.status !== 0) return r2;
  }
  return r;
};

// Las redirecciones se siguen a mano (maximo 4) para validar cada destino: un sitio externo no debe poder
// redirigirnos hacia localhost o la red interna.
const descargarUna = async (url) => {
  let actual = url;
  for (let salto = 0; salto <= 4; salto++) {
    const veto = urlInsegura(actual);
    if (veto) return { status: 0, html: '', error: 'url_bloqueada: ' + veto };
    try {
      const r = await this.helpers.httpRequest({
        method: 'GET', url: actual, json: false, timeout: 15000, returnFullResponse: true, ignoreHttpStatusErrors: true, disableFollowRedirect: true,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es,en;q=0.8' },
      });
      const destino = r.headers?.location;
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && destino) {
        actual = resolverUrl(String(destino), actual);
        if (!actual) return { status: 0, html: '', error: 'redireccion_invalida' };
        continue;
      }
      let body = r.body;
      if (body && typeof body !== 'string') body = (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) ? body.toString('utf8') : JSON.stringify(body);
      return { status: r.statusCode, html: String(body ?? '').slice(0, 600000), tipo_contenido: String(r.headers?.['content-type'] ?? '') };
    } catch (e) {
      return { status: 0, html: '', error: String(e.message || e).slice(0, 100) };
    }
  }
  return { status: 0, html: '', error: 'demasiadas_redirecciones' };
};

const senales = (texto) => {
  const emails = [...new Set((texto.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) || [])
    .map((e) => e.toLowerCase())
    .filter((e) => !/\.(png|jpe?g|gif|svg|webp)$/.test(e) && !/(sentry|wixpress|example\.com|domain\.com|yourdomain)/.test(e)))].slice(0, 5);
  const telefonos = [...new Set((texto.match(/(?:\+[ \t]?\d{1,3}[ \t.-]?)?(?:\(\d{1,4}\)[ \t.-]?)?\d{2,4}[ \t.-]\d{3,4}[ \t.-]?\d{3,4}/g) || [])
    .map((t) => t.trim())
    .filter((t) => { const n = t.replace(/\D/g, '').length; return n >= 7 && n <= 13; }))].slice(0, 4);
  const certs = CERTS_CODIGO.filter(([, re]) => re.test(texto)).map(([n]) => n);
  return { emails, telefonos, certs };
};

const estadoDe = (r, texto) => {
  if (r.status === 0 && /^url_bloqueada/.test(r.error || '')) return 'bloqueada_por_seguridad';
  if (r.status === 0) return 'error_de_red';
  if ([401, 403, 429].includes(r.status)) return 'bloqueada_por_el_sitio';
  if (r.status >= 400) return 'error_http_' + r.status;
  if (!/html|text|xml/i.test(r.tipo_contenido || 'html')) return 'no_es_html';
  if (texto.length < 400) return 'vacia_o_requiere_javascript';
  return 'ok';
};

// Fase A: leer en paralelo las paginas elegidas
const paginas = [];
for (const lote of trozos(p.a_leer, 6)) {
  if (Date.now() - t0 > cfg.presupuesto_ms) break;
  const res = await Promise.all(lote.map((c) => descargar(c.url)));
  res.forEach((r, i) => {
    const c = lote[i];
    const texto = htmlATexto(r.html);
    const vp = ventanasDePrecio(texto, 2000);
    // El titulo y las primeras lineas (encabezado) suelen decir la presentacion: "bloque de 2.500 gramos", "x 500 g"
    const cabecera = [...new Set([c.titulo, ...texto.split('\n').slice(0, 3)].filter(Boolean).map((l) => String(l).slice(0, 200)))];
    paginas.push({
      dominio: c.dominio, url: c.url, titulo: c.titulo, tipo: c.tipo, puntaje: c.puntaje, familias: c.familias,
      moneda_probable: vp.n_precios ? monedaProbable(texto, c.dominio) : null,
      habla_producto: hablaDelProducto(plan, norm(texto)), ventanas: vp.n_precios ? `${cabecera.join('\n')}\n${vp.texto}` : '', n_precios: vp.n_precios,
      estado: estadoDe(r, texto), status: r.status, motivo: r.error || null, largo: texto.length, texto, ...senales(texto),
      enlaces_contacto: r.html ? enlacesDe(r.html, c.url).filter((l) => dominio(l.url) === c.dominio && /contact|contacto|nosotros|about|quienes|acerca|empresa|perfil/i.test(norm(l.url + ' ' + l.texto))).map((l) => l.url).slice(0, 2) : [],
    });
  });
}

// Finalistas: paginas leidas con exito que hablan del producto y cuyo tipo sirve para comprar
const habla = (txt) => hablaDelProducto(plan, txt);
// En una compra al por mayor, las tiendas y los supermercados en linea no son proveedores
const TIPOS_FINALISTA = ['fabricante_probable', 'distribuidor_probable', 'otro', ...(plan.venta === 'mayor' ? [] : ['tienda'])];
const destPais = norm(plan.pais_destino || '');
const destCiudad = norm(plan.ciudad_destino || '');
const nombraDestino = (txt) => (destPais.length >= 4 && txt.includes(destPais)) || (destCiudad.length >= 4 && txt.includes(destCiudad));

const finalistas = paginas
  .filter((g) => g.estado === 'ok' && TIPOS_FINALISTA.includes(g.tipo) && habla(norm(g.texto)))
  .map((g) => ({ ...g, rank: g.puntaje + (g.emails.length ? 1 : 0) + (g.telefonos.length ? 0.5 : 0) + (g.certs.length ? 0.5 : 0) + (nombraDestino(norm(g.texto)) ? 2 : 0) }))
  .sort((a, b) => b.rank - a.rank)
  .slice(0, cfg.finalistas);

// Fase B: para cada finalista, leer una pagina de contacto o "acerca de" y sumarla al texto
for (const lote of trozos(finalistas, 5)) {
  const res = await Promise.all(lote.map((g) => (g.enlaces_contacto.length ? descargar(g.enlaces_contacto[0]) : Promise.resolve(null))));
  res.forEach((r, i) => {
    if (!r || !r.html) return;
    const extra = htmlATexto(r.html);
    if (extra.length < 100) return;
    const g = lote[i];
    g.texto = `${g.texto}\n[PAGINA DE CONTACTO O ACERCA DE]\n${extra}`;
    g.largo = g.texto.length;
    const s = senales(extra);
    g.emails = [...new Set([...g.emails, ...s.emails])].slice(0, 5);
    g.telefonos = [...new Set([...g.telefonos, ...s.telefonos])].slice(0, 4);
    g.certs = [...new Set([...g.certs, ...s.certs])];
    g.leyo_contacto = true;
  });
}

const cuenta = (f) => paginas.filter(f).length;
const estadisticas = {
  intentadas: paginas.length,
  ok: cuenta((g) => g.estado === 'ok'),
  bloqueadas: cuenta((g) => g.estado === 'bloqueada_por_el_sitio'),
  bloqueadas_seguridad: cuenta((g) => g.estado === 'bloqueada_por_seguridad'),
  vacias_js: cuenta((g) => g.estado === 'vacia_o_requiere_javascript'),
  errores: cuenta((g) => g.estado.startsWith('error')),
  otras: cuenta((g) => g.estado === 'no_es_html'),
  con_precios: cuenta((g) => g.estado === 'ok' && g.habla_producto && g.n_precios > 0),
  paginas_extra_contacto: finalistas.filter((g) => g.leyo_contacto).length,
  ms: Date.now() - t0,
};

// Para no arrastrar texto completo de paginas que no son finalistas
const resumenPaginas = paginas.map(({ texto, ...resto }) => resto);

return [{ json: { ...p, paginas: resumenPaginas, finalistas, estadisticas_lectura: estadisticas } }];
