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
