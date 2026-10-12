import { describe, expect, it } from 'vitest';
import { commandHelp, parseCommand, type CommandAction, type CommandTarget } from './commands';

const targets: readonly CommandTarget[] = [
  { id: 'hall', name: 'The Great Hall', kind: 'place' },
  { id: 'door', name: 'Oak Door', kind: 'exit' },
  { id: 'brass-key', name: 'Brass Key', aliases: ['key'], kind: 'item' },
  { id: 'silver-key', name: 'Silver Key', aliases: ['key'], kind: 'item' },
  { id: 'lamp', name: 'Oil Lamp', aliases: ['lamp'], kind: 'item' },
  { id: 'keeper', name: 'Gate Keeper', aliases: ['keeper'], kind: 'person' },
  { id: 'note', name: 'Torn Note', kind: 'clue' },
  { id: 'lock', name: 'Door Lock', aliases: ['lock'], kind: 'object' },
  { id: 'wait', name: 'Wait by the gate', aliases: ['1'], kind: 'choice' },
];

describe('parseCommand', () => {
  const examples: [string, CommandAction][] = [
    ['north', { kind: 'move', direction: 'north' }],
    ['n', { kind: 'move', direction: 'north' }],
    ['go n', { kind: 'move', direction: 'north' }],
    ['walk to the east', { kind: 'move', direction: 'east' }],
    ['move great hall', { kind: 'move', targetId: 'hall', targetKind: 'place' }],
    ['go to the oak door', { kind: 'move', targetId: 'door', targetKind: 'exit' }],
    ['look', { kind: 'look' }],
    ['l', { kind: 'look' }],
    ['look around', { kind: 'look' }],
    ['look at the torn note', { kind: 'examine', targetId: 'note', targetKind: 'clue' }],
    ['look door lock', { kind: 'examine', targetId: 'lock', targetKind: 'object' }],
    ['examine gate keeper', { kind: 'examine', targetId: 'keeper', targetKind: 'person' }],
    ['x lamp', { kind: 'examine', targetId: 'lamp', targetKind: 'item' }],
    ['inventory', { kind: 'inventory' }],
    ['inv', { kind: 'inventory' }],
    ['i', { kind: 'inventory' }],
    ['take the brass key', { kind: 'take', targetId: 'brass-key', targetKind: 'item' }],
    ['get an oil lamp', { kind: 'take', targetId: 'lamp', targetKind: 'item' }],
    ['use lamp', { kind: 'use', itemId: 'lamp' }],
    ['use brass key on the lock', { kind: 'use', itemId: 'brass-key', targetId: 'lock', targetKind: 'object' }],
    ['use lamp on keeper', { kind: 'use', itemId: 'lamp', targetId: 'keeper', targetKind: 'person' }],
    ['talk gate keeper', { kind: 'talk', targetId: 'keeper', targetKind: 'person' }],
    ['talk to the keeper', { kind: 'talk', targetId: 'keeper', targetKind: 'person' }],
    ['t keeper', { kind: 'talk', targetId: 'keeper', targetKind: 'person' }],
    ['choose wait by the gate', { kind: 'choose', targetId: 'wait', targetKind: 'choice' }],
    ['choose 1', { kind: 'choose', targetId: 'wait', targetKind: 'choice' }],
    ['c 1', { kind: 'choose', targetId: 'wait', targetKind: 'choice' }],
    ['hint', { kind: 'hint' }],
    ['h', { kind: 'hint' }],
    ['undo', { kind: 'undo' }],
    ['u', { kind: 'undo' }],
    ['help', { kind: 'help' }],
    ['?', { kind: 'help' }],
  ];

  it.each(examples)('parses %j', (input, action) => {
    expect(parseCommand(input, targets)).toEqual({ ok: true, action });
  });

  it.each([
    ['s', 'south'], ['e', 'east'], ['w', 'west'], ['ne', 'northeast'], ['nw', 'northwest'],
    ['se', 'southeast'], ['sw', 'southwest'], ['up', 'up'], ['d', 'down'], ['in', 'in'], ['out', 'out'],
  ])('parses direction %s and its full name', (short, full) => {
    for (const input of [short, full, `go ${short}`]) {
      expect(parseCommand(input, targets)).toEqual({
        ok: true, action: { kind: 'move', direction: full },
      });
    }
  });

  it('normalises capitals, spaces, tabs, newlines and articles on both sides', () => {
    expect(parseCommand(' \tUsE  THE Brass \n KEY  ON a DOOR \t LOCK ', targets)).toEqual({
      ok: true, action: { kind: 'use', itemId: 'brass-key', targetId: 'lock', targetKind: 'object' },
    });
    expect(parseCommand('go GREAT HALL', targets)).toEqual({
      ok: true, action: { kind: 'move', targetId: 'hall', targetKind: 'place' },
    });
  });

  it.each(['', '   ', 'take', 'take the', 'x', 'look at', 'go', 'go to', 'talk', 'talk to', 'choose', 'use', 'use lamp on', 'use on lock'])(
    'reports incomplete input %j',
    (input) => {
      expect(parseCommand(input, targets)).toMatchObject({ ok: false, problem: 'incomplete' });
    },
  );

  it.each(['dance', 'constructor', 'toString', 'unlock door', 'nonsense lamp'])(
    'rejects unknown command %j',
    (input) => {
      expect(parseCommand(input, targets)).toMatchObject({ ok: false, problem: 'unknown-command' });
    },
  );

  it.each(['n lamp', 'help lamp', 'i lamp', 'hint lock', 'undo now', 'look around lamp'])(
    'does not silently ignore extra words in %j',
    (input) => {
      expect(parseCommand(input, targets).ok).toBe(false);
    },
  );

  it.each(['take keeper', 'talk lamp', 'go lamp', 'choose lamp', 'use lock'])(
    'rejects an unsuitable target kind in %j',
    (input) => {
      expect(parseCommand(input, targets)).toMatchObject({ ok: false, problem: 'invalid' });
    },
  );

  it.each(['take oil', 'x oil lamps', 'x lam', 'talk keeper please', 'choose 2'])(
    'requires a complete discovered name or alias in %j',
    (input) => {
      expect(parseCommand(input, targets)).toMatchObject({ ok: false, problem: 'unknown-target' });
    },
  );

  it.each(['take key', 'x the key', 'use key on lock', 'use lamp on key'])(
    'lists discovered matches for %j without choosing one',
    (input) => {
      expect(parseCommand(input, targets)).toEqual({
        ok: false,
        problem: 'ambiguous',
        message: 'Which one do you mean? Brass Key, Silver Key.',
        options: [targets[2], targets[3]],
      });
    },
  );

  it('resolves ambiguity within the target kinds that fit the command', () => {
    const sameNames: readonly CommandTarget[] = [
      { id: 'item', name: 'Guide', aliases: ['guide'], kind: 'item' },
      { id: 'person', name: 'Guide', kind: 'person' },
    ];
    expect(parseCommand('talk guide', sameNames)).toEqual({
      ok: true, action: { kind: 'talk', targetId: 'person', targetKind: 'person' },
    });
    expect(parseCommand('x guide', sameNames)).toMatchObject({
      ok: false, problem: 'ambiguous', options: sameNames,
    });
  });

  it.each(['x secret hatch', 'take hidden gem', 'use lamp on hidden gem', 'choose hidden ending'])(
    'cannot match a hidden name in %j',
    (input) => {
      expect(parseCommand(input, targets)).toEqual({
        ok: false, problem: 'unknown-target', message: 'That name is not one you have discovered.',
      });
    },
  );

  it('does not retain discovered names between calls', () => {
    expect(parseCommand('x lamp', targets).ok).toBe(true);
    expect(parseCommand('x lamp', [])).toMatchObject({ ok: false, problem: 'unknown-target' });
  });

  it('does not confuse targets with an own ok property for lookup outcomes', () => {
    const item: CommandTarget & { readonly ok: boolean } = {
      id: 'token', name: 'Token', kind: 'item', ok: true,
    };
    const object: CommandTarget & { readonly ok: boolean } = {
      id: 'pedestal', name: 'Pedestal', kind: 'object', ok: false,
    };
    const namedTargets = [item, object];

    expect(parseCommand('examine pedestal', namedTargets)).toEqual({
      ok: true, action: { kind: 'examine', targetId: 'pedestal', targetKind: 'object' },
    });
    expect(parseCommand('use token', namedTargets)).toEqual({
      ok: true, action: { kind: 'use', itemId: 'token' },
    });
    expect(parseCommand('use token on pedestal', namedTargets)).toEqual({
      ok: true, action: { kind: 'use', itemId: 'token', targetId: 'pedestal', targetKind: 'object' },
    });
  });

  it('reports missing and unknown use targets', () => {
    expect(parseCommand('use lamp on the', targets)).toMatchObject({
      ok: false, problem: 'incomplete',
    });
    expect(parseCommand('use lamp on moon', targets)).toMatchObject({
      ok: false, problem: 'unknown-target',
    });
  });

  it('accepts discovered item and target names containing the word on', () => {
    const namedTargets: readonly CommandTarget[] = [
      { id: 'badge', name: 'Badge on a ribbon', kind: 'item' },
      { id: 'mark', name: 'Mark on the wall', kind: 'object' },
      { id: 'switch', name: 'On switch', kind: 'item' },
    ];
    expect(parseCommand('use badge on a ribbon', namedTargets)).toEqual({
      ok: true, action: { kind: 'use', itemId: 'badge' },
    });
    expect(parseCommand('use badge on a ribbon on mark on the wall', namedTargets)).toEqual({
      ok: true, action: { kind: 'use', itemId: 'badge', targetId: 'mark', targetKind: 'object' },
    });
    expect(parseCommand('use on switch on mark on the wall', namedTargets)).toEqual({
      ok: true, action: { kind: 'use', itemId: 'switch', targetId: 'mark', targetKind: 'object' },
    });
  });

  it('ignores item prefixes whose remaining target is unknown', () => {
    const namedTargets: readonly CommandTarget[] = [
      { id: 'badge', name: 'Badge', kind: 'item' },
      { id: 'ribbon-badge', name: 'Badge on ribbon', kind: 'item' },
      { id: 'wall', name: 'Wall', kind: 'object' },
    ];
    expect(parseCommand('use badge on ribbon on wall', namedTargets)).toEqual({
      ok: true, action: { kind: 'use', itemId: 'ribbon-badge', targetId: 'wall', targetKind: 'object' },
    });
  });

  it('does not choose a whole item name over a valid item-on-target action', () => {
    const namedTargets: readonly CommandTarget[] = [
      { id: 'badge', name: 'Badge', kind: 'item' },
      { id: 'ribbon-badge', name: 'Badge on ribbon', kind: 'item' },
      { id: 'ribbon', name: 'Ribbon', kind: 'object' },
    ];
    expect(parseCommand('use badge on ribbon', namedTargets)).toEqual({
      ok: false, problem: 'ambiguous',
      message: 'Which action do you mean? Use "Badge on ribbon"; Use "Badge" on "Ribbon".',
      options: [namedTargets[1], namedTargets[0]],
    });
  });

  it('validates complete targets before resolving overlapping aliases', () => {
    const namedTargets: readonly CommandTarget[] = [
      { id: 'badge', name: 'Badge on ribbon', aliases: ['badge'], kind: 'item' },
      { id: 'wall', name: 'Wall', kind: 'object' },
    ];
    expect(parseCommand('use badge on ribbon on wall', namedTargets)).toEqual({
      ok: true, action: { kind: 'use', itemId: 'badge', targetId: 'wall', targetKind: 'object' },
    });
  });

  it('deduplicates complete actions produced by different splits and aliases', () => {
    const namedTargets: readonly CommandTarget[] = [
      { id: 'badge', name: 'Badge on ribbon', aliases: ['badge'], kind: 'item' },
      { id: 'wall', name: 'Wall', aliases: ['ribbon on wall'], kind: 'object' },
    ];
    expect(parseCommand('use badge on ribbon on wall', namedTargets)).toEqual({
      ok: true, action: { kind: 'use', itemId: 'badge', targetId: 'wall', targetKind: 'object' },
    });
  });

  it('reports distinct complete actions across multiple valid splits', () => {
    const namedTargets: readonly CommandTarget[] = [
      { id: 'badge', name: 'Badge', kind: 'item' },
      { id: 'ribbon-badge', name: 'Badge on ribbon', kind: 'item' },
      { id: 'ribbon-wall', name: 'Ribbon on wall', kind: 'object' },
      { id: 'wall', name: 'Wall', kind: 'object' },
    ];
    expect(parseCommand('use badge on ribbon on wall', namedTargets)).toMatchObject({
      ok: false, problem: 'ambiguous', options: namedTargets.slice(0, 2),
    });
  });

  it('keeps distinct targets when overlapping item aliases produce valid parses', () => {
    const namedTargets: readonly CommandTarget[] = [
      { id: 'badge', name: 'Badge on ribbon', aliases: ['badge'], kind: 'item' },
      { id: 'ribbon-wall', name: 'Ribbon on wall', kind: 'object' },
      { id: 'wall', name: 'Wall', kind: 'object' },
    ];
    expect(parseCommand('use badge on ribbon on wall', namedTargets)).toEqual({
      ok: false, problem: 'ambiguous',
      message: 'Which one do you mean? Ribbon on wall, Wall.',
      options: namedTargets.slice(1),
    });
  });

  it('keeps same-ID targets of different kinds distinct when parsing use', () => {
    const sameIdTargets: readonly CommandTarget[] = [
      { id: 'key', name: 'Key', kind: 'item' },
      { id: 'door', name: 'Door', kind: 'place' },
      { id: 'door', name: 'Door', kind: 'exit' },
    ];
    expect(parseCommand('use key on door', sameIdTargets)).toEqual({
      ok: false,
      problem: 'ambiguous',
      message: 'Which one do you mean? Door, Door.',
      options: sameIdTargets.slice(1),
    });
  });

  it('describes distinct actions even when they refer to the same entity', () => {
    const namedTargets: readonly CommandTarget[] = [
      { id: 'badge', name: 'Badge', aliases: ['badge on badge'], kind: 'item' },
    ];
    expect(parseCommand('use badge on badge', namedTargets)).toEqual({
      ok: false, problem: 'ambiguous',
      message: 'Which action do you mean? Use "Badge"; Use "Badge" on "Badge".',
      options: namedTargets,
    });
  });

  it('does not report item ambiguity when there is no valid target', () => {
    expect(parseCommand('use key on moon', targets)).toMatchObject({
      ok: false, problem: 'unknown-target',
    });
    expect(parseCommand('use key on', targets)).toMatchObject({
      ok: false, problem: 'incomplete',
    });
  });

  it('parses syntax without deciding puzzle success, availability or consuming a turn', () => {
    expect(parseCommand('use lamp on lamp', targets)).toEqual({
      ok: true, action: { kind: 'use', itemId: 'lamp', targetId: 'lamp', targetKind: 'item' },
    });
    expect(parseCommand('north', [])).toEqual({
      ok: true, action: { kind: 'move', direction: 'north' },
    });
  });

  it('never changes caller data for actions, inspections or errors', () => {
    const frozen = Object.freeze(targets.map((target) => Object.freeze({
      ...target, aliases: target.aliases && Object.freeze([...target.aliases]),
    })));
    const before = JSON.stringify(frozen);
    for (const input of [...examples.map(([input]) => input), 'take key', 'dance', 'x hidden gem']) {
      parseCommand(input, frozen);
    }
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('keeps help about grammar rather than puzzles or undiscovered names', () => {
    for (const verb of ['go', 'look', 'examine', 'inventory', 'take', 'use', 'talk', 'choose', 'hint', 'undo', 'help']) {
      expect(commandHelp).toContain(verb);
    }
    expect(commandHelp).not.toContain('Brass Key');
    expect(commandHelp).not.toContain('hidden');
  });
});
