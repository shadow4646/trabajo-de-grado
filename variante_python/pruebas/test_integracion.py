"""Pruebas de integracion: conectores (CSV, Excel, SQL, API), proveedores de lenguaje y linea de comandos.

Los servicios externos se simulan con servidores locales en 127.0.0.1: no se gasta dinero ni se sale a internet.
Uso: python -m unittest pruebas.test_integracion -v   (desde la carpeta variante_python)
"""
import contextlib
import csv
import io
import json
import os
import re
import sqlite3
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from agente_inventarios import __main__ as cli
from agente_inventarios import conectores, ejecutar
from agente_inventarios.conectores import ErrorFuente
from agente_inventarios.lenguaje import Claude, ErrorLenguaje, Ollama, SinModelo, crear_proveedor

AQUI = os.path.dirname(os.path.abspath(__file__))
EJEMPLO = os.path.join(AQUI, "..", "..", "n8n_agentes", "inventarios_js", "datos_ejemplo")
MOV_CSV = os.path.join(EJEMPLO, "movimientos_ejemplo.csv")
MAE_CSV = os.path.join(EJEMPLO, "maestro_ejemplo.csv")
EXCEL = os.path.join(EJEMPLO, "inventario_ejemplo.xlsx")


def leer_bytes(ruta):
    with open(ruta, "rb") as f:
        return f.read()


def leer_texto(ruta, **kw):
    with open(ruta, **kw) as f:
        return f.read()


def leer(ruta):
    with open(ruta, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


class Servidor:
    """Servidor HTTP local que registra lo que recibe y responde lo que se le indique."""

    def __init__(self, respuestas):
        self.respuestas = respuestas  # ruta -> (codigo, objeto JSON) o funcion(cuerpo) -> (codigo, objeto)
        self.peticiones = []
        servidor = self

        class Manejador(BaseHTTPRequestHandler):
            def _atender(self):
                largo = int(self.headers.get("Content-Length") or 0)
                cuerpo = self.rfile.read(largo).decode("utf-8") if largo else ""
                servidor.peticiones.append({"metodo": self.command, "ruta": self.path, "encabezados": {k.lower(): v for k, v in self.headers.items()}, "cuerpo": cuerpo})
                r = servidor.respuestas.get(self.path.split("?")[0], (404, {"error": "no existe"}))
                codigo, objeto = r(cuerpo) if callable(r) else r
                datos = json.dumps(objeto).encode("utf-8")
                self.send_response(codigo)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(datos)))
                self.end_headers()
                self.wfile.write(datos)

            do_GET = _atender
            do_POST = _atender

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Manejador)
        self.url = "http://127.0.0.1:%d" % self.httpd.server_address[1]
        self.hilo = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.hilo.start()
        return self

    def __exit__(self, *a):
        self.httpd.shutdown()
        self.httpd.server_close()


def cfg_base(**cambios):
    return ejecutar.cargar_config(None, {"formato_fecha": "DMY", **cambios})


