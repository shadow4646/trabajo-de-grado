// Biblioteca comun. El generador la antepone a cada nodo Code (los nodos no pueden importar modulos).
const SEARX = 'http://127.0.0.1:8888/search';
const MODELO = 'claude-haiku-4-5-20251001';
const PRECIO_MTOK = { entrada: 1.0, salida: 5.0 }; // USD por millon de tokens; referencia de terceros, no oficial
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CARPETA_INFORMES = 'C:\\Users\\monca\\.n8n-files\\informes';

const FAMILIAS_ORDEN = ['fabricantes', 'distribuidores', 'precios', 'detal', 'directorios_b2b', 'catalogos_pdf', 'registros_oficiales', 'gremios', 'reputacion'];

// Si el usuario no dice a donde va la compra, se asume el pais del proyecto y se anota como supuesto
const DESTINO_POR_DEFECTO = { pais: 'Colombia', ciudad: 'Bogota' };
const FX_URL = 'https://open.er-api.com/v6/latest/USD'; // gratuita y sin clave; referencia, no oficial
const MONEDA_PAIS = {
  colombia: 'COP', mexico: 'MXN', peru: 'PEN', chile: 'CLP', argentina: 'ARS', ecuador: 'USD', brasil: 'BRL', espana: 'EUR',
  'estados unidos': 'USD', panama: 'USD', uruguay: 'UYU', bolivia: 'BOB', paraguay: 'PYG', 'costa rica': 'CRC', guatemala: 'GTQ',
};
const MONEDA_TLD = { co: 'COP', mx: 'MXN', pe: 'PEN', cl: 'CLP', ar: 'ARS', ec: 'USD', br: 'BRL', es: 'EUR', fr: 'EUR', it: 'EUR', de: 'EUR', ie: 'EUR', pt: 'EUR', us: 'USD', uy: 'UYU', bo: 'BOB', py: 'PYG', cr: 'CRC', gt: 'GTQ', pa: 'USD', uk: 'GBP', au: 'AUD', ca: 'CAD', nz: 'NZD' };

