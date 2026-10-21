// Motor de calculo del agente de inventarios. Todo es codigo determinista: la IA no calcula nada.
// Politica: revision periodica (R,S). Se compra si la posicion proyectada al proximo corte cae bajo el punto de reorden,
// y se pide hasta el nivel objetivo S = D x (L + R) + stock de seguridad. Los parametros salen de 00_motor y se pueden cambiar.
const DEFECTOS = {
  R_dias: 30,
  lead_time_defecto: 15,
  tope_censura: 2,
  z_por_clase: { A: 2.05, B: 1.645, C: 1.28, N: 1.645 },
  sector: 'general',
  cobertura_maxima_sector: { general: 90, alimentos: 45, comercio: 60, manufactura: 120, pesados: 180 },
  dias_sin_movimiento_min: 90,
  meses_ventana: 12,
  alfa_ses: 0.3,
  alfa_croston: 0.2,
  corte_abc: [0.8, 0.95],
  dias_producto_nuevo: 90,
};

const suma = (a) => a.reduce((s, x) => s + x, 0);
const media = (a) => (a.length ? suma(a) / a.length : 0);
const desvMuestral = (a) => { if (a.length < 2) return 0; const m = media(a); return Math.sqrt(suma(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };

// ---------- serie diaria de saldo ----------
// Devuelve el saldo de cierre de cada dia desde el primer movimiento hasta diaFin.
//  'saldo'        : el sistema trae el saldo posterior a cada movimiento
//  'stock_actual' : se reconstruye hacia atras desde el stock actual del maestro
//  'asumido_cero' : no hay ancla; se asume saldo inicial 0 (el quiebre deja de ser confiable)
function construirSerie(movs, stockActual, diaFin) {
  if (!movs.length) return null;
  const dMin = movs[0].dia;
  const n = diaFin - dMin + 1;
  if (n <= 0) return null;
  const delta = new Array(n).fill(0);
  const saldoDia = new Array(n).fill(null);
  let conSaldo = 0;
  for (const m of movs) {
    const i = m.dia - dMin;
    if (i < 0 || i >= n) continue;
    delta[i] += m.efecto;
    if (m.saldo !== null) { saldoDia[i] = m.saldo; conSaldo++; }
  }
  const bal = new Array(n);
  let base;
  let descuadre = null;
  if (conSaldo >= 0.8 * movs.length) {
    base = 'saldo';
    let previo = 0;
    for (let i = 0; i < n; i++) { previo = saldoDia[i] !== null ? saldoDia[i] : previo + delta[i]; bal[i] = previo; }
    if (stockActual !== null && stockActual !== undefined) descuadre = stockActual - bal[n - 1];
  } else {
    let acum = 0;
    for (let i = 0; i < n; i++) { acum += delta[i]; bal[i] = acum; }
    if (stockActual !== null && stockActual !== undefined) { base = 'stock_actual'; const desfase = stockActual - bal[n - 1]; for (let i = 0; i < n; i++) bal[i] += desfase; }
    else base = 'asumido_cero';
  }
  return { dMin, dFin: diaFin, bal, base, descuadre, negativos: bal.filter((x) => x < 0).length };
}

const saldoEn = (serie, dia) => {
  if (!serie || dia < serie.dMin) return null;
  return serie.bal[Math.min(dia, serie.dFin) - serie.dMin];
};

// Detalle de los dias en cero del mes: primer dia, ultimo dia y cuantos episodios seguidos hubo.
function quiebreMes(serie, ym, corte) {
  const desde = Math.max(primerDiaMes(ym), serie.dMin);
  let primero = null;
  let ultimo = null;
  let episodios = 0;
  let enCero = false;
  for (let d = desde; d <= corte; d++) {
    const cero = saldoEn(serie, d) <= 0;
    if (cero) { if (primero === null) primero = d; ultimo = d; if (!enCero) episodios++; }
    enCero = cero;
  }
  return { desde: primero, hasta: ultimo, episodios, sigue: enCero };
}

// ---------- agregados mensuales ----------
function agregarMeses(movs, serie, ymFin, nMeses, diaFin, quiebreConfiable) {
  const iFin = mesIndice(ymFin);
  const dMin = movs.length ? movs[0].dia : null;
  const recs = [];
  const porMes = new Map();
  for (const m of movs) {
    const k = mesIndice(mesDeDia(m.dia));
    if (!porMes.has(k)) porMes.set(k, []);
    porMes.get(k).push(m);
  }
  for (let k = iFin - nMeses + 1; k <= iFin; k++) {
    const ym = mesDeIndice(k);
    const ini = primerDiaMes(ym);
    const fin = ultimoDiaMes(ym);
    const limite = Math.min(fin, diaFin);
    if (dMin === null || limite < dMin) { recs.push({ ym, k, dias_mes: diasDelMes(ym), activos: 0, salidas: 0, devol: 0, demanda_neta: 0, entradas: 0, ajustes_pos: 0, ajustes_neg: 0, dias_con_salida: 0, dias_en_cero: null, cierre: null }); continue; }
    const desde = Math.max(ini, dMin);
    const activos = limite - desde + 1;
    const ms = porMes.get(k) || [];
    const sal = ms.filter((m) => m.tipo === 'salida');
    const salidas = suma(sal.map((m) => m.cantidad));
    const devol = suma(ms.filter((m) => m.tipo === 'devolucion_cliente').map((m) => m.cantidad));
    let diasCero = null;
    if (serie && quiebreConfiable) { diasCero = 0; for (let d = desde; d <= limite; d++) if (saldoEn(serie, d) <= 0) diasCero++; }
    recs.push({
      ym, k, dias_mes: diasDelMes(ym), activos, salidas, devol, demanda_neta: Math.max(0, salidas - devol),
      entradas: suma(ms.filter((m) => m.tipo === 'entrada').map((m) => m.cantidad)),
      ajustes_pos: suma(ms.filter((m) => m.tipo === 'ajuste_pos').map((m) => m.cantidad)), ajustes_neg: suma(ms.filter((m) => m.tipo === 'ajuste_neg').map((m) => m.cantidad)),
      dias_con_salida: new Set(sal.map((m) => m.dia)).size, dias_en_cero: diasCero, cierre: serie ? saldoEn(serie, limite) : null,
    });
  }
  return recs;
}

// Demanda del mes corregida: un mes con quiebre vende menos de lo que se pidio (demanda censurada).
// Se calcula sobre los dias con stock, con un tope; si mas de la mitad de los dias estuvo en cero el mes se trata como dato faltante.
function demandaAjustada(r, P) {
  if (r.activos <= 0) return null;
  let d = r.demanda_neta;
  if (r.activos < r.dias_mes) {
    if (r.activos < 15) return null;
    d = (d * r.dias_mes) / r.activos;
  }
  const dz = r.dias_en_cero;
  if (dz !== null && dz > 0) {
    if (dz > 0.5 * r.activos) return null;
    if (r.demanda_neta > 0) d *= Math.min(P.tope_censura, r.activos / (r.activos - dz));
  }
  return d;
}

// ---------- pronostico ----------
function crostonSBA(v, alfa) {
  let z = null;
  let p = null;
  let desde = 1;
  for (const x of v) {
    if (x > 0) {
      if (z === null) { z = x; p = desde; } else { z += alfa * (x - z); p += alfa * (desde - p); }
      desde = 1;
    } else desde++;
  }
  return z === null ? 0 : (1 - alfa / 2) * (z / p);
}

function suavizadoExponencial(v, alfa) {
  let nivel = media(v.slice(0, Math.min(3, v.length)));
  for (const x of v) nivel = alfa * x + (1 - alfa) * nivel;
  return nivel;
}

// Patron de demanda de Syntetos y Boylan: ADI (intervalo medio entre demandas) y CV2 de los tamanos de demanda.
function pronosticar(valores, P) {
  const n = valores.length;
  const base = { n, metodo: 'sin datos', demanda: 0, sigma: 0, maximo: 0, patron: 'sin demanda', adi: null, cv2: null, confianza: 'BAJA' };
  if (!n) return base;
  const nz = valores.filter((x) => x > 0);
  const adi = nz.length ? n / nz.length : Infinity;
  const cv2 = nz.length >= 2 && media(nz) > 0 ? (desvMuestral(nz) / media(nz)) ** 2 : 0;
  const patron = !nz.length ? 'sin demanda' : adi < 1.32 ? (cv2 < 0.49 ? 'suave' : 'erratica') : (cv2 < 0.49 ? 'intermitente' : 'irregular');
  const out = { ...base, n, adi: Number.isFinite(adi) ? adi : null, cv2, patron, sigma: desvMuestral(valores), maximo: Math.max(...valores) };
  if (n < 3) return { ...out, metodo: 'promedio simple (historial insuficiente)', demanda: media(valores), confianza: 'BAJA' };
  if ((patron === 'intermitente' || patron === 'irregular') && nz.length >= 2) return { ...out, metodo: 'Croston con correccion SBA (demanda intermitente)', demanda: crostonSBA(valores, P.alfa_croston), confianza: 'MEDIA' };
  if (n >= 6) return { ...out, metodo: 'suavizado exponencial simple', demanda: suavizadoExponencial(valores, P.alfa_ses), confianza: patron === 'suave' ? 'ALTA' : 'MEDIA' };
  return { ...out, metodo: 'promedio movil simple (pocos meses)', demanda: media(valores), confianza: 'MEDIA' };
}

// ---------- politica de reposicion ----------
// Stock de seguridad para un periodo de proteccion de `dias` dias. Con 6 o mas meses se usa la desviacion estandar
// (y la del plazo de entrega si se conoce); con menos, el metodo simplificado (demanda maxima menos promedio).
function stockSeguridad(d, dias) {
  if (d.n >= 6) {
    const varDemanda = (dias / 30) * d.sigma ** 2;
    const varPlazo = d.sigmaL ? ((d.demandaMes * d.sigmaL) / 30) ** 2 : 0;
    return d.Z * Math.sqrt(varDemanda + varPlazo);
  }
  return Math.max(0, d.maximo - d.demandaMes) * (dias / 30);
}

function politica(d, P) {
  const Ddia = d.demandaMes / 30;
  const L = d.L;
  const R = d.R;
  const ssL = stockSeguridad(d, L);
  const ssLR = stockSeguridad(d, L + R);
  const rop = Ddia * L + ssL;
  const S = Ddia * (L + R) + ssLR;
  const posicion = d.stock + d.transito;
  const proyectada = posicion - Ddia * R;
  const comprar = Ddia > 0 && proyectada <= rop;
  let cantidad = 0;
  if (comprar) {
    cantidad = Math.max(0, S - posicion);
    if (d.moq && d.moq > 1) cantidad = Math.ceil(cantidad / d.moq) * d.moq;
    cantidad = Math.ceil(cantidad);
  }
  const cobertura = Ddia > 0 ? d.stock / Ddia : Infinity;
  return { Ddia, rop, S, ss: ssLR, posicion, proyectada, comprar, cantidad, cobertura, urgente: Ddia > 0 && (d.stock <= 0 || cobertura <= L) };
}

// ---------- calculo completo del mes ----------
function calcularInventario(datos, cfg, parametros) {
  const P = { ...DEFECTOS, ...(parametros || {}), z_por_clase: { ...DEFECTOS.z_por_clase, ...((parametros || {}).z_por_clase || {}) } };
  const ym = cfg.mes;
  const avisos = [...datos.avisos];
  const porKey = new Map();
  for (const m of datos.movs) { if (!porKey.has(m.key)) porKey.set(m.key, []); porKey.get(m.key).push(m); }
  for (const lista of porKey.values()) lista.sort((a, b) => a.dia - b.dia || a.idx - b.idx);
  const diaFin = datos.movs.length ? Math.max(...datos.movs.map((m) => m.dia)) : 0;
  const finMes = ultimoDiaMes(ym);
  const corte = Math.min(finMes, diaFin);
  if (diaFin < finMes) avisos.push(`Los movimientos llegan hasta ${isoDe(diaFin)}, antes del fin de ${ym}: el mes esta incompleto y el informe se calcula al ${isoDe(corte)}.`);
  if (diaFin > finMes + 40) avisos.push(`Hay movimientos hasta ${isoDe(diaFin)}, posteriores al mes pedido (${ym}). Se usan solo para reconstruir el saldo; el analisis es al ${isoDe(finMes)}.`);
  const claves = new Set([...porKey.keys(), ...datos.maestro.keys()]);
  const resultados = [];
  const calidad = { ...datos.calidad, descuadres: [], saldo_negativo: [], sin_ancla: [], plazo_supuesto: 0, sin_costo: 0 };
  const nVentana = P.meses_ventana + 2;

  for (const key of claves) {
    const movs = porKey.get(key) || [];
    const mae = datos.maestro.get(key) || null;
    const sku = mae ? mae.sku : (movs[0] ? movs[0].sku : key);
    const nombre = (mae && mae.nombre) || (movs.find((m) => m.producto) || {}).producto || '';
    if (mae && !mae.activo) { resultados.push({ key, sku, nombre, accion: 'INACTIVO', motivo: 'Marcado como inactivo en el maestro.', stock: mae.stock_actual || 0, costo: mae.costo || 0, valor_stock: (mae.stock_actual || 0) * (mae.costo || 0), clase: '-', cantidad: 0, valor_compra: 0, proveedor: mae.proveedor, salidas_mes: 0, entradas_mes: 0, dias_en_cero: 0, confianza: '-' }); continue; }
    const mensual = datos.calidad.granularidad_mensual;
    const serie = mensual ? null : construirSerie(movs, mae ? mae.stock_actual : null, diaFin);
    const quiebreConfiable = !!serie && serie.base !== 'asumido_cero';
    if (serie && serie.base === 'asumido_cero') calidad.sin_ancla.push(sku);
    if (serie && serie.descuadre !== null && Math.abs(serie.descuadre) > 0.5) calidad.descuadres.push({ sku, diferencia: serie.descuadre });
    if (serie && serie.negativos > 0) calidad.saldo_negativo.push(sku);

    const meses = agregarMeses(movs, serie, ym, nVentana, diaFin, quiebreConfiable);
    const mesActual = meses[meses.length - 1];
    const previos3 = meses.slice(-4, -1).filter((r) => r.activos >= r.dias_mes);
    const promedio3 = previos3.length ? media(previos3.map((r) => r.demanda_neta)) : null;
    const quiebre = serie && quiebreConfiable && mesActual.dias_en_cero > 0 ? quiebreMes(serie, ym, corte) : null;
    const alta = movs.length ? movs[0].dia : null;
    const stockCorte = serie ? saldoEn(serie, corte) : (mae && mae.stock_actual !== null ? mae.stock_actual : 0);
    const stock = Math.max(0, stockCorte === null ? (mae ? (mae.stock_actual || 0) : 0) : stockCorte);
    const ultimoCosto = [...movs].reverse().find((m) => m.costo !== null);
    const costo = (mae && mae.costo) || (ultimoCosto ? ultimoCosto.costo : 0);
    if (!costo) calidad.sin_costo++;
    const L = mae && mae.lead_time ? mae.lead_time : P.lead_time_defecto;
    if (!(mae && mae.lead_time)) calidad.plazo_supuesto++;
    const sal = movs.filter((m) => m.tipo === 'salida' && m.dia <= corte);
    const diasSalida = [...new Set(sal.map((m) => m.dia))].sort((a, b) => a - b);
    const ultimaSalida = diasSalida.length ? diasSalida[diasSalida.length - 1] : null;
    const diasSinSalida = ultimaSalida !== null ? corte - ultimaSalida : null;
    const gaps = diasSalida.slice(1).map((d, i) => d - diasSalida[i]);
    const intervaloMedio = diasSalida.length >= 4 ? media(gaps) : null;
    const edadDias = alta !== null ? corte - alta : null;
    const nuevo = alta !== null && corte - alta < P.dias_producto_nuevo;

    const valores = meses.map((r) => demandaAjustada(r, P)).filter((x) => x !== null);
    const f = pronosticar(valores, P);
    const ventana12 = meses.slice(-P.meses_ventana);
    const cons12 = suma(ventana12.map((r) => r.demanda_neta));

    resultados.push({
      key, sku, nombre, unidad: mae ? mae.unidad : '', proveedor: mae ? mae.proveedor : '', costo, stock, transito: mae ? mae.en_transito : 0, moq: mae ? mae.moq : null, L, sigmaL: mae ? mae.lead_time_desv : null,
      plazo_supuesto: !(mae && mae.lead_time), vida_util: mae ? mae.vida_util : null, llegada_transito: mae ? mae.llegada_transito : null,
      sin_maestro: !mae, alta, nuevo, edad_dias: edadDias, serie_base: serie ? serie.base : (mensual ? 'mensual' : 'sin movimientos'), quiebre_confiable: quiebreConfiable,
      salidas_mes: mesActual.salidas, devol_mes: mesActual.devol, demanda_neta_mes: mesActual.demanda_neta, entradas_mes: mesActual.entradas, ajustes_pos_mes: mesActual.ajustes_pos, ajustes_neg_mes: mesActual.ajustes_neg,
      promedio_3m: promedio3, quiebre,
      dias_con_salida_mes: mesActual.dias_con_salida, dias_en_cero: mesActual.dias_en_cero,
      stock_inicial: serie ? saldoEn(serie, primerDiaMes(ym) - 1) : null, stock_cierre: serie ? saldoEn(serie, corte) : null,
      ultima_salida: ultimaSalida, dias_sin_salida: diasSinSalida, intervalo_medio: intervaloMedio, salio_alguna_vez: diasSalida.length > 0,
      meses, valores, pron: f, consumo12: cons12, valor_consumo12: cons12 * costo, valor_stock: stock * costo,
      mismo_mes_anio_anterior: (meses.find((r) => r.k === mesIndice(ym) - 12) || {}).demanda_neta || 0, nuevo_poco_historial: nuevo && f.n < 3,
    });
  }

  // ---------- clasificacion ABC por valor de consumo de los ultimos 12 meses (el SKU que cruza el umbral queda en la clase superior) ----------
  const activos = resultados.filter((r) => r.accion !== 'INACTIVO');
  const conClase = activos.filter((r) => !r.nuevo).sort((a, b) => b.valor_consumo12 - a.valor_consumo12);
  const total = suma(conClase.map((r) => r.valor_consumo12));
  let acum = 0;
  for (const r of conClase) {
    const antes = total > 0 ? acum / total : 1;
    r.clase = r.valor_consumo12 <= 0 ? 'C' : antes < P.corte_abc[0] ? 'A' : antes < P.corte_abc[1] ? 'B' : 'C';
    acum += r.valor_consumo12;
  }
  activos.filter((r) => r.nuevo).forEach((r) => { r.clase = 'N'; });
  if (conClase.length < 10) avisos.push('Hay pocos productos (menos de 10): la clasificacion ABC es orientativa.');

  // ---------- decision por producto ----------
  const sector = P.sector in P.cobertura_maxima_sector ? P.sector : 'general';
  for (const r of activos) {
    const fp = r.pron;
    r.xyz = fp.n >= 6 && fp.demanda > 0 ? (() => { const cv = fp.sigma / media(r.valores); return cv < 0.5 ? 'X' : cv <= 1 ? 'Y' : 'Z'; })() : null;
    const Z = P.z_por_clase[r.clase] || P.z_por_clase.B;
    r.nivel_servicio = { A: '98%', B: '95%', C: '90%', N: '95%' }[r.clase] || '95%';
    const pol = politica({ demandaMes: fp.demanda, sigma: fp.sigma, maximo: fp.maximo, n: fp.n, Z, L: r.L, sigmaL: r.sigmaL, R: P.R_dias, stock: r.stock, transito: r.transito, moq: r.moq }, P);
    Object.assign(r, { Ddia: pol.Ddia, rop: pol.rop, S: pol.S, ss: pol.ss, posicion: pol.posicion, proyectada: pol.proyectada, cobertura: pol.cobertura });
    r.confianza = fp.confianza;
    if (r.sin_maestro && r.serie_base === 'asumido_cero') r.confianza = 'BAJA';
    const umbralCob = Math.max(2 * (r.L + P.R_dias), P.cobertura_maxima_sector[sector]);
    r.umbral_cobertura = umbralCob;
    const umbralMuerto = Math.max(P.dias_sin_movimiento_min, r.intervalo_medio ? Math.min(365, 3 * r.intervalo_medio) : 0);
    r.umbral_sin_movimiento = umbralMuerto;
    const edad = r.dias_sin_salida;
    r.tramo_edad = edad === null ? null : edad >= 365 ? '365 o mas' : edad >= 180 ? '180 a 364' : '90 a 179';
    r.transito_vencido = r.llegada_transito !== null && r.llegada_transito < corte && r.transito > 0;
    r.exceso_unidades = Math.max(0, pol.posicion - pol.S);
    r.exceso_valor = r.exceso_unidades * r.costo;
    r.ventas_perdidas = r.dias_en_cero > 0 ? Math.round(pol.Ddia * r.dias_en_cero) : 0;
    const quiebreActual = r.stock <= 0 && (pol.Ddia > 0 || r.consumo12 > 0);
    const nunca = r.stock > 0 && !r.salio_alguna_vez;
    const sinMov = r.stock > 0 && r.salio_alguna_vez && edad !== null && edad >= umbralMuerto && !r.nuevo;
    const sobre = pol.Ddia > 0 && pol.cobertura > umbralCob && r.stock > 0;
    const motivoMeta = `Politica de revision mensual: nivel de servicio ${r.nivel_servicio}, plazo ${r.L} dias${r.plazo_supuesto ? ' (supuesto)' : ''}.`;
    if (r.serie_base === 'asumido_cero' && r.sin_maestro) {
      r.accion = 'REVISAR DATOS';
      r.cantidad = 0;
      r.confianza = 'BAJA';
      r.motivo = 'No hay stock actual ni saldo por movimiento para este producto: el stock es desconocido y no se puede recomendar una compra. Agregalo al maestro de productos.';
    } else if (quiebreActual) {
      r.accion = 'COMPRAR URGENTE';
      r.cantidad = Math.max(pol.cantidad, Math.ceil(Math.max(0, pol.S - pol.posicion)));
      if (r.moq && r.moq > 1) r.cantidad = Math.ceil(r.cantidad / r.moq) * r.moq;
      r.motivo = `Sin stock al cierre${r.transito > 0 ? ` (hay ${r.transito} en transito${r.transito_vencido ? ', con fecha de llegada vencida' : ''})` : ''}. Riesgo que mitiga: quiebre. ${motivoMeta}`;
      if (r.cantidad <= 0) { r.accion = 'SIN STOCK, PEDIDO EN CAMINO'; r.cantidad = 0; r.motivo = `Sin stock al cierre, pero lo que viene en transito (${r.transito}) cubre el nivel objetivo.${r.transito_vencido ? ' La fecha de llegada ya vencio: confirma con el proveedor.' : ''}`; }
    } else if (sinMov) {
      r.accion = 'SIN MOVIMIENTO';
      r.cantidad = 0;
      r.motivo = `Ultima salida hace ${edad} dias (umbral ${Math.round(umbralMuerto)}). Riesgo: capital inmovilizado y obsolescencia.${r.mismo_mes_anio_anterior > 0 ? ' Vendio en el mismo mes del ano pasado: puede ser estacional.' : ''}`;
    } else if (pol.comprar) {
      r.accion = pol.urgente ? 'COMPRAR URGENTE' : 'COMPRAR';
      r.cantidad = pol.cantidad;
      r.motivo = `Posicion proyectada al proximo corte (${Math.round(pol.proyectada)}) por debajo del punto de reorden (${Math.round(pol.rop)}); la cobertura es de ${Math.round(pol.cobertura)} dias${pol.urgente ? ', menos que el plazo de entrega' : ''}. Riesgo que mitiga: quiebre. ${motivoMeta}`;
    } else if (nunca) {
      r.accion = 'NUNCA SE MOVIO';
      r.cantidad = 0;
      r.motivo = `Tiene ${r.stock} en stock y ninguna salida en todo el historial leido. Riesgo: capital inmovilizado.`;
    } else if (sobre) {
      r.accion = 'SOBRESTOCK';
      r.cantidad = 0;
      r.motivo = `Cobertura de ${Math.round(pol.cobertura)} dias, por encima de ${Math.round(umbralCob)}. Excedente de ${Math.round(r.exceso_unidades)} unidades sobre el nivel objetivo. Riesgo: capital inmovilizado.`;
    } else if (pol.Ddia === 0 && r.stock <= 0) {
      r.accion = 'SIN DEMANDA';
      r.cantidad = 0;
      r.motivo = 'Sin stock y sin demanda en la ventana analizada.';
    } else {
      r.accion = 'NO COMPRAR';
      r.cantidad = 0;
      r.motivo = `Stock suficiente: cobertura de ${pol.cobertura === Infinity ? 'sin demanda' : Math.round(pol.cobertura) + ' dias'}, posicion proyectada ${Math.round(pol.proyectada)} sobre el punto de reorden ${Math.round(pol.rop)}.`;
    }
    r.valor_compra = r.cantidad * r.costo;
    if (r.clase === 'A' && (r.xyz === 'Z' || fp.patron === 'irregular') && (r.accion === 'COMPRAR' || r.accion === 'COMPRAR URGENTE')) r.revisar_manual = 'Producto de alto valor con demanda errática: confirma la cantidad con el área comercial antes de pedir.';
  }

  return { resultados: activos.concat(resultados.filter((r) => r.accion === 'INACTIVO')), P, ym, corte, avisos, calidad, diaFin };
}

// ---------- exactitud del pronostico (backtest con datos hasta el mes anterior) ----------
function backtest(resultados, P, mesesAtras) {
  const out = { n: 0, real: 0, abs: 0, sesgo: 0, abs_ingenuo: 0, por_clase: {} };
  for (const r of resultados) {
    if (!r.meses || r.accion === 'INACTIVO') continue;
    for (let j = 0; j < mesesAtras; j++) {
      const idx = r.meses.length - 1 - j;
      if (idx < 1) continue;
      const mesReal = r.meses[idx];
      const previos = r.meses.slice(0, idx).map((x) => demandaAjustada(x, P)).filter((x) => x !== null);
      if (previos.length < 3 || mesReal.activos < mesReal.dias_mes) continue;
      const pron = pronosticar(previos, P).demanda;
      const real = mesReal.demanda_neta;
      const ingenuo = r.meses[idx - 1].demanda_neta;
      out.n++;
      out.real += real;
      out.abs += Math.abs(real - pron);
      out.sesgo += pron - real;
      out.abs_ingenuo += Math.abs(real - ingenuo);
      const c = r.clase || '-';
      out.por_clase[c] = out.por_clase[c] || { real: 0, abs: 0 };
      out.por_clase[c].real += real;
      out.por_clase[c].abs += Math.abs(real - pron);
    }
  }
  return {
    observaciones: out.n,
    wape: out.real > 0 ? out.abs / out.real : null,
    sesgo: out.real > 0 ? out.sesgo / out.real : null,
    wape_ingenuo: out.real > 0 ? out.abs_ingenuo / out.real : null,
    wape_por_clase: Object.fromEntries(Object.entries(out.por_clase).map(([c, v]) => [c, v.real > 0 ? v.abs / v.real : null])),
  };
}

// ---------- indicadores del mes ----------
function indicadores(res, P) {
  const rs = res.resultados.filter((r) => r.accion !== 'INACTIVO');
  const valorInv = suma(rs.map((r) => r.valor_stock));
  const conQuiebreConfiable = rs.filter((r) => r.quiebre_confiable);
  const activosVentas = rs.filter((r) => r.consumo12 > 0);
  const enQuiebre = activosVentas.filter((r) => r.quiebre_confiable && r.dias_en_cero > 0);
  const claseA = activosVentas.filter((r) => r.clase === 'A' && r.quiebre_confiable);
  const pesoTotal = suma(conQuiebreConfiable.filter((r) => r.consumo12 > 0).map((r) => r.valor_consumo12));
  const disponibilidad = pesoTotal > 0 ? suma(conQuiebreConfiable.filter((r) => r.consumo12 > 0).map((r) => r.valor_consumo12 * (1 - Math.min(1, (r.dias_en_cero || 0) / Math.max(1, r.meses[r.meses.length - 1].activos)))) ) / pesoTotal : null;
  const cogs12 = suma(rs.map((r) => r.valor_consumo12));
  const promedios = rs.filter((r) => r.serie_base !== 'asumido_cero' && r.meses.some((m) => m.cierre !== null)).map((r) => media(r.meses.filter((m) => m.cierre !== null).map((m) => Math.max(0, m.cierre) * r.costo)));
  const invPromedio = suma(promedios);
  const rotacion = invPromedio > 0 ? cogs12 / invPromedio : null;
  const muertos = rs.filter((r) => r.accion === 'SIN MOVIMIENTO' || r.accion === 'NUNCA SE MOVIO');
  const tramos = { '90 a 179': 0, '180 a 364': 0, '365 o mas': 0, 'sin ventas en el historial': 0 };
  muertos.forEach((r) => { tramos[r.accion === 'NUNCA SE MOVIO' ? 'sin ventas en el historial' : r.tramo_edad] += r.valor_stock; });
  const compras = rs.filter((r) => r.cantidad > 0);
  const porProveedor = {};
  const porClase = {};
  compras.forEach((r) => { const p = r.proveedor || 'Sin proveedor'; porProveedor[p] = (porProveedor[p] || 0) + r.valor_compra; porClase[r.clase] = (porClase[r.clase] || 0) + r.valor_compra; });
  const aj = suma(rs.map((r) => (r.ajustes_pos_mes + r.ajustes_neg_mes) * r.costo));
  const sal = suma(rs.map((r) => r.salidas_mes * r.costo));
  const cuenta = {};
  rs.forEach((r) => { cuenta[r.accion] = (cuenta[r.accion] || 0) + 1; });
  return {
    productos: rs.length, productos_con_ventas_12m: activosVentas.length, cuenta_acciones: cuenta, valor_inventario: valorInv,
    rotacion_anual: rotacion, dias_inventario: rotacion ? 365 / rotacion : null, tasa_quiebre: activosVentas.length && conQuiebreConfiable.length ? enQuiebre.length / activosVentas.filter((r) => r.quiebre_confiable).length : null,
    productos_en_quiebre: enQuiebre.length, quiebre_clase_a: claseA.length ? claseA.filter((r) => r.dias_en_cero > 0).length : 0, productos_clase_a: claseA.length,
    disponibilidad_ponderada: disponibilidad, valor_muerto: suma(muertos.map((r) => r.valor_stock)), pct_muerto: valorInv > 0 ? suma(muertos.map((r) => r.valor_stock)) / valorInv : null, tramos_muerto: tramos,
    capital_exceso: suma(rs.filter((r) => r.accion === 'SOBRESTOCK').map((r) => r.exceso_valor)), compra_total: suma(compras.map((r) => r.valor_compra)), compra_por_proveedor: porProveedor, compra_por_clase: porClase,
    ajustes_valor: aj, ajustes_pct_salidas: sal > 0 ? aj / sal : null, ventas_perdidas_valor: suma(rs.map((r) => r.ventas_perdidas * r.costo)),
    pronostico: backtest(rs, res.P, 3),
  };
}
