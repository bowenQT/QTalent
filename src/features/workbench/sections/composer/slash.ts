import type { IconName } from '@/components/ui/Icon';

export type SlashCommand = {
  id: string;
  icon: IconName;
  label: string;
  key: string;
  href: string;
};

// Inventory (/盘) and meeting minutes (/录) stay in the prototype.
const record: SlashCommand = {
  id: 'record',
  icon: 'note',
  label: '记一件事',
  key: '记',
  href: '/record',
};
const find: SlashCommand = {
  id: 'find',
  icon: 'folder',
  label: '为项目找人',
  key: '找',
  href: '/staffing?new=1',
};

/** Commands follow `entries`; the composer itself only exists when recording is allowed. */
export function slashCommands(entries: {
  record: boolean;
  findPeople: boolean;
}): SlashCommand[] {
  return [entries.record && record, entries.findPeople && find].filter(
    (command): command is SlashCommand => Boolean(command),
  );
}

/** Commands matching what follows `/` (name or shortcut); null when the menu is closed. */
export function matchCommands(
  text: string,
  commands: readonly SlashCommand[],
): SlashCommand[] | null {
  if (!text.startsWith('/')) return null;
  const query = text.slice(1).trim();
  return commands.filter(
    (command) =>
      !query || command.key.includes(query) || command.label.includes(query),
  );
}
