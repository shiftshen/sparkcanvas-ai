import assert from "node:assert/strict";

import {
  contrastText,
  createBrandTheme,
  darken,
  hexToRgb,
  lighten,
} from "../themeResolver.js";

function testDefaultBrandTheme() {
  const theme = createBrandTheme({ primary: "#4F46E5" });

  assert.equal(theme.light.primary, "#4F46E5");
  assert.equal(theme.dark.surface, "#020617");
  assert.equal(theme.light.focusRing, "rgba(79, 70, 229, 0.4)");
  assert.equal(theme.dark.text, "#F8FAFC");
  assert.ok(theme.light.border.startsWith("#"));
  assert.ok(theme.dark.surfaceOverlay.startsWith("rgba("));
}

function testPrimaryDerivatives() {
  const theme = createBrandTheme({ primary: "#3366CC" });

  assert.equal(theme.light.primaryHover, darken("#3366CC", 0.1));
  assert.equal(theme.light.primaryActive, darken("#3366CC", 0.2));
  assert.equal(theme.dark.primaryHover, lighten("#3366CC", 0.1));
  assert.equal(theme.dark.primaryActive, lighten("#3366CC", 0.2));
}

function testUtilityLightness() {
  assert.equal(lighten("#000000", 0.5), "#808080");
  assert.equal(darken("#FFFFFF", 0.5), "#808080");
  assert.deepEqual(hexToRgb("#ABCDEF"), [171, 205, 239]);
}

function testContrastText() {
  assert.equal(contrastText("#FFFFFF"), "black");
  assert.equal(contrastText("#111827"), "white");
}

function testOverridesAndDarkFromLight() {
  const theme = createBrandTheme(
    { primary: "#22C55E" },
    { light: { accent: "#F97316" }, dark: { borderStrong: "#FFFFFF" } },
    { darkFromLight: true },
  );

  assert.equal(theme.light.accent, "#F97316");
  assert.equal(theme.dark.borderStrong, "#FFFFFF");
  assert.equal(theme.dark.textInverse, "#0F172A");
}

function run() {
  testDefaultBrandTheme();
  testPrimaryDerivatives();
  testUtilityLightness();
  testContrastText();
  testOverridesAndDarkFromLight();
  console.log("themeResolver tests passed");
}

run();
