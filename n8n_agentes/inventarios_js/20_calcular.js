// Nodo "Calcular inventario": lee los datos de la fuente elegida, los normaliza y calcula todo (sin IA).
const cfg = $('Configuracion').first().json.cfg;
const t0 = Date.now();

const NODOS = {
  csv: ['Extraer CSV de movimientos', 'Extraer CSV de productos'],
  excel: ['Extraer Excel de movimientos', 'Extraer Excel de productos'],
  sql: ['SQL de movimientos', 'SQL de productos'],
  api: ['API de movimientos', 'API de productos'],
};
const [nodoMov, nodoMae] = NODOS[cfg.fuente] || NODOS.csv;

// Los nodos de las fuentes que no se eligieron no se ejecutan: acceder a ellos lanza un error que aqui se ignora.
const filasDe = (nombreNodo, ruta) => {
  let items;
  try { items = $(nombreNodo).all(); } catch (e) { return null; }
  const filas = items.map((i) => i.json).filter((j) => j && !j.error);
  if (ruta && filas.length === 1 && Array.isArray(filas[0][ruta])) return filas[0][ruta];
  return filas;
};

const filasMov = filasDe(nodoMov, cfg.api_ruta_datos);
const filasMae = filasDe(nodoMae, cfg.api_ruta_datos) || [];
const fallo = (mensaje) => [{ json: { error: true, cfg, mensaje } }];
if (!filasMov || !filasMov.length) return fallo(`No se recibieron movimientos de la fuente "${cfg.fuente}". Revisa la configuracion: ruta del archivo, consulta SQL o URL de la API.`);

const datos = normalizar(filasMov, filasMae, { ...cfg, mapeo: cfg.mapeo, mapeo_maestro: Object.keys(cfg.mapeo_productos || {}).length ? cfg.mapeo_productos : cfg.mapeo });
if (datos.error) return fallo(datos.error);
const res = calcularInventario(datos, { mes: cfg.mes }, cfg.parametros);
const ind = indicadores(res, res.P);

// Lo que viaja al siguiente nodo es JSON: se quitan las series mensuales y Infinity pasa a null.
const resultados = res.resultados.map(({ meses, valores, ...r }) => ({ ...r, cobertura: Number.isFinite(r.cobertura) ? r.cobertura : null }));
const entradaIA = armarEntradaIA(res, ind); // resumen para el modelo de lenguaje (definido en 02_informe.js)
const entradaJson = JSON.stringify(entradaIA);
const claudeBody = cfg.usar_ia
  ? { model: MODELO, max_tokens: 450, temperature: 0.2, system: PROMPT_COMENTARIO, messages: [{ role: 'user', content: entradaJson }] }
  : null;

return [{ json: { error: false, cfg, res: { ...res, resultados }, ind, entrada_ia: entradaJson, claude_body: claudeBody, ms: Date.now() - t0 } }];
