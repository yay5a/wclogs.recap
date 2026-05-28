# WCLogs Recap (Discord Bot) _in Beta_

![raidlogreport](docs/report-summary.png)
![encounter-breakdown](docs/encounter-breakdowns.png)

WCLogs Recap is a Discord bot that turns Warcraft Logs data into quick, readable raid summaries.

`wclogs.recap` fetches Warcraft Logs reports, normalizes the GraphQL payloads into typed raid report models, and renders concise Discordready summaries. The current beta focuses on `/report` for Warcraft Logs Classic raid reports, with Mongobacked caching and automatic report posting.
`/report`
`/guildrank`

## What the bot does

### `/report`

Use a Warcraft Logs report URL and get a summarized raidnight breakdown in Discord.

### `/guildrank` (still in development; may not work as intended)

Get a guild ranking/progress summary for your configured guild target, filtered by raid difficulty and raid size.

## Invite the bot to your server:

## Using `/report`

```text
/report wcl_report_url:<Warcraft Logs report URL>
```

Example:

```text
/report wcl_report_url:https://classic.warcraftlogs.com/reports/ABC123XYZ
```

What to expect:

The bot acknowledges first, then posts the summary after processing.
Output includes raidlevel highlights and topperformer style metrics.

If it fails:

Verify the URL is a valid Warcraft Logs report URL.
Retry after a short delay.

## Using `/guildrank`

_this feature still under development - `/guildrank` is usable, but will not show anything useful_

Command format:

```text
/guildrank difficulty:<difficulty> size:<size>
```

`difficulty` and `size` are selected from the command choices shown in Discord.

### Onetime guild target setup for `/guildrank`

`/guildrank` requires guild target values to already be configured for your server:

Warcraft Logs guild name
Warcraft Logs server name
Warcraft Logs server region
Warcraft Logs zone ID (numerical value of the raid instance)

## License

MIT
