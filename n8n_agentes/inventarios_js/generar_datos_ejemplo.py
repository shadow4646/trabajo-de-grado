# -*- coding: utf-8 -*-
"""Genera un kardex de ejemplo (movimientos + maestro) con los casos que el agente de inventarios debe detectar.

Cada producto simula una politica de reposicion real (cuando la posicion baja del punto de reorden se pide hasta un
nivel maximo y llega tras el plazo de entrega), con ventas limitadas por el stock disponible: si el stock llega a cero,
las ventas se detienen, igual que en una bodega real. Los datos son inventados, solo sirven para probar el agente.

Uso: python generar_datos_ejemplo.py   (escribe en la carpeta datos_ejemplo/)
Mes del informe de ejemplo: 2026-09. Fecha de corte: 2026-09-30.
"""
import csv
import datetime as dt
import math
import pathlib
import random

SALIDA = pathlib.Path(__file__).parent / "datos_ejemplo"
INICIO = dt.date(2025, 8, 1)
FIN = dt.date(2026, 9, 30)
rnd = random.Random(42)


def dias():
    d = INICIO
    while d <= FIN:
        yield d
        d += dt.timedelta(days=1)


def mes(d):
    return (d.year - 2025) * 12 + d.month - 8  # 0 = agosto 2025


def d(txt):
    return dt.date.fromisoformat(txt)


def poisson(lam):
    """Demanda diaria entera. Poisson (algoritmo de Knuth) con la media variando de un dia a otro (sobredispersion)."""
    lam = max(0.0, lam * math.exp(rnd.gauss(0, 0.3)))
    if lam > 30:
        return max(0, round(rnd.gauss(lam, math.sqrt(lam))))
    limite, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rnd.random()
        if p <= limite:
            return k
        k += 1


# demanda diaria media segun el patron
def estable(base):
    return lambda f: base


def estacional(base, pico=1.8, meses=(6, 7, 8)):
    return lambda f: base * (pico if f.month in meses else 1.0)


def creciente(base, por_mes=0.04):
    return lambda f: base * (1 + por_mes) ** mes(f)


def hasta(base, ultimo):
    return lambda f: base if f <= d(ultimo) else 0.0


def desde(base, primero):
    return lambda f: base if f >= d(primero) else 0.0


def intermitente(prob, minimo, maximo):
    return ("intermitente", prob, minimo, maximo)


