# Referencia técnica: gestión de inventario y compras para un agente de IA

Documento de conocimiento operativo (system prompt base) para un agente de IA que analiza
historial mensual de consumo/ventas y recomienda cantidades de compra, evitando sobrestock y
quiebres de stock, para empresas de cualquier tamaño y cualquier tipo de producto.

Cada fórmula incluye variables, umbrales de decisión y la regla práctica que el agente debe
aplicar. Las fuentes (todas con URL) están citadas al final de cada bloque. La mayoría de fuentes
son de la industria (blogs técnicos, proveedores de software ERP/WMS, calculadoras especializadas);
donde fue posible se señalan también fuentes más cercanas a estándares (APICS/ASCM, cursos
universitarios). Se marca explícitamente cuándo un dato no pudo verificarse contra una fuente
primaria.

---

## 1. Clasificación de inventario: Análisis ABC y matriz ABC/XYZ

### 1.1 Análisis ABC (basado en el principio de Pareto 80/20)

**Cálculo:**
1. Para cada SKU, calcular el **valor de consumo anual** (Annual Consumption Value, ACV):
   `ACV = Costo unitario × Unidades consumidas/vendidas en el período de referencia`
2. Ordenar los SKU de mayor a menor ACV.
3. Calcular el porcentaje acumulado de valor sobre el total.
4. Asignar clase según el punto de corte acumulado:

| Clase | % acumulado de valor (umbral clásico) | % típico de SKU | Nivel de control |
|---|---|---|---|
| A | 0% - 70-80% del valor acumulado | ~10-20% de los SKU | Control estricto: revisión frecuente (semanal/quincenal), pronóstico más sofisticado, menor stock de seguridad relativo, seguimiento individual |
| B | siguiente 15-25% del valor acumulado | ~20-30% de los SKU | Control moderado: revisión mensual, métodos de pronóstico estándar |
| C | restante 5-10% del valor acumulado | ~50-70% de los SKU | Control simple: reglas automáticas, revisión trimestral, stock de seguridad generoso (el costo de exceso es bajo) |

**Variantes de corte usadas en la práctica:** 80/15/5 (la más citada), 70/20/10, 75/20/5. Los
cortes son **convencionales, no una ley física**; deben ajustarse al punto de quiebre natural de
la curva acumulada de cada empresa (p. ej., si al 65% del valor ya se cubre solo el 8% de SKU,
ese puede ser el corte real de A).

**Regla de decisión para el agente:** si el usuario no especifica cortes, usar 80/95 (A = hasta
80% acumulado, B = 80-95%, C = 95-100%) como default, y advertir que es ajustable.

**Limitación documentada:** el ACV es unidimensional (solo valor×volumen); puede subestimar
piezas de bajo costo pero críticas para la operación (repuestos críticos, insumos de seguridad).
Se recomienda un criterio adicional de criticidad para esos casos.

