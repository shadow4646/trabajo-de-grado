"""Deteccion de columnas, clasificacion de tipos de movimiento y normalizacion de los datos de entrada.

Port de n8n_agentes/inventarios_js/00_lib.js. Los datos llegan como listas de diccionarios (una fila por registro) y salen
como movimientos y maestro normalizados, con un bloque de calidad y avisos para el informe.
"""
import re

from .util import (
    clave,
    es_finito,
    js_str,
    norm,
    parsear_fecha,
    parsear_numero,
    texto,
)

SINONIMOS = {
    "fecha": ["fecha", "date", "dia", "fechamovimiento", "fechamov", "fechadocumento", "fechatransaccion"],
    "sku": ["sku", "codigo", "cod", "referencia", "ref", "item", "idproducto", "productoid", "codigoproducto", "codproducto", "codigoarticulo", "articulo", "producto"],
    "producto": ["producto", "nombre", "descripcion", "nombreproducto", "itemname", "articulo", "descripcionproducto"],
    "tipo": ["tipo", "tipomovimiento", "movimiento", "concepto", "operacion", "transaccion", "clasemovimiento", "tipodocumento"],
    "cantidad": ["cantidad", "qty", "unidades", "cant", "quantity", "cantidadmovimiento"],
    "entrada": ["entrada", "entradas", "ingreso", "ingresos", "compras", "recibido"],
    "salida": ["salida", "salidas", "egreso", "egresos", "ventas", "despachado", "consumo"],
    "costo_unitario": ["costounitario", "costo", "preciocosto", "costopromedio", "unitcost", "cost", "valorunitario"],
    "saldo": ["saldo", "saldofinal", "saldoposterior", "existenciaposterior", "balance"],
    "stock_actual": ["stockactual", "stock", "existencia", "existencias", "existenciaactual", "inventario", "disponible", "onhand", "cantidadactual"],
    "unidad": ["unidad", "um", "unidadmedida", "uom"],
    "lead_time_dias": ["leadtimedias", "leadtime", "plazoentrega", "diasentrega", "tiempoentrega", "plazodias"],
    "lead_time_desv_dias": ["leadtimedesvdias", "desvleadtime", "desviacionleadtime"],
    "moq": ["moq", "minimocompra", "cantidadminima", "multiplo", "pedidominimo"],
    "en_transito": ["entransito", "por recibir", "pedidopendiente", "ordenado", "pendienterecibir", "pedido en camino", "ordenes abiertas"],
    "fecha_llegada_transito": ["fechallegadatransito", "fechaestimadallegada", "fechallegada"],
    "proveedor": ["proveedor", "vendor", "supplier"],
    "activo": ["activo", "estado", "active"],
    "motivo": ["motivo", "razon", "causa", "observacion"],
    "bodega": ["bodega", "almacen", "warehouse", "ubicacion", "sede"],
    "vida_util_dias": ["vidautildias", "vidautil", "diasvencimiento"],
    "documento": ["documento", "numerodocumento", "nrodocumento", "factura", "consecutivo"],
}

# Efecto sobre el saldo; solo 'salida' y 'devolucion_cliente' cuentan para la demanda
EFECTO_TIPO = {
    "entrada": 1, "saldo_inicial": 1, "devolucion_cliente": 1, "ajuste_pos": 1, "traslado_entrada": 1,
    "salida": -1, "devolucion_proveedor": -1, "ajuste_neg": -1, "traslado_salida": -1,
}


def detectar_columnas(encabezados, mapeo_usuario, campos):
    """Devuelve {campo: nombre_de_columna_real}. El mapeo del usuario manda sobre la deteccion automatica."""
    por_clave = {clave(h): h for h in encabezados}
    out = {}
    usadas = set()
    manual = mapeo_usuario or {}
    for campo in campos:
        if manual.get(campo):
            h = manual[campo] if manual[campo] in encabezados else por_clave.get(clave(manual[campo]))
            if h:
                out[campo] = h
                usadas.add(h)
                continue
        for sinonimo in SINONIMOS.get(campo, [campo]):
            h = por_clave.get(clave(sinonimo))
            if h and h not in usadas:
                out[campo] = h
                usadas.add(h)
                break
    # Segunda pasada: encabezados que contienen un sinonimo largo y especifico ("Plazo de entrega (dias)", "Existencia actual")
    for campo in campos:
        if campo in out:
            continue
        for sinonimo in [s for s in (clave(x) for x in SINONIMOS.get(campo, [])) if len(s) >= 8]:
            h = next((x for x in encabezados if x not in usadas and sinonimo in clave(x)), None)
            if h:
                out[campo] = h
                usadas.add(h)
                break
    return out


