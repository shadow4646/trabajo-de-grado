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
];
const debePermitir = [
  'https://www.molinoellobo.com.co/contacto', 'http://harineraelmolino.com/', 'https://ejemplo.com:443/a?b=c', 'http://ejemplo.com:8080/x',
  'https://sub.dominio.co/ruta#ancla', 'https://172.15.0.1.nip.example.com/', 'https://8.8.8.8/', 'https://172.32.0.1/',
];

let fallos = 0;
for (const u of debeBloquear) if (!urlInsegura(u)) { console.log('FALLA (debia bloquear):', u); fallos++; }
for (const u of debePermitir) if (urlInsegura(u)) { console.log('FALLA (debia permitir):', u, '->', urlInsegura(u)); fallos++; }
console.log(`${debeBloquear.length} bloqueos y ${debePermitir.length} permitidos probados, fallos: ${fallos}`);
process.exit(fallos ? 1 : 0);
