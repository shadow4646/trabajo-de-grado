"""Motor de calculo del agente de inventarios. Todo es codigo determinista: la IA no calcula nada.

Port de n8n_agentes/inventarios_js/01_motor.js. Politica de revision periodica (R,s,S): se compra si la posicion proyectada
al proximo corte cae bajo el punto de reorden, y se pide hasta el nivel objetivo S = D x (L + R) + stock de seguridad.
"""
import math

from .util import (
    desv_muestral,
    dias_del_mes,
    iso_de,
    js_round,
    js_str,
    media,
    mes_de_dia,
    mes_de_indice,
    mes_indice,
    primer_dia_mes,
    suma,
    ultimo_dia_mes,
)

INF = math.inf
NAN = math.nan

DEFECTOS = {
    "R_dias": 30,
    "lead_time_defecto": 15,
    "tope_censura": 2,
    "z_por_clase": {"A": 2.05, "B": 1.645, "C": 1.28, "N": 1.645},
    "sector": "general",
    "cobertura_maxima_sector": {"general": 90, "alimentos": 45, "comercio": 60, "manufactura": 120, "pesados": 180},
    "dias_sin_movimiento_min": 90,
    "meses_ventana": 12,
    "alfa_ses": 0.3,
    "alfa_croston": 0.2,
    "corte_abc": [0.8, 0.95],
    "dias_producto_nuevo": 90,
}


def _div(a, b):
    """a / b como en JavaScript: dividir por cero da Infinity o NaN en vez de lanzar un error."""
    if b == 0:
        return NAN if a == 0 or a != a else (INF if a > 0 else -INF)
    return a / b


def _maximo(valores):
    mx = -INF
    for x in valores:
        if x > mx:
            mx = x
    return mx


# ---------- serie diaria de saldo ----------
def construir_serie(movs, stock_actual, dia_fin):
    """Saldo de cierre de cada dia desde el primer movimiento hasta dia_fin.
    base 'saldo': el sistema trae el saldo posterior a cada movimiento; 'stock_actual': se reconstruye hacia atras desde el
    stock actual del maestro; 'asumido_cero': no hay ancla, se asume saldo inicial 0 (el quiebre deja de ser confiable)."""
    if not movs:
        return None
    d_min = movs[0]["dia"]
    n = dia_fin - d_min + 1
    if n <= 0:
        return None
    delta = [0] * n
    saldo_dia = [None] * n
    con_saldo = 0
    for m in movs:
        i = m["dia"] - d_min
        if i < 0 or i >= n:
            continue
        delta[i] += m["efecto"]
        if m["saldo"] is not None:
            saldo_dia[i] = m["saldo"]
            con_saldo += 1
    bal = [0] * n
    descuadre = None
    if con_saldo >= 0.8 * len(movs):
        base = "saldo"
        previo = 0
        for i in range(n):
            previo = saldo_dia[i] if saldo_dia[i] is not None else previo + delta[i]
            bal[i] = previo
        if stock_actual is not None:
            descuadre = stock_actual - bal[n - 1]
    else:
        acum = 0
        for i in range(n):
            acum += delta[i]
            bal[i] = acum
        if stock_actual is not None:
            base = "stock_actual"
            desfase = stock_actual - bal[n - 1]
            for i in range(n):
                bal[i] += desfase
        else:
            base = "asumido_cero"
    return {"dMin": d_min, "dFin": dia_fin, "bal": bal, "base": base, "descuadre": descuadre, "negativos": sum(1 for x in bal if x < 0)}


def saldo_en(serie, dia):
    if not serie or dia < serie["dMin"]:
        return None
    return serie["bal"][min(dia, serie["dFin"]) - serie["dMin"]]


def _cero(x):
    # En JavaScript null <= 0 es verdadero; aqui un saldo desconocido se trata igual
    return x is None or x <= 0


def quiebre_mes(serie, ym, corte):
    """Detalle de los dias en cero del mes: primer dia, ultimo dia y cuantos episodios seguidos hubo."""
    desde = max(primer_dia_mes(ym), serie["dMin"])
    primero = None
    ultimo = None
    episodios = 0
    en_cero = False
    for d in range(desde, corte + 1):
        cero = _cero(saldo_en(serie, d))
        if cero:
            if primero is None:
                primero = d
            ultimo = d
            if not en_cero:
                episodios += 1
        en_cero = cero
    return {"desde": primero, "hasta": ultimo, "episodios": episodios, "sigue": en_cero}


