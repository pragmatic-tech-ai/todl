# Knowledge Graph Design and Querying Rules

Rules and decisions for building a self-describing knowledge graph that can be queried from natural language, including synonyms and abstract vocabulary, without loading the graph's schema into a language model's context. Developed around the modelling case "select the list of containers that tomorrow will be one week late to be delivered to their destinations", generalised to an unknown domain.

Scope of control assumed: how the graph is built, and the query endpoint. The domain is unknown and the graph may be large.

---

## Part 1 — Core modelling principles

1. **Store facts, derive state.** Never persist a value that changes with the passage of time (days late, age, remaining). Store the invariant it is derived from (due date) and invert the predicate at query time: "one week late tomorrow" becomes `due_date = tomorrow − 7 days`. This turns a scan with a computed predicate into an index seek.
2. **Separate commitment from forecast.** The promised date (commitment, SLA) and the predicted date (ETA) answer different questions. "Late" is measured against the commitment; "will be late" is a forecast against the ETA. Keep them on distinct nodes or properties and make the definition explicit in the model.
3. **Immutable events plus a current-state projection.** Events (gate-in, loaded, discharged, delivered) are append-only facts with `occurred_at`, `recorded_at` and `source`. Current state (`status`, `delivered_at`, denormalised commitment date, current ETA) is a projection rebuilt from events, never patched directly.
4. **Partition open from terminal.** Most of the graph is history. Give live entities a dedicated label (e.g. `:OpenContainer`, removed on delivery) or a partial index so date lookups touch thousands of rows, not millions.
5. **Normalise time before querying.** Resolve "tomorrow", "next week", "as of Monday" to concrete dates outside the graph, anchored to the relevant time zone (the destination's, not the server's). Decide once: exactly N vs at least N, calendar vs business days, date vs end-of-day.
6. **Filter via index, then traverse.** Anchor the query on the most selective indexed predicate, then follow relationships. The graph's strength is the follow-up ("which vessel, which port, which others share the cause"), not the filtering.
7. **Version commitments.** Commitment nodes carry `valid_from`, `valid_to`, `superseded_by`, so the graph can answer "late against the original date" as well as the current one. This is bitemporal thinking: when it was true in the world vs when it was known.
8. **Precomputation is a disposable cache.** A nightly lateness bucket is acceptable for dashboards, but it is never the source of truth and must agree with the inverted-predicate query.
9. **Engine is secondary.** Any property graph (Neo4j, Cosmos DB Gremlin, Neptune) can implement this. If most queries are flat filters, keep the open-set projection in a relational or Fabric table and use the graph for traversal and root-cause questions.

---

## Part 2 — Lexical-to-graph rules

The principle: **nouns become identity, verbs become edges or events, adjectives are almost never stored.** Each rule carries a test so a parser or an LLM pass can apply it mechanically.

### A. Nouns

| Rule | Statement | Test / example |
|---|---|---|
| **N1** Identity test | A noun becomes a node label if at least two hold: stable identifier, own attributes, participates in more than one relationship, has a history. Otherwise it is a property. | Container, Vessel, Port → nodes. Seal number → property. |
| **N2** Role nouns are edges | A noun naming what something does in a context (consignee, shipper, carrier) maps to a relationship type from a generic entity. | `(Party)-[:CONSIGNEE_OF]->(Booking)`, not a `Consignee` label. |
| **N3** Event nouns are immutable Event nodes | Nouns denoting something happening at a point in time get a timestamp, a source, and are never updated. Cross-check with V2. | Arrival, discharge, gate-in, release. |
| **N4** Commitment nouns are reified and versioned | Nouns denoting a promise or expectation become nodes with `valid_from`/`valid_to`. | Deadline, SLA, ETA, schedule, quote. |
| **N5** Measure nouns are typed properties with units | Store value and unit separately; never encode the unit in the key name. | Weight, duration, distance, temperature. |
| **N6** Collective nouns are nodes only if they carry their own facts | Booking/shipment is a node because it has a commitment. Fleet or batch is a query-time grouping unless decisions are made about it as a unit. | |
| **N7** Temporal nouns are never stored | Tomorrow, week, quarter resolve to parameters at query time. | |
| **N8** Deverbal nouns inherit the verb's rule | Resolve the nominalisation to its verb and apply section B. | Delivery → event (store). Delay → state (derive). Estimate → commitment (version). |

### B. Verbs

