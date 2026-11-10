// GENERATED from system.todl by scripts/gen-system-package.mts — do not edit by hand.
import type { PackageDocument } from '../../publish/publish.js';

/** The compiled todl.system@1.0.0 package document (own-only; the prelude is implicit). */
export class SystemPackageDocument
{
    // The model.json shape: enum members are their serialized string values, hence the cast.
    public static readonly Document: PackageDocument = {
        "nodes": [
            {
                "id": "todl.system.ShareGrant",
                "tier": "Ontology",
                "type": null,
                "metaKind": "concept",
                "namespace": "todl.system",
                "localId": null,
                "isClass": false,
                "class": null,
                "storageId": null,
                "canonicalId": null,
                "fields": [
                    {
                        "name": "record",
                        "type": "todl.Element",
                        "cardinality": 0
                    },
                    {
                        "name": "subjectKind",
                        "type": "string",
                        "cardinality": 0
                    },
                    {
                        "name": "subjectId",
                        "type": "string",
                        "cardinality": 0
                    },
                    {
                        "name": "read",
                        "type": "boolean",
                        "cardinality": 1
                    },
                    {
                        "name": "update",
                        "type": "boolean",
                        "cardinality": 1
                    },
                    {
                        "name": "delete",
                        "type": "boolean",
                        "cardinality": 1
                    },
                    {
                        "name": "assign",
                        "type": "boolean",
                        "cardinality": 1
                    },
                    {
                        "name": "share",
                        "type": "boolean",
                        "cardinality": 1
                    }
                ],
                "attrs": {}
            }
        ],
        "edges": []
    } as unknown as PackageDocument;
}