def clasificar_tipo(txt, cantidad_con_signo):
    t = norm(txt)
    if not t:
        return "salida" if cantidad_con_signo < 0 else ("entrada" if cantidad_con_signo > 0 else "desconocido")
    if re.search(r"saldo inicial|inventario inicial|apertura|existencia inicial", t):
        return "saldo_inicial"
    if re.search(r"devol", t) and re.search(r"(cliente|venta|consumidor)", t):
        return "devolucion_cliente"
    if re.search(r"devol", t) and re.search(r"(proveedor|compra)", t):
        return "devolucion_proveedor"
    if re.search(r"nota credito", t):
        return "devolucion_cliente"
    if re.search(r"devol", t):
        return "devolucion_proveedor" if cantidad_con_signo < 0 else "devolucion_cliente"
    if re.search(r"(traslado|transferencia)", t):
        if re.search(r"(entrada|ingreso|recib|destino)", t):
            return "traslado_entrada"
        if re.search(r"(salida|egreso|origen|envio)", t):
            return "traslado_salida"
        return "traslado_salida" if cantidad_con_signo < 0 else "traslado_entrada"
    if re.search(r"ajuste|sobrante|faltante|merma|averia|dano|baja de|vencimiento|vencido|perdida|robo|conteo|toma fisica", t):
        if re.search(r"(positiv|sobrante|\+|entrada|aumento)", t):
            return "ajuste_pos"
        if re.search(r"(negativ|faltante|merma|averia|dano|baja|vencimiento|vencido|perdida|robo|-|salida)", t):
            return "ajuste_neg"
        return "ajuste_neg" if cantidad_con_signo < 0 else "ajuste_pos"
    if re.search(r"compra|entrada|ingreso|recepcion|recibo|produccion|importacion|reposicion|reintegro", t):
        return "entrada"
    if re.search(r"venta|salida|consumo|despacho|egreso|remision|factura|requisicion|entrega|pedido cliente|gasto", t):
        return "salida"
    return "desconocido"


