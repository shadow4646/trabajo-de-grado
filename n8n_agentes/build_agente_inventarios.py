# -*- coding: utf-8 -*-
"""Construye el workflow de n8n "Agente Gestor de Inventarios" como JSON importable."""
import json

CSV_PATH = r"C:\Users\monca\.n8n-files\inventario_historico.csv"

SYSTEM_PROMPT = """Eres un gerente de inventarios experto, con el nivel de un profesional certificado en gestion de cadena de suministro (APICS/ASCM). Tu trabajo es analizar el historial de consumo mensual de los productos de una empresa (de cualquier tamano, desde una PYME hasta una gran empresa) y redactar un informe mensual de rotacion de inventario con recomendaciones de compra que eviten tanto el sobrestock como el quiebre de stock.

DATOS QUE RECIBES
Recibiras, por cada producto, datos ya precalculados: meses de historial, consumo promedio mensual, desviacion del consumo, stock actual, lead time en dias, punto de reorden, stock de seguridad, accion recomendada (COMPRAR o NO COMPRAR AHORA, que depende de si el stock esta en o bajo el punto de reorden), cantidad sugerida de compra, rotacion anual estimada, valor de consumo anual, clase ABC, y meses consecutivos sin movimiento. No inventes ni recalcules estos numeros: tu trabajo es interpretarlos con criterio profesional y redactar las recomendaciones finales en lenguaje claro. La fecha actual y el periodo analizado te llegan en el mensaje del usuario: usalos tal cual y nunca inventes una fecha.

LIMITES DE LOS CALCULOS QUE DEBES DECLARAR EN EL INFORME: el pronostico es un promedio simple de los meses disponibles, el stock de seguridad usa un nivel de servicio unico del 95% y no modela variabilidad del lead time ni ordenes en transito, y la clasificacion ABC con pocos productos es solo orientativa. Mencionalo en una linea al final del informe.

CRITERIOS QUE DEBES APLICAR AL INTERPRETAR Y RECOMENDAR

1. Clasificacion ABC: los productos clase A (mayor valor de consumo acumulado) necesitan seguimiento mas cercano y menor margen de error en la recomendacion; los de clase C toleran reglas mas simples y un stock de seguridad mas generoso sin que eso sea un problema.

2. Rotacion de inventario: compara la rotacion anual estimada de cada producto contra rangos tipicos orientativos (alimentos o insumos de alta rotacion: 10-18+ veces al ano; manufactura general: 4-8; distribucion o bienes de bajo movimiento: 2-6). Si la rotacion esta muy por debajo de lo esperable para ese tipo de producto, es senal de sobrestock: recomienda reducir o incluso pausar la proxima compra. Si esta muy por encima, no lo celebres automaticamente, podria indicar quiebres de stock frecuentes.

3. Punto de reorden y stock de seguridad: si el stock actual ya esta por debajo del punto de reorden, marca el producto como prioritario para compra inmediata. Explica siempre el trade-off entre stock de seguridad (menor riesgo de quiebre, mas capital inmovilizado) en terminos simples cuando sea relevante para la decision.

4. Confianza del dato: con menos de 6 meses de historial, aclara explicitamente que el pronostico es preliminar y tiene menor confiabilidad. Con 12 o mas meses, puedes hablar con mas seguridad de patrones y tendencias.

5. Demanda intermitente: si un producto tiene varios meses consecutivos en cero consumo, no lo trates como un producto de rotacion normal; senala que su patron es esporadico y que la cantidad sugerida calculada con formulas estandar puede no ser confiable para el.

6. Stock muerto: si un producto lleva 3 o mas meses consecutivos sin ningun consumo y mantiene stock, senalalo explicitamente como candidato a liquidar o descontinuar, independientemente de su clase ABC.

7. Ajusta el nivel de detalle a lo que la empresa necesita: si hay pocos productos, se directo y conciso; si hay muchos, organiza el informe por clase ABC para que el lector priorice.

FORMATO DE INFORME OBLIGATORIO (sin emojis, sin simbolos decorativos)

INFORME DE ROTACION DE INVENTARIO
Periodo analizado: [periodo recibido en los datos]
Fecha de generacion: [fecha actual recibida en el mensaje]

RESUMEN EJECUTIVO
[2 a 4 frases con el estado general del inventario y las alertas mas importantes del mes]

PRODUCTOS CLASE A (alto valor, seguimiento prioritario)
[para cada producto: nombre, rotacion anual estimada, stock actual, punto de reorden, cantidad sugerida de compra, justificacion breve de 1-2 lineas]

PRODUCTOS CLASE B
[mismo formato, puede ser mas breve]

PRODUCTOS CLASE C
[mismo formato, puede ser mas breve]

ALERTAS
Riesgo de quiebre de stock: [productos con stock por debajo del punto de reorden]
Riesgo de sobrestock: [productos con rotacion muy por debajo de lo esperable]
Posible stock muerto: [productos con 3+ meses sin movimiento]

RECOMENDACION GENERAL DEL MES
[resumen ejecutivo de 3 a 5 lineas con las compras prioritarias del mes y el motivo principal]
"""

