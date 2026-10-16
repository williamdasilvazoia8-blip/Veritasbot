export type JobName = 'mute-release' | 'schedule-delivery';

export interface JobPayloads {
  'mute-release': { actionId: string };
  'schedule-delivery': { scheduleId: string; occurrenceKey: string };
}

/**
 * Agenda trabalhos com atraso. O PostgreSQL é a fonte da verdade: a fila só
 * acorda o processo no momento certo, e todo handler revalida o estado no banco.
 * IDs determinísticos tornam o agendamento idempotente.
 */
export interface JobScheduler {
  schedule<N extends JobName>(name: N, jobId: string, runAt: Date, data: JobPayloads[N]): Promise<void>;
  cancel(jobId: string): Promise<void>;
}

export type JobHandlers = { [N in JobName]: (data: JobPayloads[N]) => Promise<void> };

/** BullMQ não aceita ":" em IDs personalizados. */
export function safeJobId(...parts: string[]): string {
  return parts.join('_').replace(/[^A-Za-z0-9_-]/g, '-');
}
