/**
 * Conteúdo do /help. Texto puro (sem discord.js) para ser testado contra os limites do
 * Discord e contra a lista real de comandos. Ao mudar um comando, atualize aqui.
 */

export interface HelpField {
  name: string;
  value: string;
}

export interface HelpCategory {
  id: string;
  label: string;
  emoji: string;
  /** Uma linha para a página inicial. */
  summary: string;
  intro: string;
  fields: HelpField[];
  /** Comandos documentados nesta categoria (verificado nos testes). */
  commands: string[];
}

const ADMIN = '🔒 requer **Gerenciar Servidor**';

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'biblia',
    label: 'Bíblia',
    emoji: '📖',
    summary: 'Referências automáticas, passagens, busca e Salmos (Matos Soares).',
    intro:
      'Tradução do **Pe. Manuel de Matos Soares**. O texto vem só da edição importada no bot: ' +
      'versículos que não existem na fonte são indicados, nunca inventados.',
    commands: ['biblia'],
    fields: [
      {
        name: '💬 Referências automáticas (em qualquer mensagem)',
        value: [
          'Escreva a referência numa mensagem normal e o bot responde com o texto:',
          '• `João 3,16` ou `João 3:16` — um versículo',
          '• `1 Cor 13,4-7` — vários versículos seguidos do mesmo capítulo',
          '• `Jo 3,16-4,2` — intervalo que atravessa capítulos',
          '• Abreviações e numerais: `Jo`, `Mt`, `Gn`, `1Cor`, `1ª Cor`, `I Cor`…',
          'Regras: o versículo é obrigatório (`João 3` sozinho não responde); até **3 referências** por mensagem ' +
            'e até **20 versículos** por referência; texto entre crases (`código`) é ignorado; respeita o cooldown ' +
            'e os canais definidos pelos admins.',
        ].join('\n'),
      },
      {
        name: '⚠️ Ainda não suportado',
        value:
          'Versículos salteados (`Mt 5,3-5.9`, `Jo 3,16.18`): só a primeira parte é lida. ' +
          'Escreva cada parte separada, ex.: `Jo 3,16` e `Jo 3,18`.',
      },
      {
        name: '🎶 Salmos',
        value:
          'A edição usa a **numeração da Vulgata** (litúrgica): “O Senhor é meu pastor” é o **Sl 22** ' +
          '(23 nas Bíblias modernas). Os admins podem mudar para a numeração hebraica; a conversão só é feita ' +
          'quando corresponde a um único salmo — caso contrário o bot pede o número da Vulgata.',
      },
      {
        name: '`/biblia passagem referencia:`',
        value:
          'Mostra uma passagem: `João 3,16-18`, `Sl 22` (capítulo inteiro também vale aqui). ' +
          'Até **60 versículos**; passagens longas são divididas em várias mensagens.',
      },
      {
        name: '`/biblia buscar texto:`',
        value:
          'Procura um **trecho exato** (mín. 3 letras), sem diferenciar acentos nem maiúsculas. ' +
          'Mostra os 10 primeiros versículos encontrados.',
      },
      {
        name: '`/biblia livro nome:` · `/biblia aleatorio`',
        value:
          '`livro`: testamento, abreviação, número de capítulos e se é deuterocanônico (com sugestões ao digitar). ' +
          '`aleatorio`: um versículo ao acaso.',
      },
      {
        name: '`/biblia configuracao` — ' + ADMIN,
        value: [
          '• `automatico` — liga/desliga as respostas automáticas (também as do Catecismo/Código)',
          '• `max_referencias` (1–5) e `cooldown` (0–600 s por canal)',
          '• `numeracao_salmos` — Vulgata ou hebraica',
          '• `canal` + `acao_canal` — **Permitir** (responde só nos permitidos), **Excluir** (nunca responde ali) ' +
            'ou **Remover** das listas; aceita categorias',
          '• `citacoes` — reconhecer trechos colados sem referência (beta; precisa estar ativado no bot)',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'catecismo',
    label: 'Catecismo e Código',
    emoji: '✝️',
    summary: 'Catecismo da Igreja Católica e Código de Direito Canônico, por número ou busca.',
    intro:
      'Textos oficiais: **Catecismo** (versão portuguesa da Santa Sé, vatican.va, §1–2865) e **Código de Direito ' +
      'Canônico** (versão portuguesa atualizada da Conferência Episcopal Portuguesa, 2025, cân. 1–1752). ' +
      'Cada resposta indica a edição, os direitos de autor e um link para a página oficial.',
    commands: ['catecismo', 'direito-canonico'],
    fields: [
      {
        name: '💬 Referências automáticas',
        value: [
          '**Catecismo** — `CCC 1234`, `CIC 27-30`, `Catecismo 2558`, `catecismo n.º 2558`, `CCC §1822`',
          '**Código** — `CDC 1055`, `cân. 1055`, `cânon 212`, `cânones 1055-1057`, `can. 5` (com ponto)',
          '⚠️ Em português **CIC = Catecismo**; para o Código use **CDC** ou **cân.**',
          'Intervalos: até **5** parágrafos/cânones (um pedido maior mostra os 5 primeiros e avisa). ' +
            'Seguem as mesmas regras da Bíblia: canais, cooldown e máximo de referências por mensagem.',
        ].join('\n'),
      },
      {
        name: '`/catecismo paragrafo numero: [ate:]`',
        value:
          'Mostra um parágrafo (1–2865) ou um intervalo de até 5 (`numero:27 ate:30`), com a secção onde aparece.',
      },
      {
        name: '`/direito-canonico canone numero: [ate:]`',
        value:
          'Mostra um cânon (1–1752) ou até 5 seguidos, com Livro/Parte/Título/Capítulo. ' +
          'O link abre o PDF oficial na página do cânon.',
      },
      {
        name: '`/catecismo buscar texto:` · `/direito-canonico buscar texto:`',
        value:
          'Todas as palavras têm de aparecer no mesmo parágrafo/cânon (em qualquer ordem), sem diferenciar ' +
          'acentos. Mostra os 10 primeiros com um trecho de cada.',
      },
      {
        name: 'ℹ️ Observações',
        value:
          'As notas de rodapé do Catecismo não são incluídas. O texto do Código segue a ortografia de Portugal ' +
          '(“Canónico”, “ato”). Se aparecer “ainda não foi importado”, o administrador do bot precisa executar a importação.',
      },
    ],
  },
  {
    id: 'liturgia',
    label: 'Liturgia e Calendário',
    emoji: '⛪',
    summary: 'Liturgia diária da Missa, leituras, orações, calendário litúrgico e santos.',
    intro:
      'As leituras e orações vêm do serviço **Liturgia Diária (Dancrf)** e são identificadas como tal; os santos ' +
      'vêm do **Calendário Romano (LitCal)**. “Hoje” é sempre calculado no **fuso do servidor**. ' +
      'Datas no formato **DD/MM/AAAA**.',
    commands: ['liturgia', 'calendario'],
    fields: [
      {
        name: '`/liturgia hoje` · `amanha` · `data dia:`',
        value:
          'Resumo do dia: celebração, cor litúrgica, tempo e referências das leituras ' +
          '(e outras celebrações possíveis, quando houver).',
      },
      {
        name: '`/liturgia leituras [dia:]`',
        value:
          'Texto completo de **todas** as leituras do dia (1.ª leitura, salmo, 2.ª leitura quando houver, ' +
          'Evangelho), em várias mensagens. Se for longo demais, o bot avisa e indica `/liturgia evangelho`.',
      },
      {
        name: '`/liturgia evangelho [dia:]` · `/liturgia oracoes [dia:]`',
        value: '`evangelho`: só o Evangelho. `oracoes`: coleta, orações e antífonas da Missa.',
      },
      {
        name: '`/calendario hoje` · `amanha` · `data dia:`',
        value:
          'Tempo litúrgico, semana e ciclos (domingos A/B/C, dias de semana I/II) calculados pelo bot, ' +
          'junto da celebração indicada pelo provedor.',
      },
      {
        name: '`/calendario semana [inicio:]` · `/calendario mes [mes:MM/AAAA]`',
        value: 'Os sete dias a partir de uma data, ou o resumo de um mês.',
      },
      {
        name: '`/calendario santos [dia:]`',
        value:
          'Santos e celebrações do dia no Calendário Romano (LitCal). O LitCal **não tem português** nem calendário ' +
          'do Brasil/Portugal: os nomes aparecem no idioma e calendário configurados (latim por padrão), sempre indicados.',
      },
      {
        name: '`/liturgia configuracao` — ' + ADMIN,
        value:
          '`ativada` (liga/desliga a liturgia), `versao_api` (v2 estável / v3 beta), `calendario_romano` ' +
          '(Geral, Canadá, Croácia, Itália, Países Baixos, EUA) e `idioma_calendario` (latim, inglês, italiano, francês, neerlandês).',
      },
    ],
  },
  {
    id: 'agendar',
    label: 'Agendamentos',
    emoji: '⏰',
    summary: 'Mensagens agendadas e recorrentes, liturgia diária e Angelus num canal.',
    intro:
      `Todos os subcomandos de \`/agendar\` exigem permissão (${ADMIN}). Antes de ativar, o bot mostra uma ` +
      '**prévia** — nada é agendado até clicar em **Ativar**. O bot precisa de **Ver canal**, **Enviar mensagens** ' +
      'e **Inserir links** no canal de destino.',
    commands: ['agendar'],
    fields: [
      {
        name: '`/agendar criar canal: mensagem: data: hora: [recorrencia:] [fuso:] [titulo:] [mencionar_cargo:]`',
        value: [
          '• `data` DD/MM/AAAA (primeira vez) e `hora` HH:MM (24h); `\\n` na mensagem quebra a linha',
          '• `recorrencia`: uma vez, diária, semanal, mensal ou anual',
          '• Mensal no dia 31 → último dia nos meses mais curtos; anual em 29/02 → 28/02 nos anos comuns',
          '• Horário de verão: hora que não existe passa para depois do salto; hora repetida usa a primeira',
          '• `titulo` envia como embed; `mencionar_cargo` menciona um cargo (**@everyone nunca**)',
        ].join('\n'),
      },
      {
        name: '`/agendar liturgia canal: hora: [leituras:] [santos:] [memorias_facultativas:] [vespera:] [fuso:]`',
        value:
          'Post diário com a liturgia **da data real do envio**. `leituras`: todas (texto completo), só o Evangelho, ' +
          'só as referências ou nenhuma. `santos` e `memorias_facultativas` vêm do Calendário Romano. ' +
          '`vespera:true` publica a liturgia do dia **seguinte** (ex.: às 20:00).',
      },
      {
        name: '`/agendar angelus canal: [horarios:] [fuso:]`',
        value:
          'Post diário curto com a oração em latim e português. Horários: 00h, 6h, 12h e 18h (padrão), ' +
          '6h/12h/18h (tradicional) ou só 12h. No Tempo Pascal publica o **Regina Caeli**.',
      },
      {
        name: '`/agendar listar` · `ver id:` · `editar id:` · `pausar id:` · `retomar id:` · `cancelar id:`',
        value:
          '`ver` mostra detalhes e as últimas entregas; `editar` muda texto, data, hora, recorrência, canal, fuso ' +
          'ou as opções da liturgia; `retomar` também reativa um agendamento suspenso por erro (ex.: o bot perdeu ' +
          'acesso ao canal — o aviso vai para o canal de logs). O campo `id` sugere os agendamentos ao digitar.',
      },
      {
        name: 'ℹ️ Entrega',
        value:
          'Cada ocorrência é enviada **uma única vez**, mesmo que o bot reinicie. Se o bot estiver fora do ar, ' +
          'ocorrências perdidas são enviadas com atraso até **6 horas**; depois disso são puladas.',
      },
    ],
  },
  {
    id: 'moderacao',
    label: 'Moderação',
    emoji: '🛡️',
    summary: 'Silenciar, expulsar, banir, apagar mensagens e registros.',
    intro:
      'Os comandos verificam as permissões **no servidor do bot**, não só no Discord, e respeitam a hierarquia: ' +
      'ninguém age sobre quem tem cargo igual ou superior ao seu (ou ao do bot), nem sobre o dono do servidor. ' +
      'Os motivos ficam registrados e as ações aparecem no canal de logs.',
    commands: [
      'mute',
      'unmute',
      'mute-status',
      'kick',
      'ban',
      'unban',
      'purge',
      'modlogs',
      'configurar-silenciado',
    ],
    fields: [
      {
        name: '`/mute usuario: duracao: [motivo:]` — requer **Moderar Membros**',
        value: [
          'Unidades: `s`, `min`, `h`, `d`, `sem`, `mo` (mês), `y` (ano) — ou por extenso (`2 horas`, `3 meses`). ' +
            'Combinações: `1d12h`. `m` sozinho não é aceito (minutos ou meses?). Máximo: 10 anos.',
          '• Até **28 dias**: castigo nativo do Discord.',
          '• Mais de 28 dias: usa o **cargo de silenciado** (configure antes com `/configurar-silenciado`); ' +
            'não funciona em administradores.',
          'Meses e anos seguem o calendário real no fuso do servidor (não 30/365 dias). O silenciamento continua ' +
            'mesmo que o bot reinicie, e é reaplicado se o membro sair e voltar.',
        ].join('\n'),
      },
      {
        name: '`/unmute usuario: [motivo:]` · `/mute-status usuario:`',
        value:
          '`unmute` remove o silenciamento. `mute-status` mostra a situação atual e o histórico recente.',
      },
      {
        name: '`/kick usuario: [motivo:]` · `/ban usuario: [motivo:] [apagar_dias:]` · `/unban usuario: [motivo:]`',
        value:
          '`kick` requer **Expulsar Membros**; `ban`/`unban` requerem **Banir Membros**. `apagar_dias` (0–7) apaga ' +
          'as mensagens recentes do banido. `unban` recebe o **ID** do usuário.',
      },
      {
        name: '`/purge quantidade: [usuario:]` — requer **Gerenciar Mensagens**',
        value:
          'Apaga de 1 a 100 mensagens deste canal (o Discord só permite apagar em massa mensagens com menos de ' +
          '14 dias). Com `usuario`, apaga só as dele.',
      },
      {
        name: '`/modlogs canal:` · `/configurar-silenciado [cargo:]` — ' + ADMIN,
        value:
          '`modlogs` define o canal privado de registros. `configurar-silenciado` usa um cargo existente ou cria ' +
          '“Silenciado” e bloqueia o envio de mensagens nos canais.',
      },
    ],
  },
  {
    id: 'config',
    label: 'Configuração',
    emoji: '⚙️',
    summary: 'Fuso horário, idioma e onde configurar cada função.',
    intro: `Configurações gerais do servidor (${ADMIN}).`,
    commands: ['config', 'help'],
    fields: [
      {
        name: '`/config ver` · `/config fuso fuso:` · `/config idioma idioma:`',
        value:
          '`fuso` (IANA, ex.: `America/Sao_Paulo`, `Europe/Lisbon`) define o “hoje” da liturgia, os agendamentos ' +
          'e os silenciamentos por mês/ano. `idioma`: português do Brasil ou europeu. `ver` mostra tudo.',
      },
      {
        name: 'Outras configurações',
        value: [
          '• Respostas automáticas (Bíblia, Catecismo, Código): `/biblia configuracao`',
          '• Liturgia e calendário dos santos: `/liturgia configuracao`',
          '• Canal de logs de moderação: `/modlogs` · cargo de silenciado: `/configurar-silenciado`',
        ].join('\n'),
      },
      {
        name: 'Permissões do bot',
        value:
          'Para responder: **Ver canal**, **Enviar mensagens**, **Inserir links** (e **Enviar mensagens em tópicos** ' +
          'nos tópicos). Para moderar: **Moderar Membros**, **Expulsar**, **Banir**, **Gerenciar Mensagens** e ' +
          '**Gerenciar Cargos**, com o cargo do bot acima dos cargos que ele vai gerir.',
      },
      {
        name: 'Comandos não aparecem?',
        value:
          'Comandos novos podem levar alguns minutos para aparecer. Pressione **Ctrl+R** (ou reabra o app).',
      },
    ],
  },
];

export function findCategory(id: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.id === id);
}
