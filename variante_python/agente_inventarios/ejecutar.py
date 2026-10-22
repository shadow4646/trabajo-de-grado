"""Orquestacion del agente de inventarios sin n8n: lee la fuente, calcula, redacta el comentario (opcional) y escribe los archivos.

Equivale a la cadena de nodos del prototipo con n8n: Configuracion, Leer fuente, Calcular inventario, Comentario, Armar informe
y Guardar archivos. La configuracion se pasa por un archivo JSON y/o por la linea de comandos.
"""
import json
import os
import re
import time

from .conectores import ErrorFuente, leer_fuente
from .informe import PROMPT_COMENTARIO, armar_informe, limpiar_comentario
from .lenguaje import ErrorLenguaje, ProveedorLenguaje, SinModelo, crear_proveedor
from .motor import calcular_inventario, indicadores
from .normalizar import normalizar
from .util import MESES_ES, hoy_iso, mes_de_indice, mes_indice, norm

CONFIG_DEFECTO = {
    # De donde se leen los movimientos y los productos: 'csv', 'excel', 'sql' o 'api'
    "fuente": "csv",
    "archivo_movimientos": "", "archivo_productos": "", "separador": ",",
    "archivo_excel": "", "hoja_movimientos": "Movimientos", "hoja_productos": "Productos",
    # SQL: la URL de la base va en una variable de entorno (nunca en este archivo)
    "sql_url_env": "INVENTARIOS_SQL_URL", "sql_movimientos": "", "sql_productos": "",
    # API: el token va en una variable de entorno
    "api_url_movimientos": "", "api_url_productos": "", "api_ruta_datos": "", "api_token_env": "INVENTARIOS_API_TOKEN",
    # Si los encabezados no se reconocen solos: {campo_del_agente: 'Nombre de tu columna'}
    "mapeo": {}, "mapeo_productos": {},
    "formato_fecha": "DMY", "por_bodega": False, "moneda": "$",
    # Parametros de la politica de reposicion
    "parametros": {"sector": "general", "R_dias": 30, "lead_time_defecto": 15},
    # Modelo de lenguaje: 'ninguno' (por defecto, no sale ningun dato), 'claude' u 'ollama'
    "proveedor_lenguaje": "ninguno", "modelo": "", "url_modelo": "",
    "carpeta_salida": "informes",
}


def cargar_config(ruta=None, cambios=None):
    cfg = json.loads(json.dumps(CONFIG_DEFECTO))
    if ruta:
        with open(ruta, encoding="utf-8") as f:
            _mezclar(cfg, json.load(f))
    if cambios:
        _mezclar(cfg, cambios)
    return cfg


def _mezclar(base, nuevo):
    for k, v in nuevo.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _mezclar(base[k], v)
        else:
            base[k] = v


def resolver_mes(texto, hoy=None):
    """Mes del informe (AAAA-MM) a partir de un mensaje ('informe de 2026-09', 'septiembre 2026'); si no hay, el mes anterior."""
    hoy = hoy or hoy_iso()
    texto = (texto or "").strip()
    m = re.search(r"([0-9]{4})[-/]([0-9]{1,2})", texto)
    if m and 1 <= int(m.group(2)) <= 12:
        return "%s-%02d" % (m.group(1), int(m.group(2)))
    t = norm(texto)
    idx = next((i for i, n in enumerate(MESES_ES) if re.search(r"(?<![a-z0-9_])%s(?![a-z0-9_])" % n, t)), -1)
    if idx >= 0:
        anio = re.search(r"(?<![A-Za-z0-9_])(20[0-9]{2})(?![A-Za-z0-9_])", texto)
        y = anio.group(1) if anio else mes_de_indice(mes_indice(hoy[:7]) - (12 if idx + 1 > int(hoy[5:7]) else 0))[:4]
        return "%s-%02d" % (y, idx + 1)
    return mes_de_indice(mes_indice(hoy[:7]) - 1)


def armar_entrada_ia(res, ind):
    """Resumen que se le entrega al modelo de lenguaje: conteos, indicadores y las listas mas importantes. Nunca los movimientos."""
    def cob(r):
        c = r.get("cobertura")
        return c if c is not None and c == c and c not in (float("inf"), float("-inf")) else None

    resultados = [{**{k: v for k, v in r.items() if k not in ("meses", "valores")}, "cobertura": cob(r)} for r in res["resultados"]]
    redondeo = lambda x: int(_js_round(x))  # noqa: E731
    urg = sorted([r for r in resultados if r["accion"] == "COMPRAR URGENTE"], key=lambda r: (1e9 if r["cobertura"] is None else r["cobertura"]) - r["L"])
    en_cero = sorted([r for r in resultados if (r.get("dias_en_cero") or 0) > 0], key=lambda r: -r["dias_en_cero"])
    sin_rot = sorted([r for r in resultados if r["accion"] in ("SIN MOVIMIENTO", "NUNCA SE MOVIO")], key=lambda r: -r["valor_stock"])
    rot = ind["rotacion_anual"]
    return {
        "mes": res["ym"], "productos": ind["productos"], "productos_por_accion": ind["cuenta_acciones"],
        "indicadores": {
            "valor_inventario": redondeo(ind["valor_inventario"]), "compra_sugerida": redondeo(ind["compra_total"]), "capital_inmovilizado_stock_muerto": redondeo(ind["valor_muerto"]),
            "capital_en_exceso": redondeo(ind["capital_exceso"]), "rotacion_anual": _js_round(rot * 10) / 10 if rot else None, "productos_en_quiebre": ind["productos_en_quiebre"],
        },
        "urgentes": [{"producto": r["nombre"] or r["sku"], "stock": redondeo(r["stock"]), "cantidad_sugerida": r["cantidad"]} for r in urg[:6]],
        "en_cero_este_mes": [{"producto": r["nombre"] or r["sku"], "dias_en_cero": r["dias_en_cero"], "sigue_en_cero": bool(r.get("quiebre") and r["quiebre"]["sigue"])} for r in en_cero[:5]],
        "sin_rotacion": [{"producto": r["nombre"] or r["sku"], "valor": redondeo(r["valor_stock"])} for r in sin_rot[:5]],
        "advertencias_de_datos": res["avisos"][:3],
    }


