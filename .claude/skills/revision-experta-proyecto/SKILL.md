---
name: revision-experta-proyecto
description: Use this skill whenever making or reviewing a decision about inventory management, procurement/supplier sourcing, or n8n workflow design for this thesis project (sistema de agentes de IA para compras e inventarios de Mateo Moncada), and ALWAYS when the user asks to "convocar la junta", pedir una "segunda opinión", "revisión experta", "junta directiva", or similar. Make sure to trigger this whenever the user mentions rotación de inventario, punto de reorden, stock de seguridad, EOQ, clasificación ABC, selección de proveedores, cotización, matriz de Kraljic, TCO, el Agente Gestor de Inventarios, el Agente Cotizador de Proveedores, el Agente Supervisor, o cualquier cambio/error en los workflows de n8n del proyecto — even if the user doesn't explicitly ask for a "review". This is a standing instruction the user gave once, not a one-off request: apply it proactively every time, not only when asked again.
---

# Junta de revisión experta del proyecto (inventarios / compras / n8n)

Este proyecto de grado ("Diseño de un sistema robusto de agentes de inteligencia artificial para
la optimización de decisiones de compra e inventario en empresas", Mateo Moncada Moncada,
Ingeniería Industrial) tiene tres subagentes especializados en `.claude/agents/`:
`experto-inventarios`, `experto-compras`, `experto-n8n`. Cada uno incorpora investigación real y
citada del dominio (`n8n_agentes/conocimiento_experto/research_inventario.md` y
`research_compras.md`) y refleja la misma capa de revisión que ya existe dentro del prototipo en
n8n (Agente Revisor Inventarios / Agente Revisor Compras, nodos dentro de cada workflow). El rol
de "experto en n8n" vive solo aquí en Claude Code, no como workflow de n8n.

El usuario pidió esto inspirado en el concepto de "junta directiva con tus ídolos": en vez de
decidir solo, convoca a expertos de nivel senior en cada área para que revisen el proyecto, cada
uno desde su silla, sin copiarle al de al lado, y entreguen un veredicto. Es una instrucción
permanente del usuario: aplícala cada vez que corresponda, no solo cuando la pida de nuevo
explícitamente.

## Los dos modos de uso

**Modo 1 — consulta puntual a un solo experto.** Para una pregunta acotada de un solo dominio (p.
ej. "¿qué método de pronóstico uso con 4 meses de historial?"), basta invocar un subagente, o
incluso razonar tú mismo leyendo el archivo de referencia correspondiente si es una verificación
rápida. No hace falta convocar a los tres para esto.

**Modo 2 — "convocar la junta" (revisión completa).** Úsalo cuando el usuario pida explícitamente
una junta/revisión/segunda opinión, o cuando se esté por cerrar una decisión importante del
proyecto (una recomendación de compra/inventario que va a ejecutarse, un cambio de arquitectura en
n8n, contenido que va a entrar al documento de la tesis). Sigue este procedimiento:

1. **Convocatoria en paralelo, no secuencial.** Invoca los tres subagentes relevantes
   (`experto-inventarios`, `experto-compras`, `experto-n8n` — o solo los que apliquen al tema, no
   fuerces a los tres si el tema es puramente de un área) con el Agent tool, **todos en el mismo
   mensaje/turno**, cada uno con el mismo contexto del asunto a revisar pero sin que ninguno vea la
   respuesta de los otros. Esto es intencional: así como en una junta directiva real, el valor está
   en que cada director opine desde su silla de forma independiente, no en que se influencien entre
   sí ni en que lleguen a un consenso prematuro.
2. **Espera los tres veredictos.** Cada subagente cierra su respuesta con un bloque `VOTO:` /
   `RAZON DEL VOTO:` (ver sus propios archivos). Recupera los tres.
3. **Redacta el acta y entrégasela al usuario**, en vez de solo resumir "todo bien" o enterrar las
   discrepancias. Usa este formato:

```
ACTA DE JUNTA DE REVISION
Tema revisado: [la decisión o el informe que se evaluó]
Fecha: [fecha actual]

EXPERTO EN INVENTARIOS — VOTO: [...]
[síntesis de su razonamiento]

EXPERTO EN COMPRAS — VOTO: [...]
[síntesis de su razonamiento]

EXPERTO EN N8N — VOTO: [...]
[síntesis de su razonamiento]

CONSENSO Y RECOMENDACION FINAL
[tu propia síntesis: si los tres aprobaron, dilo claro y breve; si hay desacuerdo o
observaciones, señala exactamente cuáles y qué acción concreta se necesita antes de proceder]
```

4. Si hay desacuerdo entre expertos (por ejemplo, inventarios aprueba pero n8n señala un riesgo de
   implementación), no lo diluyas: preséntaselo al usuario tal cual, es información valiosa, no un
   problema a esconder.

## Dónde está todo

- Subagentes: `.claude/agents/experto-inventarios.md`, `experto-compras.md`, `experto-n8n.md`
  (carpeta del proyecto, visibles solo dentro de esta carpeta de trabajo).
- Conocimiento de referencia completo: `n8n_agentes/conocimiento_experto/research_inventario.md`
  y `research_compras.md`.
- Contraparte automatizada en n8n (mismo criterio, aplicado dentro de las ejecuciones reales):
  workflows `Agente Gestor de Inventarios` y `Agente Cotizador de Proveedores` (solo esos dos
  existen en n8n) — ver `CLAUDE.md` en la raíz del proyecto para sus IDs y estado actual.
