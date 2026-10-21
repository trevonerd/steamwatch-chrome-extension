# Black Flag Resynced: storico e statistiche

## Verifica sul Chrome dell'utente — beta 14

Letto lo storico effettivo di `3751950` tramite la console dell'estensione: 1.947 osservazioni, 1.430 Games Popularity e 517 Steam. Ultimo campione remoto `2026-09-15T23:06:17.530Z`; ultimo campione locale al controllo `2026-09-16T16:41:34.808Z`. La raccolta locale recente procede ogni cinque minuti e l'allarme `sw_fetch` conferma `periodInMinutes: 5`. Due zeri preesistenti hanno provenienza Steam/instant; non sono stati cancellati. Nessuna modifica manuale ai dati salvati.

Verificati anche OpenAPI, endpoint latest, grafico pubblico completo e grafico `/7` di Games Popularity: tutti terminano alla stessa osservazione della sera precedente, anche senza cache. Nessun endpoint verificato restituisce le ore mancanti. Il conteggio Steam corrente non è uno storico retroattivo.

Il confronto settimanale della scheda ora cerca l'ultimo periodo affidabile entro 48 ore, mantenendo le soglie di almeno 20 ore abbinate al giorno. L'età è visibile nel badge e il termine esatto nel tooltip e nel testo condiviso. Il percorso degli alert continua a valutare esclusivamente la finestra corrente. “All” riepiloga le ore completate realmente osservate, con almeno due ore e copertura complessiva dell'80%; i buchi non diventano zeri. I periodi fissi mantengono le precedenti garanzie di completezza.

Ricaricata l'estensione reale e verificata la versione `2.0.0-beta.14`: Black Flag mostra **−25,1% 7d · 16h ago** con termine `2026-09-16T00:00:00.000Z`; All mostra **13,0k** di media e **−61,1k** di variazione. Gli altri quattro giochi conservano i confronti correnti. Tutti gli otto riquadri restano presenti, senza i paragrafi rimossi su richiesta. La correzione del layout consente al badge lungo di andare a capo senza sovrapporsi alle statistiche.

Le ore mai raccolte e non disponibili presso i provider rimangono buchi reali; la correzione non dichiara lo storico completo. Il picco 24h di SteamCharts rimane indisponibile per questo gioco. Verifiche finali: compilazione strict e build riuscite, 484 test superati in 35 file, sei filtri e otto riquadri verificati in Chromium, controlli visivi indipendenti superati. Evidenze di regressione e controllo visivo isolato: `.sisyphus/evidence/blackflag-beta14/`.

## Rettifica dopo il riscontro dell'utente — beta 13

Il controllo precedente aveva lasciato irrisolto il blocco dei filtri: le soglie di copertura e freschezza necessarie ai confronti statistici erano applicate anche alla semplice visualizzazione. Con un buco recente tutti i periodi potevano essere disabilitati pur contenendo osservazioni visibili in All. Un test sul modello ha riprodotto esattamente `['all']` invece dei sei periodi; la correzione abilita ciascun periodo contenente almeno un campione valido e conserva i buchi nel grafico. Anche campioni live insufficienti per una media oraria restano visualizzabili.

L'utente voleva rimuovere le scritte esplicative, non i riquadri. Ripristinati Current, 24h peak, record e Twitch; mantenuti i quattro riquadri del periodo. Rimossi dal pannello i paragrafi su copertura, confronti settimanali/giornalieri e intervalli di date. Fonte e date restano nel tooltip del grafico.

Beta consegnata: `2.0.0-beta.13`, versione Chrome `2.0.1.13`. Prova su vera estensione Chromium con storico interrotto: selezionati tutti i sei filtri, grafico visibile per ciascuno, otto riquadri presenti, nessun errore o overflow. Evidenze aggiornate in `.sisyphus/evidence/blackflag-correction/`. Le sezioni successive documentano la diagnosi e le verifiche della precedente correzione, non la UI finale.

## Riscontro del 16 settembre 2026

Le API pubbliche per `3751950` restituiscono:

- SteamCharts: HTTP 200, storico vuoto (`[]`).
- Games Popularity: due pagine, 1000 e 637 osservazioni; 1420 entro gli ultimi 60 giorni. Ultima osservazione: `2026-09-15T23:06:17.530Z` (16 settembre, 01:06 in Italia). Mancano le ore successive e 12 ore isolate nel periodo precedente. Nessuno zero nelle due pagine acquisite.
- Steam live: 3074 giocatori con `result: 1` al momento del controllo.

Le risposte sono conservate localmente in `.sisyphus/evidence/blackflag-2026-09-16/`. Il controllo non ha letto né modificato lo storage del browser personale. Non dimostra la provenienza dello zero già presente nello storico dell'utente.

Il 99% di copertura su circa 60 giorni è compatibile con molte ore recenti mancanti. Una nuova lettura del conteggio corrente non recupera quelle ore. L'[API Steam del conteggio corrente](https://partner.steamgames.com/doc/webapi/isteamuserstats#GetNumberOfCurrentPlayers) restituisce i giocatori attivi adesso; lo storico viene dalle altre fonti e dalle osservazioni locali.

## Correzioni

- Lo stato dell'attività usa l'ultima ora qualificata completata: un campione live isolato non nasconde più uno storico arretrato dietro “Building history”. Un gioco appena aggiunto resta correttamente in raccolta.
- Refresh manuale può ricontrollare un import completato ma arretrato di oltre due ore dopo 15 minuti dall'ultimo import. Restano il ciclo automatico di sei ore, le protezioni contro richieste concorrenti e i limiti HTTP del provider.
- La validazione Steam rifiuta un `result` esplicitamente diverso da 1. Uno zero con esito positivo resta valido. Non sono rimossi campioni storici la cui origine non è dimostrabile.
- Rimossi i numeri davanti ai primi tre giochi e le statistiche ripetute nei dettagli. Le statistiche del grafico indicano il periodo selezionato.
- Corretto l'allineamento orario della media “All”, che poteva produrre valori assenti anche con una serie regolare. Le serie realmente incomplete restano senza medie affidabili.

## Verifica e limiti

Le regressioni sono state eseguite prima delle correzioni e hanno riprodotto gli errori. Build TypeScript riuscita e suite Vitest completa: **467 test in 35 file superati**. Revisione indipendente della logica senza blocchi.

Popup verificato in una vera estensione Chromium con profilo separato e dati controllati: storico arretrato di 16 ore con conteggio live recente, storico completo di 60 giorni, gioco con sole cinque ore. Stato arretrato corretto, media All disponibile solo quando affidabile, numeri dei primi tre giochi assenti, selettore All funzionante, nessun overflow orizzontale e nessuna eccezione del popup. Screenshot e risultati in `.sisyphus/evidence/blackflag-audit/`.

Non sono state abbassate le soglie del trend settimanale né interpolate ore mancanti. Con la fonte ancora arretrata, “History stale” e confronti non disponibili restano risultati corretti. Non è stata creata una release né cambiata la versione.

RTK utilizzato. vexp e il grafo sono stati interrogati, ma il primo rispondeva con un repository diverso e il secondo non aveva SteamWatch indicizzato: i loro risultati non sono stati usati come verifica del codice.