class TestConectoresMismosDatos(unittest.TestCase):
    """Las cuatro fuentes con los mismos datos deben dar lo mismo (como en el prototipo con n8n: compra de 34 446 y 6 urgentes)."""

    @classmethod
    def setUpClass(cls):
        cls.base = ejecutar.generar(cfg_base(fuente="csv", archivo_movimientos=MOV_CSV, archivo_productos=MAE_CSV), mes="2026-09")

    def comparar(self, r):
        self.assertEqual(round(r["ind"]["compra_total"]), round(self.base["ind"]["compra_total"]))
        self.assertEqual(r["ind"]["cuenta_acciones"], self.base["ind"]["cuenta_acciones"])

    def test_referencia_conocida(self):
        self.assertEqual(round(self.base["ind"]["compra_total"]), 34446)
        self.assertEqual(self.base["ind"]["cuenta_acciones"]["COMPRAR URGENTE"], 6)

    def test_excel(self):
        self.comparar(ejecutar.generar(cfg_base(fuente="excel", archivo_excel=EXCEL), mes="2026-09"))

    def test_sql_sqlite(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, "inv.db")
            con = sqlite3.connect(ruta)
            mov, mae = leer(MOV_CSV), leer(MAE_CSV)
            con.execute("CREATE TABLE kardex (fecha TEXT, sku TEXT, producto TEXT, tipo TEXT, cantidad REAL, costo_unitario REAL, saldo REAL)")
            con.executemany("INSERT INTO kardex VALUES (?,?,?,?,?,?,?)", [(f["fecha"], f["sku"], f["producto"], f["tipo"], f["cantidad"], f["costo_unitario"], f["saldo"] or None) for f in mov])
            con.execute("CREATE TABLE productos (sku TEXT, producto TEXT, unidad TEXT, stock_actual REAL, costo_unitario REAL, lead_time_dias REAL, moq REAL, en_transito REAL, proveedor TEXT)")
            con.executemany("INSERT INTO productos VALUES (?,?,?,?,?,?,?,?,?)", [tuple(f[c] or None for c in ("sku", "producto", "unidad", "stock_actual", "costo_unitario", "lead_time_dias", "moq", "en_transito", "proveedor")) for f in mae])
            con.commit()
            con.close()
            os.environ["INVENTARIOS_SQL_URL_PRUEBA"] = "sqlite:///" + ruta.replace("\\", "/")
            try:
                r = ejecutar.generar(cfg_base(fuente="sql", sql_url_env="INVENTARIOS_SQL_URL_PRUEBA", sql_movimientos="SELECT fecha, sku, producto, tipo, cantidad, costo_unitario, saldo FROM kardex",
                                              sql_productos="SELECT * FROM productos"), mes="2026-09")
            finally:
                del os.environ["INVENTARIOS_SQL_URL_PRUEBA"]
            self.comparar(r)

    def test_api(self):
        with Servidor({"/movimientos": (200, {"data": leer(MOV_CSV)}), "/productos": (200, {"data": leer(MAE_CSV)})}) as s:
            r = ejecutar.generar(cfg_base(fuente="api", api_url_movimientos=s.url + "/movimientos", api_url_productos=s.url + "/productos", api_ruta_datos="data"), mes="2026-09")
        self.comparar(r)


class TestConectoresErroresYSeguridad(unittest.TestCase):
    def test_csv_con_separador_punto_y_coma_y_bom(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, "m.csv")
            with open(ruta, "w", encoding="utf-8-sig", newline="") as f:
                f.write("fecha;sku;cantidad\n2026-09-01;A;5\n\n2026-09-02;A;7\n")
            filas = conectores.leer_csv(ruta, ";")
            self.assertEqual([f["sku"] for f in filas], ["A", "A"])

    def test_archivos_que_no_existen_explican_el_error(self):
        with self.assertRaises(ErrorFuente) as e:
            conectores.leer_csv("no_existe.csv")
        self.assertIn("no_existe.csv", str(e.exception))
        with self.assertRaises(ErrorFuente):
            conectores.leer_excel(EXCEL, "HojaQueNoExiste")

    def test_sql_solo_acepta_select_de_una_sentencia(self):
        for peligrosa in ("DELETE FROM kardex", "UPDATE kardex SET cantidad = 0", "INSERT INTO kardex VALUES (1)", "DROP TABLE kardex", "SELECT 1; DROP TABLE kardex", "PRAGMA writable_schema = 1", ""):
            with self.subTest(consulta=peligrosa), self.assertRaises(ErrorFuente):
                conectores.validar_consulta(peligrosa)
        for valida in ("SELECT * FROM kardex", "select 1;", "WITH x AS (SELECT 1 AS a) SELECT a FROM x", "-- comentario\nSELECT 1"):
            with self.subTest(consulta=valida):
                self.assertTrue(conectores.validar_consulta(valida))

    def test_sqlite_se_abre_en_solo_lectura(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, "inv.db")
            con = sqlite3.connect(ruta)
            con.execute("CREATE TABLE t (a INTEGER)")
            con.commit()
            con.close()
            # aunque una consulta lograra colarse, la conexion no permite escribir
            c = sqlite3.connect(conectores.pathlib.Path(ruta).resolve().as_uri() + "?mode=ro", uri=True)
            try:
                with self.assertRaises(sqlite3.OperationalError):
                    c.execute("INSERT INTO t VALUES (1)")
            finally:
                c.close()
            self.assertEqual(conectores.leer_sql("sqlite:///" + ruta.replace("\\", "/"), "SELECT * FROM t"), [])

    def test_api_error_no_expone_el_token(self):
        with Servidor({"/x": (500, {"error": "falla"})}) as s:
            with self.assertRaises(ErrorFuente) as e:
                conectores.leer_api(s.url + "/x", token="TOKEN-SECRETO-123")
        self.assertNotIn("TOKEN-SECRETO-123", str(e.exception))

    def test_api_envia_el_token_como_bearer_y_valida_la_url(self):
        with Servidor({"/x": (200, [{"a": 1}])}) as s:
            filas = conectores.leer_api(s.url + "/x", token="abc")
            self.assertEqual(s.peticiones[0]["encabezados"]["authorization"], "Bearer abc")
        self.assertEqual(filas, [{"a": 1}])
        with self.assertRaises(ErrorFuente):
            conectores.leer_api("file:///etc/passwd")

    def test_columnas_no_reconocidas_dan_un_error_claro(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, "m.csv")
            with open(ruta, "w", encoding="utf-8", newline="") as f:
                f.write("Mes,Ref,Mov\n2026-09,A,3\n")
            with self.assertRaises(ErrorFuente) as e:
                ejecutar.generar(cfg_base(fuente="csv", archivo_movimientos=ruta), mes="2026-09")
        self.assertIn("columnas minimas", str(e.exception))


