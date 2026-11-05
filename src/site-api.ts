import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

export const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const preparedSchema = z.object({ request: z.object({
  id: requestIdSchema,
  purpose: z.enum(['login', 'link']),
  display_code: z.string().regex(/^\d{6}$/),
  expires_at: z.number().int().positive(),
  status: z.enum(['pending', 'approved', 'completed', 'denied', 'cancelled', 'expired']),
}) });
const decisionSchema = z.object({ request: z.object({ status: z.enum(['approved', 'denied', 'completed']) }) });
export type Prepared = z.infer<typeof preparedSchema>['request'];
export type Decision = z.infer<typeof decisionSchema>['request'];
export interface AuthApi {
  prepare(id: string, user: string, username?: string): Promise<Prepared>;
  decide(id: string, user: string, approve: boolean): Promise<Decision>;
}

export class SiteApiError extends Error {
  constructor(public readonly status: number) { super('Site API request failed'); }
}

export class SiteApi implements AuthApi {
  constructor(private readonly baseUrl: string, private readonly key: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<unknown> = delay) {}

  async prepare(id: string, user: string, username?: string): Promise<Prepared> {
    const response = await this.post('prepare', { request_id: id, telegram_user_id: user, telegram_username: username ?? null });
    const result = preparedSchema.safeParse(response);
    if (!result.success || result.data.request.id !== id) throw new SiteApiError(502);
    return result.data.request;
  }

  async decide(id: string, user: string, approve: boolean): Promise<Decision> {
    const response = await this.post('confirm', { request_id: id, telegram_user_id: user, approve });
    const result = decisionSchema.safeParse(response);
    if (!result.success || (approve ? result.data.request.status === 'denied' : result.data.request.status !== 'denied')) {
      throw new SiteApiError(502);
    }
    return result.data.request;
  }

  private async post(action: string, body: object): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let retryMs = 300 * 2 ** attempt;
      try {
        const response = await this.fetcher(`${this.baseUrl}/auth/telegram/bot/${action}`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const retry = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retry) && retry > 0) retryMs = retry * 1000;
          await response.body?.cancel();
          throw new SiteApiError(response.status);
        }
        // The protocol is tiny; reject an unexpectedly large upstream response.
        const reader = response.body?.getReader();
        if (!reader) throw new SiteApiError(502);
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 16_384) throw new SiteApiError(502);
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => undefined); }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch (error) {
        const status = error instanceof SiteApiError ? error.status : 502;
        if (attempt >= 2 || retryMs > 3000 || (status !== 429 && status < 500)) throw new SiteApiError(status);
        await this.sleep(retryMs);
      }
    }
  }
}
