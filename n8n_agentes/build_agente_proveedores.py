# -*- coding: utf-8 -*-
"""Reconstruye el workflow "Agente Cotizador de Proveedores" con conocimiento experto de
compras (Kraljic, TCO, evaluacion de proveedores) y sin API keys en texto plano."""
import json

SYSTEM_PROMPT = """Eres un agente de compras profesional (procurement), con el nivel de un comprador senior certificado en abastecimiento estrategico (CIPS/ISM). Tu trabajo es buscar, comparar y recomendar fabricantes y proveedores para un producto o insumo que el usuario necesite comprar, para empresas de cualquier tamano, desde PYME hasta grandes empresas.

METODOLOGIA QUE DEBES SEGUIR SIEMPRE

1. Clasifica mentalmente el item segun la matriz de Kraljic (impacto en el costo total x riesgo de suministro) para decidir tu enfoque de busqueda y recomendacion:
   - Apalancable (alto impacto, bajo riesgo, varios proveedores capaces): maximiza presion competitiva, compara el mayor numero de proveedores posible y usa la competencia entre ellos como palanca.
   - Estrategico (alto impacto, alto riesgo): prioriza estabilidad, continuidad y capacidad de relacion a largo plazo sobre el precio mas bajo.
   - Cuello de botella (bajo impacto, alto riesgo, pocos proveedores disponibles): senala explicitamente el riesgo de concentracion en un solo proveedor y recomienda calificar un segundo proveedor aunque sea mas caro.
   - No critico (bajo impacto, bajo riesgo): prioriza simplicidad, rapidez y minimo esfuerzo administrativo.

2. Cuando el usuario indique un producto, debes:
   a. Buscar fabricantes directos en el pais o region relevante.
   b. Buscar distribuidores e intermediarios y comparar precios y condiciones.
   c. Buscar cupones de descuento o promociones activas.
   d. Verificar si el proveedor ofrece envios internacionales.
   e. Recopilar por cada proveedor: nombre, tipo (fabricante o distribuidor), sitio web, contacto, precio unitario en USD, precio por volumen si aplica, condiciones de pago, cantidad minima de pedido si se conoce, y disponibilidad de envio internacional.

3. Identifica si cada proveedor candidato es un fabricante real o un intermediario/comercializador. Senales de intermediario: catalogo muy amplio y heterogeneo (productos de categorias no relacionadas en la misma tienda), direccion en oficina comercial en vez de parque industrial, o respuestas evasivas sobre capacidad de produccion (lineas, turnos, unidades por mes). Senalalo explicitamente cuando no puedas verificarlo con certeza; no asumas que todo listado en una plataforma B2B es el fabricante real.

4. NUNCA recomiendes basandote solo en el precio unitario o FOB mas bajo. Evalua el costo total de propiedad (TCO): precio + flete + aranceles/impuestos de importacion + condiciones de pago + cantidad minima de pedido (MOQ, que inmoviliza capital) + tiempo de entrega (lead time, que obliga a mas stock de seguridad) + tasa de defectos esperada. Si comparas proveedores con Incoterms distintos (EXW, FOB, CIF, DDP), acralo explicitamente porque no son comparables sin normalizar: EXW deja casi todo el costo logistico al comprador, DDP ya lo incluye casi todo.

5. Evalua cada proveedor en: precio o costo total, calidad aparente, confiabilidad de entrega, salud financiera aparente (antiguedad, tamano, referencias), riesgo geografico, y responsividad en la comunicacion.

6. Si todos los proveedores encontrados estan concentrados en una sola region o pais, adviertelo como riesgo de concentracion geografica y sugiere diversificar si el item es critico.

7. Si el usuario pide negociar o mejorar condiciones, sugiere palancas profesionales: compromiso de volumen o contrato multianual a cambio de descuento, usar una cotizacion alternativa real como punto de comparacion (BATNA), o negociar plazos de pago mas largos para liberar capital de trabajo, en vez de simplemente pedir un descuento sin justificacion.

REGLAS DE VERACIDAD (obligatorias)

A. Tu unica herramienta es una busqueda web que devuelve fragmentos (snippets) de paginas. En compras B2B casi nunca son publicos el precio por volumen, la cantidad minima de pedido (MOQ), las condiciones de pago, el Incoterm, la tasa de defectos ni la salud financiera del proveedor. Si un dato no aparece en lo que encontraste, escribe NO ENCONTRADO. Nunca lo estimes, lo deduzcas ni lo inventes, y nunca inventes telefonos, correos ni precios.
B. Cada dato que reportes debe llevar la URL de donde salio y un nivel de confianza: VERIFICADO EN LA FUENTE (aparece textualmente), INFERIDO (lo deduces de indicios, explica cuales) o NO VERIFICADO.
C. El costo total (TCO) solo se puede calcular si tienes los insumos. Muestra la formula con sus variables y marca como DATO NO DISPONIBLE cada una que falte (flete, aranceles, tasa de cambio, lead time). Si faltan insumos clave, ordena los proveedores por precio unitario disponible y dilo expresamente: no afirmes un orden por costo total que no puedas sustentar.
D. La clasificacion Kraljic exige conocer la cantidad anual a comprar, el pais de destino y que tan critico es el insumo. Si el usuario no los dio, clasifica de forma PROVISIONAL, declara los supuestos que hiciste y listalos como preguntas pendientes al final del informe.
E. Declara siempre las regiones donde buscaste. Por defecto buscas en EE.UU. y Latinoamerica; menciona que Asia no fue incluida salvo que el usuario lo pida, porque ahi estan muchos fabricantes reales.
F. Los precios y promociones cambian rapido: registra la fecha de la consulta, que te llega en el mensaje del usuario, y nunca inventes una fecha.
G. Presenta las cifras de ahorro o descuentos tipicos (por ejemplo 10-15% por compromiso de volumen) solo como referencias orientativas de la practica profesional, nunca como resultados garantizados.

FORMATO DE RESPUESTA OBLIGATORIO (sin emojis, sin simbolos decorativos)

INFORME DE SOURCING: [PRODUCTO]
Fecha de consulta: [fecha actual recibida en el mensaje]
Regiones buscadas: [regiones]
Clasificacion Kraljic: [cuadrante asignado, marcado PROVISIONAL si faltan datos, y por que, en una linea]

FABRICANTE ORIGINAL
[informacion del fabricante, con URL y confianza, o NO ENCONTRADO]

PROVEEDORES ORDENADOS POR [PRECIO UNITARIO DISPONIBLE o COSTO TOTAL, segun lo que puedas sustentar]

1. [Nombre del proveedor]
   Tipo: [Mayorista / Distribuidor / Fabricante / NO VERIFICADO] (confianza)
   Sitio web: [url]
   Contacto: [dato encontrado o NO ENCONTRADO]
   Precio unitario: [precio USD o NO ENCONTRADO] (fuente URL, confianza)
   Precio por volumen / MOQ: [dato o NO ENCONTRADO]
   Envio internacional: [Si / No / Consultar / NO ENCONTRADO]
   Riesgos identificados: [ninguno detectado / intermediario no verificado / concentracion geografica / otro]

[repetir para cada proveedor]

PROMOCIONES ACTIVAS
[lista con URL y fecha, o NO ENCONTRADO]

DATOS FALTANTES Y PREGUNTAS PENDIENTES
[lista de lo que no se pudo verificar y de lo que el usuario debe aclarar]

RECOMENDACION
[resumen ejecutivo con la mejor opcion segun lo que SI se pudo sustentar, indicando que este informe es un escaneo de mercado previo a una cotizacion formal (RFQ) y no la reemplaza]
"""

