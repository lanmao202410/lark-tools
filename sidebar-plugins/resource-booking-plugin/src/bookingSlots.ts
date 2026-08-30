export type BookingSlotRange = {
  start: number;
  end: number;
};

export type BookingScheduleMode = '小时' | '天';

export type NamedField = {
  id: string;
  name: string;
};

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function timestampFor(dateText: string, minutes: number): number {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const date = new Date(`${dateText}T00:00:00`);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

export function buildSlotRanges(dateText: string, workStart: string, workEnd: string, slotMinutes: number): BookingSlotRange[] {
  const startMinutes = timeToMinutes(workStart);
  const endMinutes = timeToMinutes(workEnd);
  if (!dateText || startMinutes >= endMinutes || slotMinutes <= 0) return [];

  const slots: BookingSlotRange[] = [];
  for (let cursor = startMinutes; cursor + slotMinutes <= endMinutes; cursor += slotMinutes) {
    slots.push({
      start: timestampFor(dateText, cursor),
      end: timestampFor(dateText, cursor + slotMinutes),
    });
  }

  return slots;
}

export function mergeAdjacentSlots(slots: BookingSlotRange[]): BookingSlotRange[] {
  const sortedSlots = [...slots].sort((slotA, slotB) => slotA.start - slotB.start || slotA.end - slotB.end);
  const mergedSlots: BookingSlotRange[] = [];

  for (const slot of sortedSlots) {
    const latest = mergedSlots[mergedSlots.length - 1];
    if (latest && slot.start <= latest.end) {
      latest.end = Math.max(latest.end, slot.end);
      continue;
    }

    mergedSlots.push({ ...slot });
  }

  return mergedSlots;
}

export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function endOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function inclusiveDaysOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startOfLocalDay(startA) <= endOfLocalDay(endB) && startOfLocalDay(startB) <= endOfLocalDay(endA);
}

export function resolveBookingDateFields(mode: BookingScheduleMode, range: BookingSlotRange): { startDate: number; endDate: number } | null {
  if (mode !== '天') return null;

  return {
    startDate: startOfLocalDay(range.start),
    endDate: startOfLocalDay(range.end),
  };
}

export function resolveBookingTimeFields(mode: BookingScheduleMode, range: BookingSlotRange): { startTime: number; endTime: number } | null {
  if (mode !== '小时') return null;

  return {
    startTime: range.start,
    endTime: range.end,
  };
}

export function resolveFieldByName<T extends NamedField>(fields: T[], names: string[], excludedKeywords: string[] = []): T | undefined {
  const availableFields = fields.filter((field) => !excludedKeywords.some((keyword) => field.name.includes(keyword)));

  return (
    availableFields.find((field) => names.some((name) => field.name === name)) ??
    availableFields.find((field) => names.some((name) => field.name.includes(name)))
  );
}

export function resolveResourceOptions(configuredResources: string[], fallbackResources: string[], hasResourceConfig = false): string[] {
  const enabledConfiguredResources = Array.from(new Set(configuredResources.filter(Boolean)));
  if (hasResourceConfig || enabledConfiguredResources.length) {
    return enabledConfiguredResources;
  }

  return Array.from(new Set(fallbackResources.filter(Boolean)));
}

export function resolveBookingTableId(savedTableId: string, activeTableId: string, availableTableIds: string[]): string {
  if (savedTableId && availableTableIds.includes(savedTableId)) {
    return savedTableId;
  }

  return activeTableId;
}
