"""Pruebas del motor de Python con resultados conocidos: formulas contra ejemplos numericos, reglas de decision y datos sucios.

Es el port de n8n_agentes/inventarios_js/test_motor.js. Independiente de las referencias de equivalencia: si las dos
variantes compartieran un mismo error, estas pruebas lo detectarian porque comparan contra valores calculados a mano.
Uso: python -m unittest pruebas.test_unitarios -v   (desde la carpeta variante_python)
"""
import math
import time
import unittest

from agente_inventarios import motor, util
from agente_inventarios.normalizar import clasificar_tipo, detectar_columnas, normalizar

D0 = util.dia_num("2026-09-01")
EFECTO = {"entrada": 1, "salida": -1, "saldo_inicial": 1}


def mov(dia, tipo, cant, saldo=None):
    return {"idx": dia, "dia": D0 + dia, "tipo": tipo, "cantidad": cant, "efecto": EFECTO[tipo] * cant, "saldo": saldo, "key": "A", "sku": "A"}


def fila(f, s, t, c, **extra):
    return {"Fecha": f, "Codigo": s, "Tipo": t, "Cantidad": c, **extra}


class TestFormulas(unittest.TestCase):
    def test_stock_de_seguridad_ejemplos_de_la_investigacion(self):
        # Ejemplo 1: demanda 100/semana, sigma 20/semana, plazo 3 semanas, Z 1,645: SS = 57
        ss1 = motor.stock_seguridad({"n": 12, "sigma": 20 * math.sqrt(30 / 7), "demandaMes": (100 * 30) / 7, "sigmaL": 0, "Z": 1.645}, 21)
        self.assertAlmostEqual(ss1, 57, delta=0.6)
        # Ejemplo 2: demanda 50/dia, plazo 7 dias con sigma 2, sigma diaria 10, Z 1,65: SS = 171 y ROP = 521
        ss2 = motor.stock_seguridad({"n": 12, "sigma": 10 * math.sqrt(30), "demandaMes": 1500, "sigmaL": 2, "Z": 1.65}, 7)
        self.assertAlmostEqual(ss2, 171, delta=0.6)
        self.assertAlmostEqual(50 * 7 + ss2, 521, delta=0.6)

    def test_stock_de_seguridad_con_pocos_meses_usa_maximo_menos_promedio(self):
        self.assertAlmostEqual(motor.stock_seguridad({"n": 4, "sigma": 10, "demandaMes": 100, "maximo": 130, "Z": 2}, 15), 15, delta=0.001)

    def test_politica_r_s(self):
        P = motor.DEFECTOS
        base = {"demandaMes": 300, "sigma": 30, "maximo": 340, "n": 12, "Z": 1.645, "L": 15, "sigmaL": 0, "R": 30, "moq": 10}
        self.assertFalse(motor.politica({**base, "stock": 500, "transito": 0}, P)["comprar"])
        self.assertTrue(motor.politica({**base, "stock": 400, "transito": 0}, P)["comprar"])
        b = motor.politica({**base, "stock": 120, "transito": 0}, P)
        self.assertTrue(b["comprar"] and b["cantidad"] > 0 and b["cantidad"] % 10 == 0)
        self.assertFalse(motor.politica({**base, "stock": 120, "transito": 400}, P)["comprar"], "el pedido en transito evita la compra")
        self.assertGreater(b["S"], 10 * (15 + 30), "el stock de seguridad sube el nivel objetivo")
        self.assertTrue(motor.politica({**base, "stock": 100, "transito": 0}, P)["urgente"])
        d = motor.politica({**base, "stock": 200, "transito": 0}, P)
        self.assertTrue(d["comprar"] and d["cobertura"] > 15, "compra aunque la cobertura supere el plazo (la revision es mensual)")