def respuesta_claude(texto, entrada=900, salida=200):
    return lambda cuerpo: (200, {"content": [{"type": "text", "text": texto}], "usage": {"input_tokens": entrada, "output_tokens": salida}})


class TestProveedoresDeLenguaje(unittest.TestCase):
    def setUp(self):
        os.environ["ANTHROPIC_API_KEY_PRUEBA"] = "CLAVE-FALSA-DE-PRUEBA"

    def tearDown(self):
        os.environ.pop("ANTHROPIC_API_KEY_PRUEBA", None)

    def test_claude_envia_la_solicitud_correcta(self):
        with Servidor({"/v1/messages": respuesta_claude("## Comentario del analista\nAtiende los urgentes.")}) as s:
            p = Claude(url=s.url + "/v1/messages", clave_env="ANTHROPIC_API_KEY_PRUEBA")
            r = p.comentar("sistema de prueba", '{"a":1}', 450)
            peticion = s.peticiones[0]
        cuerpo = json.loads(peticion["cuerpo"])
        self.assertEqual(peticion["encabezados"]["x-api-key"], "CLAVE-FALSA-DE-PRUEBA")
        self.assertEqual(peticion["encabezados"]["anthropic-version"], "2023-06-01")
        self.assertEqual((cuerpo["model"], cuerpo["max_tokens"], cuerpo["temperature"], cuerpo["system"]), ("claude-haiku-4-5-20251001", 450, 0.2, "sistema de prueba"))
        self.assertEqual(cuerpo["messages"], [{"role": "user", "content": '{"a":1}'}])
        self.assertEqual((r["entrada"], r["salida"]), (900, 200))
        self.assertAlmostEqual(r["costo"], (900 * 1.0 + 200 * 5.0) / 1e6)

    def test_claude_sin_clave_falla_sin_llamar_a_la_red(self):
        os.environ.pop("ANTHROPIC_API_KEY_PRUEBA")
        with self.assertRaises(ErrorLenguaje) as e:
            Claude(clave_env="ANTHROPIC_API_KEY_PRUEBA").comentar("s", "u")
        self.assertIn("ANTHROPIC_API_KEY_PRUEBA", str(e.exception))

    def test_errores_del_servicio_no_exponen_la_clave(self):
        with Servidor({"/v1/messages": (401, {"error": "clave invalida"})}) as s:
            with self.assertRaises(ErrorLenguaje) as e:
                Claude(url=s.url + "/v1/messages", clave_env="ANTHROPIC_API_KEY_PRUEBA").comentar("s", "u")
        self.assertNotIn("CLAVE-FALSA-DE-PRUEBA", str(e.exception))
        with Servidor({"/v1/messages": (200, {"sin": "contenido"})}) as s:
            with self.assertRaises(ErrorLenguaje):
                Claude(url=s.url + "/v1/messages", clave_env="ANTHROPIC_API_KEY_PRUEBA").comentar("s", "u")

    def test_ollama_local(self):
        with Servidor({"/api/chat": (200, {"message": {"role": "assistant", "content": "## Comentario del analista\nTodo bien."}, "prompt_eval_count": 321, "eval_count": 45})}) as s:
            r = Ollama("modelo-de-prueba", url=s.url).comentar("sis", "usr", 300)
            cuerpo = json.loads(s.peticiones[0]["cuerpo"])
            encabezados = s.peticiones[0]["encabezados"]
        self.assertEqual((cuerpo["model"], cuerpo["stream"], cuerpo["options"]["num_predict"]), ("modelo-de-prueba", False, 300))
        self.assertEqual([m["role"] for m in cuerpo["messages"]], ["system", "user"])
        self.assertNotIn("x-api-key", {k.lower() for k in encabezados}, "Ollama no recibe ninguna clave")
        self.assertEqual((r["entrada"], r["salida"], r["costo"]), (321, 45, 0.0))
        with self.assertRaises(ValueError):
            Ollama("")

    def test_fabrica_de_proveedores(self):
        self.assertIsInstance(crear_proveedor("ninguno"), SinModelo)
        self.assertIsInstance(crear_proveedor("claude"), Claude)
        self.assertIsInstance(crear_proveedor("ollama", "m"), Ollama)
        self.assertIsNone(SinModelo().comentar("s", "u"))
        with self.assertRaises(ValueError):
            crear_proveedor("otro")

    def test_informe_con_comentario_filtra_cifras_ajenas_y_registra_el_uso(self):
        texto = "## Comentario del analista\nAtiende primero los urgentes. Se ahorrarian 987654 en total."
        with Servidor({"/v1/messages": respuesta_claude(texto, 800, 150)}) as s:
            p = Claude(url=s.url + "/v1/messages", clave_env="ANTHROPIC_API_KEY_PRUEBA")
            r = ejecutar.generar(cfg_base(fuente="csv", archivo_movimientos=MOV_CSV, archivo_productos=MAE_CSV), proveedor=p, mes="2026-09")
        self.assertIn("Atiende primero los urgentes.", r["informe"]["md"])
        self.assertNotIn("987654", r["informe"]["md"], "la frase con una cifra que no esta en los datos se elimina")
        self.assertIn("se eliminaron 1 frase(s)", r["informe"]["md"])
        self.assertIn("1 llamada al modelo claude-haiku-4-5-20251001, 800 tokens de entrada y 150 de salida", r["informe"]["md"])
        self.assertNotIn("CLAVE-FALSA", r["informe"]["md"] + r["informe"]["html"] + r["informe"]["chat"])

    def test_si_el_modelo_falla_el_informe_sale_sin_comentario(self):
        with Servidor({"/v1/messages": (500, {"error": "caido"})}) as s:
            p = Claude(url=s.url + "/v1/messages", clave_env="ANTHROPIC_API_KEY_PRUEBA")
            r = ejecutar.generar(cfg_base(fuente="csv", archivo_movimientos=MOV_CSV, archivo_productos=MAE_CSV), proveedor=p, mes="2026-09")
        self.assertEqual(r["comentario"], "")
        self.assertEqual(len(r["advertencias"]), 1)
        self.assertIn("## Que surtir", r["informe"]["md"])

    def test_sin_modelo_no_hace_ninguna_llamada(self):
        with Servidor({}) as s:
            ejecutar.generar(cfg_base(fuente="csv", archivo_movimientos=MOV_CSV, archivo_productos=MAE_CSV, url_modelo=s.url), proveedor=SinModelo(), mes="2026-09")
            self.assertEqual(s.peticiones, [])


