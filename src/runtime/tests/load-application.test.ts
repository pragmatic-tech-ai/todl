import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkAgainst } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { TODL, DocumentSource, type TodlDefinition } from "../index.js";

// Stand-ins for the compiled `tech-architecture` meta-model and `Microsoft`
// library packages (the real ones live outside this repo). Each is a compiled
// TodlDocument — exactly what an imported package handle would carry.
const metaModel = toJSON(
  check([{ uri: "tech-architecture.todl", text: `
namespace tech_architecture {
  concept Location  { name : string; }
  concept Component { name : string; hostedIn : Location?; }
}` }]).model,
);

const microsoft = toJSON(
  check([{ uri: "microsoft.todl", text: `
namespace microsoft { concept Service { name : string; } }` }]).model,
);

// The application assembly: a model defined AND populated at dev time (the P1
// embedded-population case), compiled against the meta-model.
const application = toJSON(
  checkAgainst([metaModel], [{ uri: "application.todl", text: `
namespace application {
  model Major : tech_architecture {
    tech_architecture.Location dc1 { name = "DC1"; }
    tech_architecture.Location dc2 { name = "DC2"; }
  }
}` }]).model,
);

test("loads a TODL application and reads instances by definition", async () => {
  // Mirrors the canonical scenario: compose packages, load the app, then walk
  // models → definitions → instances.
  const graph = TODL.ComposeGraph([metaModel], [microsoft]);
  await TODL.Load(graph, new DocumentSource(application));

  const locationDefinition = graph.GetDefinition("tech_architecture.Location");
  assert.ok(locationDefinition, "Location definition resolves");

  const found: string[] = [];
  for (const model of graph.Models)
  {
    if (model.Name !== "Major") continue;
    for (const definition of model.GetDefinitions())
    {
      if (definition.Is(locationDefinition as TodlDefinition))
      {
        for (const location of model.GetInstances(definition)) found.push(location.Name);
      }
    }
  }

  assert.deepEqual(found.sort(), ["DC1", "DC2"]);
});

test("GetDefinition resolves by flat id too, and Is honors subtyping", async () => {
  const graph = TODL.ComposeGraph([metaModel], [microsoft]);
  await TODL.Load(graph, new DocumentSource(application));

  assert.ok(graph.GetDefinition("Location"), "flat id resolves");
  assert.equal(graph.GetDefinition("microsoft.NoSuch"), undefined, "unknown resolves to undefined");
});
