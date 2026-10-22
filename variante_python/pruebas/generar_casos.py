"""Genera los casos de prueba de equivalencia entre el motor de JavaScript (n8n) y el de Python.

Los datos son sinteticos y deterministas (semilla fija). Se guardan en casos/*.json para que los lean los dos motores:
cada caso trae filas de movimientos y de productos tal como las entregan los lectores (listas de diccionarios), la
configuracion y el mes del informe. Incluyen lo que traen los sistemas reales: fechas en varios formatos, numeros con
coma o punto decimal, tipos de movimiento escritos de muchas formas, saldo parcial, bodegas y nombres hostiles.

Uso: python generar_casos.py
"""
import json
import os
import random
from datetime import date, timedelta

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.join(AQUI, "casos")
os.makedirs(SALIDA, exist_ok=True)

INICIO = date(2025, 11, 1)
FIN = date(2026, 9, 30)

VENTAS = ["VENTA", "Venta factura", "Salida por consumo", "Despacho", "venta mostrador"]
COMPRAS = ["COMPRA", "Entrada por compra", "Recepcion de mercancia", "Ingreso"]


def serial_excel(d):
    return (d - date(1899, 12, 30)).days


def formato_fecha(rng, d):
    """Escribe la fecha en uno de los formatos que se ven en los archivos reales."""
    r = rng.random()
    if r < 0.55:
        return d.isoformat()
    if r < 0.75:
        return "%02d/%02d/%04d" % (d.day, d.month, d.year)
    if r < 0.85:
        return serial_excel(d)
    if r < 0.92:
        return "%04d/%02d/%02d" % (d.year, d.month, d.day)
    return d.isoformat() + "T00:00:00.000Z"


def formato_cantidad(rng, q):
    r = rng.random()
    if r < 0.6:
        return q
    if r < 0.8:
        return str(q)
    if q >= 1000:
        return "{:,}".format(q).replace(",", ".")
    return str(q) + ",0" if r < 0.9 else "%s,5" % q


