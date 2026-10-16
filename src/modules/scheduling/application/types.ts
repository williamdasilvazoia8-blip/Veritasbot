import { z } from 'zod';

export const textPayloadSchema = z.object({
  content: z.string().min(1).max(2000),
  title: z.string().max(256).optional(),
  mentionRoleIds: z
    .array(z.string().regex(/^\d{17,20}$/))
    .max(5)
    .default([]),
});

export const liturgyPayloadSchema = z.object({
  /** 0 = liturgia do próprio dia; 1 = do dia seguinte (anúncio na véspera). */
  offsetDays: z.union([z.literal(0), z.literal(1)]).default(0),
  /** none = sem liturgia · references = resumo e referências · gospel = + texto do Evangelho · full = + todas as leituras. */
  readings: z.enum(['none', 'references', 'gospel', 'full']).default('references'),
  /** Santos/celebrações do dia pelo Calendário Romano (LitCal). */
  saints: z.boolean().default(true),
  optionalMemorials: z.boolean().default(true),
});

export type TextPayload = z.infer<typeof textPayloadSchema>;
export type LiturgyPayload = z.infer<typeof liturgyPayloadSchema>;

export interface OutgoingMessage {
  content?: string;
  embeds?: unknown[];
  allowedRoleIds: string[];
}

export class SendError extends Error {
  constructor(
    message: string,
    /** true = não adianta repetir (canal apagado, sem permissão). */
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'SendError';
  }
}

export interface MessageSender {
  /** `nonce` permite ao Discord descartar reenvios idênticos em um curto intervalo. */
  send(channelId: string, message: OutgoingMessage, nonce: string): Promise<{ messageId: string }>;
}
