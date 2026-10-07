const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("script.js", "utf8");

function makeElement(id) {
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {},
    setAttribute() {},
    addEventListener() {},
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
  fullscreenEnabled: false,
  addEventListener() {},
  documentElement: makeElement("html"),
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

const app = context.window.__examScheduleApp;
const subjectsExam = app.EXAM_DAYS["2026-07-06"].grades["3"];
const subjectsAutonomous = app.EXAM_DAYS["2026-07-06"].grades["2"];
const subjectsFirstPeriodAutonomous = app.EXAM_DAYS["2026-07-07"].grades["3"];

const cases = [
  ["08:40", subjectsExam, "1교시 준비까지", false, null],
  ["09:00", subjectsExam, "기술·가정 준비", false, 1],
  ["09:02", subjectsExam, "기술·가정 준비", false, 1],
  ["09:05", subjectsExam, "기술·가정", false, 1],
  ["09:06", subjectsExam, "기술·가정", false, 1],
  ["09:39", subjectsExam, "기술·가정", false, 1],
  ["09:40", subjectsExam, "기술·가정", true, 1],
  ["09:49", subjectsExam, "기술·가정", true, 1],
  ["09:50", subjectsExam, "다음 시간: 자율학습", false, null],
  ["10:05", subjectsExam, "자율학습 준비", false, 2],
  ["10:06", subjectsExam, "자율학습 준비", false, 2],
  ["10:10", subjectsExam, "자율학습", false, 2],
  ["10:46", subjectsExam, "자율학습", false, 2],
  ["10:55", subjectsExam, "다음 과목: 사회", false, null],
  ["11:10", subjectsExam, "사회 준비", false, 3],
  ["11:12", subjectsExam, "사회 준비", false, 3],
  ["11:15", subjectsExam, "사회", false, 3],
  ["11:50", subjectsExam, "사회", true, 3],
  ["12:00", subjectsExam, "오늘 시험 종료", false, null],
  ["09:40", subjectsAutonomous, "자율학습", false, 1],
  ["10:55", subjectsAutonomous, "다음 과목: 한문/생활일본어", false, null],
  ["09:00", subjectsFirstPeriodAutonomous, "자율학습 준비", false, 1],
  ["09:05", subjectsFirstPeriodAutonomous, "자율학습", false, 1],
];

for (const [time, subjects, message, danger, highlight] of cases) {
  const segment = app.getCurrentSegment(app.timeToSeconds(time), subjects);
  if (
    segment.message !== message ||
    segment.isDanger !== danger ||
    segment.highlightPeriod !== highlight
  ) {
    throw new Error(
      `${time}: got ${JSON.stringify(segment)}, expected message=${message}, danger=${danger}, highlight=${highlight}`
    );
  }
}

const urlCases = [
  ["?test=08:40", subjectsExam, "1교시 준비까지"],
  ["?test=09:50", subjectsExam, "다음 시간: 자율학습"],
  ["?test=10:55", subjectsAutonomous, "다음 과목: 한문/생활일본어"],
  ["?test=09:40", subjectsExam, "기술·가정"],
  ["?test=0940", subjectsExam, "기술·가정"],
  ["?test=940", subjectsExam, "기술·가정"],
  ["?test=09.40", subjectsExam, "기술·가정"],
];

for (const [query, subjects, message] of urlCases) {
  const value = new URLSearchParams(query).get("test");
  const parsed = app.parseTestTime(value);
  if (!parsed.valid || parsed.seconds === null) {
    throw new Error(`${query}: test time was not parsed`);
  }

  const segment = app.getCurrentSegment(parsed.seconds, subjects);
  if (segment.message !== message) {
    throw new Error(`${query}: got ${JSON.stringify(segment)}, expected message=${message}`);
  }
}

const validParseCases = [
  ["09:40", "09:40:00"],
  ["9:40", "09:40:00"],
  ["0940", "09:40:00"],
  ["940", "09:40:00"],
  ["09.40", "09:40:00"],
  ["9.40", "09:40:00"],
  ["1245", "12:45:00"],
  ["", null],
];

for (const [input, normalized] of validParseCases) {
  const parsed = app.parseTestTime(input);
  if (!parsed.valid) {
    throw new Error(`${input}: expected valid parse`);
  }

  if (normalized === null) {
    if (parsed.seconds !== null) {
      throw new Error(`${input}: expected real-time mode`);
    }
  } else if (parsed.normalized !== normalized) {
    throw new Error(`${input}: got normalized=${parsed.normalized}, expected ${normalized}`);
  }
}

const invalidParseCases = ["2460", "1265", "99:99", "abcd"];
for (const input of invalidParseCases) {
  const parsed = app.parseTestTime(input);
  if (parsed.valid) {
    throw new Error(`${input}: expected invalid parse`);
  }
}

console.log(
  `checked ${cases.length} schedule cases, ${urlCases.length} URL test cases, ${validParseCases.length} valid parse cases, and ${invalidParseCases.length} invalid parse cases`
);
