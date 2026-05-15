1. Single Report Summary

- Command:
  `/report <wcl_report_url>`

## Scope:

Summarize performance of raid-night

Report Summary - Throne of Thunder (Heroic)
Date: M/D/Y
Start Time: HH:MM
End Time: HH:MM

- Duration: 2h 41m
- Boss Pulls: 37
- Total Kills: 9
- Total Wipes: 14
- Total Deaths: 149

🗿 Encounter Highlights

- Best Execution ⚔️:
  - Jin'rokh the Breaker (Heroic)
    - Pulls: 2
    - Kill/Wipes: 1/0
    - Deaths: 3
    - Highest Parse
      - DPS: PlayerA - _percentile_
      - HPS: PlayerB - _percentile_
      - DTPS: PlayerC - _percentile_
    - Highest Total DPS:
    - Highest Total HPS:
    - Highest Total DTPS:

- Biggest Trouble 👨‍🦼:
  - Council of Elders (Heroic)
    - Pulls: 14
    - Kill/Wipes: 0/14
    - Deaths: 146
    - Longest Pull: 6:09
    - Shortest Pull: 1:19
    - Highest Total DPS: 200,576
    - Highest Total HPS: 122,500
    - Highest Total DTPS:

🏋️‍♂️ Top Players:

- Highest Avg Parse:
  1. PlayerA - 78.8
  2. PlayerB - 75.2
  3. PlayerC - 73.9

- Highest Total DPS:
  1. PlayerA - 48.2M total damage
  2. PlayerB - 45.7M total damage
  3. PlayerC - 44.1M total damage

- Highest HPS:
  1. HealerA - 112.4k avg HPS
  2. HealerB - 108.7k avg HPS
  3. HealerC - 95.1k avg HPS

- Highest DTPS:
  1. TankA - 87.2k DTPS
  2. TankB - 81.5k DTPS
  3. PlayerA - 42.8k DTPS

- Most Deaths:
  1. PlayerX - 9 deaths
  2. PlayerY - 7 deaths
  3. PlayerZ - 6 deaths

- Most Interrupts:
  1. PlayerA -
  2. PlayerB -
  3. PlayerB -

- Most Dispels:
  1. PlayerA -
  2. PlayerB -
  3. PlayerC -

2. Guild Rank

- Command:
  - `/guildrank <difficulty> <size>`
    - e.g. `/guildrank heroic 10man`

- ## Scope:

Summarize current guild progress ranks with historical derived report scores for comparison with deltas:
_Progress, speed, and complete-raid speed rank positions come from WCL guild rankings when available; score rows are derived from discovered reports._

- 📈 Progress
  - Cleared:
  - World:
  - Region:
  - Realm:

- Guild Rankings
  - Speed
    - All-Star Ranks:
      - World:
      - Region:
      - Realm:
    - Complete Raid Ranks:
      - World:
      - Region:
      - Realm:
    - Best Avg Score: _score_ (± _delta_)
    - Median Avg Score: _score_ (± _delta_)
    - Best Encounter Gain
      - <Encounter Name> +_delta_
    - Per Encounter
      - <Encounter Name>
        - Best Score: _score_ (± _delta_)
        - Median Score: _score_ (± _delta_)
      - <Encounter Name>
        - Best Score: _score_ (± _delta_)
        - Median Score: _score_ (± _delta_)
      - <Encounter Name>
        - Best Score: _score_ (± _delta_)
        - Median Score: _score_ (± _delta_)
      - <Encounter Name>
        - Best Score: _score_ (± _delta_)
        - Median Score: _score_ (± _delta_)

  - Execution
    - Best Avg Score: _score_ (± _delta_)
    - Median Avg Score: _score_ (± _delta_)
    - Best Encounter Gain
      - <Encounter Name> +_delta_
    - Per Encounter
      - <Encounter Name>
        - Best Score: _score_ (± _delta_)
        - Median Score: _score_ (± _delta_)
      - <Encounter Name>
        - Best Score: _score_ (± _delta_)
        - Median Score: _score_ (± _delta_)
      - <Encounter Name>
        - Best Score: _score_ (± _delta_)
        - Median Score: _score_ (± _delta_)
      - <Encounter Name>
        - Best Score: _score_ (± _delta_)
        - Median Score: _score_ (± _delta_)

- Most Improved Characters
  - Damage
    - <Role>
      - <Character Name>
        - Avg %: _current_ (+_delta_)
        - Best Encounter Gain
          - <Encounter Name> +_delta_
  - Healing
    - <Role>
      - <Character Name>
        - Avg %: _current_ (+_delta_)
        - Best Encounter Gain
          - <Encounter Name> +_delta_

_Only characters who've improved across comparable encounters within a defined range
and had the strongest average improvement are listed._

- Comparing current 7-day period against the previous 14-day baseline.
- Requires 3 minimum valid encounter parses to avoid one-off outliers.
- Only include characters whose baseline average falls within the configured range to avoid listing characters with consistently high parses.
- Improvement calculated using:
  - Avg Delta = current_avg_percentile - baseline_avg_percentile
  - Best Encounter Gain = largest positive encounter-level percentile gain
