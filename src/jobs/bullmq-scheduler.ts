import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Logger } from '../shared/logger.js';
import type { JobHandlers, JobName, JobPayloads, JobScheduler } from './job-scheduler.js';

const QUEUE = 'veritasbot';

export class BullMqJobScheduler implements JobScheduler {
  readonly queue: Queue;

  constructor(connection: ConnectionOptions) {
    this.queue = new Queue(QUEUE, { connection });
  }

  async schedule<N extends JobName>(
    name: N,
    jobId: string,
    runAt: Date,
    data: JobPayloads[N],
  ): Promise<void> {
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'active') return; // já em execução; o handler revalida no banco
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add(name, data, {
      jobId,
      delay: Math.max(0, runAt.getTime() - Date.now()),
      attempts: 4,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
      removeOnFail: { age: 30 * 24 * 3600 },
    });
  }

  async cancel(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job && (await job.getState()) !== 'active') await job.remove().catch(() => undefined);
  }

  startWorker(connection: ConnectionOptions, handlers: JobHandlers, logger: Logger): Worker {
    const worker = new Worker(
      QUEUE,
      async (job) => {
        const handler = handlers[job.name as JobName] as (d: unknown) => Promise<void>;
        if (!handler) throw new Error(`Job desconhecido: ${job.name}`);
        await handler(job.data);
      },
      { connection, concurrency: 4 },
    );
    worker.on('failed', (job, err) =>
      logger.warn(
        { jobId: job?.id, name: job?.name, attempts: job?.attemptsMade, err: err.message },
        'Job falhou',
      ),
    );
    worker.on('error', (err) => logger.error({ err }, 'Erro no worker'));
    return worker;
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
