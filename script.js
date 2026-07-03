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
    testInput: "",
    testBaseSeconds: null,
    testStartedAt: null,
    timerId: null,
  };

  const elements = {
    startScreen: document.getElementById("start-screen"),
    examScreen: document.getElementById("exam-screen"),
    dateOptions: document.getElementById("date-options"),
    gradeOptions: document.getElementById("grade-options"),
    testTime: document.getElementById("test-time"),
    startButton: document.getElementById("start-button"),
    startError: document.getElementById("start-error"),
    backButton: document.getElementById("back-button"),
    fullscreenButton: document.getElementById("fullscreen-button"),
    currentTime: document.getElementById("current-time"),
    selectionLabel: document.getElementById("selection-label"),
    testBadge: document.getElementById("test-badge"),
    statusMessage: document.getElementById("status-message"),
    remainingTime: document.getElementById("remaining-time"),
    scheduleList: document.getElementById("schedule-list"),
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
    const seconds = normalized % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
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

    const match = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
    if (!match) {
      return { valid: false, seconds: null };
    }

    return {
      valid: true,
      seconds: timeToSeconds(`${match[1]}:${match[2]}:${match[3] || "00"}`),
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
          message: `${displaySubject(subject)} 준비 시간`,
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
          message: autonomous ? "자율학습" : `${subject} 시험 중`,
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
            ? "다음 시간\n자율학습"
            : `다음 과목\n${nextSubject}`,
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

  function renderStartOptions() {
    elements.dateOptions.innerHTML = "";
    Object.entries(EXAM_DAYS).forEach(([dayKey, day]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.textContent = day.label;
      button.setAttribute("aria-pressed", String(state.selectedDay === dayKey));
      button.addEventListener("click", () => {
        state.selectedDay = dayKey;
        renderStartOptions();
      });
      elements.dateOptions.appendChild(button);
    });

    elements.gradeOptions.innerHTML = "";
    Object.entries(GRADES).forEach(([gradeKey, gradeLabel]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.textContent = gradeLabel;
      button.setAttribute("aria-pressed", String(state.selectedGrade === gradeKey));
      button.addEventListener("click", () => {
        state.selectedGrade = gradeKey;
        renderStartOptions();
      });
      elements.gradeOptions.appendChild(button);
    });
  }

  function startExam() {
    elements.startError.textContent = "";

    if (!state.selectedDay || !state.selectedGrade) {
      elements.startError.textContent = "날짜와 학년을 모두 선택해 주세요.";
      return;
    }

    const testResult = parseTestTime(elements.testTime.value);
    if (!testResult.valid) {
      elements.startError.textContent = "테스트 시간은 09:40 또는 09:40:30 형식으로 입력해 주세요.";
      return;
    }

    state.testInput = elements.testTime.value.trim();
    state.testBaseSeconds = testResult.seconds;
    state.testStartedAt = Date.now();

    elements.startScreen.classList.add("hidden");
    elements.examScreen.classList.remove("hidden");
    elements.testBadge.classList.toggle("hidden", state.testBaseSeconds === null);
    elements.selectionLabel.textContent = `${EXAM_DAYS[state.selectedDay].label} · ${GRADES[state.selectedGrade]}`;

    renderSchedule();
    updateExamScreen();
    restartTimer();
  }

  function returnToStart() {
    stopTimer();
    elements.examScreen.classList.add("hidden");
    elements.startScreen.classList.remove("hidden");
    elements.testTime.value = state.testInput;
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

  function isFullscreenSupported() {
    return Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
  }

  function isFullscreenActive() {
    return Boolean(document.fullscreenElement);
  }

  function updateFullscreenButton() {
    if (!elements.fullscreenButton) {
      return;
    }

    elements.fullscreenButton.textContent = isFullscreenActive() ? "전체화면 해제" : "전체화면";
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
      console.info("전체화면 전환에 실패했습니다.", error);
    } finally {
      updateFullscreenButton();
    }
  }

  function renderSchedule(highlightPeriod) {
    const subjects = getSelectedSubjects();
    elements.scheduleList.innerHTML = "";

    PERIODS.forEach((period) => {
      const subject = subjects[period.period - 1];
      const item = document.createElement("li");
      const isHighlighted = period.period === highlightPeriod;
      item.className = `schedule-item${isHighlighted ? " current" : ""}`;

      const name = document.createElement("span");
      name.className = "schedule-name";
      name.textContent = `${isHighlighted ? "▶ " : ""}${period.period}교시 ${subject}`;

      const time = document.createElement("span");
      time.className = "schedule-time";
      time.textContent = `${period.examStart}~${period.examEnd}`;

      item.append(name, time);
      elements.scheduleList.appendChild(item);
    });
  }

  function updateExamScreen() {
    const nowSeconds = getNowSeconds();
    const subjects = getSelectedSubjects();
    const segment = getCurrentSegment(nowSeconds, subjects);

    elements.currentTime.textContent = secondsToClock(nowSeconds);
    elements.statusMessage.textContent = segment.message;

    if (segment.remainingSeconds === null) {
      elements.remainingTime.textContent = "00:00";
      elements.remainingTime.classList.add("no-time");
    } else {
      elements.remainingTime.textContent = secondsToMinutesSeconds(segment.remainingSeconds);
      elements.remainingTime.classList.remove("no-time");
    }

    elements.remainingTime.classList.toggle("danger", segment.isDanger);
    renderSchedule(segment.highlightPeriod);
  }

  function applyUrlTestParameter() {
    const params = new URLSearchParams(window.location.search);
    const testTime = params.get("test");
    if (testTime) {
      elements.testTime.value = testTime;
    }
  }

  function init() {
    renderStartOptions();
    applyUrlTestParameter();
    elements.startButton.addEventListener("click", startExam);
    elements.backButton.addEventListener("click", returnToStart);

    if (isFullscreenSupported()) {
      elements.fullscreenButton.addEventListener("click", toggleFullscreen);
      document.addEventListener("fullscreenchange", updateFullscreenButton);
      updateFullscreenButton();
    } else {
      console.info("이 브라우저는 Fullscreen API를 지원하지 않습니다.");
      elements.fullscreenButton.hidden = true;
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
