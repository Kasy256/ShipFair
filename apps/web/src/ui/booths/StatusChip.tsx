import type { BoothStatus } from '@shipfair/shared';

/** Maker-facing names for booth states (prompt 08 "My booths"). */
const CHIPS: Record<BoothStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-ink-3 text-paper' },
  pending: { label: 'In review', tone: 'bg-amber-300 text-ink' },
  approved: { label: 'Live', tone: 'bg-emerald-300 text-ink' },
  rejected: { label: 'Changes needed', tone: 'bg-red-300 text-ink' },
  hidden: { label: 'Hidden', tone: 'bg-ink-3 text-paper' },
  archived: { label: 'Archived', tone: 'bg-ink-3 text-muted' },
};

export function statusLabel(status: BoothStatus): string {
  return CHIPS[status].label;
}

export function StatusChip({ status }: { status: BoothStatus }) {
  const { label, tone } = CHIPS[status];
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 font-bold text-xs ${tone}`}
      data-testid="status-chip"
    >
      {label}
    </span>
  );
}
