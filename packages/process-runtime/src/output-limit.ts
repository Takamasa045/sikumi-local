export const OUTPUT_OVERFLOW_DIAGNOSTIC = 'runtime.output_overflow'
export const OUTPUT_OVERFLOW_KIND = 'output_overflow'

export type JsonlRecord = Record<string, unknown>

export type OutputOverflowDiagnostic = {
  readonly type: typeof OUTPUT_OVERFLOW_DIAGNOSTIC
  readonly summary: string
  readonly diagnostic: typeof OUTPUT_OVERFLOW_KIND
  readonly maxBytes: number
  readonly observedBytes?: number
}

export function toJsonlRecord(
  diagnostic: OutputOverflowDiagnostic,
): JsonlRecord {
  return diagnostic
}

export function createOutputOverflowDiagnostic(input: {
  readonly maxBytes: number
  readonly observedBytes?: number
}): OutputOverflowDiagnostic {
  return {
    type: OUTPUT_OVERFLOW_DIAGNOSTIC,
    summary: '出力が上限を超えたため切り詰めました',
    diagnostic: OUTPUT_OVERFLOW_KIND,
    maxBytes: input.maxBytes,
    ...(input.observedBytes === undefined
      ? {}
      : { observedBytes: input.observedBytes }),
  }
}