# sku, nombre, unidad, costo, lead (dias), moq, demanda, stock inicial, margen de seguridad del dueno,
# bloqueo de compras (inicio, fin) o None, en transito al corte, notas
P = [
    ("TOR-M6-20", "Tornillo M6x20 (caja x100)", "caja", 8.0, 15, 10, estable(12), 500, 1.3, None, 0),
    ("LAM-AC-2MM", "Lamina acero 2 mm", "unidad", 22.5, 30, 20, estable(1.8), 90, 1.2, ("2026-07-20", "2026-09-24"), 40),
    ("MOT-1HP", "Motor electrico 1 HP", "unidad", 180.0, 45, 1, estable(0.35), 14, 1.2, ("2026-06-15", "2026-12-31"), 0),
    ("EMP-CAJ-30", "Caja de carton 30x30", "unidad", 0.6, 7, 500, estable(90), 4000, 1.3, None, 0),
    ("ACE-HID-20L", "Aceite hidraulico 20 L", "unidad", 95.0, 20, 2, estable(0.0), 14, 1.0, None, 0),
    ("SEL-MEC-A", "Sello mecanico tipo A", "unidad", 40.0, 25, 1, hasta(0.12, "2026-03-20"), 25, 1.0, ("2026-03-21", "2026-12-31"), 0),
    ("LIJ-80", "Lija grano 80", "unidad", 1.2, 10, 100, estable(2.0), 400, 1.0, ("2026-01-10", "2026-12-31"), 0),
    ("VAL-BOL-1", "Valvula de bola 1 pulgada", "unidad", 15.0, 20, 5, intermitente(0.08, 4, 18), 40, 1.1, None, 0),
    ("FIL-AIR-X", "Filtro de aire X", "unidad", 30.0, 12, 5, desde(1.1, "2026-08-10"), 0, 1.3, None, 0),
    ("GUA-NIT-100", "Guantes de nitrilo (caja x100)", "caja", 12.0, 10, 10, estacional(3.0), 120, 1.3, None, 0),
    ("PIN-ESM-BL", "Pintura esmalte blanca 1 galon", "galon", 28.0, 14, 6, creciente(2.2), 90, 1.25, None, 0),
    ("TUB-PVC-2", "Tubo PVC 2 pulgadas", "unidad", 9.0, 10, 50, estable(14), 300, 1.2, None, 200),
    ("CAB-12AWG", "Cable 12 AWG (rollo)", "rollo", 55.0, 18, 5, estable(1.4), 40, 1.0, None, 0),
    ("BOM-SUM-3", "Bomba sumergible 3 HP", "unidad", 320.0, 40, 1, estable(0.06), 5, 1.0, None, 0),
    ("GRA-MULT", "Grasa multiproposito", "unidad", 6.0, 8, 24, estable(4.0), 150, 1.3, None, 0),
    ("ROD-6204", "Rodamiento 6204", "unidad", 7.0, 9, 20, estable(8), 200, 1.15, ("2026-09-01", "2026-09-14"), 0),
    ("CAS-AMA", "Casco de seguridad amarillo", "unidad", 9.0, 15, 12, estable(1.5), 300, 1.0, None, 0),
    ("PER-M8", "Perno M8 (caja x50)", "caja", 6.5, 12, 10, estable(6), 120, 1.25, None, 0),
    ("DIS-CORTE", "Disco de corte 4.5 pulgadas", "unidad", 2.8, 7, 50, estable(25), 600, 1.3, None, 0),
    ("SOL-6013", "Soldadura 6013 (kg)", "kg", 3.9, 10, 25, estable(8), 300, 1.25, None, 0),
    ("BAT-12V", "Bateria 12 V", "unidad", 85.0, 20, 1, hasta(0.1, "2026-06-10"), 6, 1.0, ("2026-06-11", "2026-12-31"), 0),
    ("MAN-HID-12", "Manguera hidraulica 1/2 pulgada", "metro", 18.0, 25, 10, intermitente(0.012, 10, 30), 60, 1.0, None, 0),
    ("TIN-GAL", "Tinner galon", "galon", 8.0, 7, 12, estable(3.0), 90, 1.3, None, 0),
    ("ETI-ADH-R", "Etiqueta adhesiva rollo", "rollo", 3.0, 10, 20, estable(0.0), 500, 1.0, None, 0),
]


EXTRA = {
    "ROD-6204": {"maximo_dias": 5, "margen": 1.0},
    "LAM-AC-2MM": {"maximo_dias": 10, "margen": 1.0},
    "LIJ-80": {"compras": [("2026-01-10", 3000)]},
}


