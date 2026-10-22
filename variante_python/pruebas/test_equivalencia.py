"""Equivalencia entre el motor de Python y el de JavaScript (prototipo con n8n).

Con las mismas entradas congeladas, las salidas deben coincidir: textos y enteros idénticos, decimales con tolerancia
relativa de 1e-9. Las referencias las genera exportar_referencia.js con el motor de JavaScript (node exportar_referencia.js).
Uso: python -m unittest pruebas.test_equivalencia -v   (desde la carpeta variante_python)
"""
import csv
import json
import os
import unittest

from agente_inventarios import ejecutar
from agente_inventarios import informe as inf
from agente_inventarios import motor
from agente_inventarios import util
from agente_inventarios.normalizar import clasificar_tipo, detectar_columnas, normalizar
from pruebas.comparar import a_json, comparar

AQUI = os.path.dirname(os.path.abspath(__file__))
EJEMPLO = os.path.join(AQUI, "..", "..", "n8n_agentes", "inventarios_js", "datos_ejemplo")
MODELO = "claude-haiku-4-5-20251001"


def leer_csv(ruta):
    with open(ruta, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def cargar_referencia(nombre):
    with open(os.path.join(AQUI, "referencia", nombre + ".json"), encoding="utf-8") as f:
        return json.load(f)


def entradas(nombre):
    if nombre == "ejemplo":
        return leer_csv(os.path.join(EJEMPLO, "movimientos_ejemplo.csv")), leer_csv(os.path.join(EJEMPLO, "maestro_ejemplo.csv")), {"fuente": "csv", "moneda": "$"}, "2026-09"
    with open(os.path.join(AQUI, "casos", nombre + ".json"), encoding="utf-8") as f:
        c = json.load(f)
    return c["movimientos"], c["maestro"], c["cfg"], c["mes"]


def correr(nombre):
    """Misma tuberia que el prototipo: normalizar, calcular, indicadores e informe (sin y con comentario de IA)."""
    mov, mae, cfg, mes = entradas(nombre)
    datos = normalizar(mov, mae, {**cfg, "mapeo": cfg.get("mapeo") or {}})
    if "error" in datos:
        return {"error": datos["error"]}
    res = motor.calcular_inventario(datos, {"mes": mes}, cfg.get("parametros") or {})
    ind = motor.indicadores(res, res["P"])
    cfg_inf = {"fuente": cfg.get("fuente") or "csv", "moneda": cfg.get("moneda") or "$"}
    out = {"res": res, "ind": ind, "informe": inf.armar_informe(res, ind, cfg_inf, "", None, 0, MODELO)}
    out["entrada_ia"] = ejecutar.armar_entrada_ia(res, ind)
    out["entrada_ia_json"] = ejecutar.entrada_ia_json(out["entrada_ia"])
    entrada = json.dumps({"urgentes": ind["cuenta_acciones"].get("COMPRAR URGENTE", 0), "productos": ind["productos"]})
    comentario = inf.limpiar_comentario("## Comentario del analista\nAtiende primero los urgentes. Hay %s urgentes y %s productos. Ademas se ahorrarian 987654 pesos — seguro. " % (
        ind["cuenta_acciones"].get("COMPRAR URGENTE", 0), ind["productos"]), entrada)
    out["comentario"] = comentario
    out["informe_ia"] = inf.armar_informe(res, ind, cfg_inf, comentario, {"llamadas": 1, "entrada": 900, "salida": 200, "costo": 0.0019}, 12, MODELO)
    return out


def primera_diferencia(a, b):
    la, lb = a.split("\n"), b.split("\n")
    for i, (x, y) in enumerate(zip(la, lb)):
        if x != y:
            return "linea %d\n  python: %s\n  js:     %s" % (i + 1, x[:300], y[:300])
    return "largo distinto: %d lineas contra %d" % (len(la), len(lb))


class TestEquivalenciaCasos(unittest.TestCase):
    NOMBRES = ["ejemplo", "sucio_formatos", "separadas_mensual", "bodegas_sumadas", "bodegas_separadas", "hostil", "sin_columnas"]

    def test_casos(self):
        for nombre in self.NOMBRES:
            with self.subTest(caso=nombre):
                ref = cargar_referencia(nombre)
                py = correr(nombre)
                if "error" in ref:
                    self.assertEqual(py.get("error"), ref["error"])
                    continue
                py = a_json(py)
                fallos = comparar({"res": py["res"], "ind": py["ind"]}, {"res": ref["res"], "ind": ref["ind"]})
                self.assertEqual(fallos, [], "motor: %s" % fallos[:5])
                self.assertEqual(comparar(py["entrada_ia"], ref["entrada_ia"]), [], "resumen para el modelo de lenguaje")
                self.assertEqual(py["entrada_ia_json"], ref["entrada_ia_json"], "texto JSON del resumen para el modelo de lenguaje")
                self.assertEqual(py["comentario"], ref["comentario"], "limpiar_comentario")
                for variante in ("informe", "informe_ia"):
                    for clave in ("md", "html", "csvPedido", "csvDetalle", "chat"):
                        a, b = py[variante][clave], ref[variante][clave]
                        self.assertEqual(a, b, "%s.%s: %s" % (variante, clave, primera_diferencia(a, b)))
                    self.assertEqual(py[variante]["resumen"], ref[variante]["resumen"])


class TestEquivalenciaFunciones(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ref = cargar_referencia("sueltas")

    def test_fechas(self):
        for clave_ref, formato in (("fechas", None), ("fechas_mdy", "MDY")):
            for entrada, esperado in self.ref[clave_ref]:
                with self.subTest(formato=formato, entrada=entrada):
                    v = float(entrada) if isinstance(entrada, (int, float)) else entrada
                    self.assertEqual(a_json(util.parsear_fecha(v, formato)), esperado)

    def test_numeros(self):
        for entrada, esperado in self.ref["numeros"]:
            with self.subTest(entrada=entrada):
                n = util.parsear_numero(entrada)
                self.assertEqual(None if n != n else n, esperado)

    def test_tipos(self):
        for texto, signo, esperado in self.ref["tipos"]:
            with self.subTest(texto=texto, signo=signo):
                self.assertEqual(clasificar_tipo(texto, signo), esperado)

    def test_columnas(self):
        cols = detectar_columnas(["Código", "Fecha movimiento", "Descripción", "Tipo de movimiento", "Cantidad", "Costo", "Existencia actual", "Plazo de entrega (días)", "Por recibir"], {},
                                 ["sku", "fecha", "producto", "tipo", "cantidad", "costo_unitario", "stock_actual", "lead_time_dias", "en_transito"])
        self.assertEqual(cols, self.ref["columnas"])

    def test_dias(self):
        for n, iso in self.ref["dias"]:
            self.assertEqual(util.iso_de(n), iso)

    def test_html_en_linea(self):
        for entrada, esperado in self.ref["html"]:
            with self.subTest(entrada=entrada):
                self.assertEqual(inf.inline_html(entrada), esperado)


if __name__ == "__main__":
    unittest.main()
