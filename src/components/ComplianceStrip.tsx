import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import type { ComplianceRule, RuleStatus } from '../types/converter';

interface ComplianceStripProps {
  sectionLabel: string;
  title: string;
  description: string;
  rules: ComplianceRule[];
}

function StatusIcon({ status }: { status: RuleStatus }) {
  if (status === 'pass') {
    return <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />;
  }
  if (status === 'fail') {
    return <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" aria-hidden="true" />;
  }
  if (status === 'warn') {
    return <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />;
  }
  return <CircleDashed className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" aria-hidden="true" />;
}

export function ComplianceStrip({ sectionLabel, title, description, rules }: ComplianceStripProps) {
  const gridCols = rules.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4';

  return (
    <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{sectionLabel}</span>
            <span aria-hidden="true">·</span>
            <span>Stock Compliance</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5 text-balance">
            {title}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
            {description}
          </p>
        </div>

        <div className={`grid ${gridCols} gap-2.5 text-xs shrink-0`}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-[#141d2f] border border-slate-200 dark:border-[#2a3752]"
            >
              <div className="mt-0.5">
                <StatusIcon status={rule.status} />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                  {rule.label}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate max-w-[155px]">
                  {rule.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
