"""
PoC: natural language -> grounded IR -> Cypher over a self-describing freight knowledge graph.

Proves the pipeline from the project rules (knowledge-graph-rules.md):

    classify -> scoped retrieval -> hierarchy expansion cut by traits
             -> meta-graph path planning -> template Cypher -> validate -> cache

Run:  python -m unittest test_kg_poc -v

Deliberate simplifications, each a swap-point for the real component:
  * embed()      token-overlap cosine instead of an embedding model. Because of that, the
                 descriptor cards carry observed aliases; with a real model they would not.
  * classify()   a small rule lexicon stands in for the LLM's part-of-speech pass.
  * execute()    the IR is run on an in-memory graph and the generated Cypher is checked
                 structurally (anchor on partition label + indexed property, parameters not
                 literals). Against Neo4j the same IR would run through the Cypher text.
"""
from __future__ import annotations

import math
import re
import unittest
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

TODAY = date(2026, 10, 18)
PARTITION = "Open"          # rule 4: open vs terminal partition label
TIE_MARGIN = 0.05           # two candidates closer than this -> ask, never coin-flip
MAX_HOPS = 5

# =========================================================================== 1. META-LAYER
# H1: class hierarchy, stored as schema data. Instances carry the full label chain.
CLASS_PARENT = {
    "Entity": None,
    "Asset": "Entity", "TransportUnit": "Asset", "Container": "TransportUnit", "Vessel": "Asset",
    "VesselVoyage": "Entity", "Booking": "Entity", "Party": "Entity", "Leg": "Entity",
    "Location": "Entity", "Destination": "Location", "Port": "Location",
    "CustomsDeclaration": "Entity",
}


def ancestors(cls: str) -> list[str]:
    out = []
    while cls:
        out.append(cls)
        cls = CLASS_PARENT[cls]
    return out


def descendants(cls: str) -> list[str]:
    return [c for c in CLASS_PARENT if cls in ancestors(c)]


# H3: predicates bind to traits; each class implements the trait with its own anchor mapping.
TRAITS = {
    "HasCommitment": {
        "Container": {"anchor": "committed_delivery_date", "terminal": "delivered", "unit": "calendar"},
        "VesselVoyage": {"anchor": "scheduled_arrival", "terminal": "arrived", "unit": "calendar"},
        "CustomsDeclaration": {"anchor": "clearance_sla_date", "terminal": "released", "unit": "business"},
        # H6: a booking's lateness is aggregated over its containers (any = earliest open commitment)
        "Booking": {"aggregate": {"over": "Container", "via": "BELONGS_TO", "direction": "in", "rule": "any"},
                    "terminal": "delivered", "unit": "calendar"},
    }
}

# Meta-graph edges (from, type, to). SUBCLASS_OF lives in CLASS_PARENT, PART_OF is a normal edge (H6).
RELATIONSHIPS = [
    ("Container", "BELONGS_TO", "Booking"),
    ("Booking", "DELIVERS_TO", "Destination"),
    ("Container", "MOVES_ON", "Leg"),
    ("Leg", "ON", "Vessel"),
    ("Leg", "ENDS_AT", "Port"),
    ("Leg", "PART_OF", "VesselVoyage"),
    ("Party", "CONSIGNEE_OF", "Booking"),
    ("CustomsDeclaration", "COVERS", "Container"),
]

# What the database would report from db.indexes()
INDEXES = {
    ("Container", "committed_delivery_date"), ("VesselVoyage", "scheduled_arrival"),
    ("CustomsDeclaration", "clearance_sla_date"), ("Destination", "name"), ("Port", "name"),
}

# Which property names a class in a hypernym branch; used for the trait projection (H7).
NAME_PROPERTY = {"Destination": "name", "Port": "name", "Vessel": "name", "Party": "name"}


@dataclass
class Card:
    """Descriptor card for one schema element (4.3). This is what gets embedded."""
    kind: str      # class | predicate | relationship | property
    id: str
    name: str
    text: str
    payload: dict = field(default_factory=dict)


