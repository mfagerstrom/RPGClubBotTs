import { describe, it, expect } from '@jest/globals';
import { sanitizeUserInput } from '../functions/InteractionUtils';

describe('sanitizeUserInput', () => {
  it('removes script tags and html', () => {
    const input = 'Hello <script>alert(1)</script> <b>world</b>!';
    const result = sanitizeUserInput(input, { preserveNewlines: false });
    expect(result).toBe('Hello world!');
  });

  it('strips markdown and links', () => {
    const input = 'Use **bold** and [link](https://example.com)';
    const result = sanitizeUserInput(input, { preserveNewlines: false });
    expect(result).toBe('Use **bold** and link');
  });

  it('removes mentions and everyone', () => {
    const input = 'Hi <@123> and <@&456> and <#789> @everyone';
    const result = sanitizeUserInput(input, { preserveNewlines: false });
    expect(result).toBe('Hi and and');
  });

  it('preserves newlines and collapses extra spacing', () => {
    const input = 'Line 1  \n\n\n  Line  2';
    const result = sanitizeUserInput(input, { preserveNewlines: true });
    expect(result).toBe('Line 1\n\nLine 2');
  });

  it('removes sql comment tokens by default', () => {
    const input = 'select * from games -- comment';
    const result = sanitizeUserInput(input, { preserveNewlines: false });
    expect(result).toBe('select * from games comment');
  });
});
