# Cómo conectar el agente de inventarios a un sistema real

El agente necesita dos tablas. Los nombres de las columnas no tienen que ser idénticos a los de esta guía: el agente reconoce los más comunes en español e inglés ("Código", "Tipo de movimiento", "Existencia actual", "Plazo de entrega (días)"...). Si alguna columna no se reconoce, el informe lo avisa y se indica el nombre en `mapeo` dentro del nodo **Configuracion**.

## Los datos que necesita

**Movimientos (kardex), una fila por movimiento**

| Columna | Obligatoria | Para qué sirve |
|---|---|---|
| fecha | sí | Día del movimiento. Acepta `2026-09-14`, `14/09/2026` y fechas de Excel |
| sku (código del producto) | sí | Identifica el producto |
| tipo | recomendada | Distingue venta, compra, devolución, ajuste y traslado. Sin ella se usa el signo de la cantidad |
| cantidad | sí | Siempre positiva si hay tipo; con signo si no lo hay. También sirve tener columnas separadas de entradas y salidas |
| saldo | recomendada | Saldo después de cada movimiento. Con él se detectan los quiebres con exactitud |
| costo_unitario | opcional | Valora el inventario y calcula la clasificación ABC |
| bodega, documento, motivo | opcionales | Varias bodegas, detección de duplicados y de causas de ajuste |

**Productos (maestro), una fila por producto**

| Columna | Obligatoria | Para qué sirve |
|---|---|---|
| sku | sí | Debe coincidir con el de movimientos |
| stock_actual | recomendada | Ancla para reconstruir el saldo si el kardex no trae `saldo` |
| costo_unitario | recomendada | Valor del inventario y de la compra sugerida |
| lead_time_dias | recomendada | Plazo de entrega del proveedor. Si falta se supone 15 días y se avisa |
| moq | opcional | Múltiplo mínimo de compra: las cantidades se redondean hacia arriba |
| en_transito | opcional | Pedidos ya hechos que no han llegado |
| proveedor, unidad, activo | opcionales | Agrupar la compra, mostrar la unidad, ignorar productos inactivos |

El maestro es necesario para detectar los productos que **nunca se movieron**, porque esos no aparecen en el kardex.

## Elegir la fuente

En el nodo **Configuracion** se escribe `fuente: 'csv'`, `'excel'`, `'sql'` o `'api'`. También se puede pedir por el chat: "informe de 2026-09 excel".

### CSV
Dos archivos dentro de `C:\Users\<usuario>\.n8n-files\` (la carpeta que n8n permite leer). Ajusta `archivo_movimientos`, `archivo_productos` y, si el separador no es coma, `separador`.

### Excel
Un libro con una hoja de movimientos y otra de productos. Ajusta `archivo_excel`, `hoja_movimientos` y `hoja_productos`.

### SQL
Crea en n8n una credencial de **Postgres** y selecciónala en los nodos **SQL de movimientos** y **SQL de productos**. Las consultas están en `sql_movimientos` y `sql_productos`. Para MySQL o SQL Server se reemplazan esos dos nodos por el nodo de n8n de esa base; el resto del flujo no cambia.

La fecha se pide como texto (`to_char`) para que no se corra un día según la zona horaria del servidor. Ejemplos:

```sql
-- PostgreSQL
SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, sku, producto, tipo, cantidad, costo_unitario, saldo
FROM kardex WHERE fecha >= CURRENT_DATE - INTERVAL '26 months';

-- MySQL
SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, sku, producto, tipo, cantidad, costo_unitario, saldo
FROM kardex WHERE fecha >= DATE_SUB(CURDATE(), INTERVAL 26 MONTH);

-- SQL Server
SELECT CONVERT(varchar(10), fecha, 23) AS fecha, sku, producto, tipo, cantidad, costo_unitario, saldo
FROM kardex WHERE fecha >= DATEADD(month, -26, GETDATE());
```

Se recomienda crear en la base una **vista de solo lectura** con las columnas del agente y un usuario con permiso solo de lectura sobre esa vista.

### API de un programa
Rellena `api_url_movimientos` y `api_url_productos`. Si la respuesta trae los registros dentro de un campo (por ejemplo `{"data": [...]}`), escribe su nombre en `api_ruta_datos`. La autenticación se configura con una credencial de n8n en los nodos **API de movimientos** y **API de productos**; las claves no se escriben en el código. Si el programa solo exporta archivos, usa CSV o Excel.

## Parámetros que conviene ajustar

| Parámetro | Valor por defecto | Qué cambia |
|---|---|---|
| `R_dias` | 30 | Cada cuántos días revisan y piden. Con revisión semanal poner 7: se piden menos productos y cantidades menores |
| `lead_time_defecto` | 15 | Plazo que se supone si el maestro no lo trae |
| `sector` | general | Umbral de cobertura para marcar sobrestock: alimentos 45 días, comercio 60, general 90, manufactura 120, pesados 180. Son valores orientativos |
| `usar_ia` | true | `false` apaga el comentario de Claude. Los cálculos no cambian |

Como la revisión es mensual, el agente pide todo lo que no alcanzaría hasta el siguiente corte; por eso en la mayoría de los casos reales una parte grande del catálogo aparece en "Qué surtir". Es el comportamiento esperado de esa política, no un error.

## Qué entrega

- Respuesta corta en el chat: urgentes, quiebres y productos sin rotación.
- `inventario_AAAA-MM.html` y `.md`: informe completo con tablas, indicadores, calidad de los datos y método.
- `inventario_AAAA-MM_pedido.csv`: pedido sugerido por proveedor, listo para abrir en Excel.
- `inventario_AAAA-MM_detalle.csv`: todos los productos con sus métricas.

## Pruebas

```
node test_motor.js     # fórmulas contra los ejemplos de la investigación, lectura de datos sucios
node test_local.js     # de punta a punta con los datos de ejemplo, sin n8n y sin IA
python generar_datos_ejemplo.py   # regenera el kardex de ejemplo (datos inventados)
node mock_api.js       # API de prueba para la fuente "api"
```

## Limitaciones

No modela estacionalidad (se necesitan al menos 24 meses de historia), usa la variabilidad de la demanda y no la del error de pronóstico, supone una distribución normal y no calcula lotes económicos porque el kardex no trae costos de pedido ni de mantener. Los umbrales de sobrestock por sector son orientativos. El resultado no se ha validado todavía contra datos reales de una empresa.
