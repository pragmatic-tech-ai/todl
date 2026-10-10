/** Deployment policy for how a `datasource` may obtain its connection. */
export interface ConnectionPolicy
{
  /** Inline coordinates (host, url, ...) directly on the datasource are allowed. */
  InlineAllowed: boolean;
  /** A model-declared `provider` is allowed. */
  ProviderAllowed: boolean;
}

export class ConnectionPolicies
{
  public static readonly Default: ConnectionPolicy = { InlineAllowed: true, ProviderAllowed: false };
}
