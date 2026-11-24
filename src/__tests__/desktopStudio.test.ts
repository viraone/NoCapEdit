import { describe, expect, it } from "vitest";
import { addressFromDscacheutil, needsLookup, parseStudioConfig, STUDIO_PREFIX, studioUpstreamPath } from "../../desktop/lib/studio.mjs";

describe("desktopStudio", () => {
  const home = "/Users/me";

  it("parseStudioConfig parses a full valid config", () => {
    const text = JSON.stringify({
      baseUrl: "http://studio.local:8000/v1",
      apiKeyFile: "~/.config/x/key",
      model: "m1",
      name: "Studio A",
    });
    const result = parseStudioConfig(text, home);
    expect(result).toEqual({
      baseUrl: "http://studio.local:8000/v1",
      apiKeyFile: "/Users/me/.config/x/key",
      model: "m1",
      name: "Studio A",
    });
  });

  it("parseStudioConfig strips trailing slash from baseUrl", () => {
    const text = JSON.stringify({
      baseUrl: "http://studio.local:8000/v1/",
      apiKeyFile: "/etc/key",
      model: "m1",
    });
    const result = parseStudioConfig(text, home);
    expect(result?.baseUrl).toBe("http://studio.local:8000/v1");
  });

  it("parseStudioConfig defaults name to Mac Studio", () => {
    const text = JSON.stringify({
      baseUrl: "http://studio.local:8000/v1",
      apiKeyFile: "/etc/key",
      model: "m1",
    });
    const result = parseStudioConfig(text, home);
    expect(result?.name).toBe("Mac Studio");
  });

  it("parseStudioConfig keeps absolute apiKeyFile as is", () => {
    const text = JSON.stringify({
      baseUrl: "http://studio.local:8000/v1",
      apiKeyFile: "/etc/key",
      model: "m1",
    });
    const result = parseStudioConfig(text, home);
    expect(result?.apiKeyFile).toBe("/etc/key");
  });

  it("parseStudioConfig returns null for invalid inputs", () => {
    expect(parseStudioConfig("not json", home)).toBeNull();
    expect(parseStudioConfig("[]", home)).toBeNull(); // Array is object but missing fields
    expect(parseStudioConfig(JSON.stringify({ baseUrl: "http://x/v1", apiKeyFile: "/k" }), home)).toBeNull(); // missing model
    expect(parseStudioConfig(JSON.stringify({ baseUrl: "http://x/v1", apiKeyFile: "/k", model: "  " }), home)).toBeNull(); // empty model
    expect(parseStudioConfig(JSON.stringify({ baseUrl: "ftp://x/v1", apiKeyFile: "/k", model: "m" }), home)).toBeNull(); // bad protocol
    expect(parseStudioConfig(JSON.stringify({ baseUrl: "not a url", apiKeyFile: "/k", model: "m" }), home)).toBeNull(); // bad url
    expect(parseStudioConfig(JSON.stringify({ baseUrl: "http://u:p@host/v1", apiKeyFile: "/k", model: "m" }), home)).toBeNull(); // credentials
    expect(parseStudioConfig(JSON.stringify({ baseUrl: "http://host/v1?x=1", apiKeyFile: "/k", model: "m" }), home)).toBeNull(); // query
    expect(parseStudioConfig(JSON.stringify({ baseUrl: "http://host/v1", apiKeyFile: "key.txt", model: "m" }), home)).toBeNull(); // relative key file
  });

  it("STUDIO_PREFIX is correct", () => {
    expect(STUDIO_PREFIX).toBe("/studio/v1/");
  });

  it("studioUpstreamPath maps allowed paths", () => {
    expect(studioUpstreamPath("/studio/v1/models", "GET")).toBe("/models");
    expect(studioUpstreamPath("/studio/v1/chat/completions", "POST")).toBe("/chat/completions");
  });

  it("studioUpstreamPath returns null for disallowed paths", () => {
    expect(studioUpstreamPath("/studio/v1/models", "POST")).toBeNull();
    expect(studioUpstreamPath("/studio/v1/chat/completions", "GET")).toBeNull();
    expect(studioUpstreamPath("/studio/v1/embeddings", "POST")).toBeNull();
    expect(studioUpstreamPath("/studio/v1/../admin", "GET")).toBeNull();
    expect(studioUpstreamPath("/studio/v2/models", "GET")).toBeNull();
    expect(studioUpstreamPath("/models", "GET")).toBeNull();
  });
});

describe("resolving the Studio's name", () => {
  const both = "name: studio.local\nipv6_address: fe80:f::1\nipv6_address: 2601:1::2\n\nname: studio.local\nip_address: 10.0.0.63\n";

  it("prefers the IPv4 address", () => {
    expect(addressFromDscacheutil(both)).toBe("10.0.0.63");
  });

  it("falls back to an IPv6 address that is not link-local", () => {
    expect(addressFromDscacheutil("name: s.local\nipv6_address: fe80:f::1\nipv6_address: 2601:1::2\n")).toBe("2601:1::2");
  });

  it("gives null when there is no usable address", () => {
    expect(addressFromDscacheutil("")).toBeNull();
    expect(addressFromDscacheutil("name: s.local\nipv6_address: fe80:f::1\n")).toBeNull();
  });

  it("looks up names but not addresses", () => {
    expect(needsLookup("Mac-Studio.local")).toBe(true);
    expect(needsLookup("studio")).toBe(true);
    expect(needsLookup("10.0.0.63")).toBe(false);
    expect(needsLookup("[2601:1::2]")).toBe(false);
    expect(needsLookup("bad host")).toBe(false);
    expect(needsLookup("-x")).toBe(false);
  });
});
