import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type BookingScheduleMode,
  type BookingSlotRange,
  buildSlotRanges,
  endOfLocalDay,
  inclusiveDaysOverlap,
  mergeAdjacentSlots,
  resolveBookingDateFields,
  resolveBookingTableId,
  resolveResourceOptions,
  startOfLocalDay,
} from './bookingSlots';
import {
  bitable,
  FieldType,
  type IDateTimeField,
  type IFieldMeta,
  type ISingleSelectField,
  type ITable,
  type ITableMeta,
  type ITextField,
  type IUserField,
} from '@lark-base-open/js-sdk';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  RefreshCw,
  Settings2,
  TimerReset,
} from 'lucide-react';

type LoadState = 'idle' | 'loading' | 'success' | 'error';
type ClaimState = 'idle' | 'claiming' | 'success' | 'error';
type ScheduleMode = BookingScheduleMode;
type ActiveTab = 'booking' | 'settings';

type FieldOption = {
  id: string;
  name: string;
  type: FieldType;
};

type Booking = {
  recordId: string;
  resource: string;
  scheduleMode: ScheduleMode;
  start: number;
  end: number;
  startDate: number;
  endDate: number;
  status: string;
};

type Slot = {
  label: string;
  start: number;
  end: number;
  occupied: boolean;
};

type PluginConfig = {
  bookingTableId: string;
  resourceFieldId: string;
  scheduleModeFieldId: string;
  startDateFieldId: string;
  endDateFieldId: string;
  startFieldId: string;
  endFieldId: string;
  userFieldId: string;
  statusFieldId: string;
  selectedResource: string;
  selectedDate: string;
  workStart: string;
  workEnd: string;
  slotMinutes: number;
};

type ContextState = {
  tableName: string;
  tableId: string;
  tableMetas: ITableMeta[];
  fields: IFieldMeta[];
  records: Booking[];
  resourceConfigs: ResourceConfig[];
  resourceValues: string[];
  currentUserId: string;
};

type ResourceConfig = {
  id: string;
  name: string;
  resourceType: string;
  scheduleMode: ScheduleMode;
  enabled: boolean;
  workStart: string;
  workEnd: string;
  slotMinutes: number;
};

const CONFIG_KEY = 'resource-booking-plugin-config-v2';

function todayText() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultConfig(): PluginConfig {
  return {
    bookingTableId: '',
    resourceFieldId: '',
    scheduleModeFieldId: '',
    startDateFieldId: '',
    endDateFieldId: '',
    startFieldId: '',
    endFieldId: '',
    userFieldId: '',
    statusFieldId: '',
    selectedResource: '',
    selectedDate: todayText(),
    workStart: '08:00',
    workEnd: '20:00',
    slotMinutes: 60,
  };
}

function loadSavedConfig(): PluginConfig {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultConfig();
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {
    return defaultConfig();
  }
}

function saveConfig(config: PluginConfig) {
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '未知错误，请确认插件是在飞书多维表格侧边栏中运行。';
}

function cellToText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => cellToText(item))
      .filter(Boolean)
      .join('、');
  }
  if (typeof value === 'object') {
    const item = value as { text?: string; name?: string; id?: string };
    return item.text ?? item.name ?? item.id ?? '';
  }
  return '';
}

