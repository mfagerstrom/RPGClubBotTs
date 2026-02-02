import { describe, it, expect, jest } from '@jest/globals';
import { isAdmin } from '../commands/admin/admin-auth.utils';

describe('isAdmin', () => {
  it('returns true for user with Administrator permission', async () => {
    const mockPermissions = { has: jest.fn().mockReturnValue(true) };
    const mockMember = { permissionsIn: jest.fn().mockReturnValue(mockPermissions) };
    const mockInteraction = { member: mockMember, channel: {}, replied: false, deferred: false };
    const result = await isAdmin(mockInteraction as any);
    expect(result).toBe(true);
    expect(mockMember.permissionsIn).toHaveBeenCalled();
    expect(mockPermissions.has).toHaveBeenCalledWith(expect.anything());
  });

  it('returns false for user without Administrator permission', async () => {
    const mockPermissions = { has: jest.fn().mockReturnValue(false) };
    const mockMember = { permissionsIn: jest.fn().mockReturnValue(mockPermissions) };
    const mockInteraction = {
      member: mockMember,
      channel: {},
      replied: false,
      deferred: false,
      reply: jest.fn(),
    };
    const result = await isAdmin(mockInteraction as any);
    expect(result).toBe(false);
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Access denied') }));
  });

  it('returns false if permissions cannot be checked', async () => {
    const mockInteraction = { member: {}, channel: null, reply: jest.fn() };
    const result = await isAdmin(mockInteraction as any);
    expect(result).toBe(false);
    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Access denied') }));
  });
});
