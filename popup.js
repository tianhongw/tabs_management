const state = {
  tabs: [],
  currentWindowId: null,
  showCurrentWindowOnly: false,
  query: ""
};

const elements = {
  summary: document.querySelector("#summary"),
  status: document.querySelector("#status"),
  tabsRoot: document.querySelector("#tabsRoot"),
  searchInput: document.querySelector("#searchInput"),
  refreshButton: document.querySelector("#refreshButton"),
  currentWindowButton: document.querySelector("#currentWindowButton"),
  duplicatesButton: document.querySelector("#duplicatesButton"),
  closeAllButton: document.querySelector("#closeAllButton"),
  windowTemplate: document.querySelector("#windowTemplate"),
  tabTemplate: document.querySelector("#tabTemplate")
};

document.addEventListener("DOMContentLoaded", () => {
  elements.searchInput.focus();
  bindEvents();
  loadTabs();
});

function bindEvents() {
  elements.searchInput.addEventListener("input", event => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });

  elements.searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const [firstMatch] = getVisibleTabs();

      if (firstMatch) {
        focusTab(firstMatch);
      }
    }

    if (event.key === "Escape" && elements.searchInput.value) {
      elements.searchInput.value = "";
      state.query = "";
      render();
    }
  });

  elements.refreshButton.addEventListener("click", loadTabs);

  elements.currentWindowButton.addEventListener("click", () => {
    if (countWindows(state.tabs) <= 1) {
      state.showCurrentWindowOnly = false;
      render();
      return;
    }

    state.showCurrentWindowOnly = !state.showCurrentWindowOnly;
    render();
  });

  elements.duplicatesButton.addEventListener("click", closeDuplicateTabs);
  elements.closeAllButton.addEventListener("click", closeAllTabs);
}

async function loadTabs() {
  setStatus("Loading tabs...");

  try {
    const [currentWindow, tabs] = await Promise.all([
      chrome.windows.getCurrent(),
      chrome.tabs.query({})
    ]);

    state.currentWindowId = currentWindow.id;
    state.tabs = tabs.sort(compareTabs);
    clearStatus();
    render();
  } catch (error) {
    setStatus(`Could not read tabs: ${error.message}`, true);
  }
}

function render() {
  const windowCount = countWindows(state.tabs);

  if (windowCount <= 1) {
    state.showCurrentWindowOnly = false;
  }

  const visibleTabs = getVisibleTabs();
  const duplicateCount = getDuplicateGroups(state.tabs).reduce((sum, group) => sum + group.length - 1, 0);

  elements.summary.textContent = `${formatCount(state.tabs.length, "tab")} / ${formatCount(windowCount, "window")}`;
  updateCurrentWindowButton(windowCount);
  elements.duplicatesButton.disabled = duplicateCount === 0;
  elements.duplicatesButton.textContent = duplicateCount ? `Duplicates ${duplicateCount}` : "No duplicates";
  elements.closeAllButton.disabled = state.tabs.length === 0;
  elements.closeAllButton.textContent = state.tabs.length ? `Close all ${state.tabs.length}` : "Close all";
  elements.closeAllButton.title = state.tabs.length
    ? "Close all open tabs across all Chrome windows"
    : "No tabs to close";

  elements.tabsRoot.replaceChildren();

  if (!visibleTabs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.query ? "No matching tabs." : "No open tabs found.";
    elements.tabsRoot.append(empty);
    return;
  }

  const groups = groupByWindow(visibleTabs);

  groups.forEach(group => {
    const groupNode = elements.windowTemplate.content.firstElementChild.cloneNode(true);
    const heading = groupNode.querySelector("h2");
    const count = groupNode.querySelector("span");
    const list = groupNode.querySelector(".tab-list");

    heading.textContent = group.windowId === state.currentWindowId ? "Current window" : `Window ${group.windowNumber}`;
    count.textContent = formatCount(group.tabs.length, "tab");

    group.tabs.forEach(tab => {
      list.append(createTabRow(tab));
    });

    elements.tabsRoot.append(groupNode);
  });
}

