"""Generador del informe de inventarios: Markdown, HTML, CSV para Excel y respuesta corta.

Port de n8n_agentes/inventarios_js/02_informe.js. Son funciones puras sobre el resultado del motor. Los textos del informe
van sin tildes, igual que en el prototipo con n8n, para que los dos motores produzcan archivos identicos.
"""
import math
import re

from .util import (
    MESES_ES,
    celda,
    esc,
    iso_de,
    js_round,
    js_str,
    js_to_fixed,
    miles,
    norm,
    sin_guiones,
    texto,
)

INF = math.inf

PROMPT_COMENTARIO = """Eres un ingeniero de inventarios senior que escribe el comentario de un informe mensual para el area de compras. Recibes un JSON ya calculado por codigo: conteos por accion, indicadores y las listas mas importantes.

Reglas estrictas:
- Usa SOLO las cifras y nombres del JSON. No inventes productos, cantidades, valores ni causas. No calcules ni redondees: si citas una cifra, copiala tal cual.
- No cambies ninguna recomendacion ni cantidad: el sistema ya decidio. Tu trabajo es ordenar prioridades y explicar el panorama.
- No nombres ninguna moneda (ni pesos ni dolares): usa solo las cifras. No califiques volumenes como grandes o pequenos ni inventes causas de los quiebres.
- Escribe en espanol, en maximo 150 palabras, en prosa breve (sin tablas ni listas largas), con una sola seccion titulada "## Comentario del analista".
- Cubre: que atender primero y por que, el riesgo principal (quiebres o capital inmovilizado) y una advertencia sobre la confiabilidad de los datos si el JSON la trae.
- No uses guiones largos (el caracter de raya). Usa comas, puntos, dos puntos o parentesis."""


def mes_texto(ym):
    return "%s %s" % (MESES_ES[int(ym[5:7]) - 1], ym[:4])