CARDS = [
    Card("class", "class:Entity", "entity", "thing, object, item; anything tracked in the graph"),
    Card("class", "class:Asset", "asset", "physical thing the company owns or operates"),
    Card("class", "class:TransportUnit", "transport unit", "equipment that carries cargo"),
    Card("class", "class:Container", "container", "shipping container, box, can, TEU, reefer; unit of freight moved under a booking"),
    Card("class", "class:Vessel", "vessel", "ship"),
    Card("class", "class:VesselVoyage", "vessel voyage", "sailing, voyage, rotation; a ship's scheduled trip between ports"),
    Card("class", "class:Booking", "booking", "shipment, consignment, order; a customer's cargo order covering one or more units"),
    Card("class", "class:Party", "party", "customer, consignee, shipper, carrier, organisation"),
    Card("class", "class:Leg", "leg", "segment of a journey on one ship"),
    Card("class", "class:Location", "location", "place"),
    Card("class", "class:Destination", "destination", "site, final delivery location, consignee address, warehouse, DC"),
    Card("class", "class:Port", "port", "terminal, harbour, seaport where a leg ends"),
    Card("class", "class:CustomsDeclaration", "customs declaration", "clearance, customs entry"),
    # H4: canonical predicate signatures
    Card("predicate", "pred:LATE", "late",
         "past the committed date and not yet in the terminal state; delayed, overdue, behind, past due, slipped, stuck",
         {"trait": "HasCommitment", "direction": "past"}),
    Card("predicate", "pred:EARLY", "early", "ahead of the committed date; ahead of schedule",
         {"trait": "HasCommitment", "direction": "ahead"}),
]
CARD_BY_ID = {c.id: c for c in CARDS}


