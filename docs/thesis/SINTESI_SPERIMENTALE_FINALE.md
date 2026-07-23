# Sintesi sperimentale finale

Stato al 22 luglio 2026. Questo documento traduce il registro completo degli esperimenti in una narrazione utilizzabile nella tesi. I valori di validation servono alla selezione delle configurazioni; i valori del test bloccato servono esclusivamente alla verifica finale e non sono stati usati per ricalibrare il sistema.

## 1. Obiettivo e domande di ricerca

Il progetto studia la costruzione di un sistema RAG per documentazione tecnica multi-linguaggio. Le domande principali sono:

1. È possibile costruire un corpus ampio, riproducibile e prevalentemente PDF senza perdere provenienza e autorità delle fonti?
2. In che modo chunking, modello di embedding, strategia di retrieval, soglia, filtri metadata e reranking influenzano qualità, astensione e costo?
3. Quale modello generativo produce le risposte più grounded e correttamente citate a parità di evidenza?
4. Un LLM-as-a-judge può sostituire in modo affidabile la valutazione umana?
5. Un ciclo Agentic RAG migliora il retrieval abbastanza da giustificare costo e complessità aggiuntivi?
6. La configurazione selezionata in validation mantiene i risultati su un test finale congelato e in produzione?

## 2. Corpus e pipeline documentale

Il corpus attivo contiene **434 URL canonici indicizzati**, **33.079 chunk** e **6.117.327 parole stimate**. Il catalogo di acquisizione comprende **99 endpoint**, raggruppati in **15 famiglie di fonti**, e copre **12 linguaggi o domini**: Bash, C, C++, Go, Java, JavaScript, Kotlin, PostgreSQL/SQL, Python, React, Rust e TypeScript.

La strategia è PDF-first: sono inclusi **12 PDF** ufficiali o di standardizzazione, mentre HTML viene mantenuto quando non esiste un PDF corrente equivalente o quando l’editore considera normativa la versione HTML. I due conteggi “99 endpoint” e “434 fonti” misurano livelli diversi: il primo descrive il catalogo di acquisizione; il secondo gli URL canonici effettivamente materializzati nell’indice, comprese le pagine delle documentazioni multipagina.

La pipeline registra URL, versione, autorità, formato, hash dei byte acquisiti, parser, metadata, chunk e provenienza. IBM Docling viene utilizzato per i PDF; gli snapshot HTML già supportati rimangono parte della stessa pipeline normalizzata. Working draft e specifiche sperimentali sono esplicitamente etichettati e non vengono presentati come standard ISO finali.

### Limite di rappresentatività

React rappresenta 80 dei 99 endpoint del catalogo. Il corpus è ampio ma non uniformemente distribuito tra i linguaggi; per questo i benchmark sono bilanciati per casi e non devono inferire rappresentatività dalla sola quantità di documenti.

## 3. Metodo sperimentale

Ogni famiglia sperimentale contiene ipotesi, singola variabile modificata, controlli, metriche, costi, limitazioni, artefatti e decisione. I tentativi falliti sono conservati. La validation viene usata per scegliere la configurazione; il test bloccato viene eseguito una sola volta.

Le metriche di retrieval sono:

- **Recall@4**: quota delle evidenze canoniche recuperata nei primi quattro risultati;
- **Precision@4**: quota dei risultati restituiti che è rilevante;
- **MRR**: premia la presenza della prima evidenza rilevante nelle posizioni più alte;
- **nDCG@4**: misura la qualità complessiva dell’ordinamento;
- **FPR sui negativi**: quota di domande non rispondibili per cui il sistema restituisce comunque evidenza.

Per la generazione vengono misurati groundedness, copertura dei fatti attesi, correttezza e completezza delle citazioni, chiarezza, astensione, errori critici, troncamenti, latenza, token e costo.

## 4. Selezione del retriever

### 4.1 Dimensione dei chunk

Il confronto esplorativo 2×3 ha incrociato Gemini Embedding 2 e Voyage Code 3 con chunk target da 300, 450 e 850 parole, mantenendo overlap 80, dimensione 1.024 e top-k 4.

