import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const rendererSource = await readFile(new URL("../pet-renderer.js", import.meta.url), "utf8");
const markupSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");

class Element {
  constructor() {
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, enabled = !classes.has(name)) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    };
    this.style = {
      setProperty(name, value) { this[name] = value; },
      removeProperty(name) { delete this[name]; },
    };
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
    this.textContent = "";
    this.value = "";
    this.offsetWidth = 128;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  contains() { return false; }
  focus() {}
  get offsetHeight() {
    return Math.min(this.naturalHeight || 152, Number.parseFloat(this.style.maxHeight) || Infinity);
  }
  getBoundingClientRect() {
    const rect = this.geometry?.() || { left: 0, top: 0, width: 128, height: 152 };
    return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height };
  }
  matches(selector) {
    return selector.split(",").some((part) => this.classList.contains(part.trim().slice(1)));
  }
}

function harness({ reducedMotion = false } = {}) {
  const elements = new Map();
  let dialogOpen = false;
  const querySelector = (selector) => {
    if (selector === "dialog[open]") return dialogOpen ? querySelector("#dialog") : null;
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const widget = querySelector("#pet-widget");
  widget.dataset.petAvatar = "qiju";
  querySelector("#pet-model-choice").value = "qiju";
  widget.querySelector = querySelector;
  const ghost = querySelector("#pet-ghost");
  ghost.dataset.form = "swallow";
  ghost.hidden = true;
  querySelector("#pet-panel").hidden = true;
  const timers = new Map();
  let clock = 0;
  let nextTimer = 0;
  let observerCallback;
  const preference = { matches: reducedMotion };
  const context = vm.createContext({
    document: { querySelector, hidden: false },
    performance: { now: () => clock },
    window: {
      innerWidth: 1280,
      innerHeight: 900,
      matchMedia: (query) => query.includes("reduced-motion")
        ? preference
        : { matches: context.window.innerWidth <= 760 },
    },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay, due: clock + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (callback) => {
      const id = ++nextTimer;
      timers.set(id, { callback: () => callback(clock), delay: 16, due: clock + 16 });
      return id;
    },
    cancelAnimationFrame: (id) => timers.delete(id),
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe(target, options) {
        assert.equal(target, widget);
        assert.equal(options.attributeFilter.join(), "class");
      }
    },
  });
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;
  widget.geometry = () => {
    const mobile = context.window.innerWidth <= 760;
    const width = widget.dataset.petAvatar === "cat" ? 128 : mobile ? 144 : 176;
    const height = widget.dataset.petAvatar === "cat" ? 152 : mobile ? 204 : 244;
    return {
      left: context.window.innerWidth - width - (mobile ? 8 : 24),
      top: context.window.innerHeight - height - (mobile ? 73 : 22),
      width, height,
    };
  };
  ghost.geometry = () => {
    const position = ghost.style.transform?.match(/translate\(([\d.]+)px, ([\d.]+)px\)/);
    return { left: Number(position?.[1] || 0), top: Number(position?.[2] || 0), width: 96, height: 112 };
  };
  vm.runInContext(appSource.slice(0, appSource.indexOf('document.querySelector("#add-device").addEventListener')), context);
  vm.runInContext('currentUser = { id: "test-user" }; Math.random = () => 0.5;', context);
  // The renderer has its own module scope in the browser.
  vm.runInContext(`{ ${rendererSource} }`, context);
  return {
    context, widget, ghost, preference, timers, querySelector,
    run: (source) => vm.runInContext(source, context),
    updateState: () => observerCallback(),
    setDialogOpen: (open) => { dialogOpen = open; },
    advance(milliseconds) {
      const target = clock + milliseconds;
      for (let count = 0; count < 1000; count += 1) {
        const next = [...timers].filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        clock = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      clock = target;
    },
  };
}

test("the 2D renderer selects exactly one prioritized state including idle projection", () => {
  const h = harness();
  assert.equal(h.widget.dataset.petState, "idle");
  const states = [
    ["is-projecting", "projecting"], ["is-typing", "typing"], ["is-reacting", "happy"],
    ["is-speaking", "speaking"], ["is-thinking", "thinking"], ["is-listening", "listening"],
  ];
  for (const [className, state] of states) {
    h.widget.classList.add(className);
    h.updateState();
    assert.equal(h.widget.dataset.petState, state);
  }
});

test("missing character markup fails explicitly", () => {
  assert.throws(() => vm.runInNewContext(rendererSource, {
    document: { querySelector: () => null },
  }), /2D pet could not find/);
});

test("projection appears only after 20 seconds of inactivity and never moves the dock", () => {
  const h = harness();
  const dock = h.widget.getBoundingClientRect();
  h.run("startPetCompanion()");
  h.advance(19999);
  assert.equal(h.ghost.hidden, true);
  h.advance(1);
  assert.equal(h.ghost.hidden, false);
  assert.equal(h.widget.classList.contains("is-projecting"), true);
  assert.deepEqual(h.widget.getBoundingClientRect(), dock);
  assert.equal(h.widget.style.left, undefined);
  assert.equal(h.widget.style.transform, undefined);
});

test("user activity synchronously starts the return and resets the complete idle delay", () => {
  const h = harness();
  h.run("startPetCompanion()");
  h.advance(20000);
  h.run("notePetActivity()");
  assert.equal(h.ghost.hidden, false);
  assert.equal(h.widget.dataset.projectionPhase, "returning");
  assert.equal(h.ghost.dataset.projectionPhase, "returning");
  assert.equal(h.widget.inert, false);
  assert.equal(h.run("petGhostFrame"), null);
  h.advance(639);
  assert.equal(h.ghost.hidden, false);
  h.advance(1);
  assert.equal(h.ghost.hidden, true);
  h.advance(19359);
  assert.equal(h.ghost.hidden, true);
  h.advance(1);
  assert.equal(h.ghost.hidden, false);
});

test("repeated activity prevents projection, including during a long session", () => {
  const h = harness();
  h.run("startPetCompanion()");
  for (let iteration = 0; iteration < 10; iteration += 1) {
    h.advance(15000);
    h.run("notePetActivity()");
    h.advance(640);
    assert.equal(h.ghost.hidden, true);
  }
  assert.equal(h.timers.size, 2, "Only projection and ambient scheduling remain");
});

test("the projected spirit flies through intermediate positions instead of easing between distant CSS transforms", () => {
  const h = harness();
  h.run("startPetCompanion()");
  h.advance(20000);
  const first = h.ghost.style.transform;
  h.advance(6500);
  const second = h.ghost.style.transform;
  assert.notEqual(first, second);
  h.advance(6500);
  assert.notEqual(h.ghost.style.transform, second);
  assert.equal(h.ghost.classList.contains("is-flying"), true);
  assert.ok(h.run("petGhostFrame") !== null);
  assert.doesNotMatch(styleSource, /transition:\s*transform 6\.5s/);
});

test("flight direction selects front, quarter and side silhouettes and faces the direction of travel", () => {
  for (const [left, top, view, facing] of [
    [700, 300, "side", "1"], [250, 300, "side", "-1"],
    [400, 100, "front", "1"], [400, 550, "front", "1"],
    [650, 100, "quarter", "1"], [250, 100, "quarter", "-1"],
  ]) {
    const h = harness();
    h.run(`getPetGhostDestination = () => ({left: ${left}, top: ${top}}); previewPetProjection()`);
    h.ghost.style.transform = "translate(400px, 300px)";
    h.advance(640);
    assert.equal(h.ghost.dataset.flightView, view);
    assert.equal(h.ghost.style["--pet-flight-facing"], facing);
    assert.equal(h.ghost.style.transform, "translate(400px, 300px)", "Flight starts here, not at its distant target");
    const heading = Number.parseFloat(h.ghost.style["--pet-flight-heading"]) * Math.PI / 180;
    const distance = Math.hypot(left - 400, top - 300);
    const alignment = Math.sin(heading) * (left - 400) / distance - Math.cos(heading) * (top - 300) / distance;
    assert.ok(alignment > .999, `Body must face its flight tangent: ${view}`);
    h.advance(160);
    const position = h.ghost.getBoundingClientRect();
    const travelled = Math.hypot(position.left - 400, position.top - 300);
    assert.ok(travelled > 8 && travelled < 30, "Visible flight, not a long hover or target teleport");
    h.run("hidePetProjection({immediate:true})");
    assert.equal(h.run("petGhostFrame"), null);
    assert.equal(h.run("petGhostFlight"), null);
    assert.equal(h.timers.size, 0);
  }
});

test("curved flight retains the incoming tangent and banks while changing heading", () => {
  const h = harness();
  const flight = h.run("createPetGhostFlight({left:400,top:300},{left:750,top:300},-Math.PI/2,0)");
  h.context.flight = flight;
  assert.ok(Math.abs(h.run("getPetFlightPoint(flight,0).heading") + Math.PI / 2) < .001);
  assert.ok(h.run("getPetFlightPoint(flight,.5).top") < 280, "The turn is a real arc, not a straight translation");
  assert.ok(flight.duration >= 900 && flight.duration <= 6500);
  h.run("previewPetProjection()");
  h.advance(640);
  h.run("petGhostFlight = flight; flight.startedAt = performance.now(); flight.lastFrame = performance.now()");
  h.advance(800);
  assert.ok(Math.abs(Number.parseFloat(h.ghost.style["--pet-flight-bank"])) > 1);
  assert.ok(Math.abs(Number.parseFloat(h.ghost.style["--pet-flight-heading"])) > 5);
});

test("preview closes the panel and shows the projection without waiting 20 seconds", () => {
  const h = harness();
  h.querySelector("#pet-panel").hidden = false;
  h.run("triggerPetReaction(); previewPetProjection()");
  assert.equal(h.querySelector("#pet-panel").hidden, true);
  assert.equal(h.ghost.hidden, false);
  h.run("notePetActivity()");
  h.advance(640);
  assert.equal(h.ghost.hidden, true);
});

test("a closing panel's queued scroll event does not immediately cancel its preview", () => {
  const h = harness();
  h.run('previewPetProjection(); notePetActivity({ type: "scroll", target: document.querySelector("#pet-panel") })');
  assert.equal(h.ghost.hidden, false);
  h.querySelector("#pet-panel").hidden = false;
  h.run('notePetActivity({ type: "scroll", target: document.querySelector("#pet-panel") })');
  h.advance(640);
  assert.equal(h.ghost.hidden, true);
});

for (const state of ["is-listening", "is-thinking", "is-speaking", "is-typing", "is-reacting"]) {
  test(`projection waits while ${state} is active and retries afterwards`, () => {
    const h = harness();
    h.widget.classList.add(state);
    h.run("startPetCompanion()");
    h.advance(20000);
    assert.equal(h.ghost.hidden, true);
    h.widget.classList.remove(state);
    h.advance(3000);
    assert.equal(h.ghost.hidden, false);
  });
}

test("panel and dialogs suppress projection without changing the saved toggle", () => {
  const h = harness();
  h.run("startPetCompanion(); setPetPanelOpen(true)");
  h.advance(20000);
  assert.equal(h.ghost.hidden, true);
  h.run("setPetPanelOpen(false)");
  h.setDialogOpen(true);
  h.advance(20000);
  assert.equal(h.ghost.hidden, true);
  h.setDialogOpen(false);
  h.advance(3000);
  assert.equal(h.ghost.hidden, false);
  assert.equal(h.run("petProjectionEnabled"), true);
});

test("a dialog appearing during flight stops further motion", () => {
  const h = harness();
  h.run("startPetCompanion()");
  h.advance(20000);
  h.setDialogOpen(true);
  h.advance(6500);
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.run("petGhostFrame"), null);
});