CODE_JS = r"""const rows = $input.all().map(item => item.json);
const porProducto = {};
for (const r of rows) {
  const key = r.producto;
  if (!porProducto[key]) porProducto[key] = [];
  porProducto[key].push(r);
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

const Z_95 = 1.645;
const resultados = [];

for (const producto in porProducto) {
  const historial = porProducto[producto].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const consumos = historial.map(h => Number(h.cantidad_consumida));
  const mesesHistoria = consumos.length;
  const consumoPromedio = mean(consumos);
  const desviacion = mesesHistoria >= 3 ? std(consumos) : 0;
  const ultimo = historial[historial.length - 1];
  const stockActual = Number(ultimo.stock_actual);
  const costoUnitario = Number(ultimo.costo_unitario);
  const leadTimeDias = Number(ultimo.lead_time_dias || 30);
  const leadTimeMeses = leadTimeDias / 30;

  const stockSeguridad = Z_95 * desviacion * Math.sqrt(leadTimeMeses);
  const puntoReorden = (consumoPromedio * leadTimeMeses) + stockSeguridad;
  const debeComprar = stockActual <= puntoReorden;
  const cantidadSugerida = debeComprar
    ? Math.max(0, Math.round((puntoReorden + consumoPromedio) - stockActual))
    : 0;

  const consumoAnualEstimado = consumoPromedio * 12;
  const rotacion = stockActual > 0 ? (consumoAnualEstimado / stockActual) : null;
  const valorConsumoAnual = consumoAnualEstimado * costoUnitario;

  let mesesSinMovimiento = 0;
  for (let i = historial.length - 1; i >= 0; i--) {
    if (Number(historial[i].cantidad_consumida) === 0) mesesSinMovimiento++;
    else break;
  }

  resultados.push({
    producto,
    meses_historia: mesesHistoria,
    consumo_promedio_mensual: Math.round(consumoPromedio * 100) / 100,
    desviacion_consumo: Math.round(desviacion * 100) / 100,
    stock_actual: stockActual,
    lead_time_dias: leadTimeDias,
    punto_reorden: Math.round(puntoReorden),
    stock_seguridad: Math.round(stockSeguridad),
    accion_recomendada: debeComprar ? 'COMPRAR (stock en o bajo el punto de reorden)' : 'NO COMPRAR AHORA (stock sobre el punto de reorden)',
    cantidad_sugerida_compra: cantidadSugerida,
    rotacion_anual_estimada: rotacion !== null ? Math.round(rotacion * 100) / 100 : null,
    valor_consumo_anual: Math.round(valorConsumoAnual),
    meses_consecutivos_sin_movimiento: mesesSinMovimiento,
  });
}

resultados.sort((a, b) => b.valor_consumo_anual - a.valor_consumo_anual);
const totalValor = resultados.reduce((s, r) => s + r.valor_consumo_anual, 0);
let acumuladoPrevio = 0;
for (const r of resultados) {
  const pctPrevio = totalValor > 0 ? (acumuladoPrevio / totalValor) * 100 : 0;
  r.clase_abc = pctPrevio < 80 ? 'A' : (pctPrevio < 95 ? 'B' : 'C');
  acumuladoPrevio += r.valor_consumo_anual;
}

return [{ json: { fecha_analisis: $now.toFormat('yyyy-MM'), productos: resultados } }];
"""

