import { useCallback, useEffect, useState } from "react";
import { DateTime } from "luxon";
import { api } from "./api/client";
import type { Configuration, History } from "./api/types";
import { useStatus } from "./hooks/useStatus";
import { Dashboard } from "./components/Dashboard";
import { ScheduleEditor } from "./components/ScheduleEditor";
import { SettingsEditor } from "./components/SettingsEditor";
import { ManualRunControls } from "./components/ManualRunControls";
import { OverrideControls } from "./components/OverrideControls";

type Tab = "dashboard" | "schedule" | "controls" | "settings";

/**
 * The word-labelled tabs for day-to-day use. Settings is intentionally excluded:
 * it is a rarely-visited setup area rendered as a compact gear icon so the tab bar
 * stays uncrowded on a phone.
 */
const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "schedule", label: "Schedule" },
  { id: "controls", label: "Controls" },
];

/**
 * Root of the phone-first SPA. A tab bar switches between the live Dashboard, the
 * schedule/program editor, and the manual-run + skip/pause controls. Status is
 * polled continuously; configuration and history are loaded on demand and after
 * changes.
 */
export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const { status, error, loading, clockOffset, refresh } = useStatus();
  const [configuration, setConfiguration] = useState<Configuration>();
  const [history, setHistory] = useState<History>();

  const loadHistory = useCallback(async () => {
    setHistory(await api.getHistory());
  }, []);

  // Load configuration and history once on mount. The fetches are asynchronous, so
  // state is only set after the awaited responses resolve (and skipped if the
  // component unmounted first) — this is the data-fetching use effects are for,
  // not a synchronous state resync.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [nextConfig, nextHistory] = await Promise.all([
        api.getConfiguration(),
        api.getHistory(),
      ]);
      if (!cancelled) {
        setConfiguration(nextConfig);
        setHistory(nextHistory);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep history reasonably fresh while the dashboard is visible.
  useEffect(() => {
    if (tab !== "dashboard") {
      return;
    }
    const handle = setInterval(() => void loadHistory(), 15000);
    return () => clearInterval(handle);
  }, [tab, loadHistory]);

  const handleSaveConfiguration = useCallback(
    async (next: Configuration) => {
      const saved = await api.putConfiguration(next);
      setConfiguration(saved);
      refresh();
    },
    [refresh],
  );

  const handleControlsChanged = useCallback(() => {
    refresh();
  }, [refresh]);

  const circuits = configuration?.circuits ?? [];
  // The schedule's canonical zone drives all time display. Before the config
  // loads, fall back to the browser's own zone so early renders are still sensible.
  const timezone =
    configuration?.timezone ?? DateTime.local().zoneName ?? "UTC";

  return (
    <div className="app">
      <header className="app-header">
        <h1>Irrigatalizer</h1>
      </header>

      <nav className="tab-bar" aria-label="Sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "tab active" : "tab"}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={tab === "settings" ? "tab tab-icon active" : "tab tab-icon"}
          aria-current={tab === "settings" ? "page" : undefined}
          aria-label="Settings"
          title="Settings"
          onClick={() => setTab("settings")}
        >
          <GearIcon />
        </button>
      </nav>

      <main className="app-main">
        {tab === "dashboard" ? (
          <Dashboard
            status={status}
            history={history}
            circuits={circuits}
            timezone={timezone}
            clockOffset={clockOffset}
            error={error}
            loading={loading}
          />
        ) : null}

        {tab === "schedule" ? (
          configuration ? (
            <ScheduleEditor
              configuration={configuration}
              onSave={handleSaveConfiguration}
            />
          ) : (
            <p className="empty">Loading configuration…</p>
          )
        ) : null}

        {tab === "controls" ? (
          <div className="controls">
            <ManualRunControls
              circuits={circuits}
              activeManualRun={status?.manualRun ?? null}
              clockOffset={clockOffset}
              onChanged={handleControlsChanged}
            />
            <OverrideControls
              override={status?.override ?? null}
              timezone={timezone}
              onChanged={handleControlsChanged}
            />
          </div>
        ) : null}

        {tab === "settings" ? (
          configuration ? (
            <SettingsEditor
              configuration={configuration}
              onSave={handleSaveConfiguration}
            />
          ) : (
            <p className="empty">Loading configuration…</p>
          )
        ) : null}
      </main>
    </div>
  );
}

/** A minimal gear glyph for the compact Settings tab. */
function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
