# Fase 3 — Refresh coordinato e freschezza

11 settembre 2026. Versione visibile **2.0.0-beta.3**; versione numerica Chrome `2.0.1.3`. Il numero visibile resta sulla base 2.0.0 e aumenta soltanto la beta. Il manifest numerico deve rimanere superiore alla precedente build 2.0.1. Modifiche locali, senza commit, push o release pubblica.

## Comportamento

Il popup presenta subito i dati salvati. Se manca un conteggio o ha almeno un minuto, richiede l’aggiornamento al background. Finché resta visibile controlla ogni minuto; l’allarme di background resta a cinque minuti. Non è uno stream continuo: la freschezza dipende dalla frequenza delle richieste e dalla fonte.

Apertura, Refresh e allarme condividono lo stesso ciclo live quando si sovrappongono. Ogni gioco pubblica il proprio conteggio Steam appena disponibile. Storico, picchi e Twitch lavorano separatamente; i loro risultati aggiornano il popup attraverso eventi storage. Il completamento di un’importazione storica pubblica un evento solo dopo il commit dei dati. Dettagli aperti e periodo selezionato vengono conservati durante il rendering successivo.

I metadati hanno una frequenza distinta: picchi circa un’ora, Twitch cinque minuti, tentativi falliti o risultati assenti cinque minuti. Lo storico conserva lease persistente di due minuti, retry progressivo e aggiornamento dopo sei ore della fase 2. Aprire il popup non scarica ripetutamente tutto lo storico.

## Affidabilità e provenienza

- Trasporto condiviso: al massimo tre richieste per origine, timeout che copre intestazioni e corpo, un retry per errori transitori. Un Retry-After lungo blocca nuove richieste a quell’origine fino alla scadenza, senza tenere il popup in attesa.
- Per conteggio corrente, picco 24h, record e Twitch si conservano fonte, esito e tempo di acquisizione. Un errore aggiorna il tentativo, non l’età del valore precedente. Il tooltip del dato espone queste informazioni.
- Ultimo tentativo live e ultimo successo sono distinti. Un fallimento totale non aggiorna il timestamp di successo; un successo parziale conserva i giochi falliti con stato esplicito.
- Twitch distingue zero spettatori da categoria assente e da errore di rete. La categoria assente cancella il precedente valore; un errore conserva la cache con il suo tempo di acquisizione.
- Un errore Steam non impedisce tentativi alle fonti secondarie. I dati live non vengono sostituiti silenziosamente con un conteggio HTML di età sconosciuta.
- Le scritture ricontrollano che il gioco sia ancora seguito. Le risposte di giochi diversi non sovrascrivono la cache reciproca; il badge legge cache e preferito correnti dopo il completamento dei lavori asincroni.

## Verifica

Build con TypeScript strict superata; suite completa di **403 test in 20 file superata**; `git diff --check` pulito. Revisione indipendente dei due casi di concorrenza e controllo visivo dei quattro stati superati. Artefatti locali ignorati da Git: `.sisyphus/evidence/phase3/build.log`, `tests.log`, `qa.cjs`, `qa-result.json` e screenshot degli stati cache, live prima dello storico, storico aggiornato ed errore parziale.

La prova usa Chromium reale e un profilo temporaneo eliminato alla fine. Il conteggio live è una fixture intenzionalmente distinta dal dato salvato; lo storico proviene dalle risposte pubbliche registrate nella fase 2. Non è una misura delle prestazioni dei provider in produzione né una modifica al profilo personale dell’utente.

Scenari: cache leggibile mentre Steam è in attesa; tre richieste concorrenti condividono un ciclo; conteggio e badge arrivano prima del backfill; completamento del backfill abilita i filtri nel popup già aperto; Refresh conserva la selezione 7d; errore successivo conserva conteggio e tempo di acquisizione e mostra aggiornamento parziale. Controllo di assenza di eccezioni JavaScript nel popup.

La verifica vexp finale è stata tentata ma il daemon non risponde; non viene dichiarata superata. Compilazione strict, test e revisione dei chiamanti costituiscono le verifiche effettivamente eseguite.

## Prossimo checkpoint

Fase 4: trend con stagionalità giornaliera/settimanale e copertura esplicita. L’algoritmo attuale non è ancora quello richiesto per distinguere il normale calo notturno da una perdita persistente di giocatori. Anche statistiche e trattamento grafico dei picchi mensili nella finestra All restano da completare nelle fasi previste: questa fase migliora consegna e freschezza, non certifica quei calcoli.

Per verificare questa build: ricaricare `dist/` in chrome://extensions e controllare **v2.0.0-beta.3** nel footer del popup. Aprire i dettagli, scegliere un periodo, premere Refresh e verificare che selezione e pannello restino aperti.
