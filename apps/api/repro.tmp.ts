import { parseConfig } from './src/core/config';
import { createContext, disposeContext } from './src/core/context';
import { registerOutboxSubscribers } from './src/core/background';

async function main() {
  const context = createContext(parseConfig());
  registerOutboxSubscribers(context);

  console.log('topics:', context.outbox.topics());
  console.log('webhook handlers:', context.outbox.handlersFor('webhook.received').length);

  const recent = await context.prisma.webhookEvent.findMany({
    orderBy: { receivedAt: 'desc' },
    take: 5,
    select: { gatewayEventId: true, eventType: true, processedAt: true, processingError: true },
  });
  console.log('recent webhook events:', JSON.stringify(recent, null, 1));

  const pending = await context.prisma.outboxEvent.count({ where: { processedAt: null } });
  const byTopic = await context.prisma.outboxEvent.groupBy({
    by: ['topic'],
    where: { processedAt: null },
    _count: { _all: true },
  });
  console.log('pending outbox:', pending, JSON.stringify(byTopic));

  await disposeContext(context);
}

void main();
