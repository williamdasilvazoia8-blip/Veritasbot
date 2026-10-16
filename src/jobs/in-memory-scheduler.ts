import type { JobHandlers, JobName, JobPayloads, JobScheduler } from './job-scheduler.js';

/** Implementação para testes: guarda os jobs e executa os vencidos sob demanda. */
export class InMemoryJobScheduler implements JobScheduler {
  readonly jobs = new Map<string, { name: JobName; runAt: Date; data: unknown }>();

  async schedule<N extends JobName>(
    name: N,
    jobId: string,
    runAt: Date,
    data: JobPayloads[N],
  ): Promise<void> {
    this.jobs.set(jobId, { name, runAt, data });
  }

  async cancel(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  async runDue(now: Date, handlers: Partial<JobHandlers>): Promise<number> {
    let ran = 0;
    for (const [id, job] of [...this.jobs]) {
      if (job.runAt > now) continue;
      this.jobs.delete(id);
      const handler = handlers[job.name] as ((d: unknown) => Promise<void>) | undefined;
      if (handler) {
        await handler(job.data);
        ran++;
      }
    }
    return ran;
  }
}
