/**
 * Exports do Tiny aparecem tanto em UTF-8 quanto em Windows-1252 (o padrão de
 * "exportar para Excel" em ERPs BR). Decodificar errado quebra os acentos e,
 * por consequência, o match de nomes — então detectamos antes de confiar.
 */
export function decodeTextBuffer(buffer: Buffer): { text: string; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8 (BOM)" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(buffer.subarray(2)), encoding: "utf-16le" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(buffer.subarray(2)), encoding: "utf-16be" };
  }

  try {
    const strict = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text: strict, encoding: "utf-8" };
  } catch {
    return { text: decodeWindows1252(buffer), encoding: "windows-1252" };
  }
}

function decodeWindows1252(buffer: Buffer): string {
  try {
    return new TextDecoder("windows-1252").decode(buffer);
  } catch {
    return buffer.toString("latin1");
  }
}
