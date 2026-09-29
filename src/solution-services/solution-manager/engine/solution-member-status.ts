// A member's load outcome. Unopened before the solution opens it; Resolved when its
// project handle is live; UnknownType when its type has no registered factory;
// LoadFailed when the factory threw opening it (Error carries the message).
export enum SolutionMemberStatus { Unopened, Resolved, UnknownType, LoadFailed }
