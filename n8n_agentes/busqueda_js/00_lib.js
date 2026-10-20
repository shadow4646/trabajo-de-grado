// Biblioteca comun. El generador la antepone a cada nodo Code (los nodos no pueden importar modulos).
const SEARX = 'http://127.0.0.1:8888/search';
const MODELO = 'claude-haiku-4-5-20251001';
const PRECIO_MTOK = { entrada: 1.0, salida: 5.0 }; // USD por millon de tokens; referencia de terceros, no oficial
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CARPETA_INFORMES = 'C:\\Users\\monca\\.n8n-files\\informes';

const FAMILIAS_ORDEN = ['fabricantes', 'distribuidores', 'precios', 'directorios_b2b', 'catalogos_pdf', 'registros_oficiales', 'gremios', 'reputacion'];

const MODOS = {
  rapida: {
    nombre: 'rapida', max_consultas: 22, por_familia: 4,
    familias: ['fabricantes', 'distribuidores', 'precios', 'registros_oficiales'],
    directorios: 0, max_paginas: 14, finalistas: 4, bola_nieve: false,
    saturacion: false, presupuesto_ms: 120000, lote: 2, pausa_ms: 1200,
  },
  profunda: {
    nombre: 'profunda', max_consultas: 95, por_familia: 4,
    familias: FAMILIAS_ORDEN,
    directorios: 8, max_paginas: 55, finalistas: 9, bola_nieve: true,
    saturacion: true, presupuesto_ms: 220000, lote: 2, pausa_ms: 1500,
  },
};

const DIRECTORIOS_B2B = ['alibaba.com', 'made-in-china.com', 'indiamart.com', 'europages.com', 'quiminet.com', 'kompass.com', 'thomasnet.com', 'globalsources.com'];

const TLD_PAIS = {
  colombia: 'co', mexico: 'mx', peru: 'pe', chile: 'cl', argentina: 'ar', ecuador: 'ec', brasil: 'br', espana: 'es',
  'estados unidos': 'us', venezuela: 've', panama: 'pa', 'costa rica': 'cr', uruguay: 'uy', bolivia: 'bo', paraguay: 'py',
};

