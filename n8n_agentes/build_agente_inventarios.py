# -*- coding: utf-8 -*-
"""Genera el workflow de n8n "Agente Gestor de Inventarios".

Lee los movimientos y los productos desde un CSV, un Excel, una base SQL o la API de un programa, calcula todo con
codigo determinista (rotacion, quiebres, productos sin movimiento, politica de reposicion) y entrega un informe en
HTML, Markdown y dos CSV para Excel. La IA (Claude Haiku) solo redacta un comentario corto y es opcional.
El codigo de cada nodo vive en inventarios_js/ y se prueba en local con inventarios_js/test_local.js.

Uso: python build_agente_inventarios.py [--prueba "informe de 2026-09"] [--mock URL]
"""
import json
import pathlib
import sys

BASE = pathlib.Path(__file__).parent
JS = BASE / "inventarios_js"
LIB = (JS / "00_lib.js").read_text(encoding="utf-8")
MOTOR = (JS / "01_motor.js").read_text(encoding="utf-8")
INFORME = (JS / "02_informe.js").read_text(encoding="utf-8")

PRUEBA = "informe de 2026-09"
if "--prueba" in sys.argv:
    PRUEBA = sys.argv[sys.argv.index("--prueba") + 1]
MOCK = sys.argv[sys.argv.index("--mock") + 1] if "--mock" in sys.argv else None  # solo para pruebas
FUENTE = sys.argv[sys.argv.index("--fuente") + 1] if "--fuente" in sys.argv else None  # solo para pruebas: csv, excel, sql o api
PG_CRED = sys.argv[sys.argv.index("--pg-cred") + 1] if "--pg-cred" in sys.argv else None  # id de una credencial de PostgreSQL ya creada en n8n
API_BASE = sys.argv[sys.argv.index("--api-base") + 1] if "--api-base" in sys.argv else None  # solo para pruebas: URL base de inventarios_js/mock_api.js

ANTHROPIC_CREDENTIAL = {"id": "TinZ1eTTiTSbGGTS", "name": "Anthropic account"}
CFG = "$('Configuracion').first().json.cfg"


def codigo(archivo, *libs):
    fuente = (JS / archivo).read_text(encoding="utf-8")
    if FUENTE and archivo == "10_config.js":
        fuente = fuente.replace("fuente: 'csv',", f"fuente: '{FUENTE}',", 1)
    if API_BASE and archivo == "10_config.js":
        fuente = (fuente.replace("api_url_movimientos: '',", f"api_url_movimientos: '{API_BASE}/movimientos',", 1)
                  .replace("api_url_productos: '',", f"api_url_productos: '{API_BASE}/productos',", 1)
                  .replace("api_ruta_datos: '',", "api_ruta_datos: 'data',", 1))
    return "\n".join(libs) + "\n" + fuente


