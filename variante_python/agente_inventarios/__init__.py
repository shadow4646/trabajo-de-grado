"""Agente gestor de inventarios, variante autonoma en Python (sin n8n).

Lee los movimientos y el maestro de productos de un CSV, un Excel, una base SQL o una API, calcula que surtir y cuanto
con una politica de revision periodica, y genera un informe (Markdown y HTML) y dos CSV. La IA es opcional y solo redacta
un comentario corto; todos los calculos son codigo.
"""
__version__ = "0.1.0"
