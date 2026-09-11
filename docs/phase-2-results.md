# Fase 2 — Storico remoto e persistenza

11 settembre 2026. Build di verifica **2.0.1-beta.2** (manifest numerico `2.0.1`). Modifiche locali; nessun commit, push o rilascio pubblico.

## Risposta al feedback sui grafici

Il problema è stato riprodotto in Chromium con un database v3 e sei campioni locali per gioco distribuiti su 25 minuti: Dota 2 e CS2 mostrano la stessa linea normalizzata e cinque filtri disabilitati. Questo non dimostra quali record siano nel profilo dell’utente, che non è stato letto o modificato; dimostra il meccanismo che produce il sintomo.

Il diff della fase 1 non modificava bootstrap, persistenza degli snapshot, selezione dei periodi o calcolo delle coordinate. Il vecchio bootstrap scriveva invece un cooldown di dieci anni prima del download. Un primo errore poteva lasciare i giochi con il solo storico locale e impedire nuovi tentativi.

Il test di regressione precedente alla correzione ha osservato proprio una chiamata a `idbSetCooldown("bootstrap__123", ...)` prima dell’importazione. La nuova implementazione usa uno stato distinto, recuperabile dopo errore o riavvio.

## Cosa forniscono effettivamente le fonti

Steam documenta `GetNumberOfCurrentPlayers` come conteggio corrente dei giocatori collegati a Steam. Non è uno storico: [documentazione Steamworks](https://partner.steamgames.com/doc/webapi/ISteamUserStats#GetNumberOfCurrentPlayers).

Le risposte reali di SteamCharts per [Dota 2](https://steamcharts.com/app/570/chart-data.json), [CS2](https://steamcharts.com/app/730/chart-data.json) e [Overwatch](https://steamcharts.com/app/2357570/chart-data.json), acquisite in questa sessione, contengono circa un mese di campioni orari. Misura alle 08:24 UTC: 719 punti negli ultimi 30 giorni e gap massimo circa 1,04 ore, per ciascuno dei tre giochi. L’ultimo punto era intorno alle 07:01 UTC: storico remoto e conteggio live non hanno la stessa freschezza.

Il prefisso della serie contiene punti a risoluzione diversa; i valori ai confini mensili corrispondono ai picchi mensili della tabella SteamCharts. L’adattatore distingue una sequenza oraria, i picchi mensili e i punti di risoluzione sconosciuta. È una classificazione del formato osservato, non una garanzia contrattuale del provider. I payload sono conservati negli artefatti locali ignorati da Git.

Conseguenza: i filtri recenti possono essere popolati dal provider senza aspettare settimane di raccolta locale. IndexedDB conserva il backfill come cache e le osservazioni live come integrazione; la raccolta locale non viene assunta completa. Non è stato introdotto un backend né un provider a pagamento.

## Modifiche

- Bootstrap con lease persistente di due minuti, importazione e completamento nella stessa transazione; il vecchio cooldown non impedisce più il recupero. Errori ritentati con backoff da 15 minuti fino a sei ore; uno storico acquisito viene aggiornato dopo sei ore. Timeout del download storico: 15 secondi.
- Importazione validata: timestamp futuri/invalidi e conteggi negativi vengono respinti; i negativi non diventano falsi zeri. Fonte e granularità restano associate ai dati.
- Deduplicazione per gioco, timestamp e tipo di misura: un picco mensile e un aggregato non si cancellano a vicenda. Le osservazioni Steam prevalgono sulle osservazioni importate allo stesso timestamp.
- Compattazione atomica con conservazione di somma, numero di campioni, estremi con timestamp e durata osservata. I dati di qualità sconosciuta e i picchi mensili non vengono mediati come osservazioni live. Le scritture live aggiornano soltanto i timestamp interessati.
- Migrazione conservativa e ripetibile; record legacy conservati con qualità sconosciuta, errori non marcati come migrazione completata.
- Rimozione riconciliabile: pulizia di storico, stato bootstrap, cooldown, cache, impostazioni, dati legacy e preferito. Un marcatore persistente permette di riprendere una rimozione interrotta; il blocco delle scritture del gioco rimosso invalida importazioni pendenti.
- I soli dati importati o legacy non qualificano notifiche di trend. Il nuovo algoritmo stagionale non è ancora implementato.
- Minimo e massimo leggono gli estremi degli aggregati; zero resta un conteggio valido. Questo adattamento è stato anticipato dalla fase 4 per non perdere il significato degli estremi dopo la compattazione.

## Verifica

Gate finale: build con TypeScript strict superata; **372 test in 16 file superati**; `git diff --check` pulito. vexp è stato utilizzato per la discovery; la verifica finale `verify_done` non è disponibile perché il daemon non risponde, quindi non viene dichiarata superata. Verifica dei chiamanti e test effettivi eseguiti sui file modificati.

Test regressione inizialmente rossi per cooldown anticipato, dati futuri/negativi, provenienza, estremi compattati; test aggiuntivi per retry, rollback, concorrenza, duplicati, cancellazione e migrazione interrotte.

Chromium reale, profilo temporaneo: database v3 con vecchi sentinel, importazione tramite vero messaggio `FETCH_NOW` e risposte reali registrate dei tre provider storici. Dopo Refresh tutti i sei periodi diventano selezionabili e le serie dei tre giochi differiscono; un secondo Refresh non ripete il download storico. Nessun errore JavaScript non gestito nel popup. Il profilo viene chiuso e cancellato; nessuna modifica al browser personale dell’utente.

Harness e risultati: `.sisyphus/evidence/phase2/qa.cjs`, `qa-result.json`, `sparse-before.png`, `history-after.png`. I piccoli campioni iniziali sono fixture artificiali per riprodurre il difetto, non misure live dei tre giochi.

## Limiti e prossimo controllo

La fase 3 resta da autorizzare dopo questo controllo. Refresh live coordinato, freschezza per campo, trend stagionale, regole di notifica e revisione completa dei grafici restano nelle fasi successive. In particolare l’asse X, il downsampling, il trattamento visivo della serie All e le statistiche dei periodi non sono stati ridisegnati: conservare la granularità in persistenza prepara questa correzione, ma non la sostituisce.

Per il controllo: ricaricare l’estensione da `dist/`, verificare `v2.0.1-beta.2`, premere Refresh e aprire i dettagli dei giochi. Non serve rimuovere e riaggiungere i giochi. Un provider indisponibile può ancora lasciare finestre disabilitate; i tentativi successivi non sono più bloccati per dieci anni.
