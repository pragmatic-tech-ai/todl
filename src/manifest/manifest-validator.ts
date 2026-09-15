// ManifestValidator (SPEC-04 §10): consistency checks over a loaded
// ManifestReader. It reads the positional JSON view (the numeric mirror) plus
// the shared schema, so every column is checked by its declared kind. Header
// magic and directory/file bounds are enforced at parse time by
// ManifestReader.fromBinary; this validator covers the logical rules (1, 3–9)
// that survive into the decoded manifest. Cross-manifest resolution (does a
// TypeRef actually resolve in a dependency?) is a Domain concern (SPEC-06).

import { ManifestReader } from "./manifest-reader.js";
import { Base64 } from "./bytes.js";
import { TableId } from "./enums.js";
import { TypeDefOrRef } from "./token.js";
import { ManifestSchema, ColKind, Column } from "./schema.js";
import type { ManifestJson } from "./records.js";

export enum IssueSeverity
{
    Error = "error",
    Warning = "warning",
}

export class ValidationIssue
{
    constructor(readonly severity: IssueSeverity, readonly message: string) {}
}

export class ManifestValidator
{
    constructor(private readonly reader: ManifestReader) {}

    /** True when validation produces no Error-severity issues. */
    get isValid(): boolean
    {
        return this.validate().every((i) => i.severity !== IssueSeverity.Error);
    }

    /** Collect all consistency issues (errors + warnings). */
    validate(): ValidationIssue[]
    {
        const json = this.reader.toJSON();
        const issues: ValidationIssue[] = [];
        const err = (m: string) => issues.push(new ValidationIssue(IssueSeverity.Error, m));
        const warn = (m: string) => issues.push(new ValidationIssue(IssueSeverity.Warning, m));

        const strLen = json.strings.length;
        const constLen = json.const.length;
        const rows = (t: TableId): number[][] => this.tableRows(json, t);
        const rowCount = (t: TableId): number => rows(t).length;

        // Rule 1: header.
        if (json.format !== "todl-manifest/1")
            err(`unexpected format tag "${json.format}"`);
        const rootInRange = json.root >= 0 && json.root <= rowCount(TableId.TypeInfo);
        if (!rootInRange)
            err(`root ${json.root} is not a valid TypeInfo row`);
        // Rule 8: root kind should be Concept (the virtual Element).
        if (rootInRange && json.root !== 0)
        {
            const kind = this.reader.typeInfo(json.root).kind;
            if (kind !== 0) warn(`root TypeInfo kind is ${kind}, expected Concept (0)`);
        }

        // Rules 3, 5, 6: per-column checks.
        for (const table of ManifestSchema.order)
        {
            const cols = ManifestSchema.columns(table);
            const tableRows = rows(table);
            for (let r = 0; r < tableRows.length; r++)
            {
                const row = tableRows[r]!;
                for (let c = 0; c < cols.length; c++)
                {
                    const col = cols[c]!;
                    const value = row[c]!;
                    this.checkColumn(table, r + 1, col, value, strLen, constLen, rowCount, err);
                }
            }
        }

        // Rule 4: slice integrity.
        this.checkSlices(rows, rowCount, err);
        // Rule 7: Imports / TypeRef.
        this.checkImports(rows, rowCount, err);
        // Rule 9: every #Const blob begins with a known ConstTag.
        this.checkConstTags(json, err);

        return issues;
    }

    private tableRows(json: ManifestJson, table: TableId): number[][]
    {
        // TableId enum name matches the JSON key (TypeInfo, Field, …).
        return (json.tables as Record<string, number[][]>)[TableId[table]]!;
    }

    private checkColumn(
        table: TableId, row: number, col: Column, value: number,
        strLen: number, constLen: number,
        rowCount: (t: TableId) => number, err: (m: string) => void,
    ): void
    {
        const where = `${TableId[table]}[${row}].${col.name}`;
        switch (col.kind)
        {
            case ColKind.Str:
                if (value < 0 || value >= strLen) err(`${where}: #Strings index ${value} out of range`);
                break;
            case ColKind.Const:
                if (value < 0 || value >= constLen) err(`${where}: #Const index ${value} out of range`);
                break;
            case ColKind.Row:
                if (value < 0 || value > rowCount(col.rowTable!))
                    err(`${where}: row index ${value} out of range for ${TableId[col.rowTable!]}`);
                break;
            case ColKind.Coded:
            {
                const ref = TypeDefOrRef.decode(value);
                if (ref.isNull) break;
                if (ref.toTypeRef)
                {
                    if (rowCount(TableId.TypeRef) === 0)
                        err(`${where}: TypeRef tag but no TypeRef rows exist`);
                    else if (ref.row > rowCount(TableId.TypeRef))
                        err(`${where}: TypeRef row ${ref.row} out of range`);
                }
                else if (ref.row > rowCount(TableId.TypeInfo))
                {
                    err(`${where}: TypeInfo row ${ref.row} out of range`);
                }
                break;
            }
            case ColKind.U8:
                if (col.name === "kind" && (value < 0 || value > 9))
                    err(`${where}: MetaKind code ${value} out of range 0..9`);
                if (col.name === "card" && (value < 0 || value > 3))
                    err(`${where}: Cardinality code ${value} out of range 0..3`);
                break;
            case ColKind.U16:
                break;
        }
    }

    private checkSlices(
        rows: (t: TableId) => number[][], rowCount: (t: TableId) => number,
        err: (m: string) => void,
    ): void
    {
        // [start, count] columns keyed to their referenced table (SPEC-04 §5).
        const slice = (owner: TableId, startCol: number, countCol: number, ref: TableId) => {
            const list = rows(owner);
            const max = rowCount(ref);
            for (let i = 0; i < list.length; i++)
            {
                const start = list[i]![startCol]!;
                const count = list[i]![countCol]!;
                if (count === 0) continue;
                if (start < 1 || start + count - 1 > max)
                    err(`${TableId[owner]}[${i + 1}]: slice [${start},${count}] exceeds ${TableId[ref]} (${max})`);
            }
        };
        slice(TableId.TypeInfo, 4, 5, TableId.Field); // fieldStart/Count
        slice(TableId.TypeInfo, 6, 7, TableId.Rel); // relStart/Count
        slice(TableId.Rel, 1, 2, TableId.Target); // targetStart/Count
        slice(TableId.Class, 4, 5, TableId.Fixed); // fixedStart/Count
        slice(TableId.Taxonomy, 1, 2, TableId.Target); // representsStart/Count
    }

    private checkImports(
        rows: (t: TableId) => number[][], rowCount: (t: TableId) => number,
        err: (m: string) => void,
    ): void
    {
        const imports = rows(TableId.Imports);
        for (let i = 0; i < imports.length; i++)
        {
            const [model, version] = imports[i]!;
            if (model === 0) err(`Imports[${i + 1}]: model name is empty`);
            if (version === 0) err(`Imports[${i + 1}]: version is empty`);
        }
        const typeRefs = rows(TableId.TypeRef);
        for (let i = 0; i < typeRefs.length; i++)
        {
            const imp = typeRefs[i]![0]!;
            if (imp < 1 || imp > rowCount(TableId.Imports))
                err(`TypeRef[${i + 1}]: import ${imp} out of range`);
        }
    }

    private checkConstTags(json: ManifestJson, err: (m: string) => void): void
    {
        for (let i = 1; i < json.const.length; i++)
        {
            const blob = Base64.decode(json.const[i]!);
            if (blob.length === 0) continue;
            const tag = blob[0]!;
            if (tag < 0 || tag > 4) err(`#Const[${i}]: unknown ConstTag ${tag}`);
        }
    }
}
