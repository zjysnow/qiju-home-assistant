const scripts = new Map();

export const BONGO_MODELS = {
  standard: { name: "BongoCat standard", url: "/assets/bongocat/cat.model3.json", width: 192, height: 144 },
  shorekeeper: { name: "守岸人 · 无表情体验版", url: "/assets/pet-models/shorekeeper/cat.model3.json", width: 224, height: 224 },
};

function loadScript(source) {
  if (scripts.has(source)) return scripts.get(source);
  const pending = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.onload = resolve;
    script.onerror = () => {
      scripts.delete(source);
      script.remove();
      reject(new Error(`运行库无法加载：${source}`));
    };
    document.head.append(script);
  });
  scripts.set(source, pending);
  return pending;
}

export function getBongoParameters(state, elapsed, gaze = { x: 0, y: 0 }, reducedMotion = false, modelId = "standard") {
  const time = reducedMotion ? 0 : elapsed / 1000;
  const happy = state === "happy" || state === "cuddle";
  const typing = state === "typing" && !reducedMotion;
  const tap = Math.sin(time * 16) > 0;
  const blink = !reducedMotion && time % 5.4 > 5.2 ? .1 : 1;
  const parameters = {
    ParamAngleX: reducedMotion ? 0 : Math.max(-1, Math.min(1, gaze.x)) * 12,
    ParamAngleY: state === "sleep" ? -8 : reducedMotion ? 0 : Math.max(-1, Math.min(1, gaze.y)) * 8,
    ParamAngleZ: state === "listening" ? -8 : state === "thinking" ? 6 : state === "dance" ? Math.sin(time * 8) * 6 : 0,
    ParamMouseX: reducedMotion ? 0 : Math.max(-1, Math.min(1, gaze.x)) * 30,
    ParamMouseY: reducedMotion ? 0 : Math.max(-1, Math.min(1, gaze.y)) * 30,
    CatParamLeftHandDown: typing && tap ? 1 : 0,
    ParamMouseLeftDown: typing && !tap ? 1 : 0,
    ParamMouseRightDown: 0,
    ParamEyeLOpen: state === "sleep" ? .1 : blink,
    ParamEyeROpen: state === "sleep" ? .1 : blink,
    ParamMouthOpenY: state === "speaking" ? .45 + Math.sin(time * 20) * .3 : 0,
    ParamBreath: reducedMotion ? .5 : .5 + Math.sin(time * 1.8) * .35,
  };
  if (modelId === "shorekeeper") {
    return {
      ...parameters,
      // This trial model hides the character above 0.5; keep breathing in its visible keyforms.
      ParamBreath: reducedMotion ? .25 : .25 + Math.sin(time * 1.8) * .2,
      ParamEyeBallX: parameters.ParamAngleX / 12,
      ParamEyeBallY: reducedMotion ? 0 : Math.max(-1, Math.min(1, gaze.y)),
    };
  }
  if (modelId !== "standard") throw new Error(`不支持的角色模型：${modelId}`);
  return {
    ...parameters,
    Param3: happy || state === "groom" ? 30 : 0,
    ParamEyeLSmile: happy ? 1 : 0,
    ParamEyeRSmile: happy ? 1 : 0,
    ParamCheek: happy ? .5 : 0,
  };
}

