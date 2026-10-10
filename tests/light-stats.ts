// Statistiques : lumières et accessoires par type.
import { generateCity } from '../src/shared/city/gen/city';
import { PROP_KINDS, PROP_DEFS } from '../src/shared/city/props';
const city = generateCity();
const byKind = new Map<string, number>();
for (const p of city.ctx.props) {
  const k = PROP_KINDS[p.kind];
  if ((PROP_DEFS[k] as { light?: unknown }).light) byKind.set(k, (byKind.get(k) ?? 0) + 1);
}
const sorted = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
console.log('lumières par type :', sorted.slice(0, 25).map(([k, n]) => `${k}:${n}`).join('  '));
console.log('lumières directes :', city.ctx.lights.length - [...byKind.values()].reduce((a, b) => a + b, 0));
const props = new Map<string, number>();
for (const p of city.ctx.props) props.set(PROP_KINDS[p.kind], (props.get(PROP_KINDS[p.kind]) ?? 0) + 1);
console.log('accessoires :', [...props.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => `${k}:${n}`).join('  '));