def caso_sucio(seed=42, n_skus=26):
    rng = random.Random(seed)
    movs, maestro = [], []
    patrones = ["estable", "estable", "intermitente", "muerto", "nuevo", "nunca", "quiebre", "sobrestock", "estable", "intermitente"]
    doc = 1
    for i in range(n_skus):
        sku = "P-%03d" % i
        patron = patrones[i % len(patrones)]
        costo = round(rng.uniform(3, 400), 2)
        plazo = rng.choice([7, 10, 15, 21, 30, None])
        moq = rng.choice([None, 1, 6, 12, 50])
        transito = rng.choice([0, 0, 0, 40, 200])
        stock = 0
        con_saldo = rng.random() < 0.5
        d0 = INICIO if patron != "nuevo" else date(2026, 8, 5)
        filas = []
        if patron == "sobrestock":
            stock = 5000
            filas.append((d0, "SALDO INICIAL", 5000))
        elif patron == "nunca":
            stock = 30
            filas.append((d0, "SALDO INICIAL", 30))
        else:
            stock = 100
            filas.append((d0, "SALDO INICIAL", 100))
        d = d0
        while d <= FIN:
            d += timedelta(days=1)
            if d > FIN or patron == "nunca":
                continue
            if patron == "estable" and rng.random() < 0.7:
                filas.append((d, rng.choice(VENTAS), rng.randint(1, 6)))
            elif patron == "intermitente" and rng.random() < 0.06:
                filas.append((d, rng.choice(VENTAS), rng.randint(5, 30)))
            elif patron == "muerto" and d < date(2026, 3, 1) and rng.random() < 0.4:
                filas.append((d, rng.choice(VENTAS), rng.randint(1, 4)))
            elif patron == "nuevo" and rng.random() < 0.5:
                filas.append((d, rng.choice(VENTAS), rng.randint(1, 5)))
            elif patron == "quiebre" and rng.random() < 0.8:
                filas.append((d, rng.choice(VENTAS), rng.randint(2, 8)))
            elif patron == "sobrestock" and rng.random() < 0.05:
                filas.append((d, rng.choice(VENTAS), rng.randint(1, 3)))
            # compras periodicas (el producto con quiebre casi no se repone)
            if patron in ("estable", "intermitente", "nuevo") and rng.random() < 0.025:
                filas.append((d, rng.choice(COMPRAS), rng.randint(40, 120)))
            if patron == "quiebre" and rng.random() < 0.004:
                filas.append((d, rng.choice(COMPRAS), rng.randint(30, 60)))
            # ruido: devoluciones, ajustes, traslados y tipos que no se reconocen
            r = rng.random()
            if r < 0.004:
                filas.append((d, "DEVOLUCION VENTA", rng.randint(1, 2)))
            elif r < 0.007:
                filas.append((d, "Devolucion a proveedor", rng.randint(1, 3)))
            elif r < 0.010:
                filas.append((d, "AJUSTE NEGATIVO", rng.randint(1, 2)))
            elif r < 0.012:
                filas.append((d, "Ajuste positivo", rng.randint(1, 2)))
            elif r < 0.014:
                filas.append((d, "Traslado entrada", rng.randint(5, 10)))
            elif r < 0.015:
                filas.append((d, "Cosa rara", 3))
        saldo = 0
        for (dia, tipo, q) in filas:
            t = tipo.lower()
            if "saldo inicial" in t or "compra" in t or "recepcion" in t or "ingreso" in t or "devolucion venta" in t or "positivo" in t or "traslado entrada" in t:
                saldo += q
            elif "cosa rara" in t:
                pass
            else:
                saldo -= q
            fila = {
                "Fecha movimiento": formato_fecha(rng, dia), "Código": sku, "Descripción": "Producto %d" % i,
                "Tipo de movimiento": tipo, "Cantidad": formato_cantidad(rng, q), "Costo": costo,
                "Saldo": saldo if con_saldo else "", "Documento": "D%d" % doc if rng.random() < 0.5 else "",
            }
            doc += 1
            movs.append(fila)
        # fila rota de vez en cuando
        if rng.random() < 0.3:
            movs.append({"Fecha movimiento": "ayer", "Código": sku, "Descripción": "", "Tipo de movimiento": "VENTA", "Cantidad": 2, "Costo": "", "Saldo": "", "Documento": ""})
        if rng.random() < 0.2:
            movs.append({"Fecha movimiento": "2026-02-30", "Código": sku, "Descripción": "", "Tipo de movimiento": "VENTA", "Cantidad": "1.234,5", "Costo": "", "Saldo": "", "Documento": ""})
        if rng.random() < 0.15:
            movs.append({"Fecha movimiento": "2026-09-01", "Código": sku, "Descripción": "", "Tipo de movimiento": "VENTA", "Cantidad": "abc", "Costo": "", "Saldo": "", "Documento": ""})
        mae = {"Código": sku, "Descripción": "Producto %d" % i, "Unidad": "unid", "Existencia actual": max(0, saldo) + rng.choice([0, 0, 0, 3, -2]),
               "Costo": costo, "Plazo de entrega (días)": plazo if plazo is not None else "", "Pedido mínimo": moq if moq is not None else "",
               "Por recibir": transito, "Proveedor": "Prov %d" % (i % 4), "Estado": "Inactivo" if i == 7 else "Activo"}
        if patron == "sobrestock":
            mae["Existencia actual"] = 5000 - 20
        maestro.append(mae)
    # un producto en el maestro que nunca aparece en los movimientos y un producto con movimientos que no esta en el maestro
    maestro.append({"Código": "P-NUNCA", "Descripción": "Nunca visto", "Unidad": "unid", "Existencia actual": 12, "Costo": 10, "Plazo de entrega (días)": 15,
                    "Pedido mínimo": "", "Por recibir": 0, "Proveedor": "Prov 0", "Estado": "Activo"})
    movs.append({"Fecha movimiento": "2026-09-10", "Código": "P-HUERFANO", "Descripción": "Sin maestro", "Tipo de movimiento": "VENTA", "Cantidad": 4, "Costo": 5, "Saldo": "", "Documento": ""})
    movs.append({"Fecha movimiento": "2026-09-11", "Código": "P-HUERFANO", "Descripción": "Sin maestro", "Tipo de movimiento": "VENTA", "Cantidad": 2, "Costo": 5, "Saldo": "", "Documento": ""})
    return {"movimientos": movs, "maestro": maestro, "cfg": {"fuente": "csv", "moneda": "$", "parametros": {"sector": "comercio"}}, "mes": "2026-09"}