# ---------- agregados mensuales ----------
def agregar_meses(movs, serie, ym_fin, n_meses, dia_fin, quiebre_confiable):
    i_fin = mes_indice(ym_fin)
    d_min = movs[0]["dia"] if movs else None
    recs = []
    por_mes = {}
    memo = {}
    for m in movs:
        dia = m["dia"]
        k = memo.get(dia)
        if k is None:
            k = memo[dia] = mes_indice(mes_de_dia(dia))
        por_mes.setdefault(k, []).append(m)
    for k in range(i_fin - n_meses + 1, i_fin + 1):
        ym = mes_de_indice(k)
        ini = primer_dia_mes(ym)
        fin = ultimo_dia_mes(ym)
        limite = min(fin, dia_fin)
        if d_min is None or limite < d_min:
            recs.append({"ym": ym, "k": k, "dias_mes": dias_del_mes(ym), "activos": 0, "salidas": 0, "devol": 0, "demanda_neta": 0, "entradas": 0,
                         "ajustes_pos": 0, "ajustes_neg": 0, "dias_con_salida": 0, "dias_en_cero": None, "cierre": None})
            continue
        desde = max(ini, d_min)
        activos = limite - desde + 1
        ms = por_mes.get(k, [])
        sal = [m for m in ms if m["tipo"] == "salida"]
        salidas = suma([m["cantidad"] for m in sal])
        devol = suma([m["cantidad"] for m in ms if m["tipo"] == "devolucion_cliente"])
        dias_cero = None
        if serie and quiebre_confiable:
            dias_cero = 0
            for d in range(desde, limite + 1):
                if _cero(saldo_en(serie, d)):
                    dias_cero += 1
        recs.append({
            "ym": ym, "k": k, "dias_mes": dias_del_mes(ym), "activos": activos, "salidas": salidas, "devol": devol,
            "demanda_neta": max(0, salidas - devol),
            "entradas": suma([m["cantidad"] for m in ms if m["tipo"] == "entrada"]),
            "ajustes_pos": suma([m["cantidad"] for m in ms if m["tipo"] == "ajuste_pos"]),
            "ajustes_neg": suma([m["cantidad"] for m in ms if m["tipo"] == "ajuste_neg"]),
            "dias_con_salida": len({m["dia"] for m in sal}), "dias_en_cero": dias_cero,
            "cierre": saldo_en(serie, limite) if serie else None,
        })
    return recs


def demanda_ajustada(r, P):
    """Demanda del mes corregida: un mes con quiebre vende menos de lo que se pidio (demanda censurada). Se calcula sobre
    los dias con stock, con un tope; si mas de la mitad de los dias estuvo en cero el mes se trata como dato faltante."""
    if r["activos"] <= 0:
        return None
    d = r["demanda_neta"]
    if r["activos"] < r["dias_mes"]:
        if r["activos"] < 15:
            return None
        d = (d * r["dias_mes"]) / r["activos"]
    dz = r["dias_en_cero"]
    if dz is not None and dz > 0:
        if dz > 0.5 * r["activos"]:
            return None
        if r["demanda_neta"] > 0:
            d *= min(P["tope_censura"], r["activos"] / (r["activos"] - dz))
    return d


# ---------- pronostico ----------
def croston_sba(v, alfa):
    z = None
    p = None
    desde = 1
    for x in v:
        if x > 0:
            if z is None:
                z = x
                p = desde
            else:
                z += alfa * (x - z)
                p += alfa * (desde - p)
            desde = 1
        else:
            desde += 1
    return 0 if z is None else (1 - alfa / 2) * (z / p)


def suavizado_exponencial(v, alfa):
    nivel = media(v[:min(3, len(v))])
    for x in v:
        nivel = alfa * x + (1 - alfa) * nivel
    return nivel


