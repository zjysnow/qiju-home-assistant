import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const rendererSource = await readFile(new URL("../pet-renderer.js", import.meta.url), "utf8");

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
  widget.querySelector = querySelector;
  const ghost = querySelector("#pet-ghost");
  ghost.hidden = true;
  querySelector("#pet-panel").hidden = true;
  const timers = new Map();
  let clock = 0;
  let nextTimer = 0;
  let observerCallback;
  const preference = { matches: reducedMotion };
  const context = vm.createContext({
    document: { querySelector, hidden: false },
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
      timers.set(id, { callback, delay: 16, due: clock + 16 });
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
    return {
      left: context.window.innerWidth - 128 - (mobile ? 8 : 24),
      top: context.window.innerHeight - 152 - (mobile ? 73 : 22),
      width: 128, height: 152,
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
  assert.equal(h.run("petGhostTimer"), null);
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
  assert.equal(h.timers.size, 1);
});

test("idle ghost chooses new two-dimensional destinations on each drift cycle", () => {
  const h = harness();
  h.run("startPetCompanion()");
  h.advance(20000);
  const first = h.ghost.style.transform;
  h.advance(6500);
  const second = h.ghost.style.transform;
  assert.notEqual(first, second);
  h.advance(6500);
  assert.notEqual(h.ghost.style.transform, second);
  assert.equal(h.ghost.classList.contains("is-drifting"), true);
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

test("a dialog appearing during a drift stops further motion", () => {
  const h = harness();
  h.run("startPetCompanion()");
  h.advance(20000);
  h.setDialogOpen(true);
  h.advance(6500);
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.run("petGhostTimer"), null);
});

test("disabling projection cancels idle and drift timers, including manual preview", () => {
  const h = harness();
  h.run("startPetCompanion()");
  h.advance(20000);
  h.run("setPetProjectionEnabled(false); previewPetProjection()");
  h.advance(640);
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.timers.size, 0);
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

test("custom skins are not replaced by the independent pixel projection", () => {
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
  assert.equal(h.ghost.classList.contains("is-drifting"), false);
  h.advance(639);
  assert.equal(h.run("petProjectionPhase"), "entering");
  h.advance(1);
  assert.equal(h.widget.dataset.projectionPhase, "projected");
  assert.equal(h.ghost.dataset.projectionPhase, "projected");
  assert.equal(h.ghost.classList.contains("is-drifting"), true);
});

test("return freezes the ghost at its rendered position and does not restart on continuous activity", () => {
  const h = harness();
  h.run("previewPetProjection()");
  h.advance(640);
  h.ghost.geometry = () => ({ left: 444, top: 222, width: 96, height: 112 });
  h.run("notePetActivity()");
  assert.equal(h.ghost.style.transform, "translate(444px, 222px)");
  assert.equal(h.ghost.classList.contains("is-drifting"), false);
  assert.equal(h.widget.attributes["aria-hidden"], undefined);
  for (let count = 0; count < 6; count += 1) {
    h.advance(100);
    h.run("notePetActivity()");
    assert.equal(h.ghost.hidden, false);
  }
  h.advance(40);
  assert.equal(h.ghost.hidden, true);
  assert.equal(h.widget.dataset.projectionPhase, "docked");
  assert.equal(h.timers.size, 1, "Only the next idle timer remains");
});

test("interrupting entrance cancels its pending completion instead of hiding the returning dock", () => {
  const h = harness();
  h.run("previewPetProjection()");
  h.advance(200);
  h.run("notePetActivity()");
  h.advance(440);
  assert.equal(h.widget.dataset.projectionPhase, "returning");
  assert.equal(h.widget.inert, false);
  assert.equal(h.ghost.classList.contains("is-drifting"), false);
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
