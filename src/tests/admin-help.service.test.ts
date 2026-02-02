import { describe, it, expect } from '@jest/globals';
import { buildAdminHelpResponse, buildAdminHelpEmbed, buildAdminHelpButtons, ADMIN_HELP_TOPICS } from '../commands/admin/admin-help.service';

describe('admin-help.service', () => {
  it('buildAdminHelpResponse returns expected structure', () => {
    const response = buildAdminHelpResponse();
    expect(response).toHaveProperty('embeds');
    expect(response).toHaveProperty('components');
    expect(Array.isArray(response.embeds)).toBe(true);
    expect(Array.isArray(response.components)).toBe(true);
  });

  it('buildAdminHelpResponse returns correct embed with activeTopicId', () => {
    const topicId = ADMIN_HELP_TOPICS[0].id;
    const response = buildAdminHelpResponse(topicId);
    expect(response.embeds[0].data.title).toBe('Admin Commands Help');
    // Log the structure for diagnosis
    console.log('buildAdminHelpResponse.components:', JSON.stringify(response.components, null, 2));
    const selectMenu = response.components[0].components[0];
    const options = selectMenu.options ?? selectMenu.data?.options;
    expect(Array.isArray(options)).toBe(true);
    // Check that the option matching topicId has default: true
    expect(options.find((o: any) => (o.data?.value ?? o.value) === topicId)?.data?.default).toBe(true);
  });

  it('buildAdminHelpButtons returns ActionRow with correct options', () => {
    const topicId = ADMIN_HELP_TOPICS[0].id;
    const rows = buildAdminHelpButtons(topicId);
    expect(Array.isArray(rows)).toBe(true);
    // Log the structure for diagnosis
    console.log('buildAdminHelpButtons.rows:', JSON.stringify(rows, null, 2));
    const selectMenu = rows[0].components[0];
    const options = selectMenu.options ?? selectMenu.data?.options;
    expect(Array.isArray(options)).toBe(true);
    expect(options.length).toBeGreaterThan(0);
    // Check that the option matching topicId has default: true
    expect(options.find((o: any) => (o.data?.value ?? o.value) === topicId)?.data?.default).toBe(true);
  });

  it('buildAdminHelpEmbed returns valid embed for complete topic', () => {
    const topic = ADMIN_HELP_TOPICS[0];
    const embed = buildAdminHelpEmbed(topic);
    expect(embed.data.title).toContain(topic.label);
    expect(embed.data.description).toBe(topic.summary);
    expect(embed.data.fields && embed.data.fields.some((f: any) => f.name === 'Syntax')).toBe(true);
  });

  it('buildAdminHelpEmbed handles incomplete topic object', () => {
    const incompleteTopic = { id: 'sync', label: '/admin sync', summary: 'desc', syntax: 'syntax' };
    const embed = buildAdminHelpEmbed(incompleteTopic as any);
    expect(embed.data.title).toContain(incompleteTopic.label);
    expect(embed.data.fields && embed.data.fields.some((f: any) => f.name === 'Syntax')).toBe(true);
  });
});

// NOTE: Jest test runs may take 20-70 seconds or longer in this project due to DiscordX/TypeScript initialization and builder serialization. This is expected for full suite runs.
