/**
 * Declarações mínimas do runtime Deno usado pelas Edge Functions, para o typecheck do projeto
 * (tsc) verificar também as funções. Não substitui os tipos oficiais do Deno.
 */
declare namespace Deno {
  const env: { get(name: string): string | undefined };
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}
