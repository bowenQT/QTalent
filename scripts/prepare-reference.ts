import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export function prepareReference(root: string, verifiedSnapshot = false) {
  const { commit } = JSON.parse(
    readFileSync(join(root, 'prototype-reference.json'), 'utf8'),
  ) as { commit: string };
  if (!/^[a-f0-9]{7,40}$/.test(commit))
    throw new Error('Reference must be a fixed Git commit');
  const manifest = JSON.parse(
    readFileSync(join(root, 'tests/fixtures/prototype-manifest.json'), 'utf8'),
  ) as { files: { path: string; sha: string }[] };
  // Validate every byte first; never leave a partially accepted reference on source mismatch.
  const verified = manifest.files.map((entry) => {
    if (
      !entry.path.startsWith('prototype/y/') ||
      entry.path.split('/').includes('..')
    )
      throw new Error('Invalid reference path');
    const bytes = verifiedSnapshot
      ? readFileSync(join(root, entry.path))
      : execFileSync('git', ['show', `${commit}:${entry.path}`], {
          cwd: root,
          maxBuffer: 8 * 1024 * 1024,
        });
    const digest = createHash('sha1')
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest('hex');
    if (digest !== entry.sha)
      throw new Error(`Reference digest mismatch: ${entry.path}`);
    return { path: entry.path, bytes };
  });
  for (const file of verified) {
    const destination = join(root, '.reference-cache', file.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.bytes);
  }
  writeFileSync(
    join(root, '.reference-cache/reference.json'),
    JSON.stringify({ commit }),
  );
  return verified.length;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(
    `Prepared ${prepareReference(process.cwd(), process.argv.includes('--verified-snapshot'))} fixed prototype files`,
  );