REVIEWER_SYSTEM_PROMPT = """Eres un auditor de calidad para recomendaciones de inventario generadas por otro agente de IA. Revisa el informe generado y los datos que lo sustentan, aplicando los mismos criterios profesionales de gestion de inventarios: clasificacion ABC, rotacion esperada segun el tipo de producto, coherencia entre stock actual, punto de reorden y cantidad sugerida de compra, deteccion correcta de demanda intermitente y de posible stock muerto.

Se critico, no un aprobador automatico. Si algo no cuadra (por ejemplo, una cantidad sugerida de compra alta para un producto de rotacion muy baja, o un producto con varios meses sin consumo al que se le sugiere comprar mas sin justificacion), senalalo explicitamente con el motivo.

Formato de salida obligatorio (sin emojis, sin simbolos decorativos):

REVISION DE CALIDAD (Agente Revisor)
Fecha: [fecha actual recibida en el mensaje]
Veredicto: [APROBADO / APROBADO CON OBSERVACIONES / REQUIERE REVISION]
Observaciones: [lista breve y concreta; si no hay ninguna, escribe "Sin observaciones, el informe es coherente con los datos y los criterios de gestion de inventarios."]

Verifica ademas que el informe respete la accion recomendada de los datos (si un producto dice NO COMPRAR AHORA, el informe no debe sugerirle compra) y que las cifras del informe coincidan con los datos calculados.
"""

