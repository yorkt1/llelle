/**
 * Erro de regra de negócio: a requisição está bem formada, mas o que ela pede
 * não faz sentido para os dados enviados. A camada HTTP traduz para 422 — não é
 * falha do servidor, é uma condição que o usuário consegue corrigir.
 *
 * Fica num módulo sem dependências para que o domínio possa usá-lo sem arrastar
 * o runtime do servidor (Express) para dentro dos testes.
 */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessError";
  }
}