| Rule | Statement | Test / example |
|---|---|---|
| **V1** Stative verbs become relationships | Is, belongs to, contains, is located at. Direction follows subject → object. If the relationship can end, give it validity dates or keep it in the current-state projection. | |
| **V2** Dynamic verbs become Event nodes, never edge updates | Each occurrence is a node with `occurred_at`, `recorded_at`, `source`. Late or corrected events reprocess the projection. | Arrive, load, discharge, deliver, clear. |
| **V3** Transition verbs define the state machine | For every dynamic verb record from-state and to-state. `status` is a projection; the terminal state removes the entity from the open partition. | |
| **V4** Verbs of expectation are forecasts, not facts | Output becomes a Commitment or Forecast node with provenance, on a different edge from observed events. | Expect, predict, estimate, schedule, promise. |
| **V5** Modality and tense set the query frame, not the schema | Present ("is late") → anchor vs now. Future ("will be late") → vs forecast. Past perfect ("had been late as of") → bitemporal as-of `recorded_at`. | |
| **V6** Relationship verbs with their own facts are reified | If an edge needs more than a timestamp (price, conditions, responsible party), it becomes a node between the two entities. | |

### C. Adjectives

| Rule | Statement | Test / example |
|---|---|---|
| **C1** Intrinsic adjectives are properties | Don't change without a new entity. Index if a common filter. | Refrigerated, 40-foot, hazardous. |
| **C2** State adjectives are derived from events | Live only in the projection (V3); become partition labels when selectivity is high. | Open, delivered, held, cleared. |
| **C3** Relative adjectives are never stored; invert the predicate | Identify the anchor fact and the reference time; rewrite as an equality or inequality on the anchor. | "One week late tomorrow" → `due_date = tomorrow − 7d`. Late, overdue, early, stale, expired. |
| **C4** Quantified adjectives supply the parameter | Set offset and operator (=, <, ≥) in C3. Calendar vs business days decided once, globally. | "Three days overdue", "more than a week". |
| **C5** Comparatives and superlatives are ordering | `ORDER BY` on the anchor over the result set. Never store a rank. | Later, latest, most delayed. |
| **C6** Temporal adjectives are version selectors | Select which Commitment version (N4) to compare against. | Current, original, previous, revised. |
| **C7** Evaluative adjectives need provenance | Derive from an explicit business rule (store the rule, not the result) or store as an asserted flag with who and when. Never a bare boolean. | Urgent, critical, priority. |

### D. Function words

| Rule | Statement |
|---|---|
| **D1** Prepositions set edge type and direction | To → destination; from → origin; on → carrier/vessel; at → location; by → agent or deadline (disambiguate "by Friday" vs "by Maersk"). |
| **D2** Determiners and quantifiers shape the result | "The list of" → set; "any" → existence; "all" → universal check; "each" → per-entity aggregation. |
| **D3** Time adverbials fix the anchor | Resolved to a date in the relevant time zone before the query is built. |

### E. Build-time algorithm

1. Tokenise and part-of-speech tag the domain text (requirements, queries, source-system docs).
2. Classify each noun with N1–N8 → nodes, properties, parameters.
3. Classify each verb with V1–V6 → relationships, events, state machine.
4. Classify each adjective with C1–C7 → properties, projections, inverted predicates.
5. Apply D1–D3 to wire edges and resolve time.
6. Emit three artefacts: schema (nodes, edges, indexes), projection rules (event → state), query templates with parameters.

Deliberately not automated: whether "late" is measured against commitment or ETA, and whether days are calendar or business. These live in a configuration layer the algorithm reads.

---

## Part 3 — Hierarchy rules (hypernyms, hyponyms, meronyms)

A hypernym ("entities") does not decide which nodes qualify; the **predicate** does. Only things with a committed date can be delayed. The taxonomy proposes, the predicate's trait filters.

| Rule | Statement |
|---|---|
| **H1** Store the taxonomy, don't flatten it | Schema-level `(:Class)-[:SUBCLASS_OF]->(:Class)`. In a property graph, mark each instance with its full label chain (`:Container:TransportUnit:Asset`) so a hypernym query is an index hit, not a tree walk per node. In RDF/OWL, `rdfs:subClassOf` plus a reasoner. |
| **H2** Label instances with the most specific noun passing N1 | Hypernyms are additional labels or class nodes, never separate instance nodes. |
| **H3** Bind predicates to traits, not classes | "Delayed", "overdue", "expired" require an anchor (N4) and a terminal event (V3). Declare a trait `HasCommitment {anchor, terminal_state}`; each class implements it with its own mapping. A hypernym query resolves to every class under the hypernym implementing the trait the predicate needs. |
| **H4** Abstract verbs and adjectives get a lexicon with canonical predicates | Late, delayed, overdue, behind, slipped → one canonical `LATE(anchor, reference, operator, offset)`. Synonyms, hyponyms and hypernyms bound to traits. |
| **H5** Expand silently when semantics agree; ask when they diverge | Safe when every matched class shares operator, unit and reference-time convention. If units or conventions differ (business vs calendar days), either ask one question or return results grouped by class with the convention stated. Never merge rows computed under different rules into one flat list. |
| **H6** Meronymy is a different relation with its own propagation | Hypernymy is "is-a"; part-whole is "has-a". A booking's lateness is an aggregation over its containers (any / all / latest, decided per class). Store the aggregation rule in the trait mapping, never the aggregated value. Keep `SUBCLASS_OF` and `PART_OF` as distinct edge types. |
| **H7** Heterogeneous results return the trait's projection | Common fields the trait guarantees (`id`, `class`, `anchor`, `reference`, `days_late`); class-specific detail nested or in a second query. |
| **H8** The lexicon resolves hyponyms downward too | "Reefers", "TEUs" map to the hyponym label or a property filter rather than being treated as unknown nouns. |

