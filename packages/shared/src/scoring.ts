export interface MaturityBand {
  minScore: number;
  maxScore: number;
  label: string;
  guidance: string;
}

export interface ScoringConfig {
  aggregationMethod: 'weighted_mean';
  weakestLinkCapEnabled: boolean;
  weakestLinkMaxDelta: number; // e.g., 0 means overall cannot exceed lowest dimension; 0.5 means lowest + 0.5
  rationaleRequiredAboveRating: number; // e.g., 3 means rating >= 3 requires rationale (configurable)
  defaultTargetMaturityLevel: number; // 3 (Defined) per FRAME specification for production systems
  bands: MaturityBand[];
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  aggregationMethod: 'weighted_mean',
  weakestLinkCapEnabled: false,
  weakestLinkMaxDelta: 0.5,
  rationaleRequiredAboveRating: 3,
  defaultTargetMaturityLevel: 3,
  bands: [
    {
      minScore: 0,
      maxScore: 1.9999,
      label: 'Significant governance gaps',
      guidance:
        'The deployment has significant governance gaps. It should not remain in production without an immediate remediation plan with short deadlines. Consider restricted operation (reduced authority scope) until Level 2 is achieved across all dimensions.'
    },
    {
      minScore: 2.0,
      maxScore: 2.9999,
      label: 'Developing governance foundation',
      guidance:
        'The deployment has a developing governance foundation. A structured improvement plan is required to reach Level 3. Prioritise the lowest-scoring dimensions and any dimension with individual indicators scored at 1.'
    },
    {
      minScore: 3.0,
      maxScore: 3.4999,
      label: 'Meets target governance standard',
      guidance:
        'The deployment meets the target governance standard. Focus improvement efforts on the gap between current and Level 4 for the dimensions most material to this deployment risk profile.'
    },
    {
      minScore: 3.5,
      maxScore: 4.0,
      label: 'Strong governance maturity',
      guidance:
        'The deployment demonstrates strong governance maturity. Maintain current practices and consider whether this deployment can serve as a reference case for other deployments in the portfolio.'
    }
  ]
};

export interface QuestionInput {
  id: string;
  code: string;
  dimensionCode: string;
  dimensionName: string;
  weight: number;
}

export interface ResponseInput {
  questionId: string;
  rating: number | null; // 1..4
  isNa: boolean;
}

export interface DimensionScoreResult {
  dimensionCode: string;
  dimensionName: string;
  score: number | null;
  levelLabel: string;
  applicableCount: number;
  naCount: number;
  naCodes: string[];
  totalWeight: number;
  weightedSum: number;
  gapToTarget: number | null;
}

export interface AssessmentScoreResult {
  overallScore: number | null;
  rawOverallScore: number | null;
  weakestLinkCapped: boolean;
  lowestDimensionScore: number | null;
  band: MaturityBand | null;
  dimensions: DimensionScoreResult[];
  totalApplicable: number;
  totalNa: number;
  targetMaturityLevel: number;
  overallGapToTarget: number | null;
  derivationSummary: string;
}

export function getMaturityLevelLabel(score: number | null): string {
  if (score === null) return 'Not assessed';
  if (score < 1.5) return 'Initial';
  if (score < 2.5) return 'Developing';
  if (score < 3.5) return 'Defined';
  return 'Optimising';
}

export function getScoreBand(score: number | null, bands: MaturityBand[]): MaturityBand | null {
  if (score === null) return null;
  for (const band of bands) {
    if (score >= band.minScore && score <= band.maxScore) {
      return band;
    }
  }
  return bands[bands.length - 1] ?? null;
}

