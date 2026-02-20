import { useMemo, useState } from "react";

/**
 * Version 2.x+
 * - Couples OR Round Robin (individuals)
 * - Courts input: count (e.g., 8) OR list/ranges (e.g., 1-3,5,6)
 * - Inputs are TEXT so phone keyboard supports "-" and ","
 * - Generate auto-enters TV mode
 * - Setup Reset clears everything
 * - TV mode: Exit (left), labeled Prev/Next, NO Reset/Regenerate (safer)
 * - TV mode: Byes at top
 * - TV mode display: numbers only, separated by dashes (e.g., "3 - 7" or "12 - 18 - 4 - 22")
 * - Balanced byes across the whole session
 * - Couples: minimize repeat matchups across games
 * - Round Robin: fixed teams (first two partners, last two partners) and minimize repeat PARTNERS only
 * - Setup screen shows Session Summary (bye spread + repeat count)
 */

type Mode = "couples" | "roundRobin";

type CourtAssignment = {
  courtNumber: number;
  group: number[]; // couples: [a,b]; roundRobin: [a,b,c,d] where (a,b) and (c,d) are partners for that game
};

type Round = {
  gameNumber: number;
  courts: CourtAssignment[];
  byes: number[];
};

/* ---------------- Utilities ---------------- */

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

function parsePositiveInt(text: string): number {
  const cleaned = (text ?? "").replace(/[^\d]/g, "");
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseCourtsInput(text: string): { courts: number[]; error: string } {
  const raw = (text ?? "").trim();
  if (!raw) return { courts: [], error: 'Please enter courts (example: "8" or "1-3,5,6").' };

  // If just digits, treat as a count -> 1..N
  if (/^\d+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return { courts: [], error: "Court count must be at least 1." };
    return { courts: Array.from({ length: n }, (_, i) => i + 1), error: "" };
  }

  // Otherwise parse list/ranges like "1-3, 5,6"
  const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return { courts: [], error: 'Please enter courts (example: "1-3,5,6").' };

  const set = new Set<number>();

  for (const tok of tokens) {
    const range = tok.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number.parseInt(range[1], 10);
      const b = Number.parseInt(range[2], 10);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
        return { courts: [], error: `Invalid range "${tok}". Use positive numbers.` };
      }
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let i = start; i <= end; i++) set.add(i);
      continue;
    }

    if (/^\d+$/.test(tok)) {
      const n = Number.parseInt(tok, 10);
      if (!Number.isFinite(n) || n <= 0) return { courts: [], error: `Invalid court number "${tok}".` };
      set.add(n);
      continue;
    }

    return { courts: [], error: `Invalid courts entry "${tok}". Try "1-3,5,6" or "8".` };
  }

  const courts = Array.from(set).sort((a, b) => a - b);
  if (!courts.length) return { courts: [], error: "No valid courts found." };
  return { courts, error: "" };
}

function pairKey(a: number, b: number): string {
  const x = Math.min(a, b);
  const y = Math.max(a, b);
  return `${x}-${y}`;
}

function numbersOnlyDash(nums: number[]): string {
  return (nums ?? []).join(" - ");
}

/* ---------------- Round Robin (partners-only) helpers ---------------- */

function partnerScoreRR(group: number[], partnerCounts: Map<string, number>): number {
  // Fixed teams: (0,1) and (2,3) are partners for that game
  const a = pairKey(group[0], group[1]);
  const b = pairKey(group[2], group[3]);
  return (partnerCounts.get(a) ?? 0) * 10 + (partnerCounts.get(b) ?? 0) * 10;
}

function bestOrderForRoundRobinGroup(group: number[], partnerCounts: Map<string, number>): number[] {
  // Reorder 4 players to minimize repeated PARTNERS while keeping fixed-team rule.
  const [p1, p2, p3, p4] = group;

  const candidates: number[][] = [
    [p1, p2, p3, p4], // (p1,p2) (p3,p4)
    [p1, p3, p2, p4], // (p1,p3) (p2,p4)
    [p1, p4, p2, p3], // (p1,p4) (p2,p3)
  ];

  let best = candidates[0];
  let bestScore = partnerScoreRR(best, partnerCounts);

  for (let i = 1; i < candidates.length; i++) {
    const s = partnerScoreRR(candidates[i], partnerCounts);
    if (s < bestScore) {
      bestScore = s;
      best = candidates[i];
    }
  }

  return best;
}

/* ---------------- Session generation (balanced byes + minimize repeats) ---------------- */

