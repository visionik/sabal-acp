// Commodore 64 .d64 disk images: just enough to read the files on them.

/** The files on a 35-track .d64 disk, by name, without their 2-byte load address. */
export function readD64(data: Uint8Array): Map<string, Uint8Array> | undefined {
  if (data.length !== 174848 && data.length !== 175531) return undefined; // 35 tracks, without or with error bytes
  const sectorsIn = (track: number) => (track <= 17 ? 21 : track <= 24 ? 19 : track <= 30 ? 18 : 17);
  const offset = (track: number, sector: number) => {
    let n = 0;
    for (let t = 1; t < track; t++) n += sectorsIn(t);
    return (n + sector) * 256;
  };
  const valid = (track: number, sector: number) => track >= 1 && track <= 35 && sector < sectorsIn(track);

  const files = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let track = 18;
  let sector = 1;
  while (track && valid(track, sector) && !seen.has(`${track}/${sector}`)) {
    seen.add(`${track}/${sector}`);
    const base = offset(track, sector);
    for (let e = 0; e < 8; e++) {
      const entry = base + e * 32;
      if ((data[entry + 2]! & 7) !== 2) continue; // PRG files only
      const name = Buffer.from(data.subarray(entry + 5, entry + 21)).toString('latin1').replace(/\xa0+$/, '');
      const body = chain(data, data[entry + 3]!, data[entry + 4]!, offset, valid);
      if (body && body.length > 2) files.set(name, body.subarray(2));
    }
    track = data[base]!;
    sector = data[base + 1]!;
  }
  return files.size ? files : undefined;
}

function chain(
  data: Uint8Array,
  track: number,
  sector: number,
  offset: (t: number, s: number) => number,
  valid: (t: number, s: number) => boolean,
): Uint8Array | undefined {
  const parts: Uint8Array[] = [];
  for (let guard = 0; track; guard++) {
    if (!valid(track, sector) || guard > 700) return undefined;
    const base = offset(track, sector);
    const next = data[base]!;
    const last = data[base + 1]!;
    parts.push(data.subarray(base + 2, next ? base + 256 : base + last + 1));
    track = next;
    sector = last;
  }
  return Buffer.concat(parts);
}
