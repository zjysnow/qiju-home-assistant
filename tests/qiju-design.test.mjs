import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const portrait = await readFile(new URL("../assets/pet/qiju-portrait.svg", import.meta.url), "utf8");
const page = await readFile(new URL("../qiju-design.html", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("the portrait is a self-contained, square, static illustration with named design layers", () => {
  assert.match(portrait, /width="640" height="640" viewBox="0 0 640 640"/);
  assert.match(portrait, /aria-labelledby="title description"/);
  assert.match(portrait, /约两头身/);
  for (const id of ["hood-back", "hood-drape", "back-hair", "small-body", "legs", "dress-bodice", "waistband", "skirt-inner", "skirt-outer", "skirt-veil", "swallow-brooch", "swallow-tail-ribbon", "swallow-embroidery", "arm-left", "arm-right", "cuff-left", "cuff-right", "face", "eye-left", "eye-right", "fringe", "hood-front", "wing-clip", "hand-left", "hand-right"]) {
    assert.ok(portrait.includes(`id="${id}"`), id);
  }
  assert.doesNotMatch(portrait, /<script\b|<animate\w*\b|<set\b|<image\b|<foreignObject\b|\bon\w+=|animation\s*:/i);
  assert.doesNotMatch(portrait, /(?:href|src)=|@import/);
});

test("the head layers shrink uniformly around the chin without scaling the body", () => {
  for (const id of ["hood-drape", "hood-back", "back-hair", "face", "fringe", "hood-front", "wing-clip"]) {
    assert.match(portrait, new RegExp(`<g id="${id}" transform="translate\\(19\\.2 26\\.88\\) scale\\(\\.94\\)(?: |")`));
  }
  assert.match(portrait, /<g id="small-body">/);
});

test("the dress and sleeves share one silhouette with light raglan seams and a simple chest panel", () => {
  const outline = portrait.match(/<path id="upper-dress"[^>]+d="([^"]+)"/);
  assert.ok(outline);
  assert.equal((outline[1].match(/M/g) || []).length, 1);
  assert.ok(outline[1].endsWith("Z"));
  assert.ok(outline[1].includes("252 508L271 517"));
  assert.ok(outline[1].includes("369 517L388 508"));
  for (const side of ["left", "right"]) {
    assert.ok(portrait.indexOf('id="upper-dress"') < portrait.indexOf(`<g id="arm-${side}">`));
    assert.match(portrait, new RegExp(`<path id="sleeve-${side}" fill="none"`));
  }
  assert.match(portrait, /id="bodice-inset" fill="#d8f3fb"/);
  assert.match(portrait, /id="dress-collar"/);
  assert.match(portrait, /id="swallow-pendant"[^>]+scale\(\.55\)/);
  assert.doesNotMatch(portrait, /M292 473Q319 506 350 473|M303 461Q322 472/);
});

test("the hands have continuous wrist and palm outlines beneath light fabric cuffs", () => {
  for (const side of ["left", "right"]) {
    const hand = portrait.match(new RegExp(`<g id="hand-${side}">([\\s\\S]*?)</g>`));
    assert.ok(hand);
    assert.equal([...hand[1].matchAll(/<path\b/g)].length, 2);
    assert.match(hand[1], new RegExp(`id="palm-${side}" fill="url\\(#skin\\)"`));
    assert.doesNotMatch(hand[1], /#d8aeb6/);
    assert.match(portrait, new RegExp(`id="cuff-${side}" fill="#e6f5ff"`));
    assert.ok(portrait.indexOf(`<g id="hand-${side}">`) < portrait.indexOf(`<g id="arm-${side}">`));
  }
  assert.match(portrait, /id="palm-left"[^>]+d="M256 512L266 516L264 523/);
  assert.match(portrait, /id="palm-right"[^>]+d="M384 512L374 516L376 523/);
});

test("the longer hair is drawn behind the body while keeping the existing root transform", () => {
  for (const id of ["hair-silhouette", "hair-lengths"]) {
    assert.match(portrait, new RegExp(`<path id="${id}"`));
  }
  assert.ok(portrait.indexOf('id="hair-lengths"') < portrait.indexOf('id="small-body"'));
  assert.match(portrait, /id="back-hair" transform="translate\(19\.2 26\.88\) scale\(\.94\) translate\(-32 67\.5\) scale\(1\.1 \.85\)"/);
});

test("all illustration gradients and eye masks resolve to unique local SVG definitions", () => {
  const ids = [...portrait.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of portrait.matchAll(/url\(#([^)]+)\)/g)) {
    assert.ok(ids.includes(id), `Missing definition: ${id}`);
  }
  for (const id of ["title", "description"]) {
    assert.ok(ids.includes(id));
  }
});

test("the independent review page offers large art, a desktop-size preview and the original download", () => {
  assert.match(page, /lang="zh-CN"/);
  assert.match(page, /name="viewport"/);
  assert.match(page, /class="portrait"[^>]+width="640" height="640"/);
  assert.match(page, /width="128" height="128"/);
  assert.match(page, /download="qiju-portrait.svg"/);
  assert.match(page, /不替换当前默认守岸人/);
  assert.doesNotMatch(page, /<script\b|<iframe\b|<form\b|animation\s*:|@keyframes/i);
  for (const [, src] of page.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    assert.equal(src, "/assets/pet/qiju-portrait.svg");
  }
});

test("both review resources are explicitly served without changing the app's default model", () => {
  assert.ok(server.includes('["/qiju-design.html", ["qiju-design.html", "text/html; charset=utf-8"]]'));
  assert.ok(server.includes('["/assets/pet/qiju-portrait.svg", ["assets/pet/qiju-portrait.svg", "image/svg+xml"]]'));
  assert.match(index, /href="\/qiju-design.html" target="_blank" rel="noopener noreferrer"/);
  const startup = app.slice(app.indexOf("function startDefaultPetModel()"), app.indexOf("function updatePetModelControls()"));
  assert.match(startup, /value = "shorekeeper"/);
  assert.match(startup, /return enableBongoModel\(\)/);
});
