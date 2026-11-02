import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FACT_DIRECTORY,
  FACT_FILES,
  FACT_GENERATIONS,
  type FactGeneration,
} from './input';

/** Test-only roots without .git. The runtime reads packaged files; a
 * superseded generation is no longer in the tree, so tests extract its pinned
 * files from Git into a temporary root and pass that root to the reader. */
export function generationFactRoot(
  generation: FactGeneration,
  repository = process.cwd(),
) {
  const root = mkdtempSync(join(tmpdir(), `${generation}-facts-`));
  mkdirSync(join(root, FACT_DIRECTORY), { recursive: true });
  for (const name of FACT_FILES)
    writeFileSync(
      join(root, FACT_DIRECTORY, name),
      execFileSync(
        'git',
        [
          'show',
          `${FACT_GENERATIONS[generation].sourceCommit}:${FACT_DIRECTORY}/${name}`,
        ],
        { cwd: repository, maxBuffer: 2_000_000 },
      ),
    );
  return root;
}

/** The same artifact `deploy/release.mjs` prepares: `git archive` of a commit,
 * extracted without .git. `paths` limits the archive, as a smaller test root. */
export function releaseArtifact(
  commit = 'HEAD',
  repository = process.cwd(),
  paths: string[] = [],
) {
  // Real path: the CLI's entry guard compares argv[1] with import.meta.url,
  // and macOS tmpdir() is a symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'release-artifact-')));
  const archive = join(root, '.release.tar');
  execFileSync(
    'git',
    [
      'archive',
      '--format=tar',
      '--output',
      archive,
      commit,
      ...(paths.length ? ['--', ...paths] : []),
    ],
    {
      cwd: repository,
    },
  );
  execFileSync('tar', ['-xf', archive, '-C', root]);
  rmSync(archive);
  return root;
}