def _js_round(x):
    from .util import js_round
    return js_round(x)


def _como_js(obj):
    """Los numeros enteros salen sin decimales (120, no 120.0), como en JSON.stringify de JavaScript. Importa porque el filtro
    de cifras del comentario compara digitos: '120.0' aportaria '1200' en vez de '120'."""
    if isinstance(obj, dict):
        return {k: _como_js(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_como_js(v) for v in obj]
    if isinstance(obj, float) and obj == obj and obj not in (float("inf"), float("-inf")) and obj == int(obj) and abs(obj) < 1e21:
        return int(obj)
    return obj


def entrada_ia_json(entrada):
    return json.dumps(_como_js(entrada), ensure_ascii=False, separators=(",", ":"))


def generar(cfg, proveedor=None, hoy=None, mes=None, mensaje=""):
    """Lee, calcula y arma el informe. Devuelve un diccionario con res, ind, informe, comentario, uso y advertencias.
    Lanza ErrorFuente si no se pudo leer la fuente o no se reconocen las columnas."""
    t0 = time.perf_counter()
    ym = mes or cfg.get("mes") or resolver_mes(mensaje, hoy)
    filas_mov, filas_mae = leer_fuente(cfg)
    if not filas_mov:
        raise ErrorFuente('No se recibieron movimientos de la fuente "%s". Revisa la configuracion: ruta del archivo, consulta SQL o URL de la API.' % cfg.get("fuente"))
    mapeo_mae = cfg.get("mapeo_productos") or cfg.get("mapeo") or {}
    datos = normalizar(filas_mov, filas_mae, {**cfg, "mapeo": cfg.get("mapeo") or {}, "mapeo_maestro": mapeo_mae})
    if "error" in datos:
        raise ErrorFuente(datos["error"])
    res = calcular_inventario(datos, {"mes": ym}, cfg.get("parametros") or {})
    ind = indicadores(res, res["P"])
    ms = round((time.perf_counter() - t0) * 1000)

    proveedor = proveedor if proveedor is not None else crear_proveedor(cfg.get("proveedor_lenguaje"), cfg.get("modelo"), cfg.get("url_modelo"))
    entrada_json = entrada_ia_json(armar_entrada_ia(res, ind))
    comentario, uso, advertencias = "", None, []
    if not isinstance(proveedor, SinModelo):
        try:
            r = proveedor.comentar(PROMPT_COMENTARIO, entrada_json)
            if r:
                comentario = limpiar_comentario(r["texto"], entrada_json)
                uso = {"llamadas": 1, "entrada": r["entrada"], "salida": r["salida"], "costo": r["costo"]}
        except ErrorLenguaje as e:
            advertencias.append("No se pudo obtener el comentario del modelo de lenguaje (%s). El informe se genero sin comentario." % e)
    informe = armar_informe(res, ind, {"fuente": cfg.get("fuente") or "csv", "moneda": cfg.get("moneda") or "$"}, comentario, uso, ms, getattr(proveedor, "modelo", ""))
    return {"res": res, "ind": ind, "informe": informe, "comentario": comentario, "uso": uso, "advertencias": advertencias, "mes": ym, "ms": ms}


def escribir_archivos(resultado, carpeta):
    """Escribe el informe (HTML y Markdown) y los dos CSV. Devuelve las rutas."""
    os.makedirs(carpeta, exist_ok=True)
    base = os.path.join(carpeta, "inventario_%s" % resultado["mes"])
    inf = resultado["informe"]
    rutas = {"html": base + ".html", "md": base + ".md", "pedido": base + "_pedido.csv", "detalle": base + "_detalle.csv"}
    for clave, contenido in (("html", inf["html"]), ("md", inf["md"]), ("pedido", inf["csvPedido"]), ("detalle", inf["csvDetalle"])):
        with open(rutas[clave], "w", encoding="utf-8", newline="") as f:
            f.write(contenido)
    return rutas


def ejecutar(cfg, proveedor=None, hoy=None, mes=None, mensaje=""):
    """generar + escribir_archivos. Devuelve el resultado con 'archivos' y 'chat' (respuesta corta con las rutas)."""
    r = generar(cfg, proveedor, hoy, mes, mensaje)
    r["archivos"] = escribir_archivos(r, cfg.get("carpeta_salida") or "informes")
    base = os.path.splitext(r["archivos"]["html"])[0]
    r["chat"] = "%s\n\nInforme completo (tablas, indicadores y supuestos): %s.html\nPedido sugerido para Excel: %s_pedido.csv" % (r["informe"]["chat"], base, base)
    return r
