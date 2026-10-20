# Agentes de IA para decisiones de compra e inventario

Proyecto de grado de Ingeniería Industrial. Este repositorio contiene solo el código y los agentes: workflows de n8n, los scripts que los generan, los subagentes de Claude Code y la investigación que los sustenta.

## Estructura

| Ruta | Contenido |
|---|---|
| `n8n_agentes/build_agente_inventarios.py` | Genera el workflow "Agente Gestor de Inventarios" (rotación, punto de reorden, clasificación ABC, informe mensual). |
| `n8n_agentes/build_agente_proveedores.py` | Genera el workflow "Agente Cotizador de Proveedores" (búsqueda y comparación de proveedores). |
| `n8n_agentes/busqueda_js/` | Código de los nodos del agente de proveedores (búsqueda rápida y profunda). `00_lib.js` es la biblioteca común, `01` a `09` son los nodos, `test_local.js` los prueba sin n8n y `mock_claude.js` simula la API de Claude para probar sin gastar. |
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

## Probar la búsqueda de proveedores sin gastar

```
cd n8n_agentes/busqueda_js
node test_local.js "rapida: harina de trigo panadera, 5 toneladas por pedido, destino Bogota"
```

Usa SearXNG y páginas reales, pero respuestas de Claude simuladas. La prueba real con Claude gasta unos centavos de dólar por informe (modelo Haiku 4.5, estimación propia sin verificar).

## Seguridad

No subir claves de API, archivos `.env` ni `settings.yml`. El `.gitignore` ya los excluye, junto con los documentos de las entregas. Si una clave llega a publicarse por error, hay que rotarla.

### Protección contra SSRF en la lectura de páginas

El agente de proveedores descarga páginas cuyas URLs salen de buscadores y de otras páginas, es decir, de contenido ajeno. `busqueda_js/05_leer.js` aplica `urlInsegura()` (en `00_lib.js`) a cada descarga y a cada redirección, que se sigue a mano con un máximo de 4 saltos. Bloquea esquemas distintos de http y https, puertos fuera de 80, 443, 8080 y 8443, `localhost`, nombres internos (`.local`, `.internal`, `.lan` y similares), nombres sin dominio, IPv6 literal y IPv4 privadas o reservadas (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10). Se prueba con `node busqueda_js/test_seguridad.js`.

Limitación conocida: el entorno de los nodos Code de n8n no permite resolver DNS, así que un nombre público que apunte a una IP privada (rebinding) no se detecta. En un servidor de empresa, complementarlo con reglas de salida del firewall o de Docker que impidan que el contenedor de n8n llegue a la red interna.
