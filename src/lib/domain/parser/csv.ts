const CANDIDATE_DELIMITERS = [";", ",", "\t", "|"] as const;

/**
 * Escolhe o delimitador contando ocorrências fora de aspas nas primeiras linhas.
 * ERPs brasileiros usam ";" com frequência, mas nunca garantidamente.
 */
export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  let best = ";";
  let bestScore = -1;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < sample.length; i += 1) {
      const char = sample[i];
      if (char === '"') {
        if (inQuotes && sample[i + 1] === '"') i += 1;
        else inQuotes = !inQuotes;
      } else if (!inQuotes && char === delimiter) {
        count += 1;
      }
    }
    if (count > bestScore) {
      bestScore = count;
      best = delimiter;
    }
  }
  return best;
}

/** Parser CSV no estilo RFC 4180: respeita aspas, aspas escapadas e quebra de linha dentro do campo. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let touched = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0].trim() !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    touched = true;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === "") {
      inQuotes = true;
      field = "";
    } else if (char === delimiter) {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (touched && (field !== "" || row.length > 0)) endRow();
  return rows;
}
