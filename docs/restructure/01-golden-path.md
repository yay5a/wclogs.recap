# Golden Path

## One thing the app must do end-to-end
A user pastes a Warcraft Logs report URL into Discord and receives a correct recap embed.

## Start and end of the path
Start:
- Discord slash command `/recap`
- report URL provided by user

End:
- public or preview recap embed rendered correctly in Discord

## Confirmed components currently on this path
- packages/discord
- packages/wcl-client
- apps/web
- apps/worker (only if truly involved in the live recap path)
- Cloudflare domain routing
- Warcraft Logs OAuth callback
- Discord interactions endpoint

## Components currently NOT required for this path
- probe scripts
- probe fixtures
- identity merge/review
- coaching/accountability services
- subscription/trend systems
- any DB models not required to generate/store/send a recap
- anything else not needed to go from report URL -> recap embed

## Current pain points on this path
- Transport and normalization mixed together
- Presentation and summary logic coupled
- Unclear MongoDB responsibility
- Command flow too tied to old summary shape

## Desired ownership after refactor
- Transport: fetches WCL data and returns source structures
- Domain: builds Outcome / Performance / Volume / Execution
- Presentation: renders recap domains into Discord embed content
- app/orchestration: wires command -> transport -> domain -> presentation

## Success test for this path
Given a known report URL, the new path can:
1. fetch data
2. build recap domains
3. render the Discord recap
4. produce output that is at least as correct as the current path

