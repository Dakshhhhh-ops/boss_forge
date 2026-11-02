// Isometric line-art marks, drawn as inline SVG (original, procedural).
// Used for the wordmark and for each boss's "specimen" drawing.

const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);
type P3 = [number, number, number];
const iso = ([x, y, z]: P3) => [(x - y) * COS, (x + y) * SIN - z] as const;
const path = (points: P3[], close = true) => points.map((p, i) => `${i ? 'L' : 'M'}${iso(p).map((v) => v.toFixed(2)).join(' ')}`).join('') + (close ? 'Z' : '');

/** An extruded polygon (prism): top face, bottom face and vertical edges. */
function prism(sides: number, radius: number, height: number, twist = 0) {
  const ring = (z: number): P3[] => Array.from({ length: sides }, (_, i) => {
    const a = twist + i * Math.PI * 2 / sides; return [Math.cos(a) * radius, Math.sin(a) * radius, z];
  });
  const top = ring(height), bottom = ring(0);
  const edges = top.map((p, i) => path([bottom[i]!, p], false)).join('');
  return { top: path(top), bottom: path(bottom), edges };
}

/** The Boss Forge mark: an isometric anvil block with a notch. */
export function forgeMarkSvg(stroke = 'currentColor') {
  const body = prism(4, 9, 7, Math.PI / 4), cap = prism(4, 5.5, 4, Math.PI / 4);
  return `<svg viewBox="-16 -18 32 32" fill="none" stroke="${stroke}" stroke-width="1.1" stroke-linejoin="round" aria-hidden="true">
<path d="${body.bottom}" opacity=".35"/><path d="${body.edges}"/><path d="${body.top}"/>
<g transform="translate(0 -7)"><path d="${cap.edges}"/><path d="${cap.top}" fill="${stroke}" fill-opacity=".14"/></g></svg>`;
}

/** A boss specimen: prism whose side count, height and twist come from the boss shape. */
export function specimenSvg(shape: string, color: string, size = 64) {
  const sides = ({ eye: 12, skull: 6, crystal: 3, blob: 9, mech: 4, serpent: 8 } as Record<string, number>)[shape] ?? 5;
  const body = prism(sides, 14, 12, Math.PI / sides), crown = prism(sides, 8, 7, 0);
  return `<svg viewBox="-24 -30 48 48" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1" stroke-linejoin="round" aria-hidden="true">
<path d="${body.bottom}" stroke-dasharray="2 2" opacity=".5"/><path d="${body.edges}"/><path d="${body.top}"/>
<g transform="translate(0 -12)"><path d="${crown.edges}" opacity=".8"/><path d="${crown.top}" fill="${color}" fill-opacity=".12"/></g></svg>`;
}
