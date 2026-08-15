import type { Server } from 'node:http';
import { disposeContext, type AppContext } from './context';

export interface ShutdownOptions {
  server: Server;
  context: AppContext;
  /** Hard-exit deadline if connections refuse to drain. */
  timeoutMs: number;
  /**
   * Background work to quiesce before the connections close. Optional so a test
   * harness that never started any can leave it out.
   */
  drain?: () => Promise<void>;
}

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Stop accepting connections, drain in-flight requests, then close Prisma and
 * Redis. Guarded so a second signal (or a crash mid-shutdown) cannot re-enter.
 */
export function registerGracefulShutdown({
  server,
  context,
  timeoutMs,
  drain,
}: ShutdownOptions): void {
  let shuttingDown = false;

  const shutdown = (reason: string, exitCode: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    context.logger.info({ reason }, 'shutdown: draining');

    const forceExit = setTimeout(() => {
      context.logger.error({ reason, timeoutMs }, 'shutdown: timed out, forcing exit');
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();

    server.close((closeError) => {
      void (async () => {
        if (closeError) {
          context.logger.error({ err: closeError }, 'shutdown: http server close failed');
        }

        if (drain) {
          // A failed drain must not skip the disconnects below, or the process
          // hangs on open handles until the force-exit timer fires.
          try {
            await drain();
          } catch (error) {
            context.logger.error({ err: error }, 'shutdown: background drain failed');
          }
        }

        await disposeContext(context);
        context.logger.info({ reason }, 'shutdown: complete');
        clearTimeout(forceExit);
        process.exit(exitCode);
      })();
    });
  };

  for (const signal of SIGNALS) {
    process.on(signal, () => shutdown(signal, 0));
  }

  process.on('unhandledRejection', (reason) => {
    context.logger.fatal({ err: reason }, 'unhandled promise rejection');
    shutdown('unhandledRejection', 1);
  });

  process.on('uncaughtException', (error) => {
    context.logger.fatal({ err: error }, 'uncaught exception');
    shutdown('uncaughtException', 1);
  });
}
