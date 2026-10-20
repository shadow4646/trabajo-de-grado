# Base de conocimiento operativa: Agente de compras/abastecimiento profesional

Referencia técnica densa para incrustar en el system prompt de un agente de IA (n8n) que busca
proveedores/fabricantes en la web, los compara y recomienda la mejor opción de abastecimiento
minimizando costo total y gestionando riesgo, para empresas de cualquier tamaño.

---

## 1. Matriz de Kraljic (segmentación de compras: riesgo de suministro vs. impacto en utilidad)

Modelo de cartera 2x2 (Peter Kraljic, *Harvard Business Review*, 1983) que clasifica cada
ítem/categoría de compra según dos ejes: **impacto en el resultado/utilidad** (% del costo de
bienes vendidos, volumen de gasto, impacto en el valor agregado) y **riesgo/complejidad de
suministro** (disponibilidad de proveedores, complejidad de mercado, riesgo de escasez, costo/tiempo
de cambio de proveedor). Resultan 4 cuadrantes, cada uno con una estrategia de compra distinta.

| Cuadrante | Impacto en utilidad | Riesgo de suministro | Estrategia recomendada |
|---|---|---|---|
| **Items apalancables (leverage)** | Alto | Bajo | Explotar poder de compra: licitación competitiva (competitive bidding), comparar múltiples proveedores agresivamente, negociar por volumen, optimizar costo total. Múltiples proveedores capaces compiten por el negocio. |
| **Items estratégicos (strategic)** | Alto | Alto | Relación de socio a largo plazo, no presión de precio. Contratos multianuales, co-innovación, involucrar al proveedor en planeación, gestión conjunta de riesgo, visibilidad mutua de pronósticos. |
| **Items cuello de botella (bottleneck)** | Bajo | Alto | Asegurar continuidad de suministro: contratos de reserva de capacidad, inventario de seguridad/buffer stock, calificar proveedores alternativos para reducir dependencia, planes de contingencia. El objetivo es reducir riesgo, no precio. |
| **Items no críticos (non-critical/routine)** | Bajo | Bajo | Estandarizar y automatizar: catálogos electrónicos, órdenes de compra automáticas (e-procurement), proveedores preferentes, minimizar carga administrativa/transaccional. |

**Reglas de aplicación para el agente:**
- La clasificación **no es fija por producto**: el mismo insumo puede ser "cuello de botella" para
  una empresa y "apalancable" para otra con más proveedores calificados disponibles. Clasificar
  según el contexto específico de la empresa que compra (cuántos proveedores viables existen,
  cuánto volumen representa el gasto).
- Movimiento estratégico deseable: mover ítems de "cuello de botella" hacia "apalancable"
  calificando proveedores alternativos (reduce riesgo → habilita competencia de precio).
- Para un ítem **estratégico**, el agente NO debe recomendar simplemente "el proveedor más barato";
  debe ponderar estabilidad de relación, capacidad de co-desarrollo y continuidad.
- Para un ítem **apalancable**, el agente SÍ debe maximizar presión competitiva: pedir múltiples
  cotizaciones, usar la competencia entre proveedores como palanca de negociación.
- Para un ítem **cuello de botella**, el agente debe señalar explícitamente el riesgo de
  concentración y recomendar sondear un segundo proveedor aunque sea más caro.

