import { useCallback, useEffect, useState } from "react";
import { DateTime } from "luxon";
import { api } from "./api/client";
import type { Configuration, History } from "./api/types";
import { useStatus } from "./hooks/useStatus";
import { Dashboard } from "./components/Dashboard";
import { ScheduleEditor } from "./components/ScheduleEditor";
import { ManualRunControls } from "./components/ManualRunControls";
import { OverrideControls } from "./components/OverrideControls";

type Tab = "dashboard" | "schedule" | "controls";

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
      </main>
    </div>
  );
}
