import React, { useMemo, useState } from "react";

type Mode = "couples" | "roundRobin";

type Round = {
  gameNumber: number;
  courts: { courtNumber: number; group: string[] }[];
  byes: string[];
};

function clampInt(value: string, opts: { min?: number; max?: number } = {}): string {
  const { min = 0, max = Number.MAX_SAFE_INTEGER } = opts;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return "";
  const clamped = Math.max(min, Math.min(max, n));
  return String(clamped);
}

function shuffle<T>(array: T[]): T[] {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function chunk<T>(array: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function buildParticipants(mode: Mode, count: number): string[] {
  if (count <= 0) return [];
  const label = mode === "couples" ? "Couple" : "Player";
  return Array.from({ length: count }, (_, i) => `${label} ${i + 1}`);
}

function generateSchedule(args: {
  mode: Mode;
  count: number;
  courts: number;
  games: number;
}): { rounds: Round[]; error: string } {
  const { mode, count, courts, games } = args;

  const participants = buildParticipants(mode, count);
  const unitsPerCourt = mode === "couples" ? 2 : 4;

  if (participants.length === 0 || courts <= 0 || games <= 0) {
    return { rounds: [], error: "Please enter participants, courts, and games." };
  }

  const rounds: Round[] = [];

  for (let g = 1; g <= games; g++) {
    const shuffled = shuffle(participants);
    const maxUnitsUsed = courts * unitsPerCourt;

    const used = shuffled.slice(0, maxUnitsUsed);
    const byes = shuffled.slice(maxUnitsUsed);

    const courtsGroups = chunk(used, unitsPerCourt).slice(0, courts);

    rounds.push({
      gameNumber: g,
      courts: courtsGroups.map((group, idx) => ({
        courtNumber: idx + 1,
        group,
      })),
      byes,
    });
  }

  return { rounds, error: "" };
}

export default function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("couples");

  // Inputs (no names)
  const [count, setCount] = useState<string>("");
  const [courts, setCourts] = useState<string>("");
  const [games, setGames] = useState<string>("");

  // Output + UI state
  const [rounds, setRounds] = useState<Round[]>([]);
  const [error, setError] = useState<string>("");
  const [tvMode, setTvMode] = useState<boolean>(false);

  const countLabel = useMemo(() => {
    return mode === "couples" ? "Number of couples" : "Number of players";
  }, [mode]);

  const perCourtHint = useMemo(() => {
    return mode === "couples" ? "2 couples per court (4 players)" : "4 players per court";
  }, [mode]);

  function handleGenerate(): void {
    const result = generateSchedule({
      mode,
      count: Number(count) || 0,
      courts: Number(courts) || 0,
      games: Number(games) || 0,
    });

    setError(result.error);
    setRounds(result.rounds);

    // Requirement #3: auto-enter TV mode after generating
    if (!result.error) setTvMode(true);
  }

  function handleReset(): void {
    // Requirement #2: clear EVERYTHING
    setMode("couples");
    setCount("");
    setCourts("");
    setGames("");
    setRounds([]);
    setError("");
    setTvMode(false);
  }

  // ---------------- TV MODE ----------------
  if (tvMode) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-2xl font-bold">
                {mode === "couples" ? "Couples Assignments" : "Round Robin Assignments"}
              </div>
              <div className="text-sm text-white/70">
                {rounds.length} game{rounds.length === 1 ? "" : "s"} • {perCourtHint}
              </div>
            </div>
            <button
              onClick={() => setTvMode(false)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20"
            >
              Exit TV Mode
            </button>
          </div>

          <div className="mt-6 space-y-6">
            {rounds.map((r) => (
              <div key={r.gameNumber} className="rounded-2xl border border-white/15 bg-white/5 p-5">
                <div className="flex items-baseline justify-between gap-4">
                  <div className="text-xl font-semibold">Game {r.gameNumber}</div>
                  <div className="text-sm text-white/70">
                    Byes: {r.byes.length ? r.byes.join(", ") : "None"}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {r.courts.map((c) => (
                    <div
                      key={c.courtNumber}
                      className="rounded-2xl border border-white/15 bg-black/40 p-4"
                    >
                      <div className="text-lg font-semibold mb-2">Court {c.courtNumber}</div>

                      {mode === "couples" ? (
                        <div className="text-base leading-7">
                          <div>{c.group[0] ?? "—"}</div>
                          <div>{c.group[1] ?? "—"}</div>
                        </div>
                      ) : (
                        <div className="text-base leading-7">
                          <div>{c.group[0] ?? "—"}</div>
                          <div>{c.group[1] ?? "—"}</div>
                          <div>{c.group[2] ?? "—"}</div>
                          <div>{c.group[3] ?? "—"}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex gap-3">
            <button
              onClick={handleGenerate}
              className="px-5 py-3 rounded-2xl bg-white text-black font-semibold hover:opacity-90"
            >
              Re-Generate
            </button>
            <button
              onClick={handleReset}
              className="px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20"
            >
              Reset All
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- SETUP MODE ----------------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="rounded-3xl bg-white shadow-sm border border-slate-200 p-6">
          <div className="text-2xl font-bold">Pickleball Scheduler</div>
          <div className="text-slate-600 mt-1">
            Generate court assignments for couples play or round robin (individuals).
          </div>

          <div className="mt-6 grid gap-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold">Mode</div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setMode("couples")}
                    className={`px-4 py-2 rounded-xl border ${
                      mode === "couples"
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Couples
                  </button>
                  <button
                    onClick={() => setMode("roundRobin")}
                    className={`px-4 py-2 rounded-xl border ${
                      mode === "roundRobin"
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Round Robin
                  </button>
                </div>
                <div className="mt-2 text-sm text-slate-600">{perCourtHint}</div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold">Quick Notes</div>
                <ul className="mt-2 text-sm text-slate-600 list-disc pl-5 space-y-1">
                  <li>Randomizes each game independently.</li>
                  <li>Extra participants become byes.</li>
                  <li>Numbers only (no names).</li>
                </ul>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <label className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold">{countLabel}</div>
                <input
                  inputMode="numeric"
                  value={count}
                  onChange={(e) => setCount(clampInt(e.target.value, { min: 0 }))}
                  placeholder="e.g., 16"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </label>

              <label className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold">Number of courts</div>
                <input
                  inputMode="numeric"
                  value={courts}
                  onChange={(e) => setCourts(clampInt(e.target.value, { min: 0 }))}
                  placeholder="e.g., 8"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </label>

              <label className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold">Number of games</div>
                <input
                  inputMode="numeric"
                  value={games}
                  onChange={(e) => setGames(clampInt(e.target.value, { min: 0 }))}
                  placeholder="e.g., 4"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </label>
            </div>

            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 text-red-800 px-4 py-3">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={handleGenerate}
                className="px-5 py-3 rounded-2xl bg-slate-900 text-white font-semibold hover:opacity-90"
              >
                Generate Assignments
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-3 rounded-2xl bg-white border border-slate-200 hover:bg-slate-50"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {rounds.length ? (
          <div className="mt-6 rounded-3xl bg-white shadow-sm border border-slate-200 p-6">
            <div className="font-semibold">Last generated (preview)</div>
            <div className="text-sm text-slate-600 mt-1">
              Click “Generate Assignments” again to jump to TV Mode.
            </div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold">Game 1</div>
                <div className="text-sm text-slate-600 mt-1">
                  Byes: {rounds[0]?.byes?.length ? rounds[0].byes.join(", ") : "None"}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
