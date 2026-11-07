// ZX Spectrum tape and snapshot files, loaded into a 64K memory image.
//
// Only what SAGA games need: standard-speed .tap and .tzx blocks (the CODE
// blocks land at their header's load address) and 48K .sna snapshots.

export type Memory = Uint8Array;

/** Load a file into Spectrum memory, or undefined if it isn't a format we read. */
export function loadSpectrum(name: string, data: Uint8Array): Memory | undefined {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'sna') return loadSna(data);
  if (ext === 'tap') return loadBlocks(tapBlocks(data));
  if (ext === 'tzx') return loadBlocks(tzxBlocks(data));
  return undefined;
}

function loadSna(data: Uint8Array): Memory | undefined {
  // A 48K snapshot is a 27-byte register header and RAM from 0x4000.
  if (data.length !== 27 + 0xc000) return undefined;
  const mem = new Uint8Array(0x10000);
  mem.set(data.subarray(27), 0x4000);
  return mem;
}

/** Place each CODE block (header type 3) at its load address. */
function loadBlocks(blocks: Uint8Array[] | undefined): Memory | undefined {
  if (!blocks) return undefined;
  const mem = new Uint8Array(0x10000);
  let loaded = false;
  let pending: { type: number; start: number } | undefined;
  for (const block of blocks) {
    if (block.length === 19 && block[0] === 0x00) {
      pending = { type: block[1]!, start: block[14]! | (block[15]! << 8) };
      continue;
    }
    if (pending?.type === 3 && block[0] === 0xff) {
      const body = block.subarray(1, block.length - 1); // drop the flag and checksum bytes
      mem.set(body.subarray(0, 0x10000 - pending.start), pending.start);
      loaded = true;
    }
    pending = undefined;
  }
  return loaded ? mem : undefined;
}

function tapBlocks(data: Uint8Array): Uint8Array[] | undefined {
  const blocks: Uint8Array[] = [];
  for (let i = 0; i + 2 <= data.length; ) {
    const len = data[i]! | (data[i + 1]! << 8);
    if (i + 2 + len > data.length) return undefined;
    blocks.push(data.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return blocks;
}

function tzxBlocks(data: Uint8Array): Uint8Array[] | undefined {
  const sig = 'ZXTape!\x1a';
  for (let k = 0; k < sig.length; k++) if (data[k] !== sig.charCodeAt(k)) return undefined;
  const u16 = (i: number) => data[i]! | (data[i + 1]! << 8);
  const u24 = (i: number) => u16(i) | (data[i + 2]! << 16);
  const u32 = (i: number) => (u16(i) | (u16(i + 2) << 16)) >>> 0;
  const blocks: Uint8Array[] = [];
  let i = 10;
  while (i < data.length) {
    const id = data[i++]!;
    switch (id) {
      case 0x10: { // standard speed data
        const len = u16(i + 2);
        blocks.push(data.subarray(i + 4, i + 4 + len));
        i += 4 + len;
        break;
      }
      case 0x11: { // turbo speed data: same bytes, different timing
        const len = u24(i + 15);
        blocks.push(data.subarray(i + 18, i + 18 + len));
        i += 18 + len;
        break;
      }
      case 0x14: { // pure data
        const len = u24(i + 7);
        blocks.push(data.subarray(i + 10, i + 10 + len));
        i += 10 + len;
        break;
      }
      case 0x12: i += 4; break;
      case 0x13: i += 1 + data[i]! * 2; break;
      case 0x15: i += 8 + u24(i + 5); break;
      case 0x18: case 0x19: i += 4 + u32(i); break;
      case 0x20: case 0x23: case 0x24: i += 2; break;
      case 0x21: case 0x30: i += 1 + data[i]!; break;
      case 0x22: case 0x25: case 0x27: break;
      case 0x26: i += 2 + u16(i) * 2; break;
      case 0x28: case 0x32: i += 2 + u16(i); break;
      case 0x2a: i += 4; break;
      case 0x2b: i += 5; break;
      case 0x31: i += 2 + data[i + 1]!; break;
      case 0x33: i += 1 + data[i]! * 3; break;
      case 0x35: i += 20 + u32(i + 16); break;
      case 0x5a: i += 9; break;
      default: return blocks.length ? blocks : undefined; // unknown block: keep what we have
    }
  }
  return blocks;
}