Con Gemini, Recall e MRR rimangono pari a 1 nel campione, ma la precisione scende da **0,7083** a 300 parole a **0,6250** a 450 e **0,5139** a 850. Con Voyage, MRR scende da **0,7222** a **0,6944** e **0,6111**. I chunk più grandi riducono moderatamente indice e costo, ma peggiorano l’ordinamento. Sono quindi selezionati **300 target words con overlap 80**.

Questo risultato dimostra che chunk size e modello interagiscono, ma nel campione non provocano un’inversione del modello vincitore.

### 4.2 Dense, BM25 e ibrido

Dense cosine, BM25 e hybrid reciprocal-rank fusion sono stati confrontati a parità di corpus, chunk e top-k. Nel diagnostico di ranking, dense ottiene Recall@4 **1,0000** e MRR **1,0000**; BM25 ottiene **0,5833** e **0,4583**; l’ibrido **0,5833** e **0,5556**. Nessuna configurazione BM25 o ibrida soddisfa contemporaneamente astensione e guardrail qualitativi.

Il confronto resta utile nella tesi anche se il risultato appare intuitivo: fornisce una baseline lessicale riproducibile e mostra empiricamente che la terminologia tecnica esatta non compensa la perdita di corrispondenza semantica in questo corpus.

### 4.3 Metadata e soglia

Il filtro deterministico riconosce tecnologia e, quando disponibile, versione richiesta, escludendo documenti incompatibili prima del ranking. Dopo la correzione preregistrata del detector C/C++, la configurazione metadata-aware seleziona una soglia cosine di **0,68** sulla validation v4:

| Metrica | Validation |
|---|---:|
| Recall@4 | 0,9630 |
| Precision@4 | 0,6296 |
| MRR | 0,9444 |
| nDCG@4 | 0,9493 |
| FPR | 0,0000 |

Il dense puro non trova una soglia che soddisfi tutti i guardrail. La soglia 0,65 apparteneva a una calibrazione precedente con meno negativi; non è la configurazione finale.

### 4.4 Modelli di embedding

Tutti i modelli sono confrontati a 1.024 dimensioni, con chunk, metadata, top-k e validation identici.

| Modello | Soglia zero-FPR | Recall@4 | MRR | nDCG@4 | Esito |
|---|---:|---:|---:|---:|---|
| Gemini Embedding 2 | 0,68 | 0,9630 | 0,9444 | 0,9493 | selezionato |
| OpenAI text-embedding-3-small | 0,60 | 0,6296 | 0,5926 | 0,6023 | scartato |
| OpenAI text-embedding-3-large | 0,60 | 0,8333 | 0,7901 | 0,7917 | scartato |
| Voyage Code 3 | 0,50 | 0,9444 | 0,8210 | 0,8433 | scartato |

OpenAI Large raggiunge Recall@4 0,9630 a soglia permissiva, ma con FPR 0,5556. Voyage conserva recall elevato a FPR zero, ma non supera il floor MRR 0,85. Gemini è l’unico candidato che soddisfa tutti i criteri preregistrati.

### 4.5 Reranking

Voyage rerank-2.5 e rerank-2.5-lite riordinano un pool dense top-20 che contiene già tutte le evidenze canoniche. Nessuno migliora il baseline:

| Variante | Recall@4 | MRR | nDCG@4 | Costo | Latenza API mediana |
|---|---:|---:|---:|---:|---:|
| Nessun reranker | 0,9630 | 0,9444 | 0,9493 | $0 | 0 ms |
| Voyage rerank-2.5 | 0,9630 | 0,9259 | 0,9327 | $0,012762 | 327 ms |
| Voyage rerank-2.5-lite | 0,9630 | 0,9012 | 0,9126 | $0,005105 | 311 ms |

Viene mantenuto **nessun reranker**.

## 5. Verifica finale del retrieval

La configurazione congelata è: chunk 300/80, Gemini Embedding 2 a 1.024 dimensioni, dense cosine con filtro metadata, soglia 0,68, top-k 4, nessun reranker e nessun ciclo agentico.

Il test v4 contiene 24 casi, 12 rispondibili e 12 negativi, ed è stato eseguito una sola volta:

| Metrica | Test finale |
|---|---:|
| Recall@4 | **1,0000** |
| Precision@4 | **0,6667** |
| MRR | **0,9375** |
| nDCG@4 | **0,9526** |
| FPR | **0,0833 (1/12)** |