test("disabling projection cancels idle and flight frames, including manual preview", () => {
  const h = harness();
  h.run("startPetCompanion()");
  h.advance(20000);
  h.run("setPetProjectionEnabled(false); previewPetProjection()");
  h.advance(640);
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.run("petIdleTimer"), null);
  assert.equal(h.run("petGhostFrame"), null);
  assert.equal(h.timers.size, 1, "Dock behaviors remain enabled when projection is off");
  assert.equal(h.querySelector("#pet-projection-preview").disabled, true);
});

test("background visibility and logout leave no projection or pending timers", () => {
  const h = harness();
  h.run("startPetCompanion()");
  h.advance(20000);
  h.context.document.hidden = true;
  h.run("hidePetProjection(); schedulePetProjection()");
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.timers.size, 0);
  h.context.document.hidden = false;
  h.run("notePetActivity()");
  h.advance(20000);
  assert.equal(h.ghost.hidden, false);
  h.run("resetPetCompanion()");
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.timers.size, 0);
});

test("reduced motion suppresses even manual preview while retaining the user's preference", () => {
  const h = harness({ reducedMotion: true });
  h.run("startPetCompanion(); previewPetProjection()");
  h.advance(60000);
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.run("petProjectionEnabled"), true);
  assert.match(h.querySelector("#pet-projection-status").textContent, /减少动态效果/);
  h.preference.matches = false;
  h.run("updatePetProjectionControls(); notePetActivity()");
  h.advance(20000);
  assert.equal(h.ghost.hidden, false);
});

