import type { CheckStatus, HealthResponse } from '@fixbridge/shared';
import type { AppContext } from '../../core/context';

/** A dependency check must never hold a health probe open. */
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

export type HealthReport = Omit<HealthResponse, 'message'>;

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} check timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkPostgres(context: AppContext): Promise<CheckStatus> {
  try {
    await withTimeout(context.prisma.$queryRaw`SELECT 1`, HEALTH_CHECK_TIMEOUT_MS, 'postgres');
    return 'ok';
  } catch (error) {
    context.logger.warn({ err: error }, 'health: postgres check failed');
    return 'fail';
  }
}

export async function checkRedis(context: AppContext): Promise<CheckStatus> {
  try {
    const reply = await withTimeout(context.redis.ping(), HEALTH_CHECK_TIMEOUT_MS, 'redis');
    return reply === 'PONG' ? 'ok' : 'fail';
  } catch (error) {
    context.logger.warn({ err: error }, 'health: redis check failed');
    return 'fail';
  }
}

/**
 * Actually pings both dependencies — this endpoint is what a load balancer and
 * an on-call engineer both trust, so it must never report from cache.
 */
export async function buildHealthReport(context: AppContext): Promise<HealthReport> {
  const [postgres, redis] = await Promise.all([checkPostgres(context), checkRedis(context)]);
  const allOk = postgres === 'ok' && redis === 'ok';

  return {
    status: allOk ? 'ok' : 'degraded',
    app: context.config.APP_NAME,
    version: context.version,
    uptime: Math.round(process.uptime() * 1000) / 1000,
    checks: { postgres, redis },
  };
}