Tutti i 12 casi rispondibili hanno copertura canonica completa. Il caso Java overload trova la prima evidenza canonica al quarto posto. Il falso positivo è la domanda sulla retention di `pg_partman`: un passaggio del manuale PostgreSQL supera la soglia pur non documentando l’estensione.

Gli intervalli Wilson al 95% sono **[0,7575; 1,0000]** per la copertura completa e **[0,0149; 0,3539]** per il FPR. Il risultato supera i criteri congelati, ma il campione piccolo non permette di presentare 8,33% come stima precisa del tasso di errore di produzione.

## 6. Generazione della risposta

### 6.1 Selezione su validation

La revisione umana cieca contiene 72 righe, 12 casi rispondibili e 12 negativi per ciascun modello.

| Modello | Qualità normalizzata | Astensione | Failure rate | Costo osservato | Esito |
|---|---:|---:|---:|---:|---|
| GLM-5.2 BaseTen FP8 | **0,9740** | 1,0000 | 0 | $0,069270 | selezionato |
| Grok 4.5 | 0,9323 | 1,0000 | 0 | $0,171426 | idoneo, non selezionato |
| Gemini 3.5 Flash | 0,9219 | 1,0000 | 0,0417 | $0,164763 | guardrail failure |

GLM-5.2 viene selezionato perché massimizza la qualità tra i modelli che superano tutti i guardrail e presenta anche il costo minore nel run osservato. La review ha un solo autore ed è stata completata rapidamente: non fornisce inter-rater reliability.

### 6.2 Test finale GLM-5.2

Il modello selezionato è stato eseguito una volta sulle evidenze del test retrieval: 13 casi con evidenza raggiungono il provider e 11 negativi senza evidenza usano l’astensione deterministica.

| Controllo automatico | Risultato |
|---|---:|
| Chiamate GLM | 13 |
| Astensioni deterministiche | 11 |
| Errori finali | 0 |
| Troncamenti espliciti | 0 |
| Etichette di citazione invalide | 0 |
| Token totali | 27.431 |
| Costo provider-reported | $0,049915 |
| Latenza mediana / p95 | 3.583 / 9.712 ms |

Tre risposte upstream 429 di BaseTen hanno richiesto riprese cache-preserving; il ledger conserva gli eventi e nessun caso riuscito è stato rigenerato. Il caso negativo `pg_partman`, pur avendo ricevuto un excerpt PostgreSQL, produce una risposta esplicita di insufficienza invece di inventare il comportamento dell’estensione.

La review umana congelata di 24 righe conferma il risultato: qualità normalizzata **0,9740**, groundedness **3,917/4**, copertura **3,667/4**, correttezza e completezza delle citazioni **4/4**, chiarezza **2/2**, astensione corretta **1,000** e zero errori critici. Tutti i criteri preregistrati sono superati. Il valore di qualità coincide a quattro decimali con quello di validation, senza tuning o rigenerazione sul test.

Il runtime web corrente continua a usare Gemini 3.5 Flash con budget 2.048. GLM-5.2 è ora la scelta sperimentale confermata; la sua eventuale integrazione nel runtime rimane una modifica implementativa separata e deve essere versionata esplicitamente.

## 7. LLM-as-a-judge

GPT-5.4 Nano fallisce la calibrazione: QWK 0,4320 e Spearman 0,3570 contro floor 0,60 e 0,70. GPT-5.4 Mini migliora QWK a 0,5975, Spearman a 0,4893 e pass agreement a 0,9375, ma fallisce comunque la regola congelata.

Una successiva adjudication assistita mostra che le etichette umane sono sensibili alla seconda lettura, ma non è una replica indipendente: lo stesso autore ha prodotto entrambe le valutazioni con supporto di Codex. La conclusione corretta è quindi negativa ma informativa: **l’automazione del judge rimane disabilitata**.

## 8. Agentic RAG

Sono stati studiati planner con retry, assessor semantico e accumulo bilanciato tra tentativi. Il semantic gate conserva le metriche generali ma nessuno dei 39 secondi tentativi recupera nuovi casi; aggiunge costo e latenza. Il merge cross-attempt recupera tre confronti positivi, ma raggiunge soltanto recall laterale 0,5000 e introduce FPR 0,1250 sui negativi focalizzati.

