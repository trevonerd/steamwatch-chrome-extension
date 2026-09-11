# Beta 6 — Test con API reali

Campione acquisito l’11 settembre 2026: otto applicazioni estratte casualmente, senza reinserimento, da un pool dichiarato di venti titoli, più Black Flag originale e Resynced come controlli. Il pool include Wallpaper Engine come controllo software; non è un campione rappresentativo dell’intero catalogo Steam. Selezione e risposte grezze sono registrate in `.sisyphus/evidence/beta6/live/`.

I conteggi seguenti sono fotografie al momento della prova, non valori attuali garantiti. Steam e SteamCharts aggiornano in momenti diversi: una differenza fra i due conteggi non prova un errore. Il conteggio principale rimane quello dell’API Steam.

| Titolo | App ID | Giocatori Steam | Ore importate | Periodi abilitati | Trend stagionale |
| --- | --- | ---: | ---: | --- | ---: |
| Assassin's Creed Black Flag Resynced | 3751950 | 2355 | 0 | 0/6 | Non disponibile |
| Assassin’s Creed® IV Black Flag™ | 242050 | 272 | 720 | 6/6 | -18.6% |
| Team Fortress 2 | 440 | 43961 | 720 | 6/6 | 0% |
| Cyberpunk 2077 | 1091500 | 24142 | 720 | 6/6 | -14.1% |
| Valheim | 892970 | 79269 | 720 | 6/6 | 23.2% |
| ELDEN RING | 1245620 | 24479 | 720 | 6/6 | 22.3% |
| Sid Meier’s Civilization® VI | 289070 | 27108 | 720 | 6/6 | -1.5% |
| Wallpaper Engine | 431960 | 75275 | 720 | 6/6 | -9.2% |
| Dota 2 | 570 | 476157 | 720 | 6/6 | -11% |
| Planet Zoo | 703080 | 2150 | 720 | 6/6 | -12.9% |

## Difetto riprodotto e corretto

Le API live hanno mostrato categorie Twitch mancanti per `Assassin’s Creed® IV Black Flag™` e `Sid Meier’s Civilization® VI`. Richiedendo gli stessi nomi con apostrofo ASCII, Twitch restituisce le categorie corrette. Due regressioni fallivano prima della correzione e passano dopo la normalizzazione: le chiamate ripetute hanno restituito rispettivamente 4 e 173 spettatori. Nessuna corrispondenza approssimativa fra giochi diversi è stata aggiunta.

## Replay temporale

Le risposte JSON originali sono conservate in `tests/fixtures/provider-sample-2026-09-11.json` e rigiocate attraverso il parser di produzione. Verificati conteggio Steam separato, nove curve distinte, sei periodi, copertura, limite dei punti, rifiuto di medie 60 giorni con solo 30 giorni orari e stato obsoleto dopo tre ore senza aggiornamenti.

Il replay su sette date precedenti produce tre date valutabili per gioco; le quattro più vecchie non hanno abbastanza baseline nella finestra oraria di trenta giorni offerta dal provider. I test verificano che fornire anche campioni successivi alla data di analisi non cambi il risultato.

Un secondo replay applica il modello a **48 istanti orari per ciascuno dei nove giochi**, per 432 valutazioni. Tutti questi istanti hanno copertura sufficiente. Team Fortress 2 rimane fra 0% e +2,3% mentre le osservazioni dell’ultimo giorno vanno da 39.757 a 55.706; Civilization VI rimane fra −2,3% e −1,5% con osservazioni fra 19.706 e 39.350. Entrambi restano classificati stabili attraverso tutte le 48 posizioni, nonostante l’ampia escursione giornaliera. Due regressioni aggiuntive fissano questo comportamento su dati acquisiti realmente.

**Questo verifica il comportamento su dati reali, non misura precisione o falsi allarmi.** Mancano etichette indipendenti degli eventi e storico orario sufficientemente lungo per un backtest rappresentativo. Non sono state adattate soglie ai dieci titoli osservati: evitare di calibrare e valutare sullo stesso piccolo campione.

## Riproduzione e build

`pnpm exec tsx scripts/check-live-providers.ts` esegue volontariamente nuove chiamate live e salva una nuova selezione e le risposte; non fa parte di `pnpm test`. Le fixture offline non dipendono dalla disponibilità futura dei servizi. La fonte storica è `https://steamcharts.com/app/{appid}/chart-data.json`; il live è `ISteamUserStats/GetNumberOfCurrentPlayers/v1` e i nomi arrivano da Steam Store AppDetails.

Versione visibile **2.0.0-beta.6**, numerica **2.0.1.6**. Build strict e **414 test in 31 file** superati. Nessuna pubblicazione stabile eseguita.

## Collaudo Chrome

Con le stesse dieci applicazioni e **richieste reali senza mock**: dieci conteggi, nove storici completi, sei periodi per ogni storico disponibile, messaggio corretto per Resynced e spettatori Twitch di Civilization VI popolati. Il monitoraggio delle scritture verifica che la cache cresca fino a dieci giochi senza perdere quelli già acquisiti. Nessun errore JavaScript. Le tre schermate di viewport hanno superato una revisione visiva indipendente; una precedente immagine a pagina intera aveva artefatti dovuti agli elementi sticky e non è usata come evidenza finale.

Superata anche la prova di [riavvio, offline e recupero](lifecycle-validation.md): worker arrestato via CDP, nuovo worker riattivato, errore offline con cache preservata, risposta successiva salvata sia in cache sia in IndexedDB. Le risposte della prova di fault sono controllate; non è una simulazione del sonno dell’intero sistema operativo.

Restano da validare sul lungo periodo le prestazioni statistiche rispetto a eventi annotati indipendentemente e la presentazione dei banner con le impostazioni del sistema operativo dell’utente. Non viene dichiarata una precisione del trend che questi test non misurano. `vexp verify_done` è stato tentato ma il daemon non risponde; non è conteggiato tra i controlli superati.
