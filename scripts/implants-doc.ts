// Génère docs/IMPLANTS.md à partir du catalogue (src/shared/implants.ts).
// Usage : npx tsx scripts/implants-doc.ts
import fs from 'node:fs';
import { CAT_LABEL, IMPLANTS, QUALITY, SLOTS, qualityOf, type ImplantDef } from '../src/shared/implants';
import { formatMoney } from '../src/shared/util';

const KIND: Record<ImplantDef['kind'], string> = { passive: 'Passif', active: 'Actif', toggle: 'Mode', arme: 'Arme de bras' };
const TRIGGER: Record<ImplantDef['trigger'], string> = {
  bras: 'Touche du bras où il est installé (F à gauche, X à droite)',
  esquive: 'Touche d’esquive (Z)',
  capacite: 'Touche de capacité (T, Y, H, J, U dans l’ordre des emplacements)',
  vision: 'Touche de vision (N)',
  saut: 'En sautant (en l’air ou contre un mur)',
  accroupi: 'Maintenir accroupi (C), puis sauter',
  auto: 'Automatique',
};

const lines: string[] = [];
lines.push('# Implants cybernétiques — catalogue');
lines.push('');
lines.push(`Généré depuis \`src/shared/implants.ts\` (${IMPLANTS.length} implants, ${SLOTS.length} emplacements). Les niveaux portent le nom de leur gamme : ${QUALITY.join(', ')}.`);
lines.push('');
lines.push('Emplacements : ' + SLOTS.map((s) => s.label).join(', ') + '.');
lines.push('');
for (const cat of Object.keys(CAT_LABEL) as (keyof typeof CAT_LABEL)[]) {
  const list = IMPLANTS.filter((d) => d.cat === cat);
  lines.push(`## ${CAT_LABEL[cat]} (${list.length})`);
  lines.push('');
  for (const d of list) {
    lines.push(`### ${d.name}`);
    lines.push('');
    lines.push(`${d.summary}`);
    lines.push('');
    lines.push(`- Type : ${KIND[d.kind]} — commande : ${TRIGGER[d.trigger]}`);
    lines.push('');
    lines.push('| Niveau | Gamme | Prix | Effet |');
    lines.push('| --- | --- | --- | --- |');
    d.levels.forEach((l, i) => lines.push(`| ${i + 1} | ${qualityOf(d, i + 1)} | ${formatMoney(l.price)} | ${l.desc} |`));
    lines.push('');
  }
}
fs.writeFileSync(new URL('../docs/IMPLANTS.md', import.meta.url), lines.join('\n'));
console.log(`docs/IMPLANTS.md : ${IMPLANTS.length} implants`);