function generateSchedule(args: {
  mode: Mode;
  participantCount: number;
  courtNumbers: number[];
  games: number;
}): { rounds: Round[]; error: string } {
  const { mode, participantCount, courtNumbers, games } = args;

  const unitsPerCourt = mode === "couples" ? 2 : 4;

  if (participantCount <= 0) return { rounds: [], error: "Please enter the number of couples/players." };
  if (!courtNumbers.length) return { rounds: [], error: 'Please enter courts (example: "8" or "1-3,5,6").' };
  if (games <= 0) return { rounds: [], error: "Please enter the number of games." };

  const participants: number[] = Array.from({ length: participantCount }, (_, i) => i + 1);

  // Balanced byes across session
  const byeCounts = new Array(participantCount + 1).fill(0);

  // Couples: track matchup repeats. RoundRobin: track PARTNER repeats only.
  const partnerCounts = new Map<string, number>();

  const rounds: Round[] = [];

  function maxCourtsFillable(pCount: number): number {
    return Math.min(courtNumbers.length, Math.floor(pCount / unitsPerCourt));
  }

  function chooseByesFairly(pool: number[], byesNeeded: number): { byes: number[]; remaining: number[] } {
    if (byesNeeded <= 0) return { byes: [], remaining: pool };

    const groups = new Map<number, number[]>();
    for (const p of pool) {
      const bc = byeCounts[p] ?? 0;
      const arr = groups.get(bc) ?? [];
      arr.push(p);
      groups.set(bc, arr);
    }

    const byeList: number[] = [];
    const countsSorted = Array.from(groups.keys()).sort((a, b) => a - b);

    for (const bc of countsSorted) {
      if (byeList.length >= byesNeeded) break;
      const tied = shuffle(groups.get(bc) ?? []);
      for (const p of tied) {
        if (byeList.length >= byesNeeded) break;
        byeList.push(p);
      }
    }

    for (const p of byeList) byeCounts[p] = (byeCounts[p] ?? 0) + 1;

    const byeSet = new Set(byeList);
    const remaining = pool.filter((p) => !byeSet.has(p));

    return { byes: byeList.sort((a, b) => a - b), remaining };
  }

  function scoreGroups(groups: number[][]): number {
    let score = 0;

    for (const g of groups) {
      if (mode === "couples") {
        const k = pairKey(g[0], g[1]);
        score += (partnerCounts.get(k) ?? 0) * 10;
      } else {
        score += partnerScoreRR(g, partnerCounts);
      }
    }

    return score;
  }

  function buildGroupsMinRepeats(pool: number[], courtsToUse: number): number[][] {
    const needed = courtsToUse * unitsPerCourt;
    const usable = pool.slice(0, needed);

    const ATTEMPTS = mode === "couples" ? 400 : 1000;

    let bestGroups: number[][] = [];
    let bestScore = Number.POSITIVE_INFINITY;

    for (let t = 0; t < ATTEMPTS; t++) {
      const candidate = shuffle(usable);
      let groups = chunk(candidate, unitsPerCourt).slice(0, courtsToUse);

      if (mode === "roundRobin") {
        groups = groups.map((g) => bestOrderForRoundRobinGroup(g, partnerCounts));
      }

      const s = scoreGroups(groups);
      if (s < bestScore) {
        bestScore = s;
        bestGroups = groups;
        if (bestScore === 0) break;
      }
    }

    return bestGroups;
  }

  for (let game = 1; game <= games; game++) {
    const courtsToUse = maxCourtsFillable(participants.length);
    const usedSlots = courtsToUse * unitsPerCourt;
    const byesNeeded = participants.length - usedSlots;

    // 1) pick byes fairly
    const { byes, remaining } = chooseByesFairly(participants, byesNeeded);

    // 2) minimize repeats (matchups for couples; partners for RR)
    const groups = buildGroupsMinRepeats(remaining, courtsToUse);

    // 3) update history
    if (mode === "couples") {
      for (const g of groups) {
        const k = pairKey(g[0], g[1]);
        partnerCounts.set(k, (partnerCounts.get(k) ?? 0) + 1);
      }
    } else {
      for (const g of groups) {
        const a = pairKey(g[0], g[1]);
        const b = pairKey(g[2], g[3]);
        partnerCounts.set(a, (partnerCounts.get(a) ?? 0) + 1);
        partnerCounts.set(b, (partnerCounts.get(b) ?? 0) + 1);
      }
    }

    // 4) map to selected court numbers
    const courts: CourtAssignment[] = groups.map((group, idx) => ({
      courtNumber: courtNumbers[idx],
      group: group.slice(),
    }));

    rounds.push({ gameNumber: game, courts, byes });
  }

  return { rounds, error: "" };
}

/* ---------------- Session Summary (setup screen) ---------------- */

