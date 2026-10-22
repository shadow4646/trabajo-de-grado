"""Utilidades compartidas: texto, numeros y fechas.

Replican el comportamiento de la biblioteca de JavaScript del prototipo con n8n (n8n_agentes/inventarios_js/00_lib.js)
para que las dos variantes den los mismos resultados. Donde Python y JavaScript difieren (redondeo, formato de numeros,
sumas, fechas fuera de rango) se implementa aqui el comportamiento de JavaScript y se explica por que.
"""
import math
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

NAN = float("nan")


# ---------- numeros: formato y redondeo como JavaScript ----------
def js_round(x):
    """Math.round de JavaScript: redondea .5 hacia +infinito. round() de Python redondea al par (2.5 da 2)."""
    if not math.isfinite(x):
        return x
    r = math.floor(x)
    return r + 1 if x - r >= 0.5 else r


def js_str(x):
    """String(numero) de JavaScript: 5.0 da '5', no '5.0'; los exponentes no llevan ceros a la izquierda."""
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, int):
        return str(x)
    if isinstance(x, Decimal):
        x = float(x)
    if x is None:
        return "null"
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    if x == int(x) and abs(x) < 1e21:
        return str(int(x))
    s = repr(float(x))
    return re.sub(r"e([+-])0*([0-9])", r"e\1\2", s)


def js_to_fixed(x, decimales):
    """Number.prototype.toFixed: con un empate exacto elige el valor mayor (en magnitud). format() de Python elige el par."""
    if math.isnan(x) or math.isinf(x):
        return js_str(x)
    q = Decimal(1).scaleb(-decimales)
    return format(Decimal(x).quantize(q, rounding=ROUND_HALF_UP), "f")


def texto(v):
    """String(v ?? '') de JavaScript."""
    if v is None:
        return ""
    if isinstance(v, (bool, int, float, Decimal)):
        return js_str(v)
    return str(v)


def suma(a):
    """Suma de izquierda a derecha. sum() de Python (3.12 o mas) compensa el error y da resultados distintos a los de JavaScript."""
    s = 0
    for x in a:
        s += x
    return s


def media(a):
    return suma(a) / len(a) if len(a) else 0


def desv_muestral(a):
    if len(a) < 2:
        return 0
    m = media(a)
    return math.sqrt(suma([(x - m) * (x - m) for x in a]) / (len(a) - 1))


def es_finito(x):
    return isinstance(x, (int, float, Decimal)) and not isinstance(x, bool) and math.isfinite(x)


# ---------- texto ----------
_PALABRAS_VACIAS = re.compile(r"(?<![A-Za-z0-9_])(?:de|del|la|el|los|las|en|por)(?![A-Za-z0-9_])")


def norm(s):
    t = unicodedata.normalize("NFD", texto(s))
    t = re.sub("[\u0300-\u036f]", "", t).lower()
    return re.sub(r"\s+", " ", t).strip()


def clave(s):
    return re.sub(r"[^a-z0-9]", "", _PALABRAS_VACIAS.sub("", norm(s)))


