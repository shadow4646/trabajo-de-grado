// Pruebas del filtro anti-SSRF (urlInsegura). Uso: node test_seguridad.js
const fs = require('fs');
const path = require('path');
const lib = fs.readFileSync(path.join(__dirname, '00_lib.js'), 'utf8');
const urlInsegura = new Function(lib + '\nreturn urlInsegura;')();

const debeBloquear = [
  'http://127.0.0.1:5678/rest/workflows', 'http://localhost:8888/search?q=x', 'http://0.0.0.0/', 'http://10.1.2.3/', 'http://172.16.0.5/',
  'http://172.31.255.255/', 'http://192.168.1.1/admin', 'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://[::1]/',
  'http://[fe80::1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://impresora.local/', 'http://servidor.internal/', 'http://intranet/',
  'file:///C:/Windows/win.ini', 'ftp://ejemplo.com/', 'gopher://ejemplo.com/', 'http://ejemplo.com:5678/', 'http://ejemplo.com:22/',
  'http://usuario:clave@127.0.0.1/', 'http://999.1.1.1/', 'javascript:alert(1)', '',
  // Diferenciales entre una regex propia y el parser WHATWG del cliente HTTP
  'http://127.0.0.1\\@publico.com/', 'http://publico.com\\@127.0.0.1/', 'http://0177.0.0.1/', 'http://0300.0250.0.1/', 'http://127.1/',
  'http://0x7f000001/', 'http://017700000001/', 'http://%31%32%37.0.0.1/', 'http://127.0.0.1%2e/', 'http://１２７.０.０.１/',
  'http://127.0.0.1\t.publico.com/', 'http://127.0.0.1 /', 'http://127.0.0.1\n/', 'http://usuario@ejemplo.com/', 'http://01.02.03.04/',
  'http://[::ffff:127.0.0.1]/', 'http://ejemplo.com:/', 'http://ejemplo.com:99999999/', 'http://127.0.0.1./', 'http://LOCALHOST/',
];
const debePermitir = [
  'https://www.molinoellobo.com.co/contacto', 'http://harineraelmolino.com/', 'https://ejemplo.com:443/a?b=c', 'http://ejemplo.com:8080/x',
  'https://sub.dominio.co/ruta#ancla', 'https://172.15.0.1.nip.example.com/', 'https://8.8.8.8/', 'https://172.32.0.1/',
  'https://www.dominio.co/ruta/ñandú?x=á', 'http://sitio.com.co/', 'https://xn--maana-pta.com/', 'https://www.molino-el-lobo.com.co./', 'https://ejemplo.com/a%5Cb',
];

const lib2 = new Function(lib + '\nreturn { inlineHtml };')();
let fallos = 0;
for (const u of debeBloquear) if (!urlInsegura(u)) { console.log('FALLA (debia bloquear):', u); fallos++; }
for (const u of debePermitir) if (urlInsegura(u)) { console.log('FALLA (debia permitir):', u, '->', urlInsegura(u)); fallos++; }
console.log(`${debeBloquear.length} bloqueos y ${debePermitir.length} permitidos probados, fallos: ${fallos}`);

