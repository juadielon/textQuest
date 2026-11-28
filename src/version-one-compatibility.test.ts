import { describe, expect, it } from 'vitest';
import {
  createAdventureSettings, currentVersion, encodeShareWord, parseShareWord, supportedVersions,
} from './adventure-settings';
import { importSaveFile } from './saves';

describe('adventure version retirement', () => {
  it('supports only adventure version 2', () => {
    expect(currentVersion).toBe(2);
    expect(supportedVersions).toEqual([2]);
  });

  it('does not parse or generate version 1 share words', () => {
    expect(() => parseShareWord('ableacorn')).toThrow(/not one textQuest knows/);
    expect(() => encodeShareWord({
      version: 1,
      seed: 0,
      length: 'short',
      genre: 'light-fantasy',
    })).toThrow(/not supported/);
  });

  it('does not import format 1 saves', () => {
    const save = {
      formatVersion: 1,
      name: 'Old save',
      settings: createAdventureSettings(0, 'short'),
      commands: [],
      commandModes: ['id'],
      createdAt: '2026-10-12T04:00:00.000Z',
      updatedAt: '2026-10-12T04:00:00.000Z',
    };

    expect(() => importSaveFile(JSON.stringify(save))).toThrow(/format version|save format/i);
  });
});
