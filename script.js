(function () {
  "use strict";

  const EXAM_DAYS = {
    "2026-07-06": {
      label: "7월 6일 월요일",
      grades: {
        "2": ["자율", "기술·가정", "한문/생활일본어"],
        "3": ["기술·가정", "자율", "사회"],
      },
    },
    "2026-07-07": {
      label: "7월 7일 화요일",
      grades: {
        "2": ["과학", "도덕", "자율"],
        "3": ["자율", "도덕", "과학"],
      },
    },
    "2026-07-08": {
      label: "7월 8일 수요일",
      grades: {
        "2": ["영어", "자율", "역사"],
        "3": ["자율", "역사", "영어"],
      },
    },
    "2026-07-09": {
      label: "7월 9일 목요일",
      grades: {
        "2": ["국어", "자율", "수학"],
        "3": ["국어", "수학", "자율"],
      },
    },
  };

  const GRADES = {
    "2": "2학년",
    "3": "3학년",
  };

  const PERIODS = [
    {
      period: 1,
      prepStart: "09:00",
      prepEnd: "09:05",
      examStart: "09:05",
      examEnd: "09:50",
    },
    {
      period: 2,
      prepStart: "10:05",
      prepEnd: "10:10",
      examStart: "10:10",
      examEnd: "10:55",
    },
    {
      period: 3,
      prepStart: "11:10",
      prepEnd: "11:15",
      examStart: "11:15",
      examEnd: "12:00",
    },
  ].map((period) => ({
    ...period,
    prepStartSeconds: timeToSeconds(period.prepStart),
    prepEndSeconds: timeToSeconds(period.prepEnd),
    examStartSeconds: timeToSeconds(period.examStart),
    examEndSeconds: timeToSeconds(period.examEnd),
  }));

  const BREAKS = [
    {
      afterPeriod: 1,
      nextPeriod: 2,
      start: "09:50",
      end: "10:05",
    },
    {
      afterPeriod: 2,
      nextPeriod: 3,
      start: "10:55",
      end: "11:10",
    },
  ].map((breakTime) => ({
    ...breakTime,
    startSeconds: timeToSeconds(breakTime.start),
    endSeconds: timeToSeconds(breakTime.end),
  }));

  const state = {
    selectedDay: "",
    selectedGrade: "",
    testBaseSeconds: null,
    testStartedAt: null,
    timerId: null,
    wakeLock: null,
    renderedHighlight: undefined,
  };

  const elements = {
    startScreen: document.getElementById("start-screen"),
    appTitle: document.getElementById("app-title"),
    startContent: document.getElementById("start-content"),
    examScreen: document.getElementById("exam-screen"),
    dateOptions: document.getElementById("date-options"),
    gradeOptions: document.getElementById("grade-options"),
    testTime: document.getElementById("test-time"),
    testToggle: document.getElementById("test-toggle"),
    startButton: document.getElementById("start-button"),
    startError: document.getElementById("start-error"),
    backButton: document.getElementById("back-button"),
    fullscreenButtons: Array.from(document.querySelectorAll("[data-fullscreen-button]")),
    currentTime: document.getElementById("current-time"),
    selectionLabel: document.getElementById("selection-label"),
    testBadge: document.getElementById("test-badge"),
    scheduleList: document.getElementById("schedule-list"),
    topBar: document.getElementById("top-bar"),
    schedulePanel: document.getElementById("schedule-panel"),
    stage: document.getElementById("stage"),
    stageContent: document.getElementById("stage-content"),
    statusMessage: document.getElementById("status-message"),
    remainingTime: document.getElementById("remaining-time"),
  };

  function timeToSeconds(timeText) {
    const parts = String(timeText).split(":").map(Number);
    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }

  function secondsToClock(totalSeconds) {
    const normalized = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
    const hours = Math.floor(normalized / 3600);
    const minutes = Math.floor((normalized % 3600) / 60);
    return `현재 시각   ${pad(hours)}시 ${pad(minutes)}분`;
  }

  function secondsToMinutesSeconds(totalSeconds) {
    const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function isAutonomous(subject) {
    return subject === "자율";
  }

  function displaySubject(subject) {
    return isAutonomous(subject) ? "자율학습" : subject;
  }

  function parseTestTime(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      return { valid: true, seconds: null };
    }

    let hours;
    let minutes;
    let seconds = 0;
    const separatedMatch = trimmed.match(/^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/);
    const compactMatch = trimmed.match(/^(\d{3,4})$/);

    if (separatedMatch) {
      hours = Number(separatedMatch[1]);
      minutes = Number(separatedMatch[2]);
      seconds = separatedMatch[3] === undefined ? 0 : Number(separatedMatch[3]);
    } else if (compactMatch) {
      const compact = compactMatch[1];
      const hourDigits = compact.length === 3 ? 1 : 2;
      hours = Number(compact.slice(0, hourDigits));
      minutes = Number(compact.slice(hourDigits));
    } else {
      return { valid: false, seconds: null, normalized: "" };
    }

    if (
      !Number.isInteger(hours) ||
      !Number.isInteger(minutes) ||
      !Number.isInteger(seconds) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59 ||
      seconds < 0 ||
      seconds > 59
    ) {
      return { valid: false, seconds: null, normalized: "" };
    }

    return {
      valid: true,
      seconds: hours * 3600 + minutes * 60 + seconds,
      normalized: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
    };
  }

  function getNowSeconds() {
    if (state.testBaseSeconds !== null) {
      const elapsed = Math.floor((Date.now() - state.testStartedAt) / 1000);
      return state.testBaseSeconds + elapsed;
    }

    const now = new Date();
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  }

  function getTodayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function getTestBadgeText() {
    if (state.selectedDay !== getTodayKey()) {
      return "테스트 중";
    }
    if (state.testBaseSeconds !== null) {
      return "테스트 모드";
    }
    return "";
  }

  function getCurrentSegment(nowSeconds, subjects) {
    const firstPrepStart = PERIODS[0].prepStartSeconds;
    const dayEnd = PERIODS[2].examEndSeconds;

    if (nowSeconds < firstPrepStart) {
      return {
        type: "before",
        message: "1교시 준비까지",
        remainingSeconds: firstPrepStart - nowSeconds,
        currentPeriod: null,
        highlightPeriod: null,
        isDanger: false,
      };
    }

    if (nowSeconds >= dayEnd) {
      return {
        type: "ended",
        message: "오늘 시험 종료",
        remainingSeconds: null,
        currentPeriod: null,
        highlightPeriod: null,
        isDanger: false,
      };
    }

    for (const period of PERIODS) {
      const subject = subjects[period.period - 1];

      if (nowSeconds >= period.prepStartSeconds && nowSeconds < period.prepEndSeconds) {
        return {
          type: "prep",
          message: `${displaySubject(subject)} 준비`,
          smallText: "준비",
          remainingSeconds: period.prepEndSeconds - nowSeconds,
          currentPeriod: period.period,
          highlightPeriod: period.period,
          isDanger: false,
        };
      }

      if (nowSeconds >= period.examStartSeconds && nowSeconds < period.examEndSeconds) {
        const remainingSeconds = period.examEndSeconds - nowSeconds;
        const autonomous = isAutonomous(subject);

        return {
          type: autonomous ? "autonomous" : "exam",
          message: autonomous ? "자율학습" : subject,
          remainingSeconds,
          currentPeriod: period.period,
          highlightPeriod: period.period,
          isDanger: !autonomous && remainingSeconds <= 10 * 60,
        };
      }
    }

    for (const breakTime of BREAKS) {
      if (nowSeconds >= breakTime.startSeconds && nowSeconds < breakTime.endSeconds) {
        const nextSubject = subjects[breakTime.nextPeriod - 1];

        return {
          type: "break",
          message: isAutonomous(nextSubject)
            ? "다음 시간: 자율학습"
            : `다음 과목: ${nextSubject}`,
          smallText: isAutonomous(nextSubject) ? "다음 시간:" : "다음 과목:",
          remainingSeconds: breakTime.endSeconds - nowSeconds,
          currentPeriod: null,
          highlightPeriod: null,
          isDanger: false,
        };
      }
    }

    return {
      type: "unknown",
      message: "시간표 확인 필요",
      remainingSeconds: null,
      currentPeriod: null,
      highlightPeriod: null,
      isDanger: false,
    };
  }

  function getSelectedSubjects() {
    return EXAM_DAYS[state.selectedDay].grades[state.selectedGrade];
  }

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  function getShortDayLabel(dayKey) {
    const [year, month, day] = dayKey.split("-").map(Number);
    const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];
    return `${month}/${day}(${weekday})`;
  }

  function isExamDay(dayKey) {
    return Object.prototype.hasOwnProperty.call(EXAM_DAYS, dayKey);
  }

  // 학교안심 알림장체는 '1'만 폭이 절반이고 tabular-nums도 지원하지 않는다.
  // 그래서 숫자마다 가장 넓은 숫자 폭의 칸을 주어, 시간이 바뀌어도 글자가 좌우로 흔들리지 않게 한다.
  const digitWidthCache = new Map();

  function getDigitWidthEm(element) {
    const style = window.getComputedStyle(element);
    if (!style.fontWeight || !style.fontFamily) {
      return 0;
    }

    const key = `${style.fontWeight}|${style.fontFamily}`;
    if (!digitWidthCache.has(key)) {
      const context = document.createElement("canvas").getContext?.("2d");
      if (!context) {
        return 0;
      }
      context.font = `${style.fontWeight} 100px ${style.fontFamily}`;
      const widest = Math.max(...Array.from("0123456789", (digit) => context.measureText(digit).width));
      digitWidthCache.set(key, widest / 100);
    }
    return digitWidthCache.get(key);
  }

  // 학교안심 알림장체의 '/'는 거의 세로로 서 있어 '│'처럼 보이므로, '/'만 다른 글꼴로 표시한다.
  function appendWithSlash(parent, text) {
    text.split(/(\/)/).forEach((piece) => {
      if (!piece) {
        return;
      }
      if (piece === "/") {
        const slash = document.createElement("span");
        slash.className = "slash";
        slash.textContent = "/";
        parent.append(slash);
      } else {
        parent.append(piece);
      }
    });
  }

  // 화면에 붙은 요소에만 쓴다(글꼴 정보를 읽어야 하므로).
  // smallUnits: 숫자 바로 뒤에 붙을 때만 작게 표시할 단위 글자(예: '09시'의 '시').
  function setDigitText(element, text, smallUnits = []) {
    const value = String(text);
    const width = getDigitWidthEm(element);
    const renderKey = `${width}|${value}`;
    if (element.digitRenderKey === renderKey) {
      return;
    }
    element.digitRenderKey = renderKey;

    if (!width) {
      element.textContent = value;
      return;
    }

    element.textContent = "";
    value.split(/(\s+)/).forEach((part) => {
      if (!part) {
        return;
      }
      if (/^\s+$/.test(part)) {
        element.append(part);
        return;
      }

      // 숫자 칸 때문에 '1교시' 같은 단어가 중간에서 줄바꿈되지 않도록 단어 단위로 묶는다.
      const word = document.createElement("span");
      word.className = "digit-word";
      let previousRun = "";
      part.match(/\d|\D+/g).forEach((run) => {
        if (/\d/.test(run)) {
          const digit = document.createElement("span");
          digit.className = "digit";
          digit.style.width = `${width}em`;
          digit.textContent = run;
          word.append(digit);
        } else if (smallUnits.includes(run) && /\d$/.test(previousRun)) {
          const unit = document.createElement("span");
          unit.className = "unit";
          unit.textContent = run;
          word.append(unit);
        } else {
          appendWithSlash(word, run);
        }
        previousRun = run;
      });
      element.append(word);
    });
  }

  function refreshDigitText() {
    digitWidthCache.clear();
    elements.statusMessage.statusRenderKey = undefined;
    setDigitText(elements.appTitle, elements.appTitle.textContent);
    renderStartOptions();
    if (isExamScreenVisible()) {
      setDigitText(elements.selectionLabel, getSelectionLabel());
      state.renderedHighlight = undefined;
      updateExamScreen();
    }
  }

  function getSelectionLabel() {
    return `${getShortDayLabel(state.selectedDay)}   ${GRADES[state.selectedGrade]}`;
  }

  function renderStartOptions() {
    const todayKey = getTodayKey();

    elements.dateOptions.innerHTML = "";
    Object.entries(EXAM_DAYS).forEach(([dayKey, day]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.setAttribute("aria-pressed", String(state.selectedDay === dayKey));
      button.addEventListener("click", () => {
        state.selectedDay = dayKey;
        elements.startError.textContent = "";
        renderStartOptions();
      });
      elements.dateOptions.appendChild(button);
      setDigitText(button, day.label);
      if (dayKey === todayKey) {
        const tag = document.createElement("span");
        tag.className = "today-tag";
        tag.textContent = "오늘";
        button.append(tag);
      }
    });

    elements.gradeOptions.innerHTML = "";
    Object.entries(GRADES).forEach(([gradeKey, gradeLabel]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.setAttribute("aria-pressed", String(state.selectedGrade === gradeKey));
      button.addEventListener("click", () => {
        state.selectedGrade = gradeKey;
        elements.startError.textContent = "";
        renderStartOptions();
      });
      elements.gradeOptions.appendChild(button);
      setDigitText(button, gradeLabel);
    });

    fitScreens();
  }

  function setTestTimeOpen(open) {
    elements.testToggle.setAttribute("aria-expanded", String(open));
    elements.testTime.hidden = !open;
    fitScreens();
  }

  function showStartError(message) {
    setDigitText(elements.startError, message);
    fitScreens();
  }

  function startExam() {
    elements.startError.textContent = "";

    if (!state.selectedDay || !state.selectedGrade) {
      showStartError("날짜와 학년을 모두 선택해 주세요.");
      return;
    }

    const testResult = parseTestTime(elements.testTime.value);
    if (!testResult.valid) {
      setTestTimeOpen(true);
      showStartError("테스트 시간은 09:40, 9:40, 0940, 940, 09.40 형식으로 입력해 주세요.");
      return;
    }

    state.testBaseSeconds = testResult.seconds;
    state.testStartedAt = Date.now();
    state.renderedHighlight = undefined;

    elements.startScreen.classList.add("hidden");
    elements.examScreen.classList.remove("hidden");
    setDigitText(elements.selectionLabel, getSelectionLabel());

    updateExamScreen();
    restartTimer();
    requestWakeLock();
  }

  function returnToStart() {
    stopTimer();
    releaseWakeLock();
    elements.examScreen.classList.add("hidden");
    elements.startScreen.classList.remove("hidden");
    // 시작 화면으로 돌아오면 테스트 시간은 항상 빈 칸이다.
    elements.testTime.value = "";
    state.testBaseSeconds = null;
    state.testStartedAt = null;
    renderStartOptions();
  }

  function restartTimer() {
    stopTimer();
    state.timerId = window.setInterval(updateExamScreen, 1000);
  }

  function stopTimer() {
    if (state.timerId !== null) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  // 전자칠판에서 스크롤이 생기지 않도록, 내용이 들어갈 공간보다 크면 비율을 유지한 채 축소한다.
  // transform과 달리 zoom은 레이아웃 크기 자체를 줄이므로 넘친 영역이 남지 않는다.
  function fitToBox(content, availableWidth, availableHeight) {
    content.style.zoom = "";
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    if (!width || !height || availableWidth <= 0 || availableHeight <= 0) {
      return;
    }

    const scale = Math.min(1, availableWidth / width, availableHeight / height);
    if (scale < 1) {
      content.style.zoom = String(Math.floor(scale * 1000) / 1000);
    }
  }

  function getContentBox(element) {
    const style = window.getComputedStyle(element);
    return {
      width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    };
  }

  function fitScreens() {
    if (!elements.startScreen.classList.contains("hidden")) {
      const box = getContentBox(elements.startScreen);
      fitToBox(elements.startContent, box.width, box.height);
    }

    if (isExamScreenVisible()) {
      fitWidth(elements.topBar);
      // 가운데 문구는 항상 한 줄이므로, 폭을 넘으면 문구만 줄인 뒤 가운데 영역 전체를 맞춘다.
      elements.stageContent.style.zoom = "";
      fitWidth(elements.statusMessage);
      fitRemainingTime();
      fitToBox(elements.stageContent, elements.stage.clientWidth, elements.stage.clientHeight);
      fitToBox(elements.schedulePanel, elements.schedulePanel.offsetWidth, elements.stage.clientHeight);
    }
  }

  // 폭이 정해진 요소(상단 바, 가운데 문구)가 넘칠 때 zoom을 줄이면 같은 폭 안에 내용이 다 들어간다.
  function fitWidth(element) {
    element.style.zoom = "";
    let zoom = 1;
    // 픽셀 반올림 때문에 한 번에 딱 맞지 않을 수 있어 몇 번 더 맞춘다.
    for (let attempt = 0; attempt < 4 && element.scrollWidth > element.clientWidth && element.clientWidth > 0; attempt += 1) {
      zoom = Math.floor(zoom * (element.clientWidth / element.scrollWidth) * 1000 - 2) / 1000;
      element.style.zoom = String(zoom);
    }
  }

  // 남은 시간은 가운데 영역의 남는 폭과 높이를 꽉 채우는 크기로 정한다.
  // 바닥은 CSS로 아래쪽 여백 경계에 고정되어 있으므로, 커질수록 위쪽(가운데 문구 쪽) 빈 공간만 줄어든다.
  function fitRemainingTime() {
    const time = elements.remainingTime;
    time.style.fontSize = "";
    if (!time.offsetHeight) {
      return;
    }

    const fontSize = parseFloat(window.getComputedStyle(time).fontSize);
    // 문단 폭이 아니라 글자들이 실제로 차지하는 폭을 잰다.
    const range = document.createRange();
    range.selectNodeContents(time);
    const textWidth = range.getBoundingClientRect().width;
    // 글자 크기에 비례해 차지하는 높이(글자 상자 1.2em - 아래로 당긴 0.19em)
    const heightPerFont = (time.offsetHeight + parseFloat(window.getComputedStyle(time).marginBottom)) / fontSize;
    const otherHeight = elements.stageContent.offsetHeight - heightPerFont * fontSize;

    const byWidth = elements.stage.clientWidth / (textWidth / fontSize);
    const byHeight = (elements.stage.clientHeight - otherHeight) / heightPerFont;
    const fitted = Math.floor(Math.min(byWidth, byHeight) * 0.98);
    if (fitted > 0) {
      time.style.fontSize = `${fitted}px`;
    }
  }

  function isExamScreenVisible() {
    return !elements.examScreen.classList.contains("hidden");
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || state.wakeLock !== null) {
      return;
    }

    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!isExamScreenVisible()) {
        lock.release();
        return;
      }
      state.wakeLock = lock;
      lock.addEventListener("release", () => {
        if (state.wakeLock === lock) {
          state.wakeLock = null;
        }
      });
    } catch (error) {
      console.info("화면 꺼짐 방지를 켜지 못했습니다.", error);
    }
  }

  function releaseWakeLock() {
    if (state.wakeLock !== null) {
      state.wakeLock.release();
      state.wakeLock = null;
    }
  }

  function handleVisibilityChange() {
    // 탭이 가려지면 브라우저가 화면 꺼짐 방지를 자동 해제하므로 다시 보일 때 재요청한다.
    if (document.visibilityState === "visible" && isExamScreenVisible()) {
      requestWakeLock();
    }
  }

  function isFullscreenSupported() {
    return Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
  }

  function isFullscreenActive() {
    return Boolean(document.fullscreenElement);
  }

  function updateFullscreenButton() {
    const active = isFullscreenActive();
    const label = active ? "전체 화면 해제" : "전체 화면";
    elements.fullscreenButtons.forEach((button) => {
      button.textContent = label;
    });
  }

  async function toggleFullscreen() {
    if (!isFullscreenSupported()) {
      console.info("이 브라우저는 Fullscreen API를 지원하지 않습니다.");
      return;
    }

    try {
      if (isFullscreenActive()) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.info("전체 화면 전환에 실패했습니다.", error);
    } finally {
      updateFullscreenButton();
    }
  }

  function renderSchedule(highlightPeriod) {
    // 강조할 교시가 바뀔 때만 다시 그린다.
    if (state.renderedHighlight === highlightPeriod) {
      return;
    }
    state.renderedHighlight = highlightPeriod;

    const subjects = getSelectedSubjects();
    elements.scheduleList.innerHTML = "";

    PERIODS.forEach((period) => {
      const item = document.createElement("li");
      const isHighlighted = period.period === highlightPeriod;
      item.className = `schedule-item${isHighlighted ? " current" : ""}`;
      if (isHighlighted) {
        item.setAttribute("aria-current", "true");
      }

      const name = document.createElement("span");
      name.className = "schedule-name";

      const time = document.createElement("span");
      time.className = "schedule-time";

      item.append(name, time);
      elements.scheduleList.appendChild(item);
      // '▶ ' 자리는 모든 줄에 잡아 두고 현재 교시만 보이게 한다.
      // 그래야 교시가 바뀌어도 시간표 폭(따라서 남은 시간 크기)이 변하지 않는다.
      const marker = document.createElement("span");
      marker.className = `schedule-marker${isHighlighted ? " visible" : ""}`;
      marker.textContent = "▶";
      const label = document.createElement("span");
      name.append(marker, label);
      setDigitText(label, `${period.period}교시   ${displaySubject(subjects[period.period - 1])}`);
      setDigitText(time, `${period.examStart}~${period.examEnd}`);
    });
  }

  function updateExamScreen() {
    const nowSeconds = getNowSeconds();
    const subjects = getSelectedSubjects();
    const segment = getCurrentSegment(nowSeconds, subjects);

    setDigitText(elements.currentTime, secondsToClock(nowSeconds), ["시", "분"]);
    renderStatusMessage(segment);

    const badgeText = getTestBadgeText();
    elements.testBadge.textContent = badgeText;
    elements.testBadge.classList.toggle("hidden", badgeText === "");

    const hasTime = segment.remainingSeconds !== null;
    elements.stageContent.classList.toggle("no-time", !hasTime);
    setDigitText(elements.remainingTime, hasTime ? secondsToMinutesSeconds(segment.remainingSeconds) : "");
    elements.remainingTime.classList.toggle("danger", segment.isDanger);

    renderSchedule(segment.highlightPeriod);
    fitScreens();
  }

  // 가운데 문구. smallText(예: '준비', '다음 과목:')만 15% 작게 표시한다.
  function renderStatusMessage(segment) {
    const element = elements.statusMessage;
    const smallText = segment.smallText || "";
    const renderKey = `${segment.message}|${smallText}`;
    if (element.statusRenderKey === renderKey) {
      return;
    }
    element.statusRenderKey = renderKey;

    const index = smallText ? segment.message.indexOf(smallText) : -1;
    if (index < 0) {
      element.digitRenderKey = undefined;
      setDigitText(element, segment.message);
      return;
    }

    element.digitRenderKey = undefined;
    element.textContent = "";
    [
      [segment.message.slice(0, index), false],
      [smallText, true],
      [segment.message.slice(index + smallText.length), false],
    ].forEach(([text, small]) => {
      if (!text) {
        return;
      }
      const part = document.createElement("span");
      if (small) {
        part.className = "status-small";
      }
      element.append(part);
      setDigitText(part, text);
    });
  }

  function init() {
    const todayKey = getTodayKey();
    if (isExamDay(todayKey)) {
      state.selectedDay = todayKey;
    }

    // 새로고침하거나 새로 열면 테스트 시간은 항상 빈 상태로 시작한다(브라우저가 이전 입력을 되살려도 지운다).
    elements.testTime.value = "";
    setDigitText(elements.appTitle, elements.appTitle.textContent);
    renderStartOptions();
    elements.backButton.addEventListener("click", returnToStart);
    elements.startButton.addEventListener("click", startExam);
    elements.testToggle.addEventListener("click", () => {
      const open = elements.testToggle.getAttribute("aria-expanded") !== "true";
      setTestTimeOpen(open);
      if (open) {
        elements.testTime.focus();
      }
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("resize", fitScreens);
    if (document.fonts && document.fonts.ready) {
      // 글꼴을 다 받기 전에 잰 숫자 폭은 대체 글꼴 기준이므로, 받은 뒤 다시 잰다.
      document.fonts.ready.then(() => {
        refreshDigitText();
        fitScreens();
      });
    }

    if (isFullscreenSupported()) {
      elements.fullscreenButtons.forEach((button) => {
        button.addEventListener("click", toggleFullscreen);
      });
      document.addEventListener("fullscreenchange", updateFullscreenButton);
      updateFullscreenButton();
    } else {
      console.info("이 브라우저는 Fullscreen API를 지원하지 않습니다.");
      elements.fullscreenButtons.forEach((button) => {
        button.hidden = true;
      });
    }
  }

  window.__examScheduleApp = {
    EXAM_DAYS,
    PERIODS,
    BREAKS,
    timeToSeconds,
    secondsToMinutesSeconds,
    getCurrentSegment,
    isAutonomous,
    displaySubject,
    parseTestTime,
    isFullscreenSupported,
    updateFullscreenButton,
  };

  init();
})();