test("ghost destinations fit small, portrait, landscape and desktop viewports and avoid the dock", () => {
  const h = harness();
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 900]]) {
    h.context.window.innerWidth = width;
    h.context.window.innerHeight = height;
    for (const random of [0, 0.5, 0.999]) {
      h.run(`Math.random = () => ${random}`);
      const { left, top } = h.run("getPetGhostDestination()");
      assert.ok(left >= 12 && left + 96 <= width - 12);
      assert.ok(top >= 76 && top + 112 <= height - (width <= 760 ? 88 : 16));
      const dock = h.widget.getBoundingClientRect();
      assert.ok(left + 96 <= dock.left - 12 || top + 112 <= dock.top - 12);
    }
  }
});

test("complete curved flights stay inside viewport bounds and avoid the dock between safe endpoints", () => {
  const h = harness();
  h.run("let flightSeed = 42; Math.random = () => ((flightSeed = (flightSeed * 1664525 + 1013904223) >>> 0) / 4294967296)");
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
    h.context.window.innerWidth = width;
    h.context.window.innerHeight = height;
    const failures = h.run(`(() => {
      const failures = [];
      const bounds = getPetGhostBounds();
      const dock = document.querySelector("#pet-widget").getBoundingClientRect();
      for (let route = 0; route < 150; route += 1) {
        const from = getPetGhostDestination();
        document.querySelector("#pet-ghost").style.transform = \`translate(\${from.left}px, \${from.top}px)\`;
        const flight = createPetGhostFlight(from, getPetGhostDestination(), Math.random() * Math.PI * 2, 0);
        for (let sample = 0; sample <= 200; sample += 1) {
          const point = getPetFlightPoint(flight, sample / 200);
          if (point.left < bounds.leftMin - .001 || point.left > bounds.leftMax + .001
              || point.top < bounds.topMin - .001 || point.top > bounds.topMax + .001
              || petGhostOverlapsDock(point, dock)) {
            failures.push({route, sample, point});
            break;
          }
        }
      }
      return failures;
    })()`);
    assert.equal(failures.length, 0, `${width}x${height}: ${JSON.stringify(failures.slice(0, 2))}`);
  }
});

test("resize recalls the projection and keeps the assistant anchored", () => {
  const h = harness();
  h.run("startPetCompanion()");
  h.advance(20000);
  h.context.window.innerWidth = 320;
  h.context.window.innerHeight = 568;
  h.run("keepPetInBounds()");
  h.advance(640);
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.widget.style.left, undefined);
  h.advance(20000);
  assert.equal(h.ghost.hidden, false);
});

test("short-screen panels shrink and scroll without moving the character", () => {
  const h = harness();
  const panel = h.querySelector("#pet-panel");
  panel.offsetWidth = 288;
  panel.naturalHeight = 390;
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 900]]) {
    h.context.window.innerWidth = width;
    h.context.window.innerHeight = height;
    const dock = h.widget.getBoundingClientRect();
    h.run("updatePetPanelPlacement()");
    const left = Number.parseFloat(panel.style.left);
    const top = Number.parseFloat(panel.style.top);
    assert.ok(left >= 12 && left + panel.offsetWidth <= width - 12);
    assert.ok(top >= 12 && top + panel.offsetHeight <= height - 12);
    assert.deepEqual(h.widget.getBoundingClientRect(), dock);
  }
});

