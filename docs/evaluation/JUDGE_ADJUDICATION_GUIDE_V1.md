# Judge human adjudication v1

## Obiettivo

Questa revisione verifica se i disaccordi di GPT-5.4 Nano derivano dal judge, dalla prima revisione umana o da evidenza recuperata insufficiente. Non modifica né elimina gli artefatti originali.

## Apertura

1. Avviare il progetto con `npm run dev`.
2. Aprire `http://localhost:3000/evaluation/judge-adjudication`.

## Fase 1 — valutazione cieca

Valutare tutti i 15 casi usando soltanto:

- domanda;
- fatti attesi;
- risposta candidata;
- evidenza congelata.

La prima revisione e GPT-5.4 Nano rimangono nascosti. Il browser salva automaticamente ogni scelta. Il pulsante **Congela e confronta** diventa disponibile soltanto quando tutti i campi obbligatori sono completi.

## Fase 2 — confronto

Dopo il congelamento, per ogni caso vengono mostrati:

- il nuovo voto cieco, che non può essere sovrascritto nello storico;
- la prima revisione umana;
- il voto di GPT-5.4 Nano;
- la motivazione testuale del judge.

Registrare una decisione finale tra:

- confermare il nuovo voto indipendente;
- ripristinare la prima revisione;
- adottare il voto del judge;
- dichiarare l'evidenza insufficiente o ambigua.

I punteggi finali restano modificabili per correzioni puntuali. Una nota è utile soprattutto quando l'evidenza è troncata o la rubric ammette più interpretazioni.

## Esportazione

Al termine, usare **Esporta CSV finale** e fornire il file `llm-judge-human-adjudication-v1.completed.csv`. Il CSV conserva separatamente punteggi ciechi, punteggi finali, riferimenti precedenti, decisione, note e timestamp.

Il backup JSON può essere scaricato in qualsiasi momento. L'autosalvataggio usa soltanto il browser locale e non invia valutazioni a servizi esterni.