def esc(t):
    return texto(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def sin_guiones(t):
    return re.sub("\\s*[\u2014\u2013]\\s*", ", ", texto(t))


def celda(t):
    return texto(t).replace("|", "/").replace("\n", " ")


def miles(n):
    s = js_str(js_round(n))
    return re.sub(r"(?<=[0-9])(?=(?:[0-9]{3})+(?![0-9]))", ".", s)


# ---------- fechas: dias enteros desde 1970-01-01, en UTC y sin depender de la zona horaria ----------
MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _dias_desde_civil(y, m, d):
    """Dias desde 1970-01-01 de la fecha y-m-d. Admite meses y dias fuera de rango y los desborda como Date.UTC de JavaScript
    (el 30 de febrero pasa al 2 de marzo)."""
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    y2 = y - (1 if m <= 2 else 0)
    era = y2 // 400
    yoe = y2 - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def dia_num(iso):
    m = re.match(r"([0-9]{4})-([0-9]{2})-([0-9]{2})", iso)
    return _dias_desde_civil(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def iso_de(n):
    z = int(n) + 719468
    era = z // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + 3 if mp < 10 else mp - 9
    if m <= 2:
        y += 1
    return "%04d-%02d-%02d" % (y, m, d)


def mes_de_dia(n):
    return iso_de(n)[:7]


def mes_indice(ym):
    y, m = ym.split("-")
    return int(y) * 12 + int(m) - 1


def mes_de_indice(i):
    return "%d-%02d" % (i // 12, i % 12 + 1)


def dias_del_mes(ym):
    y, m = (int(p) for p in ym.split("-"))
    return _dias_desde_civil(y, m + 1, 1) - _dias_desde_civil(y, m, 1)


def primer_dia_mes(ym):
    return dia_num(ym + "-01")


def ultimo_dia_mes(ym):
    return primer_dia_mes(ym) + dias_del_mes(ym) - 1


def hoy_iso():
    """Fecha de hoy en Bogota (UTC-5 todo el ano, sin horario de verano), sin necesitar la base de zonas horarias del sistema."""
    return datetime.now(timezone(timedelta(hours=-5))).strftime("%Y-%m-%d")


def parsear_fecha(v, formato=None):
    """Devuelve {'dia', 'mensual'} o None. Acepta ISO, AAAA/MM/DD, DD/MM/AAAA (o MM/DD/AAAA si se pide), AAAA-MM,
    numeros de serie de Excel y objetos fecha."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return {"dia": _dias_desde_civil(v.year, v.month, v.day), "mensual": False}
    if isinstance(v, date):
        return {"dia": _dias_desde_civil(v.year, v.month, v.day), "mensual": False}
    if isinstance(v, (int, float, Decimal)) and not isinstance(v, bool):
        return {"dia": math.floor(v) - 25569, "mensual": False} if 20000 < v < 80000 else None
    s = texto(v).strip()
    m = re.match(r"([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})", s) or re.match(r"([0-9]{4})/([0-9]{1,2})/([0-9]{1,2})", s)
    if m:
        return {"dia": _dias_desde_civil(int(m.group(1)), int(m.group(2)), int(m.group(3))), "mensual": False}
    m = re.match(r"([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})", s)
    if m:
        d, mm = int(m.group(1)), int(m.group(2))
        if formato == "MDY" or (mm > 12 and d <= 12):
            d, mm = mm, d
        if mm < 1 or mm > 12 or d < 1 or d > 31:
            return None
        return {"dia": _dias_desde_civil(int(m.group(3)), mm, d), "mensual": False}
    m = re.fullmatch(r"([0-9]{4})-([0-9]{2})", s)
    if m:
        return {"dia": _dias_desde_civil(int(m.group(1)), int(m.group(2)), 15), "mensual": True}
    if re.fullmatch(r"[0-9]{5}(\.[0-9]+)?", s):
        return parsear_fecha(float(s), formato)
    return None


# ---------- numeros en formato latino (1.234,56) o ingles (1,234.56) ----------
_NUMERO_JS = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")


def parsear_numero(v):
    """Devuelve el numero o NaN. float() de Python acepta '1_000', 'inf' y 'nan'; aqui solo se aceptan numeros normales."""
    if isinstance(v, bool):
        return NAN
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (int, float)):
        return v
    if v is None:
        return NAN
    s = re.sub(r"[\s$\u20ac\u00a3]", "", str(v).strip())
    if s == "" or s == "-":
        return NAN
    neg = bool(re.fullmatch(r"\(.*\)", s))
    s = re.sub(r"^\(|\)$", "", s)
    punto = s.rfind(".")
    coma = s.rfind(",")
    if punto >= 0 and coma >= 0:
        s = s.replace(",", "") if punto > coma else s.replace(".", "").replace(",", ".", 1)
    elif coma >= 0:
        s = s.replace(",", ".", 1) if re.search(r",[0-9]{1,2}$", s) and s.count(",") == 1 else s.replace(",", "")
    elif punto >= 0 and re.fullmatch(r"-?[0-9]{1,3}(\.[0-9]{3})+", s):
        s = s.replace(".", "")
    if not _NUMERO_JS.fullmatch(s):
        return NAN
    n = float(s)
    if not math.isfinite(n):
        return NAN
    return -n if neg else n