Fuentes:
- [The Kraljic Matrix Simply Explained — Art of Procurement](https://artofprocurement.com/blog/learn-the-kraljic-matrix)
- [Kraljic Matrix Supplier Segmentation Framework — Umbrex](https://umbrex.com/resources/frameworks/supply-chain-frameworks/kraljic-matrix/)
- [The Kraljic Matrix: A Procurement Leader's Guide — Amazon Business](https://business.amazon.com/en/blog/kraljic-matrix)
- [Kraljic Matrix: What Is It, How It Works, and How To Use It — Planergy](https://planergy.com/blog/kraljic-matrix/)
- [Kraljic Matrix: the Basics and Example — Toolshero](https://www.toolshero.com/strategy/kraljic-portfolio-purchasing-model/)
- [Kraljic Matrix Explained — Fractory](https://fractory.com/kraljic-matrix/)
- [Kraljic's Matrix: 4 Drivers of Category Management Strategy — ProcureAbility](https://procureability.com/kraljics-matrix-4-drivers-of-category-management-strategy)

---

## 2. Proceso de abastecimiento estratégico (strategic sourcing)

Secuencia estándar de etapas (varía ligeramente en número según la fuente, pero el núcleo es
consistente). El agente debe pensar en términos de este flujo cuando construye su recomendación,
aunque automatice solo una porción (búsqueda, comparación, recomendación):

1. **Análisis de gasto (spend analysis):** entender qué se compra, a quién, cuánto, con qué
   frecuencia. Identifica qué categorías y proveedores concentran el costo (base para priorizar
   dónde vale la pena invertir esfuerzo de negociación).
2. **Análisis de mercado / categoría:** investigar la estructura del mercado proveedor
   (fragmentado vs. concentrado, cuántos fabricantes reales existen, tendencias de precio de
   materia prima, capacidad instalada, barreras de entrada). Determina si conviene consolidar
   volumen, licitar competitivamente o renegociar con el proveedor actual.
3. **Desarrollo de estrategia de abastecimiento:** decidir enfoque según cuadrante de Kraljic
   (sección 1) y decisión make-or-buy.
4. **RFI (Request for Information):** etapa exploratoria temprana, sin precios, para entender
   capacidades de los proveedores cuando el panorama de oferta no es claro. Se puede omitir si el
   mercado ya es conocido.
5. **RFQ (Request for Quotation):** usar cuando la especificación ya está definida y cerrada y la
   decisión se basa principalmente en precio y condiciones comerciales básicas (plazos de entrega,
   términos de pago). Respuesta rápida, comparación directa de cotizaciones.
6. **RFP (Request for Proposal):** usar para necesidades complejas o categorías estratégicas donde
   se requiere que el proveedor proponga una solución a medida (no solo cotizar), por ejemplo
   servicios con componente de diseño/ingeniería.
   - Regla práctica para el agente: **RFQ cuando ya se sabe exactamente qué se necesita y gana el
     mejor precio/condiciones; RFP cuando se necesita que el proveedor proponga cómo resolver el
     problema; RFI cuando todavía se está explorando el mercado.**
7. **Negociación:** uso de inteligencia de mercado (benchmarks de categoría, should-cost model,
   cotizaciones competidoras) para mejorar precio y condiciones contractuales (ver sección 5).
8. **Contratación:** formalizar términos, SLAs, penalidades, condiciones de pago, cláusulas de
   salida/cancelación.
9. **Onboarding del proveedor:** alta en sistemas, validación de datos fiscales/bancarios,
   alineación de procesos logísticos, antes de la primera orden de compra real.
10. **Gestión y revisión continua del desempeño:** monitoreo contra el contrato (KPIs, sección 8),
    y planificación de la relación (SRM) especialmente para ítems estratégicos.

Fuentes:
- [7 Key Steps of the Strategic Sourcing Process — Veridion](https://veridion.com/blog-posts/strategic-sourcing-process-steps/)
- [Strategic Sourcing: A Step-by-Step Process for Mid-Size Companies — Corpay](https://www.corpay.com/resources/blog/strategic-sourcing)
- [Strategic sourcing — Wikipedia](https://en.wikipedia.org/wiki/Strategic_sourcing)
- [What is Strategic Sourcing? — Rippling](https://www.rippling.com/blog/strategic-sourcing)
- [Strategic Sourcing Process: Step-by-Step Guide — The Buying Desk](https://thebuyingdesk.com/strategic-sourcing-process/)
- [CIPS Procurement and Supply Cycle](https://www.cips.org/intelligence-hub/procurement/procurement-supply-cycle)
- [CIPS Sourcing — intelligence hub](https://www.cips.org/intelligence-hub/sourcing)
- [The Procurement Cycle Explained — Delta eSourcing](https://www.delta-esourcing.com/resources/etendering-blog/the-procurement-cycle-explained/)
- [Understanding RFI, RFP, and RFQ: What's the Difference? — Sirion](https://www.sirion.ai/library/contract-management/rfi-rfp-rfq-differences/)

**Ciclo CIPS (13 etapas, marco de referencia académico, pre-contrato / post-contrato):**
Pre-contrato: definir necesidad y especificación → análisis de mercado y decisión make-or-buy →
desarrollo de estrategia → sondeo de mercado → documentación de tender → preselección de
proveedores → emisión de ITT/RFQ → evaluación de ofertas. Post-contrato: adjudicación e
implementación → recepción/almacenaje → revisión de desempeño del contrato → gestión de relación
con proveedor (SRM) → gestión de activos/salida. Regla CIPS sobre licitación competitiva: tiene
sentido cuando existe competencia real en el mercado y el comprador tiene poder de negociación; si
depende de una única fuente, es mejor desarrollar competencia o evaluar producción propia antes de
licitar.

---

## 3. Costo Total de Propiedad (TCO) vs. precio unitario

**Principio central para el agente: nunca recomendar basándose solo en el precio unitario/FOB más
bajo.** El precio de lista es frecuentemente la porción más pequeña del costo real cuando se trata
de compras internacionales o recurrentes.

### Fórmula general de TCO (adaptada a compras/abastecimiento)

```
TCO = Costo de adquisición
    + Costo logístico (flete, seguro, manejo portuario, transporte interno)
    + Aranceles / impuestos de importación (customs duties, tariffs)
    + Costo financiero de términos de pago (costo de capital atado, descuentos por pronto pago perdidos)
    + Costo de inventario asociado al MOQ y al lead time (almacenamiento, obsolescencia, capital inmovilizado)
    + Costo de calidad (tasa de defectos, retrabajo, devoluciones, inspecciones)
    + Costo de administración/transacción (tiempo de búsqueda, gestión de PO, facturación)
    + Costo de riesgo de interrupción (expedite fees, stock de seguridad adicional por lead time largo/variable)
    − Valor residual / recuperación (si aplica)
```

### Costo de aterrizaje (landed cost) — el componente logístico/aduanero detallado

```
Landed cost = Precio del producto (FOB/EXW)
            + Flete internacional
            + Seguro de carga
            + Derechos de aduana (duty) — se calcula sobre el valor CIF (producto + flete + seguro) en la mayoría de regímenes
            + Tasas portuarias / de procesamiento (ej. en EE.UU.: Merchandise Processing Fee ≈0.3464% del valor en aduana; Harbor Maintenance Fee ≈0.125% para carga marítima)
            + Honorarios de agente aduanal (broker fee)
            + Transporte interno hasta bodega
```

**Los Incoterms determinan quién paga cada tramo** y por tanto a quién corresponde cada línea de
costo al comparar cotizaciones de distintos proveedores:
- **EXW (Ex Works):** el comprador asume prácticamente todo el landed cost desde la fábrica.
- **FOB (Free On Board):** el vendedor cubre hasta subir la carga al buque de origen; el comprador
  asume flete internacional, seguro y todo lo demás.
- **CIF (Cost, Insurance, Freight):** el vendedor cubre flete y seguro hasta el puerto destino; el
  comprador aún asume derechos de aduana, tasas portuarias y transporte interno.
- **DDP (Delivered Duty Paid):** el vendedor asume prácticamente todo el landed cost, incluidos
  aranceles. Es la cotización más cómoda de comparar porque ya está "aterrizada", pero suele venir
  con margen oculto más alto.
- **Regla para el agente:** cuando compare cotizaciones de proveedores con Incoterms distintos, debe
  normalizar todas a landed cost comparable antes de decidir; comparar un precio EXW contra un
  precio DDP sin ajustar es un error común que subestima al proveedor con Incoterm "barato en
  apariencia".

### Otros factores de costo que un comprador profesional debe cuantificar (no solo mencionar)

- **MOQ (cantidad mínima de pedido):** un MOQ alto eleva el costo de mantener inventario
  (capital inmovilizado, almacenamiento, riesgo de obsolescencia) aunque el precio unitario sea
  más bajo. Debe convertirse a un costo de capital de inventario (ver fórmula de costo de
  mantenimiento de inventario, típicamente 20-30%/año del valor del inventario según literatura de
  TCO/inventario).
- **Lead time (tiempo de entrega):** lead times largos o variables obligan a mantener más
  inventario de seguridad y aumentan el riesgo de quiebre de stock; además elevan el costo de
  "expedite" (fletes urgentes) cuando algo falla. Lead time largo = costo financiero y de riesgo
  adicional, aunque no aparezca en la cotización.
- **Términos de pago:** pago anticipado (100% adelantado) tiene costo de oportunidad de capital
  (dinero inmovilizado antes de recibir el bien); términos a 30/60/90 días después de entrega
  liberan capital de trabajo y deben valorarse como ahorro financiero equivalente a una tasa de
  interés implícita al comparar ofertas con precios distintos.
- **Tasa de defectos/devoluciones:** cada % de defectos se traduce en costo de retrabajo,
  reemplazo, logística inversa y tiempo de gestión; debe sumarse al TCO, no tratarse como
  "problema de calidad aparte del costo".
- **Tipo de cambio:** compras en moneda extranjera añaden riesgo cambiario al TCO en comparaciones
  multi-periodo.

Fuentes:
- [Procurement 101: Total Cost of Ownership (TCO) — Caddi](https://caddi.com/en-us/resources/insights/total-cost-ownership/)
- [Total Cost of Ownership (TCO) — How Is It Calculated — Procurement Tactics](https://procurementtactics.com/total-cost-of-ownership-model/)
- [Total Cost of Ownership (TCO) in Procurement: Complete Guide — The Buying Desk](https://thebuyingdesk.com/total-cost-of-ownership-tco-in-procurement/)
- [Fastener Total Cost of Ownership (TCO) — Component Solutions Group](https://www.componentsolutionsgroup.com/blog/total-cost-of-ownership-tco/)
- [Landed Cost: Formula, Example and Calculation Guide — iContainers](https://www.icontainers.com/help/what-is-landed-cost-how-to-calculate/)
- [Landed Cost: Complete Guide — Finale Inventory](https://www.finaleinventory.com/guides/accounting-and-inventory-software/landed-cost/)
- [How Incoterms Affect Landed Cost — Borderline Genius](https://borderlinegenius.com/blog/incoterms-landed-cost)
- [Landed Cost Formula — Every Component Explained — Tariffs Tool](https://www.tariffstool.com/playbook/landed-cost-101)

---

## 4. Evaluación objetiva de proveedores/fabricantes (criterios y scorecard)

**Criterios centrales que convergen en la literatura (usar como dimensiones del scorecard del
agente):**

1. **Precio / costo total** (no solo precio unitario, ver sección 3).
2. **Calidad** (tasa de defectos, certificaciones, consistencia).
3. **Confiabilidad de entrega** (on-time delivery / OTIF, consistencia de lead time).
4. **Salud financiera** (riesgo de quiebra o insolvencia que interrumpa el suministro).
5. **Riesgo geográfico/geopolítico** (concentración en una región, exposición a aranceles,
   desastres naturales, inestabilidad política).
6. **Sostenibilidad / ESG** (cumplimiento ambiental y laboral, relevante también por riesgo
   reputacional y regulatorio).
7. **Comunicación / responsividad** (velocidad y claridad de respuesta, señal indirecta de
   si es fabricante real o intermediario con fricción de comunicación).
8. **Capacidad / escalabilidad** (si puede crecer con la demanda del comprador sin degradar
   servicio).
9. **Cumplimiento y riesgo regulatorio** (licencias, trazabilidad, normas del sector).

**Modelo de ponderación sugerido (rangos observados en la literatura, ajustables por categoría):**

| Criterio | Peso sugerido |
|---|---|
| Calidad | 20-30% |
| Costo total (no solo precio) | 15-30% |
| Entrega/confiabilidad | 20-25% |
| Responsividad/comunicación | 10-15% |
| Riesgo (financiero + geográfico + regulatorio) | 15-20% |
| Sostenibilidad/ESG | 5-15% |

Metodología de scoring: calificar cada proveedor 1-5 por criterio, multiplicar por el peso, suma
total = score compuesto. Usar datos objetivos (tasa de defectos real, % OTIF real, score de
crédito) donde existan; reservar el juicio subjetivo solo para criterios cualitativos (ej. calidad
de comunicación). Ajustar los pesos según el cuadrante de Kraljic del ítem (ítems críticos de
seguridad pesan más calidad/riesgo; ítems commodity pesan más costo).

**Chequeo de salud financiera (due diligence):**
- Reportes de crédito comercial: D&B (PAYDEX, Failure Score, Delinquency Score), Experian
  Commercial, Equifax Business, Moody's (si está calificado), Altares (proveedores europeos).
- **Altman Z-Score** como predictor de riesgo de insolvencia (combinación ponderada de ratios
  financieros): zona "segura" > 2.6, zona "gris" 1.1-2.6, zona de "distrés" < 1.1 (variantes
  distintas para manufactura, no-manufactura y mercados emergentes). Funciona mejor con empresas
  establecidas con estados financieros confiables; complementar con tendencia (no solo el valor
  puntual) y comparación con pares del sector.
- Señales de alerta en capital de trabajo: incremento en días de cuentas por cobrar (DSO),
  caída en rotación de inventario, ratio corriente (current ratio) por debajo de 1.0.
- Para proveedores que no cotizan en bolsa y no publican estados financieros (común en PYME/China),
  solicitar estados financieros auditados o revisados antes de calificarlos como proveedor Tier 1,
  o usar señales indirectas (años operando, tamaño de instalación, número de empleados, clientes
  referenciables).

Fuentes:
- [Supplier Evaluation: Criteria, Process, and Scorecard — SourceDay](https://sourceday.com/blog/supplier-evaluation/)
- [Supplier Selection Scorecards: MBA Guide — Board Infinity](https://www.boardinfinity.com/blog/supplier-selection-scorecards-evaluation/)
- [Supplier Evaluation: Criteria, Process & Scorecard — The Buying Desk](https://thebuyingdesk.com/supplier-evaluation/)
- [Supplier Due Diligence Checklist — Visualping](https://visualping.io/blog/supplier-due-diligence-checklist)
- [Altman Z-score — Wikipedia](https://en.wikipedia.org/wiki/Altman_Z-score)
- [Altman Z-Score — Umbrex](https://umbrex.com/resources/frameworks/finance-frameworks/altman-z-score/)
- [How to evaluate supplier financial health before signing a contract — Commodity Sourcing Insights](https://commoditysourcinginsights.com/post/evaluating-supplier-financial-health-before-contracts)
- [Supplier Credit Check Guide — CreditPulse](https://www.creditpulse.com/blog/supplier-credit-check-guide)
- [D&B Business Information Report](https://www.dnb.com/en-us/products/dnb-business-information-report.html)

---

## 5. Tácticas de negociación y palancas de un comprador profesional

- **Compromiso de volumen / contratos multianuales:** comprometer volumen futuro o un plazo de 2-3
  años a cambio de descuento (rangos observados en la práctica: 10-15% por compromiso multianual
  con tarifas bloqueadas). Estructurar en **tramos (tiered pricing)**: volumen base + descuentos
  adicionales al superar umbrales. Siempre incluir cláusulas de salida si el proveedor no cumple
  desempeño, incluso en contratos largos.
- **Licitación competitiva / BATNA explícito:** entrar a negociar con una alternativa real ya
  cotizada (proveedor B, con precio y costo de cambio conocidos) para fijar el punto de
  retirada (walk-away point). La transparencia de comparar varias cotizaciones y benchmarks de
  categoría crea presión competitiva genuina después de la etapa de RFP/RFQ.
- **Should-cost modeling:** construir una estimación independiente del costo real del proveedor
  (costo de materias primas/componentes + proceso de manufactura + margen típico de la industria)
  y usarla como ancla de negociación en vez de aceptar el precio cotizado como dado. Los
  argumentos de precio respaldados en un modelo de costos y datos de desempeño tienen más fuerza
  que pedir un descuento sin justificación.
- **Negociación de términos de pago:** pedir plazos más largos (30/60/90 días) para liberar capital
  de trabajo propio; alternativamente, ofrecer pago anticipado o pronto pago a cambio de descuento
  cuando el comprador tiene exceso de caja y el proveedor necesita liquidez. El pago anual
  anticipado suele obtener mejor descuento que pagos mensuales/trimestrales.
- **TCO como marco de negociación, no solo precio:** negociar explícitamente MOQ más bajos, lead
  time garantizado, tasa de defectos máxima aceptable con penalidad, y no únicamente el precio
  unitario.
- **Topes de renovación (renewal caps):** en contratos recurrentes, fijar desde el inicio un límite
  máximo de incremento en renovaciones, porque el precio del primer año suele fijar la base de
  todos los incrementos futuros.
- **Preparación basada en datos:** llegar a la negociación con benchmarks de categoría, historial
  de precios, y análisis de mercado (sección 2) en vez de negociar "a ciegas".

**Nota de calidad de evidencia:** la mayoría de estas tácticas provienen de blogs especializados en
procurement (no literatura académica revisada por pares); las cifras de descuento citadas (10-15%,
ahorro de 12%) son ilustrativas de la industria, no garantizadas. El agente debe presentarlas como
heurísticas de práctica profesional, no como resultados garantizados.

Fuentes:
- [Vendor Management Strategy: Procurement Guide 2026 — DigitalApplied](https://www.digitalapplied.com/blog/vendor-management-strategy-procurement-guide-2026)
- [Supplier Negotiation Strategies: A Data-Driven Guide — Ivalua](https://www.ivalua.com/blog/supplier-negotiation/)
- [Supplier Contract Negotiation Tactics — GoodSource](https://goodsource.com/trends-and-insights/supplier-contract-negotiation-tactics-for-food-service-directors/)
- [The Complete Guide to Negotiating SaaS Contracts — Tropic](https://www.tropicapp.io/glossary/negotiating-saas-contracts)
- [Top 12 Tips For A Successful Supplier Negotiation Strategy — Spendflo](https://www.spendflo.com/blog/supplier-negotiation-strategy-techniques)
- [Procurement Negotiation: Drive Value — Ashraf El Desoky](https://www.ashraf-eldesoky.space/en/articles/procurement-negotiation-value.html)

---

## 6. Compra directa al fabricante vs. intermediario/distribuidor

**Cuándo tiene sentido cada vía:**
- **Directo al fabricante:** mayores volúmenes, relación de largo plazo, necesidad de
  personalización/especificación técnica propia, sensibilidad alta al precio unitario (se elimina
  margen de intermediación). Requiere mayor capacidad propia de gestión de calidad, logística
  internacional y mínimos de pedido más altos.
- **Vía distribuidor/intermediario:** volúmenes bajos o esporádicos, necesidad de flexibilidad
  (MOQ bajos, mezcla de productos de varios fabricantes), soporte local/idioma, menor fricción
  logística (el distribuidor ya tiene inventario y canal establecido), o cuando el comprador no
  tiene escala para justificar tratar directo. El costo es un margen adicional (menor TCO
  unitario potencial perdido) a cambio de menor riesgo operativo y mayor flexibilidad.

**Cómo identificar si un proveedor listado es un fabricante real o un comercializador/trader
(especialmente relevante en plataformas B2B como Alibaba):**

1. **Alcance del registro/licencia comercial:** el objeto social de un fabricante real incluye
   términos de producción; el de una trading company no. Es información pública registrada ante
   el gobierno (en China, el "Business Scope").
2. **Razón social:** nombres chinos que terminan en 贸易有限责任公司 ("Trading Co., Ltd.") casi
   siempre indican comercializador, no fábrica.
3. **Dirección registrada:** una fábrica real suele tener dirección en un parque industrial (工业园)
   o zona de manufactura; una oficina en una torre comercial o "creative park" sugiere oficina de
   ventas, no planta.
4. **Amplitud del catálogo:** un catálogo muy amplio y heterogéneo (electrónica + textiles +
   juguetes en la misma tienda) es señal de comercializador; un catálogo estrecho y coherente con
   un proceso de manufactura específico sugiere fabricante real.
5. **Insignias/certificaciones de la plataforma:** certificaciones de "Verified"/"Assessed" con
   inspección en sitio por un tercero son una señal fuerte (no definitiva) de fábrica real.
6. **Preguntas directas de capacidad:** pedir detalles concretos de capacidad de producción
   (líneas, turnos, unidades/mes); respuestas vagas o evasivas sugieren intermediario que debe
   consultar con la fábrica real antes de responder.
7. **Señales indirectas de friction:** tiempos de respuesta más lentos, aprobación de muestras más
   lenta, personalización limitada a lo que el "partner" de fábrica permite: todo esto es
   consistente con estar tratando con un trader, no con el fabricante.

**Estimación (no verificada, tratar como orden de magnitud):** en plataformas B2B masivas, una
fracción significativa (algunas fuentes estiman 20-40%) de los "proveedores" listados son
fabricantes reales; el resto son traders, agentes de sourcing o revendedores. El agente debe
señalar este riesgo explícitamente cuando no pueda verificar con certeza el estatus del proveedor
encontrado.

Fuentes:
- [How to Avoid Fake Alibaba Suppliers: Real Factories vs Trading Companies — Koi Sourcing](https://koisourcing.com/blog/how-to-avoid-fake-alibaba-suppliers)
- [How to Find Real Manufacturers on Alibaba — Timedoes](https://www.timedoes.com/how-to-find-real-manufacturers-on-alibaba/)
- [Is Alibaba Legit? How to Avoid Supplier Scams from China — Kanary Solutions](https://www.kanarysolutions.com/how-to-know-if-an-alibaba-seller-is-legit)
- [How to Spot Fake Suppliers on Alibaba: 15 Signals — ChineseCheck](https://chinesecheck.com/blog/spot-fake-suppliers-alibaba)
- [Sourcing from Alibaba: Guide & Tips — Wise](https://wise.com/us/blog/sourcing-from-alibaba)
- [Alibaba 101: How to Safely Source Products — Shopify](https://www.shopify.com/blog/16665772-alibaba-101-how-to-safely-source-products-from-the-worlds-biggest-supplier-directory)

---

## 7. Gestión de riesgo de proveedores

- **Riesgo de fuente única (single sourcing):** depender de un solo proveedor para un insumo
  crítico expone a interrupción total si falla (insolvencia, falla de capacidad, desastre natural,
  acción regulatoria, evento cibernético). Es aceptable solo para ítems de bajo impacto (no
  críticos en Kraljic) donde el costo de gestionar dos proveedores supera el riesgo, o para ítems
  muy especializados/con propiedad intelectual sensible donde se compensa con contratos fuertes y
  reserva de capacidad.
- **Dual/multi-sourcing:** dividir la compra de un mismo ítem entre 2+ proveedores calificados en
  una proporción fija (ej. 70/30 o 60/40) para que ninguno sea punto único de falla. Regla de
  decisión: cualquier ítem clasificado como crítico para producción/operación con fuente única
  debería moverse a dual-sourcing. El trade-off es costo unitario más alto (volumen dividido,
  pierde descuento por escala) y mayor carga de calificación/supervisión de dos relaciones. No
  conviene duplicar fuente para todos los ítems, solo los de alto riesgo/alto impacto.
- **Riesgo geográfico/geopolítico:** concentrar proveedores en una sola región/país expone a
  tarifas, inestabilidad política, desastres naturales y disrupciones logísticas correlacionadas.
  El agente debe señalar cuando todos los candidatos encontrados están en la misma región y
  sugerir diversificación geográfica como mitigación, especialmente para ítems estratégicos o
  cuello de botella.
- **Verificación de estabilidad financiera:** incorporar el chequeo de salud financiera (sección 4)
  como parte del proceso de onboarding/calificación, no como paso opcional posterior.
- **Estrategia de proveedor de respaldo (backup supplier):** para ítems críticos, mantener un
  segundo proveedor pre-calificado (aunque no se le compre activamente) de forma que el tiempo de
  activación en caso de falla del proveedor principal sea corto. Reservar capacidad o acordar
  condiciones marco de antemano reduce el tiempo de reacción ante una disrupción.
- **Verificación de identidad legal y cumplimiento:** confirmar identidad legal de la empresa,
  beneficiario final (beneficial ownership), y screening de listas de sanciones antes de
  formalizar, especialmente en proveedores internacionales nuevos.

Fuentes:
- [Dual sourcing strategy: Reduce single-supplier risk — Amazon Business](https://business.amazon.com/en/blog/dual-sourcing)
- [Dual vs Single Sourcing Framework for Procurement — Umbrex](https://umbrex.com/resources/frameworks/supply-chain-frameworks/dual-vs-single-sourcing-framework/)
- [Single Sourcing vs. Dual Sourcing: How Enterprise Suppliers Decide — SPS Commerce](https://www.spscommerce.com/community/articles/single-sourcing-vs-dual-sourcing-how-enterprise-suppliers-decide-which-raw-materials-need-backup)
- [Navigating Sourcing Strategies: Single vs Dual vs Multi-Sourcing — Zignify](https://zignify.net/blog/navigating-sourcing-strategies-single-sourcing-dual-sourcing-and-multi-sourcing-benefits-and-risks/)
- [Supply Chain Risk Management for Manufacturers: A Practical Guide — User Solutions](https://usersolutions.com/blog/supply-chain-risk-management)
- [Supplier Due Diligence Checklist — Visualping](https://visualping.io/blog/supplier-due-diligence-checklist)

---

## 8. KPIs de compras que monitorea un gerente de compras profesional

| KPI | Fórmula | Benchmark observado en la industria (referencial, no estándar único) |
|---|---|---|
| **% de ahorro de costos (cost savings)** | Ahorro documentado ÷ gasto total gestionado | Organizaciones "world class": ~3-5% anual sobre gasto gestionado; otras fuentes citan 5-12% sobre categorías gestionadas activamente |
| **Gasto bajo gestión (Spend Under Management, SUM)** | Gasto gestionado por el área de compras formalmente ÷ gasto total de la empresa | Promedio ~50-60%; líderes >80-90% |
| **Tiempo de ciclo de PO (PO cycle time)** | Tiempo desde requisición hasta emisión de orden de compra | Mejor en su clase: 4-6 días (compras estándar); entornos e-procurement maduros: <1 día para ítems de catálogo; rezagados: >10-12 días |
| **Tasa de entrega a tiempo (On-Time Delivery)** | Órdenes entregadas en la fecha pactada ÷ total de órdenes | Mejores desempeños: ≥95%; bajo desempeño: <85% |
| **OTIF (On-Time In-Full)** | Órdenes que cumplen AMBAS condiciones (a tiempo Y completas) ÷ total de órdenes | Métrica binaria por orden (no hay cumplimiento parcial): ej. 85/100 = 85% |
| **Tasa de defectos del proveedor** | Unidades defectuosas ÷ unidades totales recibidas (expresable en PPM: × 1,000,000) | Objetivo común: ≤1% (o equivalente en PPM según industria/estándar de calidad aplicable) |
| **Gasto fuera de proceso (maverick spend)** | Compras realizadas fuera del proceso/contrato formal ÷ gasto total | Cuanto más bajo, mejor; es señal de fuga de control de compras |
| **Cumplimiento de contrato** | Compras bajo contrato negociado ÷ gasto total elegible para contrato | Indicador de si la negociación lograda realmente se usa en la operación |

**Cadencia de revisión:** métricas operativas (exactitud de PO, entrega a tiempo) se revisan
frecuentemente (ej. semanal); métricas estratégicas (ahorro de costos, desempeño consolidado de
proveedor) se revisan mensual o trimestralmente.

**Nota para el agente:** los benchmarks numéricos varían bastante entre fuentes (blogs de
proveedores de software de procurement, no normas técnicas formales); deben usarse como
referencia orientativa, no como verdad absoluta, y lo más útil es que la empresa fije su propia
línea base y mida la tendencia contra sí misma en el tiempo.

Fuentes:
- [Procurement KPIs: What Metrics to Measure Beyond Purchase Price — iGPS](https://igps.net/procurement-kpis-what-metrics-to-measure-beyond-purchase-price/)
- [Procurement KPIs: 9 key metrics to track — Tradogram](https://www.tradogram.com/blog/procurement-kpis)
- [18 Procurement KPIs for 2026: Definitions & Benchmarks — Varisource](https://www.varisource.com/blog/procurement-kpis-definitions-formulas-benchmarks)
- [Procurement KPIs: 15 Key Metrics, Formulas and Benchmarks — Serina](https://www.serina.ai/kpi-procurement-metrics/)
- [Procurement KPIs & Metrics Guide: 40+ Formulas — SupplyChainMath](https://supplychainmath.com/en/procurement-kpis.html)
- [On Time & In Full (OTIF): Meaning and Formula — BlueCart](https://www.bluecart.com/blog/otif-meaning-and-formula)
- [What Is OTIF? Definition, Formula, and How to Improve It — SourceDay](https://sourceday.com/blog/otif/)

---

## 9. Cómo debe escalar la sofisticación de compras según el tamaño de la empresa

| Dimensión | Pequeña empresa / PYME | Gran empresa |
|---|---|---|
| **Proceso** | Ad hoc, orientado a precio, decisión rápida por una sola persona | RFP/RFQ formal, comités de evaluación, procesos documentados y auditables |
| **Herramientas** | Hoja de cálculo, cotización directa por WhatsApp/email, sin sistema dedicado | Plataforma de e-procurement/source-to-pay integrada, catálogos electrónicos, flujo de aprobación |
| **Evaluación de proveedores** | Informal, basada en relación personal o precio visible | Scorecards estandarizados y ponderados, con criterios consistentes entre categorías y equipos |
| **Adopción de sistemas** | ~30% usa sistemas de procure-to-pay (dato referencial de encuesta citada por fuentes de la industria) | ~60% ya cuenta con procure-to-pay formal |
| **Contratos** | Órdenes de compra puntuales, pocas veces contratos marco | Contratos multianuales, SLAs, cláusulas de penalidad/salida, gestión activa de relación (SRM) |
| **Gasto de cola larga (tail spend)** | Suele ser la mayoría del gasto, sin gestión formal | Se gestiona activamente para llevarlo bajo contrato/catálogo (subir el % de "spend under management") |

**Implicación de diseño para el agente:** el mismo agente debe ser capaz de operar en dos modos:
1. **Modo PYME:** respuesta rápida, 2-3 opciones comparadas por precio + TCO básico + riesgo
   evidente, sin exigir proceso formal de RFP.
2. **Modo empresa grande:** salida estructurada tipo scorecard ponderado, trazabilidad de criterios
   usados, lenguaje apto para alimentar un proceso de aprobación formal o un RFP real.

El nivel de profundidad del análisis (TCO completo, due diligence financiera, dual-sourcing) debe
ser proporcional al volumen de gasto y a la clasificación Kraljic del ítem: no vale la pena aplicar
el rigor de un ítem estratégico a una compra no crítica de bajo valor (regla de proporcionalidad
costo-beneficio del propio análisis de compras).

Fuentes:
- [Procurement Maturity Model: How to Score Where You Stand — Zycus](https://www.zycus.com/blog/event/procurement-maturity-model-how-to-score)
- [Strategic sourcing in procurement: 2026 guide — Amazon Business](https://business.amazon.com/en/blog/sourcing)
- [Vendor Scorecards: Complete Guide For Procurement Teams — Ivalua](https://www.ivalua.com/blog/vendor-scorecard/)
- [Supplier Selection Process: 7 Steps, Evaluation Criteria, and Scorecard — Precoro](https://precoro.com/blog/supplier-selection-process-criteria)
- [How to Build a Supplier Scorecard for Procurement with AI — Suplari](https://suplari.com/blog/how-to-build-a-supplier-scorecard-for-procurement)

---

## Notas sobre calidad de la evidencia (para ser transparente en el system prompt del agente)

- El marco de Kraljic, el ciclo CIPS, OTIF, landed cost e Incoterms, y el Altman Z-Score son
  **frameworks establecidos** con origen académico/institucional (Harvard Business Review, CIPS,
  ICC para Incoterms, literatura financiera para Z-Score).
- Las tácticas de negociación, los pesos de scorecard sugeridos y los benchmarks numéricos de
  KPIs provienen mayormente de **blogs y consultoras de la industria de software de procurement**
  (Procurement Tactics, SCMDOJO-style, Ivalua, Zycus, etc.), no de estudios revisados por pares.
  Son prácticas profesionales ampliamente citadas, pero las cifras exactas (10-15% de descuento,
  3-5% de ahorro anual, etc.) deben tratarse como **órdenes de magnitud orientativos**, no
  garantías, y el agente debe comunicarlas con ese matiz al usuario final cuando las use para
  justificar una recomendación.
- Para cifras de aranceles/tarifas específicas (ej. tasas de importación de EE.UU.), estas cambian
  frecuentemente; el agente debe verificar contra fuentes oficiales vigentes (aduanas del país
  correspondiente) en el momento de cada recomendación en vez de asumir cifras fijas de este
  documento.