def nodo_code(nombre, archivo, x, y, nid, *libs):
    return {"parameters": {"jsCode": codigo(archivo, *libs)}, "id": nid, "name": nombre,
            "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x, y]}


def leer_archivo(nombre, campo, x, y, nid, una_vez=False, tolerante=False):
    n = {"parameters": {"operation": "read", "fileSelector": f"={{{{ {CFG}.{campo} }}}}", "options": {}},
         "id": nid, "name": nombre, "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1, "position": [x, y]}
    if una_vez:
        n["executeOnce"] = True
    if tolerante:
        n["onError"] = "continueRegularOutput"
    return n


def extraer(nombre, formato, hoja, x, y, nid, tolerante=False):
    opciones = {"delimiter": f"={{{{ {CFG}.separador }}}}"} if formato == "csv" else {"sheetName": f"={{{{ {CFG}.{hoja} }}}}"}
    n = {"parameters": {"operation": formato, "binaryPropertyName": "data", "options": opciones},
         "id": nid, "name": nombre, "type": "n8n-nodes-base.extractFromFile", "typeVersion": 1.1, "position": [x, y]}
    if tolerante:
        n["onError"] = "continueRegularOutput"
    return n


def sql(nombre, campo, x, y, nid, una_vez=False, tolerante=False):
    n = {"parameters": {"operation": "executeQuery", "query": f"={{{{ {CFG}.{campo} }}}}", "options": {}},
         "id": nid, "name": nombre, "type": "n8n-nodes-base.postgres", "typeVersion": 2.6, "position": [x, y]}
    if PG_CRED:
        n["credentials"] = {"postgres": {"id": PG_CRED, "name": "Postgres inventario"}}
    if una_vez:
        n["executeOnce"] = True
    if tolerante:
        n["onError"] = "continueRegularOutput"
    return n


def api(nombre, campo, x, y, nid, una_vez=False, tolerante=False):
    n = {"parameters": {"method": "GET", "url": f"={{{{ {CFG}.{campo} }}}}", "options": {}},
         "id": nid, "name": nombre, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [x, y]}
    if una_vez:
        n["executeOnce"] = True
    if tolerante:
        n["onError"] = "continueRegularOutput"
    return n


def regla(valor):
    return {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
                           "conditions": [{"id": f"fuente-{valor}", "leftValue": "={{ $json.cfg.fuente }}", "rightValue": valor,
                                           "operator": {"type": "string", "operation": "equals"}}], "combinator": "and"},
            "renameOutput": True, "outputKey": valor}


def si_booleano(nombre, expresion, x, y, nid):
    return {"parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
                                          "conditions": [{"id": nid + "-c", "leftValue": expresion, "rightValue": "",
                                                          "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                                          "combinator": "and"}, "options": {}},
            "id": nid, "name": nombre, "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [x, y]}


def claude(x, y):
    auth = {"authentication": "none"} if MOCK else {"authentication": "predefinedCredentialType", "nodeCredentialType": "anthropicApi"}
    n = {"parameters": {"method": "POST", "url": (MOCK + "/v1/messages") if MOCK else "https://api.anthropic.com/v1/messages", **auth,
                        "sendHeaders": True, "headerParameters": {"parameters": [{"name": "anthropic-version", "value": "2023-06-01"}, {"name": "content-type", "value": "application/json"}]},
                        "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($('Calcular inventario').first().json.claude_body) }}", "options": {"timeout": 90000}},
         "credentials": {"anthropicApi": ANTHROPIC_CREDENTIAL}, "retryOnFail": True, "maxTries": 2, "waitBetweenTries": 3000,
         "onError": "continueRegularOutput", "id": "n-claude", "name": "Claude: comentario", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [x, y]}
    if MOCK:
        del n["credentials"]
    return n


nodos = [
    {"parameters": {"rule": {"interval": [{"field": "months", "monthsInterval": 1, "triggerAtDayOfMonth": 1, "triggerAtHour": 8, "triggerAtMinute": 0}]}},
     "id": "schedule-mensual", "name": "Disparador mensual", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, -200]},
    {"parameters": {"options": {}}, "id": "chat-inventario", "name": "Chat de inventario", "type": "@n8n/n8n-nodes-langchain.chatTrigger",
     "typeVersion": 1.1, "position": [0, 0], "webhookId": "gestor-inventarios-chat-test"},
    {"parameters": {}, "id": "prueba-manual", "name": "Prueba manual", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 200]},
    {"parameters": {"jsCode": "return [{ json: { chatInput: " + json.dumps(PRUEBA, ensure_ascii=False) + " } }];"},
     "id": "entrada-prueba", "name": "Entrada de prueba", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 200]},
    nodo_code("Configuracion", "10_config.js", 440, 0, "n-config", LIB),
    {"parameters": {"rules": {"values": [regla("csv"), regla("excel"), regla("sql"), regla("api")]}, "options": {}},
     "id": "n-fuente", "name": "Elegir fuente", "type": "n8n-nodes-base.switch", "typeVersion": 3.2, "position": [660, 0]},
    # CSV
    leer_archivo("Leer CSV de movimientos", "archivo_movimientos", 900, -300, "n-csv-1"),
    extraer("Extraer CSV de movimientos", "csv", None, 1120, -300, "n-csv-2"),
    leer_archivo("Leer CSV de productos", "archivo_productos", 1340, -300, "n-csv-3", una_vez=True, tolerante=True),
    extraer("Extraer CSV de productos", "csv", None, 1560, -300, "n-csv-4", tolerante=True),
    # Excel
    leer_archivo("Leer Excel de movimientos", "archivo_excel", 900, -100, "n-xls-1"),
    extraer("Extraer Excel de movimientos", "xlsx", "hoja_movimientos", 1120, -100, "n-xls-2"),
    leer_archivo("Leer Excel de productos", "archivo_excel", 1340, -100, "n-xls-3", una_vez=True, tolerante=True),
    extraer("Extraer Excel de productos", "xlsx", "hoja_productos", 1560, -100, "n-xls-4", tolerante=True),
    # SQL
    sql("SQL de movimientos", "sql_movimientos", 900, 100, "n-sql-1"),
    sql("SQL de productos", "sql_productos", 1120, 100, "n-sql-2", una_vez=True, tolerante=True),
    # API de un programa
    api("API de movimientos", "api_url_movimientos", 900, 300, "n-api-1"),
    api("API de productos", "api_url_productos", 1120, 300, "n-api-2", una_vez=True, tolerante=True),
    nodo_code("Calcular inventario", "20_calcular.js", 1800, 0, "n-calcular", LIB, MOTOR, INFORME),
    si_booleano("Hay error", "={{ $json.error }}", 2020, 0, "n-if-error"),
    {"parameters": {"jsCode": "return [{ json: { output: 'No se pudo generar el informe de inventario: ' + $json.mensaje } }];"},
     "id": "n-error", "name": "Respuesta de error", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [2240, -160]},
    si_booleano("Usar IA", "={{ $json.cfg.usar_ia }}", 2240, 80, "n-if-ia"),
    claude(2460, -20),
    nodo_code("Armar informe", "30_armar.js", 2680, 80, "n-armar", LIB, INFORME),
    {"parameters": {"operation": "write", "fileName": "={{ $json.ruta }}", "dataPropertyName": "data", "options": {}}, "onError": "continueRegularOutput",
     "id": "n-guardar", "name": "Guardar archivos", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1, "position": [2900, 80]},
    {"parameters": {"jsCode": "return [{ json: { output: $('Armar informe').first().json.output } }];"},
     "id": "n-respuesta", "name": "Respuesta al chat", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [3120, 80]},
]

enlaces = [
    ("Disparador mensual", "Configuracion"), ("Chat de inventario", "Configuracion"), ("Prueba manual", "Entrada de prueba"), ("Entrada de prueba", "Configuracion"),
    ("Configuracion", "Elegir fuente"),
    ("Leer CSV de movimientos", "Extraer CSV de movimientos"), ("Extraer CSV de movimientos", "Leer CSV de productos"), ("Leer CSV de productos", "Extraer CSV de productos"), ("Extraer CSV de productos", "Calcular inventario"),
    ("Leer Excel de movimientos", "Extraer Excel de movimientos"), ("Extraer Excel de movimientos", "Leer Excel de productos"), ("Leer Excel de productos", "Extraer Excel de productos"), ("Extraer Excel de productos", "Calcular inventario"),
    ("SQL de movimientos", "SQL de productos"), ("SQL de productos", "Calcular inventario"),
    ("API de movimientos", "API de productos"), ("API de productos", "Calcular inventario"),
    ("Calcular inventario", "Hay error"),
    ("Claude: comentario", "Armar informe"),
    ("Armar informe", "Guardar archivos"), ("Guardar archivos", "Respuesta al chat"),
]
conexiones = {}
for o, d in enlaces:
    conexiones.setdefault(o, {"main": [[]]})["main"][0].append({"node": d, "type": "main", "index": 0})
# El Switch tiene una salida por fuente; los IF tienen salida 0 = verdadero y 1 = falso
conexiones["Elegir fuente"] = {"main": [[{"node": "Leer CSV de movimientos", "type": "main", "index": 0}], [{"node": "Leer Excel de movimientos", "type": "main", "index": 0}],
                                        [{"node": "SQL de movimientos", "type": "main", "index": 0}], [{"node": "API de movimientos", "type": "main", "index": 0}]]}
conexiones["Hay error"] = {"main": [[{"node": "Respuesta de error", "type": "main", "index": 0}], [{"node": "Usar IA", "type": "main", "index": 0}]]}
conexiones["Usar IA"] = {"main": [[{"node": "Claude: comentario", "type": "main", "index": 0}], [{"node": "Armar informe", "type": "main", "index": 0}]]}

workflow = {
    "name": "Agente Gestor de Inventarios",
    "nodes": nodos,
    "connections": conexiones,
    "pinData": {},
    "active": False,
    "settings": {"executionOrder": "v1", "timezone": "America/Bogota", "executionTimeout": 900, "binaryMode": "separate", "availableInMCP": False},
    "id": "Be8j3flihDvE2tMl",
    "tags": [],
}

salida = BASE / "agente_gestor_inventarios.json"
with open(salida, "w", encoding="utf-8") as f:
    json.dump(workflow, f, ensure_ascii=False, indent=2)
print("OK:", salida, "| nodos:", len(nodos), "| prueba:", PRUEBA)
