const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("script.js", "utf8");

function makeElement(id) {
  return {
    id,
    hidden: false,
    value: "",
    textContent: "",
    innerHTML: "",
    children: [],
    listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {},
    attributes: {},
    setAttribute(name, value) {
      this.attributes = { ...this.attributes, [name]: String(value) };
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
  };
}

const elements = new Map();
const document = {
  fullscreenEnabled: true,
  fullscreenElement: null,
  documentElement: makeElement("html"),
  listeners: {},
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  },
  createElement(tag) {
    return makeElement(tag);
  },
  querySelectorAll(selector) {
    if (selector !== "[data-fullscreen-button]") {
      return [];
    }

    if (!elements.has("start-fullscreen-button")) {
      elements.set("start-fullscreen-button", makeElement("start-fullscreen-button"));
    }
    if (!elements.has("exam-fullscreen-button")) {
      elements.set("exam-fullscreen-button", makeElement("exam-fullscreen-button"));
    }

    return [
      elements.get("start-fullscreen-button"),
      elements.get("exam-fullscreen-button"),
    ];
  },
  addEventListener(type, handler) {
    this.listeners[type] = handler;
  },
  async exitFullscreen() {
    this.fullscreenElement = null;
    this.listeners.fullscreenchange?.();
  },
};

document.documentElement.requestFullscreen = async () => {
  document.fullscreenElement = document.documentElement;
  document.listeners.fullscreenchange?.();
};

const window = {
  location: { search: "" },
  setInterval() {
    return 1;
  },
  clearInterval() {},
  addEventListener() {},
  getComputedStyle() {
    return { paddingTop: "0", paddingRight: "0", paddingBottom: "0", paddingLeft: "0" };
  },
};

const context = {
  console,
  document,
  window,
  URLSearchParams,
  Date,
  Math,
  String,
  Number,
  RegExp,
};

vm.createContext(context);
vm.runInContext(code, context);

const buttons = [
  elements.get("start-fullscreen-button"),
  elements.get("exam-fullscreen-button"),
];

if (buttons.some((button) => !button || button.hidden)) {
  throw new Error("fullscreen buttons should be visible when Fullscreen API is supported");
}

for (const button of buttons) {
  if (button.textContent !== "전체 화면") {
    throw new Error(`initial label mismatch: ${button.id} ${button.textContent}`);
  }
}

document.fullscreenElement = document.documentElement;
context.window.__examScheduleApp.updateFullscreenButton();
for (const button of buttons) {
  if (button.textContent !== "전체 화면 해제") {
    throw new Error(`active label mismatch: ${button.id} ${button.textContent}`);
  }
}

document.fullscreenElement = null;
context.window.__examScheduleApp.updateFullscreenButton();
for (const button of buttons) {
  if (button.textContent !== "전체 화면") {
    throw new Error(`inactive label mismatch: ${button.id} ${button.textContent}`);
  }
}

console.log("checked fullscreen button visibility and labels on both screens");
