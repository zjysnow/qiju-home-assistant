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
  ["is-error", "error", "没能完成"],
  ["is-reacting", "happy", "收到啦"],
  ["is-typing", "typing", "陪你打字"],
  ["is-projecting", "projecting", "投影中"],
];

function updateState() {
  const state = states.find(([className]) => widget.classList.contains(className));
  const behaviorLabels = {
    stretch: "伸懒腰", groom: widget.dataset.petAvatar === "cat" || widget.classList.contains("uses-bongo-model") ? "洗脸中" : "理头发",
    sleep: "打盹中", cuddle: "好喜欢", snack: "吃零食", jump: "跳一跳", dance: "跳舞中",
  };
  const behavior = widget.classList.contains("is-performing") ? widget.dataset.petBehavior : null;
  const behaviorLabel = Object.hasOwn(behaviorLabels, behavior) ? behaviorLabels[behavior] : null;
  widget.dataset.petState = state?.[1] || (behaviorLabel ? behavior : "idle");
  label.textContent = state?.[2] || behaviorLabel || "陪伴中";
}

new MutationObserver(updateState).observe(widget, { attributes: true, attributeFilter: ["class"] });
updateState();
