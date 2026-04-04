/**
 * Cadence Analyzer — Reply Like Me
 *
 * Analyzes Julian's messaging timing patterns per contact:
 *   - Response delay distribution (how fast he replies)
 *   - Burst patterns (single shot vs stream of consciousness)
 *   - Active hours/days (when he texts this person)
 *   - Conversation ending patterns
 *
 * All heuristic — no LLM calls. Uses message timestamps only.
 */

import type { RlmMessage } from "../types/index.js";

// ─── Types ────────────────────────────────────────────────────────

export interface CadenceAnalysisResult {
  avg_response_time_seconds: number | null;
  response_time_p50: number | null;
  response_time_p90: number | null;
  messages_per_burst: number;
  burst_threshold_seconds: number;
  single_vs_multi_ratio: number; // ratio of single-msg responses
  avg_burst_delay_seconds: number; // avg delay between msgs in a burst
  active_hours: Record<string, number>; // hour (0-23) → frequency
  active_days: Record<string, number>; // day (0=Sun, 6=Sat) → frequency
  hourly_patterns: HourlyPattern[];
  sample_size: number;
}

export interface HourlyPattern {
  day_of_week: number; // 0=Sun, 6=Sat
  hour_of_day: number; // 0-23
  avg_response_delay_seconds: number;
  median_response_delay_seconds: number;
  message_probability: number;
  avg_burst_length: number;
  sample_count: number;
}

interface MessagePair {
  incoming: RlmMessage;
  response: RlmMessage;
  delay_seconds: number;
}

interface Burst {
  messages: RlmMessage[];
  start_time: Date;
  end_time: Date;
}

// ─── Constants ─────────────────────────────────────────────────────

const DEFAULT_BURST_THRESHOLD_SECONDS = 120; // 2 min gap = same burst
const MAX_RESPONSE_DELAY_SECONDS = 86400; // cap at 24 hours
const MIN_RESPONSE_DELAY_SECONDS = 2; // ignore sub-2s (likely automated)

// ─── Response Delay Analysis ───────────────────────────────────────

function findResponsePairs(messages: RlmMessage[]): MessagePair[] {
  // Sort chronologically
  const sorted = [...messages].sort(
    (a, b) => new Date(a.date_utc).getTime() - new Date(b.date_utc).getTime()
  );

  const pairs: MessagePair[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const msg = sorted[i];
    // Find incoming message (not from Julian)
    if (msg.is_from_julian) continue;

    // Find Julian's next response
    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j];

      // If another incoming message before Julian responds, skip
      if (!next.is_from_julian) break;

      const delaySec =
        (new Date(next.date_utc).getTime() - new Date(msg.date_utc).getTime()) / 1000;

      // Filter out unreasonable delays
      if (delaySec >= MIN_RESPONSE_DELAY_SECONDS && delaySec <= MAX_RESPONSE_DELAY_SECONDS) {
        pairs.push({ incoming: msg, response: next, delay_seconds: delaySec });
      }
      break;
    }
  }

  return pairs;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Burst Analysis ────────────────────────────────────────────────

function findBursts(
  messages: RlmMessage[],
  thresholdSeconds: number = DEFAULT_BURST_THRESHOLD_SECONDS
): Burst[] {
  // Only Julian's outgoing messages, sorted chronologically
  const julianMsgs = messages
    .filter((m) => m.is_from_julian && !m.is_reaction)
    .sort((a, b) => new Date(a.date_utc).getTime() - new Date(b.date_utc).getTime());

  if (julianMsgs.length === 0) return [];

  const bursts: Burst[] = [];
  let currentBurst: RlmMessage[] = [julianMsgs[0]];

  for (let i = 1; i < julianMsgs.length; i++) {
    const prev = new Date(julianMsgs[i - 1].date_utc).getTime();
    const curr = new Date(julianMsgs[i].date_utc).getTime();
    const gap = (curr - prev) / 1000;

    if (gap <= thresholdSeconds) {
      currentBurst.push(julianMsgs[i]);
    } else {
      bursts.push({
        messages: currentBurst,
        start_time: new Date(currentBurst[0].date_utc),
        end_time: new Date(currentBurst[currentBurst.length - 1].date_utc),
      });
      currentBurst = [julianMsgs[i]];
    }
  }

  // Push last burst
  bursts.push({
    messages: currentBurst,
    start_time: new Date(currentBurst[0].date_utc),
    end_time: new Date(currentBurst[currentBurst.length - 1].date_utc),
  });

  return bursts;
}

