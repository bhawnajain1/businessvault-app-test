/**
 * RECOVERY_DIAGNOSTIC_REPORT — spec §27.
 *
 * Rendered when post-restore validation fails (accounting off, inventory
 * identity broken, GST reconciliation off, hash chain broken, …). Restore
 * MUST NOT silently modify accounting records — instead it surfaces this
 * report to the user, who can then decide whether to reject the restore or
 * request manual correction transactions.
 */

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface DiagnosticIssue {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  /** Optional structured detail — table name, primary key, expected vs actual. */
  detail?: Record<string, unknown>;
}

export interface RecoveryDiagnosticReport {
  businessId: string;
  generatedAt: string;
  ok: boolean;
  counts: Record<string, number>;
  issues: DiagnosticIssue[];
  summary: string;
}

export function makeDiagnosticReport(input: {
  businessId: string;
  counts: Record<string, number>;
  issues: DiagnosticIssue[];
}): RecoveryDiagnosticReport {
  const errors = input.issues.filter((i) => i.severity === 'error');
  const warnings = input.issues.filter((i) => i.severity === 'warning');
  const summary =
    errors.length === 0
      ? warnings.length === 0
        ? 'Restore verified: accounting balanced, inventory identity holds, GST reconciles.'
        : `Restore verified with ${warnings.length} warning(s). Review before continuing.`
      : `Restore failed post-verification: ${errors.length} error(s), ${warnings.length} warning(s). ` +
        'DO NOT operate this business file until the underlying journal is corrected.';

  return {
    businessId: input.businessId,
    generatedAt: new Date().toISOString(),
    ok: errors.length === 0,
    counts: input.counts,
    issues: input.issues,
    summary,
  };
}

export function renderDiagnosticReport(r: RecoveryDiagnosticReport): string {
  const lines: string[] = [];
  lines.push('RECOVERY_DIAGNOSTIC_REPORT');
  lines.push('==========================');
  lines.push(`businessId:  ${r.businessId}`);
  lines.push(`generatedAt: ${r.generatedAt}`);
  lines.push(`status:      ${r.ok ? 'OK' : 'FAILED'}`);
  lines.push('');
  lines.push('Counts:');
  for (const [k, v] of Object.entries(r.counts)) {
    lines.push(`  ${k.padEnd(20)} ${v}`);
  }
  lines.push('');
  lines.push('Issues:');
  if (r.issues.length === 0) {
    lines.push('  (none)');
  } else {
    for (const i of r.issues) {
      lines.push(`  [${i.severity.toUpperCase()}] ${i.code}: ${i.message}`);
      if (i.detail) {
        for (const [k, v] of Object.entries(i.detail)) {
          lines.push(`      ${k}: ${JSON.stringify(v)}`);
        }
      }
    }
  }
  lines.push('');
  lines.push(r.summary);
  return lines.join('\n');
}
