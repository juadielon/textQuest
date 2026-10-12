/** A named thing or authored option already discovered by the player. */
export interface CommandTarget {
  readonly id: string;
  readonly name: string;
  readonly kind: 'place' | 'exit' | 'item' | 'person' | 'clue' | 'object' | 'choice';
  readonly aliases?: readonly string[];
}

/** A compass direction or a simple relative movement. */
export type Direction =
  | 'north' | 'south' | 'east' | 'west'
  | 'northeast' | 'northwest' | 'southeast' | 'southwest'
  | 'up' | 'down' | 'in' | 'out';

/** A parsed request; the play module must check whether it can be carried out. */
export type CommandAction =
  | { readonly kind: 'move'; readonly direction: Direction }
  | { readonly kind: 'look' | 'inventory' | 'hint' | 'undo' | 'help' }
  | { readonly kind: 'move' | 'examine' | 'take' | 'talk' | 'choose'; readonly targetId: string }
  | { readonly kind: 'use'; readonly itemId: string; readonly targetId?: string };

/** An action, a plain-language error, or discovered options for an ambiguous name. */
export type CommandResult =
  | { readonly ok: true; readonly action: CommandAction }
  | {
    readonly ok: false;
    readonly problem: 'unknown-command' | 'unknown-target' | 'incomplete' | 'invalid';
    readonly message: string;
  }
  | {
    readonly ok: false;
    readonly problem: 'ambiguous';
    readonly message: string;
    readonly options: readonly CommandTarget[];
  };

/** Help for the supported grammar, without world details or puzzle advice. */
export const commandHelp =
  'Try north (n), go <place or exit>, look (l), examine <name> (x), inventory (i), '
  + 'take <item>, use <item> [on <name>], talk [to] <person>, choose <option>, '
  + 'hint (h), undo (u) or help (?). Use names you have discovered.';

const directions = new Map<string, Direction>([
  ['north', 'north'], ['n', 'north'], ['south', 'south'], ['s', 'south'],
  ['east', 'east'], ['e', 'east'], ['west', 'west'], ['w', 'west'],
  ['northeast', 'northeast'], ['ne', 'northeast'], ['northwest', 'northwest'], ['nw', 'northwest'],
  ['southeast', 'southeast'], ['se', 'southeast'], ['southwest', 'southwest'], ['sw', 'southwest'],
  ['up', 'up'], ['down', 'down'], ['d', 'down'], ['in', 'in'], ['out', 'out'],
]);

const simpleCommands = new Map<string, 'help' | 'inventory' | 'hint' | 'undo'>([
  ['help', 'help'], ['?', 'help'], ['inventory', 'inventory'], ['inv', 'inventory'],
  ['i', 'inventory'], ['hint', 'hint'], ['h', 'hint'], ['undo', 'undo'], ['u', 'undo'],
]);

function normalise(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, ' ');
}

function normaliseName(input: string): string {
  return normalise(input).split(' ').filter((word) => !['a', 'an', 'the'].includes(word)).join(' ');
}

function error(
  problem: 'unknown-command' | 'unknown-target' | 'incomplete' | 'invalid',
  message: string,
): CommandResult & { readonly ok: false } {
  return { ok: false, problem, message };
}

function action(value: CommandAction): CommandResult {
  return { ok: true, action: value };
}

function matchingTargets(input: string, targets: readonly CommandTarget[]): CommandTarget[] {
  const name = normaliseName(input);
  return name ? targets.filter((target) =>
    [target.name, ...(target.aliases ?? [])].some((label) => normaliseName(label) === name),
  ) : [];
}

function findTarget(
  input: string,
  targets: readonly CommandTarget[],
  kinds?: readonly CommandTarget['kind'][],
): CommandTarget | (CommandResult & { readonly ok: false }) {
  const name = normaliseName(input);
  if (!name) {
    return error('incomplete', 'Add the name of something you have discovered.');
  }
  const matches = matchingTargets(input, targets);
  if (!matches.length) {
    return error('unknown-target', 'That name is not one you have discovered.');
  }
  const options = kinds ? matches.filter((target) => kinds.includes(target.kind)) : matches;
  if (!options.length) {
    return error('invalid', 'That kind of thing does not fit this command. Type help for commands.');
  }
  if (options.length > 1) {
    return {
      ok: false,
      problem: 'ambiguous',
      message: `Which one do you mean? ${options.map((target) => target.name).join(', ')}.`,
      options,
    };
  }
  return options[0];
}

/** Parse typed input using only caller-supplied discovered names, without changing them.
 * Names and aliases match exactly after case, whitespace and article normalisation.
 * Distinct complete use actions are ambiguous; repeated aliases for one action are not.
 * The caller must exclude hidden names, hidden aliases and unavailable story options.
 */
