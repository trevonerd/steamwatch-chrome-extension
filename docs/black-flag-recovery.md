# Black Flag — recupero dello storico

11 settembre 2026, **2.0.0-beta.4** (manifest Chrome `2.0.1.4`). Correzione del checkpoint della fase 3; la fase 4 del trend non è stata implementata in questa build.

## Riscontro

La risposta pubblica [SteamCharts per app 242050](https://steamcharts.com/app/242050/chart-data.json), acquisita in questa sessione con HTTP 200, contiene 932 punti, di cui circa 720 osservazioni orarie negli ultimi 30 giorni. Il massimo intervallo fra campioni recenti è circa 1,20 ore. Il backfill è quindi sufficiente ad abilitare tutti i sei periodi con le regole attuali dell’estensione.

Non ho letto lo storage del browser personale dell’utente: non posso attribuire con certezza il suo caso a uno specifico errore di rete o stato persistito. Ho però riprodotto un percorso concreto che genera lo stesso sintomo: primo import fallito, stato di retry persistente e periodi disabilitati; il pulsante Refresh della beta 3 non superava l’attesa prevista per il retry automatico.

## Correzione

Il Refresh esplicito richiede il recupero degli import falliti. Non scavalca un’importazione già attiva, la validità dello storico già completato, il blocco dei giochi rimossi o il Retry-After imposto dal provider. Gli aggiornamenti automatici continuano a rispettare il backoff.

La richiesta di recupero funziona anche quando è già attivo un ciclo live condiviso. Lo storico rimane un lavoro separato, per non bloccare conteggi e badge. Tutti i periodi rimangono visibili nei dettagli; quelli privi di storico sufficiente sono disabilitati con spiegazione, senza inventare dati.

## Verifica

- Tre regressioni inizialmente rosse: lease fallita non recuperabile, messaggio manuale privo della richiesta di recupero, richiesta sovrapposta a ciclo live senza recupero dello storico.
- Regressione UI inizialmente rossa: filtri assenti e nessuna spiegazione quando manca lo storico.
- Test di integrazione con risposta Black Flag registrata, API reale dell’applicazione, IndexedDB in memoria e orologio fissato: fallimento, retry automatico bloccato, recupero manuale, sei periodi disponibili e nessun nuovo download dopo il completamento.
- Build strict e **408 test in 21 file superati**.
- Chromium con profilo temporaneo: HTTP 503 simulato sullo storico, sei filtri disabilitati, ripristino della fonte e Refresh prima della scadenza del backoff; tutti i filtri abilitati, selezione 7d conservata e nessuna eccezione JavaScript nel popup. Revisione visiva indipendente superata.

Artefatti locali ignorati da Git in `.sisyphus/evidence/phase4/`: `retry-red.log`, `popup-red.log`, `build.log`, `tests.log`, `qa-blackflag.cjs`, `qa-result.json` e screenshot `black-flag-unavailable.png`/`black-flag-recovered.png`. Il nome della directory segue il contatore beta; non certifica il completamento della fase 4. Fixture versionata in `tests/fixtures/black-flag-history.json`.

vexp è stato tentato per discovery e verifica, ma il daemon non risponde. Nessun commit, push o rilascio pubblico delle modifiche della beta.

## Controllo

Ricaricare l’estensione da `dist/`, verificare `v2.0.0-beta.4`, premere Refresh e riaprire i dettagli di Black Flag. Non serve cancellare i giochi o lo storage. Un provider ancora indisponibile può lasciare i filtri disabilitati; il recupero manuale ora esiste e l’assenza di storico viene spiegata.

Il prossimo passo resta il trend stagionale della fase 4. Le attuali regole di copertura, statistiche e resa delle serie miste non sono state certificate come definitive da questa correzione.