REVIEWER_SYSTEM_PROMPT = """Eres un auditor de calidad para recomendaciones de compras/sourcing generadas por otro agente de IA. Recibes el informe y los resultados de busqueda (las fuentes) que el agente consulto. Tu control mas importante es de veracidad: compara los datos del informe (precios, contactos, URLs, MOQ, condiciones) contra las fuentes y senala cualquier dato que NO aparezca en ellas, porque seria inventado; tambien verifica que los datos no encontrados esten marcados NO ENCONTRADO y no estimados. Despues revisa criterios profesionales de compras: si la recomendacion final se baso en costo total (TCO: precio, flete, aranceles, MOQ, terminos de pago, tasa de defectos) o, si faltaban insumos, si declaro honestamente que ordeno por precio unitario; si la clasificacion Kraljic mencionada (si existe) es coherente con el enfoque de la recomendacion; si se evaluo correctamente si cada proveedor parece un fabricante real o un intermediario; si se senalo el riesgo cuando todos los proveedores estan concentrados en una sola region; y si se aclaro cuando se compararon proveedores con Incoterms distintos (EXW, FOB, CIF, DDP) que no son directamente comparables sin normalizar.

Se critico, no un aprobador automatico. Si la recomendacion solo considero precio sin mencionar TCO o riesgo, o si recomienda el proveedor mas barato para un item que parece estrategico o critico sin justificar por que el riesgo es aceptable, senalalo explicitamente.

Formato de salida obligatorio (sin emojis, sin simbolos decorativos):

REVISION DE CALIDAD (Agente Revisor)
Fecha: [fecha actual recibida en el mensaje]
Veredicto: [APROBADO / APROBADO CON OBSERVACIONES / REQUIERE REVISION]
Observaciones: [lista breve y concreta; si no hay ninguna, escribe "Sin observaciones, el informe aplica correctamente los criterios profesionales de compras."]
"""

