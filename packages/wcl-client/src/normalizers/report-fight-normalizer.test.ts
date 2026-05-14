import { describe, expect, it } from 'vitest';
import { normalizeReportFights } from './report-fight-normalizer.js';
import type { ReportIndexData, ReportTableMetrics } from '../pipeline/types.js';

describe('report fight normalizer', () => {
  it('infers difficulty and size from completed boss fights', () => {
    const index: ReportIndexData = {
      reportCode: 'ABC123',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      gameFamily: 'retail',
      title: 'Raid',
      zoneName: 'Throne',
      startTime: 0,
      endTime: 1,
      completedBossFights: [
        { id: 1, encounterId: 1001, name: 'Boss A', startTime: 0, endTime: 100, kill: true, difficulty: 4, size: 10 },
        { id: 2, encounterId: 1001, name: 'Boss A', startTime: 120, endTime: 240, kill: false, difficulty: 4, size: 10 },
        { id: 3, encounterId: 1002, name: 'Boss B', startTime: 250, endTime: 500, kill: true, difficulty: 3, size: 25 },
      ],
      killBossFights: [
        { id: 1, encounterId: 1001, name: 'Boss A', startTime: 0, endTime: 100, kill: true, difficulty: 4, size: 10 },
        { id: 3, encounterId: 1002, name: 'Boss B', startTime: 250, endTime: 500, kill: true, difficulty: 3, size: 25 },
      ],
      allBossFights: [],
      zoneDifficulties: [
        { id: 3, name: 'Normal', sizes: [10, 25] },
        { id: 4, name: 'Heroic', sizes: [10, 25] },
      ],
    };

    const tableMetrics: ReportTableMetrics = {
      topDamageDone: [],
      topHealingDone: [],
      topDamageTaken: [],
      topDeaths: [],
      topInterrupts: [],
      topDispels: [],
      totals: {},
      deathsByFightId: { 1: 2, 2: 4, 3: 1 },
    };

    const result = normalizeReportFights(index, tableMetrics);

    expect(result.inferredDifficultyName).toBe('Heroic');
    expect(result.inferredSizeLabel).toBe('10man');
  });
});