def pronosticar(valores, P):
    """Patron de demanda de Syntetos y Boylan: ADI (intervalo medio entre demandas) y CV2 de los tamanos de demanda."""
    n = len(valores)
    base = {"n": n, "metodo": "sin datos", "demanda": 0, "sigma": 0, "maximo": 0, "patron": "sin demanda", "adi": None, "cv2": None, "confianza": "BAJA"}
    if not n:
        return base
    nz = [x for x in valores if x > 0]
    adi = n / len(nz) if nz else INF
    cv2 = (desv_muestral(nz) / media(nz)) ** 2 if len(nz) >= 2 and media(nz) > 0 else 0
    if not nz:
        patron = "sin demanda"
    elif adi < 1.32:
        patron = "suave" if cv2 < 0.49 else "erratica"
    else:
        patron = "intermitente" if cv2 < 0.49 else "irregular"
    out = {**base, "n": n, "adi": adi if math.isfinite(adi) else None, "cv2": cv2, "patron": patron, "sigma": desv_muestral(valores), "maximo": _maximo(valores)}
    if n < 3:
        return {**out, "metodo": "promedio simple (historial insuficiente)", "demanda": media(valores), "confianza": "BAJA"}
    if patron in ("intermitente", "irregular") and len(nz) >= 2:
        return {**out, "metodo": "Croston con correccion SBA (demanda intermitente)", "demanda": croston_sba(valores, P["alfa_croston"]), "confianza": "MEDIA"}
    if n >= 6:
        return {**out, "metodo": "suavizado exponencial simple", "demanda": suavizado_exponencial(valores, P["alfa_ses"]), "confianza": "ALTA" if patron == "suave" else "MEDIA"}
    return {**out, "metodo": "promedio movil simple (pocos meses)", "demanda": media(valores), "confianza": "MEDIA"}


# ---------- politica de reposicion ----------
def stock_seguridad(d, dias):
    """Stock de seguridad para un periodo de proteccion de `dias` dias. Con 6 o mas meses se usa la desviacion estandar (y la
    del plazo de entrega si se conoce); con menos, el metodo simplificado (demanda maxima menos promedio)."""
    if d["n"] >= 6:
        var_demanda = (dias / 30) * (d["sigma"] * d["sigma"])
        sl = d.get("sigmaL")
        var_plazo = ((d["demandaMes"] * sl) / 30) ** 2 if sl else 0
        return d["Z"] * math.sqrt(var_demanda + var_plazo)
    return max(0, d["maximo"] - d["demandaMes"]) * (dias / 30)


def politica(d, P):
    Ddia = d["demandaMes"] / 30
    L = d["L"]
    R = d["R"]
    ss_l = stock_seguridad(d, L)
    ss_lr = stock_seguridad(d, L + R)
    rop = Ddia * L + ss_l
    S = Ddia * (L + R) + ss_lr
    posicion = d["stock"] + d["transito"]
    proyectada = posicion - Ddia * R
    comprar = Ddia > 0 and proyectada <= rop
    cantidad = 0
    if comprar:
        cantidad = max(0, S - posicion)
        moq = d.get("moq")
        if moq and moq > 1:
            cantidad = math.ceil(cantidad / moq) * moq
        cantidad = math.ceil(cantidad)
    cobertura = d["stock"] / Ddia if Ddia > 0 else INF
    return {"Ddia": Ddia, "rop": rop, "S": S, "ss": ss_lr, "posicion": posicion, "proyectada": proyectada, "comprar": comprar, "cantidad": cantidad,
            "cobertura": cobertura, "urgente": Ddia > 0 and (d["stock"] <= 0 or cobertura <= L)}


def _redondear_moq(cantidad, moq):
    if moq and moq > 1:
        return math.ceil(cantidad / moq) * moq
    return cantidad


