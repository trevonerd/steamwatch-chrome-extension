# SteamWatch Privacy Policy

Last updated: September 11, 2026

SteamWatch has no analytics or developer-operated data collection service and does not sell user data. Settings and history stay locally in the browser. Requests to the providers below necessarily disclose network information, including the user's IP address, to those providers.

## Data Stored Locally

SteamWatch stores the following data locally in the user's browser:

- tracked Steam games selected by the user
- extension settings and notification preferences
- toolbar badge preference
- cached public game metadata
- local player-count history for tracked games
- notification rule state, pending delivery identifiers and cooldown timestamps

This data is stored using Chrome storage and IndexedDB. It stays on the user's device and is used only to provide SteamWatch features.

## Network Requests

SteamWatch sends network requests to third-party services for game data and interface resources:

- Steam and Steam Store, for game metadata and player counts
- SteamSpy and SteamCharts, for public player-count and peak data
- Games Popularity, for hourly player history when SteamCharts history is unavailable or fails
- Twitch GraphQL, for public Twitch viewer counts
- Steam image CDN domains, for game thumbnails and artwork
- Google Fonts (`fonts.googleapis.com` and `fonts.gstatic.com`), for interface fonts when popup or options pages open

Game-data requests include the selected game identifiers or the search text entered in the extension. Font requests occur independently of the game list. Third parties receive normal HTTP request metadata and handle it under their own policies; SteamWatch does not control their retention. The extension does not attach the user's local settings or player-history database to these requests.

## No Remote Code

SteamWatch does not load or execute remote JavaScript or WebAssembly. All extension code is included in the packaged extension.

## No Account Required

SteamWatch does not require an account, login, email address, or any other personally identifying information.

## No Browsing History Tracking

SteamWatch does not read, collect, or transmit the user's browsing history, page content, keystrokes, mouse activity, or personal communications.

## Data Sharing

SteamWatch does not sell user data. Third-party disclosures are the game-data, artwork and font requests described above; the local settings and history database are not uploaded.

## Contact

For questions about this privacy policy, contact Trevisoft through:

https://trevisoft.dev
