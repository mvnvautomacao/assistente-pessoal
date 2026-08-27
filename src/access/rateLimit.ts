// Freio de emergencia por numero: mesmo um numero ja autorizado pode entrar num
// loop por outro motivo (script travado, outro sistema automatizado etc) -- sem
// isso, cada mensagem chama a IA de novo sem limite nenhum. Foi exatamente um
// padrao de mensagens em sequencia rapida que gerou o incidente de custo real.
const WINDOW_MS = 5 * 60 * 1000; // janela de 5 minutos
const MAX_MESSAGES_IN_WINDOW = 20; // acima disso nao e uso humano normal
const COOLDOWN_MS = 30 * 60 * 1000; // pausa as respostas por 30 min depois de estourar

const timestamps = new Map<string, number[]>();
const cooldownUntil = new Map<string, number>();

export function isRateLimited(fromNumber: string): boolean {
  const until = cooldownUntil.get(fromNumber);
  if (!until) return false;
  if (Date.now() >= until) {
    cooldownUntil.delete(fromNumber);
    return false;
  }
  return true;
}

// registra a mensagem de agora; retorna true se ISSO estourou o limite (o
// cooldown acabou de comecar). Chamar so quando isRateLimited(fromNumber) for false.
export function recordMessageAndCheckLimit(fromNumber: string): boolean {
  const now = Date.now();
  const recent = (timestamps.get(fromNumber) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  if (recent.length > MAX_MESSAGES_IN_WINDOW) {
    cooldownUntil.set(fromNumber, now + COOLDOWN_MS);
    timestamps.delete(fromNumber);
    return true;
  }
  timestamps.set(fromNumber, recent);
  return false;
}

// so pra testes: os contadores sao um Map em memoria que vive pelo processo
// inteiro, entao testes que reusam o mesmo numero de teste repetidas vezes no
// mesmo arquivo (convencao estabelecida nesse projeto) podem acumular mensagens
// de cenarios sem nenhuma relacao entre si e disparar o limite sem querer.
export function resetRateLimitForTests() {
  timestamps.clear();
  cooldownUntil.clear();
}
