// Validacao compartilhada entre gastos e entradas -- achado da auditoria:
// nada impedia um valor negativo, zero, ou absurdamente alto (ex: a IA lendo
// errado um valor de nota fiscal) de ser gravado no banco, poluindo relatorios
// e orcamentos silenciosamente. Nao e uma falha exploravel por fora (o
// webhook so aceita numero ja autorizado, e a IA normalmente se comporta),
// mas vale a defesa em profundidade direto na camada de dados.
export const MAX_REASONABLE_AMOUNT = 1_000_000;

// Erro proprio pra o router poder responder o MOTIVO ao cliente (em vez do
// "deu erro do meu lado" generico) -- ver userFacingErrorText em router.ts.
export class InvalidAmountError extends Error {
  constructor(
    public readonly amount: number,
    public readonly reason: "not_positive" | "too_high"
  ) {
    super(
      reason === "not_positive"
        ? `Valor de gasto/entrada invalido: ${amount}. Precisa ser um numero maior que zero.`
        : `Valor de gasto/entrada absurdamente alto: ${amount}. Limite atual: ${MAX_REASONABLE_AMOUNT}.`
    );
    this.name = "InvalidAmountError";
  }
}

export function assertValidAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) throw new InvalidAmountError(amount, "not_positive");
  if (amount > MAX_REASONABLE_AMOUNT) throw new InvalidAmountError(amount, "too_high");
}

export type AmountCheck = { ok: true } | { ok: false; reason: "not_positive" | "too_high"; message: string };

// mesma regra de assertValidAmount, mas SEM lancar: pra mostrar o motivo ja na
// previa de uma edicao, antes de o usuario confirmar (assertValidAmount continua
// valendo na camada de dados como ultima defesa).
export function validateAmount(amount: number): AmountCheck {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "not_positive", message: "O valor precisa ser maior que R$ 0,00." };
  }
  if (amount > MAX_REASONABLE_AMOUNT) {
    return { ok: false, reason: "too_high", message: "Esse valor é muito alto (limite R$ 1.000.000,00). Confere e me manda de novo?" };
  }
  return { ok: true };
}