# ---------- calculo completo del mes ----------
def calcular_inventario(datos, cfg, parametros=None):
    parametros = parametros or {}
    P = {**DEFECTOS, **parametros, "z_por_clase": {**DEFECTOS["z_por_clase"], **(parametros.get("z_por_clase") or {})}}
    ym = cfg["mes"]
    avisos = list(datos["avisos"])
    por_key = {}
    for m in datos["movs"]:
        por_key.setdefault(m["key"], []).append(m)
    for lista in por_key.values():
        lista.sort(key=lambda m: (m["dia"], m["idx"]))
    dia_fin = 0
    for m in datos["movs"]:
        if m["dia"] > dia_fin:
            dia_fin = m["dia"]
    fin_mes = ultimo_dia_mes(ym)
    corte = min(fin_mes, dia_fin)
    if dia_fin < fin_mes:
        avisos.append("Los movimientos llegan hasta %s, antes del fin de %s: el mes esta incompleto y el informe se calcula al %s." % (iso_de(dia_fin), ym, iso_de(corte)))
    if dia_fin > fin_mes + 40:
        avisos.append("Hay movimientos hasta %s, posteriores al mes pedido (%s). Se usan solo para reconstruir el saldo; el analisis es al %s." % (iso_de(dia_fin), ym, iso_de(fin_mes)))
    claves = list(dict.fromkeys(list(por_key.keys()) + list(datos["maestro"].keys())))
    resultados = []
    calidad = {**datos["calidad"], "descuadres": [], "saldo_negativo": [], "sin_ancla": [], "plazo_supuesto": 0, "sin_costo": 0}
    n_ventana = P["meses_ventana"] + 2

    for key in claves:
        movs = por_key.get(key, [])
        mae = datos["maestro"].get(key)
        sku = mae["sku"] if mae else (movs[0]["sku"] if movs else key)
        nombre = (mae and mae["nombre"]) or next((m["producto"] for m in movs if m["producto"]), "") or ""
        if mae and not mae["activo"]:
            resultados.append({"key": key, "sku": sku, "nombre": nombre, "accion": "INACTIVO", "motivo": "Marcado como inactivo en el maestro.", "stock": mae["stock_actual"] or 0,
                               "costo": mae["costo"] or 0, "valor_stock": (mae["stock_actual"] or 0) * (mae["costo"] or 0), "clase": "-", "cantidad": 0, "valor_compra": 0,
                               "proveedor": mae["proveedor"], "salidas_mes": 0, "entradas_mes": 0, "dias_en_cero": 0, "confianza": "-"})
            continue
        mensual = datos["calidad"]["granularidad_mensual"]
        serie = None if mensual else construir_serie(movs, mae["stock_actual"] if mae else None, dia_fin)
        quiebre_confiable = bool(serie) and serie["base"] != "asumido_cero"
        if serie and serie["base"] == "asumido_cero":
            calidad["sin_ancla"].append(sku)
        if serie and serie["descuadre"] is not None and abs(serie["descuadre"]) > 0.5:
            calidad["descuadres"].append({"sku": sku, "diferencia": serie["descuadre"]})
        if serie and serie["negativos"] > 0:
            calidad["saldo_negativo"].append(sku)

        meses = agregar_meses(movs, serie, ym, n_ventana, dia_fin, quiebre_confiable)
        mes_actual = meses[-1]
        previos3 = [r for r in meses[-4:-1] if r["activos"] >= r["dias_mes"]]
        promedio3 = media([r["demanda_neta"] for r in previos3]) if previos3 else None
        quiebre = quiebre_mes(serie, ym, corte) if serie and quiebre_confiable and (mes_actual["dias_en_cero"] or 0) > 0 else None
        alta = movs[0]["dia"] if movs else None
        if serie:
            stock_corte = saldo_en(serie, corte)
        else:
            stock_corte = mae["stock_actual"] if mae and mae["stock_actual"] is not None else 0
        if stock_corte is None:
            stock = max(0, (mae["stock_actual"] or 0) if mae else 0)
        else:
            stock = max(0, stock_corte)
        ultimo_costo = next((m for m in reversed(movs) if m["costo"] is not None), None)
        costo = (mae and mae["costo"]) or (ultimo_costo["costo"] if ultimo_costo else 0)
        if not costo:
            calidad["sin_costo"] += 1
        L = mae["lead_time"] if mae and mae["lead_time"] else P["lead_time_defecto"]
        if not (mae and mae["lead_time"]):
            calidad["plazo_supuesto"] += 1
        sal = [m for m in movs if m["tipo"] == "salida" and m["dia"] <= corte]
        dias_salida = sorted({m["dia"] for m in sal})
        ultima_salida = dias_salida[-1] if dias_salida else None
        dias_sin_salida = corte - ultima_salida if ultima_salida is not None else None
        gaps = [dias_salida[i + 1] - dias_salida[i] for i in range(len(dias_salida) - 1)]
        intervalo_medio = media(gaps) if len(dias_salida) >= 4 else None
        edad_dias = corte - alta if alta is not None else None
        nuevo = alta is not None and corte - alta < P["dias_producto_nuevo"]

        valores = [v for v in (demanda_ajustada(r, P) for r in meses) if v is not None]
        f = pronosticar(valores, P)
        ventana12 = meses[-P["meses_ventana"]:]
        cons12 = suma([r["demanda_neta"] for r in ventana12])
        mes_ant = next((r for r in meses if r["k"] == mes_indice(ym) - 12), None)

        resultados.append({
            "key": key, "sku": sku, "nombre": nombre, "unidad": mae["unidad"] if mae else "", "proveedor": mae["proveedor"] if mae else "", "costo": costo,
            "stock": stock, "transito": mae["en_transito"] if mae else 0, "moq": mae["moq"] if mae else None, "L": L, "sigmaL": mae["lead_time_desv"] if mae else None,
            "plazo_supuesto": not (mae and mae["lead_time"]), "vida_util": mae["vida_util"] if mae else None, "llegada_transito": mae["llegada_transito"] if mae else None,
            "sin_maestro": not mae, "alta": alta, "nuevo": nuevo, "edad_dias": edad_dias,
            "serie_base": serie["base"] if serie else ("mensual" if mensual else "sin movimientos"), "quiebre_confiable": quiebre_confiable,
            "salidas_mes": mes_actual["salidas"], "devol_mes": mes_actual["devol"], "demanda_neta_mes": mes_actual["demanda_neta"], "entradas_mes": mes_actual["entradas"],
            "ajustes_pos_mes": mes_actual["ajustes_pos"], "ajustes_neg_mes": mes_actual["ajustes_neg"],
            "promedio_3m": promedio3, "quiebre": quiebre,
            "dias_con_salida_mes": mes_actual["dias_con_salida"], "dias_en_cero": mes_actual["dias_en_cero"],
            "stock_inicial": saldo_en(serie, primer_dia_mes(ym) - 1) if serie else None, "stock_cierre": saldo_en(serie, corte) if serie else None,
            "ultima_salida": ultima_salida, "dias_sin_salida": dias_sin_salida, "intervalo_medio": intervalo_medio, "salio_alguna_vez": len(dias_salida) > 0,
            "meses": meses, "valores": valores, "pron": f, "consumo12": cons12, "valor_consumo12": cons12 * costo, "valor_stock": stock * costo,
            "mismo_mes_anio_anterior": (mes_ant["demanda_neta"] if mes_ant else 0) or 0, "nuevo_poco_historial": nuevo and f["n"] < 3,
        })

    # ---------- clasificacion ABC por valor de consumo de los ultimos 12 meses (el SKU que cruza el umbral queda en la clase superior) ----------
    activos = [r for r in resultados if r.get("accion") != "INACTIVO"]
    con_clase = sorted([r for r in activos if not r["nuevo"]], key=lambda r: -r["valor_consumo12"])
    total = suma([r["valor_consumo12"] for r in con_clase])
    acum = 0
    for r in con_clase:
        antes = acum / total if total > 0 else 1
        if r["valor_consumo12"] <= 0:
            r["clase"] = "C"
        elif antes < P["corte_abc"][0]:
            r["clase"] = "A"
        elif antes < P["corte_abc"][1]:
            r["clase"] = "B"
        else:
            r["clase"] = "C"
        acum += r["valor_consumo12"]
    for r in activos:
        if r["nuevo"]:
            r["clase"] = "N"
    if len(con_clase) < 10:
        avisos.append("Hay pocos productos (menos de 10): la clasificacion ABC es orientativa.")

    # ---------- decision por producto ----------
    sector = P["sector"] if P["sector"] in P["cobertura_maxima_sector"] else "general"
    for r in activos:
        fp = r["pron"]
        if fp["n"] >= 6 and fp["demanda"] > 0:
            cv = _div(fp["sigma"], media(r["valores"]))
            r["xyz"] = "X" if cv < 0.5 else ("Y" if cv <= 1 else "Z")
        else:
            r["xyz"] = None
        Z = P["z_por_clase"].get(r["clase"]) or P["z_por_clase"]["B"]
        r["nivel_servicio"] = {"A": "98%", "B": "95%", "C": "90%", "N": "95%"}.get(r["clase"], "95%")
        pol = politica({"demandaMes": fp["demanda"], "sigma": fp["sigma"], "maximo": fp["maximo"], "n": fp["n"], "Z": Z, "L": r["L"], "sigmaL": r["sigmaL"], "R": P["R_dias"],
                        "stock": r["stock"], "transito": r["transito"], "moq": r["moq"]}, P)
        r.update({"Ddia": pol["Ddia"], "rop": pol["rop"], "S": pol["S"], "ss": pol["ss"], "posicion": pol["posicion"], "proyectada": pol["proyectada"], "cobertura": pol["cobertura"]})
        r["confianza"] = fp["confianza"]
        if r["sin_maestro"] and r["serie_base"] == "asumido_cero":
            r["confianza"] = "BAJA"
        umbral_cob = max(2 * (r["L"] + P["R_dias"]), P["cobertura_maxima_sector"][sector])
        r["umbral_cobertura"] = umbral_cob
        umbral_muerto = max(P["dias_sin_movimiento_min"], min(365, 3 * r["intervalo_medio"]) if r["intervalo_medio"] else 0)
        r["umbral_sin_movimiento"] = umbral_muerto
        edad = r["dias_sin_salida"]
        r["tramo_edad"] = None if edad is None else ("365 o mas" if edad >= 365 else ("180 a 364" if edad >= 180 else "90 a 179"))
        r["transito_vencido"] = r["llegada_transito"] is not None and r["llegada_transito"] < corte and r["transito"] > 0
        r["exceso_unidades"] = max(0, pol["posicion"] - pol["S"])
        r["exceso_valor"] = r["exceso_unidades"] * r["costo"]
        r["ventas_perdidas"] = js_round(pol["Ddia"] * r["dias_en_cero"]) if r["dias_en_cero"] and r["dias_en_cero"] > 0 else 0
        quiebre_actual = r["stock"] <= 0 and (pol["Ddia"] > 0 or r["consumo12"] > 0)
        nunca = r["stock"] > 0 and not r["salio_alguna_vez"]
        sin_mov = r["stock"] > 0 and r["salio_alguna_vez"] and edad is not None and edad >= umbral_muerto and not r["nuevo"]
        sobre = pol["Ddia"] > 0 and pol["cobertura"] > umbral_cob and r["stock"] > 0
        motivo_meta = "Politica de revision mensual: nivel de servicio %s, plazo %s dias%s." % (r["nivel_servicio"], js_str(r["L"]), " (supuesto)" if r["plazo_supuesto"] else "")
        if r["serie_base"] == "asumido_cero" and r["sin_maestro"]:
            r["accion"] = "REVISAR DATOS"
            r["cantidad"] = 0
            r["confianza"] = "BAJA"
            r["motivo"] = "No hay stock actual ni saldo por movimiento para este producto: el stock es desconocido y no se puede recomendar una compra. Agregalo al maestro de productos."
        elif quiebre_actual:
            r["accion"] = "COMPRAR URGENTE"
            r["cantidad"] = max(pol["cantidad"], math.ceil(max(0, pol["S"] - pol["posicion"])))
            r["cantidad"] = _redondear_moq(r["cantidad"], r["moq"])
            transito_txt = (" (hay %s en transito%s)" % (js_str(r["transito"]), ", con fecha de llegada vencida" if r["transito_vencido"] else "")) if r["transito"] > 0 else ""
            r["motivo"] = "Sin stock al cierre%s. Riesgo que mitiga: quiebre. %s" % (transito_txt, motivo_meta)
            if r["cantidad"] <= 0:
                r["accion"] = "SIN STOCK, PEDIDO EN CAMINO"
                r["cantidad"] = 0
                r["motivo"] = "Sin stock al cierre, pero lo que viene en transito (%s) cubre el nivel objetivo.%s" % (js_str(r["transito"]), " La fecha de llegada ya vencio: confirma con el proveedor." if r["transito_vencido"] else "")
        elif sin_mov:
            r["accion"] = "SIN MOVIMIENTO"
            r["cantidad"] = 0
            r["motivo"] = "Ultima salida hace %s dias (umbral %s). Riesgo: capital inmovilizado y obsolescencia.%s" % (js_str(edad), js_str(js_round(umbral_muerto)), " Vendio en el mismo mes del ano pasado: puede ser estacional." if r["mismo_mes_anio_anterior"] > 0 else "")
        elif pol["comprar"]:
            r["accion"] = "COMPRAR URGENTE" if pol["urgente"] else "COMPRAR"
            r["cantidad"] = pol["cantidad"]
            r["motivo"] = "Posicion proyectada al proximo corte (%s) por debajo del punto de reorden (%s); la cobertura es de %s dias%s. Riesgo que mitiga: quiebre. %s" % (
                js_str(js_round(pol["proyectada"])), js_str(js_round(pol["rop"])), js_str(js_round(pol["cobertura"])), ", menos que el plazo de entrega" if pol["urgente"] else "", motivo_meta)
        elif nunca:
            r["accion"] = "NUNCA SE MOVIO"
            r["cantidad"] = 0
            r["motivo"] = "Tiene %s en stock y ninguna salida en todo el historial leido. Riesgo: capital inmovilizado." % js_str(r["stock"])
        elif sobre:
            r["accion"] = "SOBRESTOCK"
            r["cantidad"] = 0
            r["motivo"] = "Cobertura de %s dias, por encima de %s. Excedente de %s unidades sobre el nivel objetivo. Riesgo: capital inmovilizado." % (
                js_str(js_round(pol["cobertura"])), js_str(js_round(umbral_cob)), js_str(js_round(r["exceso_unidades"])))
        elif pol["Ddia"] == 0 and r["stock"] <= 0:
            r["accion"] = "SIN DEMANDA"
            r["cantidad"] = 0
            r["motivo"] = "Sin stock y sin demanda en la ventana analizada."
        else:
            r["accion"] = "NO COMPRAR"
            r["cantidad"] = 0
            cob_txt = "sin demanda" if pol["cobertura"] == INF else js_str(js_round(pol["cobertura"])) + " dias"
            r["motivo"] = "Stock suficiente: cobertura de %s, posicion proyectada %s sobre el punto de reorden %s." % (cob_txt, js_str(js_round(pol["proyectada"])), js_str(js_round(pol["rop"])))
        r["valor_compra"] = r["cantidad"] * r["costo"]
        if r["clase"] == "A" and (r["xyz"] == "Z" or fp["patron"] == "irregular") and r["accion"] in ("COMPRAR", "COMPRAR URGENTE"):
            r["revisar_manual"] = "Producto de alto valor con demanda errática: confirma la cantidad con el área comercial antes de pedir."

    return {"resultados": activos + [r for r in resultados if r["accion"] == "INACTIVO"], "P": P, "ym": ym, "corte": corte, "avisos": avisos, "calidad": calidad, "diaFin": dia_fin}


