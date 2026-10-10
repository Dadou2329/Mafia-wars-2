// Petite grammaire française pour les noms de lieux et de gangs insérés dans les phrases :
// contraction des articles (« du Chat Noir », « aux Docks », « de l’Ancre Bleue ») et
// article des noms communs (« la Chapellerie Lock & Fils », « l’Entrepôt Morgan »).

type Art = 'le' | 'la' | 'les' | 'l’' | '';

/** Article des noms qui commencent par un nom commun. */
const COMMON: Record<string, Art> = {
  Atelier: 'l’',
  Banque: 'la',
  Bijouterie: 'la',
  Boucherie: 'la',
  Boulangerie: 'la',
  Brasserie: 'la',
  Café: 'le',
  Chantier: 'le',
  Chapellerie: 'la',
  Club: 'le',
  Compagnie: 'la',
  Cour: 'la',
  Douanes: 'les',
  Entrepôt: 'l’',
  Filature: 'la',
  Fonderie: 'la',
  Garni: 'le',
  Hôtel: 'l’',
  Jardin: 'le',
  Jardins: 'les',
  Logements: 'les',
  Manoir: 'le',
  Marché: 'le',
  'Music-hall': 'le',
  Place: 'la',
  Prêteur: 'le',
  Quartier: 'le',
  Taudis: 'le',
  Tour: 'la',
  Usine: 'l’',
};

function split(name: string): { art: Art; rest: string } {
  const m = /^(Le|La|Les) (.+)$/.exec(name);
  if (m) return { art: m[1].toLowerCase() as Art, rest: m[2] };
  const e = /^L[’'](.+)$/.exec(name);
  if (e) return { art: 'l’', rest: e[1] };
  const first = name.split(' ')[0];
  return { art: COMMON[first] ?? '', rest: name };
}

const VOWEL = /^[AEIOUYÉÈÊÂÎÔÛaeiouyéèêâîôû]/;

/** « le Chat Noir », « la City », « les Docks », « l’Ancre Bleue », « Soho ». */
export function leNom(name: string): string {
  const { art, rest } = split(name);
  if (!art) return rest;
  return art === 'l’' ? `l’${rest}` : `${art} ${rest}`;
}

/** « du Chat Noir », « de la City », « des Docks », « de l’Ancre Bleue », « de Soho », « d’Ashford ». */
export function deNom(name: string): string {
  const { art, rest } = split(name);
  switch (art) {
    case 'le':
      return `du ${rest}`;
    case 'les':
      return `des ${rest}`;
    case 'la':
      return `de la ${rest}`;
    case 'l’':
      return `de l’${rest}`;
    default:
      return VOWEL.test(rest) ? `d’${rest}` : `de ${rest}`;
  }
}

/** « au Chat Noir », « à la City », « aux Docks », « à l’Ancre Bleue », « à Soho ». */
export function aNom(name: string): string {
  const { art, rest } = split(name);
  switch (art) {
    case 'le':
      return `au ${rest}`;
    case 'les':
      return `aux ${rest}`;
    case 'la':
      return `à la ${rest}`;
    case 'l’':
      return `à l’${rest}`;
    default:
      return `à ${rest}`;
  }
}

/** Le nom est-il au pluriel (« les Docks ») ? */
export function pluriel(name: string): boolean {
  return split(name).art === 'les';
}

/** Majuscule initiale (début de phrase). */
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
