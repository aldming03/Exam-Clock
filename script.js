(function () {
  "use strict";

  const EXAM_DAYS = {
    "2026-10-12": {
      label: "10월 12일 월요일",
      grades: {
        "1": ["자율", "국어", "수학"],
        "2": ["국어", "수학", "자율"],
        "3": ["국어", "자율", "수학"],
      },
    },
    "2026-10-13": {
      label: "10월 13일 화요일",
      grades: {
        "1": ["과학", "사회", "자율"],
        "2": ["자율", "자율", "과학"],
        "3": ["자율", "사회", "과학"],
      },
    },
    "2026-10-14": {
      label: "10월 14일 수요일",
      grades: {
        "1": ["자율", "자율", "영어"],
        "2": ["자율", "역사", "영어"],
        "3": ["역사", "영어", "자율"],
      },
    },
  };

  const GRADES = {
    "1": "1학년",
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
    scheduleList: document.getElementById("schedule-list"),
    topBar: document.getElementById("top-bar"),
    schedulePanel: document.getElementById("schedule-panel"),
    scheduleOutline: document.getElementById("schedule-outline"),
    scheduleCurrent: document.getElementById("schedule-current"),
    timeNotice: document.getElementById("time-notice"),
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

  // 현재 시각: 숫자는 0단계, '시'·'분'은 1단계, '현재 시각'은 2단계 (setLeveledText() 참고)
  function getClockParts(totalSeconds) {
    const normalized = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
    const hours = Math.floor(normalized / 3600);
    const minutes = Math.floor((normalized % 3600) / 60);
    return [
      ["현재 시각   ", 2],
      [pad(hours), 0],
      ["시 ", 1],
      [pad(minutes), 0],
      ["분", 1],
    ];
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

  // 오늘이 아닌 날짜를 골랐거나 테스트 시간을 입력했으면 테스트 모드다(남은 시간이 파란색).
  function isTestMode() {
    return state.selectedDay !== getTodayKey() || state.testBaseSeconds !== null;
  }

  // 가운데 문구는 줄 목록 [글자, 조금 더 큰지]로 만든다. message는 줄을 띄어쓰기로 이은 것.
  function withLines(segment, lines) {
    return {
      ...segment,
      lines,
      message: lines.map(([text]) => text).join(" "),
    };
  }

  function getCurrentSegment(nowSeconds, subjects) {
    const firstPrepStart = PERIODS[0].prepStartSeconds;
    const dayEnd = PERIODS[2].examEndSeconds;

    if (nowSeconds < firstPrepStart) {
      return withLines({
        type: "before",
        remainingSeconds: firstPrepStart - nowSeconds,
        currentPeriod: null,
        highlightPeriod: null,
        isDanger: false,
      }, [["1교시", false], ["준비까지", false]]);
    }

    if (nowSeconds >= dayEnd) {
      return withLines({
        type: "ended",
        remainingSeconds: null,
        currentPeriod: null,
        highlightPeriod: null,
        isDanger: false,
      }, [["오늘 시험 종료", false]]);
    }

    for (const period of PERIODS) {
      const subject = subjects[period.period - 1];

      if (nowSeconds >= period.prepStartSeconds && nowSeconds < period.prepEndSeconds) {
        return withLines({
          type: "prep",
          remainingSeconds: period.prepEndSeconds - nowSeconds,
          currentPeriod: period.period,
          highlightPeriod: period.period,
          isDanger: false,
        }, [[displaySubject(subject), true], ["준비", false]]);
      }

      if (nowSeconds >= period.examStartSeconds && nowSeconds < period.examEndSeconds) {
        const remainingSeconds = period.examEndSeconds - nowSeconds;
        const autonomous = isAutonomous(subject);

        return withLines({
          type: autonomous ? "autonomous" : "exam",
          remainingSeconds,
          currentPeriod: period.period,
          highlightPeriod: period.period,
          isDanger: !autonomous && remainingSeconds <= 10 * 60,
        }, [[displaySubject(subject), true], [autonomous ? "진행 중" : "시험 중", false]]);
      }
    }

    for (const breakTime of BREAKS) {
      if (nowSeconds >= breakTime.startSeconds && nowSeconds < breakTime.endSeconds) {
        const nextSubject = subjects[breakTime.nextPeriod - 1];

        return withLines({
          type: "break",
          remainingSeconds: breakTime.endSeconds - nowSeconds,
          currentPeriod: null,
          highlightPeriod: null,
          isDanger: false,
        }, [
          [isAutonomous(nextSubject) ? "다음 시간" : "다음 과목", false],
          [displaySubject(nextSubject), true],
        ]);
      }
    }

    return withLines({
      type: "unknown",
      remainingSeconds: null,
      currentPeriod: null,
      highlightPeriod: null,
      isDanger: false,
    }, [["시간표 확인 필요", false]]);
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
  function setDigitText(element, text) {
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
      part.match(/\d|\D+/g).forEach((run) => {
        if (/\d/.test(run)) {
          const digit = document.createElement("span");
          digit.className = "digit";
          digit.style.width = `${width}em`;
          digit.textContent = run;
          word.append(digit);
        } else {
          appendWithSlash(word, run);
        }
      });
      element.append(word);
    });
  }

  // 위쪽 좌우 아래 줄은 글자마다 크기 단계(0이 가장 큼)를 둔다. style.css의 .level-1, .level-2 참고.
  // parts: [글자, 크기 단계] 목록. 숫자는 setDigitText()처럼 같은 폭 칸으로 감싼다.
  function setLeveledText(element, parts) {
    const width = getDigitWidthEm(element);
    const renderKey = `${width}|${JSON.stringify(parts)}`;
    if (element.digitRenderKey === renderKey) {
      return;
    }
    element.digitRenderKey = renderKey;

    element.textContent = "";
    parts.forEach(([text, level]) => {
      const span = document.createElement("span");
      span.className = `level-${level}`;
      text.match(/\d|\D+/g).forEach((run) => {
        if (width && /\d/.test(run)) {
          const digit = document.createElement("span");
          digit.className = "digit";
          digit.style.width = `${width}em`;
          digit.textContent = run;
          span.append(digit);
        } else {
          appendWithSlash(span, run);
        }
      });
      element.append(span);
    });
  }

  function refreshDigitText() {
    digitWidthCache.clear();
    elements.statusMessage.statusRenderKey = undefined;
    setDigitText(elements.appTitle, elements.appTitle.textContent);
    renderStartOptions();
    if (isExamScreenVisible()) {
      setLeveledText(elements.selectionLabel, getSelectionParts());
      state.renderedHighlight = undefined;
      updateExamScreen();
    }
  }

  // 선택 정보: 날짜 숫자와 '/'는 0단계, 요일(괄호 포함)과 '학년'은 1단계 (setLeveledText() 참고)
  function getSelectionParts() {
    const [, month, day] = state.selectedDay.split("-").map(Number);
    const weekday = getShortDayLabel(state.selectedDay).replace(/^[^(]*/, "");
    const grade = GRADES[state.selectedGrade];
    return [
      [`${month}/${day}`, 0],
      [weekday, 1],
      ["   ", 1],
      [grade.replace(/\D+$/, ""), 0],
      [grade.replace(/^\d+/, ""), 1],
    ];
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
    setLeveledText(elements.selectionLabel, getSelectionParts());

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
      elements.topBar.style.zoom = "";
      fitTopText();
      fitSideText();
      // 시간표는 한 줄이므로 폭을 넘으면 그것만 줄인다.
      fitScheduleText();
      fitWidth(elements.schedulePanel);
      drawScheduleShape();
      // 오늘 시험이 끝나 남은 시간이 없으면 가운데 문구가 그 자리를 채운다.
      fitCenter(elements.examScreen.classList.contains("no-time") ? elements.statusMessage : elements.remainingTime);
      // 좌우 열만으로도 폭을 넘는 아주 좁은 화면에서만 위쪽 줄 전체를 줄인다.
      fitWidth(elements.topBar);
    }
  }

  // 위쪽 좌우 아래 줄(현재 시각, 날짜·학년)은 숫자 크기를 같게 두고,
  // 더 긴 줄이 버튼 폭을 넘지 않는 선에서 가장 크게 한다. 두 버튼은 style.css에서 같은 폭으로 고정되어 있다.
  function fitTopText() {
    const lines = [elements.currentTime, elements.selectionLabel];
    lines.forEach((line) => {
      line.style.fontSize = "";
    });
    fitLinesToButton(lines, lines);
  }

  // 남은 시간 양옆 문구의 '보통' 크기: 이 글자가 버튼 폭에 딱 맞는 크기(안내 문구를 세 줄로 나누기 전 가장 긴 줄).
  const NORMAL_SIZE_REFERENCE = "차이가 날 수 있습니다";

  // 두 문구 모두 '보통' 크기를 기준으로 하고 폭은 버튼 폭이다. 오른쪽 안내 문구는 '보통' 그대로,
  // 왼쪽 가운데 문구는 '보통'의 --status-scale배(style.css)이고, 그 안에서 큰 줄은 다시 --side-big배다.
  // 그래도 버튼 폭을 넘는 줄이 있으면 가운데 문구만 그 줄이 버튼 폭에 맞도록 조금 줄인다.
  // 남은 시간이 없는 화면에서는 가운데 문구가 가운데로 옮겨 가므로(fitCenter) 여기서 맞추지 않는다.
  function fitSideText() {
    const status = elements.statusMessage;
    const notice = elements.timeNotice;
    [status, notice].forEach((text) => {
      text.style.fontSize = "";
      text.style.width = "";
    });
    if (!elements.backButton.offsetWidth || elements.examScreen.classList.contains("no-time")) {
      return;
    }

    const limit = elements.backButton.getBoundingClientRect().width;
    const referenceEm = getTextWidthEm(notice, NORMAL_SIZE_REFERENCE);
    if (!referenceEm) {
      return;
    }
    const normal = Math.floor((limit / referenceEm) * 100 - 1) / 100;
    notice.style.fontSize = `${normal}px`;
    notice.style.width = `${limit}px`;

    const scale = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue("--status-scale")) || 1;
    status.style.fontSize = `${normal * scale}px`;
    const widest = Math.max(...Array.from(status.children, (line) => line.getBoundingClientRect().width));
    if (widest > limit) {
      status.style.fontSize = `${Math.floor(normal * scale * (limit / widest) * 100 - 1) / 100}px`;
    }
    status.style.width = `${limit}px`;
  }

  // element의 글꼴로 text를 썼을 때 폭(em 단위)
  function getTextWidthEm(element, text) {
    const style = window.getComputedStyle(element);
    const context = document.createElement("canvas").getContext?.("2d");
    if (!context || !style.fontFamily) {
      return 0;
    }
    context.font = `${style.fontWeight} 100px ${style.fontFamily}`;
    return context.measureText(text).width / 100;
  }

  // targets의 글자 크기를 함께 바꿔, lines 중 가장 긴 줄이 버튼 폭에 딱 맞게 한다. 맞춘 버튼 폭을 돌려준다.
  function fitLinesToButton(targets, lines) {
    if (!elements.backButton.offsetWidth) {
      return 0;
    }
    const limit = elements.backButton.getBoundingClientRect().width;

    let fontSize = parseFloat(window.getComputedStyle(targets[0]).fontSize);
    // 픽셀 반올림 때문에 한 번에 딱 맞지 않을 수 있어 몇 번 더 맞춘다.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const widest = Math.max(...lines.map((line) => line.getBoundingClientRect().width));
      if (!widest || (attempt > 0 && widest <= limit)) {
        break;
      }
      fontSize = Math.floor(fontSize * (limit / widest) * 100 - 1) / 100;
      targets.forEach((target) => {
        target.style.fontSize = `${fontSize}px`;
      });
    }
    return limit;
  }

  // 시간표 글자 크기는 style.css가 박스 높이에 맞춰 정한다. 다만 가장 긴 '교시   과목'이
  // 가장 좁은 강조 상자(가운데 칸) 안에 여백을 두고 들어가지 않으면, 세 칸 모두 같은 비율로 줄인다.
  function fitScheduleText() {
    const panel = elements.schedulePanel;
    const items = Array.from(elements.scheduleList.children);
    items.forEach((item) => {
      item.style.fontSize = "";
    });
    if (!panel.clientWidth || !items.length) {
      return;
    }

    const style = window.getComputedStyle(panel);
    const half = panel.clientHeight
      * (parseFloat(style.getPropertyValue("--notch-depth")) || 0)
      * (parseFloat(style.getPropertyValue("--notch-width")) || 0);
    const available = panel.clientWidth / 3 - 2 * half - 2 * SCHEDULE_BOX_INSET - 2 * SCHEDULE_TEXT_GAP;

    const fontSize = parseFloat(window.getComputedStyle(items[0]).fontSize);
    // 과목명 줄은 칸 폭을 다 차지하므로, 줄 상자가 아니라 글자들이 실제로 차지하는 폭을 잰다.
    const range = document.createRange();
    const nameEm = Math.max(...items.map((item) => {
      range.selectNodeContents(item.querySelector(".schedule-name"));
      return range.getBoundingClientRect().width / fontSize;
    }));
    const fitted = Math.floor((available / nameEm) * 100) / 100;
    if (fitted < fontSize) {
      items.forEach((item) => {
        item.style.fontSize = `${fitted}px`;
      });
    }
  }

  // 현재 교시 강조 상자가 칸(세모 폭을 뺀 네모)에서 들어가는 여백, 그 상자 안에서 글자까지 남길 최소 여백
  const SCHEDULE_BOX_INSET = 10;
  const SCHEDULE_TEXT_GAP = 8;

  // 시간표 박스 모양: 3등분 지점마다 위아래 변이 세모로 파여, 90도 눕힌 모래시계처럼 경계가 잘록해진다.
  function drawScheduleShape() {
    const panel = elements.schedulePanel;
    const width = panel.clientWidth;
    const height = panel.clientHeight;
    if (!width || !height) {
      return;
    }

    const style = window.getComputedStyle(panel);
    const depth = height * (parseFloat(style.getPropertyValue("--notch-depth")) || 0);
    const half = depth * (parseFloat(style.getPropertyValue("--notch-width")) || 0);
    const cuts = [width / 3, (width * 2) / 3];
    // 바깥쪽 칸의 글자를 강조 상자 가운데에 맞추는 데 쓴다(style.css의 .schedule-item).
    panel.style.setProperty("--notch-half", `${half}px`);
    const renderKey = `${width}|${height}|${depth}|${half}|${state.renderedHighlight}`;
    if (panel.shapeRenderKey === renderKey) {
      return;
    }
    panel.shapeRenderKey = renderKey;

    // 선이 박스 안쪽에 그려지도록 선 두께 절반만큼 안으로 들인다.
    const edge = 0.5;
    const left = edge;
    const right = width - edge;
    const top = edge;
    const bottom = height - edge;
    const radius = 8;

    const topPoints = cuts.flatMap((x) => [[x - half, top], [x, top + depth], [x + half, top]]);
    const bottomPoints = cuts.slice().reverse().flatMap((x) => [[x + half, bottom], [x, bottom - depth], [x - half, bottom]]);
    const outline = [
      `M ${left + radius} ${top}`,
      ...topPoints.map(([x, y]) => `L ${x} ${y}`),
      `L ${right - radius} ${top} Q ${right} ${top} ${right} ${top + radius}`,
      `L ${right} ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom}`,
      ...bottomPoints.map(([x, y]) => `L ${x} ${y}`),
      `L ${left + radius} ${bottom} Q ${left} ${bottom} ${left} ${bottom - radius}`,
      `L ${left} ${top + radius} Q ${left} ${top} ${left + radius} ${top} Z`,
    ].join(" ");
    elements.scheduleOutline.setAttribute("d", outline);

    const current = elements.scheduleCurrent;
    const index = state.renderedHighlight ? state.renderedHighlight - 1 : -1;
    current.setAttribute("visibility", index < 0 ? "hidden" : "visible");
    if (index < 0) {
      return;
    }

    // 현재 교시 강조: 그 칸에서 세모가 차지하는 폭을 뺀 네모(바깥쪽 칸은 박스 끝까지, 3등분 지점 쪽은 세모 폭만큼 안쪽)를
    // 기준으로, 위아래 좌우 모두 같은 여백만큼 안쪽에 둔 둥근 상자. 그래서 세모 쪽으로 튀어나가지 않는다.
    const inset = SCHEDULE_BOX_INSET;
    const cellLeft = (width * index) / 3 + (index > 0 ? half : 0);
    const cellRight = (width * (index + 1)) / 3 - (index < 2 ? half : 0);
    current.setAttribute("x", String(cellLeft + inset));
    current.setAttribute("y", String(inset));
    current.setAttribute("width", String(Math.max(0, cellRight - cellLeft - 2 * inset)));
    current.setAttribute("height", String(Math.max(0, height - 2 * inset)));
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

  // 가운데 열(남은 시간, 또는 오늘 시험이 끝난 뒤의 가운데 문구)의 크기를 정한다.
  // 기준 크기: 좌우 여백 10%(--safe-side) 기준 폭에서 좌우 열을 뺀 폭과, 시간표를 뺀 남는 높이를 채우는 크기.
  // 좌우 열은 같은 폭(넓은 쪽 기준)으로 잡아 가운데 열이 화면 정가운데에 오게 한다.
  // 남은 시간은 여기서 더 키운다: 기준 크기일 때의 아래 끝 위치는 그대로 두고,
  // 실제 좌우 열 사이(양쪽에 REMAINING_TIME_SIDE_GAP만 남김)를 채우도록 위쪽과 좌우로만 커진다.
  const REMAINING_TIME_SIDE_GAP = 48;

  function fitCenter(center) {
    center.style.fontSize = "";
    center.style.alignSelf = "";
    center.style.marginBottom = "";
    if (!center.offsetHeight) {
      return;
    }

    const fontSize = parseFloat(window.getComputedStyle(center).fontSize);
    // 문단 폭이 아니라 글자들이 실제로 차지하는 폭을 잰다.
    const range = document.createRange();
    range.selectNodeContents(center);
    const textWidth = range.getBoundingClientRect().width;
    const heightPerFont = center.offsetHeight / fontSize;

    const box = getContentBox(elements.examScreen);
    const topStyle = window.getComputedStyle(elements.topBar);
    const sideWidth = Math.max(
      ...Array.from(elements.topBar.children)
        .filter((child) => child !== center)
        .map((child) => child.getBoundingClientRect().width),
    );
    const middleWidth = box.width - 2 * sideWidth - 2 * parseFloat(topStyle.columnGap);

    // 아래쪽 시간표와 그 위 간격
    const gap = parseFloat(window.getComputedStyle(elements.examScreen).rowGap) || 0;
    const belowHeight = elements.schedulePanel.getBoundingClientRect().height + gap;

    const byWidth = middleWidth / (textWidth / fontSize);
    const areaHeight = box.height - belowHeight;
    const byHeight = areaHeight / heightPerFont;
    const fitted = Math.floor(Math.min(byWidth, byHeight) * 0.98);
    if (fitted <= 0) {
      return;
    }
    if (center !== elements.remainingTime) {
      center.style.fontSize = `${fitted}px`;
      return;
    }

    // 기준 크기로 세로 가운데에 놓였을 때의 아래 여백을 그대로 두고 아래 끝에 붙인다.
    const bottomSpace = (areaHeight - fitted * heightPerFont) / 2;
    const wideWidth = elements.topBar.clientWidth - 2 * sideWidth - 2 * REMAINING_TIME_SIDE_GAP;
    const grown = Math.floor(Math.min(
      wideWidth / (textWidth / fontSize),
      (areaHeight - bottomSpace) / heightPerFont,
    ));
    center.style.fontSize = `${Math.max(fitted, grown)}px`;
    center.style.alignSelf = "end";
    center.style.marginBottom = `${bottomSpace}px`;
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
      setDigitText(name, `${period.period}교시   ${displaySubject(subjects[period.period - 1])}`);
      setDigitText(time, `${period.examStart}~${period.examEnd}`);
    });
  }

  function updateExamScreen() {
    const nowSeconds = getNowSeconds();
    const subjects = getSelectedSubjects();
    const segment = getCurrentSegment(nowSeconds, subjects);

    setLeveledText(elements.currentTime, getClockParts(nowSeconds));
    renderStatusMessage(segment);

    const hasTime = segment.remainingSeconds !== null;
    elements.examScreen.classList.toggle("no-time", !hasTime);
    setDigitText(elements.remainingTime, hasTime ? secondsToMinutesSeconds(segment.remainingSeconds) : "");
    elements.remainingTime.classList.toggle("test", isTestMode());
    elements.remainingTime.classList.toggle("danger", segment.isDanger);

    renderSchedule(segment.highlightPeriod);
    fitScreens();
  }

  // 가운데 문구. 한 줄씩 나누고, 과목명 같은 줄은 '조금 더 큰' 크기로 표시한다.
  function renderStatusMessage(segment) {
    const element = elements.statusMessage;
    const renderKey = JSON.stringify(segment.lines);
    if (element.statusRenderKey === renderKey) {
      return;
    }
    element.statusRenderKey = renderKey;

    element.textContent = "";
    segment.lines.forEach(([text, big]) => {
      const line = document.createElement("span");
      line.className = big ? "side-line side-big" : "side-line";
      element.append(line);
      setDigitText(line, text);
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
