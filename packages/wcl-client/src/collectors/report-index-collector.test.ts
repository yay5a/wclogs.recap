import { describe, expect, it, vi } from 'vitest';
import { collectReportIndex } from './report-index-collector.js';

describe('report index collector', () => {
  it('filters completed boss encounter fights, excludes trash, and excludes in-progress from completed', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        reportData: {
          report: {
            title: 'Raid Night',
            startTime: 100,
            endTime: 1000,
            zone: {
              id: 100,
              name: 'Throne',
              difficulties: [{ id: 4, name: 'Heroic', sizes: [10, 25] }],
            },
            fights: [
              {
                id: 1,
                encounterID: 5001,
                difficulty: 4,
                size: 10,
                name: 'Boss One',
                startTime: 0,
                endTime: 100,
                kill: false,
              },
              {
                id: 2,
                encounterID: 5001,
                difficulty: 4,
                size: 10,
                name: 'Boss One',
                startTime: 120,
                endTime: 240,
                kill: true,
              },
              {
                id: 3,
                encounterID: 0,
                originalEncounterID: 5002,
                difficulty: 4,
                size: 10,
                name: 'Boss Two',
                startTime: 250,
                endTime: 300,
                kill: true,
              },
              {
                id: 4,
                encounterID: 0,
                name: 'Trash',
                startTime: 310,
                endTime: 350,
                kill: true,
              },
              {
                id: 5,
                encounterID: 5003,
                difficulty: 4,
                size: 10,
                name: 'Boss Three',
                startTime: 360,
                endTime: 420,
                kill: false,
                inProgress: true,
              },
            ],
          },
        },
      },
    });

    const result = await collectReportIndex({ request } as never, {
      reportCode: 'ABC123',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      gameFamily: 'retail',
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(result.allBossFights.map((fight) => fight.id)).toEqual([1, 2, 3, 5]);
    expect(result.completedBossFights.map((fight) => fight.id)).toEqual([1, 2, 3]);
    expect(result.killBossFights.map((fight) => fight.id)).toEqual([2, 3]);
    expect(result.zoneDifficulties).toEqual([{ id: 4, name: 'Heroic', sizes: [10, 25] }]);
  });
});
