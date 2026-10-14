// 아주 작은 CSV 읽기/쓰기 (RFC 4180). 구글 시트·엑셀에서 내보낸 파일을 그대로 읽는다.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // 엑셀이 붙이는 BOM 제거
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 완전히 빈 줄은 버린다
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** 첫 줄을 머리글로 쓰는 객체 배열 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

export function stringifyCsv(header: string[], records: Record<string, string>[]): string {
  const lines = [header.map(quote).join(",")];
  for (const r of records) lines.push(header.map((h) => quote(r[h] ?? "")).join(","));
  return lines.join("\n") + "\n";
}
