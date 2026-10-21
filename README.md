# Agentes de IA para decisiones de compra e inventario

Proyecto de grado de Ingeniería Industrial. Este repositorio contiene solo el código y los agentes: workflows de n8n, los scripts que los generan, los subagentes de Claude Code y la investigación que los sustenta.

## Estructura

| Ruta | Contenido |
|---|---|
| `n8n_agentes/build_agente_inventarios.py` | Genera el workflow "Agente Gestor de Inventarios" (rotación, punto de reorden, clasificación ABC, informe mensual). |
| `n8n_agentes/build_agente_proveedores.py` | Genera el workflow "Agente Cotizador de Proveedores" (búsqueda y comparación de proveedores). |
| `n8n_agentes/busqueda_js/` | Código de los nodos del agente de proveedores (búsqueda rápida y profunda). `00_lib.js` es la biblioteca común, `01` a `09` son los nodos, `test_local.js` los prueba sin n8n, `test_logica.js` y `test_seguridad.js` son pruebas automáticas y `mock_claude.js` simula la API de Claude para probar sin gastar. |
| `n8n_agentes/*.json` | Workflows ya generados, listos para importar en n8n. |
| `n8n_agentes/inventario_historico.csv` | CSV de ejemplo para probar el agente de inventarios. |
| `n8n_agentes/searxng/` | Plantilla de configuración del buscador local SearXNG. |
| `n8n_agentes/conocimiento_experto/` | Investigación citada de gestión de inventarios y de compras que sustenta a los agentes. |
| `.claude/agents/` | Subagentes de Claude Code: `experto-inventarios`, `experto-compras`, `experto-n8n`. |
| `.claude/skills/revision-experta-proyecto/` | Skill que convoca a los tres expertos como una junta de revisión. |

## Cómo usar los workflows de n8n

1. Genera los JSON: `python n8n_agentes/build_agente_inventarios.py` y `python n8n_agentes/build_agente_proveedores.py`.
2. Impórtalos: `n8n import:workflow --input=<archivo>.json`, o desde la interfaz de n8n.
3. Crea en n8n las credenciales (Anthropic, y las que necesite cada nodo) y selecciónalas en los nodos. Las claves nunca se guardan en este repositorio.

## Búsqueda local con SearXNG

1. Copia `n8n_agentes/searxng/settings.example.yml` como `settings.yml` y cambia `secret_key`.
2. Levanta el contenedor, publicado solo en tu equipo:

```
docker run -d --name searxng --restart unless-stopped -p 127.0.0.1:8888:8080 -v "<ruta>/n8n_agentes/searxng:/etc/searxng" searxng/searxng
```

Consulta de prueba: `http://127.0.0.1:8888/search?q=harina+de+trigo&format=json`

## Qué devuelve el agente de proveedores

Un informe centrado en precios: cuánto cuesta (rango y valor típico por kilo, al detal y al por mayor), un cuadro con proveedor, cantidad, precio publicado y precio comparable por kilo en la moneda del destino, y dónde conseguirlo con contacto. Si no se indica destino se asume Colombia (Bogotá). El chat recibe un resumen corto y el informe completo (fichas, borrador de cotización, cobertura y fuentes) se guarda en HTML y Markdown. Cada precio se verifica por código contra el texto de la página; los precios al por mayor casi nunca son públicos y se piden por cotización.

Los tipos de cambio salen de [ExchangeRate-API](https://www.exchangerate-api.com) (`open.er-api.com`, gratuita y sin clave, solo como referencia). Es la única llamada a un servicio externo, además de Claude y de los buscadores que consulta SearXNG.

## Probar la búsqueda de proveedores sin gastar

```
cd n8n_agentes/busqueda_js
node test_local.js "rapida: harina de trigo panadera, 5 toneladas por pedido, destino Bogota"
```

Usa SearXNG y páginas reales, pero respuestas de Claude simuladas. La prueba real con Claude gasta unos centavos de dólar por informe (modelo Haiku 4.5, estimación propia sin verificar).

## Seguridad

No subir claves de API, archivos `.env` ni `settings.yml`. El `.gitignore` ya los excluye, junto con los documentos de las entregas. Si una clave llega a publicarse por error, hay que rotarla.

### Protección contra SSRF en la lectura de páginas

El agente de proveedores descarga páginas cuyas URLs salen de buscadores y de otras páginas, es decir, de contenido ajeno. `busqueda_js/05_leer.js` aplica `urlInsegura()` (en `00_lib.js`) a cada descarga y a cada redirección, que se sigue a mano con un máximo de 4 saltos. Funciona como lista blanca estricta, sin intentar interpretar formas ambiguas: rechaza barras invertidas, espacios y caracteres de control, `usuario@` en la URL, cualquier host que no sea ASCII alfanumérico con puntos (así cae el IPv6 literal, el `%` y el unicode), puertos fuera de 80, 443, 8080 y 8443, `localhost`, nombres internos (`.local`, `.internal`, `.lan` y similares) y nombres sin dominio. Si la última etiqueta del host es numérica o hexadecimal, solo acepta IPv4 decimal estricta, sin ceros a la izquierda, y rechaza las privadas o reservadas (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, 224+).

Se prueba con `node busqueda_js/test_seguridad.js`: casos fijos y una prueba diferencial que genera 207.360 variantes hostiles y verifica, con el parser WHATWG real de Node, que ninguna de las que el filtro deja pasar se interprete como dirección interna.

Limitación conocida: el entorno de los nodos Code de n8n no permite resolver DNS, así que un nombre público que apunte a una IP privada (rebinding) no se detecta. En un servidor de empresa, complementarlo con reglas de salida del firewall o de Docker que impidan que el contenedor de n8n llegue a la red interna.
