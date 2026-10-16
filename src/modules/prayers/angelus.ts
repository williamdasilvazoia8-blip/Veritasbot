import type { APIEmbed } from 'discord.js';
import { formatLongDate } from '../../shared/dates.js';
import { movableDates } from '../calendar/rules/general-roman-calendar.js';

/**
 * Angelus e, no Tempo Pascal, Regina Caeli — textos tradicionais em latim e português.
 * A Ave Maria vai abreviada para poupar espaço.
 */

const AVE = '*Ave Maria…*';

export const ANGELUS = {
  title: 'Angelus',
  latin: [
    '℣. Angelus Domini nuntiavit Mariae.',
    '℟. Et concepit de Spiritu Sancto.',
    AVE,
    '℣. Ecce ancilla Domini.',
    '℟. Fiat mihi secundum verbum tuum.',
    AVE,
    '℣. Et Verbum caro factum est.',
    '℟. Et habitavit in nobis.',
    AVE,
    '℣. Ora pro nobis, sancta Dei Genetrix.',
    '℟. Ut digni efficiamur promissionibus Christi.',
  ].join('\n'),
  portuguese: [
    '℣. O Anjo do Senhor anunciou a Maria.',
    '℟. E ela concebeu do Espírito Santo.',
    AVE,
    '℣. Eis aqui a serva do Senhor.',
    '℟. Faça-se em mim segundo a vossa palavra.',
    AVE,
    '℣. E o Verbo se fez carne.',
    '℟. E habitou entre nós.',
    AVE,
    '℣. Rogai por nós, Santa Mãe de Deus.',
    '℟. Para que sejamos dignos das promessas de Cristo.',
  ].join('\n'),
  latinPrayer:
    'Gratiam tuam, quaesumus, Domine, mentibus nostris infunde; ut qui, Angelo nuntiante, Christi Filii tui incarnationem cognovimus, per passionem eius et crucem ad resurrectionis gloriam perducamur. Per eundem Christum Dominum nostrum. Amen.',
  portuguesePrayer:
    'Infundi, Senhor, como vos pedimos, a vossa graça em nossas almas, para que nós, que pela anunciação do Anjo conhecemos a encarnação de Cristo, vosso Filho, por sua paixão e cruz sejamos conduzidos à glória da ressurreição. Pelo mesmo Cristo, Senhor nosso. Amém.',
} as const;

export const REGINA_CAELI = {
  title: 'Regina Caeli',
  latin: [
    'Regina caeli, laetare, alleluia.',
    'Quia quem meruisti portare, alleluia.',
    'Resurrexit, sicut dixit, alleluia.',
    'Ora pro nobis Deum, alleluia.',
    '℣. Gaude et laetare, Virgo Maria, alleluia.',
    '℟. Quia surrexit Dominus vere, alleluia.',
  ].join('\n'),
  portuguese: [
    'Rainha do céu, alegrai-vos, aleluia.',
    'Porque quem merecestes trazer em vosso seio, aleluia.',
    'Ressuscitou como disse, aleluia.',
    'Rogai a Deus por nós, aleluia.',
    '℣. Exultai e alegrai-vos, ó Virgem Maria, aleluia.',
    '℟. Porque o Senhor ressuscitou verdadeiramente, aleluia.',
  ].join('\n'),
  latinPrayer:
    'Deus, qui per resurrectionem Filii tui, Domini nostri Iesu Christi, mundum laetificare dignatus es: praesta, quaesumus; ut per eius Genetricem Virginem Mariam, perpetuae capiamus gaudia vitae. Per eundem Christum Dominum nostrum. Amen.',
  portuguesePrayer:
    'Ó Deus, que vos dignastes alegrar o mundo com a ressurreição do vosso Filho, Nosso Senhor Jesus Cristo, concedei-nos, vos suplicamos, que, por sua Mãe, a Virgem Maria, alcancemos as alegrias da vida eterna. Pelo mesmo Cristo, Senhor nosso. Amém.',
} as const;

/** Tempo Pascal para esta oração: do Domingo de Páscoa ao Domingo de Pentecostes, inclusive. */
export function isEasterTide(isoDate: string): boolean {
  const m = movableDates(Number(isoDate.slice(0, 4)));
  return isoDate >= m.easter.toISODate()! && isoDate <= m.pentecost.toISODate()!;
}

export function hourLabel(hhmm: string): string {
  const [h, min] = hhmm.split(':').map(Number) as [number, number];
  const hour = h === 0 ? '00' : String(h);
  return min ? `${hour}h${String(min).padStart(2, '0')}` : `${hour}h`;
}

/** Post do Angelus (ou Regina Caeli no Tempo Pascal) para a data e hora locais da ocorrência. */
export function angelusEmbed(isoDate: string, hhmm: string): APIEmbed {
  const prayer = isEasterTide(isoDate) ? REGINA_CAELI : ANGELUS;
  return {
    title: prayer.title,
    description: `🔔 ${hourLabel(hhmm)} · ${formatLongDate(isoDate)}`,
    color: 0x8b6f3a,
    fields: [
      { name: 'Latim', value: prayer.latin, inline: true },
      { name: 'Português', value: prayer.portuguese, inline: true },
      { name: 'Oremus', value: prayer.latinPrayer },
      { name: 'Oremos', value: prayer.portuguesePrayer },
    ],
    footer: {
      text:
        prayer === ANGELUS
          ? 'Oração tradicional da Igreja · no Tempo Pascal, Regina Caeli'
          : 'Oração tradicional do Tempo Pascal, no lugar do Angelus',
    },
  };
}

export const ANGELUS_HOUR_SETS = {
  all: ['00:00', '06:00', '12:00', '18:00'],
  traditional: ['06:00', '12:00', '18:00'],
  noon: ['12:00'],
} as const;
