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

/** A parsed request; target actions retain the entity kind and need execution checks. */
export type CommandAction =
  | { readonly kind: 'move'; readonly direction: Direction }
  | { readonly kind: 'look' | 'inventory' | 'hint' | 'undo' | 'help' }
  | {
    readonly kind: 'move' | 'examine' | 'take' | 'talk' | 'choose';
    readonly targetId: string;
    readonly targetKind: CommandTarget['kind'];
  }
  | { readonly kind: 'use'; readonly itemId: string }
  | {
    readonly kind: 'use';
    readonly itemId: string;
    readonly targetId: string;
    readonly targetKind: CommandTarget['kind'];
  };

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
    [target.name, ...(target.aliases ?? [])].some((label) =>
      // Typed input loses its trailing punctuation, so names must too.
      normaliseName(label.replace(/[\s.!?]+$/, '')) === name),
  ) : [];
}

function targetLabels(targets: readonly CommandTarget[]): string[] {
  const uniqueTargets = [...new Map(targets.map((target) => [
    JSON.stringify([target.kind, target.id]),
    target,
  ])).values()];
  return targets.map((target) => {
    const sameName = uniqueTargets.filter((candidate) => candidate.name === target.name);
    if (sameName.length < 2) {
      return target.name;
    }
    const sameKind = sameName.filter((candidate) => candidate.kind === target.kind);
    return sameKind.length < 2
      ? `${target.name} (${target.kind})`
      : `${target.name} (${target.kind}: ${target.id})`;
  });
}

type TargetLookup =
  | { readonly found: true; readonly target: CommandTarget }
  | { readonly found: false; readonly error: CommandResult & { readonly ok: false } };

function findTarget(
  input: string,
  targets: readonly CommandTarget[],
  kinds?: readonly CommandTarget['kind'][],
): TargetLookup {
  const name = normaliseName(input);
  if (!name) {
    return { found: false, error: error('incomplete', 'Add the name of something you have discovered.') };
  }
  const matches = matchingTargets(input, targets);
  if (!matches.length) {
    return { found: false, error: error('unknown-target', 'That name is not one you have discovered.') };
  }
  const options = kinds ? matches.filter((target) => kinds.includes(target.kind)) : matches;
  if (!options.length) {
    return {
      found: false,
      error: error('invalid', 'That kind of thing does not fit this command. Type help for commands.'),
    };
  }
  if (options.length > 1) {
    return {
      found: false,
      error: {
        ok: false,
        problem: 'ambiguous',
        message: `Which one do you mean? ${targetLabels(options).join(', ')}.`,
        options,
      },
    };
  }
  return { found: true, target: options[0] };
}

/** Parse typed input using only caller-supplied discovered names, without changing them.
 * Trailing `.`, `!` and `?` are ignored after the first character, so `?` and `??` ask for help.
 * Names and aliases match exactly after case, whitespace, trailing punctuation and article normalisation.
 * Distinct complete use actions are ambiguous; repeated aliases for one action are not.
 * The caller must exclude hidden names, hidden aliases and unavailable story options.
 */
export function parseCommand(input: string, targets: readonly CommandTarget[]): CommandResult {
  const text = normalise(input).replace(/(?<=.)\s*[.!?]+$/, '');
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
        candidates.set(JSON.stringify([item.kind, item.id]), { item });
      }
      for (const index of separators) {
        const items = matchingTargets(words.slice(0, index).join(' '), targets)
          .filter((target) => target.kind === 'item');
        const matches = matchingTargets(words.slice(index + 1).join(' '), targets);
        for (const item of items) {
          for (const target of matches) {
            candidates.set(JSON.stringify([item.kind, item.id, target.kind, target.id]), { item, target });
          }
        }
      }
      const parses = [...candidates.values()];
      if (parses.length === 1) {
        const { item, target } = parses[0];
        return action(target
          ? { kind: 'use', itemId: item.id, targetId: target.id, targetKind: target.kind }
          : { kind: 'use', itemId: item.id });
      }
      if (parses.length > 1) {
        const sameItem = parses.every(({ item }) =>
          item.kind === parses[0].item.kind && item.id === parses[0].item.id,
        );
        const sameTarget = parses.every(({ target }) =>
          target?.kind === parses[0].target?.kind && target?.id === parses[0].target?.id,
        );
        const options = [...new Map(parses.map(({ item, target }) => {
          const option = sameItem ? target ?? item : item;
          return [JSON.stringify([option.kind, option.id]), option] as const;
        })).values()];
        const names = targetLabels(options).join(', ');
        const itemLabels = targetLabels(parses.map(({ item }) => item));
        const targetParses = parses.filter(({ target }) => target);
        const parsedTargets = targetParses.map(({ target }) => target!);
        const parsedTargetLabels = targetLabels(parsedTargets);
        const labelsByTarget = new Map(
          parsedTargets.map((target, index) => [
            JSON.stringify([target.kind, target.id]),
            parsedTargetLabels[index],
          ]),
        );
        const descriptions = parses.map(({ target }, index) =>
          `Use "${itemLabels[index]}"${target
            ? ` on "${labelsByTarget.get(JSON.stringify([target.kind, target.id]))}"`
            : ''}`,
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
        if (!target.found) {
          return target.error;
        }
      }
      const item = findTarget(itemName, targets, ['item']);
      if (!item.found) {
        return item.error;
      }
      if (separator === undefined) {
        return action({ kind: 'use', itemId: item.target.id });
      }
      const target = findTarget(words.slice(separator + 1).join(' '), targets);
      return !target.found ? target.error : action({
        kind: 'use', itemId: item.target.id, targetId: target.target.id, targetKind: target.target.kind,
      });
    }
    default:
      return error('unknown-command', 'That command is not supported. Type help for commands.');
  }
  const target = findTarget(name, targets, kinds);
  return !target.found ? target.error : action({
    kind, targetId: target.target.id, targetKind: target.target.kind,
  });
}