class TestSerieYMeses(unittest.TestCase):
    def setUp(self):
        self.ledger = [mov(0, "saldo_inicial", 10), mov(2, "salida", 6), mov(5, "salida", 4), mov(9, "entrada", 20), mov(12, "salida", 5)]

    def test_saldo_reconstruido_desde_el_stock_actual(self):
        s1 = motor.construir_serie(self.ledger, 15, D0 + 14)
        self.assertEqual(s1["base"], "stock_actual")
        self.assertEqual(s1["bal"][14], 15)
        self.assertEqual(s1["bal"][5], 0)

    def test_saldo_del_sistema_y_descuadre(self):
        con_saldo = [mov(0, "saldo_inicial", 10, 10), mov(2, "salida", 6, 4), mov(5, "salida", 4, 0), mov(9, "entrada", 20, 20), mov(12, "salida", 5, 15)]
        s2 = motor.construir_serie(con_saldo, 14, D0 + 14)
        self.assertEqual(s2["base"], "saldo")
        self.assertAlmostEqual(s2["descuadre"], -1, delta=0.001)

    def test_sin_ancla(self):
        self.assertEqual(motor.construir_serie(self.ledger, None, D0 + 14)["base"], "asumido_cero")

    def test_dias_en_cero_salidas_y_dias_con_salida(self):
        s1 = motor.construir_serie(self.ledger, 15, D0 + 14)
        meses = motor.agregar_meses(self.ledger, s1, "2026-09", 2, D0 + 14, True)
        sep = meses[-1]
        self.assertEqual(sep["dias_en_cero"], 4)
        self.assertEqual(sep["salidas"], 15)
        self.assertEqual(sep["dias_con_salida"], 3)


class TestDemandaYPronostico(unittest.TestCase):
    def test_demanda_censurada(self):
        P = motor.DEFECTOS
        self.assertAlmostEqual(motor.demanda_ajustada({"activos": 30, "dias_mes": 30, "demanda_neta": 100, "dias_en_cero": 10}, P), 150, delta=0.001)
        self.assertAlmostEqual(motor.demanda_ajustada({"activos": 30, "dias_mes": 30, "demanda_neta": 100, "dias_en_cero": 15}, {**P, "tope_censura": 1.5}), 150, delta=0.001)
        self.assertIsNone(motor.demanda_ajustada({"activos": 30, "dias_mes": 30, "demanda_neta": 100, "dias_en_cero": 16}, P), "mas de la mitad en cero es dato faltante")
        self.assertIsNone(motor.demanda_ajustada({"activos": 10, "dias_mes": 30, "demanda_neta": 5, "dias_en_cero": 0}, P), "mes parcial corto se excluye")
        self.assertAlmostEqual(motor.demanda_ajustada({"activos": 20, "dias_mes": 30, "demanda_neta": 20, "dias_en_cero": 0}, P), 30, delta=0.001)

    def test_croston_sba_y_patrones(self):
        P = motor.DEFECTOS
        self.assertAlmostEqual(motor.croston_sba([0, 0, 10, 0, 0, 10, 0, 0, 10], 0.2), 0.9 * (10 / 3), delta=0.001)
        self.assertEqual(motor.pronosticar([100, 105, 98, 102, 101, 99, 103], P)["patron"], "suave")
        self.assertEqual(motor.pronosticar([0, 0, 10, 0, 0, 11, 0, 0, 9, 0], P)["patron"], "intermitente")
        self.assertEqual(motor.pronosticar([0, 0, 2, 0, 0, 40, 0, 0, 5, 0], P)["patron"], "irregular")
        self.assertEqual(motor.pronosticar([10, 90, 15, 80, 5, 70], P)["patron"], "erratica")
        self.assertEqual(motor.pronosticar([5, 6], P)["confianza"], "BAJA")
        self.assertIn("exponencial", motor.pronosticar([10, 12, 11, 13, 12, 14, 13], P)["metodo"])
        self.assertIn("movil", motor.pronosticar([10, 12, 11, 13], P)["metodo"])


