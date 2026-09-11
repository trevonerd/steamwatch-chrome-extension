# Beta 5 — Resynced, trend, notifiche e coerenza

Build visibile: **2.0.0-beta.5**. Versione numerica Chrome: **2.0.1.5**, mantenuta sopra le build già installate. Aumenta soltanto il contatore beta visibile. Cartella da ricaricare: `dist/`.

## Correzione della segnalazione

La schermata dell'utente riguarda **Assassin’s Creed Black Flag Resynced, app 3751950**. La precedente verifica della beta 4 riguardava invece **Assassin’s Creed IV Black Flag, app 242050**: non dimostrava il funzionamento del titolo segnalato.

Nella verifica del provider, Resynced restituisce pagina SteamCharts 404 e storico JSON vuoto. Il conteggio live Steam è una richiesta distinta. L'estensione ora registra esplicitamente `unavailable` per storico assente, separatamente da errori di rete e import falliti. Ritenta automaticamente dopo sei ore; Refresh può anticipare il recupero degli stati non completati, rispettando i limiti HTTP.

I vecchi snapshot senza provenienza e granularità affidabile restano conservati, ma non diventano osservazioni orarie, medie o trend. Un picco SteamSpy o locale non viene etichettato come record assoluto SteamCharts. La schermata espone il massimo osservato separatamente. Un fallimento di acquisizione non può attribuire retroattivamente una provenienza valida a un valore legacy.

**I filtri restano disabilitati quando manca copertura sufficiente.** Non esiste una chiamata API capace di restituire dati che il provider non possiede. La correzione evita dati plausibili ma falsi e spiega l'assenza; non promette uno storico completo per ogni gioco dal primo avvio.

## Fase 4 — Analisi

Normalizzazione oraria riutilizzata per tutte le metriche della card. Una misura oraria SteamCharts è ammissibile; i campioni Steam locali richiedono almeno 45 minuti di osservazioni nella stessa ora senza intervalli superiori a 15 minuti. Picchi mensili, aggregati non comparabili e valori futuri non alimentano il modello.

Il trend confronta sette giorni completi con le stesse ore e gli stessi giorni delle settimane precedenti. Richiede almeno tre confronti storici per ora, almeno l'80% di copertura comparabile e venti ore comparabili per ciascun giorno. Usa la mediana delle variazioni relative; l'ultima osservazione qualificata deve avere meno di due ore e la baseline media deve essere almeno dieci giocatori.

Il risultato distingue disponibile, insufficiente, obsoleto e baseline troppo bassa. Il vecchio ripiego sulla differenza fra due punti non viene più mostrato come trend. La misura descrive attività contemporanea, non utenti unici persi o cause organiche del calo. Le soglie sono impostazioni beta, non parametri già calibrati su eventi reali annotati. Vedere [validazione stagionale](seasonal-validation.md).

## Fase 5 — Notifiche e badge

Regole indipendenti sopra/sotto conteggio assoluto e sopra/sotto variazione stagionale. Una nuova regola osserva lo stato iniziale senza notificare immediatamente. L'attraversamento deve permanere almeno cinque minuti, con due osservazioni fresche; una lacuna superiore a quindici minuti riavvia la qualificazione. L'isteresi di riarmo è il maggiore fra un giocatore e il 2% della soglia assoluta; per il trend è cinque punti percentuali.

Gli eventi pendenti sono persistiti prima della consegna. Quiet hours e fallimenti di consegna non consumano l'evento; una successiva osservazione ancora valida può ritentare lo stesso ID. La valutazione e consegna sono serializzate per gioco; rimozione e nuova configurazione eliminano lo stato non più pertinente.

Il preferito aggiorna il badge dalla cache senza fetch completo. Il dato obsoleto o una richiesta corrente fallita producono `?`. Le opzioni consentono anche una soglia inferiore pari a zero e respingono input numerici non validi.

## Fase 6 — Interfaccia e condivisione

Il controller popup è separato dal modulo `popup/graphs.ts`. Card, pannello e condivisione ricevono un ViewModel coerente; il pannello non rilegge IndexedDB a ogni click. Cambiare periodo aggiorna grafico, media, variazione e minimi/massimi osservati. Conteggio corrente, picco 24 ore del provider, record e Twitch restano metriche esplicitamente distinte dal periodo selezionato.

Asse X temporale, interruzioni per lacune superiori a due ore, massimo globale di 200 punti nei dettagli e conservazione degli estremi nel downsampling. Tooltip con timestamp e conteggio; intervallo e copertura oraria visibili. Pulsanti con stato selezionato accessibile e motivazione per i periodi disabilitati. Una sola osservazione è un punto, non una curva inventata.

Testo condiviso distingue record del provider, massimo osservato e indisponibilità del trend. L'immagine condivide la serie temporale delle ultime 24 ore senza unire lacune; il caricamento della copertina ha una scadenza e un fallback.

## Fase 7 — Verifiche e limiti di accettazione

Build con typecheck strict e **398 test superati in 30 file**; estensione caricata realmente in Chrome for Testing con profilo temporaneo. Il collaudo riproduce Resynced con sessanta campioni legacy ambigui, storico provider vuoto e conteggio valido; verifica separatamente Black Flag originale con fixture acquisita dal provider, tutti i sei periodi, selezione coerente e assenza di errori JavaScript. Verificati salvataggio soglia inferiore e generazione PNG tramite il reale flusso di condivisione.

Revisione visiva indipendente: nessun blocco sulle schermate del popup e delle opzioni. Le prove di consegna notifiche usano l'API Chrome simulata: non attestano la presentazione del banner da parte del sistema operativo o il funzionamento a computer sospeso.

Misure e relativi ambiti sono in [prestazioni](performance-results.md). In Chrome, con 172.800 campioni su dieci giochi: conteggi visibili p95 74,41 ms, storico completamente caricato p95 878,82 ms, cambio periodo p95 33,31 ms. Nessun long task osservato nelle cinque esecuzioni misurate. Il completamento dello storico resta separato dalla prima visualizzazione. I conteggi da cache vengono mostrati prima che finisca la lettura dello storico; durante questa fase il dettaglio indica il caricamento in corso. Il calcolo riusa la normalizzazione e cede il thread fra giochi; il rendering grafico limita globalmente i punti. I test dei provider sono deterministici e separati dall'accesso live.

Non sono completati un backtest su eventi reali annotati, la calibrazione del tasso di falsi allarmi e un collaudo prolungato di sospensione/risveglio del sistema. Questi limiti impediscono di dichiarare l'estensione “perfetta” o pronta a una release stabile. La beta è pronta per il controllo dell'utente; non sono stati eseguiti tag o pubblicazione GitHub.

Il controllo supplementare `vexp verify_done` non è disponibile: il daemon non risponde. Build, typecheck, test e collaudo Chrome forniscono le verifiche effettivamente eseguite.