class TestLineaDeComandos(unittest.TestCase):
    def correr(self, *args):
        salida, error = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(salida), contextlib.redirect_stderr(error):
            codigo = cli.main(list(args))
        return codigo, salida.getvalue(), error.getvalue()

    def test_informe_completo_sin_ia_por_defecto(self):
        with tempfile.TemporaryDirectory() as d:
            codigo, salida, error = self.correr("--movimientos", MOV_CSV, "--productos", MAE_CSV, "--mes", "2026-09", "--salida", d)
            self.assertEqual((codigo, error), (0, ""))
            self.assertIn("Inventario de septiembre 2026", salida)
            self.assertEqual(sorted(os.listdir(d)), ["inventario_2026-09.html", "inventario_2026-09.md", "inventario_2026-09_detalle.csv", "inventario_2026-09_pedido.csv"])
            pedido = leer_bytes(os.path.join(d, "inventario_2026-09_pedido.csv"))
            self.assertTrue(pedido.startswith(b"\xef\xbb\xbf"), "el CSV lleva BOM para que Excel lea las tildes")
            self.assertIn(b"\r\n", pedido)

    def test_error_de_fuente_devuelve_2_y_un_mensaje_claro(self):
        codigo, salida, error = self.correr("--movimientos", "no_existe.csv", "--mes", "2026-09")
        self.assertEqual(codigo, 2)
        self.assertIn("no_existe.csv", error)
        self.assertEqual(salida, "")

    def test_ollama_exige_modelo(self):
        codigo, _, error = self.correr("--movimientos", MOV_CSV, "--ia", "ollama", "--mes", "2026-09")
        self.assertEqual(codigo, 2)
        self.assertIn("modelo", error)

    def test_con_modelo_simulado(self):
        os.environ["ANTHROPIC_API_KEY"] = "CLAVE-FALSA-SOLO-PARA-LA-PRUEBA"
        try:
            with Servidor({"/v1/messages": respuesta_claude("## Comentario del analista\nRevisa los urgentes.")}) as s, tempfile.TemporaryDirectory() as d:
                codigo, salida, _ = self.correr("--movimientos", MOV_CSV, "--productos", MAE_CSV, "--mes", "2026-09", "--salida", d, "--ia", "claude", "--url-modelo", s.url + "/v1/messages")
                self.assertEqual(codigo, 0)
                self.assertIn("Revisa los urgentes.", salida)
        finally:
            del os.environ["ANTHROPIC_API_KEY"]

    def test_nombres_hostiles_no_se_ejecutan_en_excel_con_ningun_separador(self):
        with open(os.path.join(AQUI, "casos", "hostil.json"), encoding="utf-8") as f:
            caso = json.load(f)
        with tempfile.TemporaryDirectory() as d:
            for nombre, filas in (("m.csv", caso["movimientos"]), ("p.csv", caso["maestro"])):
                with open(os.path.join(d, nombre), "w", encoding="utf-8", newline="") as f:
                    w = csv.DictWriter(f, fieldnames=list(filas[0].keys()))
                    w.writeheader()
                    w.writerows(filas)
            codigo, _, error = self.correr("--movimientos", os.path.join(d, "m.csv"), "--productos", os.path.join(d, "p.csv"), "--mes", "2026-09", "--salida", os.path.join(d, "o"))
            self.assertEqual(codigo, 0, error)
            for archivo in ("inventario_2026-09_pedido.csv", "inventario_2026-09_detalle.csv"):
                texto = leer_texto(os.path.join(d, "o", archivo), encoding="utf-8-sig", newline="")
                celdas = re.split(r"[,;\t\r\n]", texto)
                peligrosas = [c for c in celdas if re.match(r'^\s*"?\s*[=@+\-]', c) and not re.match(r'^\s*"?-?\d+([.,]\d+)?"?\s*$', c) and c.strip() != "-"]
                self.assertEqual(peligrosas, [], archivo)
            html = leer_texto(os.path.join(d, "o", "inventario_2026-09.html"), encoding="utf-8")
            self.assertFalse(re.search(r"<script|<img|<[a-z][^>]*\son\w+\s*=|href=\"\s*javascript:", html, re.IGNORECASE), "el HTML no debe contener marcado ejecutable")


