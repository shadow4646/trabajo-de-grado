# Variante A: agente de inventarios en Python (sin n8n)

Port del agente gestor de inventarios del prototipo con n8n (`../n8n_agentes/inventarios_js`) a un paquete de Python autónomo. Lee los movimientos y el maestro de productos de un CSV, un Excel, una base SQL o una API, calcula qué surtir y cuánto con una política de revisión periódica (R,s,S), y escribe un informe (HTML y Markdown) y dos CSV. La IA es opcional y solo redacta un comentario corto: todos los cálculos son código.

**Estado:** el agente de inventarios está portado y verificado contra el prototipo. El agente de proveedores todavía no está portado. No se ha validado con datos de una empresa real.

## Uso

Probado con Python 3.13 y sin dependencias obligatorias. Las dependencias son opcionales y solo para leer ciertas fuentes: `openpyxl` (Excel), `pymysql` (MySQL), `psycopg2-binary` (PostgreSQL). CSV, SQLite y API no necesitan nada más.

```
python -m agente_inventarios --movimientos kardex.csv --productos maestro.csv --mes 2026-09
python -m agente_inventarios --config configuracion_ejemplo.json --mensaje "informe de septiembre 2026"
python -m agente_inventarios --fuente excel --excel inventario.xlsx --sector alimentos
```

Se ejecuta desde esta carpeta (`variante_python`). Para programarlo cada mes, use el Programador de tareas de Windows o `cron` con el mismo comando. Los archivos salen en la carpeta `informes` (o la que indique `--salida`): `inventario_AAAA-MM.html`, `.md`, `_pedido.csv` y `_detalle.csv`.

La configuración completa está en `agente_inventarios/ejecutar.py` (`CONFIG_DEFECTO`) y se puede pasar en un JSON (ver `configuracion_ejemplo.json`): fuente, rutas, consultas SQL, mapeo de columnas si los encabezados no se reconocen solos, parámetros de la política (sector, período de revisión, plazo por defecto) y proveedor de lenguaje.

## Proveedor de lenguaje

| Opción | Qué hace | Estado |
|---|---|---|
| `ninguno` (por defecto) | Informe completo sin comentario. No sale ningún dato hacia un servicio de lenguaje. | Probado |
| `claude` | Comentario con la API de Claude. La clave se lee de `ANTHROPIC_API_KEY` y nunca se guarda ni se imprime. | Probado solo contra un servidor simulado; el prototipo con n8n sí se probó con la API real |
| `ollama` | Comentario con un modelo local (`--modelo` obligatorio). Ollama no tiene autenticación propia: debe escuchar solo en 127.0.0.1 o en una red interna. | Probado solo contra un servidor simulado, no con un Ollama real |

A diferencia del prototipo con n8n, aquí la IA está apagada por defecto. Si el servicio de lenguaje falla, el informe sale igual, sin comentario, con un aviso.

## Seguridad

- Solo lectura: no se escribe nunca en el sistema de inventario. Con SQL se exige una consulta `SELECT` de una sola sentencia y la conexión se abre en solo lectura donde el motor lo permite (SQLite, MySQL y PostgreSQL). Aun así conviene usar un usuario de base de datos con permiso únicamente de lectura.
- La URL de la base de datos y el token de la API se leen de variables de entorno (`INVENTARIOS_SQL_URL`, `INVENTARIOS_API_TOKEN`), no del archivo de configuración.
- Los CSV neutralizan fórmulas de Excel (`=`, `+`, `-`, `@`) en cualquier separador posible, y el HTML escapa el texto externo.
- A diferencia del prototipo con n8n no hay interfaz web, chat ni puerto abierto.

## Equivalencia con el prototipo

Con las mismas entradas, las salidas deterministas coinciden con las del motor de JavaScript: textos y enteros idénticos, decimales con tolerancia relativa de 1e-9. Se comprueba en 7 casos (los datos de ejemplo y 6 casos generados con datos sucios: fechas y números en varios formatos, entradas y salidas en columnas separadas, fechas por mes, bodegas, nombres hostiles y columnas no reconocidas), incluidos el informe Markdown, el HTML, los dos CSV y la respuesta corta del chat.

```
node pruebas/exportar_referencia.js        # genera las salidas de referencia con el motor de JavaScript
python -m unittest discover -s pruebas -p "test_*.py" -t .
```

- `pruebas/test_equivalencia.py`: compara contra las referencias de JavaScript.
- `pruebas/test_unitarios.py`: fórmulas contra ejemplos numéricos calculados a mano, reglas de decisión y datos sucios (port de `test_motor.js`).
- `pruebas/test_integracion.py`: los cuatro conectores con los mismos datos (compra sugerida de 34 446 y 6 productos urgentes, igual que en n8n), proveedores de lenguaje y línea de comandos, con servidores locales simulados.

Los datos de prueba son sintéticos. Reproducir JavaScript exige cuidar diferencias de lenguaje que las pruebas cubren: `Math.round` frente a `round` (JavaScript redondea .5 hacia arriba y Python al par), `toFixed` frente a `format`, `sum` con compensación desde Python 3.12, fechas fuera de rango que `Date.UTC` desborda (el 30 de febrero pasa al 2 de marzo), `\b` y `\d` de las expresiones regulares y enteros que Python escribe como `120.0`.

## Diferencias con el prototipo con n8n

| | n8n (Variante B) | Python (Variante A) |
|---|---|---|
| Ejecución | Flujo visual, chat y disparador mensual | Línea de comandos y planificador del sistema |
| IA por defecto | Activa | Apagada |
| Nombre del modelo y URL | Constantes del código | Configurables |
| SQL | Consulta libre del nodo | Solo `SELECT`, conexión de solo lectura |
| Credenciales | Gestor de credenciales de n8n | Variables de entorno |