class TestLectura(unittest.TestCase):
    def test_fechas_y_numeros(self):
        self.assertEqual(util.iso_de(util.parsear_fecha("14/09/2026")["dia"]), "2026-09-14")
        self.assertEqual(util.iso_de(util.parsear_fecha(46279)["dia"]), "2026-09-14")
        self.assertEqual(util.iso_de(util.parsear_fecha("2026-09-30T00:00:00.000Z")["dia"]), "2026-09-30")
        self.assertTrue(util.parsear_fecha("2026-09")["mensual"])
        self.assertIsNone(util.parsear_fecha("nada"))
        self.assertEqual(util.parsear_numero("1.234,56"), 1234.56)
        self.assertEqual(util.parsear_numero("1,234.56"), 1234.56)
        self.assertEqual(util.parsear_numero("1.200"), 1200)
        self.assertTrue(math.isnan(util.parsear_numero("abc")))
        self.assertTrue(math.isnan(util.parsear_numero("0x10")), "un hexadecimal no es una cantidad")
        self.assertTrue(math.isnan(util.parsear_numero("1_000")))
        self.assertEqual(util.parsear_numero("1e3"), 1000)

    def test_fechas_fuera_de_rango_se_desbordan_como_en_javascript(self):
        # El prototipo con n8n usa Date.UTC: el 30 de febrero pasa al 2 de marzo. El port lo replica para que den lo mismo.
        self.assertEqual(util.iso_de(util.parsear_fecha("2026-02-30")["dia"]), "2026-03-02")
        self.assertEqual(util.iso_de(util.parsear_fecha("2024-02-29")["dia"]), "2024-02-29")
        self.assertEqual(util.iso_de(util.parsear_fecha("2025-02-29")["dia"]), "2025-03-01")

    def test_meses_de_28_29_y_31_dias(self):
        self.assertEqual([util.dias_del_mes(m) for m in ("2026-02", "2024-02", "2026-04", "2026-12")], [28, 29, 30, 31])
        self.assertEqual(util.iso_de(util.ultimo_dia_mes("2024-02")), "2024-02-29")

    def test_redondeo_y_formato_como_javascript(self):
        self.assertEqual(util.js_round(2.5), 3)
        self.assertEqual(util.js_round(-2.5), -2)
        self.assertEqual(util.js_round(0.49999999999999994), 0)
        self.assertEqual(util.js_to_fixed(6.25, 1), "6.3", "toFixed redondea el empate hacia arriba; format() de Python lo hace al par")
        self.assertEqual(util.js_str(5.0), "5")
        self.assertEqual(util.miles(1234567), "1.234.567")
        self.assertEqual(util.suma([0.1, 0.2, 0.3]), 0.1 + 0.2 + 0.3, "suma de izquierda a derecha, sin la compensacion de sum()")

    def test_tipos_y_columnas(self):
        tipos = {"VENTA": "salida", "COMPRA": "entrada", "DEVOLUCION VENTA": "devolucion_cliente", "Devolucion a proveedor": "devolucion_proveedor", "AJUSTE NEGATIVO": "ajuste_neg",
                 "AJUSTE POSITIVO": "ajuste_pos", "SALDO INICIAL": "saldo_inicial", "Traslado entrada": "traslado_entrada", "merma por vencimiento": "ajuste_neg", "xyz": "desconocido"}
        for t, e in tipos.items():
            self.assertEqual(clasificar_tipo(t, 1), e, t)
        cols = detectar_columnas(["Código", "Fecha movimiento", "Descripción", "Tipo de movimiento", "Cantidad", "Costo"], {}, ["sku", "fecha", "producto", "tipo", "cantidad", "costo_unitario"])
        self.assertEqual((cols["sku"], cols["fecha"], cols["tipo"], cols["cantidad"], cols["costo_unitario"]), ("Código", "Fecha movimiento", "Tipo de movimiento", "Cantidad", "Costo"))
        cols_mae = detectar_columnas(["Código", "Descripción", "Unidad", "Existencia actual", "Costo", "Plazo de entrega (días)", "Pedido mínimo", "Por recibir", "Proveedor"], {},
                                     ["sku", "producto", "unidad", "stock_actual", "costo_unitario", "lead_time_dias", "moq", "en_transito", "proveedor"])
        self.assertEqual(len(cols_mae), 9)
        self.assertEqual((cols_mae["en_transito"], cols_mae["lead_time_dias"]), ("Por recibir", "Plazo de entrega (días)"))
        self.assertEqual(detectar_columnas(["ID", "Cant"], {"sku": "ID", "cantidad": "Cant"}, ["sku", "cantidad"]), {"sku": "ID", "cantidad": "Cant"})
        self.assertIn("error", normalizar([{"a": 1}], [], {"mapeo": {}}))