function updateCurrentWindowButton(windowCount) {
  const canFilterByWindow = windowCount > 1;

  elements.currentWindowButton.disabled = !canFilterByWindow;
  elements.currentWindowButton.setAttribute("aria-pressed", String(canFilterByWindow && state.showCurrentWindowOnly));
  elements.currentWindowButton.textContent = canFilterByWindow
    ? state.showCurrentWindowOnly ? "All windows" : "Current window"
    : "1 window";
  elements.currentWindowButton.title = canFilterByWindow
    ? "Toggle between the current window and all windows"
    : "Only one Chrome window is open";
}

function createTabRow(tab) {
  const row = elements.tabTemplate.content.firstElementChild.cloneNode(true);
  const mainButton = row.querySelector(".tab-main");
  const faviconWrap = row.querySelector(".favicon-wrap");
  const favicon = row.querySelector(".favicon");
  const fallback = row.querySelector(".favicon-fallback");
  const title = row.querySelector(".tab-title");
  const url = row.querySelector(".tab-url");
  const pinButton = row.querySelector(".pin-button");
  const muteButton = row.querySelector(".mute-button");
  const closeButton = row.querySelector(".close-button");

  row.classList.toggle("is-active", tab.active);
  title.textContent = tab.title || "Untitled tab";
  url.textContent = getReadableUrl(tab.url);
  fallback.textContent = getFallbackLetter(tab);

  if (tab.favIconUrl) {
    favicon.src = tab.favIconUrl;
    favicon.addEventListener("error", () => faviconWrap.classList.add("is-empty"), { once: true });
  } else {
    faviconWrap.classList.add("is-empty");
  }

  mainButton.title = `Go to ${tab.title || tab.url || "tab"}`;
  mainButton.addEventListener("click", event => {
    event.stopPropagation();
    focusTab(tab);
  });

  row.addEventListener("click", () => focusTab(tab));

  pinButton.textContent = tab.pinned ? "Unpin" : "Pin";
  pinButton.classList.toggle("is-on", tab.pinned);
  pinButton.addEventListener("click", event => {
    event.stopPropagation();
    togglePinned(tab);
  });

  const isMuted = Boolean(tab.mutedInfo?.muted);
  muteButton.textContent = isMuted ? "Unmute" : "Mute";
  muteButton.classList.toggle("is-on", isMuted);
  muteButton.addEventListener("click", event => {
    event.stopPropagation();
    toggleMuted(tab);
  });

  closeButton.addEventListener("click", event => {
    event.stopPropagation();
    closeTab(tab);
  });

  return row;
}

async function focusTab(tab) {
  try {
    setStatus("Opening tab...");
    const updatedTab = await chrome.tabs.update(tab.id, { active: true });

    try {
      await chrome.windows.update(updatedTab.windowId ?? tab.windowId, { focused: true });
    } catch {
      // Activating the tab is the main action; window focus can fail in some Chrome contexts.
    }

    window.close();
  } catch (error) {
    setStatus(`Could not focus tab: ${error.message}`, true);
  }
}

async function closeTab(tab) {
  try {
    await chrome.tabs.remove(tab.id);
    state.tabs = state.tabs.filter(item => item.id !== tab.id);
    render();
  } catch (error) {
    setStatus(`Could not close tab: ${error.message}`, true);
  }
}

async function togglePinned(tab) {
  try {
    const updated = await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
    replaceTab(updated);
    render();
  } catch (error) {
    setStatus(`Could not update pin state: ${error.message}`, true);
  }
}

async function toggleMuted(tab) {
  try {
    const updated = await chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted });
    replaceTab(updated);
    render();
  } catch (error) {
    setStatus(`Could not update sound state: ${error.message}`, true);
  }
}