Example trait table:

| Class | anchor | terminal state |
|---|---|---|
| Container | `committed_delivery_date` | delivered |
| Vessel voyage | `scheduled_arrival` | arrived |
| Customs declaration | `clearance_sla_date` | released |
| Booking | derived from containers (H6) | all delivered |

Worked resolution of "entities delayed more than 7 days": noun → root, no constraint; adjective → `LATE`, requires `HasCommitment`; quantifier → `<`, offset 7, reference today; H3 → four classes; H5 → customs uses business days, so group or ask; H6 → booking aggregates; C3 → `anchor < today − 7d AND status <> terminal`; one Cypher branch per class joined by `UNION ALL`.

Resist modelling every abstraction level as an instance node. Keep the hierarchy in the schema and the lexicon; let instances carry labels.

---

## Part 4 — Querying an unknown-domain graph from natural language

### 4.1 Compilation, not translation

Never generate Cypher directly from the sentence. Pipeline:

**sentence → classified words → grounded IR → path plan → template Cypher → validation → cached groundings**

Each stage is checked before the next. Errors in the IR are cheap and precise; errors in Cypher are neither.

### 4.2 Constraints that shape the design

- The graph may be large; its metadata must not be loaded into model context.
- The domain is unknown in advance.
- The build process and the query endpoint are both under control.

Consequence: the metadata does not come to the model; the model's question goes to the metadata. The endpoint is a **grounding and planning service**, not a raw Cypher socket.

### 4.3 Embeddings: retrieval, not identity

Embeddings are approximate, non-unique and change with the model, so nothing in the planner is keyed on a vector. The planner receives `(element_id, score)` candidates and applies hard constraints.

**What makes embedding retrieval precise is the classification step.** The rules table tells the server which index to search:

| Word class | Search only | Hard constraint applied by planner |
|---|---|---|
| noun (entity) | Class nodes, with hypernym expansion | must pass N1; must implement any trait the predicate needs (H3) |
| noun (proper) | full-text or exact value index, not embeddings | must be a value of a property on a class already in the IR |
| noun (temporal) | nothing — resolved to a parameter | D3 |
| verb (stative) | relationship types | endpoints must match grounded classes |
| verb (dynamic) | event types | must appear in the subject class's state machine |
| verb (expectation) | commitment / forecast types | versioned node must exist on the subject class |
| adjective (intrinsic) | properties | type-compatible with any quantifier |
| adjective (relative) | predicate signatures | trait implemented by every target class |
| adjective (state) | status enum / partition labels | must be a state in the subject's state machine |
| preposition | relationship types, direction | D1 |

**What gets embedded:** not bare names. Each schema element has a descriptor card (kind, name, endpoints or owner, description, sample values, observed aliases), stored as a `:SchemaElement` node with a native vector index per element kind. On the query side, embed the word **in its syntactic span**, not the token.

**Where embeddings fail and what covers it:**
- Near-synonyms with different semantics (`committed_delivery_date` vs `current_eta`): bound by trait signature, never by similarity.
- Codes and identifiers: exact or full-text lookup.
- Operators, negation, quantifiers: produced by the rules directly in the IR.
- Ties within a small margin: planner constraints or a question to the user, never a coin-flip on score.

**The lexicon is a write-back cache.** Every confirmed grounding is stored as `(:Lexeme {text})-[:GROUNDS_TO {score, confirmed_at}]->(:SchemaElement)`. Next time it is an exact hit before any vector search, and it is inspectable, which the vector index alone is not.

### 4.4 Build-side guarantees

At ingest, automatically for every element:

1. Descriptor cards as `:SchemaElement` nodes, generated from the rules.
2. Vector index per element kind over the cards; full-text index over value-bearing properties.
3. The meta-layer from H1–H4: class tree, trait implementations with anchor mappings, state machines per class, lexicon cache.
4. A domain abstract: one paragraph plus top-level classes with counts, regenerated on schema change. The only whole-schema artefact, small enough for the first turn.
5. A query library: validated (sentence, IR, Cypher) triples, embedded by sentence.

### 4.5 Endpoint protocol

