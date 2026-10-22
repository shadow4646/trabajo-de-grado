// Generador del informe de inventarios: Markdown, HTML, CSV para Excel y respuesta corta del chat.
// Son funciones puras sobre el resultado del motor; los datos que pasan entre nodos de n8n son JSON, asi que
// Infinity llega como null (cobertura null = sin demanda).
const PROMPT_COMENTARIO = `Eres un ingeniero de inventarios senior que escribe el comentario de un informe mensual para el area de compras. Recibes un JSON ya calculado por codigo: conteos por accion, indicadores y las listas mas importantes.

Reglas estrictas:
- Usa SOLO las cifras y nombres del JSON. No inventes productos, cantidades, valores ni causas. No calcules ni redondees: si citas una cifra, copiala tal cual.
- No cambies ninguna recomendacion ni cantidad: el sistema ya decidio. Tu trabajo es ordenar prioridades y explicar el panorama.
- No nombres ninguna moneda (ni pesos ni dolares): usa solo las cifras. No califiques volumenes como grandes o pequenos ni inventes causas de los quiebres.
- Escribe en espanol, en maximo 150 palabras, en prosa breve (sin tablas ni listas largas), con una sola seccion titulada "## Comentario del analista".
- Cubre: que atender primero y por que, el riesgo principal (quiebres o capital inmovilizado) y una advertencia sobre la confiabilidad de los datos si el JSON la trae.
- No uses guiones largos (el caracter de raya). Usa comas, puntos, dos puntos o parentesis.`;

// Resumen que se le entrega al modelo de lenguaje: conteos, indicadores y las listas mas importantes. Nunca incluye los movimientos.
function armarEntradaIA(res, ind) {
  const resultados = res.resultados.map(({ meses, valores, ...r }) => ({ ...r, cobertura: Number.isFinite(r.cobertura) ? r.cobertura : null }));
  const top = (lista, n, f) => lista.slice(0, n).map(f);
  const urg = resultados.filter((r) => r.accion === 'COMPRAR URGENTE').sort((a, b) => ((a.cobertura ?? 1e9) - a.L) - ((b.cobertura ?? 1e9) - b.L));
  return {
    mes: res.ym,
    productos: ind.productos,
    productos_por_accion: ind.cuenta_acciones,
    indicadores: {
      valor_inventario: Math.round(ind.valor_inventario), compra_sugerida: Math.round(ind.compra_total), capital_inmovilizado_stock_muerto: Math.round(ind.valor_muerto),
      capital_en_exceso: Math.round(ind.capital_exceso), rotacion_anual: ind.rotacion_anual ? Math.round(ind.rotacion_anual * 10) / 10 : null, productos_en_quiebre: ind.productos_en_quiebre,
    },
    urgentes: top(urg, 6, (r) => ({ producto: r.nombre || r.sku, stock: Math.round(r.stock), cantidad_sugerida: r.cantidad })),
    en_cero_este_mes: top(resultados.filter((r) => r.dias_en_cero > 0).sort((a, b) => b.dias_en_cero - a.dias_en_cero), 5, (r) => ({ producto: r.nombre || r.sku, dias_en_cero: r.dias_en_cero, sigue_en_cero: !!(r.quiebre && r.quiebre.sigue) })),
    sin_rotacion: top(resultados.filter((r) => r.accion === 'SIN MOVIMIENTO' || r.accion === 'NUNCA SE MOVIO').sort((a, b) => b.valor_stock - a.valor_stock), 5, (r) => ({ producto: r.nombre || r.sku, valor: Math.round(r.valor_stock) })),
    advertencias_de_datos: res.avisos.slice(0, 3),
  };
}

