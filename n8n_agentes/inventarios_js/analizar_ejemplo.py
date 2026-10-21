# Resumen rapido de los datos de ejemplo (solo para comprobar que los escenarios existen)
import csv, collections, sys
movs = list(csv.DictReader(open("datos_ejemplo/movimientos_ejemplo.csv", encoding="utf-8")))
mae = {m["sku"]: m for m in csv.DictReader(open("datos_ejemplo/maestro_ejemplo.csv", encoding="utf-8"))}
por = collections.defaultdict(list)
for m in movs: por[m["sku"]].append(m)
print(f'{"sku":<13}{"movs":>5} {"ventas sep":>10} {"ult venta":>11} {"dias en 0 sep":>13} {"stock fin":>9} {"transito":>8}')
for sku in mae:
    mm = por.get(sku, [])
    ventas = [m for m in mm if m["tipo"] == "VENTA"]
    sep = sum(int(m["cantidad"]) for m in ventas if m["fecha"].startswith("2026-09"))
    ult = max((m["fecha"] for m in ventas), default="-")
    saldo = {m["fecha"]: int(m["saldo"]) for m in mm if m["saldo"] != ""}
    previos = [v for k, v in sorted(saldo.items()) if k < "2026-09-01"]
    ultimo = previos[-1] if previos else None
    cero = 0
    for i in range(1, 31):
        f = f"2026-09-{i:02d}"
        if f in saldo: ultimo = saldo[f]
        if ultimo is not None and ultimo <= 0: cero += 1
    print(f'{sku:<13}{len(mm):>5} {sep:>10} {ult:>11} {cero:>13} {mae[sku]["stock_actual"]:>9} {mae[sku]["en_transito"]:>8}')
