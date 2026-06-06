import { getDb } from "../../persistence/database.js";
import { notificationQueue, notificationEvents } from "../../persistence/schema.js";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";

export interface DeliveryTimeMetrics {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  sampleCount: number;
}

export interface RetryPressureMetrics {
  totalSent: number;
  firstTrySuccess: number;
  retriedSuccess: number;
  retryRate: number;
  avgRetriesPerNotification: number;
}

export interface DeadLetterRateMetrics {
  totalTerminal: number;
  sentCount: number;
  deadCount: number;
  deadLetterRate: number;
}

export interface QueueLagMetrics {
  pendingCount: number;
  retryingCount: number;
  maxLagMs: number;
  avgLagMs: number;
  p95LagMs: number;
}

export interface ChannelBreakdown {
  channel: string;
  total: number;
  sent: number;
  dead: number;
  retrying: number;
  pending: number;
}

export interface NotificationMetrics {
  deliveryTimes: DeliveryTimeMetrics;
  retryPressure: RetryPressureMetrics;
  deadLetterRate: DeadLetterRateMetrics;
  queueLag: QueueLagMetrics;
  channelBreakdown: ChannelBreakdown[];
  timeWindow: {
    windowStart: string;
    windowEnd: string;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function getNotificationMetrics(
  windowStart?: string,
  windowEnd?: string,
): NotificationMetrics {
  const endIso = windowEnd ?? new Date().toISOString();
  const startIso = windowStart ?? new Date(Date.now() - 86400000).toISOString();
  const nowMs = Date.now();
  const windowSizeMs = new Date(endIso).getTime() - new Date(startIso).getTime();

  const db = getDb();

  const queueRows = db
    .select()
    .from(notificationQueue)
    .where(
      and(
        gte(notificationQueue.createdAt, startIso),
        lte(notificationQueue.createdAt, endIso),
      ),
    )
    .all() as Array<{
      id: string;
      channel: string;
      status: string;
      retryCount: number;
      createdAt: string;
      updatedAt: string;
      lastError: string | null;
      nextRetryAt: string | null;
      alertJson: string;
      idempotencyKey: string;
      maxRetries: number;
    }>;

  const ids = queueRows.map((r) => r.id);
  const eventRows: Array<{
    id: string;
    notificationId: string;
    channel: string;
    status: string;
    error: string | null;
    attemptedAt: string;
  }> = ids.length > 0
    ? (db
        .select()
        .from(notificationEvents)
        .where(inArray(notificationEvents.notificationId, ids))
        .all() as typeof eventRows)
    : [];

  const eventsByNotif = new Map<string, typeof eventRows>();
  for (const ev of eventRows) {
    const arr = eventsByNotif.get(ev.notificationId);
    if (arr) arr.push(ev);
    else eventsByNotif.set(ev.notificationId, [ev]);
  }

  const idSet = new Set(ids);

  const sentIds = new Set<string>();
  const deadIds = new Set<string>();
  const deliveryDiffs: number[] = [];

  for (const row of queueRows) {
    if (row.status === "sent") {
      sentIds.add(row.id);
      const evs = eventsByNotif.get(row.id) ?? [];
      const sentEvent = evs.find((e) => e.status === "sent");
      if (sentEvent) {
        const diffMs = new Date(sentEvent.attemptedAt).getTime() - new Date(row.createdAt).getTime();
        deliveryDiffs.push(diffMs);
      }
    } else if (row.status === "dead") {
      deadIds.add(row.id);
    }
  }

  deliveryDiffs.sort((a, b) => a - b);
  const deliveryTimes: DeliveryTimeMetrics = {
    p50Ms: percentile(deliveryDiffs, 0.5),
    p95Ms: percentile(deliveryDiffs, 0.95),
    p99Ms: percentile(deliveryDiffs, 0.99),
    avgMs: deliveryDiffs.length > 0
      ? Math.round(deliveryDiffs.reduce((a, b) => a + b, 0) / deliveryDiffs.length)
      : 0,
    minMs: deliveryDiffs.length > 0 ? deliveryDiffs[0] : 0,
    maxMs: deliveryDiffs.length > 0 ? deliveryDiffs[deliveryDiffs.length - 1] : 0,
    sampleCount: deliveryDiffs.length,
  };

  let firstTrySuccess = 0;
  let retriedSuccess = 0;
  let totalRetryCountSum = 0;

  for (const sid of sentIds) {
    const evs = eventsByNotif.get(sid) ?? [];
    const hasRetrying = evs.some((e) => e.status === "retrying");
    if (hasRetrying) retriedSuccess++;
    else firstTrySuccess++;
    const row = queueRows.find((r) => r.id === sid);
    if (row) totalRetryCountSum += row.retryCount;
  }

  const totalSent = sentIds.size;
  const retryPressure: RetryPressureMetrics = {
    totalSent,
    firstTrySuccess,
    retriedSuccess,
    retryRate: totalSent > 0 ? retriedSuccess / totalSent : 0,
    avgRetriesPerNotification: totalSent > 0
      ? Math.round((totalRetryCountSum / totalSent) * 100) / 100
      : 0,
  };

  const totalTerminal = sentIds.size + deadIds.size;
  const deadLetterRate: DeadLetterRateMetrics = {
    totalTerminal,
    sentCount: sentIds.size,
    deadCount: deadIds.size,
    deadLetterRate: totalTerminal > 0 ? deadIds.size / totalTerminal : 0,
  };

  const pendingLags: number[] = [];
  let pendingCount = 0;
  let retryingCount = 0;

  for (const row of queueRows) {
    if (row.status === "pending") {
      pendingCount++;
      const lag = Math.min(nowMs - new Date(row.createdAt).getTime(), windowSizeMs);
      pendingLags.push(lag);
    } else if (row.status === "retrying") {
      retryingCount++;
      const lag = Math.min(nowMs - new Date(row.createdAt).getTime(), windowSizeMs);
      pendingLags.push(lag);
    }
  }

  pendingLags.sort((a, b) => a - b);
  const queueLag: QueueLagMetrics = {
    pendingCount,
    retryingCount,
    maxLagMs: pendingLags.length > 0 ? pendingLags[pendingLags.length - 1] : 0,
    avgLagMs: pendingLags.length > 0
      ? Math.round(pendingLags.reduce((a, b) => a + b, 0) / pendingLags.length)
      : 0,
    p95LagMs: percentile(pendingLags, 0.95),
  };

  const channelMap = new Map<string, { total: number; sent: number; dead: number; retrying: number; pending: number }>();
  for (const row of queueRows) {
    let acc = channelMap.get(row.channel);
    if (!acc) {
      acc = { total: 0, sent: 0, dead: 0, retrying: 0, pending: 0 };
      channelMap.set(row.channel, acc);
    }
    acc.total++;
    if (row.status === "sent") acc.sent++;
    else if (row.status === "dead") acc.dead++;
    else if (row.status === "retrying") acc.retrying++;
    else if (row.status === "pending") acc.pending++;
  }

  const channelBreakdown: ChannelBreakdown[] = [...channelMap.entries()]
    .map(([channel, counts]) => ({ channel, ...counts }))
    .sort((a, b) => b.total - a.total);

  return {
    deliveryTimes,
    retryPressure,
    deadLetterRate,
    queueLag,
    channelBreakdown,
    timeWindow: { windowStart: startIso, windowEnd: endIso },
  };
}
