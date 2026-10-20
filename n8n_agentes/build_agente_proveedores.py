# -*- coding: utf-8 -*-
"""Genera el workflow de n8n "Agente Cotizador de Proveedores" (pipeline de busqueda rapida y profunda).

Embudo: el codigo (gratis) hace la parte ancha (consultas, clasificacion, lectura de paginas, verificacion,
ranking, borrador de RFQ) y Claude solo interviene en 3 puntos: interpretar la solicitud, extraer datos de
cada finalista y redactar la narrativa. Cada nodo Code vive en busqueda_js/ (se prueba en local con
busqueda_js/test_local.js) y aqui se le antepone la biblioteca comun.

Uso: python build_agente_proveedores.py [--prueba "texto de la solicitud de prueba"]
"""
import json
import pathlib
import sys

BASE = pathlib.Path(__file__).parent
JS = BASE / "busqueda_js"
LIB = (JS / "00_lib.js").read_text(encoding="utf-8")

PRUEBA = "rapida: harina de trigo panadera, 5 toneladas por pedido, 60 toneladas al ano, destino Bogota, Colombia, al por mayor, con registro INVIMA"
if "--prueba" in sys.argv:
    PRUEBA = sys.argv[sys.argv.index("--prueba") + 1]

MOCK = sys.argv[sys.argv.index("--mock") + 1] if "--mock" in sys.argv else None  # solo para pruebas, ver busqueda_js/mock_claude.js

ANTHROPIC_CREDENTIAL = {"id": "CcTGzJyAkcsKjXNE", "name": "Anthropic account"}


def codigo(archivo):
    return LIB + "\n" + (JS / archivo).read_text(encoding="utf-8")


def nodo_code(nombre, archivo, x, y, nid):
    return {
        "parameters": {"jsCode": codigo(archivo)},
        "id": nid, "name": nombre, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x, y],
    }


def nodo_claude(nombre, x, y, nid, lote=None):
    opciones = {"timeout": 120000}
    if lote:
        opciones["batching"] = {"batch": {"batchSize": lote, "batchInterval": 300}}
    auth = {"authentication": "none"} if MOCK else {"authentication": "predefinedCredentialType", "nodeCredentialType": "anthropicApi"}
    nodo = {
        "parameters": {
            "method": "POST",
            "url": (MOCK + "/v1/messages") if MOCK else "https://api.anthropic.com/v1/messages",
            **auth,
            "sendHeaders": True,
            "headerParameters": {"parameters": [
                {"name": "anthropic-version", "value": "2023-06-01"},
                {"name": "content-type", "value": "application/json"},
            ]},
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": "={{ JSON.stringify($json.claude_body) }}",
            "options": opciones,
        },
        "credentials": {"anthropicApi": ANTHROPIC_CREDENTIAL},
        "retryOnFail": True, "maxTries": 2, "waitBetweenTries": 3000,
        "onError": "continueRegularOutput",
        "id": nid, "name": nombre, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [x, y],
    }
    if MOCK:
        del nodo["credentials"]
    return nodo


def enlace(origen, destino, indice_salida=0):
    return (origen, indice_salida, destino)


