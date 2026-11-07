// A made-up Spectrum tape laid out like Adventureland's illustrated release,
// so the tests need none of the real (copyrighted) picture data.
export const CHARSET = 0xa303;
export const COUNT = 41;

/** Character 1 is solid; character 2 has only its top-left pixel set. */
export function fakeMemory() {
  const charset = new Uint8Array(0x800);
  charset.fill(0xff, 8, 16);
  charset[16] = 0x80;
  const table = new Uint8Array(COUNT * 2);
  const pictures = [];
  let address = CHARSET + 0x800 + table.length;
  for (let n = 0; n < COUNT; n++) {
    // 2x1 cells at the top left: a solid cell, then character 2 mirrored (0xc0: command, flip; char 2).
    // Colours: cell 0 red on blue (0x21), cell 1 yellow on black (0x60).
    const picture = [2, 1, 4, 0, 0x01, 0xc0, 0x02, 0x21, 0x60];
    if (n === 10) picture[4] = 0x02; // picture 10 (the forest, room 11) starts with character 2 instead
    table[2 * n] = address & 0xff;
    table[2 * n + 1] = address >> 8;
    pictures.push(...picture);
    address += picture.length;
  }
  const roomText = [...'\0dismal swamp\0'].map((c) => c.charCodeAt(0));
  return Uint8Array.from([...charset, ...table, ...pictures, ...roomText]);
}

/** Wrap a CODE block loaded at `start` as a .tap file. */
export function tap(start, body) {
  const header = new Uint8Array(19);
  header[0] = 0x00;
  header[1] = 3;
  header.set([...'fake      '].map((c) => c.charCodeAt(0)), 2);
  header[12] = body.length & 0xff;
  header[13] = body.length >> 8;
  header[14] = start & 0xff;
  header[15] = start >> 8;
  const data = Uint8Array.from([0xff, ...body, 0]);
  const block = (b) => [b.length & 0xff, b.length >> 8, ...b];
  return Uint8Array.from([...block(header), ...block(data)]);
}