test("typing recalls projection and stops after 550ms even when text remains", () => {
  const h = harness();
  h.run("startPetCompanion()");
  h.advance(20000);
  h.querySelector("#assistant-input").value = "打开客厅的灯";
  h.run('updatePetTyping({ currentTarget: document.querySelector("#assistant-input") })');
  assert.equal(h.widget.dataset.projectionPhase, "returning");
  assert.equal(h.widget.classList.contains("is-typing"), true);
  h.advance(550);
  assert.equal(h.widget.classList.contains("is-typing"), false);
  assert.notEqual(h.querySelector("#assistant-input").value, "");
  h.advance(90);
  assert.equal(h.ghost.hidden, true);
});

test("blur and logout clear pending typing, reaction and projection timers", () => {
  const h = harness();
  h.querySelector("#assistant-input").value = "你好";
  h.run('updatePetTyping({ currentTarget: document.querySelector("#assistant-input") }); stopPetTyping()');
  assert.equal(h.widget.classList.contains("is-typing"), false);
  h.run("triggerPetReaction(); resetPetCompanion()");
  assert.equal(h.timers.size, 0);
  assert.equal(h.widget.classList.contains("is-reacting"), false);
});

test("custom skins are not replaced by the independent projection", () => {
  const h = harness();
  const avatar = h.querySelector(".pet-avatar");
  avatar.classList.add("has-custom-skin");
  h.run("startPetCompanion()");
  h.advance(20000);
  h.updateState();
  assert.equal(avatar.classList.contains("has-custom-skin"), true);
  assert.equal(h.widget.dataset.petState, "projecting");
});

test("speaking animation follows synthesis events and recalls the projection on start", () => {
  const h = harness();
  let utterance;
  h.context.window.SpeechSynthesisUtterance = class {
    constructor(content) { this.text = content; }
  };
  h.context.window.speechSynthesis = {
    cancel() {},
    speak(value) { utterance = value; },
  };
  h.run('startPetCompanion(); speakAssistantReply("你好，我是小栖")');
  assert.equal(h.widget.classList.contains("is-speaking"), false);
  h.advance(20000);
  utterance.onstart();
  h.updateState();
  assert.equal(h.widget.dataset.projectionPhase, "returning");
  assert.equal(h.widget.dataset.petState, "speaking");
  utterance.onend();
  h.updateState();
  assert.equal(h.widget.dataset.petState, "idle");
  h.advance(640);
  assert.equal(h.ghost.hidden, true);
});

test("voice recognition recalls the projection and clears the listening pose on completion", () => {
  const h = harness();
  let recognition;
  h.context.window.isSecureContext = true;
  h.context.window.SpeechRecognition = class {
    constructor() { recognition = this; }
    start() {}
  };
  const button = h.querySelector("#pet-mic-button");
  button.id = "pet-mic-button";
  h.run("startPetCompanion()");
  h.advance(20000);
  h.run('startVoiceRecognition(document.querySelector("#pet-mic-button"))');
  h.updateState();
  assert.equal(h.widget.dataset.projectionPhase, "returning");
  assert.equal(h.widget.dataset.petState, "listening");
  recognition.onend();
  h.updateState();
  assert.equal(h.widget.dataset.petState, "idle");
  assert.equal(button.attributes["aria-pressed"], "false");
  h.advance(640);
  assert.equal(h.ghost.hidden, true);
});

test("dock disappearance and ghost appearance share the same 640ms entrance phase", () => {
  const h = harness();
  h.run("previewPetProjection()");
  assert.equal(h.widget.dataset.projectionPhase, "entering");
  assert.equal(h.ghost.dataset.projectionPhase, "entering");
  assert.equal(h.widget.inert, true);
  assert.equal(h.widget.attributes["aria-hidden"], "true");
  assert.equal(h.ghost.classList.contains("is-flying"), false);
  h.advance(639);
  assert.equal(h.run("petProjectionPhase"), "entering");
  h.advance(1);
  assert.equal(h.widget.dataset.projectionPhase, "projected");
  assert.equal(h.ghost.dataset.projectionPhase, "projected");
  assert.equal(h.ghost.classList.contains("is-flying"), true);
});

test("the legacy butterfly freezes at its rendered position and does not restart its return on continuous activity", () => {
  const h = harness();
  h.ghost.dataset.form = "butterfly";
  h.run("previewPetProjection()");
  h.advance(640);
  h.ghost.geometry = () => ({ left: 444, top: 222, width: 96, height: 112 });
  h.run("notePetActivity()");
  assert.equal(h.ghost.style.transform, "translate(444px, 222px)");
  assert.equal(h.ghost.classList.contains("is-flying"), false);
  assert.equal(h.widget.attributes["aria-hidden"], undefined);
  for (let count = 0; count < 6; count += 1) {
    h.advance(100);
    h.run("notePetActivity()");
    assert.equal(h.ghost.hidden, false);
  }
  h.advance(40);
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.widget.dataset.projectionPhase, "docked");
  assert.equal(h.timers.size, 2, "Only the next projection and ambient timers remain");
});

