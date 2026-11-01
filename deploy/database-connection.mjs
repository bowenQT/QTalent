/** One strict, secret-safe configuration for every deployment DB boundary. */
export class DatabaseConnectionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const invalid = (code = 'database_mismatch') => {
  throw new DatabaseConnectionError(code);
};
export function parseDatabaseConnection(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid();
  }
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    if (!['sslmode', 'sslrootcert'].includes(key))
      invalid('database_query_parameter_not_allowed');
    if (seen.has(key)) invalid('database_query_parameter_duplicate');
    seen.add(key);
  }
  try {
    const sslmode = url.searchParams.get('sslmode');
    const sslrootcert = url.searchParams.get('sslrootcert');
    const config = {
      host: decodeURIComponent(url.hostname.replace(/^\[(.*)\]$/, '$1')),
      port: Number(url.port || '5432'),
      database: decodeURI(url.pathname.slice(1)),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      sslmode,
      sslrootcert,
    };
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !config.host ||
      !config.user ||
      !config.database ||
      !['require', 'verify-ca', 'verify-full'].includes(sslmode)
    )
      invalid();
    // A complete canonical URL prevents driver fallbacks to another PG target.
    url.port = String(config.port);
    url.search = '';
    url.searchParams.set('sslmode', sslmode);
    if (sslrootcert !== null) url.searchParams.set('sslrootcert', sslrootcert);
    return Object.freeze({ ...config, connectionString: url.toString() });
  } catch {
    invalid();
  }
}
export function databaseIdentity(config) {
  return {
    host: config.host,
    port: config.port,
    name: config.database,
    username: config.user,
    sslmode: config.sslmode,
    sslrootcert: config.sslrootcert || null,
  };
}
export function databaseEnvironment(config) {
  return {
    DATABASE_URL: config.connectionString,
    PGHOST: config.host,
    PGPORT: String(config.port),
    PGDATABASE: config.database,
    PGUSER: config.user,
    PGPASSWORD: config.password,
    PGSSLMODE: config.sslmode,
    PGSSLROOTCERT: config.sslrootcert || '',
  };
}
export const databaseErrorExit = (error) =>
  error?.code === 'database_query_parameter_not_allowed'
    ? 64
    : error?.code === 'database_query_parameter_duplicate'
      ? 65
      : 1;
