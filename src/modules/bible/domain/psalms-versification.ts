/**
 * Correspondência de NÚMEROS DE SALMO entre a numeração hebraica (usada pela
 * maioria das Bíblias modernas) e a grega/Vulgata (usada por Matos Soares e pela
 * liturgia). Mapeia apenas capítulos; a numeração de versículos pode diferir
 * (títulos contados como v. 1 etc.) e NÃO é convertida.
 *
 * Retorna null quando a correspondência não é 1:1 (salmos divididos/unidos),
 * para que o chamador explique em vez de adivinhar.
 */
export function hebrewToVulgate(psalm: number): number | null {
  if (psalm < 1 || psalm > 150) return null;
  if (psalm <= 8) return psalm;
  if (psalm === 9 || psalm === 10) return null; // H 9+10 = V 9
  if (psalm <= 113) return psalm - 1;
  if (psalm === 114 || psalm === 115) return null; // H 114+115 = V 113
  if (psalm === 116) return null; // H 116 = V 114+115
  if (psalm <= 146) return psalm - 1;
  if (psalm === 147) return null; // H 147 = V 146+147
  return psalm;
}

export function vulgateToHebrew(psalm: number): number | null {
  if (psalm < 1 || psalm > 150) return null;
  if (psalm <= 8) return psalm;
  if (psalm === 9) return null; // V 9 = H 9+10
  if (psalm <= 112) return psalm + 1;
  if (psalm === 113) return null; // V 113 = H 114+115
  if (psalm === 114 || psalm === 115) return null; // = partes de H 116
  if (psalm <= 145) return psalm + 1;
  if (psalm === 146 || psalm === 147) return null; // = partes de H 147
  return psalm;
}

export function describeVulgatePsalm(psalm: number): string {
  const special: Record<number, string> = {
    9: 'Sl 9 (Vulgata) corresponde aos Sl 9–10 na numeração hebraica.',
    113: 'Sl 113 (Vulgata) corresponde aos Sl 114–115 na numeração hebraica.',
    114: 'Sl 114 (Vulgata) corresponde a Sl 116,1-9 na numeração hebraica.',
    115: 'Sl 115 (Vulgata) corresponde a Sl 116,10-19 na numeração hebraica.',
    146: 'Sl 146 (Vulgata) corresponde a Sl 147,1-11 na numeração hebraica.',
    147: 'Sl 147 (Vulgata) corresponde a Sl 147,12-20 na numeração hebraica.',
  };
  if (special[psalm]) return special[psalm];
  const h = vulgateToHebrew(psalm);
  return h === psalm || h === null
    ? 'Numeração dos Salmos segundo a Vulgata (igual à hebraica neste salmo).'
    : `Numeração da Vulgata: Sl ${psalm} corresponde ao Sl ${h} na numeração hebraica.`;
}
