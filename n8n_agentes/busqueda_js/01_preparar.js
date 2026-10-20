// Nodo "Preparar solicitud": lee el mensaje del usuario, detecta el modo y arma la primera llamada a Claude.
const entrada = $input.first().json;
const texto = String(entrada.chatInput ?? entrada.text ?? '').trim();
let modo = 'rapida';
if (/\b(profunda|profundo|a fondo|deep)\b/i.test(texto)) modo = 'profunda';

const cuerpo = {
  model: MODELO,
  max_tokens: 1800,
  temperature: 0,
  system: PROMPT_INTERPRETAR,
  messages: [{ role: 'user', content: `Fecha actual: ${hoy()}\nSolicitud del usuario:\n${texto || '(vacia)'}` }],
};

return [{ json: { solicitud_texto: texto, modo, fecha: hoy(), claude_body: cuerpo } }];
