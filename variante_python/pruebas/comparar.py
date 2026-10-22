"""Comparacion con tolerancia entre las salidas de referencia de JavaScript y las de Python.

Reglas: los textos y los enteros deben ser identicos; los decimales se comparan con una tolerancia relativa de 1e-9;
Infinity y NaN llegan como null en el JSON de JavaScript; un campo ausente equivale a null (JavaScript omite los undefined).
"""
import math

TOL_REL = 1e-9
TOL_ABS = 1e-9


def a_json(x):
    """Lleva un valor de Python a lo que produciria JSON.stringify en JavaScript."""
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    if isinstance(x, dict):
        return {k: a_json(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [a_json(v) for v in x]
    return x


def comparar(py, js, ruta="", fallos=None, limite=25):
    """Acumula en `fallos` las diferencias (ruta, python, javascript). Devuelve la lista."""
    if fallos is None:
        fallos = []
    if len(fallos) >= limite:
        return fallos
    if isinstance(py, bool) or isinstance(js, bool):
        if py != js:
            fallos.append((ruta, py, js))
        return fallos
    if isinstance(py, dict) or isinstance(js, dict):
        py = py if isinstance(py, dict) else {}
        js = js if isinstance(js, dict) else {}
        for k in list(dict.fromkeys(list(py) + list(js))):
            comparar(py.get(k), js.get(k), "%s.%s" % (ruta, k), fallos, limite)
        return fallos
    if isinstance(py, (list, tuple)) or isinstance(js, (list, tuple)):
        if not isinstance(py, (list, tuple)) or not isinstance(js, (list, tuple)) or len(py) != len(js):
            fallos.append((ruta, "lista de %s" % (len(py) if isinstance(py, (list, tuple)) else py), "lista de %s" % (len(js) if isinstance(js, (list, tuple)) else js)))
            return fallos
        for i, (a, b) in enumerate(zip(py, js)):
            comparar(a, b, "%s[%d]" % (ruta, i), fallos, limite)
        return fallos
    if isinstance(py, (int, float)) and isinstance(js, (int, float)):
        if math.isnan(py) and js is None:
            return fallos
        if py == js:
            return fallos
        if abs(py - js) <= max(TOL_ABS, TOL_REL * max(abs(py), abs(js))):
            return fallos
        fallos.append((ruta, py, js))
        return fallos
    if py != js:
        fallos.append((ruta, py, js))
    return fallos