test("the light swallow turns and flies home without delaying interaction or restarting the return", () => {
  const h = harness();
  h.run("previewPetProjection()");
  h.advance(640);
  h.ghost.geometry = () => ({ left: 444, top: 222, width: 96, height: 112 });
  h.run("notePetActivity()");
  const dock = h.widget.getBoundingClientRect();
  const target = `translate(${dock.left + (dock.width - 96) / 2}px, ${dock.top + (dock.height - 112) / 2}px)`;
  assert.equal(h.ghost.style.transform, target);
  assert.equal(h.widget.inert, false);
  assert.equal(h.ghost.dataset.projectionPhase, "returning");
  assert.equal(h.run("petGhostFrame"), null);
  const returnTimer = h.run("petProjectionTimer");
  h.advance(300);
  h.run("notePetActivity()");
  assert.equal(h.run("petProjectionTimer"), returnTimer);
  assert.equal(h.ghost.style.transform, target);
  h.advance(340);
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.widget.dataset.projectionPhase, "docked");
});
test("interrupting entrance cancels its pending completion instead of hiding the returning dock", () => {
  const h = harness();
  h.run("previewPetProjection()");
  h.advance(200);
  h.run("notePetActivity()");
  h.advance(440);
  assert.equal(h.widget.dataset.projectionPhase, "returning");
  assert.equal(h.widget.inert, false);
  assert.equal(h.ghost.classList.contains("is-flying"), false);
  h.advance(200);
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.run("petProjectionTimer"), null);
});

test("a new preview cancels a stale return-completion callback", () => {
  const h = harness();
  h.run("previewPetProjection()");
  h.advance(640);
  h.run("notePetActivity()");
  h.advance(200);
  h.run("previewPetProjection()");
  h.advance(440);
  assert.equal(h.widget.dataset.projectionPhase, "entering");
  assert.equal(h.ghost.hidden, false);
  h.advance(200);
  assert.equal(h.widget.dataset.projectionPhase, "projected");
  assert.equal(h.ghost.hidden, false);
  assert.equal(h.widget.inert, true);
});

for (const stage of ["entering", "projected", "returning"]) {
  test(`logout immediately cleans the ${stage} transfer without leaving an invisible dock`, () => {
    const h = harness();
    h.run("previewPetProjection()");
    if (stage !== "entering") h.advance(640);
    if (stage === "returning") h.run("notePetActivity()");
    h.run("resetPetCompanion()");
    h.advance(1000);
    assert.equal(h.ghost.hidden, true);
    assert.equal(h.widget.inert, false);
    assert.equal(h.widget.dataset.projectionPhase, "docked");
    assert.equal(h.widget.attributes["aria-hidden"], undefined);
    assert.equal(h.timers.size, 0);
  });
}

test("enabling reduced motion midway through a transfer restores the dock without an exit animation", () => {
  const h = harness();
  h.run("previewPetProjection()");
  h.advance(200);
  h.preference.matches = true;
  h.run("notePetActivity()");
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.widget.inert, false);
  assert.equal(h.widget.dataset.projectionPhase, "docked");
  assert.equal(h.run("petProjectionTimer"), null);
  assert.equal(h.timers.size, 0);
});

for (const [behavior, duration] of [
  ["stretch", 2400], ["groom", 2600], ["sleep", 4200], ["cuddle", 1800],
  ["snack", 2600], ["jump", 1600], ["dance", 3200],
]) {
  test(`${behavior} has an exclusive pose and ends at exactly ${duration}ms`, () => {
    const h = harness();
    assert.equal(h.run(`playPetBehavior("${behavior}")`), true);
    h.updateState();
    assert.equal(h.widget.dataset.petState, behavior);
    h.advance(duration - 1);
    assert.equal(h.widget.classList.contains("is-performing"), true);
    h.advance(1);
    h.updateState();
    assert.equal(h.widget.dataset.petState, "idle");
    assert.equal(h.widget.dataset.petBehavior, undefined);
    assert.equal(h.run("petBehaviorTimer"), null);
  });
}

test("ambient behaviors start within 6–9 seconds, do not repeat and yield to activity", () => {
  const h = harness();
  h.run("setPetProjectionEnabled(false)");
  h.advance(7499);
  assert.equal(h.widget.dataset.petBehavior, undefined);
  h.advance(1);
  const first = h.widget.dataset.petBehavior;
  assert.ok(["stretch", "groom", "sleep"].includes(first));
  h.advance(7500);
  assert.notEqual(h.widget.dataset.petBehavior, first);
  h.run("notePetActivity()");
  assert.equal(h.widget.dataset.petBehavior, undefined);
  assert.equal(h.run("petBehaviorTimer"), null);
});

test("manual play replaces the click reaction, closes the panel and announces feedback", () => {
  const h = harness();
  h.querySelector("#pet-panel").hidden = false;
  h.run('triggerPetReaction(); playPetBehavior("cuddle")');
  h.updateState();
  assert.equal(h.widget.classList.contains("is-reacting"), false);
  assert.equal(h.widget.dataset.petState, "cuddle");
  assert.equal(h.querySelector("#pet-panel").hidden, true);
  assert.match(h.querySelector("#pet-feedback").textContent, /摸摸/);
});

test("rapid action replacement cancels old completion and restarts the same pose", () => {
  const h = harness();
  h.run('playPetBehavior("cuddle")');
  h.updateState();
  h.advance(1000);
  h.run('playPetBehavior("dance")');
  h.updateState();
  h.advance(800);
  assert.equal(h.widget.dataset.petState, "dance");
  h.run('playPetBehavior("dance")');
  assert.equal(h.widget.dataset.petState, "idle", "The old animation is reset before reflow");
  h.updateState();
  h.advance(3199);
  assert.equal(h.widget.dataset.petState, "dance");
  h.advance(1);
  h.updateState();
  assert.equal(h.widget.dataset.petState, "idle");
});

for (const state of ["is-listening", "is-thinking", "is-speaking", "is-typing"]) {
  test(`busy ${state} takes priority and refuses new play`, () => {
    const h = harness();
    h.run('playPetBehavior("dance")');
    h.widget.classList.add(state);
    h.updateState();
    assert.notEqual(h.widget.dataset.petState, "dance");
    assert.equal(h.run('playPetBehavior("jump")'), false);
  });
}