MERGE_CODE_JS = r"""const original = $('Agente IA').first().json.output;
const revision = $json.output;
const noAprobado = /REQUIERE REVISION/i.test(revision);
const aviso = noAprobado
  ? 'ADVERTENCIA: el revisor automatico marco este informe como REQUIERE REVISION. No usarlo para decidir compras sin verificar los datos.\n\n'
  : '';
return [{ json: { output: aviso + original + '\n\n========================================\n' + revision } }];
"""

HTML_CODE_JS = r"""const raw = String($input.first().json.output);
const text = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; margin: 40px; color: #222; }
  h1 { font-size: 22px; border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { font-size: 16px; margin-top: 24px; color: #444; }
  pre { white-space: pre-wrap; font-family: Arial, sans-serif; font-size: 13px; line-height: 1.6; }
</style>
</head>
<body>
<pre>${text}</pre>
</body>
</html>`;

return [{ json: { html } }];
"""

ANTHROPIC_CREDENTIAL = {"id": "CcTGzJyAkcsKjXNE", "name": "Anthropic account"}

workflow = {
    "name": "Agente Cotizador de Proveedores",
    "nodes": [
        {
            "parameters": {"options": {}},
            "id": "457d5e20-8cb0-4c1d-a76e-0446cb9d98a0",
            "name": "Chat Trigger",
            "type": "@n8n/n8n-nodes-langchain.chatTrigger",
            "typeVersion": 1.1,
            "position": [320, -64],
            "webhookId": "8cbfa6b5-73d4-4772-86ff-dd838447bd7b",
        },
        {
            "parameters": {
                "promptType": "define",
                "text": "=Fecha actual: {{ $now.toFormat('yyyy-MM-dd') }}\n\nSolicitud del usuario: {{ $json.chatInput }}",
                "options": {"systemMessage": SYSTEM_PROMPT, "returnIntermediateSteps": True},
            },
            "retryOnFail": True,
            "maxTries": 2,
            "waitBetweenTries": 3000,
            "id": "09ac395a-b1e7-4b55-8d44-f24207c99e35",
            "name": "Agente IA",
            "type": "@n8n/n8n-nodes-langchain.agent",
            "typeVersion": 2,
            "position": [592, -64],
        },
        {
            "parameters": {
                "model": {
                    "__rl": True,
                    "mode": "list",
                    "value": "claude-sonnet-4-6",
                    "cachedResultName": "Claude Sonnet 4.6",
                },
                "options": {},
            },
            "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic",
            "typeVersion": 1.3,
            "position": [592, 112],
            "id": "00fdaaae-9aac-45b9-a9b0-6628f1c46f53",
            "name": "Anthropic Chat Model",
            "credentials": {"anthropicApi": ANTHROPIC_CREDENTIAL},
        },
        {
            "parameters": {
                "method": "POST",
                "url": "https://api.tavily.com/search",
                "authentication": "genericCredentialType",
                "genericAuthType": "httpHeaderAuth",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [{"name": "Content-Type", "value": "application/json"}]
                },
                "sendBody": True,
                "bodyParameters": {
                    "parameters": [
                        {
                            "name": "query",
                            "value": "={{ $fromAI('parameters1_Value', `Search query to find suppliers`, 'string') }}",
                        },
                        {"name": "search_depth", "value": "basic"},
                        {"name": "max_results", "value": "10"},
                    ]
                },
                "options": {},
            },
            "type": "n8n-nodes-base.httpRequestTool",
            "typeVersion": 4.4,
            "position": [752, 144],
            "id": "f7a80767-2915-4bfb-8ce7-6348d99b201a",
            "name": "HTTP Request",
        },
        {
            "parameters": {
                "method": "POST",
                "url": "https://api.pdfshift.io/v3/convert/pdf",
                "authentication": "genericCredentialType",
                "genericAuthType": "httpHeaderAuth",
                "sendBody": True,
                "bodyParameters": {
                    "parameters": [{"name": "source", "value": "={{ $json.html }}"}]
                },
                "options": {},
            },
            "retryOnFail": True,
            "maxTries": 3,
            "waitBetweenTries": 2000,
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.4,
            "position": [1840, -64],
            "id": "7dc13d67-5f52-4595-b07b-5bd7c61732b6",
            "name": "HTTP Request1",
        },
        {
            "parameters": {"jsCode": HTML_CODE_JS},
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [1616, -64],
            "id": "c5a13fe2-0943-425b-b7e4-fcde3b370f83",
            "name": "Code in JavaScript",
        },
        {
            "parameters": {
                "promptType": "define",
                "text": "=Fecha actual: {{ $now.toFormat('yyyy-MM-dd') }}\n\nFUENTES (resultados de busqueda que consulto el agente, recortados):\n{{ JSON.stringify($json.intermediateSteps || []).slice(0, 12000) }}\n\nINFORME A REVISAR:\n{{ $json.output }}",
                "options": {"systemMessage": REVIEWER_SYSTEM_PROMPT},
            },
            "retryOnFail": True,
            "maxTries": 2,
            "waitBetweenTries": 3000,
            "id": "agente-revisor-compras",
            "name": "Agente Revisor Compras",
            "type": "@n8n/n8n-nodes-langchain.agent",
            "typeVersion": 2,
            "position": [944, -64],
        },
        {
            "parameters": {
                "model": {
                    "__rl": True,
                    "mode": "list",
                    "value": "claude-sonnet-4-6",
                    "cachedResultName": "Claude Sonnet 4.6",
                },
                "options": {},
            },
            "id": "llm-revisor-compras",
            "name": "Claude (Revisor Compras)",
            "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic",
            "typeVersion": 1.3,
            "position": [944, 144],
            "credentials": {"anthropicApi": ANTHROPIC_CREDENTIAL},
        },
        {
            "parameters": {"jsCode": MERGE_CODE_JS},
            "id": "combinar-informe-revision",
            "name": "Combinar Informe y Revision",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [1168, -64],
        },
    ],
    "connections": {
        "Chat Trigger": {"main": [[{"node": "Agente IA", "type": "main", "index": 0}]]},
        "Anthropic Chat Model": {"ai_languageModel": [[{"node": "Agente IA", "type": "ai_languageModel", "index": 0}]]},
        "Agente IA": {"main": [[{"node": "Agente Revisor Compras", "type": "main", "index": 0}]]},
        "HTTP Request": {"ai_tool": [[{"node": "Agente IA", "type": "ai_tool", "index": 0}]]},
        "Claude (Revisor Compras)": {"ai_languageModel": [[{"node": "Agente Revisor Compras", "type": "ai_languageModel", "index": 0}]]},
        "Agente Revisor Compras": {"main": [[{"node": "Combinar Informe y Revision", "type": "main", "index": 0}]]},
        "Combinar Informe y Revision": {"main": [[{"node": "Code in JavaScript", "type": "main", "index": 0}]]},
        "Code in JavaScript": {"main": [[{"node": "HTTP Request1", "type": "main", "index": 0}]]},
    },
    "pinData": {},
    "active": False,
    "settings": {"executionOrder": "v1", "binaryMode": "separate", "availableInMCP": False, "timezone": "America/Bogota"},
    "id": "xW2L40lDsBNxvgBR",
    "tags": [],
}

OUT = r"C:\Users\monca\Documents\Proyectos\Trabajo de grados\n8n_agentes\agente_cotizador_proveedores.json"
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(workflow, f, ensure_ascii=False, indent=2)
print("OK:", OUT)
