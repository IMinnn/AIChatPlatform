import { NextRequest, NextResponse } from "next/server";
import { readState } from "@/lib/fs-db";
import { TokenPricing, TokenUsageBreakdown, TokenUsageRecord } from "@/lib/types";

function createEmptyUsage(source: TokenUsageBreakdown["source"] = "provider"): TokenUsageBreakdown {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheCreationTokens: 0,
    cacheHitTokens: 0,
    source
  };
}

function addUsage(current: TokenUsageBreakdown, next: TokenUsageBreakdown) {
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    cacheCreationTokens: current.cacheCreationTokens + next.cacheCreationTokens,
    cacheHitTokens: current.cacheHitTokens + next.cacheHitTokens,
    source: current.source
  };
}

function calculateCost(usage: TokenUsageBreakdown, pricing: TokenPricing) {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion +
    (usage.cacheCreationTokens / 1_000_000) * pricing.cacheCreationPerMillion +
    (usage.cacheHitTokens / 1_000_000) * pricing.cacheHitPerMillion
  );
}

function parseDateBoundary(value: string, endOfDay = false) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).getTime();
}

function inRange(record: TokenUsageRecord, filter: { mode: "range" | "all"; startDate: string; endDate: string }) {
  if (filter.mode === "all") {
    return true;
  }
  const recordTime = new Date(record.createdAt).getTime();
  const startTime = parseDateBoundary(filter.startDate);
  const endTime = parseDateBoundary(filter.endDate, true);
  return recordTime >= startTime && recordTime <= endTime;
}

export async function GET(request: NextRequest) {
  const today = new Date();
  const defaultEndDate = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, "0")}-${`${today.getDate()}`.padStart(2, "0")}`;
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - 6);
  const defaultStartDate = `${defaultStart.getFullYear()}-${`${defaultStart.getMonth() + 1}`.padStart(2, "0")}-${`${defaultStart.getDate()}`.padStart(2, "0")}`;
  const mode = request.nextUrl.searchParams.get("mode") === "all" ? "all" : "range";
  const startDate = request.nextUrl.searchParams.get("startDate") ?? defaultStartDate;
  const endDate = request.nextUrl.searchParams.get("endDate") ?? defaultEndDate;
  const state = await readState();
  const pricing = state.settings.tokenPricing;
  const records = [...state.usageRecords]
    .filter((record) => inRange(record, { mode, startDate, endDate }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const summary = records.reduce(
    (acc, record) => addUsage(acc, record.usage),
    createEmptyUsage("provider")
  );

  const chartMap = new Map<
    string,
    {
      date: string;
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
    }
  >();
  const conversationMap = new Map<
    string,
    {
      conversationId: string;
      conversationTitle: string;
      requests: number;
      usage: TokenUsageBreakdown;
      lastUsedAt: string;
    }
  >();

  for (const record of records) {
    const date = record.createdAt.slice(0, 10);
    const chartItem = chartMap.get(date) ?? {
      date,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0
    };
    chartItem.totalTokens += record.usage.totalTokens;
    chartItem.inputTokens += record.usage.inputTokens;
    chartItem.outputTokens += record.usage.outputTokens;
    chartMap.set(date, chartItem);

    const conversationItem = conversationMap.get(record.conversationId) ?? {
      conversationId: record.conversationId,
      conversationTitle: record.conversationTitle,
      requests: 0,
      usage: createEmptyUsage("provider"),
      lastUsedAt: record.createdAt
    };
    conversationItem.requests += 1;
    conversationItem.usage = addUsage(conversationItem.usage, record.usage);
    conversationItem.lastUsedAt = record.createdAt > conversationItem.lastUsedAt ? record.createdAt : conversationItem.lastUsedAt;
    conversationMap.set(record.conversationId, conversationItem);
  }

  return NextResponse.json({
    filter: {
      mode,
      startDate: mode === "all" ? null : startDate,
      endDate: mode === "all" ? null : endDate
    },
    pricing,
    summary: {
      ...summary,
      requests: records.length,
      totalCost: calculateCost(summary, pricing)
    },
    chart: [...chartMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    conversations: [...conversationMap.values()]
      .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime())
      .map((item) => ({
        ...item,
        totalCost: calculateCost(item.usage, pricing)
      })),
    records: records.slice(0, 60).map((record) => ({
      ...record,
      totalCost: calculateCost(record.usage, pricing)
    }))
  });
}
