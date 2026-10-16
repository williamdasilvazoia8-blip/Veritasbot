import { describe, expect, it, vi } from 'vitest';
import { onMessageCreate } from '../../../src/modules/bible/events/message-create.js';
import { AutoReferenceService } from '../../../src/modules/bible/application/auto-reference-service.js';
import { syntheticProvider } from '../../fixtures/bible/synthetic.js';
import type { AppContext } from '../../../src/app/context.js';
import { ReferenceLibrary } from '../../../src/modules/references/application/reference-library.js';
import { DocumentAutoReplyService } from '../../../src/modules/references/application/document-auto-reply.js';

function fakeMessage(content: string, over: Record<string, unknown> = {}) {
  const reply = vi.fn(async () => ({}));
  const edit = vi.fn();
  const del = vi.fn();
  const msg = {
    id: `m-${Math.random()}`,
    content,
    guildId: 'g1',
    channelId: 'c1',
    webhookId: null,
    system: false,
    author: { id: 'u1', bot: false },
    client: { user: { id: 'bot' } },
    inGuild: () => true,
    guild: { members: { me: { id: 'bot' } } },
    channel: { isThread: () => false, type: 0, parentId: null, permissionsFor: () => ({ has: () => true }) },
    reply,
    edit,
    delete: del,
    ...over,
  };
  return { msg, reply, edit, del };
}

const settings = {
  bibleAutoReferences: true,
  bibleAllowedChannelIds: [],
  bibleExcludedChannelIds: [],
  bibleMaxReferences: 3,
  bibleCooldownSeconds: 0,
  allowWebhookMessages: false,
  psalmNumbering: 'vulgate',
  quotationMatchingEnabled: false,
  quotationMinWords: 10,
  quotationChannelIds: [],
};

const ctx = () =>
  ({
    settings: { get: async () => settings },
    logger: { warn: vi.fn() },
    autoReferences: new AutoReferenceService(syntheticProvider(), {
      maxVersesPerPassage: 20,
      globalEnabled: true,
      quotationGloballyEnabled: false,
    }),
    documentReplies: new DocumentAutoReplyService(
      new ReferenceLibrary([
        {
          id: 'cic',
          edition: 'teste',
          importedAt: new Date(0),
          units: [
            { documentId: 'cic', number: 1055, text: 'Texto sintético.', context: null, sourceUrl: null },
          ],
        },
      ]),
      { isGuildAllowed: () => true },
    ),
  }) as unknown as AppContext;

describe('onMessageCreate (handler do Discord)', () => {
  it('"João 3:16" sozinho gera resposta com embed, sem menções e sem alterar a mensagem', async () => {
    const { msg, reply, edit, del } = fakeMessage('João 3:16');
    await onMessageCreate(msg as never, ctx());
    expect(reply).toHaveBeenCalledTimes(1);
    const payload = (
      reply.mock.calls[0] as unknown as [
        { embeds: Array<{ data: { title: string; footer: { text: string } } }>; allowedMentions: unknown },
      ]
    )[0];
    expect(payload.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(payload.embeds[0]!.data.title).toBe('João 3,16');
    expect(payload.embeds[0]!.data.footer.text).toContain('SINTÉTICO');
    expect(edit).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('"cân. 1055" responde com o cânon, junto com a Bíblia na mesma mensagem', async () => {
    const { msg, reply } = fakeMessage('João 3:16 e cân. 1055');
    await onMessageCreate(msg as never, ctx());
    expect(reply).toHaveBeenCalledTimes(1);
    const payload = (reply.mock.calls[0] as unknown as [{ embeds: Array<{ data: { title: string } }> }])[0];
    expect(payload.embeds.map((e) => e.data.title)).toEqual([
      'João 3,16',
      'Código de Direito Canónico, cân. 1055',
    ]);
  });

  it('sem "Inserir links" responde em texto; sem "Ler histórico" envia sem citar', async () => {
    const { PermissionFlagsBits } = await import('discord.js');
    const send = vi.fn(async () => ({}));
    const only = (...denied: bigint[]) => ({ has: (p: bigint) => !denied.includes(p) });
    const a = fakeMessage('João 3:16', {
      channel: {
        isThread: () => false,
        type: 0,
        parentId: null,
        permissionsFor: () => only(PermissionFlagsBits.EmbedLinks),
        send,
      },
    });
    await onMessageCreate(a.msg as never, ctx());
    const payload = (a.reply.mock.calls[0] as unknown as [{ content: string; embeds?: unknown }])[0];
    expect(payload.embeds).toBeUndefined();
    expect(payload.content).toContain('**João 3,16**');

    const b = fakeMessage('João 3:16', {
      channel: {
        isThread: () => false,
        type: 0,
        parentId: null,
        permissionsFor: () => only(PermissionFlagsBits.ReadMessageHistory),
        send,
      },
    });
    await onMessageCreate(b.msg as never, ctx());
    expect(b.reply).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('busca o próprio membro quando não está em cache (servidores grandes)', async () => {
    const fetchMe = vi.fn(async () => ({ id: 'bot' }));
    const { msg, reply } = fakeMessage('João 3:16', { guild: { members: { me: null, fetchMe } } });
    await onMessageCreate(msg as never, ctx());
    expect(fetchMe).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('não envia nada sem "Enviar mensagens"', async () => {
    const { PermissionFlagsBits } = await import('discord.js');
    const { msg, reply } = fakeMessage('João 3:16', {
      channel: {
        isThread: () => false,
        type: 0,
        parentId: null,
        permissionsFor: () => ({ has: (p: bigint) => p !== PermissionFlagsBits.SendMessages }),
      },
    });
    await onMessageCreate(msg as never, ctx());
    expect(reply).not.toHaveBeenCalled();
  });

  it('ignora mensagens de bots e do próprio bot', async () => {
    const c = ctx();
    const a = fakeMessage('João 3:16', { author: { id: 'other-bot', bot: true } });
    await onMessageCreate(a.msg as never, c);
    const b = fakeMessage('João 3:16', { author: { id: 'bot', bot: true } });
    await onMessageCreate(b.msg as never, c);
    expect(a.reply).not.toHaveBeenCalled();
    expect(b.reply).not.toHaveBeenCalled();
  });

  it('não responde sem permissão de envio no canal', async () => {
    const { msg, reply } = fakeMessage('João 3:16', {
      channel: {
        isThread: () => false,
        type: 0,
        parentId: null,
        permissionsFor: () => ({ has: () => false }),
      },
    });
    await onMessageCreate(msg as never, ctx());
    expect(reply).not.toHaveBeenCalled();
  });
});
