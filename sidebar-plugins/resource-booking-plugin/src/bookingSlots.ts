export type BookingSlotRange = {
  start: number;
  end: number;
};

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

export function resolveResourceOptions(configuredResources: string[], fallbackResources: string[]): string[] {
  const enabledConfiguredResources = Array.from(new Set(configuredResources.filter(Boolean)));
  if (enabledConfiguredResources.length) {
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
