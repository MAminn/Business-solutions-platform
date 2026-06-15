import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCreativeName } from "./display-name";

test("token-only name falls back to DPA label for type DPA", () => {
  assert.equal(
    cleanCreativeName({ name: "{{product.name}}", type: "DPA" }),
    "Dynamic product ad",
  );
});

test("token-only name falls back to generic label for non-DPA type", () => {
  assert.equal(
    cleanCreativeName({ name: "{{product.name}}", type: "IMAGE" }),
    "Untitled creative",
  );
});

test("tokens are stripped and meaningful remainder is kept", () => {
  assert.equal(
    cleanCreativeName({
      name: "{{product.name}} 2026-06-02-e6b0",
      type: "DPA",
    }),
    "2026-06-02-e6b0",
  );
});

test("null name with meaningful headline returns cleaned headline", () => {
  assert.equal(
    cleanCreativeName({
      name: null,
      headline: "{{product.brand}} Summer Sale",
      type: "DPA",
    }),
    "Summer Sale",
  );
});

test("null name, no headline, type DPA -> Dynamic product ad", () => {
  assert.equal(
    cleanCreativeName({ name: null, headline: null, type: "DPA" }),
    "Dynamic product ad",
  );
});

test("normal name with no tokens is returned unchanged", () => {
  assert.equal(
    cleanCreativeName({ name: "Spring Promo - Hero A", type: "IMAGE" }),
    "Spring Promo - Hero A",
  );
});

test("name that is only punctuation/dashes falls back", () => {
  assert.equal(
    cleanCreativeName({ name: " - _ · | / ", type: "OTHER" }),
    "Untitled creative",
  );
});
