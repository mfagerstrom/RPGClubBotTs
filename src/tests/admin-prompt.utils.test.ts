import { describe, it, expect, jest } from '@jest/globals';
import {
  buildChoiceRows,
  buildNumberChoiceOptions,
  addCancelOption,
  promptUserForChoice,
  promptUserForInput,
} from '../commands/admin/admin-prompt.utils';

describe('admin-prompt.utils', () => {
  it('buildChoiceRows returns correct number of rows', () => {
    const options = [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' },
      { label: 'D', value: 'd' },
      { label: 'E', value: 'e' },
      { label: 'F', value: 'f' },
    ];
    const rows = buildChoiceRows('prefix', options);
    expect(rows.length).toBe(2);
    expect(rows[0].components.length).toBe(5);
    expect(rows[1].components.length).toBe(1);
  });

  it('buildNumberChoiceOptions returns correct range', () => {
    const opts = buildNumberChoiceOptions(1, 3);
    expect(opts).toEqual([
      { label: '1', value: '1', style: expect.any(Number) },
      { label: '2', value: '2', style: expect.any(Number) },
      { label: '3', value: '3', style: expect.any(Number) },
    ]);
  });

  it('addCancelOption appends cancel option', () => {
    const opts = [{ label: 'A', value: 'a' }];
    const result = addCancelOption(opts);
    expect(result[result.length - 1]).toEqual(
      expect.objectContaining({ label: 'Cancel', value: 'cancel', style: expect.any(Number) })
    );
  });

  describe('promptUserForChoice', () => {
    it('returns null if channel is missing', async () => {
      const mockInteraction = { channel: null, user: { id: '123' }, reply: jest.fn() };
      const result = await promptUserForChoice(mockInteraction as any, 'Question?', [], 1000);
      expect(result).toBeNull();
    });

    it('returns null if channel.send is missing', async () => {
      const mockInteraction = { channel: {}, user: { id: '123' }, reply: jest.fn() };
      const result = await promptUserForChoice(mockInteraction as any, 'Question?', [], 1000);
      expect(result).toBeNull();
    });
  });

  describe('promptUserForInput', () => {
    it('returns null if channel is missing', async () => {
      const mockInteraction = { channel: null, user: { id: '123' }, reply: jest.fn() };
      const result = await promptUserForInput(mockInteraction as any, 'Question?', 1000);
      expect(result).toBeNull();
    });

    it('returns null if channel.awaitMessages is missing', async () => {
      const mockInteraction = { channel: {}, user: { id: '123' }, reply: jest.fn() };
      const result = await promptUserForInput(mockInteraction as any, 'Question?', 1000);
      expect(result).toBeNull();
    });
  });
});