// Prueba diferencial: todo lo que el filtro deja pasar se interpreta con el parser WHATWG real (el de Node) y el host
// resultante no puede ser privado, de bucle local ni reservado. Se generan miles de variantes hostiles de 127.0.0.1,
// 10.0.0.1, 192.168.1.1 y 169.254.169.254 (formas decimal, octal, hexadecimal, con %, \, @, espacios, unicode y puntos).
const privado = (h) => {
  const m = String(h).match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (/^\[/.test(h) || h === 'localhost' || /\.(localhost|local|internal)$/.test(h)) return true;
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
};
const bases = ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '127.1', '2130706433', '0x7f.0.0.1', '0177.0.0.1', '0x7f000001', '017700000001', 'localhost', '[::1]', '[::ffff:7f00:1]', '１２７.０.０.１'];
const raros = ['', '\\', '\\@', '@', '%2e', '%2E', '.', ' ', '\t', '\n', '\r', '%00', '%31', ':80', ':', ':0', '#', '?', '/', '//', '%5c', '。', '．', ' '];
let probadas = 0, dejadasPasar = 0, peligrosas = 0;
for (const esq of ['http://', 'https://', 'http:\\\\', 'http:/', 'http:///', 'HTTP://']) {
  for (const b of bases) {
    for (const r1 of raros) {
      for (const r2 of raros) {
        for (const u of [esq + b + r1 + r2, esq + 'publico.com' + r1 + b + r2, esq + b + r1 + 'publico.com' + r2, esq + r1 + b]) {
          probadas++;
          if (urlInsegura(u) !== null) continue;
          dejadasPasar++;
          let host = null;
          try { host = new URL(u).hostname; } catch (e) { continue; }
          if (privado(host)) { peligrosas++; if (peligrosas <= 10) console.log('PELIGROSA (el filtro la dejo pasar y WHATWG la lee como interna):', JSON.stringify(u), '->', host); }
        }
      }
    }
  }
}
console.log(`diferencial: ${probadas} variantes, ${dejadasPasar} dejadas pasar, ${peligrosas} peligrosas`);
fallos += peligrosas;
// (la salida se decide al final del archivo)

// ---- inlineHtml: el HTML del informe se arma con texto de paginas ajenas ----
const hostiles = [
  '[x](https://a.com/https://evil.com/)', 'https://a.com/https://evil.com/x', '[x](https://a.com/"onmouseover="alert(1))',
  'https://a.com/"onmouseover="alert(1)', "[x](https://a.com/'><script>alert(1)</script>)", '<img src=x onerror=alert(1)>',
  '[a](javascript:alert(1))', '[a](https://a.com/x) y [b](https://b.com/y?z=https://c.com)', '**<b>negrita</b>** `<i>`',
  '[<script>alert(1)</script>](https://a.com/)', 'https://a.com/x<script>alert(1)</script>', '[x](https://a.com/\\" onclick=alert(1))',
  '[x](data:text/html,<script>alert(1)</script>)', '"><svg onload=alert(1)>', 'https://a.com/?a=1&b=2&c="3"',
];
let htmlFallos = 0;
for (const h of hostiles) {
  const out = lib2.inlineHtml(h);
  // Se quitan las etiquetas permitidas; lo que quede no puede contener ni < ni >
  const sinPermitidas = out
    .replace(/<a href="[^"<>]*" rel="noopener noreferrer">/g, '').replace(/<\/a>|<\/?strong>|<\/?code>/g, '');
  const hrefs = out.match(/<a href="[^"]*"/g) || [];
  const anidado = hrefs.some((x) => /<|>/.test(x.slice(9)));
  // Toda etiqueta que aparezca en la salida tiene que ser una de las que genera la funcion, con la forma exacta
  const etiquetas = out.match(/<[^>]*>/g) || [];
  const soloPermitidas = etiquetas.every((e) => /^<a href="[^"<>]*" rel="noopener noreferrer">$|^<\/a>$|^<\/?strong>$|^<\/?code>$/.test(e));
  if (/[<>]/.test(sinPermitidas) || anidado || !soloPermitidas) { htmlFallos++; console.log('HTML PELIGROSO:', JSON.stringify(h), '->', out); }
}
console.log(`inlineHtml: ${hostiles.length} entradas hostiles, peligrosas: ${htmlFallos}`);
fallos += htmlFallos;
// Un enlace legitimo debe seguir funcionando
const ok = lib2.inlineHtml('[imarkt.co](https://imarkt.co/rib-eye-bloque/) y **54.000 COP/kg**');
if (!ok.includes('<a href="https://imarkt.co/rib-eye-bloque/" rel="noopener noreferrer">imarkt.co</a>') || !ok.includes('<strong>54.000 COP/kg</strong>')) { console.log('FALLA: el enlace legitimo no se genero bien:', ok); fallos++; }
process.exit(fallos ? 1 : 0);
