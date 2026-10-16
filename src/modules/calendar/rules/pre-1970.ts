/**
 * O calendário e o Lecionário atuais (forma ordinária) vigoram desde 1970. Datas anteriores
 * seguem o calendário tradicional, ainda não implementado (provedor separado, ver
 * docs/calendar-roadmap.md); nunca se aplicam as regras atuais a elas.
 */
export const ORDINARY_FORM_START_YEAR = 1970;

export const PRE_1970_MESSAGE =
  'O calendário litúrgico mudou em 1970 (reforma litúrgica pós-Concílio Vaticano II). As datas anteriores seguem o ' +
  '**calendário tradicional**, que estamos trabalhando para implementar. Por enquanto, o bot cobre de 1970 em diante.';

export function isBefore1970(isoDate: string): boolean {
  return Number(isoDate.slice(0, 4)) < ORDINARY_FORM_START_YEAR;
}