function analyzeSession(rounds: Round[], mode: Mode) {
  const byeCounts = new Map<number, number>();
  const pairCounts = new Map<string, number>();

  for (const round of rounds) {
    for (const b of round.byes) {
      byeCounts.set(b, (byeCounts.get(b) ?? 0) + 1);
    }

    for (const court of round.courts) {
      const g = court.group;

      if (mode === "couples") {
        const key = pairKey(g[0], g[1]);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      } else {
        const k1 = pairKey(g[0], g[1]);
        const k2 = pairKey(g[2], g[3]);
        pairCounts.set(k1, (pairCounts.get(k1) ?? 0) + 1);
        pairCounts.set(k2, (pairCounts.get(k2) ?? 0) + 1);
      }
    }
  }

  const byeValues = Array.from(byeCounts.values());
  const minByes = byeValues.length ? Math.min(...byeValues) : 0;
  const maxByes = byeValues.length ? Math.max(...byeValues) : 0;

  let repeatPairs = 0;
  for (const count of pairCounts.values()) {
    if (count > 1) repeatPairs += count - 1;
  }

  return { minByes, maxByes, repeatPairs };
}

/* ---------------- App UI ---------------- */

export default function App() {
  const [mode, setMode] = useState<Mode>("couples");

  // text inputs so phone keyboard allows "-" and ","
  const [countText, setCountText] = useState<string>("");
  const [courtsText, setCourtsText] = useState<string>("");
  const [gamesText, setGamesText] = useState<string>("");

  const [rounds, setRounds] = useState<Round[]>([]);
  const [error, setError] = useState<string>("");
  const [tvMode, setTvMode] = useState<boolean>(false);
  const [tvGameIndex, setTvGameIndex] = useState<number>(0);

  const countLabel = useMemo(() => (mode === "couples" ? "Number of couples" : "Number of players"), [mode]);
  const perCourtHint = useMemo(
    () => (mode === "couples" ? "2 couples per court (4 players)" : "4 players per court"),
    [mode]
  );

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

  /* ---------------- TV MODE ---------------- */

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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div className="flex items-start gap-4">
              <button
                onClick={() => setTvMode(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold"
              >
                Exit TV Mode
              </button>

              <div>
                <div className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                  {mode === "couples" ? "Couples Assignments" : "Round Robin Assignments"}
                </div>
                <div className="text-slate-600 mt-1">
                  Game {totalGames ? safeIndex + 1 : 0} of {totalGames}
                </div>

                <div className="text-slate-700 font-semibold mt-1">
                  Byes:{" "}
                  <span className="font-normal text-slate-700">
                    {round?.byes?.length ? numbersOnlyDash(round.byes) : "None"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setTvGameIndex((i) => Math.max(0, i - 1))}
                disabled={!canPrev}
                className={`px-4 py-2 rounded-xl font-semibold border ${
                  canPrev
                    ? "bg-slate-100 hover:bg-slate-200 border-slate-200"
                    : "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                }`}
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
              >
                Next Game →
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {(round?.courts ?? []).map((c, index) => {
              const color = accentColors[index % accentColors.length];

              return (
                <div
                  key={`game-${safeIndex}-court-${c.courtNumber}`}
                  className={`rounded-2xl border-2 ${color} bg-slate-100 px-5 py-4 shadow-sm`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="text-lg sm:text-xl font-extrabold shrink-0">
                      Court {c.courtNumber}
                    </div>

                    <div className="text-base sm:text-lg font-extrabold text-right leading-snug break-words">
                      {numbersOnlyDash(c.group)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* No reset/regenerate buttons on TV mode by design */}
        </div>
      </div>
    );
  }

  /* ---------------- SETUP MODE ---------------- */

  const stats = rounds.length ? analyzeSession(rounds, mode) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50 text-slate-900">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="rounded-3xl bg-white/80 backdrop-blur shadow-sm border border-slate-200 p-6">
          <div className="text-2xl font-bold">Pickleball Scheduler</div>
          <div className="text-slate-600 mt-1">
            Balanced byes + minimized repeats (RR avoids repeat partners only).
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
                  placeholder='e.g., 8 or "1-3,5,6"'
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

            {stats ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="font-semibold text-lg">Session Summary</div>
                <div className="mt-2 text-sm text-slate-700 space-y-1">
                  <div>
                    Byes — Min: <span className="font-semibold">{stats.minByes}</span> | Max:{" "}
                    <span className="font-semibold">{stats.maxByes}</span>
                  </div>
                  <div>
                    {mode === "couples" ? "Repeat matchups" : "Repeat partner pairings"}:{" "}
                    <span className="font-semibold">{stats.repeatPairs}</span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="text-xs text-slate-600 pt-2">
              Note: This scheduler balances byes and minimizes repeats, but some repeats can still be unavoidable depending on counts.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