function getSelectOptions(field: IFieldMeta): string[] {
  const rawOptions = ((field as any).property?.options ?? (field as any).options ?? []) as Array<{
    name?: string;
    text?: string;
  }>;
  return rawOptions.map((option) => option.name ?? option.text ?? '').filter(Boolean);
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function formatSlotTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dateTextFromTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateLabel(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function dayTimestampFor(dateText: string) {
  return new Date(`${dateText}T00:00:00`).getTime();
}

function monthTextFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(monthText: string, offset: number) {
  const [year, month] = monthText.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return monthTextFromDate(date);
}

function calendarDaysForMonth(monthText: string) {
  const [year, month] = monthText.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const cursor = new Date(firstDay);
  cursor.setDate(cursor.getDate() - cursor.getDay());

  return Array.from({ length: 42 }, () => {
    const timestamp = cursor.getTime();
    const inMonth = cursor.getMonth() === firstDay.getMonth();
    const label = String(cursor.getDate());
    cursor.setDate(cursor.getDate() + 1);
    return { timestamp, inMonth, label };
  });
}

function sameDay(timestamp: number, dateText: string) {
  if (!timestamp) return false;
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}` === dateText;
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && startB < endA;
}

function slotKey(resource: string, dateText: string, start: number, end: number) {
  return `${resource}::${dateText}::${start}::${end}`;
}

function fieldToOption(field: IFieldMeta): FieldOption {
  return { id: field.id, name: field.name, type: field.type };
}

function pickField(fields: IFieldMeta[], type: FieldType, keywords: string[]) {
  return (
    fields.find((field) => field.type === type && keywords.some((keyword) => field.name.includes(keyword))) ??
    fields.find((field) => field.type === type)
  )?.id;
}

function findFieldByName(fields: IFieldMeta[], names: string[]) {
  return fields.find((field) => names.some((name) => field.name === name || field.name.includes(name)));
}

function timeTextFromCell(value: unknown, fallback: string) {
  const timestamp = Number(value);
  if (!timestamp) return fallback;
  return formatSlotTime(timestamp);
}

function parseSlotMinutes(value: unknown, fallback: number) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  return minutes < 5 ? minutes * 60 : minutes;
}

function isEnabledValue(value: unknown) {
  const text = cellToText(value).trim();
  return !text || ['是', '启用', '可预约', 'true', '1', 'yes', 'Y'].includes(text);
}

function normalizeScheduleMode(value: unknown): ScheduleMode {
  return cellToText(value).includes('天') ? '天' : '小时';
}

async function setFieldValue(table: ITable, field: IFieldMeta | undefined, recordId: string, value: string | number, currentUserId?: string) {
  if (!field) return;

  if (field.type === FieldType.Text) {
    const textField = await table.getField<ITextField>(field.id);
    await textField.setValue(recordId, String(value));
    return;
  }

  if (field.type === FieldType.SingleSelect) {
    const selectField = await table.getField<ISingleSelectField>(field.id);
    const meta = await selectField.getMeta();
    const optionNames = getSelectOptions(meta);
    if (!optionNames.includes(String(value))) {
      await selectField.addOption(String(value));
    }
    await selectField.setValue(recordId, String(value));
    return;
  }

  if (field.type === FieldType.DateTime) {
    const dateField = await table.getField<IDateTimeField>(field.id);
    await dateField.setValue(recordId, Number(value));
    return;
  }

  if (field.type === FieldType.User && currentUserId) {
    const userField = await table.getField<IUserField>(field.id);
    await userField.setValue(recordId, [{ id: currentUserId }]);
  }
}

export function App() {
  const [config, setConfig] = useState<PluginConfig>(() => loadSavedConfig());
  const [draftConfig, setDraftConfig] = useState<PluginConfig>(() => loadSavedConfig());
  const [draftFields, setDraftFields] = useState<IFieldMeta[]>([]);
  const [configSavedNotice, setConfigSavedNotice] = useState('');
  const [context, setContext] = useState<ContextState | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadState>('idle');
  const [claimStatus, setClaimStatus] = useState<ClaimState>('idle');
  const [message, setMessage] = useState('');
  const [localClaimedSlots, setLocalClaimedSlots] = useState<Set<string>>(() => new Set());
  const [selectedSlotKeys, setSelectedSlotKeys] = useState<Set<string>>(() => new Set());
  const [calendarMonth, setCalendarMonth] = useState(todayText().slice(0, 7));
  const [daySelectionStart, setDaySelectionStart] = useState<number | null>(null);
  const [daySelectionEnd, setDaySelectionEnd] = useState<number | null>(null);
  const [isDraggingDays, setIsDraggingDays] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('booking');
  const pendingSlotKeysRef = useRef<Set<string>>(new Set());

  const fieldMap = useMemo(() => new Map(context?.fields.map((field) => [field.id, field]) ?? []), [context]);
  const draftFieldMap = useMemo(() => new Map(draftFields.map((field) => [field.id, field])), [draftFields]);
  const resourceField = fieldMap.get(config.resourceFieldId);
  const statusField = fieldMap.get(config.statusFieldId);

  const resourceFieldOptions = useMemo(() => {
    if (!resourceField || resourceField.type !== FieldType.SingleSelect) return [];
    return getSelectOptions(resourceField);
  }, [resourceField]);

  const resourceOptions = useMemo(() => {
    const configuredResources = context?.resourceConfigs.filter((resource) => resource.enabled).map((resource) => resource.name) ?? [];
    const fallbackResources = [...resourceFieldOptions, ...(context?.resourceValues ?? [])];
    return resolveResourceOptions(configuredResources, fallbackResources, Boolean(context?.resourceConfigs.length));
  }, [context?.resourceConfigs, context?.resourceValues, resourceFieldOptions]);

  const selectedResourceConfig = useMemo(() => {
    return context?.resourceConfigs.find((resource) => resource.name === config.selectedResource && resource.enabled) ?? null;
  }, [config.selectedResource, context?.resourceConfigs]);

  const activeScheduleMode = selectedResourceConfig?.scheduleMode ?? '小时';
  const activeWorkStart = selectedResourceConfig?.workStart ?? config.workStart;
  const activeWorkEnd = selectedResourceConfig?.workEnd ?? config.workEnd;
  const activeSlotMinutes = selectedResourceConfig?.slotMinutes ?? config.slotMinutes;

  const bookingsForCurrentResource = useMemo(() => {
    return (context?.records ?? []).filter(
      (record) =>
        record.resource === config.selectedResource &&
        !record.status.includes('取消'),
    );
  }, [config.selectedResource, context?.records]);

  const hourBookingsForCurrentDate = useMemo(() => {
    return bookingsForCurrentResource.filter((record) => record.scheduleMode === '小时' && sameDay(record.start, config.selectedDate));
  }, [bookingsForCurrentResource, config.selectedDate]);

  const calendarDays = useMemo(() => calendarDaysForMonth(calendarMonth), [calendarMonth]);

  const slots = useMemo(() => {
    if (activeScheduleMode !== '小时') return [];
    if (!config.selectedDate || !config.selectedResource) return [];

    return buildSlotRanges(config.selectedDate, activeWorkStart, activeWorkEnd, activeSlotMinutes).map((range) => ({
        label: `${formatSlotTime(range.start)}-${formatSlotTime(range.end)}`,
        start: range.start,
        end: range.end,
        occupied:
          localClaimedSlots.has(slotKey(config.selectedResource, config.selectedDate, range.start, range.end)) ||
          hourBookingsForCurrentDate.some((booking) => intervalsOverlap(range.start, range.end, booking.start, booking.end)),
      }));
  }, [
    activeScheduleMode,
    activeSlotMinutes,
    activeWorkEnd,
    activeWorkStart,
    config.selectedDate,
    config.selectedResource,
    hourBookingsForCurrentDate,
    localClaimedSlots,
  ]);

  const availableSlots = slots.filter((slot) => !slot.occupied);
  const occupiedSlots = slots.length - availableSlots.length;
  const selectedSlots = useMemo(
    () => slots.filter((slot) => selectedSlotKeys.has(slotKey(config.selectedResource, config.selectedDate, slot.start, slot.end)) && !slot.occupied),
    [config.selectedDate, config.selectedResource, selectedSlotKeys, slots],
  );
  const selectedHourRanges = useMemo<BookingSlotRange[]>(
    () => mergeAdjacentSlots(selectedSlots.map((slot) => ({ start: slot.start, end: slot.end }))),
    [selectedSlots],
  );
  const selectedDayRange = useMemo<BookingSlotRange | null>(() => {
    if (daySelectionStart === null || daySelectionEnd === null) return null;
    return {
      start: Math.min(daySelectionStart, daySelectionEnd),
      end: Math.max(daySelectionStart, daySelectionEnd),
    };
  }, [daySelectionEnd, daySelectionStart]);
  const bookingRanges = activeScheduleMode === '天' ? (selectedDayRange ? [selectedDayRange] : []) : selectedHourRanges;
  const selectedRangeText =
    activeScheduleMode === '天'
      ? bookingRanges.map((range) => `${dateLabel(range.start)}-${dateLabel(range.end)}`).join('、')
      : bookingRanges.map((range) => `${formatSlotTime(range.start)}-${formatSlotTime(range.end)}`).join('、');
  const selectedCount =
    activeScheduleMode === '天' && selectedDayRange
      ? Math.round((selectedDayRange.end - selectedDayRange.start) / 86400000) + 1
      : selectedSlots.length;
  const calendarOccupiedDays = useMemo(
    () => (activeScheduleMode === '天' ? calendarDays.filter((day) => day.inMonth && isDayOccupied(day.timestamp)).length : 0),
    [activeScheduleMode, bookingsForCurrentResource, calendarDays, config.selectedResource, localClaimedSlots],
  );
  const calendarAvailableDays = useMemo(
    () => (activeScheduleMode === '天' ? calendarDays.filter((day) => day.inMonth && !isDayOccupied(day.timestamp)).length : 0),
    [activeScheduleMode, bookingsForCurrentResource, calendarDays, config.selectedResource, localClaimedSlots],
  );

  useEffect(() => {
    loadContext();
  }, []);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  useEffect(() => {
    setDraftConfig(config);
  }, [config.bookingTableId]);

  useEffect(() => {
    let disposed = false;

    async function loadDraftTableFields() {
      try {
        const table = draftConfig.bookingTableId
          ? await bitable.base.getTableById(draftConfig.bookingTableId)
          : await bitable.base.getActiveTable();
        const tableMeta = await table.getMeta();
        const fields = await table.getFieldMetaList();
        if (!disposed) {
          setDraftFields(fields);
          setDraftConfig((current) => {
            if ((current.bookingTableId || tableMeta.id) !== tableMeta.id) return current;
            return normalizeConfig(fields, { ...current, bookingTableId: tableMeta.id });
          });
        }
      } catch {
        if (!disposed) setDraftFields([]);
      }
    }

    loadDraftTableFields();
    return () => {
      disposed = true;
    };
  }, [draftConfig.bookingTableId]);

  useEffect(() => {
    if (resourceOptions.length && !resourceOptions.includes(config.selectedResource)) {
      updateConfig({ selectedResource: resourceOptions[0] });
    }
  }, [config.selectedResource, resourceOptions]);

  useEffect(() => {
    setSelectedSlotKeys(new Set());
    setDaySelectionStart(null);
    setDaySelectionEnd(null);
  }, [activeScheduleMode, config.selectedDate, config.selectedResource, config.workStart, config.workEnd, config.slotMinutes]);

  useEffect(() => {
    let disposed = false;
    let refreshTimer = window.setTimeout(() => undefined, 0);
    let cleanups: Array<() => void> = [];

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        loadContext({ keepMessage: true, silent: true });
      }, 450);
    };

    const bookingTableId = config.bookingTableId;

    const tablePromise = bookingTableId
      ? bitable.base.getTableById(bookingTableId)
      : bitable.base.getActiveTable();

    tablePromise
      .then((table) => {
        if (disposed) return;
        cleanups = [table.onRecordAdd(scheduleRefresh), table.onRecordDelete(scheduleRefresh), table.onRecordModify(scheduleRefresh)];
      })
      .catch(() => undefined);

    bitable.base
      .getTableByName('资源配置表')
      .then((table) => {
        if (disposed) return;
        cleanups.push(table.onRecordAdd(scheduleRefresh), table.onRecordDelete(scheduleRefresh), table.onRecordModify(scheduleRefresh));
      })
      .catch(() => undefined);

    const intervalId = window.setInterval(() => {
      loadContext({ keepMessage: true, silent: true });
    }, 10000);

    return () => {
      disposed = true;
      window.clearTimeout(refreshTimer);
      window.clearInterval(intervalId);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [
    config.bookingTableId,
    config.resourceFieldId,
    config.startFieldId,
    config.endFieldId,
    config.statusFieldId,
    config.userFieldId,
  ]);

  async function loadResourceConfigs(): Promise<ResourceConfig[]> {
    try {
      const resourceTable = await bitable.base.getTableByName('资源配置表');
      const resourceFields = await resourceTable.getFieldMetaList();
      const nameField = findFieldByName(resourceFields, ['资源名称', '资源']);
      const typeField = findFieldByName(resourceFields, ['资源类型', '类型']);
      const modeField = findFieldByName(resourceFields, ['调度类型', '预约类型']);
      const enabledField = findFieldByName(resourceFields, ['是否启用', '是否可预约', '启用']);
      const workStartField = findFieldByName(resourceFields, ['可用开始时间', '开始时间']);
      const workEndField = findFieldByName(resourceFields, ['可用结束时间', '结束时间']);
      const slotField = findFieldByName(resourceFields, ['时间粒度', '粒度']);

      if (!nameField) return [];

      const recordIds = await resourceTable.getRecordIdList();
      const configs: ResourceConfig[] = [];

      for (const recordId of recordIds) {
        const name = cellToText(await resourceTable.getCellValue(nameField.id, recordId));
        if (!name) continue;

        const scheduleMode = modeField ? normalizeScheduleMode(await resourceTable.getCellValue(modeField.id, recordId)) : '小时';
        const enabled = enabledField ? isEnabledValue(await resourceTable.getCellValue(enabledField.id, recordId)) : true;
        const workStart = workStartField ? timeTextFromCell(await resourceTable.getCellValue(workStartField.id, recordId), config.workStart) : config.workStart;
        const workEnd = workEndField ? timeTextFromCell(await resourceTable.getCellValue(workEndField.id, recordId), config.workEnd) : config.workEnd;
        const slotMinutes = slotField ? parseSlotMinutes(await resourceTable.getCellValue(slotField.id, recordId), config.slotMinutes) : config.slotMinutes;

        configs.push({
          id: recordId,
          name,
          resourceType: typeField ? cellToText(await resourceTable.getCellValue(typeField.id, recordId)) : '',
          scheduleMode,
          enabled,
          workStart,
          workEnd,
          slotMinutes,
        });
      }

      return configs;
    } catch {
      return [];
    }
  }

  async function loadContext(options: { keepMessage?: boolean; silent?: boolean } = {}) {
    if (!options.silent) setLoadStatus('loading');
    if (!options.keepMessage) setClaimStatus('idle');
    if (!options.keepMessage) setMessage('');

    try {
      const tableMetas = await bitable.base.getTableMetaList();
      const activeTable = await bitable.base.getActiveTable();
      const activeTableMeta = await activeTable.getMeta();
      const bookingTableId = resolveBookingTableId(config.bookingTableId, activeTableMeta.id, tableMetas.map((table) => table.id));
      const table = bookingTableId === activeTableMeta.id ? activeTable : await bitable.base.getTableById(bookingTableId);
      const tableName = await table.getName();
      const fields = await table.getFieldMetaList();
      const currentUserId = await bitable.bridge.getUserId();

      const nextConfig = normalizeConfig(fields, { ...config, bookingTableId });
      if (JSON.stringify(nextConfig) !== JSON.stringify(config)) {
        setConfig(nextConfig);
        if (!draftConfig.bookingTableId || draftConfig.bookingTableId === config.bookingTableId) {
          setDraftConfig(nextConfig);
        }
      }

      const resourceConfigs = await loadResourceConfigs();
      const resourceValues: string[] = [];
      const records: Booking[] = [];
      const recordIds = await table.getRecordIdList();

      for (const recordId of recordIds) {
        const resource = nextConfig.resourceFieldId
          ? cellToText(await table.getCellValue(nextConfig.resourceFieldId, recordId))
          : '';
        if (resource) resourceValues.push(resource);

        const start = nextConfig.startFieldId ? Number(await table.getCellValue(nextConfig.startFieldId, recordId)) : 0;
        const end = nextConfig.endFieldId ? Number(await table.getCellValue(nextConfig.endFieldId, recordId)) : 0;
        const scheduleMode = nextConfig.scheduleModeFieldId
          ? normalizeScheduleMode(await table.getCellValue(nextConfig.scheduleModeFieldId, recordId))
          : '小时';
        const startDate = nextConfig.startDateFieldId
          ? Number(await table.getCellValue(nextConfig.startDateFieldId, recordId))
          : start;
        const endDate = nextConfig.endDateFieldId
          ? Number(await table.getCellValue(nextConfig.endDateFieldId, recordId))
          : end;
        const status = nextConfig.statusFieldId
          ? cellToText(await table.getCellValue(nextConfig.statusFieldId, recordId))
          : '';

        if (resource && (start || startDate) && (end || endDate)) {
          records.push({
            recordId,
            resource,
            scheduleMode,
            start: start || startOfLocalDay(startDate),
            end: end || endOfLocalDay(endDate),
            startDate: startDate || startOfLocalDay(start),
            endDate: endDate || endOfLocalDay(end),
            status,
          });
        }
      }

      setContext({
        tableName,
        tableId: bookingTableId,
        tableMetas,
        fields,
        records,
        resourceConfigs,
        resourceValues: unique(resourceValues),
        currentUserId,
      });
      setLocalClaimedSlots((current) => {
        const next = new Set<string>();
        current.forEach((key) => {
          if (pendingSlotKeysRef.current.has(key)) next.add(key);
        });
        return next;
      });
      setLoadStatus('success');
    } catch (error) {
      setLoadStatus('error');
      setMessage(getErrorMessage(error));
    }
  }

  function normalizeConfig(fields: IFieldMeta[], source: PluginConfig): PluginConfig {
    const resourceFields = fields.filter((field) => field.type === FieldType.Text || field.type === FieldType.SingleSelect);
    const dateFields = fields.filter((field) => field.type === FieldType.DateTime);
    const userFields = fields.filter((field) => field.type === FieldType.User);
    const statusFields = fields.filter((field) => field.type === FieldType.SingleSelect || field.type === FieldType.Text);
    const scheduleModeFields = fields.filter((field) => field.type === FieldType.SingleSelect || field.type === FieldType.Text);

    return {
      ...source,
      resourceFieldId:
        resourceFields.some((field) => field.id === source.resourceFieldId)
          ? source.resourceFieldId
          : pickField(resourceFields, FieldType.Text, ['资源']) ?? resourceFields[0]?.id ?? '',
      scheduleModeFieldId:
        source.scheduleModeFieldId && scheduleModeFields.some((field) => field.id === source.scheduleModeFieldId)
          ? source.scheduleModeFieldId
          : pickField(scheduleModeFields, FieldType.SingleSelect, ['调度类型', '预约类型']) ?? '',
      startDateFieldId:
        dateFields.some((field) => field.id === source.startDateFieldId)
          ? source.startDateFieldId
          : pickField(dateFields, FieldType.DateTime, ['开始日期']) ?? '',
      endDateFieldId:
        dateFields.some((field) => field.id === source.endDateFieldId)
          ? source.endDateFieldId
          : pickField(dateFields, FieldType.DateTime, ['结束日期']) ?? '',
      startFieldId:
        dateFields.some((field) => field.id === source.startFieldId)
          ? source.startFieldId
          : pickField(dateFields, FieldType.DateTime, ['开始']) ?? '',
      endFieldId:
        dateFields.some((field) => field.id === source.endFieldId)
          ? source.endFieldId
          : pickField(dateFields, FieldType.DateTime, ['结束']) ?? '',
      userFieldId:
        userFields.some((field) => field.id === source.userFieldId)
          ? source.userFieldId
          : pickField(userFields, FieldType.User, ['使用人', '人员', '预约人']) ?? '',
      statusFieldId:
        source.statusFieldId && statusFields.some((field) => field.id === source.statusFieldId)
          ? source.statusFieldId
          : pickField(statusFields, FieldType.SingleSelect, ['状态']) ?? '',
    };
  }

  function updateConfig(partial: Partial<PluginConfig>) {
    setConfig((current) => ({ ...current, ...partial }));
  }

  function updateDraftConfig(partial: Partial<PluginConfig>) {
    setConfigSavedNotice('');
    setDraftConfig((current) => ({ ...current, ...partial }));
  }

  function changeDraftBookingTable(bookingTableId: string) {
    setConfigSavedNotice('');
    setDraftConfig((current) => ({
      ...current,
      bookingTableId,
      resourceFieldId: '',
      scheduleModeFieldId: '',
      startDateFieldId: '',
      endDateFieldId: '',
      startFieldId: '',
      endFieldId: '',
      userFieldId: '',
      statusFieldId: '',
    }));
  }

  async function saveDraftConfig() {
    try {
      const table = draftConfig.bookingTableId
        ? await bitable.base.getTableById(draftConfig.bookingTableId)
        : await bitable.base.getActiveTable();
      const fields = await table.getFieldMetaList();
      const tableMeta = await table.getMeta();
      const nextConfig = normalizeConfig(fields, { ...draftConfig, bookingTableId: tableMeta.id });
      setConfig(nextConfig);
      setDraftConfig(nextConfig);
      setDraftFields(fields);
      saveConfig(nextConfig);
      setConfigSavedNotice('预约表配置已保存。');
      await loadContext({ keepMessage: true });
    } catch (error) {
      setConfigSavedNotice('');
      setClaimStatus('error');
      setMessage(getErrorMessage(error));
    }
  }

  async function getBookingTable() {
    return config.bookingTableId ? bitable.base.getTableById(config.bookingTableId) : bitable.base.getActiveTable();
  }

  function requiredConfigError() {
    if (!config.bookingTableId) return '请先保存预约表配置。';
    if (!config.resourceFieldId) return '请先选择资源字段。';
    if (!config.startFieldId) return '请先选择开始时间字段。';
    if (!config.endFieldId) return '请先选择结束时间字段。';
    if (!config.userFieldId) return '请先选择使用人字段，插件会自动填当前操作人。';
    if (!config.selectedResource) return '请先选择要预约的资源。';
    if (!config.selectedDate) return '请先选择预约日期。';
    if (timeToMinutes(config.workStart) >= timeToMinutes(config.workEnd)) return '可用开始时间必须早于可用结束时间。';
    if (config.slotMinutes <= 0) return '时间粒度必须大于 0。';
    return '';
  }

  function keysForRange(range: BookingSlotRange, mode: ScheduleMode) {
    if (mode === '小时') {
      return [slotKey(config.selectedResource, config.selectedDate, range.start, range.end)];
    }

    const keys: string[] = [];
    for (let cursor = startOfLocalDay(range.start); cursor <= startOfLocalDay(range.end); cursor += 86400000) {
      keys.push(slotKey(config.selectedResource, dateTextFromTimestamp(cursor), cursor, endOfLocalDay(cursor)));
    }
    return keys;
  }

  function isDayOccupied(timestamp: number) {
    const dayStart = startOfLocalDay(timestamp);
    const dayEnd = endOfLocalDay(timestamp);
    const localKey = slotKey(config.selectedResource, dateTextFromTimestamp(dayStart), dayStart, dayEnd);
    return (
      localClaimedSlots.has(localKey) ||
      bookingsForCurrentResource.some((booking) => booking.scheduleMode === '天' && inclusiveDaysOverlap(dayStart, dayEnd, booking.startDate, booking.endDate))
    );
  }

  function isDaySelected(timestamp: number) {
    if (!selectedDayRange) return false;
    return inclusiveDaysOverlap(timestamp, timestamp, selectedDayRange.start, selectedDayRange.end);
  }

  async function hasConflict(range: BookingSlotRange, mode: ScheduleMode) {
    const table = await getBookingTable();
    const recordIds = await table.getRecordIdList();
    for (const recordId of recordIds) {
      const resource = cellToText(await table.getCellValue(config.resourceFieldId, recordId));
      if (resource !== config.selectedResource) continue;

      const status = config.statusFieldId ? cellToText(await table.getCellValue(config.statusFieldId, recordId)) : '';
      if (status.includes('取消')) continue;

      const recordMode = config.scheduleModeFieldId ? normalizeScheduleMode(await table.getCellValue(config.scheduleModeFieldId, recordId)) : '小时';
      const start = Number(await table.getCellValue(config.startFieldId, recordId));
      const end = Number(await table.getCellValue(config.endFieldId, recordId));
      const startDate = config.startDateFieldId ? Number(await table.getCellValue(config.startDateFieldId, recordId)) : start;
      const endDate = config.endDateFieldId ? Number(await table.getCellValue(config.endDateFieldId, recordId)) : end;

      if (mode === '天' && recordMode === '天' && startDate && endDate && inclusiveDaysOverlap(range.start, range.end, startDate, endDate)) {
        return true;
      }

      if (mode === '小时' && recordMode === '小时' && start && end && sameDay(start, config.selectedDate) && intervalsOverlap(range.start, range.end, start, end)) {
        return true;
      }
    }
    return false;
  }

  async function createBooking(table: ITable, fieldMap: Map<string, IFieldMeta>, range: BookingSlotRange, currentUserId: string, mode: ScheduleMode) {
    const recordId = await table.addRecord();
    const dateFields = resolveBookingDateFields(mode, range);
    await setFieldValue(table, fieldMap.get(config.resourceFieldId), recordId, config.selectedResource);
    if (config.scheduleModeFieldId) await setFieldValue(table, fieldMap.get(config.scheduleModeFieldId), recordId, mode);
    if (dateFields && config.startDateFieldId) await setFieldValue(table, fieldMap.get(config.startDateFieldId), recordId, dateFields.startDate);
    if (dateFields && config.endDateFieldId) await setFieldValue(table, fieldMap.get(config.endDateFieldId), recordId, dateFields.endDate);
    await setFieldValue(table, fieldMap.get(config.startFieldId), recordId, mode === '天' ? startOfLocalDay(range.start) : range.start);
    await setFieldValue(table, fieldMap.get(config.endFieldId), recordId, mode === '天' ? endOfLocalDay(range.end) : range.end);
    await setFieldValue(table, fieldMap.get(config.userFieldId), recordId, '', currentUserId);
    if (config.statusFieldId) await setFieldValue(table, fieldMap.get(config.statusFieldId), recordId, '已预约');
  }

  function toggleSlotSelection(slot: Slot) {
    if (slot.occupied || requiredConfigError()) return;
    const key = slotKey(config.selectedResource, config.selectedDate, slot.start, slot.end);
    setSelectedSlotKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function beginDaySelection(timestamp: number) {
    if (isDayOccupied(timestamp)) return;
    const dayStart = startOfLocalDay(timestamp);
    setDaySelectionStart(dayStart);
    setDaySelectionEnd(dayStart);
    setIsDraggingDays(true);
  }

  function extendDaySelection(timestamp: number) {
    if (!isDraggingDays || daySelectionStart === null) return;
    setDaySelectionEnd(startOfLocalDay(timestamp));
  }

  function endDaySelection() {
    setIsDraggingDays(false);
  }

  async function claimSelectedSlots() {
    const configError = requiredConfigError();
    if (configError) {
      setClaimStatus('error');
      setMessage(configError);
      return;
    }
    if (!bookingRanges.length) {
      setClaimStatus('error');
      setMessage(activeScheduleMode === '天' ? '请先在日历上选择要预约的日期。' : '请先选择要预约的时间段。');
      return;
    }

    const selectedKeys = bookingRanges.flatMap((range) => keysForRange(range, activeScheduleMode));
    const rangeText = selectedRangeText;
    setLocalClaimedSlots((current) => {
      const next = new Set(current);
      selectedKeys.forEach((key) => next.add(key));
      return next;
    });
    selectedKeys.forEach((key) => pendingSlotKeysRef.current.add(key));
    setSelectedSlotKeys(new Set());
    setDaySelectionStart(null);
    setDaySelectionEnd(null);
    setClaimStatus('success');
    setMessage(`已预约：${config.selectedResource} ${rangeText}，正在写入表格...`);

    try {
      for (const range of bookingRanges) {
        if (await hasConflict(range, activeScheduleMode)) {
          const conflictText =
            activeScheduleMode === '天'
              ? `${dateLabel(range.start)}-${dateLabel(range.end)}`
              : `${formatSlotTime(range.start)}-${formatSlotTime(range.end)}`;
          throw new Error(`${config.selectedResource} 的 ${conflictText} 刚刚已被占用，请刷新后重新选择。`);
        }
      }

      const table = await getBookingTable();
      const fields = await table.getFieldMetaList();
      const latestFieldMap = new Map(fields.map((field) => [field.id, field]));
      const currentUserId = await bitable.bridge.getUserId();

      for (const range of bookingRanges) {
        await createBooking(table, latestFieldMap, range, currentUserId, activeScheduleMode);
      }

      setClaimStatus('success');
      setMessage(`已新增预约：${config.selectedResource} ${rangeText}`);
      await loadContext({ keepMessage: true });
      setLocalClaimedSlots((current) => {
        const next = new Set(current);
        selectedKeys.forEach((key) => {
          pendingSlotKeysRef.current.delete(key);
          next.delete(key);
        });
        return next;
      });
    } catch (error) {
      setLocalClaimedSlots((current) => {
        const next = new Set(current);
        selectedKeys.forEach((key) => {
          pendingSlotKeysRef.current.delete(key);
          next.delete(key);
        });
        return next;
      });
      setClaimStatus('error');
      setMessage(getErrorMessage(error));
    }
  }

  const fields = context?.fields ?? [];
  const tableOptions = context?.tableMetas ?? [];
  const draftTableName = tableOptions.find((table) => table.id === draftConfig.bookingTableId)?.name ?? context?.tableName ?? '请选择预约表';
  const hasUnsavedConfig = JSON.stringify(draftConfig) !== JSON.stringify(config);
  const resourceFields = fields.filter((field) => field.type === FieldType.Text || field.type === FieldType.SingleSelect).map(fieldToOption);
  const dateFields = fields.filter((field) => field.type === FieldType.DateTime).map(fieldToOption);
  const userFields = fields.filter((field) => field.type === FieldType.User).map(fieldToOption);
  const statusFields = fields.filter((field) => field.type === FieldType.SingleSelect || field.type === FieldType.Text).map(fieldToOption);
  const scheduleModeFields = fields.filter((field) => field.type === FieldType.SingleSelect || field.type === FieldType.Text).map(fieldToOption);
  const draftResourceFields = draftFields.filter((field) => field.type === FieldType.Text || field.type === FieldType.SingleSelect).map(fieldToOption);
  const draftDateFields = draftFields.filter((field) => field.type === FieldType.DateTime).map(fieldToOption);
  const draftUserFields = draftFields.filter((field) => field.type === FieldType.User).map(fieldToOption);
  const draftStatusFields = draftFields.filter((field) => field.type === FieldType.SingleSelect || field.type === FieldType.Text).map(fieldToOption);
  const draftScheduleModeFields = draftFields.filter((field) => field.type === FieldType.SingleSelect || field.type === FieldType.Text).map(fieldToOption);
  const missingMessage = requiredConfigError();

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-icon" aria-hidden="true">
          <CalendarDays size={24} />
        </div>
        <div>
          <p className="eyebrow">Resource Booking</p>
          <h1>资源时间预约助手</h1>
          <p className="hero-copy">面向飞书多维表格的通用资源预约工具，支持人员、台架、会议室等资源按小时或按天预约，并自动写入预约记录。</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="label">当前预约表</span>
            <strong>{context?.tableName ?? '等待读取'}</strong>
          </div>
          <StatusBadge status={loadStatus} />
        </div>
        <button className="secondary-button" onClick={() => loadContext()} disabled={loadStatus === 'loading'}>
          {loadStatus === 'loading' ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
          <span>{loadStatus === 'loading' ? '刷新中...' : '刷新预约状态'}</span>
        </button>
      </section>

      <nav className="tab-bar" aria-label="功能切换">
        <button className={activeTab === 'booking' ? 'active' : ''} type="button" onClick={() => setActiveTab('booking')}>
          <CalendarDays size={16} />
          <span>预约</span>
        </button>
        <button className={activeTab === 'settings' ? 'active' : ''} type="button" onClick={() => setActiveTab('settings')}>
          <Settings2 size={16} />
          <span>配置</span>
        </button>
      </nav>

      {activeTab === 'settings' ? (
        <>
      <section className="panel">
        <div className="section-title">
          <Settings2 size={17} />
          <span>预约表字段配置</span>
        </div>
        <p className="section-note">先固定预约记录写入哪张表，再配置这张表里的字段。保存后，切换到其它数据表也不会影响预约写入。</p>

        <label className="form-row">
          <span>预约表</span>
          <select value={draftConfig.bookingTableId || context?.tableId || ''} onChange={(event) => changeDraftBookingTable(event.target.value)}>
            {tableOptions.length ? null : <option value="">待读取数据表</option>}
            {tableOptions.map((table) => (
              <option key={table.id} value={table.id}>
                {table.name}
              </option>
            ))}
          </select>
        </label>
        <p className="section-note">当前选择：{draftTableName}</p>

        <div className="field-group">
          <div className="field-group-title">通用字段</div>
        <FieldSelect label="资源字段" value={draftConfig.resourceFieldId} fields={draftResourceFields} onChange={(resourceFieldId) => updateDraftConfig({ resourceFieldId })} />
        <FieldSelect label="调度类型字段" value={draftConfig.scheduleModeFieldId} fields={draftScheduleModeFields} optional onChange={(scheduleModeFieldId) => updateDraftConfig({ scheduleModeFieldId })} />
        <FieldSelect label="使用人字段" value={draftConfig.userFieldId} fields={draftUserFields} onChange={(userFieldId) => updateDraftConfig({ userFieldId })} />
        <FieldSelect label="状态字段" value={draftConfig.statusFieldId} fields={draftStatusFields} optional onChange={(statusFieldId) => updateDraftConfig({ statusFieldId })} />
        </div>

        <div className="field-group">
          <div className="field-group-title">按小时预约字段</div>
          <FieldSelect label="开始时间字段" value={draftConfig.startFieldId} fields={draftDateFields} onChange={(startFieldId) => updateDraftConfig({ startFieldId })} />
          <FieldSelect label="结束时间字段" value={draftConfig.endFieldId} fields={draftDateFields} onChange={(endFieldId) => updateDraftConfig({ endFieldId })} />
        </div>

        <div className="field-group">
          <div className="field-group-title">按天预约字段</div>
          <FieldSelect label="开始日期字段" value={draftConfig.startDateFieldId} fields={draftDateFields} optional onChange={(startDateFieldId) => updateDraftConfig({ startDateFieldId })} />
          <FieldSelect label="结束日期字段" value={draftConfig.endDateFieldId} fields={draftDateFields} optional onChange={(endDateFieldId) => updateDraftConfig({ endDateFieldId })} />
        </div>

        <button className="secondary-button" type="button" onClick={saveDraftConfig} disabled={!tableOptions.length || !hasUnsavedConfig}>
          <CheckCircle2 size={17} />
          <span>{hasUnsavedConfig ? '保存预约表配置' : '配置已保存'}</span>
        </button>
        {configSavedNotice ? <p className="section-note success-note">{configSavedNotice}</p> : null}
      </section>
      <section className="panel">
        <div className="section-title">
          <Database size={17} />
          <span>资源配置表</span>
        </div>
        {context?.resourceConfigs.length ? (
          <div className="config-list">
            {context.resourceConfigs.map((resource) => (
              <div className={`config-item ${resource.enabled ? '' : 'disabled'}`} key={resource.id}>
                <div>
                  <strong>{resource.name}</strong>
                  <span>{resource.resourceType || '未分类'}</span>
                </div>
                <small>{resource.enabled ? resource.scheduleMode === '天' ? '按天' : `${resource.workStart}-${resource.workEnd}` : '未启用'}</small>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>未读取到资源配置表，请先创建并维护资源配置表。</p>
          </div>
        )}
      </section>
        </>
      ) : null}

      {activeTab === 'booking' ? (
        <>
      <section className="panel">
        <div className="section-title">
          <Clock3 size={17} />
          <span>预约规则</span>
        </div>

        <label className="form-row">
          <span>选择资源</span>
          <select value={config.selectedResource} onChange={(event) => updateConfig({ selectedResource: event.target.value })}>
            {resourceOptions.length ? null : <option value="">请先维护资源配置表</option>}
            {resourceOptions.map((resource) => (
              <option key={resource} value={resource}>
                {resource}
              </option>
            ))}
          </select>
        </label>

        <div className="mode-line">
          <span>{activeScheduleMode === '天' ? '按天预约' : '按小时预约'}</span>
          {selectedResourceConfig?.resourceType ? <strong>{selectedResourceConfig.resourceType}</strong> : null}
        </div>

        {activeScheduleMode === '小时' ? (
          <label className="form-row">
            <span>预约日期</span>
            <input type="date" value={config.selectedDate} onChange={(event) => updateConfig({ selectedDate: event.target.value })} />
          </label>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-title">
          <Database size={17} />
          <span>当前资源状态</span>
        </div>
        <div className="metrics">
          <Metric label={activeScheduleMode === '天' ? '本月天数' : '时间格'} value={activeScheduleMode === '天' ? calendarDays.filter((day) => day.inMonth).length : slots.length} />
          <Metric label="可预约" value={activeScheduleMode === '天' ? calendarAvailableDays : availableSlots.length} />
          <Metric label="已选择" value={selectedCount} />
          <Metric label="已预约" value={activeScheduleMode === '天' ? calendarOccupiedDays : occupiedSlots} />
        </div>
      </section>

      {missingMessage ? (
        <section className="message error-message">
          <AlertCircle size={18} />
          <span>{missingMessage}</span>
        </section>
      ) : null}

      {message ? (
        <section className={`message ${claimStatus === 'success' ? 'success-message' : 'error-message'}`}>
          {claimStatus === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{message}</span>
        </section>
      ) : null}

      {bookingRanges.length ? (
        <section className="selection-bar">
          <div>
            <span>将新增 {bookingRanges.length} 条预约</span>
            <strong>{selectedRangeText}</strong>
          </div>
          <button className="primary-button" onClick={claimSelectedSlots} disabled={Boolean(missingMessage)}>
            <TimerReset size={17} />
            <span>预约所选时间</span>
          </button>
        </section>
      ) : null}

      {activeScheduleMode === '天' ? (
        <section className="calendar-panel" onMouseLeave={endDaySelection}>
          <div className="calendar-heading">
            <button type="button" onClick={() => setCalendarMonth((month) => addMonths(month, -1))}>
              上月
            </button>
            <strong>{calendarMonth}</strong>
            <button type="button" onClick={() => setCalendarMonth((month) => addMonths(month, 1))}>
              下月
            </button>
          </div>
          <div className="calendar-weekdays">
            {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid" onMouseUp={endDaySelection}>
            {calendarDays.map((day) => {
              const occupied = isDayOccupied(day.timestamp);
              const selected = isDaySelected(day.timestamp);
              return (
                <button
                  type="button"
                  key={day.timestamp}
                  className={`calendar-day ${day.inMonth ? '' : 'muted'} ${occupied ? 'occupied' : ''} ${selected ? 'selected' : ''}`}
                  disabled={occupied || Boolean(missingMessage)}
                  onMouseDown={() => beginDaySelection(day.timestamp)}
                  onMouseEnter={() => extendDaySelection(day.timestamp)}
                  onMouseUp={endDaySelection}
                >
                  <span>{day.label}</span>
                  <small>{occupied ? '已预约' : selected ? '已选择' : ''}</small>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="resource-list" aria-label="可预约时间">
          {slots.length ? (
            slots.map((slot) => {
              const isSelected = selectedSlotKeys.has(slotKey(config.selectedResource, config.selectedDate, slot.start, slot.end));
              return (
                <button
                  className={`resource-button ${slot.occupied ? 'occupied' : ''} ${isSelected ? 'selected' : ''}`}
                  key={slot.start}
                  onClick={() => toggleSlotSelection(slot)}
                  disabled={slot.occupied || Boolean(missingMessage)}
                  aria-pressed={isSelected}
                >
                  <span>{slot.label}</span>
                  <small>{slot.occupied ? '已预约' : isSelected ? '已选择' : '预约'}</small>
                </button>
              );
            })
          ) : (
            <div className="empty-state">
              <p>请完成预约表字段配置、选择资源和日期后查看可预约时间。</p>
            </div>
          )}
        </section>
      )}
        </>
      ) : null}
    </main>
  );
}

function FieldSelect({
  label,
  value,
  fields,
  optional,
  onChange,
}: {
  label: string;
  value: string;
  fields: FieldOption[];
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {optional ? <option value="">不写入</option> : <option value="">请选择字段</option>}
        {fields.map((field) => (
          <option key={field.id} value={field.id}>
            {field.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusBadge({ status }: { status: LoadState }) {
  if (status === 'success') {
    return (
      <span className="status-badge success">
        <CheckCircle2 size={15} />
        已同步
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span className="status-badge error">
        <AlertCircle size={15} />
        失败
      </span>
    );
  }

  if (status === 'loading') {
    return (
      <span className="status-badge loading">
        <Loader2 className="spin" size={15} />
        读取中
      </span>
    );
  }

  return <span className="status-badge">未读取</span>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
