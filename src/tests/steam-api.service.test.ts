import assert from "node:assert/strict";
import test from "node:test";
import {
  SteamApiError,
  classifySteamHttpStatus,
  parseSteamProfileIdentifier,
} from "../services/SteamApiService.js";

test("parseSteamProfileIdentifier parses steam id64", () => {
  const parsed = parseSteamProfileIdentifier("76561198000000000");
  assert.equal(parsed.kind, "steamid64");
  assert.equal(parsed.value, "76561198000000000");
});

test("parseSteamProfileIdentifier parses profiles url", () => {
  const parsed = parseSteamProfileIdentifier("https://steamcommunity.com/profiles/76561198000000000");
  assert.equal(parsed.kind, "profiles-url");
  assert.equal(parsed.value, "76561198000000000");
});

test("parseSteamProfileIdentifier parses vanity url", () => {
  const parsed = parseSteamProfileIdentifier("https://steamcommunity.com/id/my-vanity-name/");
  assert.equal(parsed.kind, "vanity-url");
  assert.equal(parsed.value, "my-vanity-name");
});

test("parseSteamProfileIdentifier parses raw vanity", () => {
  const parsed = parseSteamProfileIdentifier("my_vanity");
  assert.equal(parsed.kind, "vanity");
  assert.equal(parsed.value, "my_vanity");
});

test("parseSteamProfileIdentifier throws for invalid identifier", () => {
  assert.throws(
    () => parseSteamProfileIdentifier("not a valid steam profile ###"),
    (error: unknown) => {
      assert.ok(error instanceof SteamApiError);
      assert.equal(error.code, "invalid-identifier");
      return true;
    },
  );
});

test("classifySteamHttpStatus maps known statuses", () => {
  assert.equal(classifySteamHttpStatus(401), "api-unauthorized");
  assert.equal(classifySteamHttpStatus(403), "private-profile");
  assert.equal(classifySteamHttpStatus(429), "api-rate-limited");
  assert.equal(classifySteamHttpStatus(500), "api-unavailable");
  assert.equal(classifySteamHttpStatus(404), null);
});