MERGE_CODE_JS = r"""const original = $('Agente IA Gestor de Inventarios').first().json.output;
const revision = $json.output;
const noAprobado = /REQUIERE REVISION/i.test(revision);
const aviso = noAprobado
  ? 'ADVERTENCIA: el revisor automatico marco este informe como REQUIERE REVISION. No usarlo para decidir compras sin verificarlo.\n\n'
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

ANTHROPIC_CREDENTIAL = {"id": "TinZ1eTTiTSbGGTS", "name": "Anthropic account"}

workflow = {
    "name": "Agente Gestor de Inventarios",
    "nodes": [
        {
            "parameters": {
                "rule": {
                    "interval": [
                        {"field": "months", "monthsInterval": 1, "triggerAtDayOfMonth": 1, "triggerAtHour": 8, "triggerAtMinute": 0}
                    ]
                }
            },
            "id": "schedule-mensual",
            "name": "Disparador Mensual",
            "type": "n8n-nodes-base.scheduleTrigger",
            "typeVersion": 1.2,
            "position": [240, -160],
        },
        {
            "parameters": {"options": {}},
            "id": "chat-trigger-test",
            "name": "Chat de Prueba",
            "type": "@n8n/n8n-nodes-langchain.chatTrigger",
            "typeVersion": 1.1,
            "position": [240, 64],
            "webhookId": "gestor-inventarios-chat-test",
        },
        {
            "parameters": {
                "operation": "read",
                "fileSelector": CSV_PATH,
                "options": {},
            },
            "id": "leer-csv",
            "name": "Leer Historial CSV",
            "type": "n8n-nodes-base.readWriteFile",
            "typeVersion": 1,
            "position": [512, -48],
        },
        {
            "parameters": {
                "operation": "fromCsv",
                "options": {},
            },
            "id": "extraer-csv",
            "name": "Extraer Datos CSV",
            "type": "n8n-nodes-base.extractFromFile",
            "typeVersion": 1,
            "position": [736, -48],
        },
        {
            "parameters": {"jsCode": CODE_JS},
            "id": "calcular-rotacion",
            "name": "Calcular Rotacion y Recomendaciones",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [960, -48],
        },
        {
            "parameters": {
                "promptType": "define",
                "text": "=Fecha actual: {{ $now.toFormat('yyyy-MM-dd') }}\n\nAnaliza estos datos de inventario y genera el informe mensual:\n\n{{ JSON.stringify($json) }}",
                "options": {"systemMessage": SYSTEM_PROMPT},
            },
            "retryOnFail": True,
            "maxTries": 2,
            "waitBetweenTries": 3000,
            "id": "agente-inventarios",
            "name": "Agente IA Gestor de Inventarios",
            "type": "@n8n/n8n-nodes-langchain.agent",
            "typeVersion": 2,
            "position": [1184, -48],
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
            "id": "llm-inventarios",
            "name": "Claude (Gestor Inventarios)",
            "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic",
            "typeVersion": 1.3,
            "position": [1184, 128],
            "credentials": {"anthropicApi": ANTHROPIC_CREDENTIAL},
        },
        {
            "parameters": {
                "promptType": "define",
                "text": "=Fecha actual: {{ $now.toFormat('yyyy-MM-dd') }}\n\nDATOS CALCULADOS QUE SUSTENTAN EL INFORME:\n{{ JSON.stringify($('Calcular Rotacion y Recomendaciones').first().json) }}\n\nINFORME A REVISAR:\n{{ $json.output }}",
                "options": {"systemMessage": REVIEWER_SYSTEM_PROMPT},
            },
            "retryOnFail": True,
            "maxTries": 2,
            "waitBetweenTries": 3000,
            "id": "agente-revisor-inventarios",
            "name": "Agente Revisor Inventarios",
            "type": "@n8n/n8n-nodes-langchain.agent",
            "typeVersion": 2,
            "position": [1408, -48],
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
            "id": "llm-revisor-inventarios",
            "name": "Claude (Revisor Inventarios)",
            "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic",
            "typeVersion": 1.3,
            "position": [1408, 128],
            "credentials": {"anthropicApi": ANTHROPIC_CREDENTIAL},
        },
        {
            "parameters": {"jsCode": MERGE_CODE_JS},
            "id": "combinar-informe-revision",
            "name": "Combinar Informe y Revision",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [1632, -48],
        },
        {
            "parameters": {"jsCode": HTML_CODE_JS},
            "id": "html-wrap",
            "name": "Code in JavaScript",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [1856, -48],
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
            "id": "pdfshift-request",
            "name": "Generar PDF del Informe",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.4,
            "position": [2080, -48],
        },
    ],
    "connections": {
        "Disparador Mensual": {"main": [[{"node": "Leer Historial CSV", "type": "main", "index": 0}]]},
        "Chat de Prueba": {"main": [[{"node": "Leer Historial CSV", "type": "main", "index": 0}]]},
        "Leer Historial CSV": {"main": [[{"node": "Extraer Datos CSV", "type": "main", "index": 0}]]},
        "Extraer Datos CSV": {"main": [[{"node": "Calcular Rotacion y Recomendaciones", "type": "main", "index": 0}]]},
        "Calcular Rotacion y Recomendaciones": {"main": [[{"node": "Agente IA Gestor de Inventarios", "type": "main", "index": 0}]]},
        "Claude (Gestor Inventarios)": {"ai_languageModel": [[{"node": "Agente IA Gestor de Inventarios", "type": "ai_languageModel", "index": 0}]]},
        "Agente IA Gestor de Inventarios": {"main": [[{"node": "Agente Revisor Inventarios", "type": "main", "index": 0}]]},
        "Claude (Revisor Inventarios)": {"ai_languageModel": [[{"node": "Agente Revisor Inventarios", "type": "ai_languageModel", "index": 0}]]},
        "Agente Revisor Inventarios": {"main": [[{"node": "Combinar Informe y Revision", "type": "main", "index": 0}]]},
        "Combinar Informe y Revision": {"main": [[{"node": "Code in JavaScript", "type": "main", "index": 0}]]},
        "Code in JavaScript": {"main": [[{"node": "Generar PDF del Informe", "type": "main", "index": 0}]]},
    },
    "settings": {"executionOrder": "v1", "timezone": "America/Bogota"},
    "active": False,
    "id": "Be8j3flihDvE2tMl",
}

OUT = r"C:\Users\monca\Documents\Proyectos\Trabajo de grados\n8n_agentes\agente_gestor_inventarios.json"
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(workflow, f, ensure_ascii=False, indent=2)
print("OK:", OUT)