def simular(sku, nombre, unidad, costo, lead, moq, dem, stock0, margen, bloqueo, transito):
    extra = EXTRA.get(sku, {})
    margen = extra.get("margen", margen)
    compras_extra = {d(f): q for f, q in extra.get("compras", [])}
    filas = []
    stock = 0
    pipeline = []  # (llegada, cantidad)
    if stock0 > 0:
        stock = stock0
        filas.append((INICIO, "SALDO INICIAL", stock0))
    media_ref = None
    for f in dias():
        # llegadas
        for llegada, q in [x for x in pipeline if x[0] <= f]:
            stock += q
            filas.append((f, "COMPRA", q))
        pipeline = [x for x in pipeline if x[0] > f]
        if f in compras_extra:
            stock += compras_extra[f]
            filas.append((f, "COMPRA", compras_extra[f]))
        # demanda del dia
        if isinstance(dem, tuple):
            _, prob, mn, mx = dem
            pedido = rnd.randint(mn, mx) if rnd.random() < prob else 0
            media = prob * (mn + mx) / 2
        else:
            media = dem(f)
            pedido = poisson(media) if media > 0 else 0
        if media_ref is None or media > 0:
            media_ref = media if media > 0 else media_ref
        venta = min(pedido, stock)
        if venta > 0:
            stock -= venta
            filas.append((f, "VENTA", venta))
        # devoluciones de clientes y ajustes ocasionales
        if venta > 3 and rnd.random() < 0.01:
            q = max(1, venta // 4)
            stock += q
            filas.append((f, "DEVOLUCION VENTA", q))
        if stock > 5 and rnd.random() < 0.004:
            q = rnd.randint(1, 3)
            if rnd.random() < 0.5:
                stock -= q
                filas.append((f, "AJUSTE NEGATIVO", q))
            else:
                stock += q
                filas.append((f, "AJUSTE POSITIVO", q))
        # revision diaria: pedir hasta el maximo si la posicion baja del punto de reorden
        base = media_ref or 0
        if base > 0:
            reorden = base * (lead + 7) * margen
            maximo = reorden + base * extra.get('maximo_dias', 30)
            posicion = stock + sum(q for _, q in pipeline)
            bloqueada = bloqueo and d(bloqueo[0]) <= f <= d(bloqueo[1])
            if posicion <= reorden and not bloqueada and not pipeline:
                q = math.ceil((maximo - posicion) / moq) * moq
                if q > 0:
                    pipeline.append((f + dt.timedelta(days=lead + rnd.randint(0, 3)), q))
    return filas, stock


def main():
    SALIDA.mkdir(exist_ok=True)
    movs = []
    maestro = []
    for sku, nombre, unidad, costo, lead, moq, dem, stock0, margen, bloqueo, transito in P:
        filas, stock = simular(sku, nombre, unidad, costo, lead, moq, dem, stock0, margen, bloqueo, transito)
        filas.sort(key=lambda x: x[0])
        saldo = 0
        for f, tipo, q in filas:
            if tipo in ("SALDO INICIAL", "COMPRA", "DEVOLUCION VENTA", "AJUSTE POSITIVO"):
                saldo += q
            else:
                saldo -= q
            movs.append({"fecha": f.isoformat(), "sku": sku, "producto": nombre, "tipo": tipo, "cantidad": q,
                         "costo_unitario": f"{costo:.2f}", "saldo": saldo})
        # el SKU que nunca se movio solo existe en el maestro
        if sku in ("ACE-HID-20L", "ETI-ADH-R"):
            saldo = stock0
        maestro.append({"sku": sku, "producto": nombre, "unidad": unidad, "stock_actual": saldo, "costo_unitario": f"{costo:.2f}",
                        "lead_time_dias": lead, "moq": moq, "en_transito": transito, "proveedor": f"Proveedor {sku[:3]}"})
    # los SKU que nunca se movieron no tienen ninguna fila de kardex salvo un saldo inicial viejo: se quita
    movs = [m for m in movs if m["sku"] not in ("ACE-HID-20L", "ETI-ADH-R")]
    # datos sucios para probar la normalizacion: fila duplicada, SKU que no esta en el maestro, costo faltante
    movs.append(dict(movs[100]))
    movs.append({"fecha": "2026-09-14", "sku": "FANTASMA-01", "producto": "Producto sin maestro", "tipo": "VENTA", "cantidad": 3,
                 "costo_unitario": "", "saldo": ""})
    movs.sort(key=lambda m: (m["fecha"], m["sku"]))
    with open(SALIDA / "movimientos_ejemplo.csv", "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["fecha", "sku", "producto", "tipo", "cantidad", "costo_unitario", "saldo"])
        w.writeheader()
        w.writerows(movs)
    with open(SALIDA / "maestro_ejemplo.csv", "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["sku", "producto", "unidad", "stock_actual", "costo_unitario", "lead_time_dias", "moq", "en_transito", "proveedor"])
        w.writeheader()
        w.writerows(maestro)
    print("movimientos:", len(movs), "| productos en el maestro:", len(maestro))


if __name__ == "__main__":
    main()