async function closeDuplicateTabs() {
  const groups = getDuplicateGroups(state.tabs);
  const tabsToClose = groups.flatMap(group => {
    const keeper = getDuplicateKeeper(group);
    return group.filter(tab => tab.id !== keeper.id);
  });

  if (!tabsToClose.length) {
    render();
    return;
  }

  try {
    await chrome.tabs.remove(tabsToClose.map(tab => tab.id));
    const removedIds = new Set(tabsToClose.map(tab => tab.id));
    state.tabs = state.tabs.filter(tab => !removedIds.has(tab.id));
    setStatus(`Closed ${formatCount(tabsToClose.length, "duplicate tab")}.`);
    render();
  } catch (error) {
    setStatus(`Could not close duplicates: ${error.message}`, true);
  }
}

async function closeAllTabs() {
  const tabsToClose = [...state.tabs];

  if (!tabsToClose.length) {
    render();
    return;
  }

  try {
    await chrome.tabs.remove(tabsToClose.map(tab => tab.id));
    state.tabs = [];
    setStatus(`Closed ${formatCount(tabsToClose.length, "tab")}.`);
    render();
  } catch (error) {
    await loadTabs();
    setStatus(`Could not close all tabs: ${error.message}`, true);
  }
}

function getVisibleTabs() {
  return state.tabs.filter(tab => {
    if (state.showCurrentWindowOnly && tab.windowId !== state.currentWindowId) {
      return false;
    }

    if (!state.query) {
      return true;
    }

    const haystack = `${tab.title || ""} ${tab.url || ""}`.toLowerCase();
    return haystack.includes(state.query);
  });
}

function groupByWindow(tabs) {
  const windowIds = [...new Set(state.tabs.map(tab => tab.windowId))];
  const groups = new Map();

  tabs.forEach(tab => {
    if (!groups.has(tab.windowId)) {
      groups.set(tab.windowId, []);
    }

    groups.get(tab.windowId).push(tab);
  });

  return [...groups.entries()].map(([windowId, groupTabs]) => ({
    windowId,
    windowNumber: windowIds.indexOf(windowId) + 1,
    tabs: groupTabs.sort(compareTabs)
  }));
}

function getDuplicateGroups(tabs) {
  const byUrl = new Map();

  tabs.forEach(tab => {
    const key = normalizeUrl(tab.url);

    if (!key) {
      return;
    }

    if (!byUrl.has(key)) {
      byUrl.set(key, []);
    }

    byUrl.get(key).push(tab);
  });

  return [...byUrl.values()].filter(group => group.length > 1);
}

function getDuplicateKeeper(group) {
  return [...group].sort((a, b) => getKeepScore(b) - getKeepScore(a) || compareTabs(a, b))[0];
}

function getKeepScore(tab) {
  return Number(tab.active) * 4 + Number(tab.pinned) * 2 + Number(tab.windowId === state.currentWindowId);
}

function replaceTab(updated) {
  state.tabs = state.tabs.map(tab => tab.id === updated.id ? updated : tab).sort(compareTabs);
}

function compareTabs(a, b) {
  return a.windowId - b.windowId || Number(b.pinned) - Number(a.pinned) || a.index - b.index;
}

function countWindows(tabs) {
  return new Set(tabs.map(tab => tab.windowId)).size;
}

function normalizeUrl(url) {
  if (!url || url.startsWith("chrome-extension://")) {
    return "";
  }

  if (isChromeNewTabUrl(url)) {
    return "chrome://newtab/";
  }

  if (url.startsWith("chrome://")) {
    return "";
  }

  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function isChromeNewTabUrl(url) {
  return url === "chrome://newtab/" || url === "chrome://new-tab-page/";
}

function getReadableUrl(url) {
  if (!url) {
    return "No URL";
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") + parsed.pathname;
  } catch {
    return url;
  }
}

function getFallbackLetter(tab) {
  const source = tab.title || getReadableUrl(tab.url) || "?";
  return source.trim().charAt(0).toUpperCase() || "?";
}

function setStatus(message, isError = false) {
  elements.status.hidden = false;
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
}

function clearStatus() {
  elements.status.hidden = true;
  elements.status.textContent = "";
  elements.status.classList.remove("is-error");
}

function formatCount(count, singular) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
