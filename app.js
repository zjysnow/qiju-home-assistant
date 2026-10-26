let devices = [
  { id: "living-light", name: "主灯", room: "客厅", type: "light", detail: "亮度 80%", enabled: true, value: 80 },
  { id: "living-ac", name: "中央空调", room: "客厅", type: "ac", detail: "制冷 · 24°", enabled: true, value: 24 },
  { id: "living-curtain", name: "智能窗帘", room: "客厅", type: "curtain", detail: "已打开", enabled: true },
  { id: "living-speaker", name: "智能音箱", room: "客厅", type: "speaker", detail: "待机中", enabled: false },
  { id: "bed-light", name: "床头灯", room: "卧室", type: "light", detail: "暖光 · 35%", enabled: true, value: 35 },
  { id: "bed-ac", name: "卧室空调", room: "卧室", type: "ac", detail: "已关闭", enabled: false, value: 25 },
  { id: "kitchen-plug", name: "智能插座", room: "厨房", type: "plug", detail: "电饭煲 · 运行中", enabled: true },
  { id: "kitchen-cleaner", name: "净水器", room: "厨房", type: "cleaner", detail: "滤芯状态良好", enabled: false },
  { id: "balcony-light", name: "阳台灯", room: "阳台", type: "light", detail: "已关闭", enabled: false, value: 50 },
];
const rooms = ["客厅", "卧室", "厨房", "阳台"];

const icons = {
  light: "☼",
  ac: "❄",
  curtain: "▥",
  speaker: "◖))",
  plug: "ϟ",
  cleaner: "⌁",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

const grid = document.querySelector("#device-grid");
const toast = document.querySelector("#toast");
const chatMessages = document.querySelector("#chat-messages");
const memberGrid = document.querySelector("#member-grid");
let activeRoom = "全部";
let toastTimer;
let chatHistory = [];
let members = [];
let currentUser = null;
let currentSpeakerId = null;
let voiceBusy = false;
let speakNextReply = false;
const voiceStorageKey = "qiju-local-voiceprints-v1";
const enrollmentPhrase = "小栖你好，今天家里很舒服。";

async function requestApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const responseText = await response.text();
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    const responseBody = responseText.trim().slice(0, 120);
    throw new Error(
      `本机服务返回了非 JSON 响应（HTTP ${response.status}${responseBody ? `：${responseBody}` : ""}）。请在项目目录运行 npm start，并直接打开 http://127.0.0.1:3000；不要使用 VS Code 静态预览或直接打开 index.html。`,
    );
  }
  if (!response.ok) {
    const error = new Error(result.error || `服务返回错误（${response.status}）`);
    error.status = response.status;
    if (response.status === 401 && path !== "/api/login") showLogin("登录已过期，请重新登录。");
    throw error;
  }
  return result;
}

function showRequestError(error) {
  console.error(error);
  showToast(error.message);
  refreshDevices().catch((refreshError) => console.error(refreshError));
}

function syncDevices(serverDevices) {
  devices = serverDevices.map((device) => ({ ...device }));
}

async function refreshDevices() {
  const result = await requestApi("/api/devices");
  syncDevices(result.devices);
  renderRoomTabs();
  renderDevices();
  updateSummary();
}

async function refreshMembers() {
  const result = await requestApi("/api/members");
  members = result.members;
  if (currentSpeakerId && currentSpeakerId !== "unknown" && !members.some((member) => member.id === currentSpeakerId)) {
    currentSpeakerId = null;
  }
  renderMembers();
}

function activeDeviceCount() {
  return devices.filter((device) => device.enabled).length;
}

function updateSummary() {
  const count = activeDeviceCount();
  document.querySelector("#device-total").textContent = String(devices.length).padStart(2, "0");
  document.querySelector("#active-count").textContent = count;
  document.querySelector("#online-summary").textContent = `${count} 台运行中`;
}

function renderRoomTabs() {
  const roomTabs = document.querySelector(".room-tabs");
  const roomList = [...new Set([...rooms, ...devices.map((device) => device.room)])];
  if (activeRoom !== "全部" && !roomList.includes(activeRoom)) activeRoom = "全部";
  const counts = new Map(roomList.map((room) => [room, devices.filter((device) => device.room === room).length]));
  roomTabs.innerHTML = [
    `<button class="room-tab ${activeRoom === "全部" ? "active" : ""}" type="button" role="tab" aria-selected="${activeRoom === "全部"}" data-room="全部">全部 <span>${devices.length}</span></button>`,
    ...roomList.map((room) => `<button class="room-tab ${activeRoom === room ? "active" : ""}" type="button" role="tab" aria-selected="${activeRoom === room}" data-room="${escapeHtml(room)}">${escapeHtml(room)} <span>${counts.get(room)}</span></button>`),
  ].join("");
}