test("typing interrupts play without allowing the old action to resume", () => {
  const h = harness();
  h.run('playPetBehavior("sleep")');
  h.querySelector("#assistant-input").value = "你好";
  h.run('updatePetTyping({ currentTarget: document.querySelector("#assistant-input") })');
  h.updateState();
  assert.equal(h.widget.dataset.petState, "typing");
  h.advance(550);
  h.updateState();
  assert.equal(h.widget.dataset.petState, "idle");
  assert.equal(h.widget.dataset.petBehavior, undefined);
});

test("projection preempts ambient play but waits for a manual action to finish", () => {
  const h = harness();
  h.run('playPetBehavior("sleep", { ambient: true }); showPetProjection()');
  assert.equal(h.widget.dataset.petBehavior, undefined);
  assert.equal(h.widget.dataset.projectionPhase, "entering");
  h.run('notePetActivity(); playPetBehavior("dance"); showPetProjection()');
  assert.equal(h.widget.dataset.projectionPhase, "returning");
  h.advance(3200);
  h.run("showPetProjection()");
  assert.equal(h.widget.dataset.projectionPhase, "entering");
});

test("ambient play pauses for panels, dialogs, recording and hidden tabs", () => {
  for (const blocked of [
    (h) => { h.querySelector("#pet-panel").hidden = false; },
    (h) => { h.setDialogOpen(true); },
    (h) => { h.run("voiceBusy = true"); },
    (h) => { h.context.document.hidden = true; },
  ]) {
    const h = harness();
    h.run("startPetCompanion()");
    blocked(h);
    h.advance(15000);
    assert.equal(h.widget.dataset.petBehavior, undefined);
  }
});

test("reduced motion disables ambient effects but keeps explicit play feedback", () => {
  const h = harness({ reducedMotion: true });
  h.run("startPetCompanion()");
  h.advance(60000);
  assert.equal(h.timers.size, 0);
  assert.equal(h.run('playPetBehavior("sleep", { ambient: true })'), false);
  assert.equal(h.run('playPetBehavior("cuddle")'), true);
  h.updateState();
  assert.equal(h.widget.dataset.petState, "cuddle");
  h.advance(1800);
  h.updateState();
  assert.equal(h.widget.dataset.petState, "idle");
});

test("logout and changing motion/visibility clean up active play and ambient timers", () => {
  for (const cleanup of [
    (h) => h.run("resetPetCompanion()"),
    (h) => { h.preference.matches = true; h.run("notePetActivity()"); },
    (h) => { h.context.document.hidden = true; h.run("notePetActivity()"); },
  ]) {
    const h = harness();
    h.run('startPetCompanion(); playPetBehavior("dance")');
    cleanup(h);
    assert.equal(h.widget.dataset.petBehavior, undefined);
    assert.equal(h.timers.size, 0);
  }
});

test("invalid behaviors fail explicitly and logged-out users cannot play", () => {
  const h = harness();
  assert.throws(() => h.run('playPetBehavior("unknown")'), /Unknown pet behavior/);
  assert.throws(() => h.run('playPetBehavior("__proto__")'), /Unknown pet behavior/);
  h.run("currentUser = null");
  assert.equal(h.run('playPetBehavior("jump")'), false);
  assert.equal(h.timers.size, 0);
});

test("panel delegation never mistakes the widget's active behavior for a play button", () => {
  const h = harness();
  let click;
  const panel = h.querySelector("#pet-panel");
  panel.addEventListener = (name, callback) => {
    assert.equal(name, "click");
    click = callback;
  };
  h.run(appSource.slice(
    appSource.indexOf('document.querySelector("#pet-panel").addEventListener'),
    appSource.indexOf('document.querySelector("#pet-mic-button").addEventListener'),
  ));
  h.run('playPetBehavior("dance")');
  let receivedAction;
  h.context.runPetAction = (action) => { receivedAction = action; };
  click({ target: {
    closest(selector) {
      if (selector === "[data-pet-behavior]") return h.widget;
      if (selector === "[data-pet-action]") return { dataset: { petAction: "devices" } };
      return null;
    },
  } });
  assert.equal(receivedAction, "devices");
  assert.equal(h.widget.dataset.petBehavior, "dance");
});

test("ambient scheduling stays within the stated 6–9 second bounds", () => {
  for (const [random, delay] of [[0, 6000], [0.999999, 8999.997]]) {
    const h = harness();
    h.run(`Math.random = () => ${random}; setPetProjectionEnabled(false)`);
    const timer = h.timers.get(h.run("petAmbientTimer"));
    assert.ok(Math.abs(timer.delay - delay) < 0.001);
    assert.ok(timer.delay >= 6000 && timer.delay <= 9000);
    h.advance(timer.delay - 1);
    assert.equal(h.widget.dataset.petBehavior, undefined);
    h.advance(1);
    assert.ok(h.widget.dataset.petBehavior);
  }
});

