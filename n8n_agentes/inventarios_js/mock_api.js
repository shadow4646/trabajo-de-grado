// Servidor de prueba que imita la API de un programa de inventario. Solo para probar la fuente "api" del agente.
// Uso: node mock_api.js [puerto]   (por defecto 8898, solo escucha en 127.0.0.1)
const http = require('http');
const fs = require('fs');
const path = require('path');
const puerto = Number(process.argv[2] || 8898);

function csv(texto) {
  const filas = texto.split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
  const [enc, ...cuerpo] = filas;
  return cuerpo.map((f) => Object.fromEntries(enc.map((h, i) => [h, f[i]])));
}
const leer = (f) => csv(fs.readFileSync(path.join(__dirname, 'datos_ejemplo', f), 'utf8'));
const movimientos = leer('movimientos_ejemplo.csv');
const productos = leer('maestro_ejemplo.csv');

http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.startsWith('/movimientos')) return res.end(JSON.stringify({ total: movimientos.length, data: movimientos }));
  if (req.url.startsWith('/productos')) return res.end(JSON.stringify({ total: productos.length, data: productos }));
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'no existe' }));
}).listen(puerto, '127.0.0.1', () => console.log(`API de prueba en http://127.0.0.1:${puerto} (/movimientos y /productos)`));