function renderDevices() {
  const visibleDevices = activeRoom === "全部"
    ? devices
    : devices.filter((device) => device.room === activeRoom);

  grid.innerHTML = visibleDevices.map((device) => {
    const state = device.enabled ? "运行中" : "已关闭";
    const detail = device.enabled ? device.detail : "已关闭";
    const canAdjustBrightness = device.type === "light" && (!device.haEntityId || device.haEntityId.startsWith("light."));
    const slider = device.enabled && Number.isFinite(device.value) && canAdjustBrightness
      ? `<input class="device-slider" type="range" min="0" max="100" value="${device.value}" aria-label="${device.name}亮度" data-slider="${device.id}" />`
      : "";
    return `
      <article class="device-card ${device.enabled ? "" : "is-off"}">
        <div class="device-card-top">
          <span class="device-icon ${escapeHtml(device.type)}">${icons[device.type]}</span>
          <div class="device-actions">
            ${currentUser?.role === "admin" ? `<button class="device-edit-button" type="button" aria-label="配置${escapeHtml(device.name)}" title="配置设备" data-edit-device="${escapeHtml(device.id)}">···</button>` : ""}
            <button class="toggle" type="button" role="switch" aria-checked="${device.enabled}" aria-label="${escapeHtml(device.name)}${device.enabled ? "：关闭" : "：开启"}" data-toggle="${escapeHtml(device.id)}"></button>
          </div>
        </div>
        <h3 class="device-name">${escapeHtml(device.room)} · ${escapeHtml(device.name)}</h3>
        <div class="device-meta">${escapeHtml(detail)}<span class="device-state">${escapeHtml(state)}</span></div>
        ${slider}
      </article>`;
  }).join("");
}

function readVoiceprints() {
  const stored = window.localStorage.getItem(voiceStorageKey);
  if (!stored) return {};
  const profiles = JSON.parse(stored);
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw new Error("本地声纹档案格式无效，请清除浏览器中栖居的本地数据后重新录入。");
  }
  return profiles;
}

function writeVoiceprints(profiles) {
  window.localStorage.setItem(voiceStorageKey, JSON.stringify(profiles));
}

