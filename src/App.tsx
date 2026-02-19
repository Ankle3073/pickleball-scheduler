import { useMemo, useState } from "react";

type Mode = "couples" | "roundRobin";

type CourtAssignment = {
  courtNumber: number; // actual court # (e.g., 5)
  group: string[];
};

type Round = {
  gameNumber: number;
  courts: CourtAssignment[];
  byes: string[];
};

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

function parsePositiveInt(text: string): number {
  // Keep digits only, so phones can use normal keyboard and we still get a clean number.
  const cleaned = (text ?? "").replace(/[^\d]/g, "");
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseCourtsInput(text: string): { courts: number[]; error: string } {
  const raw = (text ?? "").trim();
  if (!raw) return { courts: [], error: "Please enter courts (e.g., 8 or 1-3,5,6)." };

  // If it's just a number: treat as count (1..N)
  if (/^\d+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return { courts: [], error: "Court count must be at least 1." };
    }
    return { courts: Array.from({ length: n }, (_, i) => i + 1), error: "" };
  }

  // Otherwise parse list/ranges like "1-3, 5,6"
  const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return { courts: [], error: "Please enter courts (e.g., 1-3,5,6)." };

  const set = new Set<number>();

  for (const tok of tokens) {
    // Range: a-b
    const m = tok.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Number.parseInt(m[1], 10);
      const b = Number.parseInt(m[2], 10);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
        return { courts: [], error: `Invalid range "${tok}". Use positive numbers.` };
      }
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let i = start; i <= end; i++) set.add(i);
      continue;
    }

    // Single number
    if (/^\d+$/.test(tok)) {
      const n = Number.parseInt(tok, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return { courts: [], error: `Invalid court number "${tok}".` };
      }
      set.add(n);
      continue;
    }

    return { courts: [], error: `Invalid courts entry "${tok}". Try "1-3,5,6" or "8".` };
  }

  const courts = Array.from(set).sort((a, b) => a - b);
  if (!courts.length) return { courts: [], error: "No valid courts found." };
  return { courts, error: "" };
}

function generateSchedule(args: {
  mode: Mode;
  participantCount: number;
  courtNumbers: number[];
  games: number;
}): { rounds: Round[]; error: string } {
  const { mode, participantCount, courtNumbers, games } = args;

  const participants = buildParticipants(mode, participantCount);
  const unitsPerCourt = mode === "couples" ? 2 : 4;

  if (participants.length === 0) {
    return { rounds: [], error: "Please enter the number of couples/players." };
  }
  if (!courtNumbers.length) {
    return { rounds: [], error: "Please enter courts (e.g., 8 or 1-3,5,6)." };
  }
  if (games <= 0) {
    return { rounds: [], error: "Please enter the number of games." };
  }

  const rounds: Round[] = [];

  for (let g = 1; g <= games; g++) {
    const shuffled = shuffle(participants);

    const maxUnitsUsed = courtNumbers.length * unitsPerCourt;
    const used = shuffled.slice(0, maxUnitsUsed);
    const byes = shuffled.slice(maxUnitsUsed);

    const groups = chunk(used, unitsPerCourt).slice(0, courtNumbers.length);

    rounds.push({
      gameNumber: g,
      courts: groups.map((group, idx) => ({
        courtNumber: courtNumbers[idx], // IMPORTANT: actual court number chosen
        group,
      })),
      byes,
    });
  }

  return { rounds, error: "" };
}

