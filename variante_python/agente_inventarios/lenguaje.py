"""Proveedores de lenguaje intercambiables: Claude (API), un modelo local con Ollama, o ninguno.

El modelo de lenguaje solo redacta un comentario corto a partir de un resumen que ya calculo el codigo; no calcula ni decide.
Cambiar de proveedor no cambia ninguna recomendacion. La clave de la API se lee de una variable de entorno y nunca se guarda
en archivos ni en el informe. Solo se usa la biblioteca estandar (urllib).
"""
import json
import os
import urllib.error
import urllib.request

MODELO_CLAUDE = "claude-haiku-4-5-20251001"
PRECIO_MTOK = {"entrada": 1.0, "salida": 5.0}  # USD por millon de tokens; referencia de terceros, no oficial


class ErrorLenguaje(Exception):
    """El proveedor de lenguaje no respondio o respondio algo inesperado."""


class ProveedorLenguaje:
    nombre = "ninguno"
    modelo = ""

    def comentar(self, sistema, usuario, max_tokens=450):
        """Devuelve {'texto', 'entrada', 'salida', 'costo'} o None si no hay modelo."""
        return None


class SinModelo(ProveedorLenguaje):
    """Sin IA: no sale ningun dato hacia un servicio de lenguaje y el informe se genera sin comentario."""
    nombre = "ninguno"


def _post_json(url, cuerpo, encabezados, timeout):
    datos = json.dumps(cuerpo).encode("utf-8")
    req = urllib.request.Request(url, data=datos, headers={"Content-Type": "application/json", **encabezados}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise ErrorLenguaje("El servicio respondio con el codigo %s" % e.code) from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ErrorLenguaje("No se pudo conectar con el servicio de lenguaje: %s" % getattr(e, "reason", e)) from None
    except ValueError:
        raise ErrorLenguaje("El servicio de lenguaje devolvio una respuesta que no es JSON") from None


class Claude(ProveedorLenguaje):
    """API de mensajes de Anthropic. La clave sale de la variable de entorno indicada (ANTHROPIC_API_KEY por defecto)."""
    nombre = "claude"

    def __init__(self, modelo=MODELO_CLAUDE, url="https://api.anthropic.com/v1/messages", clave_env="ANTHROPIC_API_KEY", timeout=60):
        self.modelo = modelo or MODELO_CLAUDE
        self.url = url or "https://api.anthropic.com/v1/messages"
        self.clave_env = clave_env
        self.timeout = timeout

    def comentar(self, sistema, usuario, max_tokens=450):
        clave = os.environ.get(self.clave_env, "")
        if not clave:
            raise ErrorLenguaje("Falta la variable de entorno %s con la clave de la API" % self.clave_env)
        resp = _post_json(
            self.url,
            {"model": self.modelo, "max_tokens": max_tokens, "temperature": 0.2, "system": sistema, "messages": [{"role": "user", "content": usuario}]},
            {"x-api-key": clave, "anthropic-version": "2023-06-01"}, self.timeout)
        try:
            texto = str(resp["content"][0]["text"])
            uso = resp.get("usage") or {}
        except (KeyError, IndexError, TypeError):
            raise ErrorLenguaje("La respuesta de Claude no trae el texto esperado") from None
        entrada, salida = int(uso.get("input_tokens") or 0), int(uso.get("output_tokens") or 0)
        return {"texto": texto, "entrada": entrada, "salida": salida, "costo": (entrada * PRECIO_MTOK["entrada"] + salida * PRECIO_MTOK["salida"]) / 1e6}


class Ollama(ProveedorLenguaje):
    """Modelo local con Ollama. Ollama no tiene autenticacion propia: debe escuchar solo en la maquina local (127.0.0.1) o en una
    red interna protegida. Ningun dato sale hacia un servicio de lenguaje externo y el costo por uso es cero."""
    nombre = "ollama"

    def __init__(self, modelo, url="http://127.0.0.1:11434", timeout=600):
        if not modelo:
            raise ValueError("Indica el nombre del modelo de Ollama (por ejemplo, el que bajaste con 'ollama pull')")
        self.modelo = modelo
        self.url = url.rstrip("/")
        self.timeout = timeout

    def comentar(self, sistema, usuario, max_tokens=450):
        resp = _post_json(
            self.url + "/api/chat",
            {"model": self.modelo, "stream": False, "options": {"temperature": 0.2, "num_predict": max_tokens},
             "messages": [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}]},
            {}, self.timeout)
        try:
            texto = str(resp["message"]["content"])
        except (KeyError, TypeError):
            raise ErrorLenguaje("La respuesta de Ollama no trae el texto esperado") from None
        return {"texto": texto, "entrada": int(resp.get("prompt_eval_count") or 0), "salida": int(resp.get("eval_count") or 0), "costo": 0.0}


def crear_proveedor(nombre, modelo="", url=""):
    """nombre: 'claude', 'ollama' o 'ninguno'."""
    n = (nombre or "ninguno").lower()
    if n == "claude":
        return Claude(modelo=modelo, url=url)
    if n == "ollama":
        return Ollama(modelo=modelo, url=url or "http://127.0.0.1:11434")
    if n in ("ninguno", "ninguna", "sin", "none"):
        return SinModelo()
    raise ValueError("Proveedor de lenguaje desconocido: %s (usa claude, ollama o ninguno)" % nombre)