def normalizar(filas_mov, filas_mae, cfg):
    """filas_mov y filas_mae: listas de diccionarios. cfg: mapeo, mapeo_maestro, formato_fecha, por_bodega."""
    avisos = []
    calidad = {"filas_movimientos": len(filas_mov), "filas_usadas": 0, "descartadas": {}, "duplicados_sospechosos": 0,
               "skus_sin_maestro": [], "granularidad_mensual": False}

    def descartar(motivo):
        calidad["descartadas"][motivo] = calidad["descartadas"].get(motivo, 0) + 1

    enc_mov = list(filas_mov[0].keys()) if filas_mov else []
    col_mov = detectar_columnas(enc_mov, cfg.get("mapeo"), ["fecha", "sku", "producto", "tipo", "cantidad", "entrada", "salida", "costo_unitario", "saldo", "motivo", "bodega", "documento", "lead_time_dias", "stock_actual"])
    if not col_mov.get("fecha") or not col_mov.get("sku") or not (col_mov.get("cantidad") or col_mov.get("entrada") or col_mov.get("salida")):
        return {"error": "No se reconocieron las columnas minimas de movimientos (fecha, sku y cantidad). Columnas recibidas: %s. Indica el mapeo en la configuracion." % (", ".join(enc_mov[:12]) or "ninguna"),
                "avisos": avisos, "calidad": calidad}
    sin_tipo = not col_mov.get("tipo")
    separadas = not col_mov.get("cantidad") and (col_mov.get("entrada") or col_mov.get("salida"))
    if sin_tipo and not separadas:
        avisos.append("El archivo de movimientos no tiene columna de tipo: se usa el signo de la cantidad (negativo = salida). Si el sistema registra devoluciones, ajustes o traslados, agrega la columna de tipo o de motivo para que no se cuenten como demanda.")
    bodegas = []
    movs = []
    vistos = {}
    formato_fecha = cfg.get("formato_fecha")
    for idx, fila in enumerate(filas_mov):
        f = parsear_fecha(fila.get(col_mov["fecha"]), formato_fecha)
        sku = texto(fila.get(col_mov["sku"])).strip()
        if not f:
            descartar("fecha invalida")
            continue
        if not sku:
            descartar("sin codigo de producto")
            continue
        registros = []
        if separadas:
            e = parsear_numero(fila.get(col_mov["entrada"])) if col_mov.get("entrada") else float("nan")
            s = parsear_numero(fila.get(col_mov["salida"])) if col_mov.get("salida") else float("nan")
            if e > 0:
                registros.append(("entrada", e))
            if s > 0:
                registros.append(("salida", s))
        else:
            q = parsear_numero(fila.get(col_mov["cantidad"]))
            if not es_finito(q):
                descartar("cantidad invalida")
                continue
            if q == 0:
                descartar("cantidad cero")
                continue
            registros.append(((("salida" if q < 0 else "entrada") if sin_tipo else clasificar_tipo(fila.get(col_mov["tipo"]), q)), q))
        for tipo, q in registros:
            if tipo == "desconocido":
                descartar("tipo de movimiento no reconocido (%s)" % texto(fila.get(col_mov["tipo"]))[:25])
                continue
            bodega = texto(fila.get(col_mov["bodega"])).strip() if col_mov.get("bodega") else ""
            if bodega and bodega not in bodegas:
                bodegas.append(bodega)
            saldo = parsear_numero(fila.get(col_mov["saldo"])) if col_mov.get("saldo") else float("nan")
            costo = parsear_numero(fila.get(col_mov["costo_unitario"])) if col_mov.get("costo_unitario") else float("nan")
            m = {
                "idx": idx, "dia": f["dia"], "mensual": f["mensual"], "sku": sku,
                "producto": texto(fila.get(col_mov["producto"])).strip() if col_mov.get("producto") else "",
                "tipo": tipo, "cantidad": abs(q), "efecto": EFECTO_TIPO[tipo] * abs(q),
                "costo": costo if es_finito(costo) and costo > 0 else None, "saldo": saldo if es_finito(saldo) else None,
                "bodega": bodega, "documento": texto(fila.get(col_mov["documento"])) if col_mov.get("documento") else "",
            }
            k = "%d|%s|%s|%s|%s|%s" % (m["dia"], m["sku"], m["tipo"], js_str(m["cantidad"]), m["bodega"], m["documento"])
            vistos[k] = vistos.get(k, 0) + 1
            if m["documento"] and vistos[k] > 1:
                calidad["duplicados_sospechosos"] += 1
                descartar("duplicado exacto con el mismo documento")
                continue
            movs.append(m)
    sospechosos = sum(n - 1 for n in vistos.values() if n > 1)
    calidad["duplicados_sospechosos"] += sospechosos
    if sospechosos and not any(m["documento"] for m in movs):
        avisos.append("Filas de movimiento identicas (misma fecha, producto, tipo y cantidad): %d. El archivo no trae numero de documento, asi que pueden ser ventas repetidas legitimas o duplicados. No se eliminaron." % sospechosos)
    calidad["filas_usadas"] = len(movs)
    if movs and sum(1 for m in movs if m["mensual"]) / len(movs) > 0.5:
        calidad["granularidad_mensual"] = True
        avisos.append("Las fechas vienen por mes (AAAA-MM) y no por dia: no se puede reconstruir el saldo diario, asi que no se calculan los dias en cero ni los quiebres dentro del mes.")
    por_bodega = bool(cfg.get("por_bodega")) and len(bodegas) > 1
    if len(bodegas) > 1 and not por_bodega:
        avisos.append("El archivo trae %d bodegas y se analizan sumadas por producto (el saldo por bodega no se usa). Para analizar cada bodega por separado activa por_bodega en la configuracion." % len(bodegas))

    def llave(sku, bodega):
        return "%s | %s" % (sku, bodega) if por_bodega else sku

    for m in movs:
        m["key"] = llave(m["sku"], m["bodega"])
        if not por_bodega and len(bodegas) > 1:
            m["saldo"] = None

    # maestro
    maestro = {}
    if filas_mae:
        enc_mae = list(filas_mae[0].keys())
        col_mae = detectar_columnas(enc_mae, cfg.get("mapeo_maestro") or cfg.get("mapeo"), ["sku", "producto", "unidad", "stock_actual", "costo_unitario", "lead_time_dias", "lead_time_desv_dias", "moq", "en_transito", "fecha_llegada_transito", "proveedor", "activo", "vida_util_dias", "bodega"])
        utiles = {"stock_actual": "stock actual", "costo_unitario": "costo", "lead_time_dias": "plazo de entrega", "moq": "pedido minimo", "en_transito": "pedidos en transito", "proveedor": "proveedor"}
        faltan = [nombre for campo, nombre in utiles.items() if not col_mae.get(campo)]
        if col_mae.get("sku") and faltan:
            avisos.append("Columnas del maestro que no se reconocieron (se usan valores por defecto o se omiten): %s. Columnas recibidas: %s. Si existen con otro nombre, indicalo en el mapeo de la configuracion." % (", ".join(faltan), ", ".join(enc_mae[:14])))
        if not col_mae.get("sku"):
            avisos.append("El maestro de productos no tiene columna de codigo reconocible: se ignora.")
        else:
            for fila in filas_mae:
                sku = texto(fila.get(col_mae["sku"])).strip()
                if not sku:
                    continue

                def num(campo, fila=fila):
                    n = parsear_numero(fila.get(col_mae[campo])) if col_mae.get(campo) else float("nan")
                    return n if es_finito(n) else None

                activo_txt = norm(fila.get(col_mae["activo"])) if col_mae.get("activo") else ""
                llegada = parsear_fecha(fila.get(col_mae["fecha_llegada_transito"]), formato_fecha) if col_mae.get("fecha_llegada_transito") else None
                bodega = texto(fila.get(col_mae["bodega"])).strip() if col_mae.get("bodega") else ""
                maestro[llave(sku, bodega)] = {
                    "sku": sku, "nombre": texto(fila.get(col_mae["producto"])).strip() if col_mae.get("producto") else "",
                    "unidad": texto(fila.get(col_mae["unidad"])).strip() if col_mae.get("unidad") else "",
                    "stock_actual": num("stock_actual"), "costo": num("costo_unitario"), "lead_time": num("lead_time_dias"),
                    "lead_time_desv": num("lead_time_desv_dias"), "moq": num("moq"), "en_transito": num("en_transito") or 0,
                    "llegada_transito": llegada["dia"] if llegada else None,
                    "proveedor": texto(fila.get(col_mae["proveedor"])).strip() if col_mae.get("proveedor") else "",
                    "activo": activo_txt not in ("no", "inactivo", "0", "false", "descontinuado", "baja"),
                    "vida_util": num("vida_util_dias"),
                }
    else:
        avisos.append("No se leyo el maestro de productos: no se puede detectar los productos que nunca se movieron ni usar el stock actual, el costo y el plazo de entrega del sistema.")
    skus_mov = list(dict.fromkeys(m["key"] for m in movs))
    set_mov = set(skus_mov)
    calidad["skus_sin_maestro"] = [k for k in skus_mov if k not in maestro] if maestro else []
    calidad["maestro_sin_movimientos"] = sum(1 for k in maestro if k not in set_mov) if maestro else 0
    if calidad["skus_sin_maestro"]:
        avisos.append("Productos con movimientos que no estan en el maestro: %d (%s). Se analizan sin stock actual, plazo ni costo del sistema." % (len(calidad["skus_sin_maestro"]), ", ".join(calidad["skus_sin_maestro"][:4])))
    return {"movs": movs, "maestro": maestro, "avisos": avisos, "calidad": calidad, "porBodega": por_bodega, "bodegas": bodegas}
