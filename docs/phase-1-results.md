# Fase 1 — Correzioni e verifica

11 settembre 2026. Fase inizialmente verificata su 0.14.7, poi identificata come **2.0.0-beta.1** su richiesta dell’utente. Modifiche locali, senza commit, push o rilascio di questa fase.

## Identificazione della build beta

- Manifest numerico `2.0.0`, `version_name` `2.0.0-beta.1`; package sincronizzato tramite `pnpm version-sync`.
- Popup e About leggono la versione dal manifest dell’estensione caricata. Le consegne successive incrementano patch e contatore beta, come documentato in `AGENTS.md`.
- Build e typecheck PASS; 351 test PASS, inclusi nome beta e fallback numerico.
- Chromium reale: verificati versione tecnica, footer del popup, About e sidebar; screenshot in `.sisyphus/evidence/beta1/`.

## Modifiche

- `pnpm run typecheck` esegue TypeScript strict; `pnpm run build` lo richiede prima di generare il bundle.
- Corretto lo schema AppDetails: risposte Steam con appid come chiave restituiscono nome e immagine; capsule preferita, header come fallback, immagine assente gestita.
- Schemi Zod per giochi, cache, impostazioni e messaggi del worker. Letture di dati malformati recuperano gli elementi/campi validi e salvano la forma normalizzata. Il campo legacy `peak` rimane supportato solo quando numerico, finito e non negativo.
- Orari quiet hours accettati solo in formato valido `HH:MM`. Override per gioco non finiti o con segno errato vengono scartati, lasciando il fallback globale; zero rimane ammesso per la soglia assoluta.
- La barra di aggiornamento resta visibile al termine del caricamento e legge il timestamp successivo all’eventuale hydration.
- Un helper condiviso controlla la risposta di `FETCH_NOW`: `{ok:false}`, risposta malformata e problemi di connessione non diventano successi apparenti.
- Nel popup, errore di aggiornamento manuale, hydration o badge mostra il pannello di errore esistente. Retry ripete la richiesta al worker. Dopo il cambio preferito, un eventuale messaggio chiarisce che il preferito è salvato ma il badge non è aggiornato.
- Corretti i mock TypeScript dei test e l’eliminazione del callback opzionale di cleanup, senza soppressioni dei tipi.

## Evidenza

- Test nuovi eseguiti prima delle correzioni: fallimenti AppDetails, visibilità della barra, errori del worker, recupero storage e timestamp dopo hydration.
- `pnpm run build`: PASS, incluso `pnpm run typecheck`.
- `pnpm test`: PASS, 349 test in 16 file (306 test prima della fase).
- `git diff --check`: PASS.
- Estensione `dist/` caricata in Chromium reale con profilo temporaneo: lista e barra visibili, errore di un vero `FETCH_NOW` mostrato dopo un guasto controllato dello storage nel worker, refresh riabilitato, Retry funzionante. Nessun errore JavaScript non gestito nella pagina.
- Provider isolati nella prova browser: non è una certificazione della disponibilità live delle API esterne. Il profilo temporaneo è stato chiuso e rimosso; dati dell’estensione dell’utente non toccati.
- Screenshot e harness locali: `.sisyphus/evidence/phase1/`. Questi artefatti sono ignorati da Git.

La verifica vexp ha indicato due import mancanti (`FETCH_INTERVAL_MINUTES` e `TRACKING_RETENTION_DAYS`), ma entrambi sono ancora esportati da `src/utils/storage.ts:25` e `:26`. Typecheck e build li risolvono correttamente: il risultato del grafo è un falso positivo. I chiamanti segnalati sono stati controllati e tutte le suite impattate sono incluse nei 349 test verdi; i riferimenti generici a `get` in compaction/IndexedDB non richiedono modifiche al loro contratto.

## Controllo manuale suggerito

1. Ricaricare l’estensione dalla cartella `dist/` in Chrome.
2. Aprire il popup con giochi già seguiti: controllare conteggio e barra di aggiornamento.
3. Usare Refresh e cambiare preferito; verificare che i normali flussi restino utilizzabili.

Il pannello di errore/Retry è già stato esercitato con un guasto controllato nel profilo di test. La sola modalità offline non garantisce lo stesso errore: il worker attuale può ancora rispondere `ok:true` quando tutte le fonti falliscono, problema del ciclo di refresh previsto nella fase 3.

La fase 2 non è iniziata. Bootstrap, compattazione, nuovo trend, soglie a stati e revisione completa dei grafici restano nelle rispettive fasi del piano. I file vexp modificati prima di questa fase sono stati preservati.