Fuentes:
- [Cleverence - ABC analysis for inventory control](https://www.cleverence.com/articles/for-business/abc-analysis-for-inventory-control-is-based-on-4728/)
- [Lokad - ABC analysis (Inventory)](https://lokad.com/abc-analysis-inventory-definition)
- [GoCardless - What is ABC analysis](https://gocardless.com/en-us/guides/posts/what-is-abc-analysis)
- [Inbound Logistics - ABC Analysis: Definition, Importance, and Implementation](https://www.inboundlogistics.com/articles/abc-analysis/)
- [MetricGate - ABC Inventory Classification](https://metricgate.com/calculator/abc-inventory-classification)

### 1.2 Matriz ABC/XYZ (valor × variabilidad de la demanda)

El eje XYZ clasifica cada SKU por **predictibilidad de la demanda**, usando el **coeficiente de
variación (CV)**:

`CV = Desviación estándar de la demanda / Demanda media`

(calculado sobre una ventana relevante, p. ej. 12 meses de demanda mensual)

| Clase | Umbral CV (convención 1, relativa) | Umbral CV (convención 2, Mecalux, en %) | Interpretación |
|---|---|---|---|
| X | CV < 0.5 | CV ≤ 10% | Demanda estable y muy predecible |
| Y | 0.5 ≤ CV ≤ 1.0 | 10% < CV ≤ 25% | Demanda variable (estacional/tendencial) pero manejable |
| Z | CV > 1.0 | CV > 25% | Demanda errática/esporádica, difícil de pronosticar |

**Igual que con ABC, los umbrales son ajustables por la empresa**; no hay un estándar único
universal.

**Matriz combinada 3×3 (ABC × XYZ) y estrategia por celda:**

| | X (estable) | Y (variable) | Z (errática) |
|---|---|---|---|
| **A** (alto valor) | Reabastecimiento automático, JIT, revisión frecuente, stock de seguridad bajo | Pronóstico con suavizado exponencial/estacional, revisión frecuente, stock de seguridad medio | Gestión manual caso por caso, revisión muy frecuente, posible pedido sobre pedido (no stock), stock de seguridad alto o gestión por disponibilidad de proveedor |
| **B** (valor medio) | Reabastecimiento periódico estándar | Revisión periódica con ajuste estacional | Revisión frecuente pero con reglas simples (máx/mín), evaluar descontinuar si rotación es muy baja |
| **C** (bajo valor) | Pedidos en lote grande, revisión poco frecuente (trimestral) | Reglas simples de punto de reorden con stock de seguridad generoso (el costo de error es bajo) | Evaluar fabricación/compra sobre pedido, o descontinuar, o mantener stock de seguridad alto si es crítico para el servicio |

**Limitación documentada:** el CV no siempre refleja la dificultad real de pronosticar (algunos
patrones son más fáciles de predecir que su CV sugiere). Para demanda intermitente (muchos
períodos en cero), es mejor complementar con el conteo de períodos sin demanda o el intervalo
promedio entre pedidos (ver sección 2.6, método de Croston).

Fuentes:
- [Mecalux - ABC XYZ analysis](https://www.mecalux.com/blog/abc-xyz)
- [Cleverence - Guide to inventory classification methods](https://www.cleverence.com/articles/for-business/inventory-classification-methods-4721/)
- [ABC Supply Chain - ABC XYZ Analysis in Inventory Management](https://abcsupplychain.com/?p=5380)
- [SCMDOJO - ABC-XYZ Analysis Complete Methodology Guide](https://www.scmdojo.com/blog/abc-xyz-analysis-complete-guide/)
- [MetricGate - XYZ demand classification docs](https://metricgate.com/docs/xyz-demand-classification/)

---

## 2. Métodos de pronóstico de demanda con datos mensuales

Regla general de aplicación según historial disponible:

| Historial disponible | Método recomendado |
|---|---|
| 0-2 meses (producto nuevo) | Sin datos propios suficientes: usar demanda de producto análogo/categoría, estimación cualitativa del comprador, o un valor de arranque conservador; no usar suavizado exponencial ni promedio móvil todavía (no hay suficiente serie) |
| 3-5 meses | Promedio móvil simple (SMA) de 3 meses, o promedio simple de todo lo disponible; demasiado pronto para aislar estacionalidad o tendencia con confianza |
| 6-11 meses | Suavizado exponencial simple (SES) con alpha moderado (0.2-0.3); promedio móvil ponderado (WMA) si hay tendencia visible; aún insuficiente para un índice estacional mensual confiable (se necesita ver el mismo mes dos veces) |
| 12-23 meses | Ya se puede calcular un índice estacional mensual (un ciclo completo observado); usar suavizado exponencial con ajuste de tendencia (Holt) y, si aplica, desestacionalizar/reestacionalizar |
| 24+ meses | Holt-Winters (triple exponencial: nivel + tendencia + estacionalidad) con dos o más ciclos para validar el patrón estacional; es el escenario ideal |

### 2.1 Promedio móvil simple (SMA)

`Pronóstico(t+1) = (D(t) + D(t-1) + ... + D(t-n+1)) / n`

donde `D` = demanda real del período, `n` = número de períodos en la ventana (comúnmente 3).

- Ventaja: simple, estable, filtra ruido.
- Limitación: da igual peso a todos los períodos → **reacciona lento a cambios de tendencia**; no
  se recomienda si hay tendencia o estacionalidad fuerte.

### 2.2 Promedio móvil ponderado (WMA)

`Pronóstico(t+1) = Σ(peso_i × D_i) / Σ(peso_i)`

Los pesos se asignan de forma creciente hacia los períodos más recientes (p. ej. pesos 0.5, 0.3,
0.2 para los últimos 3 meses, del más reciente al más antiguo) y se elegyen por juicio/prueba y
error. Reacciona más rápido a cambios que el SMA, pero sigue retrasado frente a tendencias fuertes.

### 2.3 Suavizado exponencial simple (SES)

`Pronóstico(t+1) = α × D(t) + (1 - α) × Pronóstico(t)`

donde `α` (alpha) es la constante de suavizado, `0 < α < 1`. Equivalente a un promedio ponderado
de toda la historia con pesos que decaen geométricamente (`α(1-α)^j`).

**Valores típicos de alpha (regla práctica para el agente):**

| Alpha | Comportamiento | Cuándo usar |
|---|---|---|
| 0.1 - 0.2 | Muy estable, suaviza mucho el ruido, reacciona lento | Demanda estable, poco ruido (SKU clase X) |
| 0.2 - 0.3 | Balance general | Uso general por defecto cuando no hay razón para otra cosa |
| 0.3 | Equivalente aprox. a un promedio móvil de 6 períodos | Referencia de calibración rápida |
| 0.5 - 0.9 | Muy reactivo, sigue de cerca cada cambio | Demanda muy cambiante / productos nuevos con pocas observaciones donde cada dato pesa mucho |

- No hay fórmula cerrada para el alpha "correcto": en la práctica se optimiza minimizando el
  error de pronóstico (MAE/MSE) sobre el histórico disponible, o se fija por juicio experto en
  ausencia de suficientes datos para optimizar.
- Requiere un valor de arranque `Pronóstico(1) = D(1)` o el promedio de los primeros períodos.

### 2.4 Suavizado exponencial con tendencia (Holt / doble exponencial)

Para series con tendencia pero sin estacionalidad marcada. Usa dos constantes: `α` (nivel) y `β`
(tendencia).

- Nivel: `L(t) = α × D(t) + (1 - α) × (L(t-1) + T(t-1))`
- Tendencia: `T(t) = β × (L(t) - L(t-1)) + (1 - β) × T(t-1)`
- Pronóstico a h períodos: `Pronóstico(t+h) = L(t) + h × T(t)`

β alto (ej. 0.3+) implica que la tendencia estimada cambia rápido con cada observación nueva; β
bajo la mantiene más estable.

### 2.5 Ajuste estacional (índice estacional mensual)

**Método razón-a-promedio-móvil (el más usado):**
1. Calcular un promedio móvil centrado de 12 meses sobre la demanda real (esto elimina
   tendencia y estacionalidad, dejando el nivel base).
2. Para cada mes, calcular la razón: `Demanda real / Promedio móvil centrado` → esto aísla el
   componente estacional + ruido de ese mes.
3. Promediar esas razones por mes calendario a través de los años disponibles → índice estacional
   preliminar por mes.
4. Normalizar los 12 índices para que su promedio sea exactamente 1.0 (o su suma sea 12).

**Uso del índice para pronosticar:**
- Desestacionalizar: `Demanda desestacionalizada = Demanda real / Índice estacional del mes`
- Pronosticar la serie desestacionalizada (tendencia/nivel) y luego **reestacionalizar**:
  `Pronóstico final del mes = Pronóstico desestacionalizado × Índice estacional de ese mes`

**Requisito de datos:** se necesita como mínimo **12 meses** para obtener un índice preliminar, y
idealmente **24+ meses (2 ciclos)** para confirmar que el patrón es estable año a año y no ruido
de un solo año.

**Regla para el agente:** con menos de 12 meses de historial, NO calcular ni aplicar índice
estacional; usar SES o WMA sin ajuste estacional y advertir que el pronóstico no captura
estacionalidad todavía.

### 2.6 Demanda intermitente (método de Croston) — caso especial para SKU clase C/Z

Cuando el SKU tiene muchos meses en cero (demanda esporádica, típico de clase C o Z), el SES
convencional sesga el pronóstico hacia abajo después de cada período en cero. El método de
Croston separa dos series suavizadas:
- Tamaño de la demanda cuando ocurre (solo se actualiza en períodos con demanda > 0).
- Intervalo entre ocurrencias de demanda.

`Pronóstico por período = (tamaño de demanda suavizado) / (intervalo suavizado entre demandas)`

**Limitación conocida:** el Croston clásico tiene sesgo al alza; la corrección de
Syntetos-Boylan (SBA) multiplica el resultado por `(1 - α/2)`. No usar SBA en demanda regular (no
intermitente): introduce sesgo innecesario ahí.

**Regla para el agente:** si un SKU tiene ≥40-50% de los meses en demanda cero, tratarlo como
intermitente y usar lógica tipo Croston (o al menos no usar SES estándar) en vez de los métodos
de la sección 2.1-2.5.

Fuentes:
- [MetricGate - Demand Forecasting Calculator / docs](https://metricgate.com/docs/demand-forecasting/)
- [WSU course transcript - forecasting methods (alpha típico 0.1/0.2/0.3)](https://apps.aoi.wsu.edu/onlineMedia/transcripts/mgtop340_01_v(c132).pdf)
- [Statistics By Jim - Exponential Smoothing for Time Series Forecasting](https://statisticsbyjim.com/time-series/exponential-smoothing-time-series-forecasting/)
- [Cleverence - Method 9: Weighted Moving Average](https://www.cleverence.com/articles/oracle-documentation/method-9-weighted-moving-average-4832/)
- [Oracle JD Edwards docs - Method 9: Weighted Moving Average](https://docs.oracle.com/en/applications/jd-edwards/supply-chain-manufacturing/9.2/eoafm/method-9-weighted-moving-average.html)
- [bookdown.org - Chapter 4 Exponential Smoothing (incluye Holt)](https://bookdown.org/mpfoley1973/time-series/exponential.html)
- [Çankaya University MIS306 - Forecasting: Smoothing (Holt's method, notación β*)](https://akademik.cankaya.edu.tr/~iozkan/mis306/smoothing.html)
- [ecampusontario Pressbooks - cálculo de índice estacional (razón a promedio móvil)](https://ecampusontario.pressbooks.pub/introstats2ed/?p=1953)
- [arXiv - Intermittency and Obsolescence: a Croston Method With Linear Decay](https://arxiv.org/pdf/1409.1609)
- [R fable package docs - CROSTON (incluye referencia a Syntetos-Boylan SBA)](https://search.r-project.org/CRAN/refmans/fable/html/CROSTON.html)
- [AWS - Amazon Forecast cold-start para productos sin historial](https://aws.amazon.com/about-aws/whats-new/2022/11/amazon-forecast-generates-predictions-products-historical-data-more-accurate)

---

## 3. Punto de reorden (ROP)

**Fórmula base (demanda y lead time constantes):**

`ROP = Demanda diaria/mensual promedio × Lead time`

**Fórmula completa con stock de seguridad (caso general):**

`ROP = (D̄ × L̄) + Stock de seguridad`

donde `D̄` = demanda media por período, `L̄` = lead time medio (en las mismas unidades que la
demanda: si la demanda es mensual, el lead time debe expresarse en meses o fracción de mes).

**Caso con demanda variable y lead time variable simultáneamente** (el caso general y más
realista para una empresa real):

`Stock de seguridad = Z × √( L̄ × σd² + D̄² × σL² )`

donde:
- `Z` = valor z del nivel de servicio objetivo
- `D̄` = demanda media por período
- `L̄` = lead time medio (en períodos)
- `σd` = desviación estándar de la demanda por período
- `σL` = desviación estándar del lead time (en períodos)

`ROP = D̄ × L̄ + Stock de seguridad`

**Casos simplificados:**
- Solo la demanda varía (lead time fijo): `SS = Z × σd × √L`
- Solo el lead time varía (demanda fija): `SS = Z × D̄ × σL`

**Ejemplo numérico de referencia (para validar la lógica del agente):** demanda media 50
unidades/día, lead time medio 7 días con desviación estándar de 2 días, desviación estándar de
demanda diaria 10 unidades, Z = 1.65 (95% servicio):
`SS = 1.65 × √(7×10² + 50²×2²) = 1.65 × √(700 + 10 000) ≈ 1.65 × 103.44 ≈ 171 unidades`
`ROP ≈ (50×7) + 171 = 350 + 171 = 521 unidades`

**Método simplificado alternativo (sin desviación estándar, útil para empresas pequeñas con poco
dato histórico limpio):**
`SS = (Demanda máxima × Lead time máximo) - (Demanda promedio × Lead time promedio)`
Es más conservador (sobreestima) pero no requiere calcular varianza; recomendado como *fallback*
del agente cuando hay menos de ~6-12 observaciones (muestra insuficiente para una desviación
estándar confiable).

**Regla de unidades (crítica para evitar errores de cálculo):** mantener consistencia de
unidades temporales entre demanda y lead time (si la demanda está en unidades/mes, el lead time
debe convertirse a fracción de mes, no dejarse en días sin convertir).

Fuentes:
- [Netstock - Reorder point formula](https://www.netstock.com/blog/reorder-point-formula/)
- [Cleverence - How to calculate reorder point with safety stock](https://www.cleverence.com/articles/for-business/how-to-calculate-reorder-point-with-safety-stock-5829/)
- [Cleverence - Guide: safety stock reorder point calculation](https://www.cleverence.com/articles/for-business/safety-stock-reorder-point-calculation-4721/)
- [Oracle NetSuite docs - Inventory Management Preferences (safety stock en días, lead time default 14 días)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_162488535703.html)

---

## 4. Cálculo de stock de seguridad (safety stock)

**Fórmula estándar (demanda variable, lead time constante):**

`SS = Z × σd × √L`

donde `Z` = z-score del nivel de servicio deseado, `σd` = desviación estándar de la demanda por
período, `L` = lead time en el mismo período.

**Tabla de valores Z por nivel de servicio (estándar, distribución normal):**

| Nivel de servicio objetivo | Z |
|---|---|
| 90% | 1.28 |
| 95% | 1.645 |
| 97.5% | 1.96 |
| 98% | 2.05 |
| 99% | 2.33 |
| 99.9% | 3.09 |

**Interpretación para el agente:** el nivel de servicio es la probabilidad de NO tener quiebre de
stock durante el lead time en un ciclo de reposición. A mayor Z → mayor stock de seguridad → menor
riesgo de quiebre pero mayor costo de mantener inventario. Para SKU clase A críticos, usar 97-99%;
para clase C, 90-95% suele ser suficiente (el costo de un quiebre es menor).

**Ejemplo numérico de referencia:** demanda 100 unidades/semana, σ = 20 unidades/semana, lead
time 3 semanas, servicio 95% (Z=1.645):
`SS = 1.645 × 20 × √3 ≈ 1.645 × 34.64 ≈ 57 unidades`

**Cuando el lead time también varía**, usar la fórmula combinada de la sección 3:
`SS = Z × √(L̄×σd² + D̄²×σL²)`. Omitir la variabilidad del lead time cuando en realidad es alta
puede **subestimar sustancialmente** el stock de seguridad real necesario (una fuente vendor
afirma una subestimación de 30-60% para SKU críticos; esa cifra específica no pudo verificarse
contra una fuente primaria, tratarla como orden de magnitud, no como dato duro).

**Supuesto de la fórmula:** asume demanda aproximadamente normal. Para demanda intermitente o muy
asimétrica, el enfoque estadístico estándar es poco confiable; se recomienda usar percentiles
empíricos de la distribución histórica de demanda-durante-lead-time (tomar el percentil
correspondiente al nivel de servicio directamente de los datos observados, idealmente con 30-50
ciclos de historia) en vez de la fórmula normal.

Fuentes:
- [Linnworks - Safety stock formula: How to calculate and use it](https://www.linnworks.com/?p=5595)
- [Cleverence - How to Calculate Safety Stock and Avoid Running Out of Inventory (vía Metrobi)](https://metrobi.com/blog/safety-stockwhat-is-safety-stock-why-it-matters/)
- [Global Sources - Safety Stock 101: Formulas, Costs & Risks Explained](https://www.globalsources.com/knowledge/safety-stock/)
- [Netstock - Reorder point formula](https://www.netstock.com/blog/reorder-point-formula/)

---

## 5. Cantidad económica de pedido (EOQ)

**Fórmula (modelo clásico de Wilson):**

`EOQ = √( (2 × D × S) / H )`

donde:
- `D` = demanda anual (unidades/año)
- `S` = costo fijo de ordenar/emitir cada pedido ($/pedido)
- `H` = costo de mantener (holding cost) una unidad en inventario durante un año ($/unidad/año)

**Ejemplo numérico de referencia:** D = 12 000 unidades/año, S = $50/pedido, H = $2/unidad/año:
`EOQ = √((2×12000×50)/2) = √600000 ≈ 774.6 → 775 unidades por pedido`

**Supuestos del modelo (todos deben cumplirse para que EOQ sea válido):**
- Demanda constante y conocida (determinística, sin variabilidad).
- Costo de ordenar fijo por pedido, independiente de la cantidad.
- Costo de mantener constante por unidad.
- Reposición instantánea (todo el pedido llega de una vez).
- Sin descuentos por volumen, sin restricciones de capacidad/presupuesto.

**Limitaciones prácticas (cuándo NO usar EOQ directamente, o usarlo solo como punto de partida):**
1. **Demanda volátil/estacional:** un EOQ fijo puede generar oscilaciones de inventario
   (sobre-pedido en temporada baja, sub-pedido en temporada alta). Combinar con pronóstico
   dinámico en vez de un EOQ estático.
2. **Descuentos por volumen/precio escalonado:** el EOQ ignora que un pedido más grande puede
   bajar el costo unitario; en ese caso se debe evaluar el costo total (incluyendo descuento) para
   cada quiebre de precio, no solo la fórmula EOQ.
3. **Lead time no confiable:** el EOQ no considera riesgo de desabasto; debe combinarse siempre
   con stock de seguridad y ROP (secciones 3-4).
4. **Productos perecederos/con caducidad:** el EOQ no modela obsolescencia/merma; un EOQ grande
   puede ser inviable si el producto caduca antes de consumirse. En estos casos, limitar la
   cantidad sugerida al consumo esperado durante la vida útil, sin importar lo que diga el EOQ.
5. **Múltiples productos con restricción compartida** (espacio de bodega, pallets, capital
   disponible): el EOQ se calcula SKU por SKU y no reconoce estas restricciones conjuntas; requiere
   ajuste o prorrateo manual.
6. **Restricción de caja/capital:** si el negocio no tiene liquidez para comprar el EOQ completo,
   debe priorizarse por clase ABC (comprar el EOQ completo de clase A primero).

**Regla para el agente:** tratar el EOQ como un **punto de partida matemático**, no como la
recomendación final automática. Siempre cruzarlo con: nivel de servicio deseado (ROP + SS),
capacidad de almacenamiento, caducidad del producto y presupuesto disponible antes de emitir la
cantidad final recomendada.

Fuentes:
- [NerdWallet - What Is the Economic Order Quantity? EOQ Formula, Calculator, Example](https://www.nerdwallet.com/article/small-business/economic-order-quantity-eoq-formula)
- [Cleverence - EOQ Explained](https://www.cleverence.com/articles/for-business/identify-formula-to-calculate-economic-order-quantity-4821/)
- [Racklify - Limitations Of Economic Order Quantity For Modern Fulfillment Networks](https://racklify.com/encyclopedia/limitations-of-economic-order-quantity-for-modern-fulfillment-networks/)
- [Linnworks - Economic order quantity formula: What it is and how to use it](https://www.linnworks.com/blog/economic-order-quantity-formula/)

---

## 6. Rotación de inventario (Inventory Turnover)

**Fórmula estándar (base costo, la recomendada para decisiones operativas):**

`Rotación de inventario = COGS (costo de lo vendido) / Inventario promedio`

`Inventario promedio = (Inventario inicial + Inventario final) / 2`

**Variante retail (base venta, útil para merchandising/márgenes, no para decisiones operativas
de compra):**

`Rotación (retail) = Ventas netas / Inventario promedio a precio de venta`

**Conversión a días de inventario (Days Inventory Outstanding / Días de cobertura):**

`DIO = 365 / Rotación de inventario`

**Advertencia de cálculo:** no mezclar base costo con base venta en la misma fórmula; usar COGS
con inventario a costo, o ventas con inventario a precio de venta, consistentemente.

**Benchmarks orientativos por industria (rangos directivos, no un estándar único; combinan
varias fuentes, tratarlos como punto de partida y ajustar con el contexto de lead time, amplitud
de SKU, estacionalidad y nivel de servicio deseado):**

| Industria | Rotación anual típica | Días de inventario aprox. |
|---|---|---|
| Alimentos/bebidas, perecederos | 10-18+ (hasta mucho más en fresco de alta rotación) | ~20-36 días |
| Supermercados/conveniencia | 12-18+ | ~20-30 días |
| Moda rápida / fast fashion | 8-12 | ~30-46 días |
| Electrónica de consumo (retail) | 5-10 | ~36-73 días |
| Manufactura (general) | 4-8 | ~45-90 días |
| Manufactura intensiva en capital / bienes pesados | 2-4 | ~90-180 días |
| Distribución industrial / mayoristas | 3-6 | ~60-120 días |
| Muebles | 2-4 | ~90-180 días |
| Retail general (promedio) | 5-9 | ~40-73 días |

**Regla de interpretación para el agente:**
- Rotación **muy por debajo** del rango típico de la industria → señal de sobrestock, capital
  inmovilizado, riesgo de obsolescencia → sugerir reducir cantidad de compra o liquidar excedente.
- Rotación **muy por encima** del rango típico → puede ser eficiencia real, pero también puede
  señalar quiebres de stock frecuentes (vendiendo "del aire", reabasteciendo constantemente bajo
  presión) → cruzar con tasa de quiebre de stock (sección 9) antes de concluir que es saludable.
- Rotación = 0 o indefinida en un SKU con historial → stock muerto (dead stock); candidato a
  liquidación o descontinuación.

**Nota de fuente:** los benchmarks por industria provienen de blogs especializados y
consultoras (no de una base estadística única, pública y auditable como el Census o RMA
actualizados); el Census económico de EE.UU. de 2007 (vía Strategos) da para manufactura un rango
histórico de 6.2 (cuero) a 16.7 (petróleo), más alto que las guías recientes citadas, lo que
confirma que estos números varían bastante según fuente, subsector y año. Usarlos como orden de
magnitud, siempre ajustados por la propia serie histórica de la empresa cuando exista.

Fuentes:
- [Cleverence - Inventory turnover averages: benchmarks, formulas, and industry insights](https://www.cleverence.com/articles/for-business/inventory-turnover-averages-3841/)
- [Cleverence - What is a good inventory turnover ratio for manufacturing industry](https://www.cleverence.com/articles/for-business/what-is-a-good-inventory-turnover-ratio-for-manufacturing-4827/)
- [Oracle NetSuite - The magic number of annual inventory turns for manufacturing companies](https://www.netsuite.com/portal/resource/articles/business-strategy/the-magic-number-of-annual-inventory-turns-for-manufacturing-companies.shtml)
- [Strategos - Inventory Speaks (benchmarks por subsector, US Census 2007)](https://strategosinc.com/RESOURCES/10-Inventory/Inventory%20Speaks-1.htm)
- [helpdesk.africanfinancials.com - fórmula atribuida a Investopedia](https://helpdesk.africanfinancials.com/support/solutions/articles/234494-what-is-the-formula-for-calculating-inventory-turnover-)

---

## 7. Cómo debe escalar la gestión de inventario según tamaño de empresa

| Dimensión | Empresa pequeña (pocos SKU, 1 bodega) | Empresa grande (multi-bodega, alto SKU, ERP) |
|---|---|---|
| Herramienta | Hoja de cálculo o sistema básico; revisión manual | ERP/WMS integrado con visibilidad en tiempo real multi-sitio |
| Frecuencia de revisión | Semanal/mensual, manual, por SKU importante | Automatizada, continua, con alertas y reorden automático |
| Método de pronóstico | SMA/WMA simples, o SES básico; a veces solo juicio del dueño | SES/Holt-Winters por SKU-ubicación, a veces modelos estadísticos o ML, recalculados automáticamente |
| Clasificación ABC/XYZ | Manual, revisada ocasionalmente (trimestral/semestral) | Automatizada y recalculada periódicamente (mensual) para miles de SKU |
| Punto de quiebre operativo | Cuando el catálogo crece a varios cientos/miles de SKU, o se abre una segunda bodega, la gestión manual se vuelve inviable (coordinación entre sitios, redistribución de excedentes) | Ya diseñado para esto desde el inicio: múltiples bodegas, trazabilidad por lote/vencimiento, consolidación de demanda entre sitios (demand pooling) |
| Gestión multi-sitio | No aplica / informal | Esencial: pooling de demanda entre ubicaciones reduce el stock de seguridad total necesario respecto a sumar el de cada sitio por separado |
| Riesgo típico | Falta de visibilidad en tiempo real, decisiones basadas en intuición, bulk buying mal planeado | Complejidad de coordinación, mayor costo de sistema, pero mejor control si está bien implementado |

**Regla para el agente (ajuste de complejidad de la recomendación según tamaño declarado):**
- **Negocio pequeño:** preferir métodos simples y explicables (SMA/WMA, ROP con fórmula
  simplificada de máx/mín si no hay suficiente historia para desviación estándar), explicar el
  razonamiento en términos simples, asumir revisión manual periódica.
- **Negocio mediano:** introducir SES/Holt, ABC/XYZ formal, ROP estadístico con Z-score.
- **Empresa grande/multi-bodega:** calcular por combinación SKU×ubicación, considerar
  consolidación de demanda entre bodegas para reducir stock de seguridad total, y asumir
  integración con reposición automática y revisión continua.

Fuentes:
- [Netstock - Inventory management for small to medium businesses](https://www.netstock.com/blog/inventory-management-small-to-medium-businesses/)
- [Spire Systems - multi-location / multi-warehouse inventory](https://www.spiresystems.com/tag/business-management-software/page/3/)
- [MRPeasy - multi location inventory management](https://mrpeasy.com/blog/multi-location-inventory-management)
- [PYMNTS - Placing Inventory, Not Accounting, At The Crux Of The ERP](https://www.pymnts.com/?p=981140)

---

## 8. Causas comunes de sobrestock y quiebre de stock, y mitigaciones estándar

### 8.1 Causas de sobrestock
1. Pronóstico de demanda inexacto (sobreestimación, sin mecanismo de ajuste por error histórico).
2. Compras en lote grande por descuento de proveedor sin validar si la rotación real lo justifica.
3. Falta de datos de inventario en tiempo real (se compra "por si acaso" sin saber lo que ya hay).
4. Mala planeación de promociones/campañas (se compra para un pico de demanda que no se repite).
5. Lead times largos que inducen a sobre-pedir "por seguridad" sin cálculo formal de stock de
   seguridad.
6. No dar de baja SKU de baja/nula rotación (stock muerto que nunca se revisa ni se liquida).

### 8.2 Causas de quiebre de stock
1. Pronóstico de demanda insuficiente o desactualizado (no captura un repunte real de demanda).
2. Punto de reorden mal calculado o no ajustado cuando cambia el lead time del proveedor.
3. Restricciones de flujo de caja que retrasan la orden de compra aunque el ROP ya se alcanzó.
4. Interrupciones de la cadena de suministro (proveedor único sin alternativa, sección de
   búsqueda de proveedores del sistema de agentes).
5. Falta de comunicación entre ventas/compras (campañas de venta no informadas a compras a
   tiempo).
6. Falta de stock de seguridad adecuado para SKU de alta variabilidad (clase Y/Z).

### 8.3 Mitigaciones estándar (aplican a ambos problemas, ya que comparten causa raíz: visibilidad
y pronóstico deficientes)
1. Pronóstico de demanda sistemático y recalculado periódicamente (no solo intuición), con
   método ajustado al historial disponible (sección 2).
2. Reorden automático basado en ROP + stock de seguridad calculado estadísticamente (secciones
   3-4), no en reglas fijas arbitrarias.
3. Revisión periódica de la mezcla de productos (ABC/XYZ) para reasignar nivel de control y
   stock de seguridad según cambie el comportamiento de cada SKU.
4. Visibilidad de inventario en tiempo real (evitar decisiones "a ciegas" sobre lo que ya hay en
   bodega).
5. Diversificación de proveedores para SKU críticos (reduce el riesgo de quiebre por
   interrupción de un solo proveedor) — este es precisamente el rol del agente de búsqueda de
   proveedores del sistema.
6. Planes de contingencia explícitos para disrupciones conocidas (proveedor único, temporada
   alta, importaciones con aduana lenta).
7. Monitoreo explícito del indicador de quiebre y de sobrestock (sección 9) para detectar el
   problema temprano, en vez de descubrirlo cuando ya ocurrió.

**Regla para el agente:** cuando recomiende una cantidad de compra, debe declarar explícitamente
qué riesgo está mitigando (quiebre vs. sobrestock) y con qué margen (nivel de servicio asumido),
no solo entregar un número sin justificación.

Fuentes:
- [MRPeasy - Stockout causes and prevention](https://www.mrpeasy.com/blog/stockout)
- [Cin7 - How to prevent overstocking problems](https://www.cin7.com/blog/how-to-prevent-overstocking-problems/)
- [Shopify - Overstocking: causes and prevention](https://www.shopify.com/blog/overstocking-causes-and-prevention)
- [Intuendi - Out of Stock: How to Manage and Prevent Product Shortages](https://intuendi.com/resource-center/out-of-stock)

---

## 9. KPIs clave que un gerente de inventario profesional monitorea mensualmente

| KPI | Fórmula | Uso / umbral orientativo |
|---|---|---|
| **Rotación de inventario** | COGS / Inventario promedio | Ver tabla de benchmarks sección 6 |
| **Días de inventario (DIO)** | 365 / Rotación de inventario | Comparar contra el ciclo de venta/producción real del negocio |
| **Fill rate (tasa de cumplimiento)** | Unidades despachadas / Unidades pedidas (o a nivel de línea/orden completa, según se defina) | Objetivo típico: 95%+ para SKU clase A; medir y declarar si es por unidad, por línea o por orden completa |
| **Tasa de quiebre de stock (stockout rate)** | Incidentes de quiebre / Ocasiones de demanda, o SKU en quiebre / Total SKU | Un rango de ~2-5% suele considerarse eficiente; 0% sostenido suele indicar exceso de stock de seguridad, no un logro |
| **Costo de mantener inventario (carrying cost %)** | (Capital inmovilizado + almacenamiento + manejo + seguros + impuestos + obsolescencia) / Valor promedio de inventario | Rango típico citado en la industria: 18-30% anual del valor de inventario; calibrar con costos financieros reales de la empresa |
| **GMROI (Gross Margin Return on Inventory Investment)** | Margen bruto / Inventario promedio a costo | Muchos retailers apuntan a >2-3; comparar dentro de la misma categoría de producto, no contra un único número universal |
| **Nivel de servicio realizado** | Ciclos sin quiebre / Total de ciclos de reposición | Comparar contra el nivel de servicio objetivo usado para calcular el stock de seguridad (sección 4) |
| **Exactitud del pronóstico (forecast accuracy / MAPE)** | 1 - (Σ\|Real - Pronóstico\| / Σ Real) | Monitorear mensualmente por clase ABC; si el error crece sostenidamente, recalibrar el método o el alpha |
| **Stock muerto / obsoleto (% del inventario)** | Valor de SKU sin movimiento en N meses / Valor total de inventario | Revisar mensualmente para liquidar o descontinuar SKU clase C/Z sin rotación |
| **Valor total de inventario vs. presupuesto/capital disponible** | Inventario a costo actual / Presupuesto asignado | Control de caja, relevante sobre todo en empresas pequeñas con restricción de capital |

**Regla para el agente:** al entregar una recomendación mensual, idealmente acompañarla de al
menos 3 de estos indicadores (rotación, quiebre/fill rate, y exactitud de pronóstico del mes
anterior) para que la recomendación sea auditable y no una caja negra.

Fuentes:
- [Cleverence - Inventory metrics: Definitions, formulas, benchmarks, and dashboards](https://www.cleverence.com/articles/for-business/inventory-metrics-4829/)
- [GEP - Inventory management KPIs that matter most](https://gep.com/blog/strategy/inventory-management-kpis-that-matter-most)
- [Flxpoint - Inventory management KPIs to track](https://flxpoint.com/blog/inventory-management-kpis-to-track)
- [Inventory Planner - inventory management KPIs](https://inventory-planner.com/inventory-management-kpis)

---

## Notas de calidad de fuentes (para transparencia)

- La mayoría de fuentes consultadas son blogs técnicos de proveedores de software de
  inventario/ERP (Cleverence, Netstock, NetSuite, Linnworks, MRPeasy, Cin7, Shopify, SCMDOJO) y
  sitios de cursos universitarios o documentación de software estadístico (Çankaya University,
  ecampusontario/Pressbooks, bookdown.org, Oracle/Infor docs, paquete R `fable`). No se encontró
  acceso directo a Investopedia ni a la base de conocimiento oficial de APICS/ASCM (CPIM/CSCP) en
  esta sesión de búsqueda; donde una fuente atribuye una definición a Investopedia de forma
  indirecta, se señala explícitamente.
- Todas las fórmulas centrales (ABC por valor acumulado, CV para XYZ, SMA/WMA/SES/Holt, ROP = D̄×L̄
  + SS, SS = Z×σ×√L y su extensión con lead time variable, EOQ = √(2DS/H), Rotación =
  COGS/Inventario promedio) son coherentes entre múltiples fuentes independientes y corresponden
  a los modelos estándar de la literatura de gestión de operaciones/cadena de suministro.
- Los umbrales de clasificación (80/15/5, CV 0.5/1.0, benchmarks de rotación por industria) son
  **convenciones de la industria, no constantes universales**; el documento señala esto en cada
  sección para que el agente los use como punto de partida ajustable, no como regla rígida.
- Cifras puntuales que no pudieron verificarse contra una fuente primaria (p. ej., "ignorar la
  variabilidad del lead time subestima el stock de seguridad en 30-60%") se marcan explícitamente
  como no verificadas / de orden de magnitud.
