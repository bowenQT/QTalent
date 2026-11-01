import {
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
  constants,
} from 'node:fs';

const invalid = () => {
  throw new Error('invalid_environment_file');
};
const space = (c) => c === ' ' || c === '\t' || c === '\r';

/** Restricted EnvironmentFile assignments; values are data, never shell code. */
export function parseEnvironmentFile(source) {
  for (const c of source) {
    const cp = c.codePointAt(0);
    if (
      cp === 0 ||
      cp === 0xfeff ||
      (cp >= 0xd800 && cp <= 0xdfff) ||
      (cp >= 0xfdd0 && cp <= 0xfdef) ||
      cp % 65536 >= 65534
    )
      invalid();
  }
  const result = Object.create(null);
  let at = 0;
  while (at < source.length) {
    while (space(source[at])) at++;
    if (source[at] === '\n') {
      at++;
      continue;
    }
    if (source[at] === '#' || source[at] === ';') {
      while (at < source.length && source[at] !== '\n') at++;
      continue;
    }
    if (at === source.length) break;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/.exec(source.slice(at));
    if (!match) invalid();
    const key = match[1];
    at += match[0].length;
    while (space(source[at])) at++;
    const quote =
      source[at] === '"' || source[at] === "'" ? source[at++] : null;
    let value = '';
    if (quote) {
      let closed = false;
      while (at < source.length) {
        const c = source[at++];
        if (c === quote) {
          closed = true;
          break;
        }
        if (quote === '"' && c === '\\') {
          if (at === source.length) invalid();
          const next = source[at++];
          if (next === '\n') continue;
          value += '"\\`$'.includes(next) ? next : '\\' + next;
        } else value += c;
      }
      if (!closed) invalid();
      while (space(source[at])) at++;
      // Concatenated quoting and inline comments after a quoted value are outside this subset.
      if (at < source.length && source[at] !== '\n') invalid();
    } else {
      let pendingWhitespace = '';
      while (at < source.length && source[at] !== '\n') {
        let c = source[at++];
        if (c === '\\') {
          if (at === source.length) invalid();
          c = source[at++];
          if (c === '\n') continue;
          value += pendingWhitespace + c;
          pendingWhitespace = '';
        } else if (space(c)) pendingWhitespace += c;
        else {
          value += pendingWhitespace + c;
          pendingWhitespace = '';
        }
      }
    }
    result[key] = value;
    if (source[at] === '\n') at++;
  }
  return result;
}

export function loadEnvironmentFiles(files, input = process.env) {
  if (
    !Array.isArray(files) ||
    files.length !== 2 ||
    files.some((p) => typeof p !== 'string' || !p.startsWith('/'))
  )
    invalid();
  const env = { ...input };
  for (const path of files) {
    let fd;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.uid !== process.getuid()
      )
        throw new Error('insecure_env_file');
      if (stat.size > 1048576) invalid();
      const source = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(readFileSync(fd));
      Object.assign(env, parseEnvironmentFile(source));
    } catch (error) {
      if (error?.message === 'insecure_env_file') throw error;
      invalid();
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  return env;
}
