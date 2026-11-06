// Tiny invented database text for tests (adapted from SABAL's test/fixture.mjs).
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
export function row(verb = 7, noun = 0, codes = [], conditions = []) {
  const a = [...codes, 0, 0, 0, 0];
  return [verb * 150 + noun, ...[...conditions, 0, 0, 0, 0, 0].slice(0, 5), a[0] * 150 + a[1], a[2] * 150 + a[3]];
}
export function source({ rows = [row()] } = {}) {
  const items = Array.from({ length: 10 }, (_, i) => [i === 0 ? 'void' : i === 9 ? 'lamp/LAMP/' : `item${i}`, 0]);
  const verbs = Array.from({ length: 21 }, (_, i) => `V${i}`);
  Object.assign(verbs, { 1: 'GO', 2: 'LOOK', 3: 'INVENTORY', 4: 'SCORE', 5: 'SAVE', 6: 'WAIT', 7: 'DO', 9: 'QUIT', 10: 'GET', 18: 'DROP' });
  const nouns = Array.from({ length: 21 }, (_, i) => `Z${i}`);
  Object.assign(nouns, { 1: 'NORTH', 2: 'SOUTH', 3: 'EAST', 4: 'WEST', 5: 'UP', 6: 'DOWN', 7: 'GAME' });
  const rooms = [[0, 0, 0, 0, 0, 0, '*storage'], [0, 0, 0, 0, 0, 0, 'quiet alcove'], [0, 0, 0, 0, 0, 0, '*cavern']];
  const messages = Array.from({ length: 61 }, (_, i) => `message${i}`);
  const header = [0, items.length - 1, rows.length - 1, 20, rooms.length - 1, 5, 1, 5, 3, 100, messages.length - 1, 2];
  return [...header, ...rows.flat(), ...verbs.flatMap((v, i) => [quote(v), quote(nouns[i])]), ...rooms.flatMap((r) => [...r.slice(0, 6), quote(r[6])]),
    ...messages.map(quote), ...items.flatMap(([s, n]) => [quote(s), n]), ...rows.map(() => quote('')), 416, 1, 0].join('\n');
}