test("the original signal spirit has layered human rigs while the classic cat remains selectable", () => {
  assert.match(markupSource, /class="pet-character pet-qiju-character" viewBox="0 0 160 200"/);
  assert.match(markupSource, /aria-label="小栖：银色长发、青蓝发梢、折翼发夹/);
  for (const part of ["back-hair", "head", "arm-left", "arm-right", "wing-clip", "coat-tails"]) {
    assert.ok(markupSource.includes(`qiju-${part}`));
  }
  assert.match(styleSource, /@keyframes qiju-tuck-hair/);
  assert.match(markupSource, /aria-label="小栖：[^"]*奶白色小猫/);
  assert.match(markupSource, /class="pet-character pet-cat-character" viewBox="0 0 160 148"/);
  for (const part of ["cat", "head-rig", "tail", "paw-left", "paw-right", "bandana", "fur"]) {
    assert.match(markupSource, new RegExp(`class="[^"]*\\bpet-${part}\\b`));
    assert.ok(styleSource.includes(`.pet-${part}`), `${part} has rig styling`);
  }
  assert.match(markupSource, /id="pet-live2d"[^>]*hidden/);
  assert.match(styleSource, /@keyframes pet-tail-sway/);
});

test("cat grooming is restored to washing its face", () => {
  const h = harness();
  h.widget.dataset.petAvatar = "cat";
  h.run('playPetBehavior("groom")');
  h.updateState();
  assert.equal(h.querySelector("#pet-state-label").textContent, "洗脸中");
  assert.equal(h.querySelector("#pet-feedback").textContent, "洗洗小脸！");
});

test("Qiju grooming tucks her hair instead of announcing cat face washing", () => {
  const h = harness();
  h.run('playPetBehavior("groom")');
  h.updateState();
  assert.equal(h.querySelector("#pet-state-label").textContent, "理头发");
  assert.equal(h.querySelector("#pet-feedback").textContent, "理理头发！");
});

test("model reset destroys the runtime, hides the canvas and invalidates pending loads", () => {
  const h = harness();
  let destroyed = 0;
  h.context.fakeBongo = { destroy() { destroyed += 1; } };
  h.widget.dataset.petModel = "shorekeeper";
  h.run("bongoCompanion = fakeBongo; petModelGeneration = 5; resetPetModel()");
  assert.equal(destroyed, 1);
  assert.equal(h.run("petModelGeneration"), 6);
  assert.equal(h.run("bongoCompanion"), null);
  assert.equal(h.querySelector("#pet-live2d").hidden, true);
  assert.equal(h.widget.classList.contains("uses-bongo-model"), false);
  assert.equal(h.widget.dataset.petModel, undefined);
});

test("logout revokes runtime consent and removes the model, not the original character", () => {
  const h = harness();
  h.querySelector("#pet-model-consent").checked = true;
  h.querySelector("#pet-model-watermark").checked = true;
  h.run("resetPetCompanion()");
  assert.equal(h.querySelector("#pet-model-consent").checked, false);
  assert.equal(h.querySelector("#pet-model-watermark").checked, false);
  assert.equal(h.querySelector("#pet-model-bongo").disabled, true);
  assert.equal(h.querySelector("#pet-live2d").hidden, true);
});

test("each authenticated dashboard start loads Shorekeeper with the authorized runtime and hidden watermark", async () => {
  const h = harness();
  h.context.loadCalls = 0;
  h.run(`enableBongoModel = async () => {
    loadCalls += 1;
    if (document.querySelector("#pet-model-choice").value !== "shorekeeper"
      || !document.querySelector("#pet-model-consent").checked
      || !document.querySelector("#pet-model-watermark").checked
      || bongoCompanion !== null) throw new Error("Invalid default model setup");
    document.querySelector("#pet-widget").dataset.petModel = "shorekeeper";
    updatePetProjectionAppearance();
  };`);
  for (let login = 0; login < 2; login += 1) {
    h.querySelector("#pet-model-choice").value = "standard";
    h.querySelector("#pet-model-consent").checked = false;
    h.querySelector("#pet-model-watermark").checked = false;
    await h.run("startDefaultPetModel()");
    assert.equal(h.querySelector("#pet-model-choice").value, "shorekeeper");
    assert.equal(h.widget.dataset.petAvatar, "qiju");
    assert.equal(h.ghost.dataset.form, "butterfly");
    assert.equal(h.querySelector("#pet-ghost-caption").textContent, "守岸人 · 蝶影");
    assert.equal(h.querySelector("#pet-model-consent").checked, true);
    assert.equal(h.querySelector("#pet-model-watermark").checked, true);
    assert.equal(h.run("loadCalls"), login + 1);
    h.run("resetPetCompanion()");
  }
});

test("logged-out startup cannot accept the runtime or enable a model", async () => {
  const h = harness();
  h.context.loadCalls = 0;
  h.run("enableBongoModel = async () => { loadCalls += 1; }; resetPetCompanion(); currentUser = null;");
  await h.run("startDefaultPetModel()");
  assert.equal(h.run("loadCalls"), 0);
  assert.equal(h.querySelector("#pet-model-consent").checked, false);
  assert.equal(h.querySelector("#pet-model-watermark").checked, false);
});

