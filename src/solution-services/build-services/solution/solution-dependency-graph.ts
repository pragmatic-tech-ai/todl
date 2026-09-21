// The pure ordering core of a solution build (spec §9.2, §9.3, §9.6): a topological
// order (dependencies before dependents), cycle detection, and the upstream closure of
// a target. Operates on project ids; the caller derives the dependency edges from base
// bindings + any explicit overrides.
export interface SolutionOrder
{
    /** Topological order, dependencies first. Empty when a cycle was found. */
    Order: readonly string[];
    /** The members of a detected cycle, else undefined. */
    Cycle?: readonly string[];
}

export class SolutionDependencyGraph
{
    // Depth-first post-order gives dependencies-first naturally; a gray node re-entered
    // during its own descent is a back edge (cycle).
    public static Order(deps: ReadonlyMap<string, readonly string[]>): SolutionOrder
    {
        const order: string[] = [];
        const done = new Set<string>();
        const onStack = new Set<string>();

        const visit = (id: string, stack: string[]): readonly string[] | undefined =>
        {
            if (done.has(id)) return undefined;
            if (onStack.has(id)) return [...stack.slice(stack.indexOf(id)), id];
            onStack.add(id);
            stack.push(id);
            for (const dep of deps.get(id) ?? [])
            {
                const cycle = visit(dep, stack);
                if (cycle !== undefined) return cycle;
            }
            stack.pop();
            onStack.delete(id);
            done.add(id);
            order.push(id);
            return undefined;
        };

        for (const id of deps.keys())
        {
            const cycle = visit(id, []);
            if (cycle !== undefined) return { Order: [], Cycle: SolutionDependencyGraph.Dedupe(cycle) };
        }
        return { Order: order };
    }

    // The target plus every id it transitively depends on.
    public static Closure(deps: ReadonlyMap<string, readonly string[]>, target: string): ReadonlySet<string>
    {
        const closure = new Set<string>();
        const walk = (id: string): void =>
        {
            if (closure.has(id)) return;
            closure.add(id);
            for (const dep of deps.get(id) ?? []) walk(dep);
        };
        walk(target);
        return closure;
    }

    private static Dedupe(ids: readonly string[]): readonly string[]
    {
        return [...new Set(ids)];
    }
}
