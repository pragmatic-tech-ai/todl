import type { PackageRef } from '../../domain/domain.js';

/** How a package set reached the environment. */
export enum DeliveryChannel
{
    /** An app deployed to the environment. */
    Deploy = 1,
    /** A promote set promoted into the environment. */
    Promote = 2,
}

/** One app's, or one promote set's, packages. */
export interface IPackageDelivery
{
    readonly Channel: DeliveryChannel;
    /** The app name or the promote set id. */
    readonly Name: string;
    readonly Packages: readonly Required<PackageRef>[];
}
