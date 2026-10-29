import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { BONGO_MODELS, getBongoParameters } from "../bongo-renderer.js";

const root = new URL("../assets/bongocat/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("cat.model3.json", root), "utf8"));
const display = JSON.parse(await readFile(new URL("demomodel.cdi3.json", root), "utf8"));

test("the real model's binary, textures, expressions, motions and licenses are bundled locally", async () => {
  const refs = manifest.FileReferences;
  const files = [
    refs.Moc, refs.DisplayInfo, ...refs.Textures, ...refs.Expressions.map((item) => item.File),
    ...Object.values(refs.Motions).flatMap((motions) => motions.flatMap((item) => [item.File, item.Sound].filter(Boolean))),
    "LICENSE-MIT.txt", "LIVE2D-LICENSE.html", "NOTICE.txt",
  ];
  await Promise.all(files.map(async (file) => {
    assert.ok(!file.startsWith("/") && !file.includes(".."), file);
    assert.ok((await stat(new URL(file, root))).size > 0, file);
  }));
  const license = await readFile(new URL("LICENSE-MIT.txt", root), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /vladelaina/);
  const moc = await readFile(new URL(refs.Moc, root));
  assert.equal(moc.subarray(0, 4).toString(), "MOC3");
});

test("all driven parameters belong to the bundled model's published parameter catalog", () => {
  const ids = new Set(display.Parameters.map((item) => item.Id));
  for (const state of ["idle", "typing", "listening", "thinking", "happy", "speaking", "sleep", "dance"]) {
    for (const [id, value] of Object.entries(getBongoParameters(state, 300))) {
      assert.ok(ids.has(id), id);
      assert.ok(Number.isFinite(value), `${state}: ${id}`);
    }
  }
});

test("typing alternates the actual keyboard and mouse paw parameters, then releases both", () => {
  const first = getBongoParameters("typing", 80);
  const second = getBongoParameters("typing", 280);
  assert.equal(first.CatParamLeftHandDown + first.ParamMouseLeftDown, 1);
  assert.notEqual(first.CatParamLeftHandDown, second.CatParamLeftHandDown);
  const idle = getBongoParameters("idle", 300);
  assert.equal(idle.CatParamLeftHandDown, 0);
  assert.equal(idle.ParamMouseLeftDown, 0);
});

test("gaze is clamped, sleep closes eyes, happy waves and speaking is time-dependent", () => {
  const gaze = getBongoParameters("idle", 0, { x: 100, y: -100 });
  assert.equal(gaze.ParamAngleX, 12);
  assert.equal(gaze.ParamAngleY, -8);
  assert.equal(gaze.ParamMouseX, 30);
  assert.equal(gaze.ParamMouseY, -30);
  assert.equal(getBongoParameters("sleep", 0).ParamEyeLOpen, .1);
  assert.equal(getBongoParameters("happy", 0).Param3, 30);
  assert.notEqual(getBongoParameters("speaking", 0).ParamMouthOpenY, getBongoParameters("speaking", 80).ParamMouthOpenY);
});

test("reduced motion is static across time, with no typing, pointer movement or blinking", () => {
  const first = getBongoParameters("typing", 100, { x: .8, y: -.3 }, true);
  assert.deepEqual(first, getBongoParameters("typing", 5300, { x: -.6, y: .9 }, true));
  assert.equal(first.CatParamLeftHandDown, 0);
  assert.equal(first.ParamMouseLeftDown, 0);
  assert.equal(first.ParamEyeLOpen, 1);
});

test("Shorekeeper only drives supported basic parameters, without watermark or locked-expression controls", () => {
  const allowed = new Set([
    "ParamAngleX", "ParamAngleY", "ParamAngleZ", "ParamMouseX", "ParamMouseY",
    "CatParamLeftHandDown", "ParamMouseLeftDown", "ParamMouseRightDown",
    "ParamEyeLOpen", "ParamEyeROpen", "ParamMouthOpenY", "ParamBreath",
    "ParamEyeBallX", "ParamEyeBallY",
  ]);
  for (const state of ["idle", "typing", "listening", "thinking", "happy", "speaking", "sleep", "dance"]) {
    const values = getBongoParameters(state, 280, { x: .5, y: -.5 }, false, "shorekeeper");
    for (const id of Object.keys(values)) assert.ok(allowed.has(id), id);
    assert.equal(values.ParamEyeBallX, .5);
    assert.equal(values.ParamEyeBallY, -.5);
  }
  assert.deepEqual(
    getBongoParameters("typing", 80, { x: 1, y: 1 }, true, "shorekeeper"),
    getBongoParameters("typing", 5300, { x: -1, y: -1 }, true, "shorekeeper"),
  );
  assert.throws(() => getBongoParameters("idle", 0, undefined, false, "unknown"), /不支持/);
  assert.equal(BONGO_MODELS.shorekeeper.url, "/assets/pet-models/shorekeeper/cat.model3.json");
});

test("Shorekeeper breathing never enters the trial model's hidden-body keyforms", () => {
  for (const state of ["idle", "typing", "listening", "thinking", "happy", "speaking", "sleep", "dance"]) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let elapsed = 0; elapsed <= 12000; elapsed += 16) {
      const { ParamBreath } = getBongoParameters(state, elapsed, undefined, false, "shorekeeper");
      assert.ok(ParamBreath >= .05 - 1e-10 && ParamBreath <= .45, `${state} at ${elapsed}: ${ParamBreath}`);
      minimum = Math.min(minimum, ParamBreath);
      maximum = Math.max(maximum, ParamBreath);
    }
    assert.ok(maximum - minimum > .39, "breathing remains animated, not frozen");
    assert.equal(getBongoParameters(state, 5300, undefined, true, "shorekeeper").ParamBreath, .25);
  }
  assert.ok(getBongoParameters("idle", 800).ParamBreath > .5, "the standard model keeps its original breathing range");
});

test("the installed private Shorekeeper model has complete resources, declared parameters and author terms", async (t) => {
  const local = new URL("../data/pet-models/shorekeeper/", import.meta.url);
  let contents;
  try {
    contents = await readFile(new URL("cat.model3.json", local), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Shorekeeper is a separately licensed local asset, not distributed with the repository");
    return;
  }
  const refs = JSON.parse(contents).FileReferences;
  const files = [
    refs.Moc, refs.Physics, refs.DisplayInfo, ...refs.Textures, "LICENSE.txt",
    ...Object.values(refs.Motions).flatMap((motions) => motions.map((item) => item.File)),
  ];
  await Promise.all(files.map(async (file) => assert.ok((await stat(new URL(file, local))).size > 0, file)));
  const catalog = JSON.parse(await readFile(new URL(refs.DisplayInfo, local), "utf8"));
  const ids = new Set(catalog.Parameters.map((item) => item.Id));
  for (const id of Object.keys(getBongoParameters("idle", 0, undefined, false, "shorekeeper"))) assert.ok(ids.has(id), id);
  const terms = await readFile(new URL("LICENSE.txt", local), "utf8");
  assert.match(terms, /宇痕冫/);
  assert.match(terms, /禁止二次售卖/);
});
