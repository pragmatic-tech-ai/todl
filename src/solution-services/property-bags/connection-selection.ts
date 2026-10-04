import { type SolutionMember } from '../solution-manager/engine/solution-member.js';
import { type SolutionManagerService } from '../solution-manager/engine/solution-manager-service.js';
import { type SolutionBaseResolver } from '../solution-manager/engine/solution-base-resolver.js';
import { type ConnectionSpec } from '../package-manager/engine/registry-connection.js';
import { BagAddress, BagScope } from './bag-address.js';
import { BagCatalog, type IBagCatalog, type BagVantage } from './bag-catalog.js';
import { type IBagPersister } from './bag-persister.js';
import { ConnectionBag, ConnectionBagKind } from './connection-bag.js';
import { ConnectionResolution, ConnectionPurpose } from './connection-resolution.js';

// The identity fields a solution-scope adoption copies from a global connection.
export type AdoptableConnection = Pick<ConnectionSpec, 'Id' | 'DisplayName' | 'RegistryType'>;

// UX-free connection-selection ops over the property-bag catalog: the solution-scope default, the
// per-project active connection (a project-local `connection-selection`, never solution.json), and
// the consumer-id -> member -> effective connection lookup. The global inventory (specs, secrets,
// registries) and every view/health concern stay with the host.
export class ConnectionSelection
{
    private readonly catalog: IBagCatalog = new BagCatalog();
    private readonly resolution = new ConnectionResolution(this.catalog);

    constructor(
        private readonly manager: Pick<SolutionManagerService, 'ActiveSolution' | 'BuildVantage'>,
        private readonly resolver: Pick<SolutionBaseResolver, 'ConsumerIdOf'>,
        private readonly global: IBagPersister,
    )
    {
    }

    // Mark `spec` as the solution's default connection (solution-scope IsDefault). A connection that
    // exists only globally is adopted at solution scope (identity copied) so it resolves as the
    // solution default. No-op when no solution is open.
    public async SetSolutionDefault(spec: AdoptableConnection): Promise<void>
    {
        const solution = (await this.manager.BuildVantage(this.global))?.Solution;
        if (solution === undefined) return;
        for (const existing of solution.Ids(ConnectionBagKind))
        {
            new ConnectionBag(solution.Bag(ConnectionBagKind, existing)).IsDefault = existing === spec.Id;
        }
        if (!solution.Ids(ConnectionBagKind).includes(spec.Id))
        {
            const adopted = new ConnectionBag(solution.Create(ConnectionBagKind, spec.Id));
            adopted.IsDefault = true;
            adopted.DisplayName = spec.DisplayName;
            adopted.RegistryType = spec.RegistryType;
        }
        await solution.Flush();
    }

    // Record the member's active connection as a project-local selection.
    public async SetActiveConnectionFor(member: SolutionMember, connectionId: string): Promise<void>
    {
        const vantage = await this.manager.BuildVantage(this.global, member);
        if (vantage === undefined) return;
        const address = new BagAddress(ConnectionSelection.ScopeOf(connectionId, vantage), ConnectionBagKind, connectionId);
        this.resolution.Select(ConnectionPurpose.ReferenceResolution, address, vantage);
        await vantage.ProjectLocal?.Flush();
    }

    // Drop the member's selection so it falls back to the solution/global default.
    public async ClearActiveFor(member: SolutionMember): Promise<void>
    {
        const vantage = await this.manager.BuildVantage(this.global, member);
        if (vantage === undefined) return;
        this.resolution.Clear(ConnectionPurpose.ReferenceResolution, vantage);
        await vantage.ProjectLocal?.Flush();
    }

    // The effective connection id a consuming project (identified by ConsumerIdOf) resolves its
    // bases against: project-local selection, else nearest default. Undefined when no member carries
    // that id or no connection applies.
    public async EffectiveConnectionIdForConsumer(consumerId: string): Promise<string | undefined>
    {
        const member = await this.MemberForConsumerId(consumerId);
        if (member === undefined) return undefined;
        const vantage = await this.manager.BuildVantage(this.global, member);
        if (vantage === undefined) return undefined;
        return this.resolution.EffectiveFor(ConnectionPurpose.ReferenceResolution, vantage)?.Address.Id;
    }

    // The member whose storage carries `consumerId` (a producer's package id, else an architecture's
    // name). Async because reading the manifest is. Undefined when none matches.
    public async MemberForConsumerId(consumerId: string): Promise<SolutionMember | undefined>
    {
        const members = this.manager.ActiveSolution?.Members;
        if (members === undefined) return undefined;
        for (const member of members)
        {
            if (member.Storage === undefined) continue;
            if (await this.resolver.ConsumerIdOf(member.Storage) === consumerId) return member;
        }
        return undefined;
    }

    // The scope a connection id lives at: a project/solution bag if present, else global.
    private static ScopeOf(connectionId: string, vantage: BagVantage): BagScope
    {
        if (vantage.ProjectLocal?.Ids(ConnectionBagKind).includes(connectionId) === true) return BagScope.Project;
        if (vantage.ProjectShared?.Ids(ConnectionBagKind).includes(connectionId) === true) return BagScope.Project;
        if (vantage.Solution?.Ids(ConnectionBagKind).includes(connectionId) === true) return BagScope.Solution;
        return BagScope.Global;
    }
}
