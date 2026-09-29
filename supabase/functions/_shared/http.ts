/** Cabeçalhos e respostas comuns às funções (sem dependências do Deno). */

/** Só as origens configuradas (lista separada por vírgulas) recebem autorização CORS. */
export function corsHeaders(origin: string | null, allowedList: string | undefined): Record<string, string> {
  const allowed = (allowedList ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const allow = origin && allowed.includes(origin) ? origin : '';
  return {
    ...(allow ? { 'access-control-allow-origin': allow, vary: 'origin' } : {}),
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-region',
    'access-control-allow-methods': 'POST, OPTIONS',
    'cache-control': 'no-store',
  };
}

export function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });
}
