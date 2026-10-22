"""Linea de comandos del agente de inventarios.

Ejemplos:
  python -m agente_inventarios --movimientos kardex.csv --productos maestro.csv --mes 2026-09
  python -m agente_inventarios --config configuracion.json --mensaje "informe de septiembre 2026"
  python -m agente_inventarios --fuente excel --excel inventario.xlsx --ia ollama --modelo llama3.1
Por defecto no se usa modelo de lenguaje (--ia ninguno): el informe se genera completo y no sale ningun dato del equipo.
"""
import argparse
import sys

from .conectores import ErrorFuente
from .ejecutar import cargar_config, ejecutar
from .lenguaje import crear_proveedor


def main(argv=None):
    p = argparse.ArgumentParser(prog="agente_inventarios", description="Informe mensual de inventario: que surtir, cuanto y que no se movio.")
    p.add_argument("--config", help="Archivo JSON de configuracion (ver configuracion_ejemplo.json)")
    p.add_argument("--fuente", choices=["csv", "excel", "sql", "api"], help="De donde se leen los datos")
    p.add_argument("--movimientos", help="CSV de movimientos (kardex)")
    p.add_argument("--productos", help="CSV del maestro de productos")
    p.add_argument("--excel", help="Libro de Excel con las hojas Movimientos y Productos")
    p.add_argument("--separador", help="Separador del CSV (por defecto coma)")
    p.add_argument("--mes", help="Mes del informe, AAAA-MM (por defecto, el mes anterior)")
    p.add_argument("--mensaje", default="", help="Texto de donde sacar el mes, por ejemplo 'septiembre 2026'")
    p.add_argument("--salida", help="Carpeta donde se escriben los informes")
    p.add_argument("--ia", choices=["ninguno", "claude", "ollama"], help="Proveedor de lenguaje para el comentario (por defecto, ninguno)")
    p.add_argument("--modelo", help="Nombre del modelo (obligatorio con ollama)")
    p.add_argument("--url-modelo", help="Direccion del servicio del modelo")
    p.add_argument("--sector", choices=["general", "alimentos", "comercio", "manufactura", "pesados"], help="Umbral de sobrestock por sector")
    p.add_argument("--r-dias", type=int, help="Periodo de revision en dias (por defecto 30)")
    p.add_argument("--plazo-defecto", type=int, help="Plazo de entrega supuesto en dias cuando el sistema no lo trae (por defecto 15)")
    p.add_argument("--formato-fecha", choices=["DMY", "MDY"], help="Orden de dia y mes en fechas como 03/04/2026")
    p.add_argument("--por-bodega", action="store_true", help="Analizar cada bodega por separado")
    p.add_argument("--moneda", help="Simbolo de moneda del informe")
    a = p.parse_args(argv)

    cambios = {}
    for destino, valor in (("fuente", a.fuente), ("archivo_movimientos", a.movimientos), ("archivo_productos", a.productos), ("archivo_excel", a.excel), ("separador", a.separador),
                           ("carpeta_salida", a.salida), ("proveedor_lenguaje", a.ia), ("modelo", a.modelo), ("url_modelo", a.url_modelo), ("formato_fecha", a.formato_fecha), ("moneda", a.moneda)):
        if valor:
            cambios[destino] = valor
    if a.por_bodega:
        cambios["por_bodega"] = True
    parametros = {k: v for k, v in (("sector", a.sector), ("R_dias", a.r_dias), ("lead_time_defecto", a.plazo_defecto)) if v is not None}
    if parametros:
        cambios["parametros"] = parametros
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    try:
        cfg = cargar_config(a.config, cambios)
        if a.movimientos and not a.fuente and not (a.config and cfg.get("fuente") != "csv"):
            cfg["fuente"] = "csv"
        proveedor = crear_proveedor(cfg.get("proveedor_lenguaje"), cfg.get("modelo"), cfg.get("url_modelo"))
        r = ejecutar(cfg, proveedor, mes=a.mes, mensaje=a.mensaje)
    except (ErrorFuente, ValueError, OSError) as e:
        print("Error: %s" % e, file=sys.stderr)
        return 2
    print(r["chat"])
    for adv in r["advertencias"]:
        print("Aviso: %s" % adv, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