# ---------- exactitud del pronostico (backtest con datos hasta el mes anterior) ----------
def backtest(resultados, P, meses_atras):
    out = {"n": 0, "real": 0, "abs": 0, "sesgo": 0, "abs_ingenuo": 0, "por_clase": {}}
    for r in resultados:
        if not r.get("meses") or r["accion"] == "INACTIVO":
            continue
        for j in range(meses_atras):
            idx = len(r["meses"]) - 1 - j
            if idx < 1:
                continue
            mes_real = r["meses"][idx]
            previos = [v for v in (demanda_ajustada(x, P) for x in r["meses"][:idx]) if v is not None]
            if len(previos) < 3 or mes_real["activos"] < mes_real["dias_mes"]:
                continue
            pron = pronosticar(previos, P)["demanda"]
            real = mes_real["demanda_neta"]
            ingenuo = r["meses"][idx - 1]["demanda_neta"]
            out["n"] += 1
            out["real"] += real
            out["abs"] += abs(real - pron)
            out["sesgo"] += pron - real
            out["abs_ingenuo"] += abs(real - ingenuo)
            c = r.get("clase") or "-"
            pc = out["por_clase"].setdefault(c, {"real": 0, "abs": 0})
            pc["real"] += real
            pc["abs"] += abs(real - pron)
    pos = out["real"] > 0
    return {
        "observaciones": out["n"],
        "wape": out["abs"] / out["real"] if pos else None,
        "sesgo": out["sesgo"] / out["real"] if pos else None,
        "wape_ingenuo": out["abs_ingenuo"] / out["real"] if pos else None,
        "wape_por_clase": {c: (v["abs"] / v["real"] if v["real"] > 0 else None) for c, v in out["por_clase"].items()},
    }


