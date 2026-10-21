// Nodo "Configuracion": aqui se elige de donde salen los datos y se ajustan los parametros. Es el unico nodo que hay que editar.
// El mes sale del mensaje del chat ("informe de 2026-09" o "septiembre 2026"); si no hay mensaje, es el mes calendario anterior.
const CONFIG = {
  // De donde se leen los movimientos y los productos: 'csv', 'excel', 'sql' o 'api'
  fuente: 'csv',

  // CSV: un archivo de movimientos y otro de productos. Excel: un libro con una hoja de movimientos y otra de productos.
  // Los archivos deben estar dentro de la carpeta permitida de n8n (C:\Users\<usuario>\.n8n-files)
  archivo_movimientos: 'C:\\Users\\monca\\.n8n-files\\inventario\\movimientos_ejemplo.csv',
  archivo_productos: 'C:\\Users\\monca\\.n8n-files\\inventario\\maestro_ejemplo.csv',
  separador: ',',
  archivo_excel: 'C:\\Users\\monca\\.n8n-files\\inventario\\inventario_ejemplo.xlsx',
  hoja_movimientos: 'Movimientos',
  hoja_productos: 'Productos',

  // SQL (PostgreSQL por defecto; para MySQL o SQL Server se cambia el tipo de nodo). Las consultas deben devolver
  // columnas con nombres reconocibles (fecha, sku, tipo, cantidad...) o se indica el mapeo mas abajo.
  // La fecha se pide como texto (to_char) para que no cambie de dia segun la zona horaria del servidor.
  sql_movimientos: "SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, sku, producto, tipo, cantidad, costo_unitario, saldo FROM kardex WHERE fecha >= CURRENT_DATE - INTERVAL '26 months'",
  sql_productos: 'SELECT sku, producto, unidad, stock_actual, costo_unitario, lead_time_dias, moq, en_transito, proveedor FROM productos',

  // API de un programa: la autenticacion se configura con una credencial en los nodos "API de movimientos" y "API de productos".
  // Si la respuesta trae los registros dentro de un campo (por ejemplo {"data": [...]}), se indica aqui el nombre del campo.
  api_url_movimientos: '',
  api_url_productos: '',
  api_ruta_datos: '',

  // Si los encabezados del archivo o la consulta no se reconocen solos: { campo_del_agente: 'Nombre de tu columna' }
  // Campos: fecha, sku, producto, tipo, cantidad, entrada, salida, costo_unitario, saldo, stock_actual, lead_time_dias, moq, en_transito, proveedor
  mapeo: {},
  mapeo_productos: {},
  formato_fecha: 'DMY',
  por_bodega: false,
  moneda: '$',

  // Parametros de la politica de reposicion (ver el informe, seccion "Como se calcula")
  parametros: {
    sector: 'general', // 'general', 'alimentos', 'comercio', 'manufactura' o 'pesados'
    R_dias: 30,
    lead_time_defecto: 15,
  },

  // Claude solo redacta un comentario corto; todos los calculos son codigo. false = sin comentario y sin costo de IA.
  usar_ia: true,
};

const entrada = $input.first().json;
const texto = String(entrada.chatInput ?? entrada.text ?? '').trim();
const cfg = JSON.parse(JSON.stringify(CONFIG));

const hoy = hoyIso();
let mes = null;
const mIso = /(\d{4})[-/](\d{1,2})/.exec(texto);
if (mIso && Number(mIso[2]) >= 1 && Number(mIso[2]) <= 12) mes = `${mIso[1]}-${String(mIso[2]).padStart(2, '0')}`;
if (!mes) {
  const nombre = MESES_ES.findIndex((n) => new RegExp(`\\b${n}\\b`, 'i').test(norm(texto)));
  const anio = /\b(20\d{2})\b/.exec(texto);
  if (nombre >= 0) mes = `${anio ? anio[1] : mesDeIndice(mesIndice(hoy.slice(0, 7)) - (nombre + 1 > Number(hoy.slice(5, 7)) ? 12 : 0)).slice(0, 4)}-${String(nombre + 1).padStart(2, '0')}`;
}
if (!mes) mes = mesDeIndice(mesIndice(hoy.slice(0, 7)) - 1);
cfg.mes = mes;

const fuente = /\b(csv|excel|sql|api)\b/i.exec(texto);
if (fuente) cfg.fuente = fuente[1].toLowerCase();
if (/\bsin ia\b/i.test(texto)) cfg.usar_ia = false;
cfg.parametros = cfg.parametros || {};
cfg.hoy = hoy;

return [{ json: { cfg } }];