class TestDatosSucios(unittest.TestCase):
    def test_solo_filas_validas_y_descartes_por_motivo(self):
        d = normalizar([fila("2026-09-01", "A", "VENTA", 5), fila("2026-09-02", "A", "Cosa rara", 3), fila("fecha mala", "A", "VENTA", 1), fila("2026-09-03", "", "VENTA", 1),
                        fila("2026-09-04", "A", "VENTA", "abc"), fila("2026-09-05", "A", "VENTA", 0)], [], {"mapeo": {}})
        self.assertEqual(len(d["movs"]), 1)
        desc = d["calidad"]["descartadas"]
        self.assertEqual(len(desc), 5)
        self.assertTrue(any("tipo de movimiento no reconocido" in k for k in desc))
        self.assertEqual((desc["fecha invalida"], desc["sin codigo de producto"], desc["cantidad invalida"], desc["cantidad cero"]), (1, 1, 1, 1))

    def test_columnas_separadas_signo_y_mensual(self):
        s = normalizar([{"Fecha": "2026-09-01", "Codigo": "A", "Entradas": 10, "Salidas": ""}, {"Fecha": "2026-09-02", "Codigo": "A", "Entradas": "", "Salidas": 4}], [], {"mapeo": {}})
        self.assertEqual([m["tipo"] for m in s["movs"]], ["entrada", "salida"])
        t = normalizar([{"Fecha": "2026-09-01", "Codigo": "A", "Cantidad": 10}, {"Fecha": "2026-09-02", "Codigo": "A", "Cantidad": -4}], [], {"mapeo": {}})
        self.assertEqual(t["movs"][1]["tipo"], "salida")
        self.assertTrue(any("columna de tipo" in a for a in t["avisos"]))
        m = normalizar([{"Fecha": "2026-08", "Codigo": "A", "Tipo": "VENTA", "Cantidad": 10}, {"Fecha": "2026-09", "Codigo": "A", "Tipo": "VENTA", "Cantidad": 12}], [], {"mapeo": {}})
        self.assertTrue(m["calidad"]["granularidad_mensual"] and any("por mes" in a for a in m["avisos"]))
        res = motor.calcular_inventario(m, {"mes": "2026-09"}, {})
        self.assertTrue(all(r["dias_en_cero"] is None for r in res["resultados"]), "con fechas por mes no se inventan quiebres")

    def test_bodegas_duplicados_y_maestro_incompleto(self):
        b = normalizar([fila("2026-09-01", "A", "VENTA", 2, Bodega="Norte", Saldo=5), fila("2026-09-02", "A", "VENTA", 2, Bodega="Sur", Saldo=9)], [], {"mapeo": {}})
        self.assertTrue(any("bodegas" in a for a in b["avisos"]) and all(m["saldo"] is None for m in b["movs"]))
        c = normalizar([fila("2026-09-01", "A", "VENTA", 2, Documento="F-1"), fila("2026-09-01", "A", "VENTA", 2, Documento="F-1"), fila("2026-09-01", "A", "VENTA", 2, Documento="F-2")], [], {"mapeo": {}})
        self.assertEqual(len(c["movs"]), 2)
        d = normalizar([fila("2026-09-01", "A", "VENTA", 2), fila("2026-09-01", "A", "VENTA", 2)], [], {"mapeo": {}})
        self.assertTrue(len(d["movs"]) == 2 and any("identicas" in a for a in d["avisos"]))
        e = normalizar([fila("2026-09-01", "A", "VENTA", 2)], [{"Codigo": "A", "Nombre": "Algo"}], {"mapeo": {}})
        self.assertTrue(any("no se reconocieron" in a and "plazo de entrega" in a for a in e["avisos"]))

    def test_saldo_negativo_y_descuadre(self):
        d = normalizar([fila("2026-09-01", "A", "COMPRA", 5, Saldo=5), fila("2026-09-02", "A", "VENTA", 9, Saldo=-4)], [{"Codigo": "A", "Existencia": 0, "Costo": 1, "Plazo de entrega": 10}], {"mapeo": {}})
        r = motor.calcular_inventario(d, {"mes": "2026-09"}, {})
        self.assertEqual(r["calidad"]["saldo_negativo"], ["A"])
        self.assertEqual(len(r["calidad"]["descuadres"]), 1)
        self.assertEqual(r["calidad"]["descuadres"][0]["diferencia"], 4)
        self.assertEqual(r["resultados"][0]["stock"], 0, "el stock negativo se trata como cero en la decision")

    def test_producto_sin_stock_conocido_no_se_compra(self):
        d = normalizar([fila("2026-09-01", "Z", "VENTA", 2), fila("2026-09-02", "Z", "VENTA", 3)], [{"Codigo": "OTRO", "Nombre": "x", "Existencia": 5}], {"mapeo": {}})
        r = motor.calcular_inventario(d, {"mes": "2026-09"}, {})
        z = next(x for x in r["resultados"] if x["sku"] == "Z")
        self.assertEqual(z["accion"], "REVISAR DATOS")
        self.assertEqual(z["cantidad"], 0)


class TestVolumen(unittest.TestCase):
    def test_kardex_de_200_mil_movimientos(self):
        grande = [fila("2026-0%d-%02d" % (1 + i % 9, 1 + i % 28), "A", "VENTA", 1) for i in range(200000)]
        t0 = time.time()
        d = normalizar(grande, [{"Codigo": "A", "Existencia": 10, "Costo": 1, "Plazo de entrega": 7}], {"mapeo": {}})
        r = motor.calcular_inventario(d, {"mes": "2026-09"}, {})
        self.assertEqual(len(r["resultados"]), 1)
        self.assertLess(time.time() - t0, 60)


if __name__ == "__main__":
    unittest.main()