| Operation | Input | Output (bounded) |
|---|---|---|
| `orient()` | — | Domain abstract, ~200–400 tokens, once per conversation |
| `ground(classified_words)` | Sentence pre-classified by the rules table | ≤ k candidates per word with score and one-line card, after scoped retrieval and H3 constraints; plus nearest 2–3 library queries. ~500–800 tokens regardless of graph size |
| `plan(IR)` | Assembled IR | `ok` with anchor and path; or short list of ambiguities as element pairs; or precise errors |
| `execute(IR)` | Validated IR | Server generates Cypher from templates, runs `EXPLAIN`, clause-by-clause probe counts, `LIMIT` run; returns rows, diagnostics (which clause emptied the result, whether the anchor hit an index) and the Cypher text |
| `run(cypher)` (optional) | Raw Cypher | Behind the same read-only, timeout and limit guards; not the normal path |

### 4.6 Planning the traversal

- Done on the **meta-graph** (labels as nodes, relationship types as edges), which is small and cheap, not on instance data.
- Shortest paths between grounded classes, with prepositions and verbs from the sentence voting on relationship type and direction (D1).
- Prefer paths through reified nodes (Commitment, Event, Leg) when a predicate needs their properties.
- Two tied paths with different semantics → a question for the user in their words.
- Variable-length paths only when the sentence implies transitivity, and always bounded.
- Anchor on the most selective indexed starting point: partition label plus inverted predicate.

### 4.7 Cypher generation and validation

1. `MATCH` the anchor with the index-friendly predicate.
2. Chain `MATCH` along the planned path; `OPTIONAL MATCH` for optional detail.
3. Remaining filters in `WHERE`, parameters never literals.
4. `WITH` for aggregation or de-duplication (H6 propagation).
5. `RETURN` the trait projection plus requested detail; `ORDER BY` for comparatives; `LIMIT`.
6. One branch per target class, `UNION ALL`, when a hypernym expanded (H5).

Validation loop, read-only session, statement timeout, hard `LIMIT`, bounded retries:

1. `EXPLAIN` → syntax, and the plan must start with an index seek on the anchor. A label scan on the largest label means the anchor was chosen badly; replan.
2. Probe counts, adding one predicate at a time, to find which clause empties the result.
3. Run with `LIMIT 20`. Empty → loosen the lowest-confidence grounding first and retry. Non-empty → check shape against the projection and spot-check rows.
4. After the retry budget, report what failed with the probe counts rather than returning something plausible.

### 4.8 Presenting results

Show the grounding assumptions in the user's words ("I read *delayed* as past the committed delivery date and not yet delivered; *site* as `Destination.name`; days are calendar days"), then the Cypher, parameters and rows. Every stated assumption is one the user can overturn in a single reply.

### 4.9 Division of labour

- **Model:** classify the sentence, choose among returned candidates, assemble the IR, resolve planner ambiguities by asking the user, present results with assumptions.
- **Server:** everything that scales with the graph — retrieval, constraint checking, path search, template expansion, plan checking, execution, caching.

Keeping the deterministic parts in code makes the result auditable, which matters more than cleverness in a regulated setting.

**Decide the IR schema early.** It is the contract between build, endpoint and model, and the part that is painful to change later. Everything else can evolve behind it.

---

## Part 5 — Summary of the approach (as agreed)

1. **Cards and scoped retrieval.** Every schema element has a descriptor card, embedded by the server. The model classifies the user's words by the rules table and sends them; the server embeds each word in its span with the same embedding model and searches only the index for that word class. What returns is schema elements, not instance subgraphs. The planner works on the meta-graph; instances are touched only at execution.
2. **Hierarchy and wording are two mechanisms.** The hypernym→hyponym class tree handles abstraction level ("entities" → classes beneath). Embeddings and the lexicon cache handle wording ("site" → `Destination`). The tree alone over-expands; the predicate's trait (H3) cuts the expansion to classes that can satisfy it. Hierarchy proposes, trait filters.
3. **Gap-closing on the schema, not the data.** Shortest paths on the meta-graph between grounded classes, filtered by hard constraints (endpoints match, required reified nodes present) and votes from prepositions and verbs. The semantic index proposes candidates in step 1; it does not filter paths.
4. **Build, then validate.** Cypher from the IR by templates, anchored on the most selective indexed predicate, checked against the live endpoint (`EXPLAIN`, probe counts, `LIMIT` run). Empty results loop back to the weakest grounding, bounded. Confirmed groundings are written back to the lexicon.

Pipeline: **classify → scoped retrieval → hierarchy expansion cut by traits → meta-graph path planning → template Cypher → validate → cache.**

The model owns the first step and the choices; the server owns everything that scales with the graph.

---

## Open items

- Draft the IR as a JSON schema.
- Specify the four endpoint signatures in detail.
- Define build-time rules for generating descriptor cards per element kind.
- Reference implementation against a sample Neo4j instance.
