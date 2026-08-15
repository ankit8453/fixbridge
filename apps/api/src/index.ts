import { createApp } from './app';
import { createBackgroundWorkers, registerOutboxSubscribers } from './core/background';
import { loadConfig } from './core/config';
import { createContext } from './core/context';
import { registerGracefulShutdown } from './core/shutdown';

function bootstrap(): void {
  const config = loadConfig();
  const context = createContext(config);
  const app = createApp(context);

  // Always registered, even with jobs off: subscribing is free, and a test or a
  // manual dispatch must find the same handlers production would.
  registerOutboxSubscribers(context);

  const background = createBackgroundWorkers(context);

  /**
   * Create the KYC bucket if it is missing, but do not block the boot on it.
   * A storage outage should surface when someone tries to upload, not stop the
   * whole API — every other endpoint is unaffected by it.
   */
  void context.storage.ensureBucket().catch((error: unknown) => {
    context.logger.error({ err: error }, 'storage: bucket check failed at startup');
  });

  const server = app.listen(config.PORT, () => {
    context.logger.info(
      { port: config.PORT, env: config.NODE_ENV, version: context.version },
      'api listening',
    );

    if (config.JOBS_ENABLED) {
      background.start();
    } else {
      context.logger.warn('background jobs are disabled; nothing will expire or extend on its own');
    }
  });

  server.on('error', (error) => {
    context.logger.fatal({ err: error, port: config.PORT }, 'failed to bind port');
    process.exit(1);
  });

  registerGracefulShutdown({
    server,
    context,
    timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
    // Drained before Prisma and Redis close, so a batch already in flight
    // finishes instead of being redelivered on the next boot.
    drain: () => background.stop(),
  });
}

try {
  bootstrap();
} catch (error) {
  // The logger needs a valid config, so a config failure has to use the console.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