test("experimental Qiju and default Shorekeeper have distinct swallow and butterfly projections", () => {
  assert.match(markupSource, /<select id="pet-model-choice">\s*<option value="shorekeeper">/);
  assert.match(markupSource, /原创实验形象/);
  assert.match(markupSource, /id="pet-model-consent"[^>]*checked/);
  assert.match(markupSource, /id="pet-model-watermark"[^>]*checked/);
  const projection = markupSource.slice(markupSource.indexOf('id="pet-ghost"'), markupSource.indexOf('id="device-dialog"'));
  for (const feature of ["art", "spirit", "wings", "wing-left", "wing-right", "core", "tails", "aura", "trail", "motes"]) {
    assert.ok(projection.includes(`pet-butterfly-${feature}`), feature);
  }
  assert.match(projection, /小栖 · 光燕/);
  assert.match(projection, /data-form="swallow"/);
  assert.match(appSource, /守岸人 · 蝶影/);
  for (const view of ["front", "quarter", "side"]) assert.ok(projection.includes(`pet-swallow-pose-${view}`));
  assert.equal((projection.match(/href="#qiju-swallow-wing"/g) || []).length, 6);
  assert.match(projection, /viewBox="0 0 80 96"/);
  assert.equal((projection.match(/href="#pet-ghost-butterfly-wing"/g) || []).length, 6);
  for (const view of ["front", "quarter", "side"]) assert.match(projection, new RegExp(`pet-butterfly-pose-${view}`));
  assert.match(projection, /<linearGradient id="pet-butterfly-wing-light"/);
  assert.match(projection, /<radialGradient id="pet-butterfly-core-light"/);
  assert.match(projection, /<feGaussianBlur stdDeviation="1.2"/);
  assert.doesNotMatch(projection, /pet-pixel-|shape-rendering="crispEdges"|pet-ghost-small-butterfly/);
  assert.match(styleSource, /@keyframes pet-butterfly-flap/);
  assert.match(styleSource, /rotate\(var\(--pet-flight-heading/);
  assert.doesNotMatch(styleSource, /@keyframes pet-butterfly-flight/);
  assert.match(styleSource, /\.pet-butterfly-wing-left[^}]*ease-in-out/);
  assert.match(styleSource, /@keyframes pet-butterfly-tail-sway/);
  assert.match(styleSource, /\.pet-butterfly-art[^}]*drop-shadow/);
  assert.doesNotMatch(projection, /#689b83|#c6f4a8/);
  assert.match(styleSource, /\.pet-ghost-caption[^}]*#6488b1/);
});

test("native characters work without runtime consent and destroy any previously active Live2D model", async () => {
  const h = harness();
  h.querySelector("#pet-model-consent").checked = false;
  for (const avatar of ["cat", "qiju"]) {
    let destroyed = 0;
    h.context.fakeBongo = { destroy() { destroyed += 1; } };
    h.run("bongoCompanion = fakeBongo");
    h.querySelector("#pet-model-choice").value = avatar;
    await h.run("enableBongoModel()");
    assert.equal(destroyed, 1);
    assert.equal(h.widget.dataset.petAvatar, avatar);
    assert.equal(h.querySelector("#pet-model-bongo").disabled, false);
    assert.equal(h.ghost.dataset.form, "swallow");
    assert.equal(h.run("petModelLoading"), null);
    assert.equal(h.run("bongoCompanion"), null);
  }
});

test("projection appearance follows the active model, not an unactivated selection", () => {
  const h = harness();
  h.widget.dataset.petModel = "shorekeeper";
  h.run("updatePetProjectionAppearance()");
  assert.equal(h.ghost.dataset.form, "butterfly");
  assert.equal(h.querySelector("#pet-ghost-caption").textContent, "守岸人 · 蝶影");
  h.querySelector("#pet-model-choice").value = "standard";
  h.run("updatePetProjectionAppearance()");
  assert.equal(h.ghost.dataset.form, "butterfly");
  h.run("resetPetModel()");
  assert.equal(h.ghost.dataset.form, "swallow");
});

test("a failed request has a serious state, which clears on the next reaction or logout", () => {
  const h = harness();
  h.widget.classList.add("is-error", "is-reacting");
  h.updateState();
  assert.equal(h.widget.dataset.petState, "error");
  assert.equal(h.querySelector("#pet-state-label").textContent, "没能完成");
  h.run("triggerPetReaction()");
  h.updateState();
  assert.equal(h.widget.dataset.petState, "happy");
  h.widget.classList.add("is-error");
  h.run("resetPetCompanion()");
  assert.equal(h.widget.classList.contains("is-error"), false);
});

test("gaze is clamped on the shared avatar so both native rigs inherit it", () => {
  const h = harness();
  h.run('updatePetGaze({clientX:-10000,clientY:-10000,pointerType:"mouse"})');
  h.advance(16);
  assert.equal(h.querySelector(".pet-avatar").style["--pet-gaze-x"], "-1.6px");
  assert.equal(h.querySelector(".pet-avatar").style["--pet-gaze-y"], "-1.2px");
  h.run('updatePetGaze({clientX:500,clientY:500,pointerType:"mouse"}); resetPetCompanion()');
  assert.equal(h.run("petGazeFrame"), null);
  assert.equal(h.querySelector(".pet-avatar").style["--pet-gaze-x"], undefined);
  assert.equal(h.querySelector(".pet-avatar").style["--pet-gaze-y"], undefined);
});

test("a model cannot load without a user and explicit runtime license consent", async () => {
  const h = harness();
  await h.run("enableBongoModel()");
  assert.equal(h.run("petModelLoading"), null);
  h.querySelector("#pet-model-consent").checked = true;
  h.run("currentUser = null");
  await h.run("enableBongoModel()");
  assert.equal(h.run("petModelLoading"), null);
});

test("uploading a skin or restoring the default exits Live2D instead of leaving it covering the image", async () => {
  for (const action of ["uploadPetSkin({size: 1, type: 'image/png'})", "resetPetSkin()"]) {
    const h = harness();
    let destroyed = 0;
    h.context.fakeBongo = { destroy() { destroyed += 1; } };
    h.run("bongoCompanion = fakeBongo; requestApi = async () => ({}); refreshPetSkin = async () => {};");
    await h.run(action);
    assert.equal(destroyed, 1, action);
    assert.equal(h.run("bongoCompanion"), null, action);
    assert.equal(h.querySelector("#pet-live2d").hidden, true, action);
  }
});