# =========================================================================== 2. TOY EMBEDDING
def stem(w: str) -> str:
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("es") and len(w) > 4 and (w[-3] in "xsz" or w.endswith(("ches", "shes"))):
        return w[:-2]
    for suf in ("s", "ed", "ing"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            return w[: -len(suf)]
    return w


def tokens(text: str) -> set[str]:
    return {stem(w) for w in re.findall(r"[a-z0-9]+", text.lower())}


def embed(text: str) -> dict[str, float]:
    """Stand-in for an embedding model: a sparse bag of stemmed tokens."""
    return {t: 1.0 for t in tokens(text)}


def card_vector(card: Card) -> dict[str, float]:
    v = {t: 1.0 for t in tokens(card.text)}
    for t in tokens(card.name):          # the element's own name weighs more than its aliases
        v[t] = 3.0
    return v


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    dot = sum(a[t] * b[t] for t in a if t in b)
    if not dot:
        return 0.0
    return dot / (math.sqrt(sum(x * x for x in a.values())) * math.sqrt(sum(x * x for x in b.values())))


def search(kind: str, text: str, k: int = 3) -> list[tuple[float, Card]]:
    """Scoped retrieval: only the index for this word class is searched (4.3 table)."""
    q = embed(text)
    scored = [(cosine(q, card_vector(c)), c) for c in CARDS if c.kind == kind]
    scored = [(s, c) for s, c in scored if s > 0]
    scored.sort(key=lambda sc: -sc[0])
    return scored[:k]


# =========================================================================== 3. INSTANCE GRAPH
@dataclass
class Node:
    id: str
    cls: str
    props: dict
    labels: set


NODES: dict[str, Node] = {}
OUT: dict[str, list] = defaultdict(list)   # id -> [(type, dst)]
IN: dict[str, list] = defaultdict(list)    # id -> [(type, src)]
VALUE_INDEX: dict[str, list] = defaultdict(list)   # full-text stand-in: lower(value) -> [(class, prop, value)]
LEXICON: dict[str, str] = {}               # write-back cache: lower(text) -> element id


def add_node(cls: str, nid: str, **props) -> Node:
    labels = set(ancestors(cls))
    mapping = TRAITS["HasCommitment"].get(cls)
    if mapping and props.get("status") != mapping["terminal"]:
        labels.add(PARTITION)                # projection: Open label maintained from status
    n = Node(nid, cls, props, labels)
    NODES[nid] = n
    for prop in ("name",):
        if prop in props:
            VALUE_INDEX[str(props[prop]).lower()].append((cls, prop, props[prop]))
    return n


def add_edge(src: str, typ: str, dst: str) -> None:
    OUT[src].append((typ, dst))
    IN[dst].append((typ, src))


def build_graph() -> None:
    d = date
    for name in ("Dublin", "Rotterdam", "Singapore"):
        add_node("Destination", f"D-{name}", name=name)
    for name in ("Dublin Port", "Rotterdam", "Singapore"):
        add_node("Port", f"P-{name}", name=name)
    add_node("Vessel", "V-ESSEN", name="Maersk Essen")
    add_node("Vessel", "V-ALULA", name="CMA CGM Alula")
    add_node("VesselVoyage", "VOY1", id="VOY1", scheduled_arrival=d(2026, 10, 8), status="underway")
    add_node("VesselVoyage", "VOY2", id="VOY2", scheduled_arrival=d(2026, 10, 20), status="underway")
    add_node("Party", "PTY1", name="Celtic Retail")
    add_node("Booking", "B1", id="B1", status="open")
    add_node("Booking", "B2", id="B2", status="open")
    add_node("Booking", "B3", id="B3", status="open")
    add_node("CustomsDeclaration", "CD1", id="CD1", clearance_sla_date=d(2026, 10, 1), status="pending")

    containers = [  # id, committed, eta, status, booking
        ("MSKU1000001", d(2026, 10, 12), d(2026, 10, 21), "in_transit", "B1"),
        ("MSKU1000002", d(2026, 10, 12), d(2026, 10, 20), "in_transit", "B2"),
        ("MSKU1000003", d(2026, 10, 12), d(2026, 10, 12), "delivered", "B2"),
        ("MSKU1000004", d(2026, 10, 5), d(2026, 10, 23), "in_transit", "B1"),
        ("MSKU1000005", d(2026, 10, 16), d(2026, 10, 19), "in_transit", "B3"),
        ("MSKU1000006", d(2026, 10, 25), d(2026, 10, 24), "in_transit", "B3"),
        ("MSKU1000007", d(2026, 10, 11), d(2026, 10, 22), "in_transit", "B2"),
    ]
    for cid, due, eta, status, booking in containers:
        add_node("Container", cid, id=cid, committed_delivery_date=due, current_eta=eta, status=status,
                 size_ft=40, refrigerated=(cid == "MSKU1000007"))
        add_edge(cid, "BELONGS_TO", booking)
    add_edge("B1", "DELIVERS_TO", "D-Dublin")
    add_edge("B2", "DELIVERS_TO", "D-Rotterdam")
    add_edge("B3", "DELIVERS_TO", "D-Singapore")
    add_edge("PTY1", "CONSIGNEE_OF", "B1")
    add_edge("CD1", "COVERS", "MSKU1000004")

    legs = [("L1", "MSKU1000001", "V-ESSEN", "P-Dublin Port", "VOY1"), ("L2", "MSKU1000004", "V-ESSEN", "P-Dublin Port", "VOY1"),
            ("L3", "MSKU1000002", "V-ALULA", "P-Rotterdam", "VOY2"), ("L4", "MSKU1000007", "V-ALULA", "P-Rotterdam", "VOY2"),
            ("L5", "MSKU1000005", "V-ALULA", "P-Singapore", "VOY2")]
    for lid, cid, vessel, port, voyage in legs:
        add_node("Leg", lid, id=lid)
        add_edge(cid, "MOVES_ON", lid)
        add_edge(lid, "ON", vessel)
        add_edge(lid, "ENDS_AT", port)
        add_edge(lid, "PART_OF", voyage)


build_graph()


# =========================================================================== 4. CLASSIFY (the LLM's job)
@dataclass
class Word:
    span: str
    wclass: str
    payload: Any = None


STOP = {"select", "show", "me", "the", "list", "of", "that", "will", "be", "as", "they", "are", "their", "i",
        "want", "wanna", "see", "an", "which", "with", "and", "is", "in", "for", "please", "give", "get",
        "all", "find", "by", "any", "there"}
NUM = {"a": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7}
UNIT = {"day": 1, "days": 1, "week": 7, "weeks": 7}
PHRASES = [  # longest first. (phrase, word class, payload)
    ("to be delivered", "frame", None),        # infinitive of the terminal event: sets the frame, not a filter
    ("more than", "quantifier", "<"),
    ("at least", "quantifier", "<="),
    ("going to", "preposition", "to"),
    ("heading to", "preposition", "to"),
    ("delivered to", "preposition", "to"),
    ("over", "quantifier", "<"),
    ("exactly", "quantifier", "="),
    ("tomorrow", "temporal.reference", 1),
    ("today", "temporal.reference", 0),
    ("yesterday", "temporal.reference", -1),
    ("late", "adjective.relative", None), ("delayed", "adjective.relative", None),
    ("overdue", "adjective.relative", None), ("behind", "adjective.relative", None),
    ("stuck", "adjective.relative", None), ("slipped", "adjective.relative", None),
    ("early", "adjective.relative", None),
    ("open", "adjective.state", "open"), ("delivered", "adjective.state", "delivered"),
    ("to", "preposition", "to"), ("at", "preposition", "at"), ("on", "preposition", "on"),
    ("from", "preposition", "from"),
]


def classify(sentence: str) -> list[Word]:
    toks = re.findall(r"[A-Za-z0-9']+", sentence)
    low = [t.lower() for t in toks]
    words, i = [], 0
    while i < len(low):
        num = NUM.get(low[i], int(low[i]) if low[i].isdigit() else None)
        if num is not None and i + 1 < len(low) and low[i + 1] in UNIT:
            words.append(Word(f"{toks[i]} {toks[i+1]}", "temporal.offset", num * UNIT[low[i + 1]]))
            i += 2
            continue
        hit = next((p for p in PHRASES if low[i:i + len(p[0].split())] == p[0].split()), None)
        if hit:
            n = len(hit[0].split())
            words.append(Word(" ".join(toks[i:i + n]), hit[1], hit[2]))
            i += n
            continue
        t = low[i]
        if t in STOP or t in NUM:
            i += 1
            continue
        if t in VALUE_INDEX:
            words.append(Word(toks[i], "noun.proper", VALUE_INDEX[t]))
        else:
            words.append(Word(toks[i], "noun.entity"))
        i += 1
    return words


# =========================================================================== 5. GROUND -> IR
@dataclass
class Grounding:
    span: str
    element: str
    score: float
    source: str      # lexicon | embedding | value-index


@dataclass
class Constraint:
    cls: str
    prop: str | None = None
    value: Any = None
    project: str | None = None


@dataclass
class IR:
    target_classes: list[str] = field(default_factory=list)
    hypernym: str | None = None
    trait: str | None = None
    predicate: dict | None = None
    constraints: list[Constraint] = field(default_factory=list)
    groundings: list[Grounding] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    clarifications: list[str] = field(default_factory=list)


def ground_noun(span: str, ir: IR) -> str | None:
    key = span.lower()
    if key in LEXICON:                                     # write-back cache: exact hit first
        ir.groundings.append(Grounding(span, LEXICON[key], 1.0, "lexicon"))
        return LEXICON[key]
    cands = search("class", span)
    if not cands:
        ir.clarifications.append(f"could not ground '{span}' to any class")
        return None
    if len(cands) > 1 and cands[0][0] - cands[1][0] < TIE_MARGIN:
        ir.clarifications.append(f"'{span}' could be {cands[0][1].name} or {cands[1][1].name}")
        return None
    score, card = cands[0]
    ir.groundings.append(Grounding(span, card.id, round(score, 3), "embedding"))
    return card.id


def confirm_grounding(span: str, element_id: str) -> None:
    """The user accepted the reading: cache it as a lexicon edge (4.3)."""
    LEXICON[span.lower()] = element_id


def ground(words: list[Word], today: date) -> IR:
    ir = IR()
    nouns = [w for w in words if w.wclass == "noun.entity"]
    if not nouns:
        ir.clarifications.append("no subject noun found")
        return ir

    # subject = first entity noun; the rest are constraints
    target_id = ground_noun(nouns[0].span, ir)
    for w in nouns[1:]:
        cid = ground_noun(w.span, ir)
        if cid:
            cls = cid.split(":")[1]
            ir.constraints.append(Constraint(cls, project=NAME_PROPERTY.get(cls)))

    # predicate from relative adjective + quantifier + offset + reference (C3, C4, D3)
    rel = next((w for w in words if w.wclass == "adjective.relative"), None)
    if rel:
        score, sig = search("predicate", rel.span)[0]
        ir.groundings.append(Grounding(rel.span, sig.id, round(score, 3), "embedding"))
        quant = next((w.payload for w in words if w.wclass == "quantifier"), None)
        offset = next((w.payload for w in words if w.wclass == "temporal.offset"), None)
        ref_days = next((w.payload for w in words if w.wclass == "temporal.reference"), 0)
        if offset is None:
            op, offset = "<", 0
        else:
            op = quant or "="
        ir.trait = sig.payload["trait"]
        ir.predicate = {"kind": sig.name.upper(), "op": op, "offset_days": offset,
                        "reference": today + timedelta(days=ref_days)}
        ir.assumptions.append(f"read '{rel.span}' as {sig.name.upper()}: past the committed date and not yet in the "
                              f"terminal state; anchor {op} {ir.predicate['reference']} - {offset} days; calendar days")

    # H3: hypernym expansion cut by the trait the predicate needs
    if target_id:
        target = target_id.split(":")[1]
        if ir.trait:
            impl = TRAITS[ir.trait]
            classes = [c for c in descendants(target) if c in impl]
            if target in impl:
                classes = [target]
            else:
                ir.hypernym = target
            if not classes:
                ir.clarifications.append(f"nothing under '{target}' can be {ir.predicate['kind'].lower()}")
            # H5: expand silently only when conventions agree
            keep = [c for c in classes if impl[c]["unit"] == "calendar"]
            for c in classes:
                if c not in keep:
                    ir.clarifications.append(f"{c} measures lateness in {impl[c]['unit']} days; excluded, ask whether to include")
            ir.target_classes = keep
        else:
            ir.target_classes = [target]

    # proper nouns: value index, constrained to classes already in the IR when possible
    for w in words:
        if w.wclass != "noun.proper":
            continue
        cands = w.payload
        in_ir = [c for c in cands if any(k.cls == c[0] for k in ir.constraints)]
        if in_ir:
            cands = in_ir
        if len(cands) > 1:
            ir.clarifications.append(f"'{w.span}' matches " + " or ".join(f"{c}.{p}" for c, p, _ in cands))
            continue
        cls, prop, value = cands[0]
        ir.groundings.append(Grounding(w.span, f"{cls}.{prop}={value}", 1.0, "value-index"))
        existing = next((k for k in ir.constraints if k.cls == cls), None)
        if existing:
            existing.prop, existing.value = prop, value
        else:
            ir.constraints.append(Constraint(cls, prop, value, project=NAME_PROPERTY.get(cls)))
    return ir


# =========================================================================== 6. PLAN on the meta-graph
META: dict[str, list] = defaultdict(list)
for _a, _t, _b in RELATIONSHIPS:
    META[_a].append((_t, "out", _b))
    META[_b].append((_t, "in", _a))


def shortest_paths(src: str, dst: str, max_hops: int = MAX_HOPS) -> list[list[tuple]]:
    """All shortest paths on the meta-graph as lists of (type, direction, class)."""
    best, found = None, []
    q = deque([(src, [])])
    seen_len = {src: 0}
    while q:
        cls, path = q.popleft()
        if best is not None and len(path) > best:
            break
        if cls == dst and path:
            best = len(path)
            found.append(path)
            continue
        if len(path) >= max_hops:
            continue
        for typ, direction, nxt in META[cls]:
            if seen_len.get(nxt, 99) >= len(path) + 1:
                seen_len[nxt] = len(path) + 1
                q.append((nxt, path + [(typ, direction, nxt)]))
    return found


@dataclass
class Branch:
    cls: str
    mapping: dict
    constraints: list[tuple[Constraint, list]]   # (constraint, path)


@dataclass
class Plan:
    branches: list[Branch] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    clarifications: list[str] = field(default_factory=list)


def plan(ir: IR) -> Plan:
    p = Plan()
    for cls in ir.target_classes:
        mapping = TRAITS[ir.trait][cls] if ir.trait else {}
        paths = []
        ok = True
        for c in ir.constraints:
            found = shortest_paths(cls, c.cls)
            if not found:
                p.notes.append(f"{cls}: no path to {c.cls}; branch dropped")
                ok = False
                break
            if len(found) > 1:
                p.clarifications.append(f"{cls} -> {c.cls}: {len(found)} equally short paths; which one?")
                ok = False
                break
            paths.append((c, found[0]))
        if not ok:
            continue
        if ir.predicate and "anchor" in mapping and (cls, mapping["anchor"]) not in INDEXES:
            p.notes.append(f"{cls}.{mapping['anchor']} is not indexed; anchor would be a label scan")
        p.branches.append(Branch(cls, mapping, paths))
    return p


# =========================================================================== 7. CYPHER from templates
def pattern(var: str, path: list[tuple], var_names: dict) -> str:
    out, cur = f"({var})", var
    for typ, direction, cls in path:
        v = f"{cls[0].lower()}{len(var_names)}"
        var_names[cls] = v
        out += f"-[:{typ}]->({v}:{cls})" if direction == "out" else f"<-[:{typ}]-({v}:{cls})"
    return out


def to_cypher(ir: IR, pl: Plan) -> tuple[str, dict]:
    params: dict[str, Any] = {}
    if ir.predicate:
        params["reference"] = ir.predicate["reference"].isoformat()
        params["offset"] = ir.predicate["offset_days"]
    cols_extra = [f"{c.cls.lower()}_{c.project}" for c in ir.constraints if c.project]
    branches = []
    for b in pl.branches:
        v = f"{b.cls[0].lower()}0"
        var_names = {b.cls: v}
        lines = [f"MATCH ({v}:{b.cls}:{PARTITION})"]
        anchor_expr = None
        if ir.predicate:
            cmp = f"{ir.predicate['op']} date($reference) - duration({{days: $offset}})"
            if "aggregate" in b.mapping:
                agg = b.mapping["aggregate"]
                inner = TRAITS[ir.trait][agg["over"]]["anchor"]
                fn = "min" if agg["rule"] == "any" else "max"
                arrow = f"<-[:{agg['via']}]-" if agg["direction"] == "in" else f"-[:{agg['via']}]->"
                lines.append(f"MATCH ({v}){arrow}(m:{agg['over']}:{PARTITION})")
                lines.append(f"WITH {v}, {fn}(m.{inner}) AS anchor")
                lines.append(f"WHERE anchor {cmp}")
                anchor_expr = "anchor"
            else:
                anchor_expr = f"{v}.{b.mapping['anchor']}"
                lines.append(f"WHERE {anchor_expr} {cmp}")
        for i, (c, path) in enumerate(b.constraints):
            lines.append("MATCH " + pattern(v, path, var_names))
            if c.value is not None:
                pname = f"c{i}"
                params[pname] = c.value
                lines.append(f"WHERE {var_names[c.cls]}.{c.prop} = ${pname}")
        ret = [f"'{b.cls}' AS class", f"{v}.id AS id"]
        if anchor_expr:
            ret += [f"{anchor_expr} AS anchor",
                    f"duration.between({anchor_expr}, date($reference)).days AS days_late"]
        for c, _ in b.constraints:
            if c.project:
                ret.append(f"{var_names[c.cls]}.{c.project} AS {c.cls.lower()}_{c.project}")
        lines.append("RETURN " + ", ".join(ret))
        branches.append("\n".join(lines))
    order = "ORDER BY days_late DESC" if ir.predicate else "ORDER BY id"
    if len(branches) == 1:
        cypher = f"{branches[0]}\n{order}\nLIMIT 20"
    else:
        body = "\nUNION ALL\n".join(branches)
        cypher = "CALL {\n" + body + "\n}\nRETURN *\n" + order + "\nLIMIT 20"
    return cypher, params


def anchor_check(cypher: str) -> bool:
    """Stand-in for EXPLAIN: the first clause must seek on the partition label + an indexed anchor."""
    first = cypher.splitlines()[0] if not cypher.startswith("CALL") else cypher.splitlines()[1]
    m = re.match(rf"MATCH \((\w+):(\w+):{PARTITION}\)", first)
    if not m:
        return False
    var, cls = m.groups()
    where = re.search(rf"WHERE {var}\.(\w+) ", cypher) or re.search(r"WITH \w+, (?:min|max)\(m\.(\w+)\)", cypher)
    return bool(where) and ((cls, where.group(1)) in INDEXES or
                            (TRAITS["HasCommitment"][cls].get("aggregate") is not None))


# =========================================================================== 8. EXECUTE (in-memory, from the IR)
def traverse(node: Node, path: list[tuple]) -> list[Node]:
    frontier = [node]
    for typ, direction, cls in path:
        nxt = []
        for n in frontier:
            edges = OUT[n.id] if direction == "out" else IN[n.id]
            nxt += [NODES[o] for t, o in edges if t == typ and cls in NODES[o].labels]
        frontier = nxt
    return frontier


def compare(a: date, op: str, b: date) -> bool:
    return {"=": a == b, "<": a < b, "<=": a <= b}[op]


def execute(ir: IR, pl: Plan) -> list[dict]:
    rows = []
    for b in pl.branches:
        for n in NODES.values():
            if b.cls not in n.labels or PARTITION not in n.labels:
                continue
            row: dict[str, Any] = {"class": b.cls, "id": n.props.get("id", n.id)}
            if ir.predicate:
                if "aggregate" in b.mapping:
                    agg = b.mapping["aggregate"]
                    members = traverse(n, [(agg["via"], agg["direction"], agg["over"])])
                    members = [m for m in members if PARTITION in m.labels]
                    if not members:
                        continue
                    inner = TRAITS[ir.trait][agg["over"]]["anchor"]
                    anchor = (min if agg["rule"] == "any" else max)(m.props[inner] for m in members)
                else:
                    anchor = n.props[b.mapping["anchor"]]
                ref = ir.predicate["reference"] - timedelta(days=ir.predicate["offset_days"])
                if not compare(anchor, ir.predicate["op"], ref):
                    continue
                row["anchor"] = anchor
                row["days_late"] = (ir.predicate["reference"] - anchor).days
            ok = True
            for c, path in b.constraints:
                ends = traverse(n, path)
                if c.value is not None:
                    ends = [e for e in ends if str(e.props.get(c.prop, "")).lower() == str(c.value).lower()]
                if not ends:
                    ok = False
                    break
                if c.project:
                    row[f"{c.cls.lower()}_{c.project}"] = ends[0].props[c.project]
            if ok:
                rows.append(row)
    rows.sort(key=lambda r: (-r.get("days_late", 0), r["id"]))
    return rows[:20]


# =========================================================================== 9. PIPELINE
@dataclass
class Result:
    words: list[Word]
    ir: IR
    plan: Plan | None
    cypher: str | None
    params: dict
    rows: list[dict]
    clarifications: list[str]

    @property
    def needs_clarification(self) -> bool:
        return self.cypher is None


def nl_to_cypher(sentence: str, today: date = TODAY) -> Result:
    words = classify(sentence)
    ir = ground(words, today)
    blocking = [c for c in ir.clarifications if "excluded" not in c]   # H5 exclusions are informative, not blocking
    if blocking or not ir.target_classes:
        return Result(words, ir, None, None, {}, [], ir.clarifications)
    pl = plan(ir)
    if pl.clarifications or not pl.branches:
        return Result(words, ir, pl, None, {}, [], ir.clarifications + pl.clarifications)
    cypher, params = to_cypher(ir, pl)
    rows = execute(ir, pl)
    return Result(words, ir, pl, cypher, params, rows, ir.clarifications)


# =========================================================================== 10. TESTS
class NlToCypherTests(unittest.TestCase):
    def setUp(self):
        LEXICON.clear()

    def test_one_week_late_tomorrow(self):
        r = nl_to_cypher("select the list of containers that tomorrow will be one week late "
                         "to be delivered to their destinations")
        self.assertFalse(r.needs_clarification, r.clarifications)
        # C3: the adjective was inverted into an equality on the stored anchor
        self.assertEqual(r.ir.predicate["op"], "=")
        self.assertEqual(r.ir.predicate["offset_days"], 7)
        self.assertEqual(r.params["reference"], "2026-10-19")      # D3: tomorrow, resolved outside the graph
        self.assertIn("MATCH (c0:Container:Open)", r.cypher)         # rule 4 + 6: partition, then index seek
        self.assertIn("c0.committed_delivery_date = date($reference) - duration({days: $offset})", r.cypher)
        self.assertIn("-[:BELONGS_TO]->(b1:Booking)-[:DELIVERS_TO]->(d2:Destination)", r.cypher)
        self.assertNotIn("2026", r.cypher)                           # parameters, never literals
        self.assertTrue(anchor_check(r.cypher))
        self.assertEqual({row["id"] for row in r.rows}, {"MSKU1000001", "MSKU1000002"})   # delivered one excluded
        self.assertEqual({row["destination_name"] for row in r.rows}, {"Dublin", "Rotterdam"})

    def test_synonyms_ground_through_cards(self):
        r = nl_to_cypher("show me boxes overdue by more than a week going to the Dublin site")
        self.assertFalse(r.needs_clarification, r.clarifications)
        by_span = {g.span: g for g in r.ir.groundings}
        self.assertEqual(by_span["boxes"].element, "class:Container")
        self.assertEqual(by_span["site"].element, "class:Destination")
        self.assertEqual(by_span["overdue"].element, "pred:LATE")
        self.assertEqual(by_span["Dublin"].element, "Destination.name=Dublin")
        self.assertEqual(r.ir.predicate["op"], "<")
        self.assertEqual(r.params["c0"], "Dublin")
        self.assertIn("WHERE d2.name = $c0", r.cypher)
        self.assertEqual([row["id"] for row in r.rows], ["MSKU1000004"])   # 13 days late; MSKU1000001 is only 6

    def test_hypernym_expands_then_trait_cuts(self):
        r = nl_to_cypher("i wanna see a list of entities that delayed more than 7 days")
        self.assertFalse(r.needs_clarification, r.clarifications)
        self.assertEqual(r.ir.hypernym, "Entity")
        self.assertEqual(set(r.ir.target_classes), {"Container", "VesselVoyage", "Booking"})
        for excluded in ("Party", "Destination", "Port", "Vessel", "Leg"):          # under Entity, no commitment
            self.assertNotIn(excluded, r.ir.target_classes)
        self.assertTrue(any("CustomsDeclaration" in c and "business" in c for c in r.clarifications))  # H5
        self.assertEqual(r.cypher.count("UNION ALL"), 2)
        self.assertIn("WITH b0, min(m.committed_delivery_date) AS anchor", r.cypher)   # H6 aggregation
        got = {(row["class"], row["id"]) for row in r.rows}
        self.assertEqual(got, {("Container", "MSKU1000004"), ("VesselVoyage", "VOY1"), ("Booking", "B1")})

    def test_proper_noun_ambiguity_asks(self):
        r = nl_to_cypher("containers late to Rotterdam")
        self.assertTrue(r.needs_clarification)
        self.assertTrue(any("Destination.name or Port.name" in c for c in r.clarifications), r.clarifications)

    def test_entity_noun_disambiguates_proper_noun(self):
        r = nl_to_cypher("containers late to the Rotterdam site")
        self.assertFalse(r.needs_clarification, r.clarifications)
        self.assertEqual([c.cls for c in r.ir.constraints], ["Destination"])
        self.assertEqual({row["id"] for row in r.rows}, {"MSKU1000002", "MSKU1000007"})

    def test_lexicon_is_a_write_back_cache(self):
        first = next(g for g in nl_to_cypher("boxes late").ir.groundings if g.span == "boxes")
        self.assertEqual(first.source, "embedding")
        confirm_grounding("boxes", "class:Container")
        second = next(g for g in nl_to_cypher("boxes late").ir.groundings if g.span == "boxes")
        self.assertEqual((second.source, second.score), ("lexicon", 1.0))

    def test_assumptions_are_stated(self):
        r = nl_to_cypher("containers late")
        self.assertTrue(any("LATE" in a and "calendar days" in a for a in r.ir.assumptions))

    def test_cypher_shape_for_the_record(self):
        r = nl_to_cypher("select the list of containers that tomorrow will be one week late "
                         "to be delivered to their destinations")
        expected = (
            "MATCH (c0:Container:Open)\n"
            "WHERE c0.committed_delivery_date = date($reference) - duration({days: $offset})\n"
            "MATCH (c0)-[:BELONGS_TO]->(b1:Booking)-[:DELIVERS_TO]->(d2:Destination)\n"
            "RETURN 'Container' AS class, c0.id AS id, c0.committed_delivery_date AS anchor, "
            "duration.between(c0.committed_delivery_date, date($reference)).days AS days_late, "
            "d2.name AS destination_name\n"
            "ORDER BY days_late DESC\n"
            "LIMIT 20"
        )
        self.assertEqual(r.cypher, expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