export function parseCommand(input: string, targets: readonly CommandTarget[]): CommandResult {
  const text = normalise(input);
  if (!text) {
    return error('incomplete', 'Type a command. Type help for commands.');
  }
  const [verb, ...words] = text.split(' ');
  const rest = words.join(' ');
  const direction = directions.get(verb);
  if (direction) {
    return rest
      ? error('invalid', 'Use a direction on its own, such as north or n.')
      : action({ kind: 'move', direction });
  }
  const simple = simpleCommands.get(verb);
  if (simple) {
    return rest
      ? error('invalid', 'Use this command on its own. Type help for commands.')
      : action({ kind: simple });
  }

  let kind: 'move' | 'examine' | 'take' | 'talk' | 'choose';
  let name = rest;
  let kinds: readonly CommandTarget['kind'][] | undefined;
  switch (verb) {
    case 'look': case 'l':
      if (!rest || rest === 'around') {
        return action({ kind: 'look' });
      }
      name = rest.replace(/^at(?: |$)/, '');
      kind = 'examine';
      break;
    case 'examine': case 'x':
      kind = 'examine';
      break;
    case 'go': case 'move': case 'walk': {
      name = rest.replace(/^to(?: |$)/, '');
      const movement = directions.get(normaliseName(name));
      if (movement) {
        return action({ kind: 'move', direction: movement });
      }
      kind = 'move';
      kinds = ['place', 'exit'];
      break;
    }
    case 'take': case 'get':
      kind = 'take';
      kinds = ['item'];
      break;
    case 'talk': case 't':
      kind = 'talk';
      kinds = ['person'];
      name = rest.replace(/^to(?: |$)/, '');
      break;
    case 'choose': case 'c':
      kind = 'choose';
      kinds = ['choice'];
      break;
    case 'use': {
      const separators = words.flatMap((word, index) => word === 'on' ? [index] : []);
      const candidates = new Map<string, { item: CommandTarget; target?: CommandTarget }>();
      for (const item of matchingTargets(rest, targets).filter((target) => target.kind === 'item')) {
        candidates.set(JSON.stringify([item.id]), { item });
      }
      for (const index of separators) {
        const items = matchingTargets(words.slice(0, index).join(' '), targets)
          .filter((target) => target.kind === 'item');
        const matches = matchingTargets(words.slice(index + 1).join(' '), targets);
        for (const item of items) {
          for (const target of matches) {
            candidates.set(JSON.stringify([item.id, target.id]), { item, target });
          }
        }
      }
      const parses = [...candidates.values()];
      if (parses.length === 1) {
        const { item, target } = parses[0];
        return action(target
          ? { kind: 'use', itemId: item.id, targetId: target.id }
          : { kind: 'use', itemId: item.id });
      }
      if (parses.length > 1) {
        const sameItem = parses.every(({ item }) => item.id === parses[0].item.id);
        const sameTarget = parses.every(({ target }) => target?.id === parses[0].target?.id);
        const options = [...new Map(parses.map(({ item, target }) => {
          const option = sameItem ? target ?? item : item;
          return [option.id, option] as const;
        })).values()];
        const names = options.map((target) => target.name).join(', ');
        const descriptions = parses.map(({ item, target }) =>
          `Use "${item.name}"${target ? ` on "${target.name}"` : ''}`,
        ).join('; ');
        return {
          ok: false, problem: 'ambiguous',
          message: sameTarget || (sameItem && parses.every(({ target }) => target))
            ? `Which one do you mean? ${names}.`
            : `Which action do you mean? ${descriptions}.`,
          options,
        };
      }
      const separator = separators.find((index) =>
        matchingTargets(words.slice(0, index).join(' '), targets)
          .some((target) => target.kind === 'item'),
      ) ?? separators[0];
      const itemName = separator === undefined ? rest : words.slice(0, separator).join(' ');
      if (separator !== undefined && matchingTargets(itemName, targets)
        .some((target) => target.kind === 'item')) {
        const target = findTarget(words.slice(separator + 1).join(' '), targets);
        if ('ok' in target) {
          return target;
        }
      }
      const item = findTarget(itemName, targets, ['item']);
      if ('ok' in item) {
        return item;
      }
      if (separator === undefined) {
        return action({ kind: 'use', itemId: item.id });
      }
      const target = findTarget(words.slice(separator + 1).join(' '), targets);
      return 'ok' in target ? target : action({ kind: 'use', itemId: item.id, targetId: target.id });
    }
    default:
      return error('unknown-command', 'That command is not supported. Type help for commands.');
  }
  const target = findTarget(name, targets, kinds);
  return 'ok' in target ? target : action({ kind, targetId: target.id });
}