function analyzeBursts(bursts: Burst[]): {
  messagesPerBurst: number;
  singleVsMultiRatio: number;
  avgBurstDelay: number;
} {
  if (bursts.length === 0) {
    return { messagesPerBurst: 1, singleVsMultiRatio: 1, avgBurstDelay: 0 };
  }

  const burstLengths = bursts.map((b) => b.messages.length);
  const messagesPerBurst =
    burstLengths.reduce((a, b) => a + b, 0) / bursts.length;

  const singleBursts = bursts.filter((b) => b.messages.length === 1).length;
  const singleVsMultiRatio = singleBursts / bursts.length;

  // Average delay between messages within multi-message bursts
  const intraBurstDelays: number[] = [];
  for (const burst of bursts) {
    if (burst.messages.length < 2) continue;
    for (let i = 1; i < burst.messages.length; i++) {
      const prev = new Date(burst.messages[i - 1].date_utc).getTime();
      const curr = new Date(burst.messages[i].date_utc).getTime();
      intraBurstDelays.push((curr - prev) / 1000);
    }
  }

  const avgBurstDelay =
    intraBurstDelays.length > 0
      ? intraBurstDelays.reduce((a, b) => a + b, 0) / intraBurstDelays.length
      : 0;

  return {
    messagesPerBurst: Math.round(messagesPerBurst * 100) / 100,
    singleVsMultiRatio: Math.round(singleVsMultiRatio * 1000) / 1000,
    avgBurstDelay: Math.round(avgBurstDelay * 10) / 10,
  };
}

// ─── Active Hours/Days ─────────────────────────────────────────────

function analyzeActivityPatterns(messages: RlmMessage[]): {
  activeHours: Record<string, number>;
  activeDays: Record<string, number>;
} {
  const julianMsgs = messages.filter((m) => m.is_from_julian && !m.is_reaction);

  const hourCounts: Record<number, number> = {};
  const dayCounts: Record<number, number> = {};

  for (const msg of julianMsgs) {
    const date = new Date(msg.date_utc);
    const hour = date.getUTCHours(); // TODO: convert to Pacific time
    const day = date.getUTCDay(); // 0=Sun, 6=Sat

    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
    dayCounts[day] = (dayCounts[day] ?? 0) + 1;
  }

  // Normalize to frequencies (0-1)
  const totalMsgs = julianMsgs.length || 1;

  const activeHours: Record<string, number> = {};
  for (let h = 0; h < 24; h++) {
    const count = hourCounts[h] ?? 0;
    if (count > 0) {
      activeHours[String(h)] = Math.round((count / totalMsgs) * 1000) / 1000;
    }
  }

  const activeDays: Record<string, number> = {};
  for (let d = 0; d < 7; d++) {
    const count = dayCounts[d] ?? 0;
    if (count > 0) {
      activeDays[String(d)] = Math.round((count / totalMsgs) * 1000) / 1000;
    }
  }

  return { activeHours, activeDays };
}

// ─── Hourly Patterns (for rlm_cadence_patterns table) ──────────────

