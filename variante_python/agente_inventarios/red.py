"""Peticiones HTTP que no filtran claves.

urllib sigue las redirecciones por defecto y reenvia a la direccion nueva las cabeceras de la peticion original, incluidas
Authorization y x-api-key: una API o un servicio mal configurado (o comprometido) podria entregar el token a otro servidor.
Aqui no se sigue ninguna redireccion y no se envia una clave por http sin cifrar (salvo a la propia maquina).
"""
import urllib.parse
import urllib.request

LOCAL = ("127.0.0.1", "localhost", "::1")


class ErrorRed(Exception):
    """La peticion se rechazo por seguridad o no se pudo completar."""


class _SinRedireccion(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ErrorRed("El servicio respondio con una redireccion (codigo %s). Por seguridad no se sigue, porque enviaria la clave a otra direccion: usa la URL final." % code)


def exigir_https_si_hay_clave(url, hay_clave):
    """Una clave solo viaja por https; http se admite unicamente hacia la propia maquina (pruebas y servicios locales)."""
    if not hay_clave:
        return
    partes = urllib.parse.urlsplit(url)
    if partes.scheme.lower() == "https":
        return
    if partes.scheme.lower() == "http" and (partes.hostname or "").lower() in LOCAL:
        return
    raise ErrorRed("No se envia una clave por http sin cifrar: usa una URL https (http solo se admite hacia 127.0.0.1)")


def abrir(req, timeout):
    """urlopen sin seguir redirecciones. Devuelve la respuesta; el llamador debe cerrarla."""
    return urllib.request.build_opener(_SinRedireccion).open(req, timeout=timeout)
