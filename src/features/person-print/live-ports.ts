import type { PersonPrintPorts } from './ports';

/**
 * The print on the real server. The permission re-check, the audit record and the print
 * assembly have no server entry on main yet, so both calls answer `not_connected` and
 * the page says printing is not connected; nothing is printed from the person read.
 */
export function livePrintPorts(): PersonPrintPorts {
  return {
    preview: async () => ({ status: 'not_connected' }),
    print: async () => ({ status: 'not_connected' }),
  };
}
