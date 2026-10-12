// Normalizacao do texto de uma RESPOSTA (sim/nao/numero). Funcao pura, sem dependencias: e
// importada pelo classificador, pela leitura de numeros e pelos avisos, entao nao pode
// importar nenhum deles (sem ciclo).

// minusculas, sem acento, sem pontuacao nem emoji, espacos colapsados. Os dois
// emojis que valem como resposta viram palavra antes de serem removidos.
export function normalizeReply(text: string): string {
  return text
    .replace(/👍/gu, " sim ")
    .replace(/❌/gu, " nao ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