# ---------- markdown en linea a HTML en una sola pasada ----------
# Texto y URLs se escapan por separado (los textos vienen de archivos ajenos).
_RE_ENLACE = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)|(https?://[^\s<)]+)")
_RE_URL_VALIDA = re.compile(r"https?://[^\s\"'<>`\\]+", re.IGNORECASE)


def _formato(s):
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    return re.sub(r"`([^`]+)`", r"<code>\1</code>", s)


def inline_html(t):
    txt = texto(t)
    partes = []
    ultimo = 0
    for m in _RE_ENLACE.finditer(txt):
        partes.append(_formato(esc(txt[ultimo:m.start()])))
        url = m.group(2) or m.group(3)
        if _RE_URL_VALIDA.fullmatch(url):
            partes.append('<a href="%s" rel="noopener noreferrer">%s</a>' % (esc(url), esc(m.group(1) or url)))
        else:
            partes.append(esc(m.group(0)))
        ultimo = m.end()
    partes.append(_formato(esc(txt[ultimo:])))
    return "".join(partes)


def _md_a_html(txt):
    out = []
    estado = {"lista": False, "tab": False, "primera": True}

    def cerrar():
        if estado["lista"]:
            out.append("</ul>")
            estado["lista"] = False
        if estado["tab"]:
            out.append("</table>")
            estado["tab"] = False
            estado["primera"] = True

    # En JavaScript el punto no coincide con \r ni con los separadores de linea Unicode; se replica con una clase explicita.
    for l in txt.split("\n"):
        if re.fullmatch(r"\|[^\r  ]*\|", l):
            if not estado["tab"]:
                cerrar()
                out.append("<table>")
                estado["tab"] = True
                estado["primera"] = True
            if re.fullmatch(r"\|[-| ]+\|", l):
                continue
            celdas = [re.sub(r"^\s*\|?\s*|\s*\|?\s*$", "", x) for x in l[1:-1].split(" | ")]
            etiqueta = "th" if estado["primera"] else "td"
            out.append("<tr>" + "".join("<%s>%s</%s>" % (etiqueta, inline_html(x), etiqueta) for x in celdas) + "</tr>")
            estado["primera"] = False
            continue
        if re.match(r"\s*- ", l):
            if estado["tab"]:
                cerrar()
            if not estado["lista"]:
                out.append("<ul>")
                estado["lista"] = True
            out.append("<li>" + inline_html(re.sub(r"^\s*- ", "", l, count=1)) + "</li>")
            continue
        cerrar()
        h = re.fullmatch(r"(#{1,3}) ([^\r  ]*)", l)
        if h:
            out.append("<h%d>%s</h%d>" % (len(h.group(1)), inline_html(h.group(2)), len(h.group(1))))
        elif l.startswith("> "):
            out.append("<blockquote>" + inline_html(l[2:]) + "</blockquote>")
        elif l.strip():
            out.append("<p>" + inline_html(l) + "</p>")
    cerrar()
    return "\n".join(out)


# ---------- CSV (separador punto y coma y coma decimal: abre bien en Excel en espanol) ----------
# Los textos vienen del sistema de inventario (nombres, proveedores, motivos). Excel interpreta como formula un texto que
# empiece con = + - @, y no solo al inicio de la celda: si el archivo se abre con otro separador, un texto como
# "Tornillo, =1+1" se parte y la segunda mitad queda al inicio de una celda. Por eso se antepone una comilla simple a CADA
# fragmento que, tras un separador posible (, ; tabulador o salto de linea), empiece con esos caracteres (OWASP, CSV Injection).
# Los numeros no se tocan. Las celdas con coma, punto y coma, comillas o saltos de linea van entre comillas.
_SEPARADORES = re.compile(r"([,;\t\r\n])")


def _es_formula(fragmento):
    """Excel lee como formula un texto que empiece (tras blancos) con = o @, o con + o - seguidos de algo, aunque haya
    espacios entre el operador y lo que sigue ('- 1+1'). Un guion solo es texto. Se incluyen las variantes de ancho completo."""
    t = fragmento.lstrip()
    if not t:
        return False
    if t[0] in "=@＝＠":
        return True
    return t[0] in "+-＋－" and t[1:].strip() != ""


def neutralizar(s):
    partes = _SEPARADORES.split(s)  # fragmento, separador, fragmento, ...
    for i in range(0, len(partes), 2):
        if _es_formula(partes[i]):
            partes[i] = "'" + partes[i]
    return "".join(partes)


def _campo(v):
    es_numero = isinstance(v, (int, float)) and not isinstance(v, bool)
    s = js_str(js_round(v * 100) / 100).replace(".", ",") if es_numero else texto(v)
    if not es_numero:
        s = neutralizar(s)
    if re.search(r'[;,"\n]', s):
        return '"%s"' % s.replace('"', '""')
    return s


def _csv_de(enc, filas):
    return "﻿" + "\r\n".join(";".join(_campo(c) for c in f) for f in [enc] + filas) + "\r\n"


def _orden_pedido(r):
    return (norm(r.get("proveedor") or ""), 0 if r["accion"] == "COMPRAR URGENTE" else 1, r["sku"])


def _cob_clave(r):
    c = r.get("cobertura")
    return 1e9 if c is None else c


def armar_informe(res, ind, cfg, comentario="", uso=None, tiempos=None, modelo=""):
    """Devuelve {md, html, csvPedido, csvDetalle, chat, resumen}."""
    moneda = cfg.get("moneda") or "$"

    def num(x):
        if x is None or (isinstance(x, float) and math.isnan(x)):
            return "-"
        if abs(x) >= 100 or float(x).is_integer():
            return miles(x)
        return js_str(js_round(x * 100) / 100).replace(".", ",")

    def dinero(x):
        return "-" if x is None else "%s %s" % (moneda, miles(x))

    def pct(x):
        return "-" if x is None else js_to_fixed(x * 100, 1).replace(".", ",") + "%"

    def fecha(d):
        return "-" if d is None else iso_de(d)

    def cob(r):
        c = r.get("cobertura")
        return "sin demanda" if c is None or c == INF else miles(c)

    def nombre(r):
        return celda("%s (%s)" % (r["nombre"], r["sku"]) if r.get("nombre") else r["sku"])

    rs = res["resultados"]

    def por(accion):
        return [r for r in rs if r["accion"] == accion]

    urgentes = sorted([r for r in rs if r["accion"] == "COMPRAR URGENTE"], key=lambda r: _cob_clave(r) - r["L"])
    normales = sorted([r for r in rs if r["accion"] == "COMPRAR"], key=_cob_clave)
    en_camino = por("SIN STOCK, PEDIDO EN CAMINO")
    quiebres = sorted([r for r in rs if r.get("quiebre_confiable") and (r.get("dias_en_cero") or 0) > 0], key=lambda r: -r["dias_en_cero"])
    sin_mov = sorted(por("SIN MOVIMIENTO"), key=lambda r: -r["valor_stock"])
    nunca = sorted(por("NUNCA SE MOVIO"), key=lambda r: -r["valor_stock"])
    sobre = sorted(por("SOBRESTOCK"), key=lambda r: -r["exceso_valor"])
    suficientes = sorted([r for r in rs if r["accion"] in ("NO COMPRAR", "SIN DEMANDA")], key=_cob_clave)
    revisar = por("REVISAR DATOS")
    inactivos = por("INACTIVO")
    movidos = sorted([r for r in rs if r["accion"] != "INACTIVO" and (r["salidas_mes"] > 0 or r["entradas_mes"] > 0)], key=lambda r: -(r["salidas_mes"] * r["costo"]))
    a_surtir = urgentes + normales

    def nota(r):
        partes = [
            "en transito: %s%s" % (num(r["transito"]), " (llegada vencida)" if r["transito_vencido"] else "") if r["transito"] > 0 else "",
            "plazo supuesto" if r["plazo_supuesto"] else "",
            "multiplo %s" % num(r["moq"]) if r["moq"] and r["moq"] > 1 else "",
            "confianza baja" if r["confianza"] == "BAJA" else "",
            "confirmar con comercial" if r.get("revisar_manual") else "",
        ]
        return "; ".join(p for p in partes if p)

    L = []

    def tabla(encabezados, filas):
        L.append("| %s |" % " | ".join(encabezados))
        L.append("|%s|" % "|".join("---" for _ in encabezados))
        for f in filas:
            L.append("| %s |" % " | ".join(celda(c) for c in f))
        L.append("")

    LIMITE = 40
    s_ = lambda n: "" if n == 1 else "s"  # noqa: E731
    P = res["P"]

    L.append("# Informe de inventario: %s" % mes_texto(res["ym"]))
    L.append("")
    L.append("Corte al %s | %s productos analizados | Fuente: %s | Politica: revision mensual (R = %s dias), nivel de servicio 98%% / 95%% / 90%% para clase A / B / C" % (
        iso_de(res["corte"]), js_str(ind["productos"]), cfg.get("fuente"), js_str(P["R_dias"])))
    L.append("")

    # ---------- resumen ----------
    L.append("## Resumen del mes")
    L.append("- **Productos analizados:** %s (%s con ventas en los ultimos 12 meses)." % (js_str(ind["productos"]), js_str(ind["productos_con_ventas_12m"])))
    cpc = ind["compra_por_clase"]
    nuevos = ", nuevos %s" % dinero(cpc["N"]) if cpc.get("N") else ""
    camino = " %d sin stock con el pedido ya en camino." % len(en_camino) if en_camino else ""
    L.append("- **Que surtir:** %d producto%s, %d urgente%s. Compra sugerida: **%s** (clase A %s, B %s, C %s%s).%s" % (
        len(a_surtir), s_(len(a_surtir)), len(urgentes), s_(len(urgentes)), dinero(ind["compra_total"]), dinero(cpc.get("A") or 0), dinero(cpc.get("B") or 0), dinero(cpc.get("C") or 0), nuevos, camino))
    siguen = len([r for r in quiebres if r.get("quiebre") and r["quiebre"]["sigue"]])
    sigue_txt = " (%d siguen en cero al corte)" % siguen if quiebres else ""
    perdidas = " Ventas perdidas estimadas: %s (estimacion)." % dinero(ind["ventas_perdidas_valor"]) if ind["ventas_perdidas_valor"] > 0 else ""
    L.append("- **Se quedaron en cero este mes:** %d producto%s%s.%s" % (len(quiebres), s_(len(quiebres)), sigue_txt, perdidas))
    L.append("- **Sin movimiento:** %d; **nunca se movieron:** %d. Capital inmovilizado: **%s** (%s del inventario)." % (len(sin_mov), len(nunca), dinero(ind["valor_muerto"]), pct(ind["pct_muerto"])))
    L.append("- **Sobrestock:** %d producto%s, capital en exceso %s." % (len(sobre), s_(len(sobre)), dinero(ind["capital_exceso"])))
    rot = num(js_round(ind["rotacion_anual"] * 10) / 10) if ind["rotacion_anual"] else "-"
    L.append("- **Inventario:** %s. Rotacion anual %s veces (%s dias de inventario)." % (dinero(ind["valor_inventario"]), rot, miles(ind["dias_inventario"]) if ind["dias_inventario"] else "-"))
    if revisar:
        L.append("- **Revisar datos:** %d producto%s sin stock conocido, no se recomienda compra para ellos." % (len(revisar), s_(len(revisar))))
    L.append("")
    if comentario:
        L.append(comentario)
        L.append("")

    # ---------- que surtir ----------
    L.append("## Que surtir")
    if not a_surtir:
        L.append("Ningun producto necesita compra segun la politica de reposicion.\n")

    def fila_surtir(i, r):
        return [i + 1, nombre(r), "%s%s" % (r["clase"], "/" + r["xyz"] if r.get("xyz") else ""), num(r["stock"]), num(r["salidas_mes"]), cob(r), num(r["L"]),
                "**%s** %s" % (num(r["cantidad"]), r.get("unidad") or ""), dinero(r["valor_compra"]), r.get("proveedor") or "-", nota(r)]

    enc_surtir = ["#", "Producto", "Clase", "Stock", "Salidas del mes", "Cobertura (dias)", "Plazo (dias)", "Cantidad sugerida", "Costo estimado", "Proveedor", "Notas"]
    if urgentes:
        L.append("### Urgente: se quedarian sin stock antes de que llegue un pedido hecho hoy")
        tabla(enc_surtir, [fila_surtir(i, r) for i, r in enumerate(urgentes[:LIMITE])])
        if len(urgentes) > LIMITE:
            L.append("Se muestran %d de %d; la lista completa esta en el archivo de pedido sugerido.\n" % (LIMITE, len(urgentes)))
    if normales:
        L.append("### Para el proximo ciclo: no alcanzaria hasta el siguiente corte")
        tabla(enc_surtir, [fila_surtir(i, r) for i, r in enumerate(normales[:LIMITE])])
        if len(normales) > LIMITE:
            L.append("Se muestran %d de %d; la lista completa esta en el archivo de pedido sugerido.\n" % (LIMITE, len(normales)))
    if en_camino:
        L.append("### Sin stock, con el pedido en camino")
        tabla(["Producto", "En transito", "Notas"], [[nombre(r), num(r["transito"]), "la fecha de llegada ya vencio: confirmar con el proveedor" if r["transito_vencido"] else ""] for r in en_camino])
    if ind["compra_por_proveedor"]:
        L.append("### Compra sugerida por proveedor")
        tabla(["Proveedor", "Costo estimado"], [[p, dinero(v)] for p, v in sorted(ind["compra_por_proveedor"].items(), key=lambda kv: -kv[1])])
    manual = [r for r in a_surtir if r.get("revisar_manual")]
    if manual:
        L.append("> Confirmar con el area comercial antes de pedir (producto de alto valor con demanda erratica): %s.\n" % ", ".join(r["sku"] for r in manual))

    # ---------- quiebres ----------
    L.append("## Se quedaron en cero este mes")
    if not quiebres:
        L.append("Ningun producto con datos confiables llego a cero durante el mes.\n")
    else:
        def fila_quiebre(r):
            q = r.get("quiebre")
            if q and q["sigue"]:
                estado = "sigue en cero"
            else:
                estado = "repuesto%s" % (" (%d episodios)" % q["episodios"] if q and q["episodios"] > 1 else "")
            perdidas_u = "%s unid. (%s)" % (num(r["ventas_perdidas"]), dinero(r["ventas_perdidas"] * r["costo"])) if r["ventas_perdidas"] else "-"
            return [nombre(r), r["dias_en_cero"], fecha(q["desde"] if q else None), fecha(q["hasta"] if q else None), estado, num(r["stock"]), perdidas_u, r["accion"]]
        tabla(["Producto", "Dias en cero", "Desde", "Hasta", "Estado", "Stock al corte", "Ventas perdidas (estimadas)", "Accion"], [fila_quiebre(r) for r in quiebres])
    sin_serie = len([r for r in rs if r["accion"] != "INACTIVO" and not r["quiebre_confiable"] and r["salio_alguna_vez"]])
    if sin_serie:
        L.append("> Productos sin saldo ni stock actual confiables (no se puede decir si llegaron a cero): %d.\n" % sin_serie)

    # ---------- que se movio ----------
    L.append("## Que tanto se movio")
    if not movidos:
        L.append("No hubo movimientos en el mes.\n")
    else:
        def fila_movido(r):
            if r["promedio_3m"] and r["promedio_3m"] >= 5:
                cambio_n = r["demanda_neta_mes"] / r["promedio_3m"] - 1
                cambio = "%s%s" % ("+" if cambio_n >= 0 else "", pct(cambio_n))
            else:
                cambio = "-"
            devueltas = " (menos %s devueltas)" % num(r["devol_mes"]) if r["devol_mes"] else ""
            return [nombre(r), r["clase"], "%s%s" % (num(r["salidas_mes"]), devueltas), cambio, r["dias_con_salida_mes"], num(r["entradas_mes"]),
                    num(r["stock_inicial"]) if r["quiebre_confiable"] else "-", num(r["stock_cierre"]) if r["quiebre_confiable"] else "-", r["pron"]["patron"]]
        tabla(["Producto", "Clase", "Salio en el mes", "Cambio vs ultimos 3 meses", "Dias con salida", "Entro en el mes", "Stock al inicio", "Stock al cierre", "Patron de demanda"],
              [fila_movido(r) for r in movidos[:LIMITE]])
        if len(movidos) > LIMITE:
            L.append("Se muestran %d de %d, ordenados por valor de lo que salio.\n" % (LIMITE, len(movidos)))

    # ---------- sin movimiento ----------
    L.append("## Sin movimiento y nunca se movieron")
    if not sin_mov and not nunca:
        L.append("Ningun producto con stock lleva sin salidas mas tiempo del esperado.\n")
    if sin_mov:
        L.append("### Con stock y sin salidas por mas tiempo del esperado")
        tabla(["Producto", "Stock", "Valor", "Ultima salida", "Dias sin salida", "Umbral (dias)", "Notas"],
              [[nombre(r), num(r["stock"]), dinero(r["valor_stock"]), fecha(r["ultima_salida"]), r["dias_sin_salida"], num(r["umbral_sin_movimiento"]),
                "vendio en este mes el ano pasado: revisar si es estacional antes de liquidar" if r["mismo_mes_anio_anterior"] > 0 else "candidato a liquidar, devolver o dar de baja"] for r in sin_mov])
    if nunca:
        L.append("### Nunca se movieron (sin ninguna salida en el historial leido)")
        tabla(["Producto", "Stock", "Valor", "Notas"], [[nombre(r), num(r["stock"]), dinero(r["valor_stock"]), "sin maestro" if r["sin_maestro"] else "revisar si sigue vigente en el catalogo"] for r in nunca])
    if ind["valor_muerto"] > 0:
        L.append("Capital inmovilizado por antiguedad de la ultima salida:")
        L.append("")
        tabla(["Tramo", "Valor"], [["Sin ventas en el historial" if k == "sin ventas en el historial" else "%s dias" % k, dinero(v)] for k, v in ind["tramos_muerto"].items() if v > 0])

    # ---------- sobrestock y suficientes ----------
    L.append("## Sobrestock: no comprar")
    if not sobre:
        L.append("Ningun producto con demanda supera su nivel maximo de cobertura.\n")
    else:
        tabla(["Producto", "Stock", "Cobertura (dias)", "Maximo aceptado (dias)", "Nivel objetivo", "Excedente (unid.)", "Capital en exceso"],
              [[nombre(r), num(r["stock"]), cob(r), num(r["umbral_cobertura"]), num(r["S"]), num(r["exceso_unidades"]), dinero(r["exceso_valor"])] for r in sobre])
    L.append("## No comprar: stock suficiente")
    if not suficientes:
        L.append("Ninguno.\n")
    else:
        tabla(["Producto", "Stock", "Cobertura (dias)", "Punto de reorden", "Posicion proyectada"], [[nombre(r), num(r["stock"]), cob(r), num(r["rop"]), num(r["proyectada"])] for r in suficientes[:LIMITE]])
    if revisar:
        L.append("## Revisar datos")
        tabla(["Producto", "Motivo"], [[nombre(r), r["motivo"]] for r in revisar])
    if inactivos:
        L.append("%d producto%s marcado%s como inactivo%s en el maestro no se analizan.\n" % (len(inactivos), s_(len(inactivos)), s_(len(inactivos)), s_(len(inactivos))))

    # ---------- indicadores ----------
    pr = ind["pronostico"]
    L.append("## Indicadores del mes")
    if pr["wape"] is not None and pr["wape_ingenuo"] is not None:
        veredicto = ": el pronostico lo supera" if pr["wape"] <= pr["wape_ingenuo"] else ": el pronostico NO lo supera"
    else:
        veredicto = ""
    tabla(["Indicador", "Valor", "Como leerlo"], [
        ["Valor del inventario", dinero(ind["valor_inventario"]), "A costo, al corte"],
        ["Rotacion anual", "%s veces" % num(js_round(ind["rotacion_anual"] * 10) / 10) if ind["rotacion_anual"] else "-", "Costo de lo vendido en 12 meses / inventario promedio. Compara con tu sector: muy baja sugiere sobrestock, muy alta puede esconder quiebres"],
        ["Dias de inventario", miles(ind["dias_inventario"]) if ind["dias_inventario"] else "-", "365 / rotacion"],
        ["Tasa de quiebre", "-" if ind["tasa_quiebre"] is None else "%s (%s productos)" % (pct(ind["tasa_quiebre"]), js_str(ind["productos_en_quiebre"])), "Productos con ventas que llegaron a cero en el mes. Entre 2% y 5% suele ser eficiente; 0% sostenido puede indicar exceso de seguridad"],
        ["Quiebre en clase A", "%s de %s" % (js_str(ind["quiebre_clase_a"]), js_str(ind["productos_clase_a"])) if ind["productos_clase_a"] else "-", "Los productos de mayor valor de consumo"],
        ["Disponibilidad ponderada", "-" if ind["disponibilidad_ponderada"] is None else pct(ind["disponibilidad_ponderada"]), "Dias con stock del mes, ponderados por valor de consumo"],
        ["Stock muerto", "%s (%s)" % (dinero(ind["valor_muerto"]), pct(ind["pct_muerto"])), "Sin movimiento o nunca movido, sobre el valor del inventario"],
        ["Capital en exceso", dinero(ind["capital_exceso"]), "Excedente de los productos en sobrestock"],
        ["Ajustes de inventario del mes", "%s (%s de lo que salio)" % (dinero(ind["ajustes_valor"]), pct(ind["ajustes_pct_salidas"])), "Mermas y diferencias; un porcentaje alto sugiere problemas de control"],
        ["Exactitud del pronostico (3 meses)", "-" if pr["wape"] is None else "error de %s" % pct(pr["wape"]),
         "Se vuelve a pronosticar cada mes con los datos previos y se compara con lo real (%s comparaciones). Sesgo %s; el metodo ingenuo (repetir el mes anterior) da %s%s" % (
             js_str(pr["observaciones"]), "-" if pr["sesgo"] is None else pct(pr["sesgo"]), "-" if pr["wape_ingenuo"] is None else pct(pr["wape_ingenuo"]), veredicto)],
    ])

    # ---------- calidad de datos ----------
    cal = res["calidad"]
    L.append("## Calidad de los datos y supuestos")
    for a in res["avisos"]:
        L.append("- %s" % a)
    descartadas = " Descartados: " + ", ".join("%s por %s" % (js_str(n), k) for k, n in cal["descartadas"].items()) + "." if cal["descartadas"] else ""
    L.append("- Movimientos leidos: %s; usados: %s.%s" % (js_str(cal["filas_movimientos"]), js_str(cal["filas_usadas"]), descartadas))
    if cal["descuadres"]:
        L.append("- Productos con descuadre entre el saldo del kardex y el stock actual del maestro: %d (%s). Conviene revisar el conteo fisico." % (
            len(cal["descuadres"]), ", ".join("%s %s%s" % (d["sku"], "+" if d["diferencia"] > 0 else "", num(d["diferencia"])) for d in cal["descuadres"][:5])))
    if cal["saldo_negativo"]:
        L.append("- Productos con saldo negativo: %d (%s). Se tratan como cero y conviene corregir el registro." % (len(cal["saldo_negativo"]), ", ".join(cal["saldo_negativo"][:5])))
    if cal["sin_ancla"]:
        L.append("- Productos sin saldo por movimiento ni stock actual: %d. No se calculan sus quiebres." % len(cal["sin_ancla"]))
    if cal["plazo_supuesto"]:
        L.append("- Productos sin plazo de entrega en el sistema: %s. Se supuso %s dias." % (js_str(cal["plazo_supuesto"]), js_str(P["lead_time_defecto"])))
    if cal["sin_costo"]:
        L.append("- Productos sin costo: %s. Su valor aparece en cero." % js_str(cal["sin_costo"]))
    L.append("")
    L.append("## Como se calcula")
    L.append("- **Demanda:** salidas netas de devoluciones de clientes. Ajustes, traslados y devoluciones a proveedores no cuentan como demanda. En los meses con dias en cero la demanda se corrige por los dias con stock (tope de 2 veces); si mas de la mitad del mes estuvo en cero se trata como dato faltante.")
    L.append("- **Pronostico:** promedio simple con menos de 3 meses, promedio movil con 3 a 5, suavizado exponencial simple con 6 o mas y Croston con correccion de Syntetos y Boylan si la demanda es intermitente.")
    L.append("- **Reposicion (revision periodica):** se compra si la posicion proyectada al proximo corte (stock mas pedidos en transito, menos la demanda de %s dias) cae bajo el punto de reorden. Se pide hasta el nivel objetivo S = demanda x (plazo + %s dias) + stock de seguridad. Como la revision es mensual, se pide lo que no alcanzaria hasta el siguiente corte." % (js_str(P["R_dias"]), js_str(P["R_dias"])))
    L.append("- **Stock de seguridad:** Z x desviacion estandar mensual x raiz((plazo + revision) / 30), con desviacion del plazo si el maestro la trae. Con menos de 6 meses se usa demanda maxima menos promedio. Nivel de servicio: A 98%, B 95%, C 90%.")
    sector = P["cobertura_maxima_sector"].get(P["sector"]) or P["cobertura_maxima_sector"]["general"]
    L.append("- **Sin movimiento:** sin salidas por mas de max(%s dias, 3 veces el intervalo normal entre salidas). **Sobrestock:** cobertura mayor que max(2 x (plazo + revision), %s dias del sector \"%s\"). Los umbrales por sector son orientativos." % (js_str(P["dias_sin_movimiento_min"]), js_str(sector), P["sector"]))
    L.append("- **Limitaciones:** no modela estacionalidad (se necesitan al menos 24 meses), usa la variabilidad de la demanda y no la del error de pronostico, supone distribucion normal, y no trae costos de pedido ni de mantener para calcular lotes economicos.")
    if uso:
        L.append("- **Uso de IA:** %s llamada%s al modelo %s, %s tokens de entrada y %s de salida (%s USD estimados). La IA solo redacta el comentario; todos los calculos son codigo." % (
            js_str(uso["llamadas"]), s_(uso["llamadas"]), modelo, js_str(uso["entrada"]), js_str(uso["salida"]), js_to_fixed(uso["costo"], 3)))
    if tiempos:
        L.append("- Tiempo de calculo: %s ms." % js_str(tiempos))
    L.append("")

    md = re.sub(r"\n{3,}", "\n\n", sin_guiones("\n".join(L)))

    html = ('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Informe de inventario: %s</title>\n'
            '<style>body{font-family:Arial,sans-serif;max-width:1200px;margin:30px auto;padding:0 16px;color:#222;line-height:1.5}\n'
            'h1{border-bottom:2px solid #333;padding-bottom:6px}h2{margin-top:28px;color:#333}h3{margin-top:18px;color:#444}table{border-collapse:collapse;width:100%%;font-size:13px;margin:8px 0 14px}\n'
            'th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;vertical-align:top}th{background:#eee}blockquote{background:#f6f6f6;border-left:4px solid #999;margin:12px 0;padding:8px 12px}\n'
            'code{background:#f0f0f0;padding:1px 4px}</style></head><body>%s</body></html>') % (esc(mes_texto(res["ym"])), _md_a_html(md))

    # ---------- CSV ----------
    csv_pedido = _csv_de(
        ["sku", "producto", "proveedor", "urgencia", "cantidad", "unidad", "costo_unitario", "costo_total", "motivo"],
        [[r["sku"], r["nombre"], r.get("proveedor"), "URGENTE" if r["accion"] == "COMPRAR URGENTE" else "NORMAL", r["cantidad"], r.get("unidad"), r["costo"], r["valor_compra"], r["motivo"]]
         for r in sorted([r for r in a_surtir if r["cantidad"] > 0], key=_orden_pedido)])

    def fila_detalle(r):
        cobertura = r.get("cobertura")
        pron = r.get("pron")
        return [r["sku"], r["nombre"], r["accion"], r["clase"], r.get("xyz") or "", pron["patron"] if pron else "", r["confianza"], r["stock"], r.get("transito"), r["salidas_mes"], r["entradas_mes"],
                "" if r["dias_en_cero"] is None else r["dias_en_cero"], "" if r.get("ultima_salida") is None else iso_de(r["ultima_salida"]),
                "" if r.get("dias_sin_salida") is None else r["dias_sin_salida"], pron["demanda"] if pron else "", "" if cobertura is None or cobertura == INF else cobertura,
                r.get("L"), "" if r.get("rop") is None else r["rop"], "" if r.get("S") is None else r["S"], r["cantidad"], r["costo"], r["valor_stock"], r.get("proveedor"), r["motivo"]]

    csv_detalle = _csv_de(
        ["sku", "producto", "accion", "clase_abc", "clase_xyz", "patron_demanda", "confianza", "stock_al_corte", "en_transito", "salidas_mes", "entradas_mes", "dias_en_cero_mes", "ultima_salida", "dias_sin_salida",
         "demanda_mensual_estimada", "cobertura_dias", "plazo_dias", "punto_de_reorden", "nivel_objetivo", "cantidad_sugerida", "costo_unitario", "valor_stock", "proveedor", "motivo"],
        [fila_detalle(r) for r in rs])

    # ---------- respuesta corta del chat ----------
    C = []
    C.append("## Inventario de %s" % mes_texto(res["ym"]))
    C.append("Corte al %s | %s productos" % (iso_de(res["corte"]), js_str(ind["productos"])))
    C.append("")
    C.append("- **Surtir:** %d (%d urgentes). Compra sugerida: %s." % (len(a_surtir), len(urgentes), dinero(ind["compra_total"])))
    C.append("- **En cero este mes:** %d%s. **Sin movimiento:** %d. **Nunca se movieron:** %d. **Sobrestock:** %d." % (
        len(quiebres), " (%d siguen en cero)" % siguen if quiebres else "", len(sin_mov), len(nunca), len(sobre)))
    C.append("- **Capital inmovilizado:** %s (%s). Rotacion anual %s." % (dinero(ind["valor_muerto"]), pct(ind["pct_muerto"]), rot))
    C.append("")
    if urgentes:
        C.append("**Urgente**")
        C.append("| %s |" % " | ".join(["Producto", "Stock", "Cobertura (dias)", "Pedir"]))
        C.append("|%s|" % "|".join("---" for _ in range(4)))
        for r in urgentes[:8]:
            C.append("| %s |" % " | ".join(celda(c) for c in [nombre(r), num(r["stock"]), cob(r), "%s %s" % (num(r["cantidad"]), r.get("unidad") or "")]))
        if len(urgentes) > 8:
            C.append("... y %d mas en el informe." % (len(urgentes) - 8))
        C.append("")
    if quiebres:
        C.append("**Se quedaron en cero:** %s%s." % (", ".join("%s (%s dias%s)" % (r["sku"], js_str(r["dias_en_cero"]), ", sigue" if r.get("quiebre") and r["quiebre"]["sigue"] else "") for r in quiebres[:6]),
                                                    " y %d mas" % (len(quiebres) - 6) if len(quiebres) > 6 else ""))
    if nunca or sin_mov:
        sin_rot = ["%s (nunca)" % r["sku"] for r in nunca] + ["%s (%s dias)" % (r["sku"], js_str(r["dias_sin_salida"])) for r in sin_mov]
        C.append("**Sin rotacion:** %s." % ", ".join(sin_rot[:8]))
    if comentario:
        C.append("")
        C.append(re.sub(r"^##[^\n]*\n", "", comentario, count=1).strip())
    if res["avisos"]:
        C.append("")
        for a in res["avisos"][:3]:
            C.append("- Ojo: %s" % a)
    chat = re.sub(r"\n{3,}", "\n\n", sin_guiones("\n".join(C)))
    resumen = {"surtir": len(a_surtir), "urgentes": len(urgentes), "quiebres": len(quiebres), "sin_movimiento": len(sin_mov), "nunca": len(nunca), "sobrestock": len(sobre)}
    return {"md": md, "html": html, "csvPedido": csv_pedido, "csvDetalle": csv_detalle, "chat": chat, "resumen": resumen}


# Quita del comentario de la IA las frases con cifras que no estan en los datos que se le entregaron.
def _digitos(t):
    return [d for d in (re.sub(r"[^0-9]", "", n) for n in re.findall(r"[0-9][0-9.,]*", str(t))) if d]


def limpiar_comentario(texto_ia, entrada_json):
    conocidas = set(_digitos(entrada_json))
    eliminadas = 0
    lineas = []
    for linea in sin_guiones(texto_ia).strip().split("\n"):
        if re.match(r"\s*#", linea):
            lineas.append(linea)
            continue
        mantenidas = []
        for frase in re.split(r"(?<=[.!?])\s+", linea):
            if [d for d in _digitos(frase) if d not in conocidas]:
                eliminadas += 1
            else:
                mantenidas.append(frase)
        lineas.append(" ".join(mantenidas))
    out = "\n".join(lineas).strip()
    if eliminadas:
        out += "\n\n> Nota del sistema: se eliminaron %d frase(s) del comentario por contener cifras que no estaban en los datos calculados." % eliminadas
    return out