export default function App() {
  const [mode, setMode] = useState<Mode>("couples");

  // Inputs (keep as TEXT so phone keyboard allows commas/dashes when needed)
  const [countText, setCountText] = useState<string>("");
  const [courtsText, setCourtsText] = useState<string>(""); // can be "8" or "1-3,5,6"
  const [gamesText, setGamesText] = useState<string>("");

  // Output + UI state
  const [rounds, setRounds] = useState<Round[]>([]);
  const [error, setError] = useState<string>("");
  const [tvMode, setTvMode] = useState<boolean>(false);
  const [tvGameIndex, setTvGameIndex] = useState<number>(0);

  const countLabel = useMemo(() => {
    return mode === "couples" ? "Number of couples" : "Number of players";
  }, [mode]);

  const perCourtHint = useMemo(() => {
    return mode === "couples" ? "2 couples per court (4 players)" : "4 players per court";
  }, [mode]);

  function handleGenerate(): void {
    const participantCount = parsePositiveInt(countText);
    const games = parsePositiveInt(gamesText);

    const parsedCourts = parseCourtsInput(courtsText);
    if (parsedCourts.error) {
      setError(parsedCourts.error);
      setRounds([]);
      return;
    }

    const result = generateSchedule({
      mode,
      participantCount,
      courtNumbers: parsedCourts.courts,
      games,
    });

    setError(result.error);
    setRounds(result.rounds);
    setTvGameIndex(0);

    // Requirement: auto-enter TV mode after generating
    if (!result.error) setTvMode(true);
  }

  function handleReset(): void {
    setMode("couples");
    setCountText("");
    setCourtsText("");
    setGamesText("");
    setRounds([]);
    setError("");
    setTvMode(false);
    setTvGameIndex(0);
  }

  // ---------------- TV MODE (colorful, not plain black) ----------------
  // ---------------- TV MODE (classic colored cards) ----------------
   // ---------------- TV MODE (classic colored cards) ----------------
  // ---------------- TV MODE (classic colored cards + game arrows) ----------------
  if (tvMode) {
    const accentColors = [
      "border-indigo-400",
      "border-emerald-500",
      "border-amber-400",
      "border-rose-400",
      "border-sky-400",
      "border-violet-400",
      "border-pink-400",
      "border-teal-400",
    ];

    const totalGames = rounds.length;
    const safeIndex = Math.min(Math.max(tvGameIndex, 0), Math.max(totalGames - 1, 0));
    const round = rounds[safeIndex];

    const canPrev = totalGames > 1 && safeIndex > 0;
    const canNext = totalGames > 1 && safeIndex < totalGames - 1;

    return (
      <div className="min-h-screen bg-white text-slate-900">
        <div className="max-w-6xl mx-auto px-6 py-8">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            {/* LEFT SIDE: Exit always visible on phones */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTvMode(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold"
              >
                Exit TV Mode
              </button>

              <div>
                <div className="text-2xl font-extrabold tracking-tight">
                  {mode === "couples" ? "Couples Assignments" : "Round Robin Assignments"}
                </div>
                <div className="text-slate-600 mt-1">
                  Game {totalGames ? safeIndex + 1 : 0} of {totalGames}
                </div>
              </div>
            </div>

            {/* RIGHT SIDE: Game selector buttons (labeled) */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTvGameIndex((i) => Math.max(0, i - 1))}
                disabled={!canPrev}
                className={`px-4 py-2 rounded-xl font-semibold border ${
                  canPrev
                    ? "bg-slate-100 hover:bg-slate-200 border-slate-200"
                    : "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                }`}
                aria-label="Previous game"
                title="Previous game"
              >
                ← Previous Game
              </button>

              <button
                onClick={() => setTvGameIndex((i) => Math.min(totalGames - 1, i + 1))}
                disabled={!canNext}
                className={`px-4 py-2 rounded-xl font-semibold border ${
                  canNext
                    ? "bg-slate-100 hover:bg-slate-200 border-slate-200"
                    : "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                }`}
                aria-label="Next game"
                title="Next game"
              >
                Next Game →
              </button>
            </div>
          </div>

            <div className="flex items-center gap-3">
              {/* Game selector arrows */}
              <button
                onClick={() => setTvGameIndex((i) => Math.max(0, i - 1))}
                disabled={!canPrev}
                className={`px-4 py-2 rounded-xl font-extrabold border ${
                  canPrev
                    ? "bg-slate-100 hover:bg-slate-200 border-slate-200"
                    : "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                }`}
                aria-label="Previous game"
                title="Previous game"
              >
                ←
              </button>

              <button
                onClick={() => setTvGameIndex((i) => Math.min(totalGames - 1, i + 1))}
                disabled={!canNext}
                className={`px-4 py-2 rounded-xl font-extrabold border ${
                  canNext
                    ? "bg-slate-100 hover:bg-slate-200 border-slate-200"
                    : "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                }`}
                aria-label="Next game"
                title="Next game"
              >
                →
              </button>

              <button
                onClick={handleGenerate}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:opacity-90"
              >
                Re-Generate
              </button>

              <button
                onClick={() => setTvMode(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold"
              >
                Exit TV Mode
              </button>
            </div>
          </div>

          {/* Slightly smaller like before */}
          <div className="space-y-4">
            {(round?.courts ?? []).map((c, index) => {
              const color = accentColors[index % accentColors.length];

              return (
                <div
                  key={`game-${safeIndex}-court-${c.courtNumber}`}
                  className={`rounded-2xl border-2 ${color} bg-slate-100 px-6 py-5 flex items-center justify-between shadow-sm`}
                >
                  <div className="text-xl font-extrabold">Court {c.courtNumber}</div>

                  <div className="text-xl font-extrabold tracking-wide">
                    {mode === "couples" ? (
                      <>
                        {c.group[0] ?? "—"}
                        <span className="mx-3 text-slate-500 font-black">vs</span>
                        {c.group[1] ?? "—"}
                      </>
                    ) : (
                      (c.group ?? []).join("  •  ")
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 text-base font-semibold">
            Byes:{" "}
            <span className="font-normal text-slate-700">
              {round?.byes?.length ? round.byes.join(", ") : "None"}
            </span>
          </div>

          <div className="mt-6">
            <button
              onClick={handleReset}
              className="px-5 py-3 rounded-2xl bg-white border border-slate-200 hover:bg-slate-50 font-semibold"
            >
              Reset All
            </button>
          </div>
        </div>
      </div>
    );
  }


  // ---------------- SETUP MODE (nice colors) ----------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50 text-slate-900">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="rounded-3xl bg-white/80 backdrop-blur shadow-sm border border-slate-200 p-6">
          <div className="text-2xl font-bold">Pickleball Scheduler</div>
          <div className="text-slate-600 mt-1">
            Generate court assignments for couples play or round robin (individuals).
          </div>

          <div className="mt-6 grid gap-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="font-semibold">Mode</div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setMode("couples")}
                    className={`px-4 py-2 rounded-xl border transition ${
                      mode === "couples"
                        ? "bg-gradient-to-r from-indigo-600 to-sky-600 text-white border-transparent"
                        : "bg-white border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Couples
                  </button>
                  <button
                    onClick={() => setMode("roundRobin")}
                    className={`px-4 py-2 rounded-xl border transition ${
                      mode === "roundRobin"
                        ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-transparent"
                        : "bg-white border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Round Robin
                  </button>
                </div>
                <div className="mt-2 text-sm text-slate-600">{perCourtHint}</div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="font-semibold">Courts input examples</div>
                <div className="mt-2 text-sm text-slate-600 space-y-1">
                  <div>
                    <span className="font-semibold">8</span> → use courts 1–8
                  </div>
                  <div>
                    <span className="font-semibold">1-3, 5,6</span> → use courts 1,2,3,5,6
                  </div>
                </div>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <label className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="font-semibold">{countLabel}</div>
                <input
                  type="text"
                  inputMode="text"
                  value={countText}
                  onChange={(e) => setCountText(e.target.value)}
                  placeholder={mode === "couples" ? "e.g., 16" : "e.g., 20"}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
                />
              </label>

              <label className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="font-semibold">Courts (count or list)</div>
                <input
                  type="text"
                  inputMode="text"
                  value={courtsText}
                  onChange={(e) => setCourtsText(e.target.value)}
                  placeholder="e.g., 8 or 1-3,5,6"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </label>

              <label className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="font-semibold">Number of games</div>
                <input
                  type="text"
                  inputMode="text"
                  value={gamesText}
                  onChange={(e) => setGamesText(e.target.value)}
                  placeholder="e.g., 4"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200"
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
                className="px-5 py-3 rounded-2xl text-white font-semibold bg-gradient-to-r from-indigo-600 via-sky-600 to-emerald-600 hover:opacity-95"
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
          <div className="mt-6 rounded-3xl bg-white/80 backdrop-blur shadow-sm border border-slate-200 p-6">
            <div className="font-semibold">Last generated (preview)</div>
            <div className="text-sm text-slate-600 mt-1">
              Click “Generate Assignments” to jump straight to TV Mode.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
