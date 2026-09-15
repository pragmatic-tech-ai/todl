import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphTierPalette } from "../graph-tier-palette.js";
import { GraphTier } from "../todl-graph-model.js";

describe("GraphTierPalette.fillHex — scheme-aware tile palette", () => {
  const tiers = [GraphTier.Meta, GraphTier.Ontology, GraphTier.Instance];

  test("light scheme returns the light washes", () => {
    assert.equal(GraphTierPalette.fillHex(GraphTier.Meta, false), "#f3e5f5");
    assert.equal(GraphTierPalette.fillHex(GraphTier.Ontology, false), "#e3f2fd");
    assert.equal(GraphTierPalette.fillHex(GraphTier.Instance, false), "#e8f5e9");
  });

  test("dark scheme returns the dark tints", () => {
    assert.equal(GraphTierPalette.fillHex(GraphTier.Meta, true), "#3a2f3f");
    assert.equal(GraphTierPalette.fillHex(GraphTier.Ontology, true), "#263445");
    assert.equal(GraphTierPalette.fillHex(GraphTier.Instance, true), "#24352a");
  });

  test("each tier's dark tint differs from its light wash, and tiers are distinct", () => {
    const dark = tiers.map((t) => GraphTierPalette.fillHex(t, true));
    const light = tiers.map((t) => GraphTierPalette.fillHex(t, false));
    for (let i = 0; i < tiers.length; i++) assert.notEqual(dark[i], light[i]);
    assert.equal(new Set(dark).size, tiers.length, "dark tiers must be distinct");
    assert.equal(new Set(light).size, tiers.length, "light tiers must be distinct");
  });
});
