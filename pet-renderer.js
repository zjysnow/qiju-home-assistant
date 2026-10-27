const widget = document.querySelector("#pet-widget");
const avatar = widget?.querySelector(".pet-avatar");
const label = widget?.querySelector("#pet-state-label");

if (!widget || !avatar || !label) {
  throw new Error("The 2D pet could not find its widget, avatar or state label.");
}

const states = [
  ["is-listening", "listening", "在听呢"],
  ["is-thinking", "thinking", "想一想"],
  ["is-speaking", "speaking", "说话中"],
  ["is-reacting", "happy", "收到啦"],
  ["is-typing", "typing", "陪你打字"],
  ["is-projecting", "projecting", "投影中"],
];

function updateState() {
  const state = states.find(([className]) => widget.classList.contains(className));
  widget.dataset.petState = state?.[1] || "idle";
  label.textContent = state?.[2] || "陪伴中";
}

new MutationObserver(updateState).observe(widget, { attributes: true, attributeFilter: ["class"] });
updateState();