class TestConfiguracionYMes(unittest.TestCase):
    def test_resolver_mes(self):
        hoy = "2026-10-22"
        casos = [("informe de 2026-09", "2026-09"), ("septiembre 2026", "2026-09"), ("informe de agosto", "2026-08"), ("diciembre", "2025-12"), ("", "2026-09"),
                 ("sin mes", "2026-09"), ("2026/3", "2026-03"), ("2026-13", "2026-09")]
        for texto, esperado in casos:
            with self.subTest(texto=texto):
                self.assertEqual(ejecutar.resolver_mes(texto, hoy), esperado)

    def test_config_se_mezcla_sin_perder_valores_por_defecto(self):
        cfg = ejecutar.cargar_config(None, {"parametros": {"sector": "alimentos"}})
        self.assertEqual((cfg["parametros"]["sector"], cfg["parametros"]["R_dias"]), ("alimentos", 30))
        self.assertEqual(cfg["proveedor_lenguaje"], "ninguno", "por defecto no sale ningun dato hacia un servicio de lenguaje")

    def test_config_de_ejemplo_se_puede_cargar(self):
        cfg = ejecutar.cargar_config(os.path.join(AQUI, "..", "configuracion_ejemplo.json"))
        self.assertEqual(cfg["fuente"], "csv")


if __name__ == "__main__":
    unittest.main()
