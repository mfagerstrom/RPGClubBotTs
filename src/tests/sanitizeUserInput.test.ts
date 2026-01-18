import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeUserInput } from "../functions/InteractionUtils.js";

describe("sanitizeUserInput", () => {
  it("removes script tags and html", () => {
    const input = "Hello <script>alert(1)</script> <b>world</b>!";
    const result = sanitizeUserInput(input, { preserveNewlines: false });
    assert.equal(result, "Hello world!");
  });

  it("strips markdown and links", () => {
    const input = "Use **bold** and [link](https://example.com)";
    const result = sanitizeUserInput(input, { preserveNewlines: false });
    assert.equal(result, "Use **bold** and link");
  });

  it("removes mentions and everyone", () => {
    const input = "Hi <@123> and <@&456> and <#789> @everyone";
    const result = sanitizeUserInput(input, { preserveNewlines: false });
    assert.equal(result, "Hi and and");
  });

  it("preserves newlines and collapses extra spacing", () => {
    const input = "Line 1  \n\n\n  Line  2";
    const result = sanitizeUserInput(input, { preserveNewlines: true });
    assert.equal(result, "Line 1\n\nLine 2");
  });

  it("removes sql comment tokens by default", () => {
    const input = "select * from games -- comment";
    const result = sanitizeUserInput(input, { preserveNewlines: false });
    assert.equal(result, "select * from games comment");
  });
});