const MESES_NOMBRE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesTexto = (ym) => `${MESES_NOMBRE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function armarInforme(entrada) {
  const { res, ind, cfg, comentario, uso, tiempos } = entrada;
  const moneda = cfg.moneda || '$';
  const miles = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const num = (x) => (x === null || x === undefined || Number.isNaN(x) ? '-' : Math.abs(x) >= 100 || Number.isInteger(x) ? miles(x) : String(Math.round(x * 100) / 100).replace('.', ','));
  const dinero = (x) => (x === null || x === undefined ? '-' : `${moneda} ${miles(x)}`);
  const pct = (x) => (x === null || x === undefined ? '-' : `${(x * 100).toFixed(1).replace('.', ',')}%`);
  const fecha = (d) => (d === null || d === undefined ? '-' : isoDe(d));
  const cob = (r) => (r.cobertura === null || r.cobertura === undefined || r.cobertura === Infinity ? 'sin demanda' : miles(r.cobertura));
  const nombre = (r) => celda(r.nombre ? `${r.nombre} (${r.sku})` : r.sku);
  const rs = res.resultados;
  const por = (accion) => rs.filter((r) => r.accion === accion);
  const urgentes = rs.filter((r) => r.accion === 'COMPRAR URGENTE').sort((a, b) => ((a.cobertura ?? 1e9) - a.L) - ((b.cobertura ?? 1e9) - b.L));
  const normales = rs.filter((r) => r.accion === 'COMPRAR').sort((a, b) => (a.cobertura ?? 1e9) - (b.cobertura ?? 1e9));
  const enCamino = por('SIN STOCK, PEDIDO EN CAMINO');
  const quiebres = rs.filter((r) => r.quiebre_confiable && r.dias_en_cero > 0).sort((a, b) => b.dias_en_cero - a.dias_en_cero);
  const sinMov = por('SIN MOVIMIENTO').sort((a, b) => b.valor_stock - a.valor_stock);
  const nunca = por('NUNCA SE MOVIO').sort((a, b) => b.valor_stock - a.valor_stock);
  const sobre = por('SOBRESTOCK').sort((a, b) => b.exceso_valor - a.exceso_valor);
  const suficientes = rs.filter((r) => r.accion === 'NO COMPRAR' || r.accion === 'SIN DEMANDA').sort((a, b) => (a.cobertura ?? 1e9) - (b.cobertura ?? 1e9));
  const revisar = por('REVISAR DATOS');
  const inactivos = por('INACTIVO');
  const movidos = rs.filter((r) => r.accion !== 'INACTIVO' && (r.salidas_mes > 0 || r.entradas_mes > 0)).sort((a, b) => b.salidas_mes * b.costo - a.salidas_mes * a.costo);
  const aSurtir = [...urgentes, ...normales];
  const nota = (r) => [
    r.transito > 0 ? `en transito: ${num(r.transito)}${r.transito_vencido ? ' (llegada vencida)' : ''}` : '',
    r.plazo_supuesto ? 'plazo supuesto' : '',
    r.moq > 1 ? `multiplo ${num(r.moq)}` : '',
    r.confianza === 'BAJA' ? 'confianza baja' : '',
    r.revisar_manual ? 'confirmar con comercial' : '',
  ].filter(Boolean).join('; ');
  const L = [];
  const tabla = (encabezados, filas) => { L.push(`| ${encabezados.join(' | ')} |`); L.push(`|${encabezados.map(() => '---').join('|')}|`); filas.forEach((f) => L.push(`| ${f.map((c) => celda(c)).join(' | ')} |`)); L.push(''); };
  const LIMITE = 40;

  L.push(`# Informe de inventario: ${mesTexto(res.ym)}`);
  L.push('');
  L.push(`Corte al ${isoDe(res.corte)} | ${ind.productos} productos analizados | Fuente: ${cfg.fuente} | Politica: revision mensual (R = ${res.P.R_dias} dias), nivel de servicio 98% / 95% / 90% para clase A / B / C`);
  L.push('');

  // ---------- resumen ----------
  L.push('## Resumen del mes');
  L.push(`- **Productos analizados:** ${ind.productos} (${ind.productos_con_ventas_12m} con ventas en los ultimos 12 meses).`);
  L.push(`- **Que surtir:** ${aSurtir.length} producto${aSurtir.length === 1 ? '' : 's'}, ${urgentes.length} urgente${urgentes.length === 1 ? '' : 's'}. Compra sugerida: **${dinero(ind.compra_total)}** (clase A ${dinero(ind.compra_por_clase.A || 0)}, B ${dinero(ind.compra_por_clase.B || 0)}, C ${dinero(ind.compra_por_clase.C || 0)}${ind.compra_por_clase.N ? `, nuevos ${dinero(ind.compra_por_clase.N)}` : ''}).${enCamino.length ? ` ${enCamino.length} sin stock con el pedido ya en camino.` : ''}`);
  L.push(`- **Se quedaron en cero este mes:** ${quiebres.length} producto${quiebres.length === 1 ? '' : 's'}${quiebres.length ? ` (${quiebres.filter((r) => r.quiebre && r.quiebre.sigue).length} siguen en cero al corte)` : ''}.${ind.ventas_perdidas_valor > 0 ? ` Ventas perdidas estimadas: ${dinero(ind.ventas_perdidas_valor)} (estimacion).` : ''}`);
  L.push(`- **Sin movimiento:** ${sinMov.length}; **nunca se movieron:** ${nunca.length}. Capital inmovilizado: **${dinero(ind.valor_muerto)}** (${pct(ind.pct_muerto)} del inventario).`);
  L.push(`- **Sobrestock:** ${sobre.length} producto${sobre.length === 1 ? '' : 's'}, capital en exceso ${dinero(ind.capital_exceso)}.`);
  L.push(`- **Inventario:** ${dinero(ind.valor_inventario)}. Rotacion anual ${ind.rotacion_anual ? num(Math.round(ind.rotacion_anual * 10) / 10) : '-'} veces (${ind.dias_inventario ? miles(ind.dias_inventario) : '-'} dias de inventario).`);
  if (revisar.length) L.push(`- **Revisar datos:** ${revisar.length} producto${revisar.length === 1 ? '' : 's'} sin stock conocido, no se recomienda compra para ellos.`);
  L.push('');
  if (comentario) { L.push(comentario); L.push(''); }

  // ---------- que surtir ----------
  L.push('## Que surtir');
  if (!aSurtir.length) L.push('Ningun producto necesita compra segun la politica de reposicion.\n');
  const filaSurtir = (r, i) => [i + 1, nombre(r), `${r.clase}${r.xyz ? '/' + r.xyz : ''}`, num(r.stock), num(r.salidas_mes), cob(r), num(r.L), `**${num(r.cantidad)}** ${r.unidad || ''}`, dinero(r.valor_compra), r.proveedor || '-', nota(r)];
  const encSurtir = ['#', 'Producto', 'Clase', 'Stock', 'Salidas del mes', 'Cobertura (dias)', 'Plazo (dias)', 'Cantidad sugerida', 'Costo estimado', 'Proveedor', 'Notas'];
  if (urgentes.length) {
    L.push('### Urgente: se quedarian sin stock antes de que llegue un pedido hecho hoy');
    tabla(encSurtir, urgentes.slice(0, LIMITE).map(filaSurtir));
    if (urgentes.length > LIMITE) L.push(`Se muestran ${LIMITE} de ${urgentes.length}; la lista completa esta en el archivo de pedido sugerido.\n`);
  }
  if (normales.length) {
    L.push('### Para el proximo ciclo: no alcanzaria hasta el siguiente corte');
    tabla(encSurtir, normales.slice(0, LIMITE).map(filaSurtir));
    if (normales.length > LIMITE) L.push(`Se muestran ${LIMITE} de ${normales.length}; la lista completa esta en el archivo de pedido sugerido.\n`);
  }
  if (enCamino.length) { L.push('### Sin stock, con el pedido en camino'); tabla(['Producto', 'En transito', 'Notas'], enCamino.map((r) => [nombre(r), num(r.transito), r.transito_vencido ? 'la fecha de llegada ya vencio: confirmar con el proveedor' : ''])); }
  if (Object.keys(ind.compra_por_proveedor).length) {
    L.push('### Compra sugerida por proveedor');
    tabla(['Proveedor', 'Costo estimado'], Object.entries(ind.compra_por_proveedor).sort((a, b) => b[1] - a[1]).map(([p, v]) => [p, dinero(v)]));
  }
  const manual = aSurtir.filter((r) => r.revisar_manual);
  if (manual.length) L.push(`> Confirmar con el area comercial antes de pedir (producto de alto valor con demanda erratica): ${manual.map((r) => r.sku).join(', ')}.\n`);

  // ---------- quiebres ----------
  L.push('## Se quedaron en cero este mes');
  if (!quiebres.length) L.push('Ningun producto con datos confiables llego a cero durante el mes.\n');
  else tabla(['Producto', 'Dias en cero', 'Desde', 'Hasta', 'Estado', 'Stock al corte', 'Ventas perdidas (estimadas)', 'Accion'], quiebres.map((r) => [nombre(r), r.dias_en_cero, fecha(r.quiebre && r.quiebre.desde), fecha(r.quiebre && r.quiebre.hasta), r.quiebre && r.quiebre.sigue ? 'sigue en cero' : `repuesto${r.quiebre && r.quiebre.episodios > 1 ? ` (${r.quiebre.episodios} episodios)` : ''}`, num(r.stock), r.ventas_perdidas ? `${num(r.ventas_perdidas)} unid. (${dinero(r.ventas_perdidas * r.costo)})` : '-', r.accion]));
  const sinSerie = rs.filter((r) => r.accion !== 'INACTIVO' && !r.quiebre_confiable && r.salio_alguna_vez).length;
  if (sinSerie) L.push(`> Productos sin saldo ni stock actual confiables (no se puede decir si llegaron a cero): ${sinSerie}.\n`);

  // ---------- que se movio ----------
  L.push('## Que tanto se movio');
  if (!movidos.length) L.push('No hubo movimientos en el mes.\n');
  else {
    tabla(['Producto', 'Clase', 'Salio en el mes', 'Cambio vs ultimos 3 meses', 'Dias con salida', 'Entro en el mes', 'Stock al inicio', 'Stock al cierre', 'Patron de demanda'], movidos.slice(0, LIMITE).map((r) => [nombre(r), r.clase, `${num(r.salidas_mes)}${r.devol_mes ? ` (menos ${num(r.devol_mes)} devueltas)` : ''}`, r.promedio_3m && r.promedio_3m >= 5 ? `${r.demanda_neta_mes / r.promedio_3m - 1 >= 0 ? '+' : ''}${pct(r.demanda_neta_mes / r.promedio_3m - 1)}` : '-', r.dias_con_salida_mes, num(r.entradas_mes), r.quiebre_confiable ? num(r.stock_inicial) : '-', r.quiebre_confiable ? num(r.stock_cierre) : '-', r.pron.patron]));
    if (movidos.length > LIMITE) L.push(`Se muestran ${LIMITE} de ${movidos.length}, ordenados por valor de lo que salio.\n`);
  }

  // ---------- sin movimiento ----------
  L.push('## Sin movimiento y nunca se movieron');
  if (!sinMov.length && !nunca.length) L.push('Ningun producto con stock lleva sin salidas mas tiempo del esperado.\n');
  if (sinMov.length) {
    L.push('### Con stock y sin salidas por mas tiempo del esperado');
    tabla(['Producto', 'Stock', 'Valor', 'Ultima salida', 'Dias sin salida', 'Umbral (dias)', 'Notas'], sinMov.map((r) => [nombre(r), num(r.stock), dinero(r.valor_stock), fecha(r.ultima_salida), r.dias_sin_salida, num(r.umbral_sin_movimiento), r.mismo_mes_anio_anterior > 0 ? 'vendio en este mes el ano pasado: revisar si es estacional antes de liquidar' : 'candidato a liquidar, devolver o dar de baja']));
  }
  if (nunca.length) {
    L.push('### Nunca se movieron (sin ninguna salida en el historial leido)');
    tabla(['Producto', 'Stock', 'Valor', 'Notas'], nunca.map((r) => [nombre(r), num(r.stock), dinero(r.valor_stock), r.sin_maestro ? 'sin maestro' : 'revisar si sigue vigente en el catalogo']));
  }
  if (ind.valor_muerto > 0) {
    L.push('Capital inmovilizado por antiguedad de la ultima salida:');
    L.push('');
    tabla(['Tramo', 'Valor'], Object.entries(ind.tramos_muerto).filter(([, v]) => v > 0).map(([k, v]) => [k === 'sin ventas en el historial' ? 'Sin ventas en el historial' : `${k} dias`, dinero(v)]));
  }

  // ---------- sobrestock y suficientes ----------
  L.push('## Sobrestock: no comprar');
  if (!sobre.length) L.push('Ningun producto con demanda supera su nivel maximo de cobertura.\n');
  else tabla(['Producto', 'Stock', 'Cobertura (dias)', 'Maximo aceptado (dias)', 'Nivel objetivo', 'Excedente (unid.)', 'Capital en exceso'], sobre.map((r) => [nombre(r), num(r.stock), cob(r), num(r.umbral_cobertura), num(r.S), num(r.exceso_unidades), dinero(r.exceso_valor)]));
  L.push('## No comprar: stock suficiente');
  if (!suficientes.length) L.push('Ninguno.\n');
  else tabla(['Producto', 'Stock', 'Cobertura (dias)', 'Punto de reorden', 'Posicion proyectada'], suficientes.slice(0, LIMITE).map((r) => [nombre(r), num(r.stock), cob(r), num(r.rop), num(r.proyectada)]));
  if (revisar.length) { L.push('## Revisar datos'); tabla(['Producto', 'Motivo'], revisar.map((r) => [nombre(r), r.motivo])); }
  if (inactivos.length) L.push(`${inactivos.length} producto${inactivos.length === 1 ? '' : 's'} marcado${inactivos.length === 1 ? '' : 's'} como inactivo${inactivos.length === 1 ? '' : 's'} en el maestro no se analizan.\n`);

  // ---------- indicadores ----------
  const pr = ind.pronostico;
  L.push('## Indicadores del mes');
  tabla(['Indicador', 'Valor', 'Como leerlo'], [
    ['Valor del inventario', dinero(ind.valor_inventario), 'A costo, al corte'],
    ['Rotacion anual', ind.rotacion_anual ? `${num(Math.round(ind.rotacion_anual * 10) / 10)} veces` : '-', 'Costo de lo vendido en 12 meses / inventario promedio. Compara con tu sector: muy baja sugiere sobrestock, muy alta puede esconder quiebres'],
    ['Dias de inventario', ind.dias_inventario ? miles(ind.dias_inventario) : '-', '365 / rotacion'],
    ['Tasa de quiebre', ind.tasa_quiebre === null ? '-' : `${pct(ind.tasa_quiebre)} (${ind.productos_en_quiebre} productos)`, 'Productos con ventas que llegaron a cero en el mes. Entre 2% y 5% suele ser eficiente; 0% sostenido puede indicar exceso de seguridad'],
    ['Quiebre en clase A', ind.productos_clase_a ? `${ind.quiebre_clase_a} de ${ind.productos_clase_a}` : '-', 'Los productos de mayor valor de consumo'],
    ['Disponibilidad ponderada', ind.disponibilidad_ponderada === null ? '-' : pct(ind.disponibilidad_ponderada), 'Dias con stock del mes, ponderados por valor de consumo'],
    ['Stock muerto', `${dinero(ind.valor_muerto)} (${pct(ind.pct_muerto)})`, 'Sin movimiento o nunca movido, sobre el valor del inventario'],
    ['Capital en exceso', dinero(ind.capital_exceso), 'Excedente de los productos en sobrestock'],
    ['Ajustes de inventario del mes', `${dinero(ind.ajustes_valor)} (${pct(ind.ajustes_pct_salidas)} de lo que salio)`, 'Mermas y diferencias; un porcentaje alto sugiere problemas de control'],
    ['Exactitud del pronostico (3 meses)', pr.wape === null ? '-' : `error de ${pct(pr.wape)}`, `Se vuelve a pronosticar cada mes con los datos previos y se compara con lo real (${pr.observaciones} comparaciones). Sesgo ${pr.sesgo === null ? '-' : pct(pr.sesgo)}; el metodo ingenuo (repetir el mes anterior) da ${pr.wape_ingenuo === null ? '-' : pct(pr.wape_ingenuo)}${pr.wape !== null && pr.wape_ingenuo !== null ? (pr.wape <= pr.wape_ingenuo ? ': el pronostico lo supera' : ': el pronostico NO lo supera') : ''}`],
  ]);

  // ---------- calidad de datos ----------
  const cal = res.calidad;
  L.push('## Calidad de los datos y supuestos');
  res.avisos.forEach((a) => L.push(`- ${a}`));
  L.push(`- Movimientos leidos: ${cal.filas_movimientos}; usados: ${cal.filas_usadas}.${Object.keys(cal.descartadas).length ? ' Descartados: ' + Object.entries(cal.descartadas).map(([k, n]) => `${n} por ${k}`).join(', ') + '.' : ''}`);
  if (cal.descuadres.length) L.push(`- Productos con descuadre entre el saldo del kardex y el stock actual del maestro: ${cal.descuadres.length} (${cal.descuadres.slice(0, 5).map((d) => `${d.sku} ${d.diferencia > 0 ? '+' : ''}${num(d.diferencia)}`).join(', ')}). Conviene revisar el conteo fisico.`);
  if (cal.saldo_negativo.length) L.push(`- Productos con saldo negativo: ${cal.saldo_negativo.length} (${cal.saldo_negativo.slice(0, 5).join(', ')}). Se tratan como cero y conviene corregir el registro.`);
  if (cal.sin_ancla.length) L.push(`- Productos sin saldo por movimiento ni stock actual: ${cal.sin_ancla.length}. No se calculan sus quiebres.`);
  if (cal.plazo_supuesto) L.push(`- Productos sin plazo de entrega en el sistema: ${cal.plazo_supuesto}. Se supuso ${res.P.lead_time_defecto} dias.`);
  if (cal.sin_costo) L.push(`- Productos sin costo: ${cal.sin_costo}. Su valor aparece en cero.`);
  L.push('');
  L.push('## Como se calcula');
  L.push('- **Demanda:** salidas netas de devoluciones de clientes. Ajustes, traslados y devoluciones a proveedores no cuentan como demanda. En los meses con dias en cero la demanda se corrige por los dias con stock (tope de 2 veces); si mas de la mitad del mes estuvo en cero se trata como dato faltante.');
  L.push('- **Pronostico:** promedio simple con menos de 3 meses, promedio movil con 3 a 5, suavizado exponencial simple con 6 o mas y Croston con correccion de Syntetos y Boylan si la demanda es intermitente.');
  L.push(`- **Reposicion (revision periodica):** se compra si la posicion proyectada al proximo corte (stock mas pedidos en transito, menos la demanda de ${res.P.R_dias} dias) cae bajo el punto de reorden. Se pide hasta el nivel objetivo S = demanda x (plazo + ${res.P.R_dias} dias) + stock de seguridad. Como la revision es mensual, se pide lo que no alcanzaria hasta el siguiente corte.`);
  L.push('- **Stock de seguridad:** Z x desviacion estandar mensual x raiz((plazo + revision) / 30), con desviacion del plazo si el maestro la trae. Con menos de 6 meses se usa demanda maxima menos promedio. Nivel de servicio: A 98%, B 95%, C 90%.');
  L.push(`- **Sin movimiento:** sin salidas por mas de max(${res.P.dias_sin_movimiento_min} dias, 3 veces el intervalo normal entre salidas). **Sobrestock:** cobertura mayor que max(2 x (plazo + revision), ${res.P.cobertura_maxima_sector[res.P.sector] || res.P.cobertura_maxima_sector.general} dias del sector "${res.P.sector}"). Los umbrales por sector son orientativos.`);
  L.push('- **Limitaciones:** no modela estacionalidad (se necesitan al menos 24 meses), usa la variabilidad de la demanda y no la del error de pronostico, supone distribucion normal, y no trae costos de pedido ni de mantener para calcular lotes economicos.');
  if (uso) L.push(`- **Uso de IA:** ${uso.llamadas} llamada${uso.llamadas === 1 ? '' : 's'} al modelo ${MODELO}, ${uso.entrada} tokens de entrada y ${uso.salida} de salida (${uso.costo.toFixed(3)} USD estimados). La IA solo redacta el comentario; todos los calculos son codigo.`);
  if (tiempos) L.push(`- Tiempo de calculo: ${tiempos} ms.`);
  L.push('');

  const md = sinGuiones(L.join('\n')).replace(/\n{3,}/g, '\n\n');

  // ---------- HTML ----------
  const mdAHtml = (texto) => {
    const out = [];
    let lista = false;
    let tab = false;
    let primera = true;
    const cerrar = () => { if (lista) { out.push('</ul>'); lista = false; } if (tab) { out.push('</table>'); tab = false; primera = true; } };
    for (const l of texto.split('\n')) {
      if (/^\|.*\|$/.test(l)) {
        if (!tab) { cerrar(); out.push('<table>'); tab = true; primera = true; }
        if (/^\|[-| ]+\|$/.test(l)) continue;
        out.push('<tr>' + l.slice(1, -1).split(' | ').map((x) => x.replace(/^\s*\|?\s*|\s*\|?\s*$/g, '')).map((x) => (primera ? `<th>${inlineHtml(x)}</th>` : `<td>${inlineHtml(x)}</td>`)).join('') + '</tr>');
        primera = false;
        continue;
      }
      if (/^\s*- /.test(l)) { if (tab) cerrar(); if (!lista) { out.push('<ul>'); lista = true; } out.push('<li>' + inlineHtml(l.replace(/^\s*- /, '')) + '</li>'); continue; }
      cerrar();
      const h = l.match(/^(#{1,3}) (.*)$/);
      if (h) out.push(`<h${h[1].length}>${inlineHtml(h[2])}</h${h[1].length}>`);
      else if (/^> /.test(l)) out.push('<blockquote>' + inlineHtml(l.slice(2)) + '</blockquote>');
      else if (l.trim()) out.push('<p>' + inlineHtml(l) + '</p>');
    }
    cerrar();
    return out.join('\n');
  };
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Informe de inventario: ${esc(mesTexto(res.ym))}</title>
<style>body{font-family:Arial,sans-serif;max-width:1200px;margin:30px auto;padding:0 16px;color:#222;line-height:1.5}
h1{border-bottom:2px solid #333;padding-bottom:6px}h2{margin-top:28px;color:#333}h3{margin-top:18px;color:#444}table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0 14px}
th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;vertical-align:top}th{background:#eee}blockquote{background:#f6f6f6;border-left:4px solid #999;margin:12px 0;padding:8px 12px}
code{background:#f0f0f0;padding:1px 4px}</style></head><body>${mdAHtml(md)}</body></html>`;

  // ---------- CSV (separador punto y coma y coma decimal: abre bien en Excel en espanol) ----------
  // Los textos vienen del sistema de inventario (nombres, proveedores, motivos). Excel interpreta como formula un texto que
  // empiece con = + - @, y no solo al inicio de la celda: si el archivo se abre con otro separador (coma en vez de punto y
  // coma), un texto como "Tornillo, =1+1" se parte y la segunda mitad queda al inicio de una celda. Por eso se antepone una
  // comilla simple a CADA fragmento que, tras un separador posible (, ; tabulador o salto de linea), empiece con esos
  // caracteres. Los numeros no se tocan. Las celdas con coma, punto y coma, comillas o saltos de linea van entre comillas.
  const neutralizar = (s) => s.replace(/(^|[,;\t\r\n]\s*)([=@]|[+\-](?=\S))/g, (m, antes, c) => `${antes}'${c}`);
  const campo = (v) => {
    const esNumero = typeof v === 'number';
    let s = esNumero ? String(Math.round(v * 100) / 100).replace('.', ',') : String(v ?? '');
    if (!esNumero) s = neutralizar(s);
    return /[;,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csvDe = (enc, filas) => '﻿' + [enc, ...filas].map((f) => f.map(campo).join(';')).join('\r\n') + '\r\n';
  // Orden fijo: proveedor (sin tildes ni mayusculas), urgentes primero y luego codigo. El comparador anterior nunca devolvia
  // empate, asi que el orden dentro de cada proveedor dependia del algoritmo de ordenacion y no era el mismo en otro lenguaje.
  const ordenPedido = (a, b) => {
    const pa = norm(a.proveedor || '');
    const pb = norm(b.proveedor || '');
    if (pa !== pb) return pa < pb ? -1 : 1;
    const ua = a.accion === 'COMPRAR URGENTE' ? 0 : 1;
    const ub = b.accion === 'COMPRAR URGENTE' ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return a.sku < b.sku ? -1 : (a.sku > b.sku ? 1 : 0);
  };
  const csvPedido = csvDe(['sku', 'producto', 'proveedor', 'urgencia', 'cantidad', 'unidad', 'costo_unitario', 'costo_total', 'motivo'],
    aSurtir.filter((r) => r.cantidad > 0).sort(ordenPedido).map((r) => [r.sku, r.nombre, r.proveedor, r.accion === 'COMPRAR URGENTE' ? 'URGENTE' : 'NORMAL', r.cantidad, r.unidad, r.costo, r.valor_compra, r.motivo]));
  const csvDetalle = csvDe(['sku', 'producto', 'accion', 'clase_abc', 'clase_xyz', 'patron_demanda', 'confianza', 'stock_al_corte', 'en_transito', 'salidas_mes', 'entradas_mes', 'dias_en_cero_mes', 'ultima_salida', 'dias_sin_salida', 'demanda_mensual_estimada', 'cobertura_dias', 'plazo_dias', 'punto_de_reorden', 'nivel_objetivo', 'cantidad_sugerida', 'costo_unitario', 'valor_stock', 'proveedor', 'motivo'],
    rs.map((r) => [r.sku, r.nombre, r.accion, r.clase, r.xyz || '', r.pron ? r.pron.patron : '', r.confianza, r.stock, r.transito, r.salidas_mes, r.entradas_mes, r.dias_en_cero === null ? '' : r.dias_en_cero, r.ultima_salida === null || r.ultima_salida === undefined ? '' : isoDe(r.ultima_salida), r.dias_sin_salida === null ? '' : r.dias_sin_salida, r.pron ? r.pron.demanda : '', r.cobertura === null || r.cobertura === Infinity ? '' : r.cobertura, r.L, r.rop === undefined ? '' : r.rop, r.S === undefined ? '' : r.S, r.cantidad, r.costo, r.valor_stock, r.proveedor, r.motivo]));

  // ---------- respuesta corta del chat ----------
  const C = [];
  C.push(`## Inventario de ${mesTexto(res.ym)}`);
  C.push(`Corte al ${isoDe(res.corte)} | ${ind.productos} productos`);
  C.push('');
  C.push(`- **Surtir:** ${aSurtir.length} (${urgentes.length} urgentes). Compra sugerida: ${dinero(ind.compra_total)}.`);
  C.push(`- **En cero este mes:** ${quiebres.length}${quiebres.length ? ` (${quiebres.filter((r) => r.quiebre && r.quiebre.sigue).length} siguen en cero)` : ''}. **Sin movimiento:** ${sinMov.length}. **Nunca se movieron:** ${nunca.length}. **Sobrestock:** ${sobre.length}.`);
  C.push(`- **Capital inmovilizado:** ${dinero(ind.valor_muerto)} (${pct(ind.pct_muerto)}). Rotacion anual ${ind.rotacion_anual ? num(Math.round(ind.rotacion_anual * 10) / 10) : '-'}.`);
  C.push('');
  if (urgentes.length) {
    C.push('**Urgente**');
    tablaChat(C, ['Producto', 'Stock', 'Cobertura (dias)', 'Pedir'], urgentes.slice(0, 8).map((r) => [nombre(r), num(r.stock), cob(r), `${num(r.cantidad)} ${r.unidad || ''}`]));
    if (urgentes.length > 8) C.push(`... y ${urgentes.length - 8} mas en el informe.`);
    C.push('');
  }
  if (quiebres.length) C.push(`**Se quedaron en cero:** ${quiebres.slice(0, 6).map((r) => `${r.sku} (${r.dias_en_cero} dias${r.quiebre && r.quiebre.sigue ? ', sigue' : ''})`).join(', ')}${quiebres.length > 6 ? ` y ${quiebres.length - 6} mas` : ''}.`);
  if (nunca.length || sinMov.length) C.push(`**Sin rotacion:** ${[...nunca.map((r) => `${r.sku} (nunca)`), ...sinMov.map((r) => `${r.sku} (${r.dias_sin_salida} dias)`)].slice(0, 8).join(', ')}.`);
  if (comentario) { C.push(''); C.push(comentario.replace(/^##[^\n]*\n/, '').trim()); }
  if (res.avisos.length) { C.push(''); res.avisos.slice(0, 3).forEach((a) => C.push(`- Ojo: ${a}`)); }
  const chat = sinGuiones(C.join('\n')).replace(/\n{3,}/g, '\n\n');
  return { md, html, csvPedido, csvDetalle, chat, resumen: { surtir: aSurtir.length, urgentes: urgentes.length, quiebres: quiebres.length, sin_movimiento: sinMov.length, nunca: nunca.length, sobrestock: sobre.length } };
}

function tablaChat(C, enc, filas) {
  C.push(`| ${enc.join(' | ')} |`);
  C.push(`|${enc.map(() => '---').join('|')}|`);
  filas.forEach((f) => C.push(`| ${f.map((c) => celda(c)).join(' | ')} |`));
}

// Quita del comentario de la IA las frases con cifras que no estan en los datos que se le entregaron.
function limpiarComentario(texto, entradaJson) {
  const digitos = (t) => (String(t).match(/\d[\d.,]*/g) || []).map((n) => n.replace(/\D/g, '')).filter(Boolean);
  const conocidas = new Set(digitos(entradaJson));
  let eliminadas = 0;
  const lineas = sinGuiones(texto).trim().split('\n').map((linea) => {
    if (/^\s*#/.test(linea)) return linea;
    return linea.split(/(?<=[.!?])\s+/).filter((frase) => { const raras = digitos(frase).filter((d) => !conocidas.has(d)); if (raras.length) { eliminadas++; return false; } return true; }).join(' ');
  });
  let out = lineas.join('\n').trim();
  if (eliminadas) out += `\n\n> Nota del sistema: se eliminaron ${eliminadas} frase(s) del comentario por contener cifras que no estaban en los datos calculados.`;
  return out;
}