function buildHourlyPatterns(
  messages: RlmMessage[],
  bursts: Burst[]
): HourlyPattern[] {
  const pairs = findResponsePairs(messages);
  const patterns: HourlyPattern[] = [];

  // Group pairs by (day_of_week, hour_of_day)
  const grouped: Record<string, { delays: number[]; burstLengths: number[]; count: number }> = {};

  for (const pair of pairs) {
    const date = new Date(pair.response.date_utc);
    const day = date.getUTCDay();
    const hour = date.getUTCHours();
    const key = `${day}-${hour}`;

    if (!grouped[key]) {
      grouped[key] = { delays: [], burstLengths: [], count: 0 };
    }
    grouped[key].delays.push(pair.delay_seconds);
    grouped[key].count++;
  }

  // Add burst lengths to hour buckets
  for (const burst of bursts) {
    const date = burst.start_time;
    const day = date.getUTCDay();
    const hour = date.getUTCHours();
    const key = `${day}-${hour}`;

    if (!grouped[key]) {
      grouped[key] = { delays: [], burstLengths: [], count: 0 };
    }
    grouped[key].burstLengths.push(burst.messages.length);
  }

  // Total Julian messages for probability calc
  const totalJulianMsgs = messages.filter((m) => m.is_from_julian && !m.is_reaction).length || 1;

  for (const [key, data] of Object.entries(grouped)) {
    const [dayStr, hourStr] = key.split("-");
    const delays = data.delays;

    patterns.push({
      day_of_week: parseInt(dayStr),
      hour_of_day: parseInt(hourStr),
      avg_response_delay_seconds:
        delays.length > 0
          ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10
          : 0,
      median_response_delay_seconds:
        delays.length > 0 ? Math.round(percentile(delays, 50) * 10) / 10 : 0,
      message_probability: Math.round((data.count / totalJulianMsgs) * 10000) / 10000,
      avg_burst_length:
        data.burstLengths.length > 0
          ? Math.round(
              (data.burstLengths.reduce((a, b) => a + b, 0) / data.burstLengths.length) * 100
            ) / 100
          : 1,
      sample_count: data.count,
    });
  }

  return patterns.sort((a, b) =>
    a.day_of_week !== b.day_of_week
      ? a.day_of_week - b.day_of_week
      : a.hour_of_day - b.hour_of_day
  );
}

// ─── Main Analysis Function ────────────────────────────────────────

export function analyzeCadence(messages: RlmMessage[]): CadenceAnalysisResult {
  if (messages.length === 0) {
    return emptyCadenceResult();
  }

  // Response delay analysis
  const pairs = findResponsePairs(messages);
  const delays = pairs.map((p) => p.delay_seconds);

  const avgDelay =
    delays.length > 0 ? delays.reduce((a, b) => a + b, 0) / delays.length : null;

  // Burst analysis
  const bursts = findBursts(messages);
  const burstStats = analyzeBursts(bursts);

  // Activity patterns
  const { activeHours, activeDays } = analyzeActivityPatterns(messages);

  // Hourly patterns for cadence table
  const hourlyPatterns = buildHourlyPatterns(messages, bursts);

  return {
    avg_response_time_seconds: avgDelay ? Math.round(avgDelay) : null,
    response_time_p50: delays.length > 0 ? Math.round(percentile(delays, 50)) : null,
    response_time_p90: delays.length > 0 ? Math.round(percentile(delays, 90)) : null,
    messages_per_burst: burstStats.messagesPerBurst,
    burst_threshold_seconds: DEFAULT_BURST_THRESHOLD_SECONDS,
    single_vs_multi_ratio: burstStats.singleVsMultiRatio,
    avg_burst_delay_seconds: burstStats.avgBurstDelay,
    active_hours: activeHours,
    active_days: activeDays,
    hourly_patterns: hourlyPatterns,
    sample_size: messages.length,
  };
}

// ─── Empty result ─────────────────────────────────────────────────

function emptyCadenceResult(): CadenceAnalysisResult {
  return {
    avg_response_time_seconds: null,
    response_time_p50: null,
    response_time_p90: null,
    messages_per_burst: 1,
    burst_threshold_seconds: DEFAULT_BURST_THRESHOLD_SECONDS,
    single_vs_multi_ratio: 1,
    avg_burst_delay_seconds: 0,
    active_hours: {},
    active_days: {},
    hourly_patterns: [],
    sample_size: 0,
  };
}