nodos = [
    {
        "parameters": {"options": {}},
        "id": "457d5e20-8cb0-4c1d-a76e-0446cb9d98a0", "name": "Chat de busqueda",
        "type": "@n8n/n8n-nodes-langchain.chatTrigger", "typeVersion": 1.1, "position": [0, 0],
        "webhookId": "8cbfa6b5-73d4-4772-86ff-dd838447bd7b",
    },
    {
        "parameters": {}, "id": "prueba-manual", "name": "Prueba manual",
        "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 200],
    },
    {
        "parameters": {"jsCode": "return [{ json: { chatInput: " + json.dumps(PRUEBA, ensure_ascii=False) + " } }];"},
        "id": "entrada-prueba", "name": "Entrada de prueba", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 200],
    },
    nodo_code("Preparar solicitud", "01_preparar.js", 440, 0, "n-preparar"),
    nodo_claude("Claude: interpretar", 660, 0, "n-claude-interpretar"),
    nodo_code("Armar plan", "02_plan.js", 880, 0, "n-plan"),
    {
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
                "conditions": [{
                    "id": "falta-producto", "leftValue": "={{ $json.falta_producto }}", "rightValue": "",
                    "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                }],
                "combinator": "and",
            },
            "options": {},
        },
        "id": "n-if-falta", "name": "Falta el producto", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [1100, 0],
    },
    nodo_code("Pedir datos", "09_pedir_datos.js", 1320, -180, "n-pedir"),
    nodo_code("Ejecutar busquedas", "03_buscar.js", 1320, 0, "n-buscar"),
    nodo_code("Clasificar y puntuar", "04_clasificar.js", 1540, 0, "n-clasificar"),
    nodo_code("Leer paginas", "05_leer.js", 1760, 0, "n-leer"),
    nodo_code("Preparar extracciones", "06_preparar_extraccion.js", 1980, 0, "n-prep-extraccion"),
    nodo_claude("Claude: extraer datos", 2200, 0, "n-claude-extraer", lote=3),
    nodo_code("Verificar y calificar", "07_verificar.js", 2420, 0, "n-verificar"),
    nodo_claude("Claude: redactar informe", 2640, 0, "n-claude-informe"),
    nodo_code("Armar informe", "08_informe.js", 2860, 0, "n-informe"),
    {
        "parameters": {"operation": "write", "fileName": "={{ $json.ruta }}", "dataPropertyName": "data", "options": {}},
        "onError": "continueRegularOutput",
        "id": "n-guardar", "name": "Guardar archivos", "type": "n8n-nodes-base.readWriteFile", "typeVersion": 1, "position": [3080, 0],
    },
    {
        "parameters": {"jsCode": "return [{ json: { output: $('Armar informe').first().json.output } }];"},
        "id": "n-respuesta", "name": "Respuesta al chat", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [3300, 0],
    },
]

cadena = [
    ("Chat de busqueda", "Preparar solicitud"),
    ("Prueba manual", "Entrada de prueba"),
    ("Entrada de prueba", "Preparar solicitud"),
    ("Preparar solicitud", "Claude: interpretar"),
    ("Claude: interpretar", "Armar plan"),
    ("Armar plan", "Falta el producto"),
    ("Ejecutar busquedas", "Clasificar y puntuar"),
    ("Clasificar y puntuar", "Leer paginas"),
    ("Leer paginas", "Preparar extracciones"),
    ("Preparar extracciones", "Claude: extraer datos"),
    ("Claude: extraer datos", "Verificar y calificar"),
    ("Verificar y calificar", "Claude: redactar informe"),
    ("Claude: redactar informe", "Armar informe"),
    ("Armar informe", "Guardar archivos"),
    ("Guardar archivos", "Respuesta al chat"),
]
conexiones = {}
for o, d in cadena:
    conexiones.setdefault(o, {"main": [[]]})["main"][0].append({"node": d, "type": "main", "index": 0})
# El nodo IF tiene dos salidas: 0 = verdadero (falta el producto), 1 = falso (continuar)
conexiones["Falta el producto"] = {"main": [
    [{"node": "Pedir datos", "type": "main", "index": 0}],
    [{"node": "Ejecutar busquedas", "type": "main", "index": 0}],
]}

workflow = {
    "name": "Agente Cotizador de Proveedores",
    "nodes": nodos,
    "connections": conexiones,
    "pinData": {},
    "active": False,
    "settings": {"executionOrder": "v1", "timezone": "America/Bogota", "executionTimeout": 1200, "binaryMode": "separate", "availableInMCP": False},
    "id": "xW2L40lDsBNxvgBR",
    "tags": [],
}

salida = BASE / "agente_cotizador_proveedores.json"
with open(salida, "w", encoding="utf-8") as f:
    json.dump(workflow, f, ensure_ascii=False, indent=2)
print("OK:", salida, "| nodos:", len(nodos), "| prueba:", PRUEBA[:60])
