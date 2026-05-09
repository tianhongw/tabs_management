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
  groupTemplate: document.querySelector("#groupTemplate"),
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
  const domainCount = countDomains(state.tabs);

  if (windowCount <= 1) {
    state.showCurrentWindowOnly = false;
  }

  const visibleTabs = getVisibleTabs();
  const duplicateCount = getDuplicateGroups(state.tabs).reduce((sum, group) => sum + group.length - 1, 0);

  elements.summary.textContent = `${formatCount(state.tabs.length, "tab")} / ${formatCount(windowCount, "window")} / ${formatCount(domainCount, "domain")}`;
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

  const groups = groupByDomain(visibleTabs);

  groups.forEach(group => {
    const groupNode = elements.groupTemplate.content.firstElementChild.cloneNode(true);
    const heading = groupNode.querySelector("h2");
    const count = groupNode.querySelector("span");
    const closeGroupButton = groupNode.querySelector(".group-close-button");
    const list = groupNode.querySelector(".tab-list");

    heading.textContent = group.heading;
    count.textContent = getGroupCountLabel(group.tabs);
    closeGroupButton.title = `Close ${getGroupCountLabel(group.tabs)} from ${group.heading}`;
    closeGroupButton.addEventListener("click", () => closeTabGroup(group));

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

async function closeTabGroup(group) {
  const tabsToClose = [...group.tabs];

  if (!tabsToClose.length) {
    render();
    return;
  }

  try {
    await chrome.tabs.remove(tabsToClose.map(tab => tab.id));
    const removedIds = new Set(tabsToClose.map(tab => tab.id));
    state.tabs = state.tabs.filter(tab => !removedIds.has(tab.id));
    setStatus(`Closed ${formatCount(tabsToClose.length, "tab")} from ${group.heading}.`);
    render();
  } catch (error) {
    await loadTabs();
    setStatus(`Could not close ${group.heading}: ${error.message}`, true);
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

function groupByDomain(tabs) {
  const groups = new Map();

  tabs.forEach(tab => {
    const domain = getDomainInfo(tab.url);

    if (!groups.has(domain.key)) {
      groups.set(domain.key, {
        key: domain.key,
        heading: domain.label,
        sortLabel: domain.sortLabel,
        tabs: []
      });
    }

    groups.get(domain.key).tabs.push(tab);
  });

  return [...groups.values()]
    .map(group => ({
      ...group,
      tabs: group.tabs.sort(compareTabs)
    }))
    .sort((a, b) => a.sortLabel.localeCompare(b.sortLabel) || a.key.localeCompare(b.key));
}

function getGroupCountLabel(tabs) {
  const tabCount = formatCount(tabs.length, "tab");
  const windowCount = countWindows(tabs);
  return windowCount > 1 ? `${tabCount} / ${formatCount(windowCount, "window")}` : tabCount;
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

function countDomains(tabs) {
  return new Set(tabs.map(tab => getDomainInfo(tab.url).key)).size;
}

function getDomainInfo(url) {
  if (!url) {
    return createDomainInfo("none", "No domain", "zzzz no domain");
  }

  if (isChromeNewTabUrl(url)) {
    return createDomainInfo("chrome:newtab", "chrome://newtab", "chrome://newtab");
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol === "blob:") {
      return getDomainInfo(parsed.pathname);
    }

    if (parsed.protocol === "chrome-extension:") {
      return createDomainInfo("chrome-extension", "Extension pages", "zz chrome extension");
    }

    if (parsed.protocol === "chrome:") {
      const page = parsed.hostname || parsed.pathname.replace(/^\/+/, "");
      const label = page ? `chrome://${page}` : "Chrome pages";
      return createDomainInfo(`chrome:${page || "pages"}`, label, label);
    }

    if (parsed.protocol === "file:") {
      return createDomainInfo("file", "Local files", "zz local files");
    }

    if (parsed.hostname) {
      const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
      return createDomainInfo(`host:${hostname}`, hostname, hostname);
    }

    if (parsed.protocol === "about:") {
      const label = parsed.pathname ? `about:${parsed.pathname}` : "About pages";
      return createDomainInfo(`about:${parsed.pathname || "pages"}`, label, label);
    }

    if (parsed.protocol === "data:") {
      return createDomainInfo("data", "Data URL pages", "zz data urls");
    }

    const protocol = parsed.protocol.replace(/:$/, "");
    const label = protocol ? `${protocol} pages` : "No domain";
    return createDomainInfo(`protocol:${protocol || "none"}`, label, `zz ${label}`);
  } catch {
    return createDomainInfo("other", "Other pages", "zz other pages");
  }
}

function createDomainInfo(key, label, sortLabel) {
  return { key, label, sortLabel };
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