def caso_separadas_mensual(seed=7):
    """Entradas y salidas en columnas separadas, con fechas por mes (sin saldo diario posible)."""
    rng = random.Random(seed)
    movs, maestro = [], []
    for i in range(12):
        sku = "M-%02d" % i
        for k in range(12):
            total = 2025 * 12 + 9 + k  # de octubre de 2025 a septiembre de 2026
            y, m = total // 12, total % 12 + 1
            movs.append({"Fecha": "%04d-%02d" % (y, m), "Referencia": sku, "Entradas": rng.choice([0, 0, 50, 100]), "Salidas": rng.randint(0, 60), "Costo unitario": 12.5})
        maestro.append({"Referencia": sku, "Nombre": "Mensual %d" % i, "Stock": rng.randint(0, 300), "Costo unitario": 12.5, "Lead time": 20})
    return {"movimientos": movs, "maestro": maestro, "cfg": {"fuente": "csv", "moneda": "$"}, "mes": "2026-09"}


def caso_bodegas(seed=11, por_bodega=False):
    rng = random.Random(seed)
    movs, maestro = [], []
    for i in range(8):
        sku = "B-%02d" % i
        for b in ("Norte", "Sur"):
            saldo = 200
            movs.append({"fecha": "2026-01-05", "sku": sku, "tipo": "SALDO INICIAL", "cantidad": 200, "bodega": b, "saldo": saldo})
            d = date(2026, 1, 6)
            while d <= date(2026, 9, 30):
                if rng.random() < 0.3:
                    q = rng.randint(1, 8)
                    saldo -= q
                    movs.append({"fecha": d.isoformat(), "sku": sku, "tipo": "VENTA", "cantidad": q, "bodega": b, "saldo": saldo})
                if rng.random() < 0.02:
                    saldo += 100
                    movs.append({"fecha": d.isoformat(), "sku": sku, "tipo": "COMPRA", "cantidad": 100, "bodega": b, "saldo": saldo})
                d += timedelta(days=1)
            maestro.append({"sku": sku, "producto": "Bodega %d" % i, "bodega": b, "stock_actual": max(saldo, 0), "costo_unitario": 20 + i, "lead_time_dias": 12})
    return {"movimientos": movs, "maestro": maestro, "cfg": {"fuente": "csv", "moneda": "$", "por_bodega": por_bodega}, "mes": "2026-09"}


def caso_hostil(seed=3):
    """Nombres y proveedores que intentan inyectar formulas en CSV o marcado en HTML."""
    base = caso_sucio(seed=seed, n_skus=12)
    ataques = ['=HYPERLINK("http://evil.test","clic")', "@SUM(A1:A9)", "+cmd|' /C calc'!A0", "-2+3", "\t=1+1", "Tornillo, =1+1", "Acme; @SUM(A1:A9)",
               "<img src=x onerror=alert(1)>", "[clic](javascript:alert(1))", '"><script>alert(1)</script>', "<b onmouseover=alert(1)>x</b>", "Item\n=HYPERLINK(\"http://evil.test\")"]
    for fila, ataque in zip(base["maestro"], ataques):
        fila["Descripción"] = ataque
        fila["Proveedor"] = ataques[(ataques.index(ataque) + 3) % len(ataques)]
    return {"movimientos": base["movimientos"], "maestro": base["maestro"], "cfg": {"fuente": "csv", "moneda": "$"}, "mes": "2026-09"}


def caso_sin_columnas():
    """Columnas que no se reconocen: el motor debe devolver un error claro y no seguir."""
    return {"movimientos": [{"Mes": "2026-09", "Ref": "A", "Mov": 3}], "maestro": [], "cfg": {"fuente": "csv", "moneda": "$"}, "mes": "2026-09"}


CASOS = {
    "sucio_formatos": caso_sucio(),
    "separadas_mensual": caso_separadas_mensual(),
    "bodegas_sumadas": caso_bodegas(por_bodega=False),
    "bodegas_separadas": caso_bodegas(por_bodega=True),
    "hostil": caso_hostil(),
    "sin_columnas": caso_sin_columnas(),
}

if __name__ == "__main__":
    for nombre, caso in CASOS.items():
        ruta = os.path.join(SALIDA, nombre + ".json")
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(caso, f, ensure_ascii=False, separators=(",", ":"))
        print(nombre, "movimientos:", len(caso["movimientos"]), "productos:", len(caso["maestro"]), "bytes:", os.path.getsize(ruta))
