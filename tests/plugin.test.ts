import { describe, expect, it } from "vitest";
import { nostr } from "../src/index";

describe("nostr() server plugin factory", () => {
  it("returns a plugin with the expected id", () => {
    expect(nostr().id).toBe("nostr");
  });

  it("registers the three endpoints", () => {
    const plugin = nostr();
    expect(plugin.endpoints.getNostrNonce).toBeDefined();
    expect(plugin.endpoints.loginNostr).toBeDefined();
    expect(plugin.endpoints.addPubkey).toBeDefined();
  });

  it("registers a nostrPubkey schema with the right fields", () => {
    const schema = nostr().schema?.nostrPubkey;
    expect(schema).toBeDefined();
    expect(schema!.modelName).toBe("nostrPubkey");
    expect(schema!.fields.publicKey?.unique).toBe(true);
    expect(schema!.fields.publicKey?.index).toBe(true);
    expect(schema!.fields.publicKey?.required).toBe(true);
    expect(schema!.fields.userId?.required).toBe(true);
    expect(schema!.fields.userId?.index).toBe(true);
    expect(schema!.fields.userId?.references).toEqual({
      model: "user",
      field: "id",
      onDelete: "cascade",
    });
    expect(schema!.fields.createdAt?.type).toBe("date");
    expect(schema!.fields.name?.required).toBe(false);
  });

  it("honors options.modelName", () => {
    expect(
      nostr({ modelName: "nostrIdentity" }).schema?.nostrPubkey.modelName,
    ).toBe("nostrIdentity");
  });

  it("honors options.fields renaming", () => {
    const fields = nostr({
      fields: {
        publicKey: "pub_key",
        userId: "owner_id",
        createdAt: "created_at",
        name: "label",
      },
    }).schema?.nostrPubkey.fields;
    expect(fields?.publicKey?.fieldName).toBe("pub_key");
    expect(fields?.userId?.fieldName).toBe("owner_id");
    expect(fields?.createdAt?.fieldName).toBe("created_at");
    expect(fields?.name?.fieldName).toBe("label");
  });

  it("falls back to default field names when options.fields is omitted", () => {
    const fields = nostr().schema?.nostrPubkey.fields;
    expect(fields?.publicKey?.fieldName).toBe("publicKey");
    expect(fields?.userId?.fieldName).toBe("userId");
    expect(fields?.createdAt?.fieldName).toBe("createdAt");
    expect(fields?.name?.fieldName).toBe("name");
  });
});