function renderMembers() {
  if (!members.length) {
    memberGrid.innerHTML = '<div class="member-empty">还没有家庭成员，管理员可添加成员、创建登录账号并关联设备。</div>';
    return;
  }
  let profiles;
  try {
    profiles = readVoiceprints();
  } catch (error) {
    profiles = {};
    document.querySelector("#speaker-result").textContent = error.message;
  }
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  memberGrid.innerHTML = members.map((member) => {
    const sampleCount = profiles[member.id]?.vectors?.length || 0;
    const associated = member.deviceIds.map((id) => deviceById.get(id)?.name).filter(Boolean);
    const tags = associated.length
      ? associated.map((name) => `<span class="member-device-tag">${escapeHtml(name)}</span>`).join("")
      : '<span class="member-no-devices">尚未关联设备</span>';
    return `
      <article class="member-card">
        <div class="member-card-top">
          <span class="member-avatar">${escapeHtml(member.name.slice(0, 1))}</span>
          <div class="member-identity"><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.relation)}</small></div>
          ${currentUser?.role === "admin" ? `<button class="device-edit-button" type="button" aria-label="配置${escapeHtml(member.name)}" data-edit-member="${escapeHtml(member.id)}">···</button>` : ""}
        </div>
        <div class="member-device-tags">${tags}</div>
        <div class="member-card-footer">
          <span class="voiceprint-status">${sampleCount >= 3 ? "声纹已录入" : `声音样本 ${sampleCount}/3`} · 本机保存</span>
          <button class="voice-enroll-button" type="button" data-enroll-member="${escapeHtml(member.id)}" ${voiceBusy ? "disabled" : ""}>${sampleCount >= 3 ? "重新录入" : "录入声音"}</button>
        </div>
      </article>`;
  }).join("");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function appendChatMessage(role, content, pending = false) {
  const message = document.createElement("div");
  message.className = `chat-message ${role === "user" ? "user-message" : "assistant-message"}${pending ? " chat-pending" : ""}`;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  const name = document.createElement("span");
  name.textContent = role === "user" ? "你" : "小栖";
  const text = document.createElement("p");
  text.textContent = content;
  bubble.append(name, text);
  message.append(bubble);
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function resetChat() {
  chatHistory = [];
  chatMessages.replaceChildren();
  appendChatMessage("assistant", "你好，我可以和你聊天，也可以帮你控制家里的设备。你想从哪里开始？");
}

function speakAssistantReply(content) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    showToast("当前浏览器不支持语音播报，回复仍会显示在聊天中。");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new window.SpeechSynthesisUtterance(content);
  utterance.lang = "zh-CN";
  utterance.onerror = (event) => {
    if (!["canceled", "interrupted"].includes(event.error)) {
      showToast(`语音播报失败：${event.error}`);
    }
  };
  window.speechSynthesis.speak(utterance);
}

async function changeDevice(id, update) {
  const result = await requestApi(`/api/devices/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
  syncDevices(result.devices);
  renderDevices();
  updateSummary();
}

function setRoom(room) {
  activeRoom = room;
  document.querySelectorAll(".room-tab").forEach((tab) => {
    const selected = tab.dataset.room === room;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  renderDevices();
}

async function applyScene(sceneName) {
  document.querySelectorAll(".scene-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.scene === sceneName);
  });
  try {
    const result = await requestApi("/api/scenes", {
      method: "POST",
      body: JSON.stringify({ scene: sceneName }),
    });
    syncDevices(result.devices);
    renderDevices();
    updateSummary();
    showToast(result.message);
  } catch (error) {
    console.error(error);
    showToast(error.message);
  }
}

async function sendChatMessage(rawMessage) {
  const content = rawMessage.trim();
  if (!content) return;
  const shouldSpeakReply = speakNextReply;
  speakNextReply = false;

  appendChatMessage("user", content);
  chatHistory.push({ role: "user", content });
  const pending = appendChatMessage("assistant", "正在思考…", true);
  const input = document.querySelector("#assistant-input");
  const submit = document.querySelector("#assistant-form button[type='submit']");
  const microphone = document.querySelector("#mic-button");
  const clearButton = document.querySelector("#clear-chat");
  input.disabled = true;
  submit.disabled = true;
  microphone.disabled = true;
  clearButton.disabled = true;
  document.querySelector("#assistant-status").textContent = "正在回复…";

  try {
    const result = await requestApi("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: chatHistory.slice(-12) }),
    });
    pending.remove();
    appendChatMessage("assistant", result.reply);
    if (shouldSpeakReply) speakAssistantReply(result.reply);
    chatHistory.push({ role: "assistant", content: result.reply });
    chatHistory = chatHistory.slice(-12);
    syncDevices(result.devices);
    renderDevices();
    updateSummary();
    document.querySelector("#assistant-status").textContent = result.engine === "ollama"
      ? "本地模型对话 · 设备控制已保护"
      : "基础指令模式 · 可连接本地 Ollama 聊天";
  } catch (error) {
    console.error(error);
    pending.remove();
    appendChatMessage("assistant", `这次没能完成：${error.message}`);
  } finally {
    input.disabled = false;
    submit.disabled = false;
    microphone.disabled = false;
    clearButton.disabled = false;
    input.focus();
  }
}

function openDeviceDialog(deviceId = "") {
  const dialog = document.querySelector("#device-dialog");
  const form = document.querySelector("#device-config-form");
  const device = devices.find((item) => item.id === deviceId);
  form.reset();
  document.querySelector("#device-id").value = device?.id || "";
  document.querySelector("#device-name").value = device?.name || "";
  document.querySelector("#device-room").value = device?.room || "客厅";
  document.querySelector("#device-type").value = device?.type || "light";
  document.querySelector("#device-entity-id").value = device?.haEntityId || "";
  document.querySelector("#device-dialog-title").textContent = device ? "配置设备" : "添加设备";
  document.querySelector("#device-form-error").textContent = "";
  document.querySelector("#delete-device").hidden = !device;
  dialog.showModal();
}

async function saveDevice(event) {
  event.preventDefault();
  const id = document.querySelector("#device-id").value;
  const payload = {
    name: document.querySelector("#device-name").value,
    room: document.querySelector("#device-room").value,
    type: document.querySelector("#device-type").value,
    haEntityId: document.querySelector("#device-entity-id").value,
  };
  const saveButton = document.querySelector(".dialog-save");
  saveButton.disabled = true;
  document.querySelector("#device-form-error").textContent = "";
  try {
    const result = await requestApi(id ? `/api/devices/${encodeURIComponent(id)}` : "/api/devices", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    syncDevices(result.devices);
    renderRoomTabs();
    renderDevices();
    updateSummary();
    document.querySelector("#device-dialog").close();
    showToast(id ? "设备配置已更新" : "设备已添加");
  } catch (error) {
    console.error(error);
    document.querySelector("#device-form-error").textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteDevice() {
  const id = document.querySelector("#device-id").value;
  const device = devices.find((item) => item.id === id);
  if (!device || !window.confirm(`确定删除“${device.name}”吗？`)) return;
  try {
    const result = await requestApi(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
    syncDevices(result.devices);
    renderRoomTabs();
    renderDevices();
    updateSummary();
    document.querySelector("#device-dialog").close();
    showToast("设备已删除");
  } catch (error) {
    console.error(error);
    document.querySelector("#device-form-error").textContent = error.message;
  }
}

function openMemberDialog(memberId = "") {
  const form = document.querySelector("#member-config-form");
  const member = members.find((item) => item.id === memberId);
  form.reset();
  document.querySelector("#member-id").value = member?.id || "";
  document.querySelector("#member-name").value = member?.name || "";
  document.querySelector("#member-relation").value = member?.relation || "";
  document.querySelector("#member-account-username").value = member?.account?.username || "";
  document.querySelector("#member-account-password").value = "";
  document.querySelector("#member-account-password").placeholder = member?.account
    ? "留空则不修改"
    : "创建账号时必填（至少 10 位）";
  document.querySelector("#member-dialog-title").textContent = member ? "配置家庭成员" : "添加家庭成员";
  document.querySelector("#member-form-error").textContent = "";
  document.querySelector("#delete-member").hidden = !member;
  const selectedDevices = new Set(member?.deviceIds || []);
  document.querySelector("#member-device-list").innerHTML = devices.map((device) => `
    <label class="member-device-option">
      <input type="checkbox" name="deviceIds" value="${escapeHtml(device.id)}" ${selectedDevices.has(device.id) ? "checked" : ""} />
      <span>${escapeHtml(device.room)} · ${escapeHtml(device.name)}</span>
    </label>`).join("") || '<span class="member-no-devices">请先添加设备。</span>';
  document.querySelector("#member-dialog").showModal();
}

async function saveMember(event) {
  event.preventDefault();
  const id = document.querySelector("#member-id").value;
  const deviceIds = [...document.querySelectorAll("#member-device-list input[name='deviceIds']:checked")]
    .map((input) => input.value);
  const payload = {
    name: document.querySelector("#member-name").value,
    relation: document.querySelector("#member-relation").value,
    deviceIds,
  };
  const saveButton = document.querySelector("#member-config-form .dialog-save");
  const accountUsername = document.querySelector("#member-account-username").value.trim();
  const accountPassword = document.querySelector("#member-account-password").value;
  let profileSaved = false;
  saveButton.disabled = true;
  document.querySelector("#member-form-error").textContent = "";
  try {
    const result = await requestApi(id ? `/api/members/${encodeURIComponent(id)}` : "/api/members", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    members = result.members;
    const savedMember = result.member;
    document.querySelector("#member-id").value = savedMember.id;
    document.querySelector("#delete-member").hidden = false;
    document.querySelector("#member-dialog-title").textContent = "配置家庭成员";
    profileSaved = true;
    if (accountUsername || accountPassword) {
      if (!accountUsername) throw new Error("创建或修改登录账号时，登录名不能为空。");
      if (savedMember.account) {
        await requestApi(`/api/accounts/${encodeURIComponent(savedMember.account.id)}`, {
          method: "PUT",
          body: JSON.stringify({ username: accountUsername, password: accountPassword }),
        });
      } else {
        if (!accountPassword) throw new Error("创建登录账号时需要设置至少 10 位密码。");
        await requestApi("/api/accounts", {
          method: "POST",
          body: JSON.stringify({ memberId: savedMember.id, username: accountUsername, password: accountPassword }),
        });
      }
    }
    await refreshMembers();
    renderMembers();
    document.querySelector("#member-dialog").close();
    showToast(id ? "成员配置已更新" : "家庭成员已添加");
  } catch (error) {
    console.error(error);
    if (profileSaved) {
      try {
        await refreshMembers();
      } catch (refreshError) {
        console.error(refreshError);
      }
    }
    document.querySelector("#member-form-error").textContent = profileSaved
      ? `成员资料已保存，但登录账号未完成更新：${error.message}`
      : error.message;
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteMember() {
  const id = document.querySelector("#member-id").value;
  const member = members.find((item) => item.id === id);
  if (!member || !window.confirm(`确定删除家庭成员“${member.name}”吗？`)) return;
  try {
    const result = await requestApi(`/api/members/${encodeURIComponent(id)}`, { method: "DELETE" });
    members = result.members;
    if (currentSpeakerId === id) currentSpeakerId = null;
    try {
      const profiles = readVoiceprints();
      delete profiles[id];
      writeVoiceprints(profiles);
    } catch (error) {
      console.error(error);
      document.querySelector("#speaker-result").textContent = `成员已删除，但此浏览器的声纹数据未能清理：${error.message}`;
    }
    renderMembers();
    document.querySelector("#member-dialog").close();
    showToast("家庭成员已删除");
  } catch (error) {
    console.error(error);
    document.querySelector("#member-form-error").textContent = error.message;
  }
}

async function enrollMemberVoice(memberId) {
  const member = members.find((item) => item.id === memberId);
  if (!member) return;
  if (!window.confirm(`声纹特征只保存在此浏览器，不会上传服务器。请确认 ${member.name} 同意录入。此实验识别不能用于安防授权。继续吗？`)) return;
  let profiles;
  try {
    profiles = readVoiceprints();
    const existing = Array.isArray(profiles[memberId]?.vectors) ? profiles[memberId].vectors : [];
    if (existing.length >= 3) {
      if (!window.confirm("已达到录入样本数，是否重新录入？")) return;
      existing.length = 0;
    }
    if (!window.SpeakerID) throw new Error("本地声纹模块未加载，请刷新页面重试。");
    const vectors = existing.slice(0, 2);
    voiceBusy = true;
    renderMembers();
    while (vectors.length < 3) {
      const sampleNumber = vectors.length + 1;
      document.querySelector("#speaker-result").textContent = `录音 ${sampleNumber}/3：请用正常音量重复说“${enrollmentPhrase}”`;
      const vector = await window.SpeakerID.captureFeatures(3000);
      vectors.push(vector);
      profiles[memberId] = { vectors };
      writeVoiceprints(profiles);
      renderMembers();
    }
    document.querySelector("#speaker-result").textContent = `${member.name} 的声音样本已保存在此浏览器。`;
    showToast(`${member.name} 的声纹实验样本已录入`);
  } catch (error) {
    console.error(error);
    document.querySelector("#speaker-result").textContent = `声音录入失败：${error.message}`;
  } finally {
    voiceBusy = false;
    renderMembers();
  }
}

async function identifySpeaker() {
  const button = document.querySelector("#identify-speaker");
  currentSpeakerId = null;
  let profiles;
  try {
    profiles = readVoiceprints();
  } catch (error) {
    document.querySelector("#speaker-result").textContent = error.message;
    return;
  }
  const candidates = members
    .map((member) => ({ member, vectors: profiles[member.id]?.vectors }))
    .filter((candidate) => Array.isArray(candidate.vectors) && candidate.vectors.length >= 3);
  if (!candidates.length) {
    document.querySelector("#speaker-result").textContent = "尚无完成录入的成员，请先为成员录入 3 段声音样本。";
    return;
  }
  if (!window.SpeakerID) {
    document.querySelector("#speaker-result").textContent = "本地声纹模块未加载，请刷新页面重试。";
    return;
  }
  voiceBusy = true;
  button.disabled = true;
  document.querySelector("#speaker-result").textContent = `请在 3 秒内重复说“${enrollmentPhrase}”`;
  renderMembers();
  try {
    const sample = await window.SpeakerID.captureFeatures(3000);
    const scored = candidates.map(({ member, vectors }) => {
      const similarities = vectors.map((vector) => window.SpeakerID.similarity(sample, vector)).sort((a, b) => b - a);
      return { member, score: (similarities[0] + similarities[1]) / 2 };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    const margin = best.score - (scored[1]?.score ?? 0);
    if (best.score >= 0.84 && margin >= 0.04) {
      currentSpeakerId = best.member.id;
      document.querySelector("#speaker-result").textContent = `可能是 ${best.member.name}（声纹相似度 ${Math.round(best.score * 100)}%，仅供实验参考，不代表身份已验证）。`;
    } else {
      currentSpeakerId = "unknown";
      document.querySelector("#speaker-result").textContent = "未能可靠匹配到已录入成员，按未知说话人处理。";
    }
  } catch (error) {
    currentSpeakerId = null;
    console.error(error);
    document.querySelector("#speaker-result").textContent = `识别失败：${error.message}`;
  } finally {
    voiceBusy = false;
    button.disabled = false;
    renderMembers();
  }
}

document.querySelector("#add-device").addEventListener("click", () => openDeviceDialog());
document.querySelector("#device-config-form").addEventListener("submit", saveDevice);
document.querySelector("#delete-device").addEventListener("click", deleteDevice);
document.querySelectorAll("[data-close-device-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector("#device-dialog").close());
});
document.querySelector("#add-member").addEventListener("click", () => openMemberDialog());
document.querySelector("#member-config-form").addEventListener("submit", saveMember);
document.querySelector("#delete-member").addEventListener("click", deleteMember);
document.querySelectorAll("[data-close-member-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector("#member-dialog").close());
});
document.querySelector("#member-grid").addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-member]");
  if (edit) {
    openMemberDialog(edit.dataset.editMember);
    return;
  }
  const enroll = event.target.closest("[data-enroll-member]");
  if (enroll) enrollMemberVoice(enroll.dataset.enrollMember);
});
document.querySelector("#identify-speaker").addEventListener("click", identifySpeaker);

grid.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-device]");
  if (edit) {
    openDeviceDialog(edit.dataset.editDevice);
    return;
  }
  const toggle = event.target.closest("[data-toggle]");
  if (!toggle) return;
  const device = devices.find((item) => item.id === toggle.dataset.toggle);
  if (!device) return;
  const enabled = toggle.getAttribute("aria-checked") !== "true";
  changeDevice(device.id, { enabled }).then(() => {
    showToast(`${device.room} · ${device.name}已${enabled ? "开启" : "关闭"}`);
  }).catch(showRequestError);
});

grid.addEventListener("input", (event) => {
  const slider = event.target.closest("[data-slider]");
  if (!slider) return;
  const device = devices.find((item) => item.id === slider.dataset.slider);
  if (!device) return;
  device.value = Number(slider.value);
  device.detail = `亮度 ${device.value}%`;
  const card = slider.closest(".device-card");
  card.querySelector(".device-meta").firstChild.textContent = device.detail;
});

grid.addEventListener("change", (event) => {
  const slider = event.target.closest("[data-slider]");
  if (!slider) return;
  changeDevice(slider.dataset.slider, { enabled: true, brightness: Number(slider.value) }).catch(showRequestError);
});

document.querySelector(".room-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-room]");
  if (tab) setRoom(tab.dataset.room);
});

document.querySelector(".scene-grid").addEventListener("click", (event) => {
  const scene = event.target.closest("[data-scene]");
  if (scene) applyScene(scene.dataset.scene);
});

document.querySelector("#assistant-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#assistant-input");
  sendChatMessage(input.value);
  input.value = "";
});

document.querySelector(".assistant-suggestions").addEventListener("click", (event) => {
  const suggestion = event.target.closest("[data-chat-prompt]");
  if (!suggestion) return;
  sendChatMessage(suggestion.dataset.chatPrompt);
});

document.querySelector("#clear-chat").addEventListener("click", resetChat);
resetChat();

document.querySelector("#mic-button").addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("当前浏览器不支持语音识别，请使用 Chrome/Edge 或输入文字指令。");
    return;
  }
  if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    showToast("语音识别需要 HTTPS 安全连接；请使用私人 VPN 提供的 HTTPS 地址。");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  const button = document.querySelector("#mic-button");
  const input = document.querySelector("#assistant-input");
  button.classList.add("listening");
  recognition.onresult = (event) => {
    input.value = event.results[0][0].transcript;
    speakNextReply = true;
    document.querySelector("#assistant-form").requestSubmit();
  };
  recognition.onerror = (event) => {
    speakNextReply = false;
    const message = event.error === "not-allowed"
      ? "麦克风权限未开启，请在浏览器设置中允许使用麦克风。"
      : `语音识别失败：${event.error}`;
    showToast(message);
  };
  recognition.onend = () => button.classList.remove("listening");
  try {
    window.speechSynthesis?.cancel();
    recognition.start();
  } catch (error) {
    speakNextReply = false;
    button.classList.remove("listening");
    showToast(`无法启动语音识别：${error.message}`);
  }
});

document.querySelectorAll("[data-focus-assistant]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("#assistant-input").focus();
    document.querySelector(".assistant-bar").scrollIntoView({ behavior: "smooth", block: "center" });
  });
});

document.querySelectorAll("[data-scroll-devices], [data-show-all]").forEach((button) => {
  button.addEventListener("click", () => {
    setRoom("全部");
    document.querySelector("#devices").scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());

document.querySelector("#greeting").textContent = new Intl.DateTimeFormat("zh-CN", {
  weekday: "long",
}).format(new Date()) + " · 美好的一天";

function showLogin(errorMessage = "") {
  currentUser = null;
  document.querySelector("#app-shell").hidden = true;
  document.querySelector("#login-screen").hidden = false;
  document.querySelector("#login-error").textContent = errorMessage;
  document.querySelector("#login-password").value = "";
}

async function initializeDashboard(user) {
  currentUser = user;
  document.querySelector("#login-screen").hidden = true;
  document.querySelector("#app-shell").hidden = false;
  document.querySelector("#current-user-label").textContent = user.displayName;
  document.querySelector("#welcome-name").textContent = `欢迎回来，${user.displayName}`;
  document.querySelector(".profile-copy strong").textContent = user.displayName;
  document.querySelector(".profile-copy small").textContent = user.role === "admin" ? "家庭管理员" : "家庭成员";
  document.querySelector(".avatar").textContent = user.displayName.slice(0, 1);
  document.querySelector("#add-device").hidden = user.role !== "admin";
  document.querySelector("#add-member").hidden = user.role !== "admin";
  renderDevices();
  updateSummary();
  try {
    const health = await requestApi("/api/health");
    document.querySelector("#connection-label").textContent = "本机服务已连接";
    document.querySelector("#assistant-status").textContent = health.aiEnabled
      ? `本地 AI 已配置 · ${health.aiModel}`
      : "基础指令模式 · 启用 Ollama 可自由聊天";
    document.querySelector("#runtime-mode").textContent = health.mode === "simulation"
      ? "本地模拟模式 · 状态重启后重置"
      : health.mode === "hybrid"
        ? `Home Assistant + 模拟设备 · ${health.mappedDevices}/${health.totalDevices} 已映射`
        : "Home Assistant 设备模式";
    await refreshDevices();
    await refreshMembers();
  } catch (error) {
    console.error(error);
    document.querySelector("#connection-label").textContent = "本机服务未连接";
    document.querySelector("#assistant-status").textContent = "无法载入家庭设备";
    document.querySelector("#runtime-mode").textContent = "服务连接失败；请检查本机服务";
    showToast(error.message);
  }
}

function suggestTerminalName() {
  const userAgent = navigator.userAgent;
  if (/iPhone|iPad/i.test(userAgent)) return "iPhone / iPad";
  if (/Android/i.test(userAgent)) return "Android 手机";
  if (/Macintosh|Mac OS/i.test(userAgent)) return "Mac 电脑";
  if (/Windows/i.test(userAgent)) return "Windows 电脑";
  return "家庭终端";
}

document.querySelector("#terminal-name").value = suggestTerminalName();
const userAgent = navigator.userAgent;
const isTabletOrPhone = /Android|iPhone|iPad|Mobile/i.test(userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isLocalDesktop = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname) && !isTabletOrPhone;
document.querySelector("#remember-device").checked = isLocalDesktop;
if (isLocalDesktop) document.querySelector("#login-username").value = "admin";
document.querySelector("#remember-device").addEventListener("change", (event) => {
  const enabled = event.target.checked;
  document.querySelector("#terminal-name-field").hidden = !enabled;
  document.querySelector("#trusted-device-hint").hidden = !enabled;
  document.querySelector("#terminal-name").required = enabled;
});
document.querySelector("#remember-device").dispatchEvent(new Event("change"));

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#login-form .login-submit");
  submit.disabled = true;
  document.querySelector("#login-error").textContent = "";
  try {
    const result = await requestApi("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.querySelector("#login-username").value,
        password: document.querySelector("#login-password").value,
        rememberDevice: document.querySelector("#remember-device").checked,
        deviceName: document.querySelector("#terminal-name").value,
      }),
    });
    document.querySelector("#login-password").value = "";
    const rememberDevice = document.querySelector("#remember-device");
    rememberDevice.checked = false;
    rememberDevice.dispatchEvent(new Event("change"));
    await initializeDashboard(result.user);
  } catch (error) {
    console.error(error);
    document.querySelector("#login-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await requestApi("/api/logout", { method: "POST", body: "{}" });
    chatHistory = [];
    resetChat();
    const rememberDevice = document.querySelector("#remember-device");
    rememberDevice.checked = false;
    rememberDevice.dispatchEvent(new Event("change"));
    document.querySelector("#terminal-name").value = suggestTerminalName();
    showLogin();
  } catch (error) {
    console.error(error);
    showToast(error.message);
  }
});

async function refreshTrustedDevices() {
  const result = await requestApi("/api/trusted-devices");
  const list = document.querySelector("#trusted-device-list");
  if (!result.devices.length) {
    list.innerHTML = '<p class="trusted-device-empty">目前没有保持登录的终端。</p>';
    return;
  }
  list.innerHTML = result.devices.map((device) => {
    const linkedAt = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(device.createdAt));
    const expiresAt = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(device.expiresAt));
    const owner = currentUser.role === "admin"
      ? `${escapeHtml(device.displayName)} · ${escapeHtml(device.username)} · `
      : "";
    const currentLabel = device.current ? " · 当前终端" : "";
    return `<div class="trusted-device-item">
      <div class="trusted-device-copy">
        <strong>${escapeHtml(device.name)}${currentLabel}</strong>
        <small>${owner}关联于 ${linkedAt} · 有效至 ${expiresAt}</small>
      </div>
      <button class="trusted-device-revoke" type="button" data-revoke-trusted-device="${escapeHtml(device.id)}">撤销</button>
    </div>`;
  }).join("");
}

document.querySelector("#trusted-device-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-revoke-trusted-device]");
  if (!button || !window.confirm("撤销后，该终端需要重新登录。确定继续吗？")) return;
  button.disabled = true;
  document.querySelector("#trusted-device-error").textContent = "";
  try {
    const result = await requestApi(`/api/trusted-devices/${encodeURIComponent(button.dataset.revokeTrustedDevice)}`, {
      method: "DELETE",
    });
    if (result.currentDevice) {
      document.querySelector("#preferences-dialog").close();
      showLogin("此终端关联已撤销，请重新登录。");
      return;
    }
    await refreshTrustedDevices();
    showToast("终端关联已撤销");
  } catch (error) {
    console.error(error);
    document.querySelector("#trusted-device-error").textContent = error.message;
    button.disabled = false;
  }
});

document.querySelector("#preferences-button").addEventListener("click", async () => {
  document.querySelector("#preferences-account-name").textContent = currentUser.username;
  document.querySelector("#preference-light-brightness").value = currentUser.preferences.lightBrightness;
  document.querySelector("#preference-ac-temperature").value = currentUser.preferences.acTemperature;
  document.querySelector("#preferences-error").textContent = "";
  document.querySelector("#current-password").value = "";
  document.querySelector("#new-password").value = "";
  document.querySelector("#password-error").textContent = "";
  document.querySelector("#trusted-device-error").textContent = "";
  document.querySelector("#preferences-dialog").showModal();
  try {
    await refreshTrustedDevices();
  } catch (error) {
    console.error(error);
    document.querySelector("#trusted-device-error").textContent = error.message;
  }
});

document.querySelectorAll("[data-close-preferences]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector("#preferences-dialog").close());
});

document.querySelector("#preferences-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#preferences-form .dialog-save");
  submit.disabled = true;
  document.querySelector("#preferences-error").textContent = "";
  try {
    const result = await requestApi("/api/preferences", {
      method: "PUT",
      body: JSON.stringify({
        preferences: {
          lightBrightness: Number(document.querySelector("#preference-light-brightness").value),
          acTemperature: Number(document.querySelector("#preference-ac-temperature").value),
        },
      }),
    });
    currentUser.preferences = result.preferences;
    document.querySelector("#preferences-dialog").close();
    showToast("个人设备偏好已保存");
  } catch (error) {
    console.error(error);
    document.querySelector("#preferences-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#password-form .dialog-save");
  submit.disabled = true;
  document.querySelector("#password-error").textContent = "";
  try {
    await requestApi("/api/account/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: document.querySelector("#current-password").value,
        newPassword: document.querySelector("#new-password").value,
      }),
    });
    document.querySelector("#password-form").reset();
    showToast("登录密码已更新");
  } catch (error) {
    console.error(error);
    document.querySelector("#password-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

async function startApp() {
  try {
    const session = await requestApi("/api/session");
    if (!session.authenticated) {
      showLogin();
      return;
    }
    await initializeDashboard(session.user);
  } catch (error) {
    console.error(error);
    showLogin(error.message);
  }
}

startApp();