La decisione è non selezionare Agentic RAG per questa tesi. L’implementazione rimane come risultato negativo documentato: mostra che “aggiungere un loop” non basta a rendere agentico ed efficace il retrieval; servono assessment e strategie di evidence composition realmente affidabili.

## 9. Persistenza e produzione

Il corpus viene importato in PostgreSQL con pgvector su Neon Free, usando exact cosine senza HNSW o IVFFlat. L’implementazione riproduce **54/54** ranking di validation entro tolleranza 0,0002, conserva 33.079 chunk in 228 MB, riutilizza la cache e non effettua nuove chiamate di embedding. Il costo osservato del database è $0.

Gli indici approssimati sono deliberatamente esclusi: possono cambiare recall e ordinamento e richiedono un esperimento separato soltanto se la latenza exact diventa un problema osservabile.

## 10. Configurazione finale sostenuta dai dati

| Componente | Scelta |
|---|---|
| Corpus | PDF-first, HTML ufficiale quando necessario |
| Parser PDF | IBM Docling |
| Chunking | 300 parole, overlap 80 |
| Embedding | Gemini Embedding 2, 1.024 dimensioni |
| Retrieval | Dense cosine + filtro metadata |
| Soglia | 0,68 |
| Top-k | 4 |
| Reranker | Nessuno |
| Agentic loop | Non selezionato |
| Generatore sperimentale | GLM-5.2 BaseTen FP8, confermato sul test finale |
| LLM judge | Disabilitato, calibrazione fallita |
| Storage | PostgreSQL + pgvector exact su Neon |

## 11. Limiti da dichiarare esplicitamente

1. Tutti i 78 casi del benchmark hanno stato operativo `human-approved`, ma `approval.state=pending-confirmation`: non costituiscono una validazione umana indipendente.
2. Il test finale ha soltanto 12 casi per classe; gli intervalli sono ampi.
3. Il corpus è sbilanciato per quantità di endpoint e chunk tra linguaggi.
4. Le metriche canoniche possono penalizzare evidenza semanticamente valida proveniente da chunk differenti da quelli annotati.
5. La review della generazione e le adjudication hanno un solo revisore principale, in parte assistito da AI.
6. Prezzi, disponibilità dei modelli e latenze sono osservazioni datate, non proprietà immutabili.
7. Temperature zero e cache non garantiscono riproducibilità byte-identica dopo aggiornamenti provider-side.
8. La qualità generativa finale deriva da un’unica review dell’autore, assistita caso per caso da Codex; non misura l’accordo inter-rater.

## 12. Struttura consigliata della tesi

1. **Introduzione** — problema, obiettivi, domande di ricerca e contributi.
2. **Background** — RAG, chunking, embedding, retrieval sparse/dense, reranking, judge e Agentic RAG.
3. **Corpus e acquisizione** — criteri PDF-first, HTML fallback, Docling, provenance, limiti del corpus.
4. **Architettura** — pipeline offline, cache, retrieval, generation, pgvector e deployment.
5. **Metodologia sperimentale** — split, preregistrazione, metriche, costi, guardrail e gestione dei tentativi falliti.
6. **Esperimenti di retrieval** — chunk, strategie, metadata, soglia, embedding, reranker e query comparative.
7. **Generazione e valutazione** — confronto LLM, review umana, output budget e LLM-as-a-judge.
8. **Agentic RAG** — architetture provate, risultati negativi e analisi dei fallimenti.
9. **Verifica finale e produzione** — test bloccato retrieval, test GLM, Neon/pgvector e parità.
10. **Discussione** — interpretazione, minacce alla validità, costi e generalizzabilità.
11. **Conclusioni e sviluppi futuri** — contributi effettivi e lavoro non completato.

## 13. Ultime attività necessarie

Non sono necessari nuovi benchmark retrieval o nuovi modelli per sostenere la tesi corrente. Restano:

1. decidere se integrare GLM nel runtime oppure mantenere Gemini come implementazione dimostrativa;
2. trasformare questa sintesi nei capitoli della tesi, citando sempre artefatti, split e limitazioni;
3. ottenere, solo se realisticamente disponibile, una seconda review indipendente come rafforzamento opzionale e non come requisito per chiudere la tesi triennale.

La mappa completa e machine-readable rimane `docs/experiments/registry.v1.json`; `docs/experiments/THESIS_EXPERIMENT_MAP.md` conserva anche tutte le famiglie negative e superseded.
