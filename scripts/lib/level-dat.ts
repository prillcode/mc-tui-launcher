/**
 * Minimal raw-NBT `level.dat` writer for the headless verification and
 * screenshot harnesses. `readLevelDat` accepts raw (non-gzipped) NBT, so
 * no zlib or fixture files are needed to make a tiny, valid world.
 */
export type NbtTag =
  | ["byte", number]
  | ["int", number]
  | ["long", number]
  | ["string", string]
  | ["compound", Array<[string, NbtTag]>]

const NBT_TYPE: Record<NbtTag[0], number> = { byte: 1, int: 3, long: 4, string: 8, compound: 10 }

function nbtPayload(out: Buffer[], tag: NbtTag): void {
  switch (tag[0]) {
    case "byte":
      out.push(Buffer.from([tag[1] & 0xff]))
      break
    case "int": {
      const b = Buffer.alloc(4)
      b.writeInt32BE(tag[1])
      out.push(b)
      break
    }
    case "long": {
      const b = Buffer.alloc(8)
      b.writeBigInt64BE(BigInt(tag[1]))
      out.push(b)
      break
    }
    case "string": {
      const s = Buffer.from(tag[1], "utf8")
      const l = Buffer.alloc(2)
      l.writeUInt16BE(s.length)
      out.push(l, s)
      break
    }
    case "compound": {
      for (const [name, child] of tag[1]) {
        out.push(Buffer.from([NBT_TYPE[child[0]]]))
        const n = Buffer.from(name, "utf8")
        const l = Buffer.alloc(2)
        l.writeUInt16BE(n.length)
        out.push(l, n)
        nbtPayload(out, child)
      }
      out.push(Buffer.from([0]))
      break
    }
  }
}

/** Build a small raw-NBT `level.dat` with the given name/version/date. */
export function makeLevelDat(name: string, version: string, lastPlayed: number): Buffer {
  const fields: Array<[string, NbtTag]> = [
    ["LevelName", ["string", name]],
    [
      "Version",
      [
        "compound",
        [
          ["Name", ["string", version]],
          ["Id", ["int", 1]],
          ["Snapshot", ["byte", 0]],
          ["Series", ["string", "main"]],
        ],
      ],
    ],
    ["DataVersion", ["int", 1]],
    ["GameType", ["int", 0]],
    [
      "difficulty_settings",
      ["compound", [["difficulty", ["string", "easy"]], ["hardcore", ["byte", 0]], ["locked", ["byte", 0]]]],
    ],
    ["LastPlayed", ["long", lastPlayed]],
    ["allowCommands", ["byte", 0]],
  ]
  const out: Buffer[] = [Buffer.from([10]), Buffer.from([0, 0])]
  nbtPayload(out, ["compound", [["Data", ["compound", fields]]]])
  return Buffer.concat(out)
}