const BLOQUEADOS = ['wikipedia.org', 'scribd.com', 'youtube.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'pinterest.com', 'reddit.com', 'slideshare.net', 'academia.edu', 'researchgate.net', 'google.com', 'tiktok.com', 'quora.com'];

const CERTS_CODIGO = [
  ['ISO 9001', /iso\s*9001/i], ['ISO 22000', /iso\s*22000/i], ['FSSC 22000', /fssc\s*22000/i], ['HACCP', /haccp/i],
  ['BPM', /\bbpm\b|buenas pr[aá]cticas de manufactura/i], ['GMP', /\bgmp\b/i], ['INVIMA', /invima/i], ['FDA', /\bfda\b/i],
  ['Halal', /halal/i], ['Kosher', /kosher/i], ['Organico', /org[aá]nic[oa]|organic/i], ['ISO 14001', /iso\s*14001/i], ['BRC', /\bbrc\b/i],
];

// ---------- utilidades ----------
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// OJO: el entorno aislado de los nodos Code de n8n no trae la clase URL; por eso todo se hace con texto.
const dominio = (u) => {
  const m = String(u || '').match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@\/?#]*@)?([^\/?#:]+)/i);
  return m ? m[1].replace(/^www\./i, '').toLowerCase() : '';
};
const resolverUrl = (href, base) => {
  const h = String(href || '').trim();
  if (!h || /^(mailto|tel|javascript|data):/i.test(h)) return null;
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith('//')) return 'https:' + h;
  const m = String(base || '').match(/^(https?:\/\/[^\/?#]+)(\/[^?#]*)?/i);
  if (!m) return null;
  if (h.startsWith('/')) return m[1] + h;
  return m[1] + (m[2] || '/').replace(/[^\/]*$/, '') + h;
};
const conOSinWww = (url) => String(url).replace(/^(https?:\/\/)(www\.)?/i, (m, a, w) => a + (w ? '' : 'www.'));
// Defensa contra SSRF: las URLs que se descargan salen de buscadores y de paginas ajenas, asi que no son de fiar.
// Devuelve el motivo del veto, o null si la URL es publica y aceptable. El entorno de n8n no permite resolver DNS,
// por eso un nombre publico que apunte a una IP privada no se detecta aqui (ver README, seccion Seguridad).
function urlInsegura(u) {
  const m = String(u || '').match(/^(https?):\/\/(?:[^@\/?#]*@)?([^\/?#:]+|\[[^\]]*\])(?::(\d+))?(?:[\/?#]|$)/i);
  if (!m) return 'esquema_o_formato_no_permitido';
  const host = m[2].toLowerCase().replace(/\.$/, '');
  const puerto = m[3] ? Number(m[3]) : null;
  if (puerto !== null && ![80, 443, 8080, 8443].includes(puerto)) return 'puerto_no_permitido';
  if (host.startsWith('[')) return 'ip_literal_ipv6';
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(host)) return 'nombre_interno';
  if (!host.includes('.')) return 'nombre_sin_dominio';
  if (/^0x/i.test(host) || /^[\d.]+$/.test(host)) {
    const p = host.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return 'ip_en_formato_raro';
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return 'ip_privada_o_reservada';
  }
  return null;
}
const sleep = (ms) => (typeof setTimeout === 'function' ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const trozos = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const sinGuiones = (t) => String(t ?? '').replace(/\s*[\u2014\u2013]\s*/g, ', ');
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (t) => norm(t).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'producto';

function extraerJson(texto) {
  const t = String(texto ?? '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}

function htmlATexto(html) {
  let t = String(html ?? '');
  t = t.replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  t = t.replace(/&#(\d+);/g, (m, n) => { try { return String.fromCharCode(Number(n)); } catch (e) { return ' '; } });
  return t.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter((l) => l.length > 0).join('\n');
}

function enlacesDe(html, base) {
  const out = [];
  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html ?? ''))) && out.length < 400) {
    const abs = resolverUrl(m[1], base);
    if (abs) out.push({ url: abs, texto: htmlATexto(m[2]).slice(0, 80) });
  }
  return out;
}

async function buscarSearx(ctx, c) {
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await ctx.helpers.httpRequest({
        method: 'GET', url: SEARX, qs: { q: c.q, format: 'json', language: c.idioma || 'es' }, json: true, timeout: 25000,
      });
      const caidos = (Array.isArray(r?.unresponsive_engines) ? r.unresponsive_engines : []).map((x) => ({ motor: String(x[0]), motivo: String(x[1] || '').slice(0, 40) }));
      return { ok: true, resultados: Array.isArray(r?.results) ? r.results : [], motores_caidos: caidos };
    } catch (e) {
      if (intento === 1) return { ok: false, resultados: [], motores_caidos: [], error: String(e.message || e).slice(0, 120) };
      await sleep(800);
    }
  }
  return { ok: false, resultados: [], motores_caidos: [] };
}

// Suma, por buscador, cuantos resultados aporto y en cuantas consultas fallo (para declararlo en el informe)
function contarMotores(acum, respuesta) {
  for (const r of respuesta.resultados) for (const g of (r.engines || [])) acum[g] = acum[g] || { resultados: 0, fallos: 0, motivos: [] }, acum[g].resultados++;
  for (const x of respuesta.motores_caidos || []) {
    const e = acum[x.motor] = acum[x.motor] || { resultados: 0, fallos: 0, motivos: [] };
    e.fallos++;
    if (x.motivo && !e.motivos.includes(x.motivo)) e.motivos.push(x.motivo);
  }
}

function clasificarResultado(r) {
  const d = dominio(r.url);
  const t = norm(`${r.titulo || r.title || ''} ${r.contenido || r.content || ''}`);
  const url = String(r.url || '').toLowerCase();
  if (BLOQUEADOS.some((b) => d === b || d.endsWith('.' + b))) return 'bloqueado';
  if (/\.pdf($|\?)/.test(url)) return 'pdf';
  if (DIRECTORIOS_B2B.some((b) => d === b || d.endsWith('.' + b)) || /\/(directory|suppliers|companies|proveedores|empresas)\//.test(url)) return 'directorio';
  if (/\.(gov|gob|gub)(\.|$)|invima|rues\.|minsalud|ica\.gov|dian\.gov/.test(d)) return 'oficial';
  if (/\.edu(\.|$)|repositorio|universidad|university/.test(d)) return 'academico';
  if (/asociacion|federacion|gremio|association|federation|camara de comercio|chamber/.test(t) && !/fabricamos|we manufacture/.test(t)) return 'gremio';
  if (/noticias|news|blog|periodico|diario|revista|magazine/.test(d + url)) return 'noticia';
  if (/market (research|report|size|analysis|insights)|cagr|informe de mercado|estudio de mercado|forecast to 20/.test(t)) return 'noticia';
  if (/mercadolibre|amazon\.|olx\.|alibaba|ebay|aliexpress|temu/.test(d)) return 'tienda';
  if (/fabricante|manufacturer|molino|planta de|factory|fabrica |fabricamos|producimos|we manufacture|mill\b|productor/.test(t)) return 'fabricante_probable';
  if (/distribuidor|distributor|mayorista|wholesale|supplier|proveedor|comercializadora|importador|importer|exportador|exporter/.test(t)) return 'distribuidor_probable';
  return 'otro';
}

const PESO_TIPO = { fabricante_probable: 5, distribuidor_probable: 3.5, pdf: 2.5, gremio: 2, oficial: 2, tienda: 1.5, otro: 1, directorio: 1, noticia: 0.5, academico: 0.2, bloqueado: 0 };

function nombreMarca(titulo, dom) {
  const base = String(dom || '').split('.')[0];
  if (base && base.length >= 5) return base;
  return norm(String(titulo || '').split(/[|\-:,]/)[0]).replace(/[^a-z0-9 ]/g, '').trim();
}

// ---------- prompts ----------
const PROMPT_INTERPRETAR = `Eres un analista de compras senior. Recibes la solicitud de un usuario que necesita comprar un producto o insumo (comida, materia prima, producto terminado, al por mayor o al detal). Tu tarea es interpretarla y preparar el plan de busqueda web.

Responde SOLO con un objeto JSON valido, sin texto antes ni despues y sin bloques de codigo. Usa null cuando un dato no aparezca en la solicitud; nunca inventes cantidades, paises ni requisitos que el usuario no menciono. Las certificaciones o registros obligatorios por norma del pais de destino si puedes proponerlos, anotandolo en "supuestos".

Esquema:
{
 "producto": "nombre normalizado en espanol, o null si la solicitud no menciona ningun producto",
 "nombre_en": "nombre tecnico en ingles",
 "sinonimos": ["variantes y nombres comerciales, hasta 5"],
 "especificacion": "caracteristicas pedidas (grado, pureza, presentacion, marca, etc.) o null",
 "categoria": "perecedero | materia_prima_industrial | producto_terminado_detal | otro",
 "cantidad_pedido": "texto o null",
 "cantidad_anual": "texto o null",
 "pais_destino": "pais o null",
 "ciudad_destino": "ciudad o null",
 "venta": "mayor | detal | no_especificado",
 "requisitos_calidad": ["..."],
 "certificaciones_requeridas": ["certificaciones o registros obligatorios para ese producto en el pais de destino, por ejemplo INVIMA para alimentos en Colombia; lista vacia si no aplica o no lo sabes"],
 "paises_origen_probables": ["paises donde suele fabricarse"],
 "kraljic_provisional": {"cuadrante": "apalancable | estrategico | cuello_de_botella | no_critico", "razon": "una frase"},
 "supuestos": ["cada supuesto o valor por defecto que asumes, en una frase"],
 "preguntas_pendientes": ["datos que faltan y cambiarian el resultado"],
 "consultas": {
  "fabricantes": [{"q": "consulta de busqueda web", "idioma": "es"}],
  "distribuidores": [{"q": "...", "idioma": "es"}],
  "precios": [{"q": "...", "idioma": "es"}],
  "registros_oficiales": [{"q": "...", "idioma": "es"}],
  "gremios": [{"q": "...", "idioma": "es"}],
  "reputacion": [{"q": "...", "idioma": "es"}]
 }
}

Reglas para "consultas": de 3 a 4 por familia, cortas y como las escribiria una persona en un buscador. "fabricantes" mezcla espanol, ingles y el idioma de los paises de origen probables; "distribuidores" busca en el pais de destino; "precios" busca precios de referencia, listas, indices o boletines oficiales; "registros_oficiales" busca registros sanitarios, listados de empresas autorizadas o normas aplicables; "gremios" busca asociaciones, camaras y listas de afiliados; "reputacion" busca opiniones, reclamos o sanciones de proveedores de ese producto. No uses operadores site: ni filetype:, eso lo agrega el sistema. No uses guiones largos.`;

const PROMPT_EXTRAER = `Extraes datos de proveedores desde el texto de una pagina web. Recibes la especificacion que busca el comprador y el texto de la pagina. Responde SOLO con un objeto JSON valido, sin texto adicional.

Regla central: cada dato debe ir acompanado de "cita", un fragmento COPIADO TEXTUALMENTE del texto recibido (maximo 220 caracteres, sin cambiar ni una letra) que lo respalda. Si el dato no aparece de forma explicita en el texto, usa null para todo el campo. No deduzcas, no completes y no uses conocimiento externo. Un campo sin cita textual sera descartado.

Esquema (cada campo es null o un objeto con "valor" y "cita"):
{
 "empresa": {"valor": "razon social o nombre comercial", "cita": "..."},
 "tipo": {"valor": "fabricante | distribuidor | comercializador | directorio | otro", "cita": "...", "senales": ["..."]},
 "ofrece_producto": {"valor": true, "cita": "..."},
 "productos": {"valor": ["productos relevantes a la especificacion"], "cita": "..."},
 "pais": {"valor": "...", "cita": "..."},
 "ciudad": {"valor": "...", "cita": "..."},
 "direccion": {"valor": "...", "cita": "..."},
 "certificaciones": [{"valor": "ISO 9001", "cita": "..."}],
 "precio": {"valor": 0, "moneda": "USD", "unidad": "kg", "condicion": "lista | mayorista | detal | no_indica", "cita": "..."},
 "moq": {"valor": "...", "cita": "..."},
 "incoterm": {"valor": "...", "cita": "..."},
 "plazo_entrega": {"valor": "...", "cita": "..."},
 "anios_operacion": {"valor": "...", "cita": "..."},
 "capacidad": {"valor": "...", "cita": "..."},
 "envio_internacional": {"valor": true, "cita": "..."}
}
Para "tipo": "fabricante" solo si el texto dice que la empresa produce, procesa o fabrica el producto en sus plantas; "distribuidor" o "comercializador" si dice que compra y revende. Si no queda claro, usa null.`;

const PROMPT_INFORME = `Eres un analista de compras senior que redacta la parte narrativa de un informe de sourcing previo a una cotizacion (pre-RFQ). Recibes un JSON ya verificado por codigo: la solicitud interpretada, el ranking de proveedores con sus calificaciones ordinales (Alto, Medio, Bajo, No verificable), los datos verificados de cada uno, riesgos detectados, la sensibilidad del ranking y la cobertura de la busqueda.

Reglas estrictas:
- Usa SOLO datos del JSON. No inventes proveedores, precios, certificaciones, contactos, cifras ni URLs. Si algo es "No verificable" o "NO ENCONTRADO", dilo asi.
- No repitas tablas ni listas de datos, el sistema las agrega aparte. Escribe prosa clara para una persona que debe decidir.
- Respeta el orden del ranking recibido; explica por que el principal gana y que tendria que cumplirse para elegir al respaldo.
- Este informe es un escaneo de mercado previo a una cotizacion formal (RFQ), no una cotizacion.
- No uses guiones largos (el caracter de raya). Usa comas, puntos, dos puntos o parentesis.
- Escribe en espanol, en Markdown, con exactamente estas secciones:

## Resumen ejecutivo y recomendacion
(maximo 180 palabras: proveedor principal, respaldo, y que validar antes de comprar)

## Lectura de cada proveedor
(un parrafo breve por proveedor, con su nombre en negrita: que ofrece y por que sube o baja en el ranking)

## Riesgos y plan B
(riesgos reales detectados y que hacer si el principal falla)

## Sensibilidad
(una o dos frases: que proveedor gana si se prioriza precio y cual si se prioriza riesgo y continuidad)`;
