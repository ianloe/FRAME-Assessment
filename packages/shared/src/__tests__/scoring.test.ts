import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAssessmentScore,
  DEFAULT_SCORING_CONFIG,
  type QuestionInput,
  type ResponseInput
} from '../scoring.js';

const sampleQuestions: QuestionInput[] = [
  { id: 'q1', code: 'F1', dimensionCode: 'FOCUS', dimensionName: 'Focus', weight: 1 },
  { id: 'q2', code: 'F2', dimensionCode: 'FOCUS', dimensionName: 'Focus', weight: 2 },
  { id: 'q3', code: 'R1', dimensionCode: 'ROLES', dimensionName: 'Roles', weight: 1 },
  { id: 'q4', code: 'R2', dimensionCode: 'ROLES', dimensionName: 'Roles', weight: 1 }
];

describe('calculateAssessmentScore', () => {
  it('computes weighted mean and excludes N/A from denominator', () => {
    const responses: ResponseInput[] = [
      { questionId: 'q1', rating: 2, isNa: false },
      { questionId: 'q2', rating: 4, isNa: false }, // weighted (2*1 + 4*2) / 3 = 3.33
      { questionId: 'q3', rating: 3, isNa: false },
      { questionId: 'q4', rating: null, isNa: true } // excluded
    ];

    const result = calculateAssessmentScore(sampleQuestions, responses, DEFAULT_SCORING_CONFIG, 3);

    assert.equal(result.dimensions[0].score, 3.33);
    assert.equal(result.dimensions[1].score, 3);
    assert.equal(result.dimensions[1].naCount, 1);
    assert.deepEqual(result.dimensions[1].naCodes, ['R2']);
    assert.equal(result.overallScore, 3.17);
    assert.equal(result.totalNa, 1);
    assert.equal(result.band?.label, 'Meets target governance standard');
    assert.equal(result.weakestLinkCapped, false);
  });

  it('applies weakest-link cap when enabled', () => {
    const responses: ResponseInput[] = [
      { questionId: 'q1', rating: 4, isNa: false },
      { questionId: 'q2', rating: 4, isNa: false },
      { questionId: 'q3', rating: 1, isNa: false },
      { questionId: 'q4', rating: 1, isNa: false }
    ];

    const config = {
      ...DEFAULT_SCORING_CONFIG,
      weakestLinkCapEnabled: true,
      weakestLinkMaxDelta: 0.5
    };

    const result = calculateAssessmentScore(sampleQuestions, responses, config, 3);
    // Raw mean = (4 + 1) / 2 = 2.5, capped at 1.0 + 0.5 = 1.5
    assert.equal(result.rawOverallScore, 2.5);
    assert.equal(result.overallScore, 1.5);
    assert.equal(result.weakestLinkCapped, true);
    assert.equal(result.band?.label, 'Significant governance gaps');
  });

  it('returns null scores when no applicable indicators are rated', () => {
    const result = calculateAssessmentScore(sampleQuestions, [], DEFAULT_SCORING_CONFIG);
    assert.equal(result.overallScore, null);
    assert.equal(result.band, null);
  });
});