export function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateAssessmentScore(
  questions: QuestionInput[],
  responses: ResponseInput[],
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  targetMaturityLevel?: number
): AssessmentScoreResult {
  const target = targetMaturityLevel ?? config.defaultTargetMaturityLevel;
  const responseMap = new Map<string, ResponseInput>();
  for (const r of responses) {
    responseMap.set(r.questionId, r);
  }

  // Group questions by dimension while preserving order
  const dimGroups = new Map<string, { name: string; questions: QuestionInput[] }>();
  for (const q of questions) {
    const existing = dimGroups.get(q.dimensionCode);
    if (existing) {
      existing.questions.push(q);
    } else {
      dimGroups.set(q.dimensionCode, { name: q.dimensionName, questions: [q] });
    }
  }

  const dimensions: DimensionScoreResult[] = [];
  let totalApplicable = 0;
  let totalNa = 0;

  for (const [dimensionCode, group] of dimGroups.entries()) {
    let weightedSum = 0;
    let totalWeight = 0;
    let applicableCount = 0;
    let naCount = 0;
    const naCodes: string[] = [];

    for (const q of group.questions) {
      const resp = responseMap.get(q.id);
      if (!resp) continue;

      if (resp.isNa) {
        naCount += 1;
        totalNa += 1;
        naCodes.push(q.code);
        continue;
      }

      if (resp.rating !== null && resp.rating >= 1 && resp.rating <= 4) {
        const w = q.weight > 0 ? q.weight : 1;
        weightedSum += resp.rating * w;
        totalWeight += w;
        applicableCount += 1;
        totalApplicable += 1;
      }
    }

    const score = totalWeight > 0 ? roundScore(weightedSum / totalWeight) : null;
    dimensions.push({
      dimensionCode,
      dimensionName: group.name,
      score,
      levelLabel: getMaturityLevelLabel(score),
      applicableCount,
      naCount,
      naCodes,
      totalWeight: roundScore(totalWeight),
      weightedSum: roundScore(weightedSum),
      gapToTarget: score !== null ? roundScore(target - score) : null
    });
  }

  const scoredDimensions = dimensions.filter((d) => d.score !== null) as Array<
    DimensionScoreResult & { score: number }
  >;

  if (scoredDimensions.length === 0) {
    return {
      overallScore: null,
      rawOverallScore: null,
      weakestLinkCapped: false,
      lowestDimensionScore: null,
      band: null,
      dimensions,
      totalApplicable,
      totalNa,
      targetMaturityLevel: target,
      overallGapToTarget: null,
      derivationSummary: 'No scored indicators yet.'
    };
  }

  const rawOverallScore = roundScore(
    scoredDimensions.reduce((sum, d) => sum + d.score, 0) / scoredDimensions.length
  );

  const lowestDimensionScore = Math.min(...scoredDimensions.map((d) => d.score));
  let overallScore = rawOverallScore;
  let weakestLinkCapped = false;

  if (config.weakestLinkCapEnabled) {
    const cap = roundScore(lowestDimensionScore + config.weakestLinkMaxDelta);
    if (rawOverallScore > cap) {
      overallScore = cap;
      weakestLinkCapped = true;
    }
  }

  const band = getScoreBand(overallScore, config.bands);
  const overallGapToTarget = roundScore(target - overallScore);

  const dimFormula = scoredDimensions
    .map((d) => `${d.dimensionName}: ${d.score.toFixed(2)} (${d.weightedSum}/${d.totalWeight}, ${d.naCount} N/A)`)
    .join('; ');

  const derivationSummary = weakestLinkCapped
    ? `Mean of ${scoredDimensions.length} dimension(s) = ${rawOverallScore.toFixed(2)}, capped at ${overallScore.toFixed(2)} by weakest-link rule (lowest dimension ${lowestDimensionScore.toFixed(2)} + ${config.weakestLinkMaxDelta}). [${dimFormula}]`
    : `Mean of ${scoredDimensions.length} dimension(s) = ${overallScore.toFixed(2)} (${totalNa} N/A excluded). [${dimFormula}]`;

  return {
    overallScore,
    rawOverallScore,
    weakestLinkCapped,
    lowestDimensionScore,
    band,
    dimensions,
    totalApplicable,
    totalNa,
    targetMaturityLevel: target,
    overallGapToTarget,
    derivationSummary
  };
}