const MODOS = {
  rapida: {
    nombre: 'rapida', max_consultas: 22, por_familia: 4,
    familias: ['fabricantes', 'distribuidores', 'precios', 'detal', 'registros_oficiales'],
    directorios: 0, max_paginas: 20, max_paginas_precio: 12, finalistas: 4, bola_nieve: false,
    saturacion: false, presupuesto_ms: 120000, lote: 2, pausa_ms: 1200,
  },
  profunda: {
    nombre: 'profunda', max_consultas: 95, por_familia: 4,
    familias: FAMILIAS_ORDEN,
    directorios: 8, max_paginas: 55, max_paginas_precio: 30, finalistas: 9, bola_nieve: true,
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
// Es una lista blanca estricta: ante cualquier forma que el parser del cliente HTTP (WHATWG) pudiera leer distinto a
// esta funcion (barra invertida, %, unicode, octal, hexadecimal, usuario@, espacios), la URL se rechaza en vez de
// interpretarla. Devuelve el motivo del veto, o null si es publica y aceptable. El entorno de n8n no permite resolver
// DNS, por eso un nombre publico que apunte a una IP privada no se detecta aqui (ver README, seccion Seguridad).
const IPV4_ESTRICTA = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
function urlInsegura(u) {
  const s = String(u ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 32 || c === 92 || (c >= 127 && c <= 159)) return 'caracteres_no_permitidos';
  }
  const m = s.match(/^https?:\/\/([^\/?#]*)/i);
  if (!m) return 'esquema_o_formato_no_permitido';
  const autoridad = m[1].toLowerCase();
  if (autoridad.includes('@')) return 'credenciales_en_la_url';
  const h = autoridad.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.?(?::(\d{1,5}))?$/);
  if (!h) return 'host_no_permitido';
  const host = h[1];
  if (h[2] !== undefined && ![80, 443, 8080, 8443].includes(Number(h[2]))) return 'puerto_no_permitido';
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(host)) return 'nombre_interno';
  if (!host.includes('.')) return 'nombre_sin_dominio';
  // Si la ultima etiqueta es numerica o hexadecimal, el parser lo trata como direccion IPv4: solo se acepta decimal estricto.
  if (/^(0x[0-9a-f]*|\d+)$/.test(host.split('.').pop())) {
    if (!IPV4_ESTRICTA.test(host)) return 'ip_en_formato_raro';
    const [a, b] = host.split('.').map(Number);
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

// Markdown en linea a HTML, en UNA sola pasada: el texto y las URLs se separan primero y cada pieza se escapa por su
// cuenta. Nunca se aplica una regex sobre HTML ya generado (podria anidar un enlace dentro del atributo href de otro).
// Los textos vienen de paginas ajenas, asi que una URL con comillas, signos < > o espacios no se convierte en enlace.
function inlineHtml(t) {
  const formato = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const urlValida = (u) => /^https?:\/\/[^\s"'<>`\\]+$/i.test(u);
  const texto = String(t ?? '');
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<)]+)/g;
  const partes = [];
  let ultimo = 0;
  let m;
  while ((m = re.exec(texto))) {
    partes.push(formato(esc(texto.slice(ultimo, m.index))));
    const url = m[2] || m[3];
    partes.push(urlValida(url) ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(m[1] || url)}</a>` : esc(m[0]));
    ultimo = re.lastIndex;
  }
  partes.push(formato(esc(texto.slice(ultimo))));
  return partes.join('');
}

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
  if (/\/restaurantes?\/|\/menu\b|\/menus\b/.test(url)) return 'restaurante';
  if (/mercadolibre|amazon\.|olx\.|alibaba|ebay|aliexpress|temu|rappi|exito\.com|carulla|jumbo|olimpica|alkosto|tiendasd1|d1\.com|ara\.com|linio|falabella|homecenter|walmart|carrefour|mercadona|lidl|instacart|supermercado|domicilios\.com|evisos|clasificad|segundamano|milanuncios|locanto|gumtree|craigslist/.test(d)) return 'tienda';
  if (/fabricante|manufacturer|molino|planta de|factory|fabrica |fabricamos|producimos|we manufacture|mill\b|productor/.test(t)) return 'fabricante_probable';
  if (/distribuidor|distributor|mayorista|wholesale|supplier|proveedor|comercializadora|importador|importer|exportador|exporter/.test(t)) return 'distribuidor_probable';
  return 'otro';
}

// Una pagina "habla del producto" si contiene una de sus frases completas, o la mayoria de las palabras de UNA sola frase.
// Cada frase se evalua por separado: mezclar palabras de varios idiomas en una bolsa dejaba fuera paginas validas.
function hablaDelProducto(plan, txtNorm) {
  const frases = [plan.producto, plan.nombre_en, ...(plan.sinonimos || [])].filter(Boolean).map(norm);
  return frases.some((f) => {
    if (txtNorm.includes(f)) return true;
    const ws = f.split(' ').filter((w) => w.length >= 4);
    return ws.length >= 2 && ws.filter((w) => txtNorm.includes(w)).length >= Math.max(1, Math.ceil(ws.length * 0.6));
  });
}

const PESO_TIPO = { restaurante: 0, fabricante_probable: 5, distribuidor_probable: 3.5, pdf: 2.5, gremio: 2, oficial: 2, tienda: 1.5, otro: 1, directorio: 1, noticia: 0.5, academico: 0.2, bloqueado: 0 };

function nombreMarca(titulo, dom) {
  const base = String(dom || '').split('.')[0];
  if (base && base.length >= 5) return base;
  return norm(String(titulo || '').split(/[|\-:,]/)[0]).replace(/[^a-z0-9 ]/g, '').trim();
}

// ---------- prompts ----------
const PROMPT_INTERPRETAR = `Eres un analista de compras senior. Recibes la solicitud de un usuario que necesita comprar un producto o insumo (comida, materia prima, producto terminado, al por mayor o al detal). Tu tarea es interpretarla y preparar el plan de busqueda web.

Responde SOLO con un objeto JSON valido, sin texto antes ni despues y sin bloques de codigo. Usa null cuando un dato no aparezca en la solicitud; nunca inventes cantidades, paises ni requisitos que el usuario no menciono.

Valores por defecto: si la solicitud no indica pais de destino, usa pais_destino "Colombia" y ciudad_destino "Bogota" y anotalo en "supuestos" (por ejemplo "Se asumio destino Colombia (Bogota) porque no se indico otro"). Si no indica si la compra es al por mayor o al detal, usa venta "no_especificado": el sistema buscara precios de las dos formas.

Reglas contra la invencion (muy importantes):
- "requisitos_calidad" contiene SOLO lo que el usuario escribio. Nunca agregues especificaciones tecnicas tipicas del producto (porcentajes, rangos, grados, normas). Si faltan y cambiarian el resultado, formulalos como preguntas en "preguntas_pendientes".
- "supuestos" nunca incluye precios, rangos de precio, tipos de cambio ni cifras de mercado. Solo supuestos sobre entrega, presentacion o uso, en una frase cada uno.
- "certificaciones_requeridas" incluye solo registros o certificaciones obligatorios por norma para ese producto en el pais de destino, con nombre corto (por ejemplo INVIMA para alimentos en Colombia), y los que el usuario pidio. No pongas documentos comerciales (certificado de origen, analisis de laboratorio), eso va en la solicitud de cotizacion.

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
  "detal": [{"q": "...", "idioma": "es"}],
  "registros_oficiales": [{"q": "...", "idioma": "es"}],
  "gremios": [{"q": "...", "idioma": "es"}],
  "reputacion": [{"q": "...", "idioma": "es"}]
 }
}

Reglas para "consultas": de 3 a 4 por familia, cortas y como las escribiria una persona en un buscador. "fabricantes" mezcla espanol, ingles y el idioma de los paises de origen probables, y al menos dos consultas deben nombrar el pais de destino; "distribuidores" busca en el pais o la ciudad de destino y, si la venta es al por mayor, usa palabras como mayorista, por tonelada o por bulto; "precios" busca precios al por mayor (por tonelada, por bulto o por caja), listas de precios, centrales mayoristas, indices o boletines oficiales; "detal" busca donde comprarlo al detal en el pais o la ciudad de destino (supermercados, plazas de mercado, carnicerias o tiendas en linea) con su precio por kilo o por unidad; "registros_oficiales" busca registros sanitarios, listados de empresas autorizadas o normas aplicables; "gremios" busca asociaciones, camaras y listas de afiliados; "reputacion" busca opiniones, reclamos o sanciones de proveedores de ese producto. No uses operadores site: ni filetype:, eso lo agrega el sistema. No uses guiones largos.`;

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
Para "tipo": "fabricante" solo si el texto dice que la empresa produce, procesa o fabrica el producto en sus plantas; "distribuidor" o "comercializador" si dice que compra y revende. La "cita" de "tipo" debe ser la frase que dice eso, no un eslogan ni una descripcion general de la marca. Si no queda claro, usa null.
Para "precio": "condicion" es "detal" si el precio es por unidad de consumo (libra, kilo suelto, paquete, bolsa pequena) o de una tienda en linea; "mayorista" o "lista" solo si el texto lo dice (por bulto, tonelada, volumen, lista para distribuidores). Copia en "cita" el precio tal como aparece.`;

const PROMPT_INFORME = `Eres un analista de compras senior que redacta la parte narrativa de un informe de sourcing previo a una cotizacion (pre-RFQ). Recibes un JSON ya verificado por codigo: la solicitud interpretada, el ranking de proveedores con sus calificaciones ordinales (Alto, Medio, Bajo, No verificable), los datos verificados de cada uno, riesgos detectados, la sensibilidad del ranking y la cobertura de la busqueda.

Reglas estrictas:
- Usa SOLO datos del JSON. No inventes proveedores, precios, certificaciones, contactos, cifras ni URLs. Si algo es "No verificable" o "NO ENCONTRADO", dilo asi.
- No repitas tablas ni listas de datos, el sistema las agrega aparte. Escribe prosa clara para una persona que debe decidir.
- Respeta el orden del ranking recibido; explica por que el principal gana y que tendria que cumplirse para elegir al respaldo.
- No conviertas monedas ni unidades, no calcules precios por tonelada y no cites rangos de precio esperados: usa las cifras tal como vienen en el JSON, con su moneda y unidad. Si el precio es "detal" y la compra es al por mayor, o si "comparable" es false, di que no es comparable y no lo uses para elegir al ganador por precio.
- Las certificaciones son lo que el proveedor declara en su propio sitio. Nunca digas que estan "verificadas" ante la entidad que las emite (INVIMA, ISO u otra): di "declarada en su sitio, pendiente de confirmar con el certificado vigente".
- No califiques la reputacion de nadie. "menciones_en_fuentes_independientes" solo cuenta otras paginas que nombran a la empresa y no mide calidad. "posibles_alertas_por_verificar" son resultados que podrian ser de empresas homonimas: presentalas como algo por verificar, nunca como un hecho.
- Si un proveedor esta fuera del pais de destino o su cobertura es "No verificable", dilo y explica el efecto en logistica y costo sin inventar cifras.
- Este informe es un escaneo de mercado previo a una cotizacion formal (RFQ), no una cotizacion.
- No uses guiones largos (el caracter de raya). Usa comas, puntos, dos puntos o parentesis.
- El JSON trae "precios_encontrados": el rango de precios por kilo (al detal y al por mayor, en la moneda del destino), y cada proveedor del ranking puede traer "mejor_precio_comparable". Usa esas cifras tal cual vienen y atribuyelas SOLO al proveedor donde aparecen: nunca calcules, redondees, mezcles ni inventes un precio. Si no hay precios al por mayor publicos, dilo y explica que se obtienen por cotizacion.
- No afirmes que un proveedor es mas barato o mas caro que otro salvo comparando sus "mejor_precio_comparable"; un proveedor sin ese dato no se puede comparar por precio.
- El informe ya incluye el cuadro de precios y las fichas, asi que se breve: no repitas tablas ni listas de datos.
- Escribe en espanol, en Markdown, con exactamente estas dos secciones:

## Resumen ejecutivo y recomendacion
(maximo 120 palabras: donde conviene comprar al detal y al por mayor segun los precios encontrados, que proveedor es el principal y cual el respaldo, y que validar antes de comprar)

## Riesgos y plan B
(maximo 120 palabras: riesgos reales detectados y que hacer si el principal falla)`;

const PROMPT_PRECIOS = `Extraes ofertas de precio de un producto desde fragmentos de texto de una pagina web. Recibes el producto buscado, la moneda probable del sitio y los fragmentos (lineas con precios y su contexto). Responde SOLO con un objeto JSON valido, sin texto adicional.

Reglas:
- Incluye solo ofertas del producto buscado o de una variante directa (otro corte, marca o presentacion del mismo producto) para comprar y cocinar en casa o en un negocio. Ignora platos de restaurante, comida preparada o menus (por ejemplo "acompanado de papas"), otros productos, costos de envio, impuestos, membresias y descuentos sin precio final.
- Las primeras lineas de los fragmentos son el titulo y el encabezado de la pagina: sirven para saber la presentacion (por ejemplo "bloque de 2.500 gramos") de los precios que aparecen despues.
- No calcules, no conviertas monedas ni unidades y no deduzcas. Copia los numeros como aparecen.
- Cada oferta lleva "cita": fragmento COPIADO TEXTUALMENTE de los fragmentos (maximo 200 caracteres) que contiene el precio. Una oferta sin cita textual sera descartada.
- "cantidad" y "unidad" describen lo que se compra por ese precio, solo si el texto lo dice (por ejemplo 500 g, 1 kg, bulto de 50 kg, libra). Si el precio es "por kilo", "por libra" o "por tonelada", cantidad es 1 y la unidad es esa. Si el texto no dice cuanto trae, usa null en cantidad y unidad.
- "unidades" es cuantas piezas trae la presentacion cuando el texto lo dice (2 steaks de 360 g cada uno: unidades 2, cantidad 360, unidad g); si no, 1.
- "moneda" es el codigo ISO (COP, MXN, USD, EUR, BRL, etc.). Si el texto solo muestra "$", usa la moneda probable del sitio; si no hay ninguna pista, usa null.
- "condicion": "mayorista" solo si el texto habla de mayoreo, bulto, tonelada, volumen o distribuidores; "detal" si es precio de tienda al consumidor; si no queda claro, "no_indica".

Esquema:
{"ofertas":[{"descripcion":"producto tal como lo nombra la pagina","unidades":1,"cantidad":500,"unidad":"g | kg | lb | oz | ton | l | ml | unidad | otro","presentacion":"texto corto de la presentacion","precio":0,"moneda":"COP","condicion":"detal | mayorista | no_indica","cita":"..."}]}

Maximo 8 ofertas por pagina. Si no hay ninguna oferta del producto, responde {"ofertas":[]}.`;

// Moneda probable de una pagina: primero el dominio (.co, .mx...) y, si no alcanza, las pistas del texto (ciudades, paises, codigos)
const PISTAS_MONEDA = [
  ['COP', /\bcop\b|colombia|bogota|medellin|barranquilla|cartagena|pesos colombianos/g],
  ['MXN', /\bmxn\b|mexico|cdmx|monterrey|guadalajara|pesos mexicanos/g],
  ['ARS', /\bars\b|argentina|buenos aires|pesos argentinos/g],
  ['CLP', /\bclp\b|chile|santiago de chile|pesos chilenos/g],
  ['PEN', /\bpen\b|peru\b|soles/g],
  ['BRL', /\bbrl\b|brasil|brazil|r\$/g],
  ['EUR', /\beur\b|espana|spain|iva incluido/g],
  ['USD', /\busd\b|us\$|dolares|dollars/g],
];
function monedaProbable(texto, dom) {
  const porDominio = MONEDA_TLD[String(dom || '').split('.').pop()];
  if (porDominio) return porDominio;
  const t = norm(texto);
  const cuentas = PISTAS_MONEDA.map(([m, re]) => [m, (t.match(re) || []).length]).sort((a, b) => b[1] - a[1]);
  return cuentas[0][1] >= 2 && cuentas[0][1] > cuentas[1][1] ? cuentas[0][0] : null;
}

// Lineas de una pagina que traen un precio, con la linea anterior y la siguiente como contexto
function ventanasDePrecio(texto, max) {
  const lineas = String(texto ?? '').split('\n');
  const reMoneda = /(\$|us\$|r\$|€|£|usd|cop|mxn|brl|eur|ars|clp|pen|gbp|pesos?)\s?\d|\d[\d.,]*\s?(\$|€|usd|cop|mxn|brl|eur|pesos?)/i;
  const idx = new Set();
  let n = 0;
  lineas.forEach((l, i) => { if (l.length < 400 && reMoneda.test(l)) { n++; idx.add(i - 1); idx.add(i); idx.add(i + 1); } });
  const out = [];
  let largo = 0;
  [...idx].filter((i) => i >= 0 && i < lineas.length).sort((a, b) => a - b).forEach((i) => {
    const t = lineas[i].slice(0, 220);
    if (largo + t.length + 1 <= (max || 2200)) { out.push(t); largo += t.length + 1; }
  });
  return { texto: out.join('\n'), n_precios: n };
}