export async function createBongoCompanion({ canvas, widget, onError, modelId = "standard" }) {
  const profile = Object.hasOwn(BONGO_MODELS, modelId) && BONGO_MODELS[modelId];
  if (!profile) throw new Error(`不支持的角色模型：${modelId}`);
  for (const source of [
    "/assets/vendor/pixi.min.js",
    "/assets/vendor/pixi-csp.min.js",
    "/assets/vendor/live2dcubismcore.min.js",
    "/assets/vendor/cubism4.min.js",
  ]) await loadScript(source);

  const PIXI = window.PIXI;
  if (!PIXI?.live2d?.Live2DModel) throw new Error("Live2D 运行库未正确初始化");
  if (!PIXI.utils.isWebGLSupported()) throw new Error("当前浏览器不支持 WebGL，请使用原创小栖");
  // Pixi releases the WebGL context on destroy; a later selection needs a new canvas.
  const freshCanvas = canvas.cloneNode(false);
  canvas.replaceWith(freshCanvas);
  canvas = freshCanvas;
  const app = new PIXI.Application({
    view: canvas, width: profile.width, height: profile.height,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    backgroundAlpha: 0, antialias: true, autoStart: false, sharedTicker: false,
  });
  let model;
  try {
    model = await PIXI.live2d.Live2DModel.from(profile.url, {
      autoUpdate: false, autoInteract: false, motionPreload: "NONE",
    });
  } catch (error) {
    app.destroy(false, { children: true });
    throw error;
  }
  const size = model.internalModel;
  const scale = Math.min((profile.width - 8) / size.width, (profile.height - 6) / size.height);
  model.scale.set(scale);
  model.anchor.set(.5, .5);
  model.position.set(profile.width / 2, profile.height / 2);
  app.stage.addChild(model);
  app.ticker.maxFPS = 30;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const shell = document.querySelector("#app-shell");
  const character = widget.querySelector(".pet-character");
  let elapsed = 0;
  let destroyed = false;
  let watermarkHidden = false;
  model.internalModel.on("beforeModelUpdate", () => {
    const gaze = {
      x: (Number.parseFloat(character.style.getPropertyValue("--pet-gaze-x")) || 0) / 1.6,
      y: (Number.parseFloat(character.style.getPropertyValue("--pet-gaze-y")) || 0) / 1.2,
    };
    const values = getBongoParameters(widget.dataset.petState || "idle", elapsed, gaze, motion.matches, modelId);
    for (const [id, value] of Object.entries(values)) {
      model.internalModel.coreModel.setParameterValueById(id, value);
    }
    // The supplied model offers syxs.motion3.json as its native watermark toggle.
    if (modelId === "shorekeeper" && watermarkHidden) model.internalModel.coreModel.setParameterValueById("Paramshuiying", 1);
  });

  function fail(error) {
    destroy();
    onError(error);
  }

  function refresh() {
    if (destroyed) return;
    try {
      const visible = !document.hidden && !shell.hidden
        && widget.classList.contains("uses-bongo-model")
        && widget.dataset.projectionPhase !== "projected";
      if (visible && !motion.matches) app.start();
      else app.stop();
      // Live2DModel.update(0) skips deformation, so update the internal model for static states.
      model.internalModel.update(0, model.elapsedTime);
      app.render();
    } catch (error) {
      fail(error);
    }
  }

  function onContextLost(event) {
    event.preventDefault();
    fail(new Error("WebGL 上下文已丢失"));
  }

  const observer = new MutationObserver(refresh);
  observer.observe(widget, { attributes: true, attributeFilter: ["class", "data-pet-state", "data-projection-phase"] });
  observer.observe(shell, { attributes: true, attributeFilter: ["hidden"] });
  document.addEventListener("visibilitychange", refresh);
  motion.addEventListener("change", refresh);
  canvas.addEventListener("webglcontextlost", onContextLost);
  app.ticker.add(() => {
    if (destroyed) return;
    try {
      elapsed += app.ticker.deltaMS;
      model.update(app.ticker.deltaMS);
    } catch (error) {
      fail(error);
    }
  });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    observer.disconnect();
    document.removeEventListener("visibilitychange", refresh);
    motion.removeEventListener("change", refresh);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    app.stop();
    app.destroy(false, { children: true, texture: true, baseTexture: true });
  }

  return {
    refresh, destroy, name: profile.name,
    setWatermarkHidden(hidden) {
      watermarkHidden = hidden;
      refresh();
    },
  };
}
