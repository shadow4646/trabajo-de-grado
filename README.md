# Agentes de IA para decisiones de compra e inventario

Proyecto de grado de Ingeniería Industrial. Este repositorio contiene solo el código y los agentes: workflows de n8n, los scripts que los generan, los subagentes de Claude Code y la investigación que los sustenta.

## Estructura

| Ruta | Contenido |
|---|---|
| `n8n_agentes/build_agente_inventarios.py` | Genera el workflow "Agente Gestor de Inventarios" (rotación, punto de reorden, clasificación ABC, informe mensual). |
| `n8n_agentes/build_agente_proveedores.py` | Genera el workflow "Agente Cotizador de Proveedores" (búsqueda y comparación de proveedores). |
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

## Seguridad

No subir claves de API, archivos `.env` ni `settings.yml`. El `.gitignore` ya los excluye, junto con los documentos de las entregas. Si una clave llega a publicarse por error, hay que rotarla.