# ---------- indicadores del mes ----------
def indicadores(res, P):
    rs = [r for r in res["resultados"] if r["accion"] != "INACTIVO"]
    valor_inv = suma([r["valor_stock"] for r in rs])
    con_quiebre_confiable = [r for r in rs if r["quiebre_confiable"]]
    activos_ventas = [r for r in rs if r["consumo12"] > 0]
    en_quiebre = [r for r in activos_ventas if r["quiebre_confiable"] and (r["dias_en_cero"] or 0) > 0]
    clase_a = [r for r in activos_ventas if r["clase"] == "A" and r["quiebre_confiable"]]
    con_ventas_confiables = [r for r in con_quiebre_confiable if r["consumo12"] > 0]
    peso_total = suma([r["valor_consumo12"] for r in con_ventas_confiables])
    if peso_total > 0:
        disponibilidad = suma([r["valor_consumo12"] * (1 - min(1, (r["dias_en_cero"] or 0) / max(1, r["meses"][-1]["activos"]))) for r in con_ventas_confiables]) / peso_total
    else:
        disponibilidad = None
    cogs12 = suma([r["valor_consumo12"] for r in rs])
    promedios = [media([max(0, m["cierre"]) * r["costo"] for m in r["meses"] if m["cierre"] is not None])
                 for r in rs if r["serie_base"] != "asumido_cero" and any(m["cierre"] is not None for m in r["meses"])]
    inv_promedio = suma(promedios)
    rotacion = cogs12 / inv_promedio if inv_promedio > 0 else None
    muertos = [r for r in rs if r["accion"] in ("SIN MOVIMIENTO", "NUNCA SE MOVIO")]
    tramos = {"90 a 179": 0, "180 a 364": 0, "365 o mas": 0, "sin ventas en el historial": 0}
    for r in muertos:
        tramos["sin ventas en el historial" if r["accion"] == "NUNCA SE MOVIO" else r["tramo_edad"]] += r["valor_stock"]
    compras = [r for r in rs if r["cantidad"] > 0]
    por_proveedor = {}
    por_clase = {}
    for r in compras:
        p = r["proveedor"] or "Sin proveedor"
        por_proveedor[p] = por_proveedor.get(p, 0) + r["valor_compra"]
        por_clase[r["clase"]] = por_clase.get(r["clase"], 0) + r["valor_compra"]
    aj = suma([(r["ajustes_pos_mes"] + r["ajustes_neg_mes"]) * r["costo"] for r in rs])
    sal = suma([r["salidas_mes"] * r["costo"] for r in rs])
    cuenta = {}
    for r in rs:
        cuenta[r["accion"]] = cuenta.get(r["accion"], 0) + 1
    n_conf = len([r for r in activos_ventas if r["quiebre_confiable"]])
    return {
        "productos": len(rs), "productos_con_ventas_12m": len(activos_ventas), "cuenta_acciones": cuenta, "valor_inventario": valor_inv,
        "rotacion_anual": rotacion, "dias_inventario": 365 / rotacion if rotacion else None,
        "tasa_quiebre": _div(len(en_quiebre), n_conf) if activos_ventas and con_quiebre_confiable else None,
        "productos_en_quiebre": len(en_quiebre), "quiebre_clase_a": len([r for r in clase_a if (r["dias_en_cero"] or 0) > 0]) if clase_a else 0, "productos_clase_a": len(clase_a),
        "disponibilidad_ponderada": disponibilidad, "valor_muerto": suma([r["valor_stock"] for r in muertos]),
        "pct_muerto": suma([r["valor_stock"] for r in muertos]) / valor_inv if valor_inv > 0 else None, "tramos_muerto": tramos,
        "capital_exceso": suma([r["exceso_valor"] for r in rs if r["accion"] == "SOBRESTOCK"]), "compra_total": suma([r["valor_compra"] for r in compras]),
        "compra_por_proveedor": por_proveedor, "compra_por_clase": por_clase,
        "ajustes_valor": aj, "ajustes_pct_salidas": aj / sal if sal > 0 else None, "ventas_perdidas_valor": suma([r["ventas_perdidas"] * r["costo"] for r in rs]),
        "pronostico": backtest(rs, res["P"], 3),
    }
