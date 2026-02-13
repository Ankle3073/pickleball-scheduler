import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Shuffle, Copy, Download, RotateCcw, Tv2, Maximize, Minimize, X } from "lucide-react";

/**
 * Pickleball Partner Play Scheduler (Tues/Thurs)
 *
 * Goals:
 * - Random assignments
 * - Fair bye rotation: keep everyone at 0/1 byes before anyone gets a 2nd (when possible)
 * - Avoid repeat matchups as much as possible
 * - Court board / TV mode for displaying on a phone/tablet/TV
 * - Custom court numbers list (e.g., 2,3,5,6,7,8)
 * - If you have more courts than playable matches, show the extra courts as OPEN
 */

function clampInt(n: number, min: number, max: number) {
  const x = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.max(min, Math.min(max, x));
}

function range(start: number, endInclusive: number) {
  const out: number[] = [];
  for (let i = start; i <= endInclusive; i++) out.push(i);
  return out;
}

function shuffle<T>(arr: T[], seedRand = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(seedRand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function defaultCoupleName(i: number) {
  return `Couple ${i}`;
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join(" ⟷ ");
}

function parseCourtList(text: string, min = 1, max = 40): number[] {
  // Accept: "2,3,5 6 7-8" etc. Auto-sort & de-dupe.
  const cleaned = (text || "").trim();
  if (!cleaned) return [];

  const parts = cleaned
    .split(/[^0-9\-]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const set = new Set<number>();
  for (const p of parts) {
    if (p.includes("-")) {
      const [aS, bS] = p.split("-");
      const a = Number(aS);
      const b = Number(bS);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let x = lo; x <= hi; x++) {
        if (x >= min && x <= max) set.add(x);
      }
    } else {
      const n = Number(p);
      if (Number.isFinite(n) && n >= min && n <= max) set.add(n);
    }
  }

  return Array.from(set).sort((a, b) => a - b);
}

function chooseByesFair(
  couples: string[],
  byeCounts: Record<string, number>,
  byeSlots: number,
  lastByes?: Set<string>
) {
  if (byeSlots <= 0) return [] as string[];

  // Rules:
  // 1) Lowest bye-count gets priority (keeps everyone at 0/1 before 2nd, etc.)
  // 2) Random inside equal-count bucket
  // 3) Prefer not giving back-to-back byes if avoidable

  const withCounts = couples.map((c) => ({ c, k: byeCounts[c] ?? 0 }));
  withCounts.sort((x, y) => x.k - y.k);

  const chosen: string[] = [];
  let i = 0;
  while (chosen.length < byeSlots && i < withCounts.length) {
    const k = withCounts[i].k;
    const bucket: string[] = [];
    while (i < withCounts.length && withCounts[i].k === k) {
      bucket.push(withCounts[i].c);
      i++;
    }

    let nonLast = bucket;
    let last: string[] = [];
    if (lastByes && lastByes.size) {
      nonLast = bucket.filter((c) => !lastByes.has(c));
      last = bucket.filter((c) => lastByes.has(c));
    }

    for (const c of shuffle(nonLast)) {
      if (chosen.length < byeSlots) chosen.push(c);
    }
    for (const c of shuffle(last)) {
      if (chosen.length < byeSlots) chosen.push(c);
    }
  }

  return chosen;
}

type CourtMatch = { court: number; team1: string; team2: string; isOpen?: boolean };

type RoundResult = { courtsOut: CourtMatch[]; byes: string[]; repeatsUsed: number };

function buildMatchesAvoidRepeats(
  activeCouples: string[],
  courtNumbers: number[],
  matchupSet: Set<string>,
  maxRetries = 250
): { courtsOut: CourtMatch[]; repeatsUsed: number } {
  const needPairs = Math.min(courtNumbers.length, Math.floor(activeCouples.length / 2));
  const needPlayers = needPairs * 2;
  const pool = activeCouples.slice(0, needPlayers);

  let best: [string, string][] | null = null;
  let bestRepeats = Infinity;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const remaining = shuffle(pool);
    const matches: [string, string][] = [];
    let repeats = 0;

    while (remaining.length >= 2) {
      const a = remaining.shift() as string;

      // Find partner avoiding repeat if possible
      let pickIdx = -1;
      for (let j = 0; j < remaining.length; j++) {
        const b = remaining[j];
        if (!matchupSet.has(pairKey(a, b))) {
          pickIdx = j;
          break;
        }
      }
      if (pickIdx === -1) pickIdx = 0;

      const b = remaining.splice(pickIdx, 1)[0];
      if (matchupSet.has(pairKey(a, b))) repeats++;
      matches.push([a, b]);
    }

    if (repeats < bestRepeats) {
      bestRepeats = repeats;
      best = matches;
      if (bestRepeats === 0) break;
    }
  }

  const out: CourtMatch[] = [];
  const matches = best ?? [];
  for (let i = 0; i < matches.length && i < courtNumbers.length; i++) {
    out.push({ court: courtNumbers[i], team1: matches[i][0], team2: matches[i][1] });
  }
  return { courtsOut: out, repeatsUsed: bestRepeats === Infinity ? 0 : bestRepeats };
}

function asText(rounds: RoundResult[], byeCounts: Record<string, number>) {
  const lines: string[] = [];

  rounds.forEach((r, idx) => {
    lines.push(`ROUND ${idx + 1}`);
    if (r.courtsOut.length === 0) lines.push("(No playable courts — need at least 2 couples)");

    r.courtsOut.forEach((m) => {
      if (m.isOpen) lines.push(`Court ${m.court}: OPEN`);
      else lines.push(`Court ${m.court}: ${m.team1} vs ${m.team2}`);
    });

    if (r.byes.length) lines.push(`Byes: ${r.byes.join(", ")}`);
    if (r.repeatsUsed)
      lines.push(
        `(Used ${r.repeatsUsed} repeat matchup${r.repeatsUsed === 1 ? "" : "s"} — unavoidable)`
      );

    lines.push("");
  });

  const sorted = Object.entries(byeCounts || {}).sort(
    (a, b) => (a[1] ?? 0) - (b[1] ?? 0) || a[0].localeCompare(b[0])
  );
  if (sorted.length) {
    lines.push("BYE COUNTS (fair rotation)");
    sorted.forEach(([name, cnt]) => lines.push(`${name}: ${cnt}`));
  }

  // IMPORTANT: keep this as a single-line escaped string
  return lines.join("\n");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs shadow-sm bg-white/70 backdrop-blur ${className}`}
    >
      {children}
    </span>
  );
}

function courtAccent(court: number) {
  const accents = [
    "border-indigo-400 bg-indigo-50/60",
    "border-emerald-400 bg-emerald-50/60",
    "border-amber-400 bg-amber-50/60",
    "border-rose-400 bg-rose-50/60",
    "border-sky-400 bg-sky-50/60",
    "border-violet-400 bg-violet-50/60",
    "border-lime-400 bg-lime-50/60",
    "border-cyan-400 bg-cyan-50/60",
  ];
  return accents[(court - 1) % accents.length];
}

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white shadow-sm border">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="font-semibold">{title}</div>
        <div className="flex items-center gap-2">{right}</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function BoardRow({
  court,
  team1,
  team2,
  tv,
  isOpen,
}: {
  court: number;
  team1: string;
  team2: string;
  tv?: boolean;
  isOpen?: boolean;
}) {
  const accent = courtAccent(court);
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-2xl border border-l-8 p-4 ${accent} ${
        tv ? "py-6" : ""
      }`}
    >
      <div className={`${tv ? "text-2xl md:text-3xl" : "text-sm"} font-extrabold`}>Court {court}</div>
      <div className={`${tv ? "text-2xl md:text-3xl" : "text-sm"} text-right font-semibold`}>
        {isOpen ? (
          <span className="font-black text-slate-700">OPEN</span>
        ) : (
          <>
            <span className="font-black">{team1}</span> <span className="text-slate-500">vs</span>{" "}
            <span className="font-black">{team2}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
          <div className="font-semibold">{title}</div>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-semibold border bg-white hover:bg-slate-50 shadow-sm"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export default function PickleballPartnerPlayScheduler() {
  const [numCouples, setNumCouples] = useState<number | string>(14);
  const [numCourts, setNumCourts] = useState<number | string>(8);
  const [roundCount, setRoundCount] = useState<number | string>(1);
  const [courtListText, setCourtListText] = useState<string>("");

  const [useCustomNames, setUseCustomNames] = useState(false);
  const [names, setNames] = useState<string[]>(() =>
    Array.from({ length: 14 }, (_, i) => defaultCoupleName(i + 1))
  );

  const [results, setResults] = useState<RoundResult[]>([]);
  const [byeCounts, setByeCounts] = useState<Record<string, number>>({});
  const [matchupSet, setMatchupSet] = useState<Set<string>>(() => new Set());

  const [copyNotice, setCopyNotice] = useState<string>("");
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyModalText, setCopyModalText] = useState<string>("");

  const [tvMode, setTvMode] = useState(false);
  const [showRoundIndex, setShowRoundIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const appRef = useRef<HTMLDivElement | null>(null);

  const couples = useMemo(() => {
    const n = clampInt(Number(numCouples), 2, 40);
    if (!useCustomNames) {
      return Array.from({ length: n }, (_, i) => defaultCoupleName(i + 1));
    }
    return Array.from({ length: n }, (_, i) => {
      const v = (names[i] ?? defaultCoupleName(i + 1)).trim();
      return v || defaultCoupleName(i + 1);
    });
  }, [numCouples, useCustomNames, names]);

  const customCourtNumbers = useMemo(() => parseCourtList(courtListText, 1, 40), [courtListText]);

  const courtNumbersInUse = useMemo(() => {
    if (customCourtNumbers.length) return customCourtNumbers;
    const n = clampInt(Number(numCourts), 1, 40);
    return range(1, n);
  }, [customCourtNumbers, numCourts]);

  const canPlay = couples.length >= 2 && courtNumbersInUse.length >= 1;

  function syncNames(nextN: number) {
    const n = clampInt(nextN, 2, 40);
    setNames((prev) => {
      const out = prev.slice(0, n);
      while (out.length < n) out.push(defaultCoupleName(out.length + 1));
      return out;
    });
  }

  function resetHistory() {
    setResults([]);
    setByeCounts({});
    setMatchupSet(new Set());
    setShowRoundIndex(0);
  }

  // Keep byeCounts aligned with couple list
  useEffect(() => {
    setByeCounts((prev) => {
      const out: Record<string, number> = {};
      couples.forEach((c) => (out[c] = prev?.[c] ?? 0));
      return out;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [couples.length]);

  useEffect(() => {
    if (!copyNotice) return;
    const t = setTimeout(() => setCopyNotice(""), 2200);
    return () => clearTimeout(t);
  }, [copyNotice]);

  useEffect(() => {
    setShowRoundIndex((i) => Math.max(0, Math.min(i, Math.max(0, results.length - 1))));
  }, [results.length]);

  async function toggleFullscreen() {
    const el = appRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        // @ts-ignore
        await el.requestFullscreen?.();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function openCopyFallback(text: string) {
    setCopyModalText(text);
    setCopyModalOpen(true);
  }

  async function copyToClipboardSafe(text: string) {
    if (!text) return;

    // 1) Clipboard API
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyNotice("Copied!");
        return;
      }
    } catch {
      // continue
    }

    // 2) execCommand fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand?.("copy");
      document.body.removeChild(ta);
      if (ok) {
        setCopyNotice("Copied!");
        return;
      }
    } catch {
      // ignore
    }

    // 3) Manual modal
    openCopyFallback(text);
  }

  function generate() {
    const roundsN = clampInt(Number(roundCount), 1, 10);

    const newResults: RoundResult[] = [];
    let lastByesSet: Set<string> = results.length
      ? new Set(results[results.length - 1].byes)
      : new Set();

    let nextByeCounts: Record<string, number> = { ...byeCounts };
    let nextMatchupSet = new Set(matchupSet);

    for (let r = 0; r < roundsN; r++) {
      const availableCourts = courtNumbersInUse.length;
      const playableCourts = Math.min(availableCourts, Math.floor(couples.length / 2));
      const activeSlots = playableCourts * 2;
      const byeSlots = Math.max(0, couples.length - activeSlots);

      const byes = chooseByesFair(couples, nextByeCounts, byeSlots, lastByesSet);
      lastByesSet = new Set(byes);

      const active = couples.filter((c) => !byes.includes(c));
      const activeShuffled = shuffle(active);

      const courtsThisRound = courtNumbersInUse.slice(0, playableCourts);
      const { courtsOut: playedCourtsOut, repeatsUsed } = buildMatchesAvoidRepeats(
        activeShuffled,
        courtsThisRound,
        nextMatchupSet
      );

      // Show extra selected courts as OPEN
      const openCourts: CourtMatch[] = courtNumbersInUse
        .slice(playableCourts)
        .map((c) => ({ court: c, team1: "", team2: "", isOpen: true }));

      const courtsOut: CourtMatch[] = [...playedCourtsOut, ...openCourts];

      // Update history (real matches only)
      byes.forEach((b) => (nextByeCounts[b] = (nextByeCounts[b] ?? 0) + 1));
      playedCourtsOut.forEach((m) => nextMatchupSet.add(pairKey(m.team1, m.team2)));

      newResults.push({ courtsOut, byes, repeatsUsed });
    }

    setByeCounts(nextByeCounts);
    setMatchupSet(nextMatchupSet);
    setResults((prev) => {
      const merged = [...prev, ...newResults];
      // Game 1 should show first
      setShowRoundIndex(0);
      return merged;
    });
  }

  const summary = useMemo(() => {
    const availableCourts = courtNumbersInUse.length;
    const playableCourts = Math.min(availableCourts, Math.floor(couples.length / 2));
    const byes = Math.max(0, couples.length - playableCourts * 2);
    const openCourts = Math.max(0, availableCourts - playableCourts);
    return { availableCourts, playableCourts, openCourts, byes };
  }, [courtNumbersInUse.length, couples.length]);

  const exportText = useMemo(() => (results.length ? asText(results, byeCounts) : ""), [results, byeCounts]);

  const currentRound = results[showRoundIndex] || { courtsOut: [], byes: [], repeatsUsed: 0 };

  // TV auto-advance
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [autoSeconds, setAutoSeconds] = useState<number | string>(30);
  useEffect(() => {
    if (!autoAdvance || !results.length) return;
    const sec = clampInt(Number(autoSeconds), 5, 300);
    const t = setInterval(() => {
      setShowRoundIndex((i) => (i + 1) % results.length);
    }, sec * 1000);
    return () => clearInterval(t);
  }, [autoAdvance, autoSeconds, results.length]);

  if (tvMode) {
    return (
      <div ref={appRef} className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-emerald-50">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-2xl md:text-4xl font-black tracking-tight">Court Board</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleFullscreen}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border bg-white hover:bg-slate-50 shadow-sm"
                >
                  {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                  {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                </button>
                <button
                  onClick={() => setTvMode(false)}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-200 shadow-sm"
                >
                  <Tv2 className="w-4 h-4" />
                  Exit TV Mode
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Pill className="bg-white">
                Round {results.length ? showRoundIndex + 1 : 0} / {results.length}
              </Pill>
              <Pill className="bg-white">Courts shown: {currentRound.courtsOut.length}</Pill>
              <Pill className="bg-white">Byes: {currentRound.byes.length}</Pill>
              {currentRound.repeatsUsed ? (
                <Pill className="bg-white">Repeat matchups: {currentRound.repeatsUsed}</Pill>
              ) : null}

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() =>
                    setShowRoundIndex((i) =>
                      results.length ? (i - 1 + results.length) % results.length : 0
                    )
                  }
                  className="rounded-xl px-3 py-2 text-sm font-semibold border bg-white hover:bg-slate-50 shadow-sm"
                >
                  Prev
                </button>
                <button
                  onClick={() =>
                    setShowRoundIndex((i) => (results.length ? (i + 1) % results.length : 0))
                  }
                  className="rounded-xl px-3 py-2 text-sm font-semibold border bg-white hover:bg-slate-50 shadow-sm"
                >
                  Next
                </button>

                <div className="flex items-center gap-2 rounded-2xl border bg-white/70 px-3 py-2 shadow-sm">
                  <label className="text-sm font-semibold">Auto</label>
                  <button
                    onClick={() => setAutoAdvance((v) => !v)}
                    className={`rounded-xl px-3 py-1.5 text-sm font-semibold border shadow-sm ${
                      autoAdvance ? "bg-black text-white" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    {autoAdvance ? "On" : "Off"}
                  </button>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={autoSeconds}
                    onChange={(e) => setAutoSeconds(e.target.value)}
                    className="w-20 rounded-xl border px-2 py-1.5 text-sm bg-white"
                    title="Seconds per round"
                  />
                  <span className="text-sm text-slate-600">sec</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Pill className="bg-white">Courts in use: {courtNumbersInUse.join(", ")}</Pill>
              {summary.openCourts ? <Pill className="bg-white">Open courts: {summary.openCourts}</Pill> : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {currentRound.courtsOut.map((m) => (
              <BoardRow
                key={m.court}
                court={m.court}
                team1={m.team1}
                team2={m.team2}
                isOpen={m.isOpen}
                tv
              />
            ))}
            {currentRound.courtsOut.length === 0 && (
              <div className="rounded-2xl border bg-white p-6 text-slate-700 text-xl">
                No results yet. Exit TV Mode and click Generate.
              </div>
            )}
          </div>

          {currentRound.byes.length > 0 && (
            <div className="mt-4 rounded-2xl border bg-white p-4">
              <div className="text-xl font-black mb-2">Byes</div>
              <div className="flex flex-wrap gap-2">
                {currentRound.byes.map((b, i) => (
                  <Pill key={i} className="bg-white text-base px-4 py-2">
                    {b}
                  </Pill>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={appRef} className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-emerald-50">
      {copyModalOpen && (
        <Modal title="Copy assignments" onClose={() => setCopyModalOpen(false)}>
          <div className="space-y-3">
            <div className="text-sm text-slate-700">
              Your browser blocked automatic clipboard access here. You can still copy manually:{" "}
              <span className="font-semibold">Select All</span> then copy.
            </div>
            <textarea
              value={copyModalText}
              readOnly
              className="w-full h-64 rounded-xl border p-3 text-sm font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="text-xs text-slate-500">Phone tip: long-press inside → Select All → Copy.</div>
            <div className="flex justify-end">
              <button
                onClick={() => setCopyModalOpen(false)}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border bg-white hover:bg-slate-50 shadow-sm"
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}

      <div className="max-w-5xl mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex flex-col gap-2 mb-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-indigo-700 to-emerald-600 bg-clip-text text-transparent">
                  Pickleball Partner Play Scheduler
                </div>
                <div className="text-slate-600">Fair byes + avoid repeats + custom court numbers + TV board.</div>
              </div>
              <button
                onClick={() => {
                  setShowRoundIndex(0);
                  setTvMode(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border bg-white hover:bg-slate-50 shadow-sm"
              >
                <Tv2 className="w-4 h-4" />
                TV Mode
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mt-1">
              <Pill>Courts in use: {courtNumbersInUse.join(", ")}</Pill>
              <Pill>Courts available: {summary.availableCourts}</Pill>
              <Pill>Courts with matches: {summary.playableCourts}</Pill>
              {summary.openCourts ? <Pill>Open courts: {summary.openCourts}</Pill> : null}
              <Pill>Byes this round: {summary.byes}</Pill>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card
              title="Setup"
              right={
                <div className="flex items-center gap-2">
                  <button
                    onClick={resetHistory}
                    className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border bg-amber-50 hover:bg-amber-100 shadow-sm text-amber-900"
                    title="Clear history (bye counts + matchup history)"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reset
                  </button>
                  <button
                    onClick={generate}
                    disabled={!canPlay}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold shadow-sm border transition ${
                      canPlay
                        ? "bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-200"
                        : "bg-slate-200 text-slate-500 cursor-not-allowed"
                    }`}
                  >
                    <Shuffle className="w-4 h-4" />
                    Generate
                  </button>
                </div>
              }
            >
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="block">
                    <div className="text-sm font-medium text-slate-700">Couples</div>
                    <input
                      type="number"
                      min={2}
                      max={40}
                      value={numCouples}
                      onChange={(e) => {
                        setNumCouples(e.target.value);
                        if (useCustomNames) syncNames(Number(e.target.value));
                      }}
                      className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                    />
                  </label>

                  <label className="block">
                    <div className="text-sm font-medium text-slate-700">Available courts (count)</div>
                    <input
                      type="number"
                      min={1}
                      max={40}
                      value={numCourts}
                      onChange={(e) => setNumCourts(e.target.value)}
                      className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                    />
                    <div className="text-xs text-slate-500 mt-1">Ignored if you enter a custom list below</div>
                  </label>

                  <label className="block">
                    <div className="text-sm font-medium text-slate-700">Rounds to add</div>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={roundCount}
                      onChange={(e) => setRoundCount(e.target.value)}
                      className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                    />
                    <div className="text-xs text-slate-500 mt-1">Appends to history</div>
                  </label>
                </div>

                <div className="rounded-2xl border bg-white/60 p-3">
                  <div className="font-semibold">Court numbers in use (optional)</div>
                  <div className="text-sm text-slate-600">
                    Example: <span className="font-semibold">2,3,5,6,7,8</span> or{" "}
                    <span className="font-semibold">1-4,6</span>
                  </div>
                  <input
                    value={courtListText}
                    onChange={(e) => setCourtListText(e.target.value)}
                    placeholder="Leave blank to use courts 1..N"
                    className="mt-2 w-full rounded-xl border px-3 py-2 bg-white"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {courtNumbersInUse.slice(0, 14).map((c) => (
                      <Pill key={c} className="bg-white">
                        Court {c}
                      </Pill>
                    ))}
                    {courtNumbersInUse.length > 14 ? (
                      <Pill className="bg-white">+{courtNumbersInUse.length - 14} more</Pill>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-2xl border bg-white/60 p-3">
                  <div>
                    <div className="font-semibold">Custom couple names</div>
                    <div className="text-sm text-slate-600">Optional: replace “Couple 1” with names.</div>
                  </div>
                  <button
                    onClick={() => {
                      const next = !useCustomNames;
                      setUseCustomNames(next);
                      if (next) syncNames(Number(numCouples));
                    }}
                    className={`rounded-xl px-3 py-2 text-sm font-semibold border shadow-sm transition ${
                      useCustomNames ? "bg-black text-white" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    {useCustomNames ? "On" : "Off"}
                  </button>
                </div>

                {useCustomNames && (
                  <div className="rounded-2xl border bg-white p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold">Couple list</div>
                      <div className="text-xs text-slate-500">If you rename a lot, consider Reset</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-auto pr-1">
                      {couples.map((nm, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="w-16 text-xs text-slate-500">#{idx + 1}</span>
                          <input
                            value={nm}
                            onChange={(e) => {
                              const v = e.target.value;
                              setNames((prev) => {
                                const out = [...prev];
                                out[idx] = v;
                                return out;
                              });
                            }}
                            className="w-full rounded-xl border px-3 py-2"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border bg-white p-3">
                  <div className="font-semibold mb-2">Bye counts (fair rotation)</div>
                  <div className="flex flex-wrap gap-2">
                    {couples.map((c) => (
                      <Pill key={c} className="bg-white">
                        {c}: {byeCounts[c] ?? 0}
                      </Pill>
                    ))}
                  </div>
                  <div className="text-xs text-slate-500 mt-2">Lowest counts get picked for byes first.</div>
                </div>
              </div>
            </Card>

            <Card
              title="Results"
              right={
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyToClipboardSafe(exportText)}
                    disabled={!exportText}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border shadow-sm transition ${
                      exportText ? "bg-white hover:bg-slate-50" : "bg-slate-200 text-slate-500 cursor-not-allowed"
                    }`}
                    title="Copy results"
                  >
                    <Copy className="w-4 h-4" />
                    Copy
                  </button>
                  <button
                    onClick={() => exportText && downloadText("pickleball-assignments.txt", exportText)}
                    disabled={!exportText}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border shadow-sm transition ${
                      exportText ? "bg-white hover:bg-slate-50" : "bg-slate-200 text-slate-500 cursor-not-allowed"
                    }`}
                    title="Download a .txt file"
                  >
                    <Download className="w-4 h-4" />
                    Export
                  </button>
                </div>
              }
            >
              {!results.length ? (
                <div className="text-slate-600">
                  Click <span className="font-semibold">Generate</span> to create assignments.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill className="bg-white">Total rounds: {results.length}</Pill>
                    <Pill className="bg-white">Viewing: Round {showRoundIndex + 1}</Pill>
                    {copyNotice ? (
                      <Pill className="bg-emerald-50 border-emerald-300">{copyNotice}</Pill>
                    ) : null}

                    <div className="ml-auto flex items-center gap-2">
                      <button
                        onClick={() => setShowRoundIndex((i) => Math.max(0, i - 1))}
                        className="rounded-xl px-3 py-2 text-sm font-semibold border bg-white hover:bg-slate-50 shadow-sm"
                        disabled={showRoundIndex === 0}
                      >
                        Prev
                      </button>
                      <button
                        onClick={() =>
                          setShowRoundIndex((i) => Math.min(results.length - 1, i + 1))
                        }
                        className="rounded-xl px-3 py-2 text-sm font-semibold border bg-white hover:bg-slate-50 shadow-sm"
                        disabled={showRoundIndex === results.length - 1}
                      >
                        Next
                      </button>
                      <button
                        onClick={() => setShowRoundIndex(results.length - 1)}
                        className="rounded-xl px-3 py-2 text-sm font-semibold border bg-white hover:bg-slate-50 shadow-sm"
                      >
                        Latest
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-white p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">Round {showRoundIndex + 1}</div>
                      <Pill>
                        {currentRound.courtsOut.length} court{currentRound.courtsOut.length === 1 ? "" : "s"} •{" "}
                        {currentRound.byes.length} bye{currentRound.byes.length === 1 ? "" : "s"}
                      </Pill>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2">
                      {currentRound.courtsOut.map((m) => (
                        <div
                          key={m.court}
                          className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-l-8 p-3 ${courtAccent(
                            m.court
                          )}`}
                        >
                          <div className="text-sm font-semibold">Court {m.court}</div>
                          <div className="text-sm">
                            {m.isOpen ? (
                              <span className="font-semibold text-slate-700">OPEN</span>
                            ) : (
                              <>
                                <span className="font-semibold">{m.team1}</span>{" "}
                                <span className="text-slate-500">vs</span>{" "}
                                <span className="font-semibold">{m.team2}</span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}

                      {currentRound.courtsOut.length === 0 && (
                        <div className="text-sm text-slate-600">
                          Not enough couples to play (need at least 2).
                        </div>
                      )}
                    </div>

                    {currentRound.byes.length > 0 && (
                      <div className="mt-3 rounded-xl bg-slate-50 border p-3">
                        <div className="text-sm font-semibold mb-1">Byes</div>
                        <div className="text-sm text-slate-700 flex flex-wrap gap-2">
                          {currentRound.byes.map((b, i) => (
                            <Pill key={i}>{b}</Pill>
                          ))}
                        </div>
                      </div>
                    )}

                    {currentRound.repeatsUsed ? (
                      <div className="mt-3 text-xs text-amber-700">
                        Used {currentRound.repeatsUsed} repeat matchup{currentRound.repeatsUsed === 1 ? "" : "s"} (unavoidable).
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-slate-500">No repeat matchups in this round.</div>
                    )}
                  </div>

                  <div className="text-xs text-slate-500">
                    Tip: If you change the couple list or court list, click{" "}
                    <span className="font-semibold">Reset</span> to keep fairness clean.
                  </div>
                </div>
              )}
            </Card>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/**
 * Lightweight self-tests (opt-in)
 * To run: set globalThis.__RUN_PB_TESTS__ = true before importing this file.
 */
function runSelfTests() {
  console.assert(clampInt(5.9, 1, 10) === 5, "clampInt floors");
  console.assert(clampInt(NaN as any, 2, 40) === 2, "clampInt NaN -> min");
  console.assert(clampInt(999, 1, 20) === 20, "clampInt caps at max");

  console.assert(pairKey("A", "B") === pairKey("B", "A"), "pairKey symmetric");

  const cList = parseCourtList("2,3,5,6,7,8");
  console.assert(cList.join(",") === "2,3,5,6,7,8", "parseCourtList comma list");
  const cRange = parseCourtList("1-3,6");
  console.assert(cRange.join(",") === "1,2,3,6", "parseCourtList ranges");

  const byes = chooseByesFair(["C1", "C2", "C3", "C4"], { C1: 2, C2: 0, C3: 1, C4: 0 }, 2);
  console.assert(byes.includes("C2") && byes.includes("C4"), "chooseByesFair picks lowest bye counts");

  const txt = asText(
    [{ courtsOut: [{ court: 6, team1: "C1", team2: "C2" }], byes: ["C3"], repeatsUsed: 0 }],
    { C3: 1 }
  );
  console.assert(typeof txt === "string" && txt.includes("Court 6"), "asText includes selected court number");
  // IMPORTANT: keep this escaped string on one line
  console.assert(txt.includes("\n"), "asText joins with newline");

  const txt2 = asText(
    [
      {
        courtsOut: [
          { court: 1, team1: "A", team2: "B" },
          { court: 2, team1: "", team2: "", isOpen: true },
        ],
        byes: [],
        repeatsUsed: 0,
      },
    ],
    {}
  );
  console.assert(txt2.includes("Court 2: OPEN"), "asText prints OPEN courts");

  // 14 couples, 8 courts => 7 matches + 1 OPEN
  const couples14 = Array.from({ length: 14 }, (_, i) => `C${i + 1}`);
  const courtNums = [1, 2, 3, 4, 5, 6, 7, 8];
  const playable = Math.min(courtNums.length, Math.floor(couples14.length / 2));
  const byeSlots = Math.max(0, couples14.length - playable * 2);
  const byesX = chooseByesFair(couples14, {}, byeSlots);
  const activeX = couples14.filter((c) => !byesX.includes(c));
  const played = buildMatchesAvoidRepeats(activeX, courtNums.slice(0, playable), new Set()).courtsOut;
  const open = courtNums
    .slice(playable)
    .map((c) => ({ court: c, team1: "", team2: "", isOpen: true }));
  console.assert([...played, ...open].length === 8 && open.length === 1, "shows OPEN court when extra courts");
}

try {
  if (typeof globalThis !== "undefined" && (globalThis as any).__RUN_PB_TESTS__) {
    runSelfTests();
  }
} catch {
  // ignore
}
