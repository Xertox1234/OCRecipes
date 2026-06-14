export interface ParityRow {
  source_path: string;
  content_hash: string;
  has_embedding: boolean;
}

export interface ParityResult {
  ok: boolean;
  failures: string[];
  counts: { disk: number; db: number; nullEmbeddings: number };
}

export function compareParity(
  diskHashes: Map<string, string>,
  dbRows: ParityRow[],
): ParityResult {
  const failures: string[] = [];
  const dbByPath = new Map(dbRows.map((r) => [r.source_path, r]));

  for (const [path, hash] of diskHashes) {
    const row = dbByPath.get(path);
    if (!row) failures.push(`missing in DB: ${path}`);
    else if (row.content_hash !== hash) failures.push(`hash mismatch: ${path}`);
  }
  for (const r of dbRows) {
    if (!diskHashes.has(r.source_path))
      failures.push(`in DB but not on disk: ${r.source_path}`);
  }
  const nullEmbeddings = dbRows.filter((r) => !r.has_embedding).length;
  if (nullEmbeddings)
    failures.push(`${nullEmbeddings} rows have NULL embedding`);
  if (diskHashes.size !== dbRows.length) {
    failures.push(
      `count mismatch: disk ${diskHashes.size} vs db ${dbRows.length}`,
    );
  }
  return {
    ok: failures.length === 0,
    failures,
    counts: { disk: diskHashes.size, db: dbRows.length, nullEmbeddings },
  };
}
